
import { getDatabase, ref, runTransaction, get, update, set } from 'firebase/database';
import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { saveSaleToAccountSummary, reversarVentaCuenta } from '@/lib/api/myAccountApi';
import { cancelarComision } from '@/lib/api/comisionesApi';
import { processStockForCounterSale, reverseStockForCounterSale } from '@/lib/api/transactionsApi';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { calcularVentaCostoGanancia } from '@/lib/api/ventaUtils';
import { emitirRemitoDeVenta } from './remitosApi';
import { COMPROBANTE_FACTURA } from '@/lib/api/facturaORemito';
import { resolverComprobanteDeVenta } from '@/lib/api/facturaORemitoApi';
import { updateStatistics } from './salesApi';
import { addExpenseToShift } from './expensesApi';
import { savePrepaymentForApp } from '@/lib/api/prepaymentApi';
import { referenciaDeVenta } from '@/lib/api/facturaMostrador';
import { idDeEsteDispositivo } from '@/lib/api/facturacionDeRemitoApi';
import { validarStockDeCarrito } from '@/lib/api/validacionStockVentaApi';

const getNextCounterSaleId = async (db, localId) => {
  const counterRef = ref(db, `${localId}/CONTADORES/mostrador`);
  const { committed, snapshot } = await runTransaction(counterRef, (currentValue) => {
    return (currentValue || 0) + 1;
  });

  if (!committed) {
    throw new Error("No se pudo obtener el siguiente ID de venta de mostrador.");
  }
  return snapshot.val();
};

/**
 * UNA sola entrada en UNA sola cola, por el TOTAL COMPLETO de la venta.
 *
 * La cola y el importe ya vienen resueltos en `encolado` (facturaORemito.js).
 * Antes acá entraba cualquier método cuyo NOMBRE contuviera "transferencia",
 * con su importe PARCIAL, sin mirar el interruptor: una cuenta apagada se
 * facturaba igual y además recibía su FCX, y un pago combinado generaba una
 * factura por cada medio de pago.
 */
const saveCounterSaleToFacturacion = async (db, localId, saleId, saleData, encolado, impresion = null) => {
  const productos = {};
  (saleData.items || []).forEach((item, index) => {
    productos[`producto_${index + 1}`] = {
      nombre: item.nombre,
      valor: item.valor || 0
    };
  });

  const now = new Date();
  // Encabezado ÚNICO de mostrador. Antes convivían dos: el del tilde manual
  // ("Consumidor Final" / "Sin Datos") y el del camino automático
  // ("consumidor final" / "  "). Queda el primero para las dos. El resto del
  // payload fiscal no se toca.
  const facturaData = {
    clientes: "Consumidor Final",
    direccion: "Sin Datos",
    producto: productos,
    fecha: saleData.date || formatDateForFirebase(now),
    hora: saleData.hora || now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  const rutaCola = `${localId}/${encolado.cola}/M${saleId}`;
  console.log(`[FACTURACION] Venta finalizada: mostrador M${saleId} por ${encolado.total}`);
  if (encolado.medioDePago) console.log(`[FACTURACION] Medio de pago: ${encolado.medioDePago}`);
  if (encolado.regla) console.log(`[FACTURACION] Regla aplicada: ${encolado.regla}`);
  console.log(`[FACTURACION] Cuenta fiscal resuelta: ${encolado.cuenta}`);
  console.log(`[FACTURACION] Cola seleccionada: ${encolado.cola}`);
  console.log(`[FACTURACION] Ruta destino: ${rutaCola}`);
  console.log('[FACTURACION] Iniciando escritura');

  const facturacionRef = ref(db, rutaCola);
  await set(facturacionRef, {
    ...facturaData,
    total: encolado.total,
    // REFERENCIA DE VUELTA. El motor AFIP hace `{...pedido}` al guardar el
    // comprobante en /{localId}/VENTAS, así que estos campos viajan hasta la
    // factura emitida y permiten reconocer a qué venta corresponde sin tocar el
    // motor. Es lo que hace posible imprimir el ticket recién cuando hay CAE.
    ...referenciaDeVenta({ localId, saleId }),
    // IMPRESIÓN AUTOMÁTICA. Viaja encolado y el motor lo copia dentro del
    // comprobante emitido, así que la factura llega a VENTAS sabiendo que hay
    // que imprimirla y en qué terminal se pidió. Nada depende de que esta
    // pantalla siga abierta.
    ...(impresion ? { imprimirAlEmitir: true, impresionSolicitadaPor: impresion.deviceId, emitidaAt: Date.now() } : {}),
    colaFacturacion: encolado.cola,
    cuentaCobro: encolado.cuenta,
  });
  console.log(`[FACTURACION] Escritura confirmada: ${rutaCola}`);
};

/**
 * Guarda una venta de mostrador. La cola fiscal la decide ENTERAMENTE
 * `resolverComprobanteDeVenta` a partir del medio de pago; no hay forma de
 * forzarla desde la pantalla y no se le pregunta nada al cajero.
 */
export const saveCounterSale = async (saleData, shift) => {
  const t0 = Date.now();
  console.log('[VENTA MOSTRADOR] inicio confirmar venta');

  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const FIREBASE_URL = getFirebaseUrl();
  // Un solo "op" para TODA la venta de mostrador, incluida la Fase 2 en
  // background: si el local cambia en cualquier punto, cada escritura que
  // quede (incluidas las de background) se aborta en vez de terminar
  // escribiendo en el local equivocado.
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  try {
    // ── STOCK: ÚLTIMA PALABRA, ANTES DE TOCAR NADA ────────────────────────
    //
    // Entre "Proceder al pago" y este punto pasó el modal de cobro: pudo
    // agotarse una materia prima (otra terminal, la cocina). Se revalida contra
    // un snapshot FRESCO con la cantidad REAL del carrito, y se corta ACÁ:
    // todavía no se consumió el número de venta ni se escribió nada. El mensaje
    // dice qué falta y cuánto, y CounterTab lo muestra tal cual.
    const stock = await validarStockDeCarrito(saleData.items);
    if (!stock.suficiente) {
      console.error(`[VENTA MOSTRADOR] venta NO registrada: falta stock`, stock.faltantes);
      throw new Error(stock.mensaje);
    }

    // ── FASE 1: Ruta crítica — bloquea UI hasta completar ─────────────────
    let t = Date.now();
    // FACTURA o REMITO se decide ANTES de guardar la venta, para que la venta
    // guardada ya lleve la decisión (`comprobante`) y todo lo que venga después
    // —facturación, remito, reprocesos— lea el mismo valor. Va en paralelo con
    // el ID para no agregar latencia a la ruta crítica.
    //
    // Si la venta DEBE facturarse y no se puede determinar una cola válida,
    // resolverComprobanteDeVenta LANZA: la venta no se confirma y el cajero ve
    // el error. No se cae a un FCX ni se manda a una cola equivocada.
    const [saleId, decision] = await Promise.all([
      getNextCounterSaleId(db, LOCAL_ID),
      resolverComprobanteDeVenta(
        { payments: saleData.payments },
        { emiteFacturaManual: saleData.emiteFactura === true }
      ),
    ]);
    console.log(`[VENTA MOSTRADOR] obtener ID + decidir comprobante: ${Date.now() - t} ms`);

    const now = new Date();
    const fechaCaja = formatDateForFirebase(getOperationalDate(now));
    const formattedDate = formatDateForFirebase(now);

    const hours   = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedTime = `${hours}:${minutes}:${seconds}`;

    // Venta, costo y ganancia de la venta (gestión — no afecta facturación/CAE/PDF)
    const { totalVenta, totalCosto, ganancia } = calcularVentaCostoGanancia(saleData.items);

    const saleWithTimestamp = {
      items:           saleData.items,
      total:           saleData.total,
      CostoTotal:      totalCosto,
      VentaTotal:      totalVenta,
      Ganancia:        ganancia,
      payment:         { total: saleData.total, details: saleData.payments, payments: saleData.payments },
      payments:        saleData.payments,
      specialDiscount: saleData.specialDiscount || null,
      // `emiteFactura` sigue siendo lo que TILDÓ el operador. La decisión real
      // —la que mira facturación y la que mira el remito— es `comprobante`.
      emiteFactura:    saleData.emiteFactura || false,
      comprobante:       decision.comprobante,
      motivoComprobante: decision.motivo,
      timestamp:       formattedDate,
      date:            formattedDate,
      hora:            formattedTime,
      id:              saleId,
      turno:           shift?.id || null,
      fechacaja:       fechaCaja,
      client:          { name: 'Consumidor Final' },
      status:          'COMPLETADO',
    };

    t = Date.now();
    // Revalida antes del PUT crítico definitivo: getNextCounterSaleId() de
    // arriba hizo su propia transacción (await real).
    op.getDatabaseOrAbort();
    const url = `${FIREBASE_URL}/${LOCAL_ID}/MOSTRADOR/${saleId}.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saleWithTimestamp),
    });
    if (!response.ok) throw new Error('Network response was not ok');
    console.log(`[VENTA MOSTRADOR] guardar venta Firebase: ${Date.now() - t} ms`);

    // ── DESCUENTO DE STOCK: RUTA CRÍTICA, NO BACKGROUND ────────────────────
    //
    // Antes esto corría dentro de `runBackground()`, que se lanzaba sin await:
    // la pantalla daba la venta por terminada mientras el descuento seguía
    // pendiente, y si fallaba nadie se enteraba. Con el cuelgue de la precarga
    // de `onValue` eso significaba vender sin descontar durante horas.
    //
    // Ahora la venta no se considera terminada hasta que el stock quedó
    // efectivamente aplicado en Firebase (recursos + appliedOps + marca). El
    // resultado viaja en `stockResult` para que la pantalla pueda avisar.
    const tStock = Date.now();
    let stockResult;
    try {
      stockResult = await processStockForCounterSale(saleWithTimestamp);
    } catch (e) {
      console.error('[VENTA MOSTRADOR] error stock:', e);
      stockResult = { success: false, error: e?.message || String(e) };
    }
    const msStock = Date.now() - tStock;
    console.log(`[VENTA MOSTRADOR] descontar stock: ${msStock} ms — ${stockResult.success ? 'aplicado' : 'PENDIENTE: ' + (stockResult.error || stockResult.motivo || '')}`);
    if (!stockResult.success) {
      console.error(`[VENTA MOSTRADOR] la venta ${saleId} quedó SIN descontar stock`, stockResult);
    }
    console.log(`[VENTA MOSTRADOR] ruta crítica total: ${Date.now() - t0} ms — liberando pantalla`);

    // ── FASE 2: Background — NO bloquea la UI ─────────────────────────────
    // Facturación, remito, comisiones y estadísticas corren en segundo plano.
    // El stock YA quedó aplicado antes de llegar acá.
    const runBackground = async () => {
      let tb;

      // LEDGER DE PREPAGOS (PedidosYa / Rappi).
      //
      // `savePrepaymentForApp` EXIGE la fecha operativa: sin ella lanza y el
      // catch de abajo se lo tragaba, así que desde que cambió esa firma NINGÚN
      // prepago de mostrador se registraba (las ventas sí quedaban guardadas y
      // con su medio de pago; lo que faltaba era este asiento derivado).
      // El reporte de prepagos ya no depende de este nodo —lee las ventas—,
      // pero el ledger se sigue escribiendo porque lo usa "Ventas por Apps".
      if (saleData.payments && saleData.payments.length > 0) {
        tb = Date.now();
        for (const payment of saleData.payments) {
          try {
            const methodUpper = payment.method.toUpperCase();
            if (methodUpper.includes('PREPAGO PEDIDOSYA') || methodUpper === 'PREPAGO_PEDIDOSYA') {
              await savePrepaymentForApp('PEDIDOSYA', payment.amount, fechaCaja);
            } else if (methodUpper.includes('PREPAGO RAPPI') || methodUpper === 'PREPAGO_RAPPI') {
              await savePrepaymentForApp('RAPPI', payment.amount, fechaCaja);
            }
          } catch (prepError) {
            console.error('[VENTA MOSTRADOR] error prepago:', prepError);
          }
        }
      }

      // FACTURACIÓN — UNA sola entrada, en UNA sola cola, por el TOTAL COMPLETO.
      // Si el comprobante decidido es REMITO no se escribe NADA en ninguna cola
      // fiscal: es lo que evita que la misma venta salga facturada y con FCX.
      // La cola ya quedó resuelta y validada antes de guardar la venta.
      tb = Date.now();
      try {
        if (decision.comprobante !== COMPROBANTE_FACTURA) {
          console.log(`[VENTA MOSTRADOR] no se factura (${decision.motivo}) — va a remito`);
        } else {
          // Revalida: esto corre en background, potencialmente mucho después
          // de que arrancó la venta — si el local cambió, se aborta acá.
          const bgDb = op.getDatabaseOrAbort();
          await saveCounterSaleToFacturacion(bgDb, LOCAL_ID, saleId, saleWithTimestamp, decision.encolado);
          console.log(`[VENTA MOSTRADOR] guardar facturación: ${Date.now() - tb} ms`);
        }
      } catch (facError) {
        console.error('[VENTA MOSTRADOR] error facturación:', facError);
      }

      // REMITO (FCX) — comprobante de la venta que NO se factura.
      //
      // Va acá y no en la ruta crítica porque la venta YA está guardada en
      // MOSTRADOR: el remito es el comprobante de esa venta, no la venta. Es
      // idempotente (marca MOSTRADOR/{id}/remito), así que reintentar no emite
      // un segundo comprobante, y no toca stock, caja, comisiones ni
      // estadísticas: de eso ya se encargaron los pasos de arriba.
      tb = Date.now();
      try {
        const remito = await emitirRemitoDeVenta(saleWithTimestamp, { canal: 'mostrador' });
        if (remito.estado === 'emitido') {
          console.log(`[VENTA MOSTRADOR] remito ${remito.numeroComprobante}: ${Date.now() - tb} ms`);
        } else if (remito.estado === 'error' || remito.estado === 'sin-local') {
          console.error(`[VENTA MOSTRADOR] no se pudo emitir el remito (${remito.estado}): ${remito.motivo}`);
        }
      } catch (remitoError) {
        console.error('[VENTA MOSTRADOR] error remito:', remitoError);
      }

      tb = Date.now();
      try {
        await saveSaleToAccountSummary({ numeroPedido: saleId, valor: saleData.total, tipo: 'Mostrador' });
        console.log(`[VENTA MOSTRADOR] registrar comisión: ${Date.now() - tb} ms`);
      } catch (e) {
        console.warn('[VENTA MOSTRADOR] error comisión:', e);
      }

      if (saleWithTimestamp.items && saleWithTimestamp.fechacaja) {
        tb = Date.now();
        try {
          await updateStatistics(saleWithTimestamp.items, saleWithTimestamp.fechacaja);
          console.log(`[VENTA MOSTRADOR] actualizar estadísticas: ${Date.now() - tb} ms`);
        } catch (e) {
          console.error('[VENTA MOSTRADOR] error estadísticas:', e);
        }
      }

      console.log(`[VENTA MOSTRADOR] background completo — total desde inicio: ${Date.now() - t0} ms`);
    };

    runBackground().catch(e => console.error('[VENTA MOSTRADOR] error inesperado en background:', e));

    // `stockResult` viaja con la venta: la pantalla puede distinguir una venta
    // completa de una que quedó con el descuento pendiente.
    //
    // `comprobanteEncolado` NO se persiste (no está en saleWithTimestamp): sólo
    // se devuelve para que la pantalla sepa en qué cola fiscal esperar el CAE.
    return { ...saleWithTimestamp, id: saleId, stockResult, comprobanteEncolado: decision.encolado || null };
  } catch (error) {
    console.error('[VENTA MOSTRADOR] error crítico guardando venta:', error);
    throw error;
  }
};

export const cancelCounterSale = async (sale, shift) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();

  const saleRef = ref(db, `${LOCAL_ID}/MOSTRADOR/${sale.id}`);
  await update(saleRef, { status: 'CANCELADO' });

  // REVERSIÓN DE STOCK — única autoridad (Fase 2, punto 11).
  //
  // Antes se usaba restoreStockForItem + bulkUpdateStock, que no tenía
  // referenceId: una segunda cancelación (o un reintento tras un error de red)
  // reponía el stock por segunda vez. Ahora la reversión es idempotente, va
  // bajo REVERSAL_MOSTRADOR_{saleId}, incluye artículo base, hijos de promoción
  // y opcionales de departamento, y se apoya en lo que cada recurso registró
  // haber recibido en lugar de reconstruirlo desde la venta.
  //
  // Los dos caminos NO conviven: el viejo quedó eliminado de este flujo.
  try {
    const resultado = await reverseStockForCounterSale(sale);
    if (resultado.estado === 'already-reversed') {
      console.warn(`[mostrador] la venta ${sale.id} ya había repuesto stock: no se repone otra vez.`);
    } else if (resultado.estado === 'original-not-applied') {
      console.warn(`[mostrador] la venta ${sale.id} no había descontado stock: no hay nada que reponer.`);
    } else if (resultado.estado === 'reversal-partial') {
      console.warn(`[mostrador] la reversión de la venta ${sale.id} quedó incompleta`, resultado.resultados);
    }
  } catch (stockError) {
    console.error("Error restoring stock for cancelled sale:", stockError);
    throw new Error("Error al restaurar el stock.");
  }

  try {
    const expenseConcept = `Nota de Credito N° ${sale.id}`;
    const expenseAmount = sale.total;

    let expensePaymentMethod = 'electronico';
    if (sale.payments && sale.payments.length > 0) {
      const hasEfectivo = sale.payments.some(p => p.method.toLowerCase() === 'efectivo');
      if (hasEfectivo) {
        expensePaymentMethod = 'efectivo';
      }
    }

    const expenseData = {
      concepto: expenseConcept,
      monto: expenseAmount,
      paymentMethod: expensePaymentMethod,
      timestamp: new Date().toISOString(),
      empleado: 'Sistema',
    };

    await addExpenseToShift(shift, expenseData);
  } catch (expenseError) {
    console.error("Error creating expense for cancelled sale:", expenseError);
    throw new Error("Error al crear la nota de crédito.");
  }

  // Revertir comisión y totales del resumen de cuenta
  // fechacaja viene en formato dd-mm-yyyy → convertir a yyyy-mm-dd para RESUMEN_CUENTA
  let dateKey = null;
  if (sale.fechacaja) {
    const parts = sale.fechacaja.split('-');
    if (parts.length === 3) {
      dateKey = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  try {
    await reversarVentaCuenta({
      numeroPedido: sale.id,
      valor: sale.total,
      tipo: 'Mostrador',
      dateKey,
    });
  } catch (err) {
    console.error('[VENTA IMPACTO] Error al reversar comisión por cancelación mostrador:', err);
  }

  try {
    await cancelarComision(String(sale.id));
  } catch (err) {
    console.error('[COMISION] Error al cancelar registro de comisión:', err);
  }

  console.log(`[VENTA IMPACTO] id=${sale.id} estado=CANCELADO impactaCaja=false impactaStock=false generaComision=false → revertido`);

  return { success: true };
};

export const fetchCounterSalesForShift = async (shift, limit) => {
  if (!shift || !shift.id || !shift.date) return [];
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  const salesRef = ref(db, `${LOCAL_ID}/MOSTRADOR`);

  try {
    const snapshot = await get(salesRef);
    if (snapshot.exists()) {
      const allSales = snapshot.val();
      const salesData = Object.values(allSales).filter(sale => sale.turno === shift.id);
      
      const getSortableTime = (hora) => {
        if (!hora) return 0;
        const [h, m, s] = hora.split(':').map(Number);
        const hours = h < 6 ? h + 24 : h; 
        return hours * 3600 + m * 60 + s;
      };

      const sortedSales = salesData.sort((a, b) => {
        const timeA = getSortableTime(a.hora);
        const timeB = getSortableTime(b.hora);
        return timeB - timeA;
      });
      
      if (limit) {
        return sortedSales.slice(0, limit);
      }
      
      return sortedSales;
    }
    return [];
  } catch (error) {
    console.error("Error fetching counter sales for shift:", error);
    throw error;
  }
};
