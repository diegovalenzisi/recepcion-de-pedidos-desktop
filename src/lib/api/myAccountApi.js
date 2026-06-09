import { getDatabase, ref, get, runTransaction } from "firebase/database";
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { fetchSalesPercentage } from '@/lib/api/settingsApi';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';


export const fetchAccountSummary = async () => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const db = getDatabase();
    const summaryRef = ref(db, `${localId}/RESUMEN_CUENTA`);

    try {
        const snapshot = await get(summaryRef);
        if (!snapshot.exists()) {
            return {
                totals: { totalSales: 0, totalCommission: 0 },
                transactions: []
            };
        }

        const data = snapshot.val();
        const totals = data.TOTALES || { totalSales: 0, totalCommission: 0 };
        const transactions = [];

        for (const key in data) {
            if (key !== 'TOTALES' && key !== 'PAGO' && key !== 'VENTAS_COMISION') {
                const dateData = data[key];
                for (const orderId in dateData) {
                    transactions.push({
                        ...dateData[orderId],
                        id: orderId,
                        fecha: new Date(key).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    });
                }
            }
        }
        
        transactions.sort((a, b) => {
            const dateA = new Date(a.fecha.split('/').reverse().join('-'));
            const dateB = new Date(b.fecha.split('/').reverse().join('-'));
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;
            
            const numA = parseInt(String(a.numero).replace(/\D/g, ''), 10);
            const numB = parseInt(String(b.numero).replace(/\D/g, ''), 10);
            return numB - numA;
        });

        return { totals, transactions };
    } catch (error) {
        console.error("Error fetching account summary:", error);
        throw error;
    }
};

export const saveSaleToAccountSummary = async ({ numeroPedido, valor, tipo }) => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const db = getDatabase();

    try {
        const percentage = await fetchSalesPercentage();
        if (percentage === null || percentage === undefined) {
            console.log("No sales percentage configured. Skipping commission calculation.");
            return;
        }

        const saleValue = typeof valor === 'number' ? valor : 0;
        let commission = (saleValue * parseFloat(percentage)) / 100;
        if (isNaN(commission)) {
            commission = 0;
        }

        const operationalDate = getOperationalDate(new Date());
        const today = operationalDate.toISOString().split('T')[0]; // YYYY-MM-DD


        const saleRef = ref(db, `${localId}/RESUMEN_CUENTA/${today}/${numeroPedido}`);
        const totalsRef = ref(db, `${localId}/RESUMEN_CUENTA/TOTALES`);

        const saleData = {
            comision: commission,
            numero: numeroPedido,
            tipo: tipo.toLowerCase(),
            valor: saleValue,
        };

        await runTransaction(saleRef, () => saleData);

        await runTransaction(totalsRef, (currentTotals) => {
            if (!currentTotals) {
                return { totalSales: saleValue, totalCommission: commission };
            }
            currentTotals.totalSales = (currentTotals.totalSales || 0) + saleValue;
            currentTotals.totalCommission = (currentTotals.totalCommission || 0) + commission;
            return currentTotals;
        });

    } catch (error) {
        console.error("Error saving sale to account summary:", error);
        throw error;
    }
};