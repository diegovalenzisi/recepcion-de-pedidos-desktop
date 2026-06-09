
import { getDatabase, ref, onValue, set, get, runTransaction, update, push } from 'firebase/database';
import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { saveSaleToAccountSummary } from '@/lib/api/myAccountApi';
import { fetchFavoriteAccount } from '@/lib/api/accountsApi';
import { formatDateForFirebase, getOperationalDate } from '@/lib/utils';
import { processStockForDeliveredOrder } from './transactionsApi'; 
import { checkOpenShift } from '@/lib/api/cash/shift';

export const validateStatusChange = (currentStatus, newStatus) => {
  if (newStatus === 'ENTREGADO' && currentStatus !== 'EN DELIVERY') {
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
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/pedidos`);
    const ordersRef = ref(db, `${LOCAL_ID}/PEDIDOS`);

    try {
        const ordersSnapshot = await get(ordersRef);
        const ordersData = ordersSnapshot.val();

        if (ordersData) {
            const maxIdInOrders = Object.keys(ordersData)
                .map(id => parseInt(id, 10))
                .filter(id => !isNaN(id))
                .reduce((max, id) => Math.max(max, id), 0);

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
    const LOCAL_ID = getCurrentLocalId();
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
          .sort((a, b) => b.id - a.id);
        
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

const formatOrderItemsForFirebase = (items) => {
  return items.map(item => {
    const { uniqueId, ...itemToSave } = item;

    if (itemToSave.isPromo && itemToSave.promoDetails) {
      const promoItems = itemToSave.promoDetails.map(promoItem => {
        const formattedPromoItem = {
          nombre: promoItem.nombre,
          cantidad: promoItem.cantidad,
        };
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
    const LOCAL_ID = getCurrentLocalId();
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
  const LOCAL_ID = getCurrentLocalId();
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

    let calculatedCostoTotal = 0;
    if (formattedItems && Array.isArray(formattedItems)) {
        calculatedCostoTotal = formattedItems.reduce((sum, item) => {
            const qty = Number(item.cantidad) || Number(item.quantity) || 1;
            const unitCost = Number(item.costoTotalReceta) || Number(item.costoUnitario) || 0;
            return sum + (qty * unitCost);
        }, 0);
    }
    calculatedCostoTotal = Math.round(calculatedCostoTotal * 1000) / 1000;

    const finalOrderData = {
      ...orderData,
      date: formatDateForFirebase(now),
      fechacaja: fechaCaja,
      hora: orderData.hora || null, 
      items: formattedItems,
      CostoTotal: calculatedCostoTotal,
      payment: finalPayment,
      status: {
        main: mainStatus,
        sub: subStatus,
        acknowledged: false
      },
      turno: shift?.id || null,
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
    const LOCAL_ID = getCurrentLocalId();
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
  const LOCAL_ID = getCurrentLocalId();
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
      const validation = validateStatusChange(currentStatus, newStatus);
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
      let calculatedCostoTotal = 0;
      updatePayload.items.forEach(item => {
          const qty = Number(item.cantidad) || Number(item.quantity) || 1;
          const unitCost = Number(item.costoTotalReceta) || Number(item.costoUnitario) || 0;
          calculatedCostoTotal += (qty * unitCost);
      });
      updatePayload.CostoTotal = Math.round(calculatedCostoTotal * 1000) / 1000;
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
    const LOCAL_ID = getCurrentLocalId();
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
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  try {
    const ordersRef = ref(db, `${LOCAL_ID}/PEDIDOS`);
    const snapshot = await get(ordersRef);
    const data = snapshot.val();

    if (!data) return [];
    return Object.keys(data)
      .map(key => ({ ...data[key], id: key }))
      .sort((a, b) => b.id - a.id);
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
    const LOCAL_ID = getCurrentLocalId();
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
    const methodRef = ref(db, `${localId}/PEDIDOS/${orderId}/paid/method`);
    const snapshot = await get(methodRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching payment method for order:", error);
    return null;
  }
};
