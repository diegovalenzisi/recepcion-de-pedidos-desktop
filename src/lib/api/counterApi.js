
import { getDatabase, ref, runTransaction, get, update, set } from 'firebase/database';
import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { saveSaleToAccountSummary, reversarVentaCuenta } from '@/lib/api/myAccountApi';
import { cancelarComision } from '@/lib/api/comisionesApi';
import { processStockForCounterSale, reverseStockForCounterSale } from '@/lib/api/transactionsApi';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { calcularVentaCostoGanancia } from '@/lib/api/ventaUtils';
import { saveFacturacionForPayments } from './ordersApi';
import { updateStatistics } from './salesApi';
import { addExpenseToShift } from './expensesApi';
import { savePrepaymentForApp } from '@/lib/api/prepaymentApi';

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

const getFacturacionNodeForPayment = (paymentMethod) => {
  const methodName = paymentMethod.toLowerCase();
  if (methodName.includes('transferencia 3')) return 'FACTURACION_3';
  if (methodName.includes('transferencia 2')) return 'FACTURACION_2';
  if (methodName.includes('transferencia')) return 'FACTURACION_1';
  return null;
};

const saveCounterSaleToFacturacion = async (db, localId, saleId, saleData) => {
  const paymentDetails = saleData.payments || [];
  
  const productos = {};
  (saleData.items || []).forEach((item, index) => {
    productos[`producto_${index + 1}`] = {
      nombre: item.nombre,
      valor: item.valor || 0
    };
  });

  const now = new Date();
  const facturaData = {
    clientes: "consumidor final",
    direccion: "  ",
    producto: productos,
    fecha: saleData.date || formatDateForFirebase(now),
    hora: saleData.hora || now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  const prefixedSaleId = `M${saleId}`;

  // Handle split payments - check each payment
  if (paymentDetails.length > 0) {
    for (const payment of paymentDetails) {
      const facturacionNode = getFacturacionNodeForPayment(payment.method);
      if (facturacionNode) {
        try {
          const paymentFacturaData = { ...facturaData, total: payment.amount };
          const facturacionRef = ref(db, `${localId}/${facturacionNode}/${prefixedSaleId}`);
          await set(facturacionRef, paymentFacturaData);
        } catch (error) {
          console.error(`Error saving to ${facturacionNode} for counter sale ${saleId}:`, error);
        }
      }
    }
  }
};

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
  const op = beginFirebaseOperation(LOCAL_ID);
  const db = op.getDatabaseOrAbort();

  try {
    // ── FASE 1: Ruta crítica — bloquea UI hasta completar ─────────────────
    let t = Date.now();
    const saleId = await getNextCounterSaleId(db, LOCAL_ID);
    console.log(`[VENTA MOSTRADOR] obtener ID: ${Date.now() - t} ms`);

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
      emiteFactura:    saleData.emiteFactura || false,
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
    console.log(`[VENTA MOSTRADOR] ruta crítica total: ${Date.now() - t0} ms — liberando pantalla`);

    // ── FASE 2: Background — NO bloquea la UI ─────────────────────────────
    // Stock, facturación, comisiones y estadísticas corren en segundo plano.
    // La venta ya está guardada de forma segura en Firebase antes de llegar aquí.
    const runBackground = async () => {
      let tb;

      tb = Date.now();
      try {
        await processStockForCounterSale(saleWithTimestamp);
        console.log(`[VENTA MOSTRADOR] descontar stock: ${Date.now() - tb} ms`);
      } catch (e) {
        console.error('[VENTA MOSTRADOR] error stock:', e);
      }

      if (saleData.payments && saleData.payments.length > 0) {
        tb = Date.now();
        for (const payment of saleData.payments) {
          try {
            const methodUpper = payment.method.toUpperCase();
            if (methodUpper.includes('PREPAGO PEDIDOSYA') || methodUpper === 'PREPAGO_PEDIDOSYA') {
              await savePrepaymentForApp('PEDIDOSYA', payment.amount);
            } else if (methodUpper.includes('PREPAGO RAPPI') || methodUpper === 'PREPAGO_RAPPI') {
              await savePrepaymentForApp('RAPPI', payment.amount);
            }
          } catch (prepError) {
            console.error('[VENTA MOSTRADOR] error prepago:', prepError);
          }
        }
      }

      tb = Date.now();
      try {
        if (saleData.emiteFactura) {
          const facturacionData = {
            client: { name: 'Consumidor Final', address: 'Sin Datos' },
            items: saleData.items,
            payment: { total: saleData.total, payments: saleData.payments },
            emiteFactura: true,
            date: formattedDate,
            hora: formattedTime,
          };
          await saveFacturacionForPayments(saleId, facturacionData, 'mostrador');
          console.log(`[VENTA MOSTRADOR] guardar facturación: ${Date.now() - tb} ms`);
        } else {
          const hasTransferencia = saleData.payments && saleData.payments.some(
            p => p.method.toLowerCase().includes('transferencia')
          );
          if (hasTransferencia) {
            // Revalida: esto corre en background, potencialmente mucho después
            // de que arrancó la venta — si el local cambió, se aborta acá.
            const bgDb = op.getDatabaseOrAbort();
            await saveCounterSaleToFacturacion(bgDb, LOCAL_ID, saleId, saleWithTimestamp);
            console.log(`[VENTA MOSTRADOR] guardar facturación transferencia: ${Date.now() - tb} ms`);
          }
        }
      } catch (facError) {
        console.error('[VENTA MOSTRADOR] error facturación:', facError);
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

    return { ...saleWithTimestamp, id: saleId };
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
