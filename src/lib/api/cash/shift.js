
import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';
import { getDatabase, ref, get, set, remove, update } from 'firebase/database';
import { formatDateForFirebase } from '@/lib/utils';

export const checkOpenShift = async () => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    
    const db = getDatabase();
    const cajasRef = ref(db, `${LOCAL_ID}/CAJAS`);

    try {
        const snapshot = await get(cajasRef);
        if (snapshot.exists()) {
            const allCashData = snapshot.val();
            for (const dateKey in allCashData) {
                const dayData = allCashData[dateKey];
                if (dayData && dayData.turnos) {
                    for (const shiftId in dayData.turnos) {
                        const shiftData = dayData.turnos[shiftId];
                        if (shiftData && shiftData.estado === 'abierto') {
                            return { ...shiftData, id: parseInt(shiftId, 10), date: dateKey };
                        }
                    }
                }
            }
        }
    } catch(e) {
      console.error("Error checking for open shifts", e);
    }
    return null; // No open shift found
};

export const createNewShift = async (initialFund, date) => {
    // First, double-check there isn't an open shift before creating a new one.
    const openShift = await checkOpenShift();
    if (openShift) {
        console.error("Attempted to create a new shift while one is already open.", openShift);
        throw new Error("Ya existe un turno abierto. No se puede crear uno nuevo.");
    }
    
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    const allShiftsUrl = `${API_URL}/${LOCAL_ID}/CONTADORES/turnos.json`;

    let lastShiftNumber = 0;
    try {
        const counterResponse = await fetch(allShiftsUrl);
        if(counterResponse.ok) {
            lastShiftNumber = await counterResponse.json() || 0;
        }
    } catch(e) {
        console.error("Could not fetch last shift number, starting from 0.", e);
    }

    const newShiftNumber = lastShiftNumber + 1;

    const counterUpdateUrl = `${API_URL}/${LOCAL_ID}/CONTADORES/turnos.json`;
    await fetch(counterUpdateUrl, { method: 'PUT', body: JSON.stringify(newShiftNumber) });

    const dateString = formatDateForFirebase(date);
    const newShift = {
        id: newShiftNumber,
        estado: 'abierto',
        fondoInicial: initialFund,
        fechaCaja: dateString,
        aperturaTimestamp: new Date().toISOString(),
        gastos: {},
    };

    const newShiftUrl = `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos/${newShiftNumber}.json`;
    await fetch(newShiftUrl, { method: 'PUT', body: JSON.stringify(newShift) });
    
    return { ...newShift, date: dateString };
};

const BATCH_SIZE = 25;

const backupAndClearOrders = async (shift, progressCallback) => {
    checkLocalId();
    const db = getDatabase();
    const LOCAL_ID = getCurrentDatabasePath();

    const [day, month, year] = shift.date.split('-');
    const backupBasePath = `${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shift.id}`;
    
    const processInBatches = async (path, type, progressPrefix) => {
        const dataRef = ref(db, `${LOCAL_ID}/${path}`);
        const snapshot = await get(dataRef);
        if (!snapshot.exists()) return;

        const allItems = snapshot.val();
        const itemsToProcess = [];

        for (const id in allItems) {
            const item = allItems[id];
            if (item.turno === shift.id && (item.status?.main === 'ENTREGADO' || item.status?.main === 'CANCELADO' || item.status === 'COMPLETADO' || item.status === 'CANCELADO')) {
                itemsToProcess.push({ id, ...item });
            }
        }
        
        if (itemsToProcess.length === 0) return;

        const totalBatches = Math.ceil(itemsToProcess.length / BATCH_SIZE);

        for (let i = 0; i < totalBatches; i++) {
            progressCallback(`${progressPrefix} (lote ${i + 1} de ${totalBatches})...`);
            const batch = itemsToProcess.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
            const updates = {};
            
            batch.forEach(item => {
                let statusFolder;
                const status = item.status?.main || item.status;
                if (status === 'ENTREGADO' || status === 'COMPLETADO') {
                    statusFolder = (type === 'DELIVERY') ? 'ENTREGADOS' : 'COMPLETADOS';
                } else if (status === 'CANCELADO') {
                    statusFolder = 'CANCELADOS';
                }

                if (statusFolder) {
                    updates[`${backupBasePath}/${type}/${statusFolder}/${item.id}`] = item;
                    updates[`${LOCAL_ID}/${path}/${item.id}`] = null;
                }
            });
            
            if (Object.keys(updates).length > 0) {
                await update(ref(db), updates);
            }
        }
    };

    await processInBatches('PEDIDOS', 'DELIVERY', 'Respaldando pedidos de delivery');
    await processInBatches('MOSTRADOR', 'MOSTRADOR', 'Respaldando ventas de mostrador');
};

const backupShiftData = async (shift, closingPayload, progressCallback) => {
    checkLocalId();
    const db = getDatabase();
    const LOCAL_ID = getCurrentDatabasePath();
    const dateString = shift.date || formatDateForFirebase(new Date());

    const shiftRef = ref(db, `${LOCAL_ID}/CAJAS/${dateString}/turnos/${shift.id}`);
    const snapshot = await get(shiftRef);

    if (!snapshot.exists()) {
        console.warn(`No se encontraron datos para el turno ${shift.id} en la fecha ${dateString}. No se puede realizar el backup.`);
        return;
    }

    const shiftDataToBackup = { ...snapshot.val(), ...closingPayload };

    const [day, month, year] = dateString.split('-');
    const backupPath = `${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shift.id}/CAJA`;
    const backupRef = ref(db, backupPath);

    await set(backupRef, shiftDataToBackup);
    await remove(shiftRef);
};

export const closeShift = async (shift, cashCount, sales, pdfBase64, responsible, progressCallback) => {
    checkLocalId();
    const dateString = shift.date || formatDateForFirebase(new Date()); 

    progressCallback('Calculando totales...');
    const totalsByPaymentMethod = sales.reduce((acc, sale) => {
        (sale.payments || []).forEach(payment => {
            acc[payment.method] = (acc[payment.method] || 0) + payment.amount;
        });
        return acc;
    }, {});
    
    const expensesArray = Object.values(shift.gastos || {});
    const totalExpenses = expensesArray.reduce((sum, expense) => sum + (expense?.monto || 0), 0);
    const totalCashExpenses = expensesArray
        .filter(expense => expense && expense.paymentMethod === 'efectivo')
        .reduce((sum, expense) => sum + (expense?.monto || 0), 0);

    const totalElectronicExpenses = expensesArray
        .filter(expense => expense && expense.paymentMethod !== 'efectivo')
        .reduce((sum, expense) => sum + (expense?.monto || 0), 0);

    const safeEntries = Object.values(shift.CAJAFUERTE || {}).filter(Boolean);
    const totalSafe = safeEntries.reduce((sum, entry) => sum + (entry.valor || 0), 0);

    const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);

    const totalCostValue = sales.reduce((sum, sale) => {
      let saleCost = 0;
      if (sale.CostoTotal !== undefined && sale.CostoTotal !== null) {
         saleCost = Number(sale.CostoTotal);
      } else {
         saleCost = (sale.items || []).reduce((itemSum, item) => {
            const qty = item.cantidad || item.quantity || 1;
            const unitCost = item.costoTotalReceta || item.costoUnitario || 0;
            return itemSum + (qty * unitCost);
         }, 0);
      }
      return sum + saleCost;
    }, 0);

    const cashInBox = (shift.fondoInicial || 0) + (totalsByPaymentMethod['Efectivo'] || 0) - totalCashExpenses - totalSafe;
    const difference = cashCount - cashInBox;
    const ganancia = totalSales - totalExpenses - totalCostValue;

    const closingPayload = {
        estado: 'cerrado',
        cierreTimestamp: new Date().toISOString(),
        cierreEfectivoContado: cashCount,
        cierreDiferencia: difference,
        cierreTotalVentas: totalSales,
        cierreTotalGastos: totalExpenses,
        cierreEfectGastos: totalCashExpenses,
        cierreElectGastos: totalsByPaymentMethod['MercadoPago'] || 0,
        cierreElectGastosPagos: totalElectronicExpenses,
        cierreTotalesPorPago: totalsByPaymentMethod,
        cierreResponsable: responsible,
        costoTotal: Math.round(totalCostValue * 1000) / 1000,
        cierreGanancia: Math.round(ganancia * 1000) / 1000
    };

    progressCallback('Respaldando y limpiando pedidos...');
    await backupAndClearOrders(shift, progressCallback);

    progressCallback('Respaldando datos del turno...');
    await backupShiftData(shift, closingPayload, progressCallback);
    
    progressCallback('Cierre completado.');
};
