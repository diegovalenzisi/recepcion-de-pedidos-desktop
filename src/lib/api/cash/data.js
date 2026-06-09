
import { getDatabase, ref, get, query, orderByChild, equalTo, onValue, off } from 'firebase/database';
import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { getOperationalDate, formatDateForFirebase, parseDateString } from '@/lib/utils';

export const getLatestCashRegisterDate = async () => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentLocalId();
    const cashRegisterUrl = `${API_URL}/${LOCAL_ID}/CAJAS.json?shallow=true`;

    try {
        const response = await fetch(cashRegisterUrl);
        if (!response.ok) {
            throw new Error('Could not fetch cash register dates.');
        }
        const data = await response.json();
        if (!data) {
            return formatDateForFirebase(getOperationalDate());
        }

        const dates = Object.keys(data).map(dateStr => parseDateString(dateStr));

        dates.sort((a, b) => b - a);

        if (dates.length > 0) {
            return formatDateForFirebase(dates[0]);
        }
        return formatDateForFirebase(getOperationalDate());
    } catch (error) {
        console.error("Error getting latest cash register date:", error);
        return formatDateForFirebase(getOperationalDate());
    }
};

export const fetchShiftsForDate = async (date) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentLocalId();
    const dateString = formatDateForFirebase(date);
    
    const [day, month, year] = dateString.split('-');

    const urls = [
        `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos.json`,
        `${API_URL}/${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO.json?shallow=true`
    ];

    try {
        const [activeShiftsResponse, backupShiftsResponse] = await Promise.all(urls.map(url => fetch(url)));

        let allShifts = [];

        if (activeShiftsResponse.ok) {
            const data = await activeShiftsResponse.json();
            if (data) {
                const activeShifts = Object.entries(data).map(([id, shiftData]) => ({
                    id: parseInt(id, 10),
                    date: dateString,
                    ...shiftData,
                }));
                allShifts.push(...activeShifts);
            }
        }
        
        if (backupShiftsResponse.ok) {
            const data = await backupShiftsResponse.json();
            if (data) {
                 const backupShifts = Object.keys(data).map(id => ({
                    id: parseInt(id, 10),
                    date: dateString,
                    estado: 'cerrado' 
                }));
                
                backupShifts.forEach(backupShift => {
                    if (!allShifts.some(activeShift => String(activeShift.id) === String(backupShift.id))) {
                        allShifts.push(backupShift);
                    }
                });
            }
        }
        
        return allShifts.sort((a, b) => Number(b.id) - Number(a.id));
    } catch (error) {
        console.error("Error fetching shifts for date:", error);
        return [];
    }
};


export const fetchCashRegisterData = async (date, shiftId, isActiveShift) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentLocalId();
    if (!LOCAL_ID || !shiftId) throw new Error("Faltan datos para la consulta.");
    
    const dateString = formatDateForFirebase(date);
    let url;

    if (isActiveShift) {
        url = `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos/${shiftId}.json`;
    } else {
        const [day, month, year] = dateString.split('-');
        url = `${API_URL}/${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shiftId}/CAJA.json`;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return { fondoInicial: 0, gastos: {}, CAJAFUERTE: {} };
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return data || { fondoInicial: 0, gastos: {}, CAJAFUERTE: {} };
    } catch (error) {
        console.error("Error fetching cash register data:", error);
        return { fondoInicial: 0, gastos: {}, CAJAFUERTE: {} };
    }
};

export const fetchSalesForShift = async (shift) => {
    if (!shift || !shift.id || !shift.date) return [];

    checkLocalId();
    const db = getDatabase();
    const localId = getCurrentLocalId();
    const shiftDateStr = shift.date;
    const shiftId = shift.id;

    const fetchSalesFromNode = async (nodeName) => {
        const salesRef = ref(db, `${localId}/${nodeName}`);
        const q = query(salesRef, orderByChild('fechacaja'), equalTo(shiftDateStr));
        const snapshot = await get(q);

        const sales = [];
        if (snapshot.exists()) {
            snapshot.forEach(childSnapshot => {
                const sale = childSnapshot.val();
                
                // Strictly filter by shift ID, coercing both to String for safety
                if (String(sale.turno) !== String(shiftId)) {
                    return;
                }

                const saleId = childSnapshot.key;

                let formattedSale;
                if (nodeName === 'MOSTRADOR') {
                    const isSpecialDiscount = sale.specialDiscount && ['Sorteo', 'Regalo', 'Mal Armado'].includes(sale.specialDiscount.type);
                    
                    const displayId = (sale.type === 'Seña' && sale.referenceOrder) 
                        ? sale.referenceOrder 
                        : saleId;

                    formattedSale = {
                        id: displayId, 
                        originalId: saleId,
                        hora: sale.hora,
                        payments: isSpecialDiscount ? [{ method: sale.specialDiscount.type, amount: 0 }] : sale.payments,
                        total: isSpecialDiscount ? 0 : sale.total,
                        type: sale.type || 'Mostrador',
                        description: sale.description,
                        status: sale.status || 'COMPLETADO',
                        CostoTotal: sale.CostoTotal,
                        items: sale.items || []
                    };
                } else { 
                    if (sale.status?.main === 'ENTREGADO' && sale.payment) {
                        let total = sale.payment.total;
                        if (typeof total === 'undefined' || total === null || total === 0) {
                            total = sale.payment.amount || 0;
                        }
                        
                        if (sale.payment.deposit && sale.payment.deposit.amount) {
                            total = total - sale.payment.deposit.amount;
                        }

                        formattedSale = {
                            id: saleId,
                            hora: sale.times?.ingress || new Date(sale.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                            payments: sale.payment.payments || [{ method: sale.payment.method, amount: total }], 
                            total: total,
                            type: 'Delivery',
                            status: sale.status?.main || 'ENTREGADO',
                            CostoTotal: sale.CostoTotal,
                            items: sale.items || []
                        };
                    }
                }
                if (formattedSale) {
                    sales.push(formattedSale);
                }
            });
        }
        return sales;
    };

    try {
        const [counterSales, deliverySales] = await Promise.all([
            fetchSalesFromNode('MOSTRADOR'),
            fetchSalesFromNode('PEDIDOS')
        ]);

        const allSales = [...counterSales, ...deliverySales];

        return allSales.sort((a, b) => {
            const timeA = a.hora || '00:00:00';
            const timeB = b.hora || '00:00:00';
            
            const getSortableTimeValue = (timeStr) => {
                const [h, m, s] = (timeStr || '00:00:00').split(':').map(Number);
                let hours = h;
                if (h >= 0 && h <= 4) { 
                    hours += 24;
                }
                return hours * 3600 + m * 60 + (s || 0);
            };

            const valueA = getSortableTimeValue(timeA);
            const valueB = getSortableTimeValue(timeB);

            return valueB - valueA;
        });
    } catch (error) {
        console.error("Error fetching sales for shift:", error);
        return [];
    }
};

export const listenToCashData = (shift, callback) => {
    if (!shift || !shift.id || !shift.date) return () => {};

    checkLocalId();
    const db = getDatabase();
    const localId = getCurrentLocalId();
    
    console.log(`[data.js] Listening to cash data for Shift: ${shift.id}, Date: ${shift.date}`);
    const shiftRef = ref(db, `${localId}/CAJAS/${shift.date}/turnos/${shift.id}`);
    
    const listener = onValue(shiftRef, (snapshot) => {
        const data = snapshot.val();
        console.log(`[data.js] Received real-time cash data for Shift ${shift.id}:`, data);
        callback(data || { fondoInicial: shift.fondoInicial || 0, gastos: {}, CAJAFUERTE: {} });
    });

    return () => off(shiftRef, 'value', listener);
};

export const listenToSales = (shift, callback) => {
    if (!shift || !shift.id || !shift.date) return () => {};

    checkLocalId();
    const db = getDatabase();
    const localId = getCurrentLocalId();

    console.log(`[data.js] Listening to sales data for Shift: ${shift.id}, Date: ${shift.date}`);
    const mostradorRef = ref(db, `${localId}/MOSTRADOR`);
    const pedidosRef = ref(db, `${localId}/PEDIDOS`);

    let mostradorSales = [];
    let pedidosSales = [];

    const updateCombinedSales = () => {
        const allSales = [...mostradorSales, ...pedidosSales].sort((a, b) => {
            const timeA = a.hora || '00:00:00';
            const timeB = b.hora || '00:00:00';
            const getSortableTimeValue = (timeStr) => {
                const [h, m, s] = (timeStr || '00:00:00').split(':').map(Number);
                let hours = h;
                if (h >= 0 && h <= 4) hours += 24;
                return hours * 3600 + m * 60 + (s || 0);
            };
            return getSortableTimeValue(timeB) - getSortableTimeValue(timeA);
        });
        callback(allSales);
    };

    const mostradorListener = onValue(mostradorRef, (snapshot) => {
        const salesData = snapshot.val() || {};
        mostradorSales = Object.keys(salesData)
            .map(id => ({ id, ...salesData[id] }))
            // Strictly check shift matching, coercing to strings
            .filter(sale => String(sale.turno) === String(shift.id) && sale.fechacaja === shift.date)
            .map(sale => {
                 const isSpecialDiscount = sale.specialDiscount && ['Sorteo', 'Regalo', 'Mal Armado'].includes(sale.specialDiscount.type);
                 
                 const displayId = (sale.type === 'Seña' && sale.referenceOrder) 
                        ? sale.referenceOrder 
                        : sale.id;

                 return {
                    id: displayId,
                    originalId: sale.id,
                    hora: sale.hora,
                    payments: isSpecialDiscount ? [{ method: sale.specialDiscount.type, amount: 0 }] : sale.payments,
                    total: isSpecialDiscount ? 0 : sale.total,
                    type: sale.type || 'Mostrador',
                    description: sale.description,
                    status: sale.status || 'COMPLETADO',
                    CostoTotal: sale.CostoTotal,
                    items: sale.items || []
                 }
            });
        updateCombinedSales();
    });

    const pedidosListener = onValue(pedidosRef, (snapshot) => {
        const salesData = snapshot.val() || {};
        pedidosSales = Object.keys(salesData)
            .map(id => ({ id, ...salesData[id] }))
            // Strictly check shift matching, coercing to strings
            .filter(sale => String(sale.turno) === String(shift.id) && sale.fechacaja === shift.date && sale.status?.main === 'ENTREGADO')
            .map(sale => {
                let total = typeof sale.payment.total !== 'undefined' ? sale.payment.total : sale.payment.amount || 0;
                
                if (sale.payment.deposit && sale.payment.deposit.amount) {
                    total = total - sale.payment.deposit.amount;
                }

                return {
                    id: sale.id,
                    hora: sale.times?.ingress || new Date(sale.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
                    payments: sale.payment.payments || [{ method: sale.payment.method, amount: total }],
                    total: total,
                    type: 'Delivery',
                    status: sale.status?.main || 'ENTREGADO',
                    CostoTotal: sale.CostoTotal,
                    items: sale.items || []
                }
            });
        updateCombinedSales();
    });

    return () => {
        off(mostradorRef, 'value', mostradorListener);
        off(pedidosRef, 'value', pedidosListener);
    };
};
