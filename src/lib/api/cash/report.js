
import { getBusinessName } from '@/lib/businessNameUtils';

export const generateShiftReportData = (shiftData, sales, cashCount, settings) => {
    if (!shiftData || !sales || !settings) {
        return null;
    }

    const validSales = sales.filter(s => s.status !== 'CANCELADO');
    const expensesArray = Object.values(shiftData.gastos || {}).filter(Boolean);
    const validExpenses = expensesArray.filter(e => !e.concepto?.startsWith('Nota de Credito'));

    const totalSales = validSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
    const totalExpenses = validExpenses.reduce((sum, expense) => sum + (expense.monto || 0), 0);

    const totalCostValue = validSales.reduce((sum, sale) => {
        const saleCost = (sale.items || []).reduce((itemSum, item) => {
            const qty = item.cantidad || 1;
            const unitCost = item.costoTotalReceta || item.costoUnitario || 0;
            return itemSum + (qty * unitCost);
        }, 0);
        return sum + saleCost;
    }, 0);
    const totalCost = Math.round(totalCostValue * 1000) / 1000;

    const totalsByPaymentMethod = validSales.reduce((acc, sale) => {
        (sale.payments || []).forEach(payment => {
            acc[payment.method] = (acc[payment.method] || 0) + (payment.amount || 0);
        });
        return acc;
    }, {});

    const expensesByPaymentMethod = validExpenses.reduce((acc, expense) => {
        const method = expense.paymentMethod || 'efectivo';
        acc[method] = (acc[method] || 0) + (expense.monto || 0);
        return acc;
    }, {});

    const totalCashSales = totalsByPaymentMethod['Efectivo'] || 0;
    const totalElectronicSales = Object.entries(totalsByPaymentMethod)
        .filter(([method]) => method !== 'Efectivo')
        .reduce((sum, [, amount]) => sum + amount, 0);

    const totalCashExpenses = expensesByPaymentMethod['efectivo'] || 0;
    const totalElectronicExpenses = Object.entries(expensesByPaymentMethod)
        .filter(([method]) => method !== 'efectivo')
        .reduce((sum, [, amount]) => sum + amount, 0);

    const safeEntries = Object.values(shiftData.CAJAFUERTE || {}).filter(Boolean);
    const totalSafe = safeEntries.reduce((sum, entry) => sum + (entry.valor || 0), 0);

    const fondoInicial = shiftData.fondoInicial || 0;
    const cashInBox = fondoInicial + totalCashSales - totalCashExpenses - totalSafe;
    const difference = cashCount - cashInBox;

    const summary = {
        fondoInicial,
        totalSales,
        totalExpenses,
        totalCost,
        totalCashSales,
        totalElectronicSales,
        totalCashExpenses,
        totalElectronicExpenses,
        totalSafe,
        cashInBox,
        cashCount,
        difference,
        totalsByPaymentMethod,
        expensesByPaymentMethod,
        safeEntries
    };
    
    // Get location-specific business name
    const businessName = getBusinessName();

    return {
        shiftId: shiftData.id,
        date: shiftData.date,
        startTime: shiftData.horaApertura,
        endTime: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        responsible: 'No definido',
        businessName,
        summary,
        sales: validSales,
        expenses: validExpenses,
        settings
    };
};
