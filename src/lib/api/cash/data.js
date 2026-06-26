
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

    console.log(`[CAJA] Fecha usada: ${dateString}`);
    console.log(`[CAJA] Ruta definitiva: ${LOCAL_ID}/CAJAS/${dateString}/turnos`);

    const url = `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos.json`;

    let cajasShifts = [];
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (data) {
                cajasShifts = Object.entries(data).map(([id, shiftData]) => ({
                    id: parseInt(id, 10),
                    date: dateString,
                    ...shiftData,
                }));
            }
        }
    } catch (error) {
        console.error('[CAJA] Error al listar turnos desde CAJAS:', error);
    }

    // También buscar turnos cerrados que hayan sido movidos al BACKUP
    let backupShifts = [];
    try {
        const [day, month, year] = dateString.split('-');
        const backupUrl = `${API_URL}/${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO.json?shallow=true`;
        const backupResponse = await fetch(backupUrl);
        if (backupResponse.ok) {
            const backupIds = await backupResponse.json();
            if (backupIds) {
                const cajasIds = new Set(cajasShifts.map(s => String(s.id)));
                const fetches = Object.keys(backupIds)
                    .filter(id => !cajasIds.has(id))
                    .map(async (id) => {
                        const cajaUrl = `${API_URL}/${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${id}/CAJA.json`;
                        const r = await fetch(cajaUrl);
                        if (!r.ok) return null;
                        const cajaData = await r.json();
                        return cajaData ? { id: parseInt(id, 10), date: dateString, ...cajaData } : null;
                    });
                backupShifts = (await Promise.all(fetches)).filter(Boolean);
                if (backupShifts.length > 0) {
                    console.log(`[CAJA] Turnos adicionales desde BACKUP: ${backupShifts.map(s => s.id).join(', ')}`);
                }
            }
        }
    } catch (error) {
        console.warn('[CAJA] No se pudo leer BACKUP para esta fecha:', error);
    }

    const allShifts = [...cajasShifts, ...backupShifts];
    console.log(`[CAJA] Turnos encontrados: ${allShifts.length} — IDs: ${allShifts.map(s => `${s.id}(${s.estado ?? '?'})`).join(', ')}`);
    return allShifts.sort((a, b) => Number(b.id) - Number(a.id));
};


export const fetchCashRegisterData = async (date, shiftId) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentLocalId();
    if (!LOCAL_ID || !shiftId) throw new Error("Faltan datos para la consulta.");

    const dateString = formatDateForFirebase(date);
    const url = `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos/${shiftId}.json`;

    console.log(`[CAJA] Fecha usada: ${dateString}`);
    console.log(`[CAJA] Ruta definitiva: ${LOCAL_ID}/CAJAS/${dateString}/turnos/${shiftId}`);

    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (data) {
                console.log(`[CAJA] Datos turno CAJAS: #${shiftId} fondoInicial=${data?.fondoInicial ?? 'N/A'} estado=${data?.estado ?? 'N/A'}`);
                return data;
            }
        }

        // Nodo no encontrado en CAJAS — puede haber sido movido a BACKUP al cerrar el turno
        console.log(`[CAJA] Turno #${shiftId} no encontrado en CAJAS. Buscando en BACKUP...`);
        const [day, month, year] = dateString.split('-');
        const backupUrl = `${API_URL}/${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shiftId}/CAJA.json`;
        const backupResponse = await fetch(backupUrl);
        if (backupResponse.ok) {
            const backupData = await backupResponse.json();
            if (backupData) {
                console.log(`[CAJA] Turno #${shiftId} encontrado en BACKUP. fondoInicial=${backupData?.fondoInicial ?? 'N/A'}`);
                return backupData;
            }
        }

        console.log(`[CAJA] Turno #${shiftId} no encontrado en CAJAS ni BACKUP.`);
        return { fondoInicial: 0, gastos: {}, CAJAFUERTE: {} };
    } catch (error) {
        console.error('[CAJA] Error al leer datos del turno:', error);
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

    console.log(`[CAJA] Leyendo ventas: ${localId}/MOSTRADOR y PEDIDOS — turno=${shiftId} fecha=${shiftDateStr}`);

    const fetchSalesFromNode = async (nodeName) => {
        const salesRef = ref(db, `${localId}/${nodeName}`);
        const q = query(salesRef, orderByChild('fechacaja'), equalTo(shiftDateStr));
        const snapshot = await get(q);

        const sales = [];
        if (snapshot.exists()) {
            snapshot.forEach(childSnapshot => {
                const sale = childSnapshot.val();

                if (String(sale.turno) !== String(shiftId)) {
                    return;
                }

                const saleId = childSnapshot.key;
                let formattedSale;

                if (nodeName === 'MOSTRADOR') {
                    const isSpecialDiscount = sale.specialDiscount && ['Sorteo', 'Regalo', 'Mal Armado'].includes(sale.specialDiscount.type);
                    const displayId = (sale.type === 'Seña' && sale.referenceOrder) ? sale.referenceOrder : saleId;
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
                        items: sale.items || [],
                    };
                } else if (sale.status?.main === 'ENTREGADO' && sale.payment != null) {
                    let total = sale.payment.total;
                    if (typeof total === 'undefined' || total === null || total === 0) {
                        total = sale.payment.amount || 0;
                    }
                    if (sale.payment.deposit?.amount) {
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
                        items: sale.items || [],
                    };
                }

                if (formattedSale) sales.push(formattedSale);
            });
        }
        return sales;
    };

    try {
        const [counterSales, deliverySales] = await Promise.all([
            fetchSalesFromNode('MOSTRADOR'),
            fetchSalesFromNode('PEDIDOS'),
        ]);

        const allSales = [...counterSales, ...deliverySales];
        console.log(`[CAJA] Ventas encontradas: ${counterSales.length} mostrador + ${deliverySales.length} delivery = ${allSales.length} total`);

        return allSales.sort((a, b) => {
            const val = (t) => {
                const [h, m, s] = (t || '00:00:00').split(':').map(Number);
                return (h >= 0 && h <= 4 ? h + 24 : h) * 3600 + m * 60 + (s || 0);
            };
            return val(b.hora) - val(a.hora);
        });
    } catch (error) {
        console.error('[CAJA] Error al leer ventas:', error);
        return [];
    }
};

export const listenToCashData = (shift, callback) => {
    if (!shift || !shift.id || !shift.date) return () => {};

    checkLocalId();
    const db = getDatabase();
    const localId = getCurrentLocalId();
    
    const cajaPath = `${localId}/CAJAS/${shift.date}/turnos/${shift.id}`;
    console.log(`[CAJA] Fecha usada: ${shift.date}`);
    console.log(`[CAJA] Leyendo ruta: ${cajaPath}`);
    const shiftRef = ref(db, cajaPath);

    const listener = onValue(shiftRef, (snapshot) => {
        const data = snapshot.val();
        console.log('[CAJA SNAPSHOT]', JSON.stringify(data, null, 2));
        console.log(`[CAJA] Datos del turno: fondoInicial=${data?.fondoInicial ?? 'N/A'} estado=${data?.estado ?? 'N/A'} gastos=${Object.keys(data?.gastos || {}).length}`);
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
        const allRaw = Object.keys(salesData).map(id => ({ id, ...salesData[id] }));
        console.log(`[listenToSales] MOSTRADOR total: ${allRaw.length} — filtrando turno=${shift.id} fecha=${shift.date}`);
        if (allRaw.length > 0) {
            const s = allRaw[0];
            console.log(`[listenToSales] Muestra MOSTRADOR[0]: turno=${s.turno} fechacaja=${s.fechacaja}`);
        }
        mostradorSales = allRaw
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
        console.log(`[listenToSales] MOSTRADOR filtradas: ${mostradorSales.length}`);
        updateCombinedSales();
    });

    const pedidosListener = onValue(pedidosRef, (snapshot) => {
        const salesData = snapshot.val() || {};
        pedidosSales = Object.keys(salesData)
            .map(id => ({ id, ...salesData[id] }))
            // Strictly check shift matching, coercing to strings; guard null payment to avoid crash
            .filter(sale => String(sale.turno) === String(shift.id) && sale.fechacaja === shift.date && sale.status?.main === 'ENTREGADO' && sale.payment != null)
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
