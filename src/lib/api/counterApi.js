
import { getDatabase, ref, runTransaction, get, update, set } from 'firebase/database';
import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { saveSaleToAccountSummary } from '@/lib/api/myAccountApi';
import { restoreStockForItem, bulkUpdateStock, fetchAllStockableItems } from '@/lib/api/stockApi';
import { processStockForCounterSale } from '@/lib/api/transactionsApi';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
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
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const db = getDatabase();
  
  try {
    const saleId = await getNextCounterSaleId(db, LOCAL_ID);
    
    const now = new Date();
    const fechaCaja = formatDateForFirebase(getOperationalDate(now));
    const formattedDate = formatDateForFirebase(now);

    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const formattedTime = `${hours}:${minutes}:${seconds}`;

    let calculatedCostoTotal = 0;
    if (saleData.items && Array.isArray(saleData.items)) {
        calculatedCostoTotal = saleData.items.reduce((sum, item) => {
            const qty = Number(item.cantidad) || Number(item.quantity) || 1;
            const unitCost = Number(item.costoTotalReceta) || Number(item.costoUnitario) || 0;
            return sum + (qty * unitCost);
        }, 0);
    }
    calculatedCostoTotal = Math.round(calculatedCostoTotal * 1000) / 1000;

    const saleWithTimestamp = { 
      items: saleData.items,
      total: saleData.total,
      CostoTotal: calculatedCostoTotal,
      payment: {
        total: saleData.total,
        details: saleData.payments,
        payments: saleData.payments,
      },
      payments: saleData.payments,
      specialDiscount: saleData.specialDiscount || null,
      emiteFactura: saleData.emiteFactura || false,
      timestamp: formattedDate,
      date: formattedDate,
      hora: formattedTime,
      id: saleId,
      turno: shift?.id || null,
      fechacaja: fechaCaja,
      client: { name: 'Consumidor Final' },
      status: 'COMPLETADO'
    };

    const url = `${FIREBASE_URL}/${LOCAL_ID}/MOSTRADOR/${saleId}.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saleWithTimestamp),
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    // Deduct stock using the centralized transaction processing
    try {
      await processStockForCounterSale(saleWithTimestamp);
    } catch (stockError) {
      console.error("Error deducting stock for counter sale:", stockError);
    }
    
    // Process App Prepayments automatically if used as payment methods
    if (saleData.payments && saleData.payments.length > 0) {
      for (const payment of saleData.payments) {
        try {
          const methodUpper = payment.method.toUpperCase();
          if (methodUpper.includes('PREPAGO PEDIDOSYA') || methodUpper === 'PREPAGO_PEDIDOSYA') {
            await savePrepaymentForApp('PEDIDOSYA', payment.amount);
          } else if (methodUpper.includes('PREPAGO RAPPI') || methodUpper === 'PREPAGO_RAPPI') {
            await savePrepaymentForApp('RAPPI', payment.amount);
          }
        } catch (prepError) {
          console.error("Error saving automatic app prepayment:", prepError);
        }
      }
    }
    
    // Save to FACTURACION nodes based on payment methods
    if (saleData.emiteFactura) {
      const facturacionData = {
        client: { name: 'Consumidor Final', address: 'Sin Datos' },
        items: saleData.items,
        payment: {
          total: saleData.total,
          payments: saleData.payments
        },
        emiteFactura: true,
        date: formattedDate,
        hora: formattedTime
      };
      await saveFacturacionForPayments(saleId, facturacionData, 'mostrador');
    } else {
      // Check if any payment is a transferencia and save to appropriate FACTURACION node
      const hasTransferencia = saleData.payments && saleData.payments.some(p => 
        p.method.toLowerCase().includes('transferencia')
      );
      
      if (hasTransferencia) {
        await saveCounterSaleToFacturacion(db, LOCAL_ID, saleId, saleWithTimestamp);
      }
    }
    
    try {
      await saveSaleToAccountSummary({
        numeroPedido: saleId,
        valor: saleData.total,
        tipo: 'Mostrador'
      });
    } catch (reportError) {
      console.warn("Failed to update account summary after counter sale:", reportError);
    }
    
    // Update statistics
    if (saleWithTimestamp.items && saleWithTimestamp.fechacaja) {
      await updateStatistics(saleWithTimestamp.items, saleWithTimestamp.fechacaja);
    }

    const responseData = await response.json();
    return { ...responseData, id: saleId };
  } catch (error) {
    console.error("Error saving counter sale:", error);
    throw error;
  }
};

export const cancelCounterSale = async (sale, shift) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();

  const saleRef = ref(db, `${LOCAL_ID}/MOSTRADOR/${sale.id}`);
  await update(saleRef, { status: 'CANCELADO' });

  try {
    const allStockData = await fetchAllStockableItems();
    const stockUpdates = {};
    const affectedItems = new Set();
    for (const item of sale.items) {
      await restoreStockForItem(item, item.quantity, allStockData, stockUpdates, affectedItems);
    }
    if (Object.keys(stockUpdates).length > 0) {
      await bulkUpdateStock(stockUpdates);
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

  return { success: true };
};

export const fetchCounterSalesForShift = async (shift, limit) => {
  if (!shift || !shift.id || !shift.date) return [];
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
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
