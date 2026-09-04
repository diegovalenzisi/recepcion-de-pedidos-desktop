
import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { asegurarOperable } from '@/lib/api/mantenimientoApi';
import { getDatabase, ref, get, set, remove, update } from 'firebase/database';
import { formatDateForFirebase } from '@/lib/utils';
import { totalesPorMedioDePago, validarPayloadDeCierre } from './clavesCierre.js';

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
    // No se inicia una operacion comercial durante el mantenimiento: una venta
    // creada a mitad del reset no entra al respaldo y descuadra el stock.
    await asegurarOperable('la apertura de caja');
    // First, double-check there isn't an open shift before creating a new one.
    const openShift = await checkOpenShift();
    if (openShift) {
        console.error("Attempted to create a new shift while one is already open.", openShift);
        throw new Error("Ya existe un turno abierto. No se puede crear uno nuevo.");
    }
    
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    // Las URLs REST (API_URL/LOCAL_ID) se capturan como strings acá y NO se
    // revalidan solas — a diferencia del SDK, un fetch() con la URL vieja
    // escribiría igual en el local viejo aunque ya se haya cambiado a otro.
    // beginFirebaseOperation()/getDatabaseOrAbort() cierra ese hueco.
    const op = beginFirebaseOperation();
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

    op.getDatabaseOrAbort();
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

    op.getDatabaseOrAbort();
    const newShiftUrl = `${API_URL}/${LOCAL_ID}/CAJAS/${dateString}/turnos/${newShiftNumber}.json`;
    await fetch(newShiftUrl, { method: 'PUT', body: JSON.stringify(newShift) });

    return { ...newShift, date: dateString };
};

const BATCH_SIZE = 25;

const backupAndClearOrders = async (shift, progressCallback, op) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();

    const [day, month, year] = shift.date.split('-');
    const backupBasePath = `${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shift.id}`;

    const processInBatches = async (path, type, progressPrefix) => {
        // op.getDatabaseOrAbort() SIEMPRE, no solo la primera vez: cada batch
        // tiene su propio await previo (progressCallback + el get() inicial
        // del lote anterior), así que se revalida en cada iteración.
        const dataRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/${path}`);
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
                // Revalida ANTES de cada lote: si el local cambió entre lotes,
                // se aborta acá en vez de seguir respaldando/borrando contra el
                // local equivocado. Los lotes YA commiteados quedan como están
                // (se escribieron correctamente contra el local activo en ese
                // momento) — ver documentación de closeShift().
                await update(ref(op.getDatabaseOrAbort()), updates);
            }
        }
    };

    await processInBatches('PEDIDOS', 'DELIVERY', 'Respaldando pedidos de delivery');
    await processInBatches('MOSTRADOR', 'MOSTRADOR', 'Respaldando ventas de mostrador');
};

const backupShiftData = async (shift, closingPayload, progressCallback, op) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const dateString = shift.date || formatDateForFirebase(new Date());

    const shiftRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/CAJAS/${dateString}/turnos/${shift.id}`);
    const snapshot = await get(shiftRef);

    if (!snapshot.exists()) {
        console.warn(`No se encontraron datos para el turno ${shift.id} en la fecha ${dateString}. No se puede realizar el backup.`);
        return;
    }

    const shiftDataToBackup = { ...snapshot.val(), ...closingPayload };

    const [day, month, year] = dateString.split('-');
    const backupPath = `${LOCAL_ID}/BACKUP/${year}/${month}/${day}/TURNO/${shift.id}/CAJA`;

    // Revalida antes de las dos escrituras definitivas (backup + remove del
    // turno vivo): el get() de arriba fue un await real.
    const freshDb = op.getDatabaseOrAbort();
    const backupRef = ref(freshDb, backupPath);
    const freshShiftRef = ref(freshDb, `${LOCAL_ID}/CAJAS/${dateString}/turnos/${shift.id}`);

    await set(backupRef, shiftDataToBackup);
    await remove(freshShiftRef);
};

/**
 * Deja anotado en el error en qué fase murió el cierre y si el paso destructivo
 * ya había corrido. Lo lee CloseShiftModal para redactar el aviso al operador.
 */
const marcarFase = (error, fase, pedidosYaMovidos) => {
    if (!error || typeof error !== 'object') return;
    error.faseCierre = fase;
    error.pedidosYaMovidos = pedidosYaMovidos;
};

/**
 * @param {object} [ejecutadoPor] identidad de QUIEN ejecuta el cierre
 *   (id, usuario, nombre, rol, fecha). Es información de auditoría y es
 *   independiente de `responsible`: cuando cierra un dueño o un encargado no se
 *   elige vendedor y los dos coinciden. Parámetro opcional y aditivo — no
 *   cambia ningún cálculo ni el significado de `cierreResponsable`.
 */
export const closeShift = async (shift, cashCount, sales, pdfBase64, responsible, progressCallback, ejecutadoPor = null) => {
  // El cierre escribe BACKUP, RESUMEN_TURNO y borra pedidos: es la operacion
  // mas destructiva del dia. No puede correr a la par del reset.
  await asegurarOperable('el cierre de caja');
    checkLocalId();
    // Un solo "op" para TODO el cierre (múltiples lotes + backup del turno):
    // captura el local/generación acá y se revalida en cada escritura. Si el
    // local cambia a mitad de un cierre, los lotes ya escritos quedan como
    // están (eran correctos para el local activo en ese instante) y los que
    // faltaban se abortan con un error controlado en vez de escribir contra
    // el local nuevo — un cierre de caja NUNCA debe terminar a medias en dos
    // locales distintos sin que el usuario se entere.
    const op = beginFirebaseOperation();
    const dateString = shift.date || formatDateForFirebase(new Date());

    progressCallback('Calculando totales...');
    // Las claves se sanean SIEMPRE: el nombre de la cuenta lo escribe una
    // persona en un campo libre y Realtime Database rechaza `. $ # [ ] /`.
    // Ver clavesCierre.js — este `set()` es el que partió el turno 103.
    const totalsByPaymentMethod = totalesPorMedioDePago(sales);

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
        ...(ejecutadoPor ? { cierreEjecutadoPor: ejecutadoPor } : {}),
        costoTotal: Math.round(totalCostValue * 1000) / 1000,
        cierreGanancia: Math.round(ganancia * 1000) / 1000
    };

    // -----------------------------------------------------------------------
    // VALIDACIÓN PREVIA — antes de tocar UN SOLO pedido.
    //
    // Este es el orden que faltaba. Hasta el turno 103 de Achaval el primer
    // paso era el destructivo (respaldar y BORRAR los pedidos vivos) y recién
    // después se intentaba escribir la caja: cuando esa escritura resultaba
    // imposible, las ventas ya no estaban en ningún nodo activo y el turno
    // quedaba "abierto" y vacío. Ahora, si el payload no se puede escribir, se
    // aborta acá: no se movió nada y el operador puede reintentar sin secuelas.
    //
    // Alcanza con validar `closingPayload`: lo demás que termina en el backup
    // sale de un snapshot de Firebase, o sea que sus claves ya son válidas por
    // definición (la base no las habría aceptado al guardarlas).
    // -----------------------------------------------------------------------
    progressCallback('Validando datos del cierre...');
    validarPayloadDeCierre(closingPayload);

    // A partir de acá SÍ se modifican datos. Cada fase marca el error con
    // dónde quedó, para que el mensaje al operador diga si los pedidos ya se
    // movieron o no — un "No se pudo cerrar el turno." a secas fue justamente
    // lo que ocultó el problema durante todo un turno.
    progressCallback('Respaldando y limpiando pedidos...');
    try {
        await backupAndClearOrders(shift, progressCallback, op);
    } catch (error) {
        marcarFase(error, 'respaldo-pedidos', true);
        throw error;
    }

    progressCallback('Respaldando datos del turno...');
    try {
        await backupShiftData(shift, closingPayload, progressCallback, op);
    } catch (error) {
        marcarFase(error, 'respaldo-caja', true);
        throw error;
    }

    progressCallback('Cierre completado.');
};
