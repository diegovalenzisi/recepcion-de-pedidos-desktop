import { getDatabase, ref, get, set, runTransaction, update } from "firebase/database";
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { fetchSalesPercentage } from '@/lib/api/settingsApi';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { registrarComision } from '@/lib/api/comisionesApi';
import { calcularComisionDeVenta, rutaTotales, contabilidadActiva, leerAcumuladores } from '@/lib/api/comisionMovimiento';

/**
 * Recalcula TotalComisionAPagar desde totalCommission y lo escribe en Firebase.
 * Llamar al inicio de la app para corregir desfasajes.
 */
export const recalcularTotalComisionAPagar = async () => {
  try {
    const localId = getCurrentDatabasePath();
    if (!localId) return;
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();
    const snap = await get(ref(db, `${localId}/RESUMEN_CUENTA/TOTALES`));
    if (!snap.exists()) return;
    const totals = snap.val();
    const calc = Math.max(0, totals.totalCommission || 0);
    if (calc !== totals.TotalComisionAPagar) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      await update(ref(op.getDatabaseOrAbort(), `${localId}/RESUMEN_CUENTA/TOTALES`), { TotalComisionAPagar: calc });
      console.log('[comisiones] TotalComisionAPagar recalculado:', calc);
    }
  } catch (e) {
    console.error('[comisiones] Error al recalcular TotalComisionAPagar:', e.message);
  }
};


export const fetchAccountSummary = async () => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
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
    const localId = getCurrentDatabasePath();
    const op = beginFirebaseOperation();

    try {
        const percentage = await fetchSalesPercentage();
        if (percentage === null || percentage === undefined) {
            console.log("No sales percentage configured. Skipping commission calculation.");
            return;
        }

        // DETERMINACIÓN ÚNICA DE LA COMISIÓN DE ESTA VENTA.
        //
        // Se calcula UNA sola vez, acá, y los tres valores viajan juntos al
        // registro. Ningún otro módulo vuelve a calcularla: la anulación usa el
        // importe guardado, no el porcentaje del momento en que se anula.
        //
        // Venta $100 al 1% → comisionGenerada 1, comisionGeneradaCentavos 100,
        // porcentajeComision 1. Si mañana el local pasa a 2%, esa venta sigue
        // teniendo $1 de comisión original.
        const saleValue = typeof valor === 'number' ? valor : 0;
        const porcentajeAplicado = parseFloat(percentage);
        const comision = calcularComisionDeVenta(saleValue, porcentajeAplicado);
        const commission = comision.comisionGenerada;

        const operationalDate = getOperationalDate(new Date());
        const today = operationalDate.toISOString().split('T')[0]; // YYYY-MM-DD


        // Revalida antes de las escrituras definitivas: fetchSalesPercentage()
        // de arriba fue un await real.
        const freshDb = op.getDatabaseOrAbort();
        const saleRef = ref(freshDb, `${localId}/RESUMEN_CUENTA/${today}/${numeroPedido}`);
        const totalsRef = ref(freshDb, `${localId}/RESUMEN_CUENTA/TOTALES`);

        // CONGELAMIENTO DE RESUMEN_CUENTA.
        //
        // Con la contabilidad nueva activa, el ledger viejo DEJA DE ESCRIBIRSE.
        // Si siguiera escribiéndose, la misma venta quedaría en RESUMEN_CUENTA
        // y en COMISIONES/REGISTRO, y "Mi Cuenta" —que muestra los movimientos
        // nuevos más el histórico legado— la listaría DOS VECES.
        //
        // No se borra nada: lo anterior a la frontera queda de sólo lectura.
        const totalesActuales = (await get(ref(freshDb, rutaTotales(localId)))).val();
        const yaActiva = contabilidadActiva(totalesActuales);

        if (!yaActiva) {
            const saleData = {
                comision: commission,
                numero: numeroPedido,
                tipo: tipo.toLowerCase(),
                valor: saleValue,
            };

            await runTransaction(saleRef, () => saleData);

            await runTransaction(totalsRef, (currentTotals) => {
            if (!currentTotals) {
                return { totalSales: saleValue, totalCommission: commission, TotalComisionAPagar: commission };
            }
            currentTotals.totalSales = (currentTotals.totalSales || 0) + saleValue;
            currentTotals.totalCommission = (currentTotals.totalCommission || 0) + commission;
            currentTotals.TotalComisionAPagar = currentTotals.totalCommission;
            return currentTotals;
            });
        }

        console.log(`[VENTA IMPACTO] id=${numeroPedido} tipo=${tipo} valor=${saleValue} impactaCaja=true impactaStock=true generaComision=true comision=${commission} ledgerViejo=${!yaActiva}`);

        // Registro histórico detallado de comisión por venta
        const tipoNorm = tipo.toLowerCase();
        try {
            await registrarComision({
                idVenta: String(numeroPedido),
                ventaTotal: saleValue,
                modoVenta: tipoNorm === 'mostrador' ? 'mostrador' : 'delivery',
                origen: tipoNorm === 'mostrador' ? 'MOSTRADOR' : 'PEDIDOS',
                // Los tres valores salen de la MISMA determinación de arriba.
                porcentajeComision: comision.porcentajeComision,
                comisionGenerada: comision.comisionGenerada,
                comisionGeneradaCentavos: comision.comisionGeneradaCentavos,
            });
        } catch (err) {
            console.error('[COMISIONES] Error al registrar comisión de venta:', err);
        }

    } catch (error) {
        console.error("Error saving sale to account summary:", error);
        throw error;
    }
};

/**
 * Revierte el impacto de una venta cancelada sobre RESUMEN_CUENTA/TOTALES.
 * Decrementa totalSales y totalCommission, y elimina el registro diario si se conoce la fecha.
 * Llamar solo cuando una venta COMPLETADO pasa a CANCELADO (ej: cancelCounterSale).
 *
 * @param {object} params
 * @param {string|number} params.numeroPedido - ID de la venta
 * @param {number} params.valor - Total de la venta
 * @param {string} params.tipo - 'Mostrador' o 'Delivery'
 * @param {string} [params.dateKey] - Clave YYYY-MM-DD del día operacional de la venta
 */
export const reversarVentaCuenta = async ({ numeroPedido, valor, tipo, dateKey }) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const op = beginFirebaseOperation();

    try {
        const percentage = await fetchSalesPercentage();
        if (percentage === null || percentage === undefined) return;

        const saleValue = typeof valor === 'number' ? valor : 0;
        let commission = (saleValue * parseFloat(percentage)) / 100;
        if (isNaN(commission)) commission = 0;

        // Revalida antes de las escrituras definitivas: fetchSalesPercentage()
        // de arriba fue un await real.
        // Decrementar TOTALES atomicamente (nunca dejar en negativo)
        const totalsRef = ref(op.getDatabaseOrAbort(), `${localId}/RESUMEN_CUENTA/TOTALES`);
        await runTransaction(totalsRef, (currentTotals) => {
            if (!currentTotals) return { totalSales: 0, totalCommission: 0, TotalComisionAPagar: 0 };
            currentTotals.totalSales = Math.max(0, (currentTotals.totalSales || 0) - saleValue);
            currentTotals.totalCommission = Math.max(0, (currentTotals.totalCommission || 0) - commission);
            currentTotals.TotalComisionAPagar = currentTotals.totalCommission;
            return currentTotals;
        });

        // Eliminar el registro diario usando la fecha operacional de la venta
        if (dateKey) {
            const saleRef = ref(op.getDatabaseOrAbort(), `${localId}/RESUMEN_CUENTA/${dateKey}/${numeroPedido}`);
            await set(saleRef, null);
        }

        console.log(`[VENTA IMPACTO] reversar id=${numeroPedido} tipo=${tipo} valor=${saleValue} comision=${commission} → RESUMEN_CUENTA decrementado`);
    } catch (error) {
        console.error('[VENTA IMPACTO] Error al reversar venta de cuenta:', error);
        throw error;
    }
};