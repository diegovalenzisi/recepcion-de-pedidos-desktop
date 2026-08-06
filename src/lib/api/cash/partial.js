import { getDatabase, ref, get, set } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';

export const savePartialClose = async (shift, summary, responsible) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

    if (!shift || !shift.id || !shift.date) {
        throw new Error("Datos del turno inválidos para guardar el cierre parcial.");
    }

    const partialsRef = ref(db, `${localId}/CAJAS/${shift.date}/turnos/${shift.id}/parciales`);

    const snapshot = await get(partialsRef);
    const nextId = snapshot.exists() ? Object.keys(snapshot.val()).length + 1 : 1;

    const dataToSave = {
        cashCount: summary.cashCount,
        difference: summary.cashInBox,
        cashInBox: summary.difference,
        fondoInicial: summary.fondoInicial,
        responsable: responsible,
        timestamp: new Date().toISOString(),
        totalCashExpenses: summary.totalCashExpenses,
        totalElectronicExpenses: summary.totalElectronicExpenses,
        totalCashSales: summary.totalCashSales,
        totalElectronicSales: summary.totalElectronicSales,
        totalSafe: summary.totalSafe,
    };

    // Revalida antes del set() definitivo: el get() de arriba fue un await real.
    const newPartialRef = ref(op.getDatabaseOrAbort(), `${localId}/CAJAS/${shift.date}/turnos/${shift.id}/parciales/${nextId}`);

    try {
        await set(newPartialRef, dataToSave);
        return { success: true, id: nextId, data: dataToSave };
    } catch (error) {
        console.error("Error saving partial close data:", error);
        throw error;
    }
};