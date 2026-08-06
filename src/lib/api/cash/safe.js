import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { format } from 'date-fns';
import { getDatabase, ref, get, set } from 'firebase/database';

export const saveToSafe = async (shift, safeData, performSave = true) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

    if (!shift || !shift.id || !shift.date) {
        throw new Error("Datos del turno inválidos para guardar en caja fuerte.");
    }

    const now = new Date();
    const dataToSave = {
        ...safeData,
        fechacaja: shift.date,
        fecha: format(now, 'dd-MM-yyyy'),
        hora: format(now, 'HH:mm:ss')
    };

    const safeRef = ref(db, `${LOCAL_ID}/CAJAS/${shift.date}/turnos/${shift.id}/CAJAFUERTE`);

    const snapshot = await get(safeRef);
    const nextId = snapshot.exists() ? Object.keys(snapshot.val()).length + 1 : 1;

    if (performSave) {
        // Revalida antes del set() definitivo: el get() de arriba fue un await real.
        const newEntryRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/CAJAS/${shift.date}/turnos/${shift.id}/CAJAFUERTE/${nextId}`);
        await set(newEntryRef, dataToSave);
        return { nextId, dataToSave };
    }

    return { nextId, dataToSave };
};