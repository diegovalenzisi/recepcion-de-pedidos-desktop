
import React, { useEffect, useMemo, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { fetchCashRegisterData, fetchSalesForShift, updateShiftSummary } from '@/lib/api/cash';
import { useAuth } from '@/hooks/useAuth';
import useSWR from 'swr';
import { parseDateString } from '@/lib/utils';

const ShiftSummaryUpdater = ({ currentShift }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const hasAccess = user.rol === 'dueño';

  const swrKey = currentShift && currentShift.id ? `shift-data-${currentShift.id}` : null;

  const fetcher = useCallback(async () => {
    if (!currentShift || !currentShift.id || !currentShift.date) return null;
    try {
      const shiftDate = parseDateString(currentShift.date);
      const [cashData, sales] = await Promise.all([
        fetchCashRegisterData(shiftDate, currentShift.id),
        fetchSalesForShift(currentShift)
      ]);
      return { cashData, sales };
    } catch (error) {
      console.error("Error fetching shift summary data:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos de la caja para el resumen.' });
      return null;
    }
  }, [currentShift, toast]);

  const { data } = useSWR(swrKey, fetcher, { refreshInterval: 30000 }); // Refresh every 30 seconds

  const summaryData = useMemo(() => {
    if (!data || !currentShift) return null;

    const { cashData, sales } = data;

    const validSales = sales.filter(sale => sale.status !== 'CANCELADO');
    const totalSalesValue = validSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);

    const totalCostValue = validSales.reduce((sum, sale) => {
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

    const calculatedCost = Math.round(totalCostValue * 1000) / 1000;

    const totalsByPaymentMethodValue = validSales.reduce((acc, sale) => {
      (sale.payments || []).forEach(payment => {
        const methodName = payment.method.replace(/[.\s]/g, '_');
        acc[methodName] = (acc[methodName] || 0) + (Number(payment.amount) || 0);
      });
      return acc;
    }, {});

    const expensesArray = Object.values(cashData?.gastos || {}).filter(Boolean);
    const paidExpenses = expensesArray.filter(expense => expense.status !== 'A Pagar' && !expense.concepto.startsWith('Nota de Credito'));
    const totalExpensesValue = paidExpenses.reduce((sum, expense) => sum + (Number(expense.monto) || 0), 0);

    const safeEntries = Object.values(cashData?.CAJAFUERTE || {}).filter(Boolean);
    const totalSafeValue = safeEntries.reduce((sum, entry) => sum + (Number(entry.valor) || 0), 0);

    const ganancia = totalSalesValue - totalExpensesValue - calculatedCost;

    return {
      fondoInicial: currentShift.fondoInicial || 0,
      ventasTotales: totalSalesValue,
      gastosTotales: totalExpensesValue,
      resguardo: totalSafeValue,
      costoTotal: calculatedCost,
      ganancia: Math.round(ganancia * 1000) / 1000,
      ...totalsByPaymentMethodValue
    };
  }, [data, currentShift]);

  useEffect(() => {
    if (hasAccess && summaryData && currentShift?.estado !== 'cerrado') {
      updateShiftSummary(summaryData).catch(error => {
        console.error("Failed to update shift summary:", error);
      });
    }
  }, [summaryData, hasAccess, currentShift]);

  return null;
};

export default ShiftSummaryUpdater;
