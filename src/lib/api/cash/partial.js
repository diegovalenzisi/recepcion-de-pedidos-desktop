import { getDatabase, ref, get, set } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

export const savePartialClose = async (shift, summary, responsible) => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const db = getDatabase();

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
    
    const newPartialRef = ref(db, `${localId}/CAJAS/${shift.date}/turnos/${shift.id}/parciales/${nextId}`);

    try {
        await set(newPartialRef, dataToSave);
        return { success: true, id: nextId, data: dataToSave };
    } catch (error) {
        console.error("Error saving partial close data:", error);
        throw error;
    }
};