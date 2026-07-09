
import { getDatabase, ref, onValue, set, get, runTransaction, update, push, query, orderByKey, limitToLast } from 'firebase/database';
import { getFirebaseUrl, getCurrentDatabasePath, getLocationSpecificDatabasePath, checkLocalId } from '@/lib/firebase/core';
import { saveSaleToAccountSummary } from '@/lib/api/myAccountApi';
import { fetchFavoriteAccount } from '@/lib/api/accountsApi';
import { formatDateForFirebase, getOperationalDate } from '@/lib/utils';
import { calcularVentaCostoGanancia } from '@/lib/api/ventaUtils';
import { processStockForDeliveredOrder } from './transactionsApi';
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
    const db = getDatabase();
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
  return items.map(item => {
    const { uniqueId, ...itemToSave } = item;

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
              formattedOptionals[groupId] = optionals.map(op => ({
                nombre: op.nombre,
              }));
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
  const db = getDatabase();
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

const getFacturacionNodeForPayment = (paymentMethod) => {
    const methodName = paymentMethod.toLowerCase();
    if (methodName.includes('transferencia 3')) return 'FACTURACION_3';
    if (methodName.includes('transferencia 2')) return 'FACTURACION_2';
    if (methodName.includes('transferencia')) return 'FACTURACION_1';
    return null;
};

export const saveFacturacionForPayments = async (orderId, orderData, saleType) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();

    const paymentDetails = orderData.payment?.payments || [];
    const mainPaymentMethod = orderData.payment?.method;

    const getPrefixedOrderId = (id) => {
        if (saleType === 'delivery') return `D${id}`;
        if (saleType === 'mostrador') return `M${id}`;
        return id;
    };

    const productos = {};
    (orderData.items || []).forEach((item, index) => {
        productos[`producto_${index + 1}`] = {
            nombre: item.nombre,
            valor: item.valor || 0
        };
    });

    const now = new Date();
    const facturaData = {
        clientes: orderData.client?.name || 'Consumidor Final',
        direccion: orderData.client?.address || 'Sin Datos',
        producto: productos,
        fecha: orderData.date || formatDateForFirebase(now),
        hora: orderData.times?.ingress || now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    if (orderData.emiteFactura) {
        const favoriteAccount = await fetchFavoriteAccount();
        const favoriteAccountName = favoriteAccount?.nombre || null;
        if (favoriteAccountName) {
            const facturacionNode = getFacturacionNodeForPayment(favoriteAccountName);
            if (facturacionNode) {
                try {
                    const finalOrderId = getPrefixedOrderId(orderId);
                    const facturacionRef = ref(db, `${LOCAL_ID}/${facturacionNode}/${finalOrderId}`);
                    const totalToSave = typeof orderData.payment.total === 'number' ? orderData.payment.total : 0;
                    await set(facturacionRef, { ...facturaData, total: totalToSave });
                } catch (error) {
                    console.error(`Error saving to favorite account ${facturacionNode} for order ${orderId}:`, error);
                }
            }
        }
        return; 
    }

    if (paymentDetails.length > 0) {
        for (const payment of paymentDetails) {
            const facturacionNode = getFacturacionNodeForPayment(payment.method);
            if (facturacionNode) {
                try {
                    const finalOrderId = getPrefixedOrderId(orderId);
                    const paymentFacturaData = { ...facturaData, total: payment.amount };
                    const facturacionRef = ref(db, `${LOCAL_ID}/${facturacionNode}/${finalOrderId}`);
                    await set(facturacionRef, paymentFacturaData);
                } catch (error) {
                    console.error(`Error saving to ${facturacionNode} for order ${orderId}:`, error);
                }
            }
        }
    } else if (mainPaymentMethod) {
        const facturacionNode = getFacturacionNodeForPayment(mainPaymentMethod);
        if (facturacionNode) {
            try {
                const finalOrderId = getPrefixedOrderId(orderId);
                const totalToSave = typeof orderData.payment.total === 'number' ? orderData.payment.total : 0;
                const paymentFacturaData = { ...facturaData, total: totalToSave };
                const facturacionRef = ref(db, `${LOCAL_ID}/${facturacionNode}/${finalOrderId}`);
                await set(facturacionRef, paymentFacturaData);
            } catch (error) {
                console.error(`Error saving to ${facturacionNode} for order ${orderId}:`, error);
            }
        }
    }
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
  const db = getDatabase();
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
    
    if (newStatus === 'ENTREGADO' && currentStatus !== 'ENTREGADO') {
      const validation = validateStatusChange(currentStatus, newStatus, dataBefore.type);
      if (!validation.isValid) {
        console.error(`[Audit] Invalid status change attempt for order ${orderId}: ${currentStatus} -> ${newStatus}`);
        throw new Error(validation.message);
      }
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
    
    await update(orderRef, sanitizedPayload);

    const orderSnapshot = await get(orderRef);
    const orderData = orderSnapshot.val();
    
    let stockResult = null;
    
    if (orderData) {
        const isEntregadoTarget = 
            dataToUpdate['status/main'] === 'ENTREGADO' || 
            dataToUpdate?.status?.main === 'ENTREGADO' || 
            orderData.status?.main === 'ENTREGADO';
        
        if (!wasEntregado && isEntregadoTarget) {
            await saveFacturacionForPayments(orderId, orderData, 'delivery');
            
            try {
                stockResult = await processStockForDeliveredOrder(orderData);
            } catch (stockError) {
                 console.warn("Failed to process stock for delivered order.", stockError);
                 stockResult = { success: false, error: stockError.message };
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
    return Object.keys(data)
      .map(key => ({ ...data[key], id: key }))
      .sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));
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
