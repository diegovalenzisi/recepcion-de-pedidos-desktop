
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

// ---------------------------------------------------------------------------
// Lectura HISTÓRICA de la caja de un turno cerrado, directamente desde BACKUP.
// A diferencia de fetchCashRegisterData (que la usan también la caja ABIERTA en
// LoginPage/ShiftSummaryUpdater y por eso chequea CAJAS vivo primero), este helper:
//   - NO mira CAJAS vivo → evita devolver un stub sin gastos/CAJAFUERTE.
//   - Alinea la fecha con la misma tolerancia ±1 día que las ventas (cruce de medianoche).
//   - Lee EXPLÍCITAMENTE CAJA/gastos y CAJA/CAJAFUERTE (nombres exactos) y los normaliza,
//     por si el nodo CAJA viniera incompleto.
// Solo lectura. No toca escritura, cierre ni backup.
// ---------------------------------------------------------------------------
export const fetchHistoricalCashData = async (shift) => {
    if (!shift || !shift.id || !shift.date) {
        return { fondoInicial: 0, gastos: {}, CAJAFUERTE: {} };
    }
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentLocalId();
    const shiftId = shift.id;

    // Candidatos de fecha: exacta, día anterior, día siguiente (igual que fetchSalesForShift).
    const candidates = [shift.date];
    const base = parseDateString(shift.date);
    if (base && !isNaN(base)) {
        const prev = new Date(base); prev.setDate(prev.getDate() - 1);
        const next = new Date(base); next.setDate(next.getDate() + 1);
        candidates.push(formatDateForFirebase(prev), formatDateForFirebase(next));
    }

    for (const cand of candidates) {
        const [day, month, year] = cand.split('-');
        const backupBase = `${API_URL}/${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shiftId}`;
        try {
            const [cajaRes, gastosRes, safeRes] = await Promise.all([
                fetch(`${backupBase}/CAJA.json`),
                fetch(`${backupBase}/CAJA/gastos.json`),
                fetch(`${backupBase}/CAJA/CAJAFUERTE.json`),
            ]);
            const caja = cajaRes.ok ? await cajaRes.json() : null;
            if (caja) {
                const gastos     = gastosRes.ok ? await gastosRes.json() : null;
                const cajafuerte = safeRes.ok   ? await safeRes.json()   : null;
                const normalized = {
                    ...caja,
                    gastos:     gastos     || caja.gastos     || {},
                    CAJAFUERTE: cajafuerte || caja.CAJAFUERTE || {},
                };
                if (cand !== shift.date) {
                    console.log(`[CAJA] CAJA histórica de turno #${shiftId} hallada en fecha adyacente ${cand}.`);
                }
                console.log(`[CAJA] BACKUP CAJA #${shiftId} (${cand}): gastos=${Object.keys(normalized.gastos).length} cajafuerte=${Object.keys(normalized.CAJAFUERTE).length}`);
                return normalized;
            }
        } catch (e) {
            console.warn(`[CAJA] Error leyendo BACKUP CAJA ${cand}:`, e?.message || e);
        }
    }

    // Sin CAJA en BACKUP en ninguna fecha cercana → fallback al lector genérico
    // (CAJAS vivo exacto + BACKUP exacto), por si fuese un turno aún no respaldado.
    console.log(`[CAJA] Sin BACKUP CAJA para #${shiftId} en ${candidates.join(', ')} — usando fetchCashRegisterData.`);
    return fetchCashRegisterData(base || parseDateString(shift.date), shiftId);
};

// Formatea una venta cruda (de MOSTRADOR/PEDIDOS, vivo o BACKUP) al shape que usa la
// tabla de ventas. `kind` = 'MOSTRADOR' | 'DELIVERY'. Devuelve null si la venta no aplica.
const formatSale = (kind, saleId, sale) => {
    if (kind === 'MOSTRADOR') {
        const isSpecialDiscount = sale.specialDiscount && ['Sorteo', 'Regalo', 'Mal Armado'].includes(sale.specialDiscount.type);
        const displayId = (sale.type === 'Seña' && sale.referenceOrder) ? sale.referenceOrder : saleId;
        return {
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
    }
    // DELIVERY: solo entregados con pago (igual que el flujo vivo)
    if (sale.status?.main === 'ENTREGADO' && sale.payment != null) {
        let total = sale.payment.total;
        if (typeof total === 'undefined' || total === null || total === 0) {
            total = sale.payment.amount || 0;
        }
        if (sale.payment.deposit?.amount) {
            total = total - sale.payment.deposit.amount;
        }
        return {
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
    return null;
};

const sortSalesByHora = (sales) => sales.sort((a, b) => {
    const val = (t) => {
        const [h, m, s] = (t || '00:00:00').split(':').map(Number);
        return (h >= 0 && h <= 4 ? h + 24 : h) * 3600 + m * 60 + (s || 0);
    };
    return val(b.hora) - val(a.hora);
});

// Lectura de las ventas históricas del turno cerrado desde BACKUP. Cada carpeta de estado
// contiene las mismas ventas crudas que estaban en MOSTRADOR/PEDIDOS antes del cierre, ya
// aisladas por TURNO/{id}, así que no hay mezcla de turnos, fechas ni locales.
const fetchSalesFromBackup = async (localId, shiftDateStr, shiftId) => {
    const [day, month, year] = shiftDateStr.split('-');
    const base = `${localId}/BACKUP/${year}/${month}/${day}/TURNO/${shiftId}`;
    const db = getDatabase();

    const readFolder = async (relPath, kind) => {
        try {
            const snap = await get(ref(db, `${base}/${relPath}`));
            if (!snap.exists()) return [];
            const out = [];
            const data = snap.val();
            Object.keys(data).forEach(saleId => {
                const formatted = formatSale(kind, saleId, data[saleId]);
                if (formatted) out.push(formatted);
            });
            return out;
        } catch (e) {
            console.warn(`[CAJA] No se pudo leer BACKUP ${relPath}:`, e?.message || e);
            return [];
        }
    };

    const [mostradorCompletados, mostradorCancelados, deliveryEntregados, deliveryCancelados] = await Promise.all([
        readFolder('MOSTRADOR/COMPLETADOS', 'MOSTRADOR'),
        readFolder('MOSTRADOR/CANCELADOS', 'MOSTRADOR'),
        readFolder('DELIVERY/ENTREGADOS', 'DELIVERY'),
        readFolder('DELIVERY/CANCELADOS', 'DELIVERY'),
    ]);

    const all = [...mostradorCompletados, ...mostradorCancelados, ...deliveryEntregados, ...deliveryCancelados];
    console.log(`[CAJA] Ventas desde BACKUP turno #${shiftId}: ${mostradorCompletados.length + mostradorCancelados.length} mostrador + ${deliveryEntregados.length + deliveryCancelados.length} delivery = ${all.length} total`);
    return all;
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
                if (String(sale.turno) !== String(shiftId)) return;
                const formatted = formatSale(nodeName === 'MOSTRADOR' ? 'MOSTRADOR' : 'DELIVERY', childSnapshot.key, sale);
                if (formatted) sales.push(formatted);
            });
        }
        return sales;
    };

    try {
        const [counterSales, deliverySales] = await Promise.all([
            fetchSalesFromNode('MOSTRADOR'),
            fetchSalesFromNode('PEDIDOS'),
        ]);

        let allSales = [...counterSales, ...deliverySales];
        console.log(`[CAJA] Ventas vivas: ${counterSales.length} mostrador + ${deliverySales.length} delivery = ${allSales.length} total`);

        // Fallback a BACKUP SOLO si las ventas vivas vinieron vacías (turno cerrado, ya movido).
        // Nunca se combinan vivo + backup del mismo turno → no hay duplicación.
        if (allSales.length === 0) {
            console.log(`[CAJA] Sin ventas vivas para turno #${shiftId} — probando BACKUP...`);

            // Capa 1: probar la fecha exacta y, si viene vacía, ±1 día (cruce de medianoche).
            // Regla estricta: cada consulta lee SOLO bajo BACKUP/{fecha}/TURNO/{id} (nunca mezcla
            // turnos ni locales) y se toma la PRIMERA fecha con ventas (no se combinan fechas).
            const candidateDates = [shiftDateStr];
            const baseDate = parseDateString(shiftDateStr);
            if (baseDate && !isNaN(baseDate)) {
                const prev = new Date(baseDate); prev.setDate(prev.getDate() - 1);
                const next = new Date(baseDate); next.setDate(next.getDate() + 1);
                candidateDates.push(formatDateForFirebase(prev), formatDateForFirebase(next));
            }

            for (const cand of candidateDates) {
                const backupSales = await fetchSalesFromBackup(localId, cand, shiftId);
                if (backupSales.length > 0) {
                    allSales = backupSales;
                    if (cand !== shiftDateStr) {
                        console.log(`[CAJA] Ventas del turno #${shiftId} halladas en fecha adyacente ${cand} (cruce de medianoche).`);
                    }
                    break; // primera fecha con ventas → no combinar más fechas
                }
            }
        }

        return sortSalesByHora(allSales);
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
