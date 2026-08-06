
import { getDatabase, ref, onValue, set, get, runTransaction, update, push, query, orderByKey, limitToLast } from 'firebase/database';
import { getFirebaseUrl, getCurrentDatabasePath, getLocationSpecificDatabasePath, checkLocalId, getCurrentDatabaseOrThrow, beginFirebaseOperation } from '@/lib/firebase/core';
import { saveSaleToAccountSummary } from '@/lib/api/myAccountApi';
import { formatDateForFirebase, getOperationalDate } from '@/lib/utils';
import { calcularVentaCostoGanancia } from '@/lib/api/ventaUtils';
import { construirLineaPersistible, enriquecerOpcionalSnapshot } from '@/lib/api/optionalsPricing';
import { normalizarPedidosRecibidos } from '@/lib/api/ordersIngest';
import { processStockForDeliveredOrder } from './transactionsApi';
import { emitirRemitoDeVenta } from '@/lib/api/remitosApi';
import { resolverComprobanteDeVenta } from '@/lib/api/facturaORemitoApi';
import { describirFormaPago, listarPagos } from '@/lib/api/remitos';
import { checkOpenShift } from '@/lib/api/cash/shift';

export const validateStatusChange = (currentStatus, newStatus, orderType) => {
  if (newStatus === 'ENTREGADO' && currentStatus !== 'EN DELIVERY') {
    // Pedidos de retiro no necesitan pasar por EN DELIVERY ni tener repartidor asignado
    if (orderType === 'RETIRO') {
      return { isValid: true, message: "" };
    }
    return {
      isValid: false,
      message: "Solo pedidos EN DELIVERY pueden marcarse como ENTREGADO"
    };
  }
  return { isValid: true, message: "" };
};

export const extractOrderDataForWhatsApp = (order) => {
  if (!order) return null;
  
  const client = order.client || order.cliente || {};
  const items = order.items || order.articulos || [];
  
  return {
    clientName: client.name || client.nombre || 'Cliente',
    clientPhone: client.phone || client.telefono || '',
    orderNumber: order.id || order.numero || '',
    items: items.map(item => ({
      quantity: item.cantidad || item.quantity || 1,
      name: item.nombre || item.articulo?.nombre || item.name || 'Articulo',
      price: item.valor || item.precio || item.price || 0
    })),
    totalPrice: order.payment?.total || order.payment?.amount || order.total || 0,
    paymentMethod: order.payment?.method || order.paid?.method || order.metodoPago || (order.pagos && order.pagos.length > 0 ? order.pagos[0].method : 'Efectivo'),
    deliveryAddress: client.address || client.direccion || ''
  };
};

// Helper function to format invoice data for FACTURACION_EFECTIVO
export const formatInvoiceData = (orderData, invoiceNumber = null) => {
    const total = orderData.payment?.total || orderData.payment?.amount || orderData.total || 0;
    const subtotal = total / 1.21;
    const iva = total - subtotal;

    return {
        invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
        date: new Date().toISOString(),
        client: {
            name: orderData.client?.name || 'Consumidor Final',
            rut: orderData.client?.rut || '',
            phone: orderData.client?.phone || ''
        },
        items: (orderData.items || []).map(item => ({
            name: item.nombre || 'Articulo',
            quantity: item.cantidad || 1,
            unitPrice: item.valor || 0,
            subtotal: (item.cantidad || 1) * (item.valor || 0)
        })),
        subtotal: Number(subtotal.toFixed(2)),
        iva: Number(iva.toFixed(2)),
        total: Number(total.toFixed(2)),
        paymentMethod: orderData.payment?.method || 'Efectivo',
        seller: orderData.seller || 'Sistema'
    };
};

const syncOrderCounter = async () => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();
    const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/pedidos`);
    const ordersRef = ref(db, `${LOCAL_ID}/PEDIDOS`);

    try {
        // Lee solo el último pedido (por clave) en lugar de todos los pedidos.
        // Firebase RTDB ordena claves enteras numéricamente, así que limitToLast(1)
        // devuelve el pedido con el ID más alto — O(1) en lugar de O(n).
        const lastOrderQuery = query(ordersRef, orderByKey(), limitToLast(1));
        const snapshot = await get(lastOrderQuery);

        if (snapshot.exists()) {
            const maxIdInOrders = Math.max(
                ...Object.keys(snapshot.val())
                    .map(id => parseInt(id, 10))
                    .filter(id => !isNaN(id))
            );

            await runTransaction(counterRef, (currentValue) => {
                const currentCounter = currentValue || 0;
                if (maxIdInOrders > currentCounter) {
                    return maxIdInOrders;
                }
                return currentValue;
            });
        }
    } catch (error) {
        console.error("Error synchronizing order counter:", error);
    }
};

export const listenToOrders = (callback, errorCallback) => {
  try {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getCurrentDatabaseOrThrow();
    const ordersRef = ref(db, `${LOCAL_ID}/PEDIDOS`);

    const unsubscribe = onValue(ordersRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const ordersArray = Object.keys(data)
          .map(key => {
            const order = { ...data[key], id: key };
            if (order.payment && typeof order.payment.total === 'undefined') {
              order.payment.total = order.payment.amount;
            }
            return order;
          })
          .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
        
        callback(ordersArray);
      } else {
        callback([]);
      }
    }, (error) => {
      console.error("🔥 [CRITICAL] Error listening to orders from Firebase:", error);
      if (errorCallback) {
        errorCallback(error);
      }
    });

    return unsubscribe;
  } catch (error) {
    console.error("🔥 [CRITICAL] Error setting up Firebase listener:", error);
    if (errorCallback) {
      errorCallback(error);
    }
    return () => {};
  }
};

// TEMPORAL: log de diagnóstico para el bug de promos "3x2 cuartos".
// Solo se activa en desarrollo o si se setea manualmente:
//   localStorage.setItem('DEBUG_PROMOS', '1'); location.reload();
// Para desactivar: localStorage.removeItem('DEBUG_PROMOS'); location.reload();
const isDebugPromosEnabled = () => {
  try {
    return import.meta.env.DEV || localStorage.getItem('DEBUG_PROMOS') === '1';
  } catch {
    return import.meta.env.DEV;
  }
};

const formatOrderItemsForFirebase = (items) => {
  return items.map(rawItem => {
    // SNAPSHOT AL CONFIRMAR: se RECALCULA con el módulo centralizado justo antes
    // de persistir, usando las selecciones actuales de la línea. Nunca se confía
    // en subtotales que hayan quedado en el estado del modal.
    const item = construirLineaPersistible(rawItem, {
      onWarn: (w) => console.warn('[opcionales] importe inválido al guardar', w),
    });
    // `uniqueId` se conserva: identifica cada unidad para poder editarla por
    // separado y evitar que se fusionen unidades con configuraciones distintas.
    const itemToSave = { ...item };

    if (itemToSave.isPromo && itemToSave.promoDetails) {
      const promoItems = itemToSave.promoDetails.map(promoItem => {
        const formattedPromoItem = {
          nombre: promoItem.nombre,
          cantidad: promoItem.cantidad,
        };
        if (promoItem.codigo) {
          formattedPromoItem.codigo = promoItem.codigo;
        }
        if (promoItem.selectedOptionals && Object.keys(promoItem.selectedOptionals).length > 0) {
          const formattedOptionals = {};
          for (const groupId in promoItem.selectedOptionals) {
            const optionals = promoItem.selectedOptionals[groupId];
            if (Array.isArray(optionals) && optionals.length > 0) {
              // ANTES se reducía a { nombre }, perdiendo precio e identidad del
              // opcional de cada hijo de la promo. Ahora se guarda el snapshot
              // completo POR HIJO (nunca en un nivel global del combo), para que
              // impresión, edición y stock puedan asociarlo al producto correcto.
              formattedOptionals[groupId] = optionals
                .map(op => enriquecerOpcionalSnapshot(op, groupId))
                .filter(Boolean);
            }
          }
          if (Object.keys(formattedOptionals).length > 0) {
            formattedPromoItem.selectedOptionals = formattedOptionals;
          }
        }
        return formattedPromoItem;
      });

      if (isDebugPromosEnabled()) {
        console.log(`[DEBUG_PROMOS] Promo "${itemToSave.nombre}" -> ${promoItems.length} item(s)`, {
          promo: itemToSave.nombre,
          cuartos: promoItems.map((p, idx) => ({
            cuarto: idx + 1,
            codigo: p.codigo,
            nombre: p.nombre,
            sabores: p.selectedOptionals || null,
          })),
        });
      }

      delete itemToSave.promoDetails;
      return {
        ...itemToSave,
        promoItems: promoItems,
      };
    }
    return itemToSave;
  });
};

const getNextOrderId = async () => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();
    const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/pedidos`);
    
    await syncOrderCounter();

    const transactionResult = await runTransaction(counterRef, (currentValue) => {
        return (currentValue || 0) + 1;
    });

    if (!transactionResult.committed) {
        throw new Error("No se pudo obtener el siguiente ID de pedido. La transacción falló.");
    }

    return transactionResult.snapshot.val();
};

const saveMostradorDeposit = async (db, localId, shift, orderId, deposit, clientName) => {
    if (!shift || !shift.id || !shift.date) {
        console.warn("Cannot save deposit: invalid shift data.");
        return;
    }

    const now = new Date();
    const mostradorRef = ref(db, `${localId}/MOSTRADOR`);
    const newSaleRef = push(mostradorRef);
    
    const depositSale = {
        fechacaja: shift.date, 
        turno: shift.id,
        hora: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        timestamp: now.toISOString(),
        total: deposit.amount,
        payments: [{ method: deposit.method, amount: deposit.amount }],
        type: 'Seña',
        description: `Seña Pedido #${orderId} - ${clientName || 'Cliente'}`,
        referenceOrder: orderId,
        status: 'COMPLETADO'
    };
    
    await set(newSaleRef, depositSale);
};

export const saveOrder = async (orderData, shift) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  // beginFirebaseOperation() captura local+generación ACÁ, antes de getNextOrderId()
  // (que hace su propia transacción, un await real). getDatabaseOrAbort(), llamado
  // justo antes del set() definitivo más abajo, revalida que el local no haya
  // cambiado en el medio — si cambió, aborta con FirebaseNotReadyError en vez de
  // guardar el pedido en el local viejo (o con datos pensados para otro local).
  const op = beginFirebaseOperation();
  try {
    const newOrderId = await getNextOrderId();

    const formattedItems = formatOrderItemsForFirebase(orderData.items);
    
    const now = new Date();
    const fechaCaja = orderData.fechacaja || formatDateForFirebase(getOperationalDate(now));

    const finalPayment = { ...orderData.payment };
    if (finalPayment.montoAbonado === undefined && finalPayment.paysWith) {
        finalPayment.montoAbonado = finalPayment.paysWith;
    }
    
    const mainStatus = orderData.status?.main || 'ACEPTADO';
    const subStatus = mainStatus === 'COMANDADO' ? 'Esperando confirmación' : (orderData.status?.sub || 'Esperando confirmación');

    // Venta, costo y ganancia de la venta (gestión — no afecta facturación/CAE/PDF)
    const { totalVenta, totalCosto, ganancia } = calcularVentaCostoGanancia(formattedItems);

    const finalOrderData = {
      ...orderData,
      date: formatDateForFirebase(now),
      fechacaja: fechaCaja,
      hora: orderData.hora || null,
      items: formattedItems,
      CostoTotal: totalCosto,
      VentaTotal: totalVenta,
      Ganancia: ganancia,
      payment: finalPayment,
      status: {
        main: mainStatus,
        sub: subStatus,
        acknowledged: false
      },
      turno: shift?.id || null,
      // Campo aditivo: marca el pedido como cargado MANUALMENTE desde el desktop.
      // La alarma de nuevos pedidos no debe sonar para estos (solo para los que
      // llegan desde la web/app de clientes, que no traen este campo). Ver useOrderAlarm.js.
      origen: 'manual',
    };
    
    if (!finalOrderData.times) {
      finalOrderData.times = {
        ingress: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
    } else if (!finalOrderData.times.ingress) {
      finalOrderData.times.ingress = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    const dataToSave = { ...finalOrderData };

    const db = op.getDatabaseOrAbort();
    const orderRef = ref(db, `${LOCAL_ID}/PEDIDOS/${newOrderId}`);
    await set(orderRef, dataToSave);
    
    if (dataToSave.payment && dataToSave.payment.deposit && shift) {
        await saveMostradorDeposit(db, LOCAL_ID, shift, newOrderId, dataToSave.payment.deposit, dataToSave.client?.name);
    }
    
    if (dataToSave.emiteFactura) {
      await saveFacturacionForPayments(newOrderId, dataToSave, 'delivery');
    }

    return { ...dataToSave, id: newOrderId };
  } catch (error) {
    console.error("Error saving order:", error);
    throw error;
  }
};

/**
 * Encola una venta en facturación: UNA entrada, en UNA cola, por el TOTAL
 * COMPLETO. Nunca una factura por medio de pago ni por un importe parcial.
 *
 * La cola sale de la tabla EXACTA de facturaORemito.js (COLAS_POR_CUENTA) y ya
 * viene resuelta y validada en `decision.encolado`.
 *
 * @param {string|number} orderId
 * @param {object} orderData
 * @param {'delivery'|'mostrador'} saleType
 * @param {object} [decision] resultado de resolverComprobanteDeVenta(). Si no se
 *        pasa, se resuelve acá: nunca se factura sin haber consultado el
 *        interruptor "Imprime Factura" de las cuentas cobradas.
 * @throws si la venta debe facturarse y no hay cola determinable.
 */
export const saveFacturacionForPayments = async (orderId, orderData, saleType, decision = null) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation();

    const getPrefixedOrderId = (id) => {
        if (saleType === 'delivery') return `D${id}`;
        if (saleType === 'mostrador') return `M${id}`;
        return id;
    };

    // DETALLE QUE VIAJA A FACTURACIÓN.
    //
    // Hasta ahora se encolaba sólo `{ nombre, valor }`: sin cantidad y sin
    // subtotal. Por eso las facturas emitidas quedaban con renglones que no
    // sumaban el total, y el PDF del motor RI imprimía "producto x undefined".
    //
    // `valor` se mantiene con el mismo significado de siempre (precio unitario)
    // para no romper los motores de facturación ya instalados en las PCs, que
    // leen esa clave. Los campos nuevos se agregan al lado.
    const productos = {};
    (orderData.items || []).forEach((item, index) => {
        const cantidad = Number(item.cantidad) > 0 ? Number(item.cantidad) : 1;
        const unitario = Number(item.precioBaseUnitario ?? item.valor) || 0;
        const opcionales = Number(item.totalOpcionales) || 0;
        const subtotal = Number(item.subtotalLinea ?? item.precioTotal);
        productos[`producto_${index + 1}`] = {
            nombre: item.nombre,
            valor: unitario,
            cantidad,
            precioUnitario: unitario,
            precioTotal: Number.isFinite(subtotal) ? subtotal : unitario * cantidad + opcionales,
            codigo: String(item.codigo ?? item.id ?? ''),
            opcionales,
        };
    });

    const now = new Date();
    const facturaData = {
        clientes: orderData.client?.name || 'Consumidor Final',
        direccion: orderData.client?.address || 'Sin Datos',
        producto: productos,
        fecha: orderData.date || formatDateForFirebase(now),
        hora: orderData.times?.ingress || now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        // Trazabilidad de la venta de origen: el motor la copia al comprobante
        // para que la factura diga de dónde salió y quién la cobró.
        localId: String(LOCAL_ID),
        origen: { tipo: saleType, id: String(orderId), ruta: saleType === 'delivery' ? 'PEDIDOS' : 'MOSTRADOR' },
        formaPago: describirFormaPago(listarPagos(orderData)),
    };

    // La regla vive en facturaORemito.js: el tilde manual o el interruptor
    // "Imprime Factura" de las cuentas cobradas deciden; la cola sale de la
    // tabla exacta. Acá sólo se escribe lo que ya quedó resuelto.
    const resolucion = decision || await resolverComprobanteDeVenta(orderData);
    const encolado = resolucion.encolado;
    if (!encolado || encolado.estado !== 'encolar') return;   // la venta va a remito

    // Revalida: resolverComprobanteDeVenta() pudo haber sido un await real —
    // el local pudo haber cambiado mientras esperaba.
    const freshDb = op.getDatabaseOrAbort();
    const facturacionRef = ref(freshDb, `${LOCAL_ID}/${encolado.cola}/${getPrefixedOrderId(orderId)}`);
    await set(facturacionRef, {
        ...facturaData,
        total: encolado.total,
        // En qué cola entró, es decir CON QUÉ CUENTA FISCAL se factura. El motor
        // lo copia al comprobante: así la factura guardada dice, sin ambigüedad,
        // qué contribuyente la emitió, aunque el punto de venta se repita.
        colaFacturacion: encolado.cola,
        cuentaCobro: encolado.cuenta,
    });
    const emisor = resolucion.emisor;
    console.log(
        `[FACTURACION] ${saleType} ${orderId} → ${encolado.cola} por ${encolado.total} (${encolado.cuenta})` +
        (emisor ? ` — ${emisor.razonSocial} CUIT ${emisor.cuitFormat} pto vta ${emisor.puntoVenta}` : '')
    );
};

const sanitizeUpdatePayload = (payload) => {
    const cleanPayload = { ...payload };
    const keys = Object.keys(cleanPayload);
    
    for (const parentKey of keys) {
        for (const childKey of keys) {
            if (parentKey !== childKey && childKey.startsWith(`${parentKey}/`)) {
                console.warn(`[Firebase Sync] Eliminando ruta conflictiva: ${childKey} (el padre ${parentKey} ya existe en el payload)`);
                delete cleanPayload[childKey];
            }
        }
    }
    return cleanPayload;
};

export const updateOrder = async (orderId, dataToUpdate, currentShift = null) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  // beginFirebaseOperation() captura local+generación acá. Entre esta línea y el
  // update() definitivo más abajo hay varios await reales (lectura del pedido,
  // checkOpenShift(), saveMostradorDeposit()) — getDatabaseOrAbort() revalida
  // justo antes de escribir.
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();
  const orderRef = ref(db, `${LOCAL_ID}/PEDIDOS/${orderId}`);

  try {
    const snapshotBefore = await get(orderRef);
    const dataBefore = snapshotBefore.val();
    
    if (!dataBefore) {
      throw new Error("El pedido no existe.");
    }
    
    const wasEntregado = dataBefore?.status?.main === 'ENTREGADO';
    const currentStatus = dataBefore?.status?.main;
    const newStatus = dataToUpdate['status/main'] || dataToUpdate.status?.main;
    
    // FACTURA o REMITO del pedido que se está entregando. Se resuelve ANTES de
    // escribir el cambio de estado: si el pedido debe facturarse y no hay una
    // cola determinable, esto LANZA y el pedido NO pasa a ENTREGADO. Así el
    // operador ve el error, corrige la configuración de cuentas y reintenta —
    // en vez de quedarse con un pedido entregado sin comprobante, o con un FCX
    // emitido como premio consuelo por una venta que debía facturarse.
    let decisionComprobante = null;
    if (newStatus === 'ENTREGADO' && currentStatus !== 'ENTREGADO') {
      const validation = validateStatusChange(currentStatus, newStatus, dataBefore.type);
      if (!validation.isValid) {
        console.error(`[Audit] Invalid status change attempt for order ${orderId}: ${currentStatus} -> ${newStatus}`);
        throw new Error(validation.message);
      }
      const pagoAlEntregar = dataToUpdate.payment
        ? { ...dataBefore.payment, ...dataToUpdate.payment }
        : dataBefore.payment;
      decisionComprobante = await resolverComprobanteDeVenta(
        { ...dataBefore, payment: pagoAlEntregar },
        { emiteFacturaManual: dataBefore.emiteFactura === true }
      );
    }

    const updatePayload = { ...dataToUpdate };
    
    if (updatePayload.payment) {
        if (updatePayload.payment.montoAbonado === undefined && updatePayload.payment.paysWith) {
             updatePayload.payment.montoAbonado = updatePayload.payment.paysWith;
        }
    }

    if (updatePayload.items) {
      updatePayload.items = formatOrderItemsForFirebase(updatePayload.items);
      const { totalVenta, totalCosto, ganancia } = calcularVentaCostoGanancia(updatePayload.items);
      updatePayload.CostoTotal = totalCosto;
      updatePayload.VentaTotal = totalVenta;
      updatePayload.Ganancia   = ganancia;
    }
    
    if (updatePayload['status/main'] === 'COMANDADO') {
        updatePayload['status/sub'] = 'Esperando confirmación';
    } else if (updatePayload.status && updatePayload.status.main === 'COMANDADO') {
        updatePayload.status.sub = 'Esperando confirmación';
    }
    
    if (typeof updatePayload.hora !== 'undefined') {
        if (updatePayload.hora === null || updatePayload.hora === '') {
            updatePayload.hora = null;
        } else {
            if (updatePayload.hora.length === 5) {
                updatePayload.hora = `${updatePayload.hora}:00`;
            }
        }
    }
    
    if (dataToUpdate.payment?.deposit && !dataBefore?.payment?.deposit) {
        let shiftToUse = currentShift;
        if (!shiftToUse) {
            shiftToUse = await checkOpenShift();
        }
        
        if (shiftToUse) {
            await saveMostradorDeposit(db, LOCAL_ID, shiftToUse, orderId, dataToUpdate.payment.deposit, dataToUpdate.client?.name || dataBefore?.client?.name);
        } else {
            console.warn("Could not save deposit for updated order because no open shift was found.");
        }
    }
    
    const sanitizedPayload = sanitizeUpdatePayload(updatePayload);

    // Revalida justo antes del update() definitivo: si el local cambió durante
    // los awaits de arriba, aborta acá en vez de escribir el cambio de estado
    // en el local equivocado.
    const freshDb = op.getDatabaseOrAbort();
    const freshOrderRef = ref(freshDb, `${LOCAL_ID}/PEDIDOS/${orderId}`);
    await update(freshOrderRef, sanitizedPayload);

    const orderSnapshot = await get(freshOrderRef);
    const orderData = orderSnapshot.val();
    
    let stockResult = null;
    
    if (orderData) {
        const isEntregadoTarget = 
            dataToUpdate['status/main'] === 'ENTREGADO' || 
            dataToUpdate?.status?.main === 'ENTREGADO' || 
            orderData.status?.main === 'ENTREGADO';
        
        if (!wasEntregado && isEntregadoTarget) {
            // UNA sola decisión gobierna los dos caminos: o se encola la factura
            // por el total, o se emite el FCX por el total. Nunca las dos cosas.
            const decision = decisionComprobante || await resolverComprobanteDeVenta(orderData, {
                emiteFacturaManual: orderData.emiteFactura === true,
            });
            const pedidoConDecision = {
                ...orderData,
                id: orderData.id ?? orderId,
                comprobante: decision.comprobante,
                motivoComprobante: decision.motivo,
            };

            // ORDEN DE LA OPERACIÓN: primero el descuento COMERCIAL, después el
            // comprobante. La decisión de emitir factura o remito no puede
            // determinar si se descuenta stock.
            //
            // Antes la facturación iba PRIMERO y sin try/catch: desde que
            // `saveFacturacionForPayments` puede lanzar (una cola fiscal sin
            // CUIT/punto de venta/certificado hace lanzar a
            // resolverComprobanteDeVenta), un error fiscal abortaba el resto del
            // bloque y el pedido quedaba ENTREGADO sin descontar stock ni
            // registrar la comisión — y como `wasEntregado` ya es true, no se
            // reintentaba nunca más.
            //
            // Se le pasa `pedidoConDecision` y no `orderData` porque el nodo
            // guardado de PEDIDOS NO tiene campo `id`: con `orderData` el
            // referenceId salía null y el descuento corría SIN candado, sin
            // marca en PROCESSED_STOCK_IDS y sin idempotencia (verificado en
            // producción: todas las TRANSACCIONES_STOCK de delivery tenían
            // referenceId vacío).
            try {
                stockResult = await processStockForDeliveredOrder(pedidoConDecision);
            } catch (stockError) {
                 console.warn("Failed to process stock for delivered order.", stockError);
                 stockResult = { success: false, error: stockError.message };
            }

            // El error fiscal se guarda y se relanza AL FINAL: el operador tiene
            // que verlo, pero no debe costarle el descuento de stock ni la
            // comisión de una venta que ya está entregada.
            let errorFiscal = null;
            try {
                await saveFacturacionForPayments(orderId, pedidoConDecision, 'delivery', decision);
            } catch (facError) {
                errorFiscal = facError;
                console.error(`[FACTURACION] pedido ${orderId} entregado SIN comprobante:`, facError);
            }

            // REMITO (FCX) del pedido entregado que NO se factura. Idempotente
            // (marca PEDIDOS/{id}/remito): reentregar o reprocesar el mismo
            // pedido no emite un segundo comprobante. No toca stock ni caja.
            try {
                const remito = await emitirRemitoDeVenta(pedidoConDecision, { canal: 'delivery' });
                if (remito.estado === 'error' || remito.estado === 'sin-local') {
                    console.error(`[REMITO] pedido ${orderId} sin remito (${remito.estado}): ${remito.motivo}`);
                }
            } catch (remitoError) {
                console.error(`[REMITO] Error emitiendo el remito del pedido ${orderId}:`, remitoError);
            }

            try {
                let amountForSummary = orderData.payment.total;
                if (orderData.payment.deposit) {
                    amountForSummary -= orderData.payment.deposit.amount;
                }
                
                if (amountForSummary > 0) {
                    await saveSaleToAccountSummary({
                        numeroPedido: orderId,
                        valor: amountForSummary,
                        tipo: 'Delivery'
                    });
                }
            } catch (summaryError) {
                console.warn("Failed to save sale to account summary.", summaryError);
            }

            // Recién acá: stock, comisión y remito ya quedaron aplicados. El
            // operador ve el problema fiscal y puede corregir la configuración
            // de la cola, sin que eso haya costado el descuento de la venta.
            if (errorFiscal) throw errorFiscal;
        }
    }

    return { ...orderData, stockResult };
  } catch (error) {
    console.error(`🔥 [CRITICAL API updateOrder] Error updating order ${orderId}:`, error);
    throw error;
  }
};

export const deleteOrder = async (orderId) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();
    try {
        const orderRef = ref(db, `${LOCAL_ID}/PEDIDOS/${orderId}`);
        await set(orderRef, null);
    } catch (error) {
        console.error("Error deleting order:", error);
        throw error;
    }
};

export const fetchOrders = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  try {
    const ordersRef = ref(db, `${LOCAL_ID}/PEDIDOS`);
    const snapshot = await get(ordersRef);
    const data = snapshot.val();

    if (!data) return [];
    // Los pedidos de este nodo pueden venir del Desktop, de la Tablet o de DLV
    // Pedidos (que corre en el navegador del cliente). No se confía ciegamente
    // en el total recibido: si el snapshot está completo se reconstruye el total
    // canónico y se deja aviso si difiere; si el pedido es histórico, se respeta
    // el total guardado. Misma regla exacta que aplica la Tablet. Solo lectura.
    return normalizarPedidosRecibidos(
      Object.keys(data).map(key => ({ ...data[key], id: key })),
      { onWarn: (w) => console.warn('[pedidos] total recibido inconsistente', w) }
    ).sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
  } catch (error) {
    console.error("Error fetching orders:", error);
    throw error;
  }
};

const searchInMonth = async (localId, orderId, dateObj) => {
    const db = getDatabase();
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    
    try {
        const monthRef = ref(db, `${localId}/BACKUP/${year}/${month}`);
        const snapshot = await get(monthRef);
        
        if (snapshot.exists()) {
            const daysData = snapshot.val();
            for (const day in daysData) {
                const turnos = daysData[day].TURNO;
                if (!turnos) continue;
                
                for (const turnoId in turnos) {
                    const delivery = turnos[turnoId].DELIVERY;
                    if (!delivery) continue;

                    if (delivery.ENTREGADOS && delivery.ENTREGADOS[orderId]) {
                         return { 
                             ...delivery.ENTREGADOS[orderId], 
                             id: orderId, 
                             source: `BACKUP (${day}/${month}/${year})` 
                         };
                    }
                    if (delivery.CANCELADOS && delivery.CANCELADOS[orderId]) {
                         return { 
                             ...delivery.CANCELADOS[orderId], 
                             id: orderId, 
                             source: `BACKUP (${day}/${month}/${year} - Cancelado)` 
                         };
                    }
                }
            }
        }
    } catch (e) {
        console.error(`Error searching backup month ${year}-${month}:`, e);
    }
    return null;
}

export const findOrderGlobal = async (orderId, specificDate = null) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();
    const id = orderId.toString().trim();

    try {
        const activeRef = ref(db, `${LOCAL_ID}/PEDIDOS/${id}`);
        const activeSnapshot = await get(activeRef);
        if (activeSnapshot.exists()) {
            return { ...activeSnapshot.val(), id, source: 'ACTIVO' };
        }
    } catch (e) {
        console.error("Error searching in active orders:", e);
    }

    if (specificDate) {
        return searchInMonth(LOCAL_ID, id, specificDate);
    } 

    const now = new Date();
    for (let i = 0; i < 3; i++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const result = await searchInMonth(LOCAL_ID, id, targetDate);
        if (result) return result;
    }

    return null;
};

export const fetchPaymentMethodForOrder = async (localId, orderId) => {
  if (!localId || !orderId) return null;
  try {
    const db = getDatabase();
    const methodRef = ref(db, `${getLocationSpecificDatabasePath(localId)}/PEDIDOS/${orderId}/paid/method`);
    const snapshot = await get(methodRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching payment method for order:", error);
    return null;
  }
};
