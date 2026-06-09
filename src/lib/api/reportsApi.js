import { getDatabase, ref, get, query, orderByChild, equalTo, runTransaction } from 'firebase/database';
import { checkLocalId, getCurrentLocalId } from '@/lib/firebase/core';
import { formatDateForFirebase } from '@/lib/utils';

const getReportRef = (shiftPath) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    // The shiftPath is expected to be like "DD-MM-YYYY/turnos/1"
    const fullPath = `${LOCAL_ID}/CAJAS/${shiftPath}/report`;
    return ref(db, fullPath);
};

export const fetchShiftReport = async (shift) => {
    if (!shift || !shift.date || !shift.id) {
        console.error("Invalid shift data provided to fetchShiftReport");
        return null;
    }
    const shiftPath = `${shift.date}/turnos/${shift.id}`;
    const reportRef = getReportRef(shiftPath);
    try {
        const snapshot = await get(reportRef);
        if (snapshot.exists()) {
            return snapshot.val();
        }
        return {
            MOSTRADOR: 0,
            DELIVERY: 0,
            EFECTIVO: 0,
            ELECTRONICO: 0,
            GASTOS: 0,
            PEDIDOS: {}
        };
    } catch (error) {
        console.error("Error fetching shift report:", error);
        throw error;
    }
};

export const updateShiftReport = async (shiftPath, updates) => {
    const reportRef = getReportRef(shiftPath);
    
    await runTransaction(reportRef, (currentReport) => {
        if (!currentReport) {
            currentReport = {
                MOSTRADOR: 0,
                DELIVERY: 0,
                EFECTIVO: 0,
                ELECTRONICO: 0,
                GASTOS: 0,
                PEDIDOS: {}
            };
        }
        
        for (const key in updates) {
            if (key === 'PEDIDOS') {
                currentReport.PEDIDOS = { ...currentReport.PEDIDOS, ...updates.PEDIDOS };
            } else {
                currentReport[key] = (currentReport[key] || 0) + updates[key];
            }
        }
        
        return currentReport;
    });
};

export const fetchDayReportOrders = async (date) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const formattedDate = formatDateForFirebase(date);

    try {
        const deliveryOrdersRef = ref(db, `${LOCAL_ID}/PEDIDOS`);
        const counterOrdersRef = ref(db, `${LOCAL_ID}/MOSTRADOR`);

        const deliveryQuery = query(deliveryOrdersRef, orderByChild('fechacaja'), equalTo(formattedDate));
        const counterQuery = query(counterOrdersRef, orderByChild('fechacaja'), equalTo(formattedDate));

        const [deliverySnapshot, counterSnapshot] = await Promise.all([
            get(deliveryQuery),
            get(counterQuery)
        ]);

        const deliveryOrders = [];
        if (deliverySnapshot.exists()) {
            deliverySnapshot.forEach(childSnapshot => {
                const orderData = childSnapshot.val();
                let hora = 'N/A';
                if (orderData.times?.ingress && typeof orderData.times.ingress === 'string') {
                    hora = orderData.times.ingress.replace(/-/g, ':');
                }
                deliveryOrders.push({
                    id: childSnapshot.key,
                    ...orderData,
                    estado: orderData.status?.main || 'N/A',
                    valor: orderData.payment?.total || 0,
                    hora: hora,
                    type: 'Delivery'
                });
            });
        }

        const counterOrders = [];
        if (counterSnapshot.exists()) {
            counterSnapshot.forEach(childSnapshot => {
                const orderData = childSnapshot.val();
                let hora = 'N/A';
                if (orderData.hora && typeof orderData.hora === 'string') {
                   hora = orderData.hora.replace(/-/g, ':');
                }
                counterOrders.push({
                    id: childSnapshot.key,
                    ...orderData,
                    status: 'Finalizado',
                    estado: 'ENTREGADO', 
                    valor: orderData.total || 0,
                    hora: hora,
                    type: 'Mostrador'
                });
            });
        }

        const allOrders = [...deliveryOrders, ...counterOrders];
        
        allOrders.sort((a, b) => {
            if (a.hora === 'N/A' || b.hora === 'N/A') {
                return Number(b.id) - Number(a.id);
            }

            const isEarlyMorningA = a.hora >= '00:00:00' && a.hora <= '03:00:00';
            const isEarlyMorningB = b.hora >= '00:00:00' && b.hora <= '03:00:00';

            if (isEarlyMorningA && !isEarlyMorningB) {
                return -1; 
            }
            if (!isEarlyMorningA && isEarlyMorningB) {
                return 1; 
            }

            return b.hora.localeCompare(a.hora);
        });

        return allOrders;

    } catch (error) {
        console.error("Error fetching day report orders:", error);
        throw error;
    }
};

export const calculateShiftSummary = async (shift, dayOrders) => {
    if (!shift || !shift.id) {
        throw new Error("Invalid shift data");
    }

    try {
        let deliveredCount = 0;
        let counterSalesCount = 0;
        let totalCash = 0;
        let totalElectronic = 0;

        dayOrders.forEach(order => {
            if (String(order.turno) !== String(shift.id)) return;

            if (order.type === 'Delivery' && order.estado === 'ENTREGADO') {
                deliveredCount++;
                const payments = order.payment?.payments || [{ method: order.payment.method, amount: order.payment.amount }];
                payments.forEach(p => {
                    if (p.method === 'Efectivo') {
                        totalCash += p.amount;
                    } else {
                        totalElectronic += p.amount;
                    }
                });
            } else if (order.type === 'Mostrador') {
                counterSalesCount++;
                const payments = order.payments || [];
                payments.forEach(p => {
                    if (p.method === 'Efectivo') {
                        totalCash += p.amount;
                    } else {
                        totalElectronic += p.amount;
                    }
                });
            }
        });
        
        return {
            deliveredOrdersCount: deliveredCount,
            counterSalesCount: counterSalesCount,
            totalCash: totalCash,
            totalElectronic: totalElectronic,
        };

    } catch (error) {
        console.error("Error calculating shift summary:", error);
        throw error;
    }
};