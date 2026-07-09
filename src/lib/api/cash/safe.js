import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';
import { format } from 'date-fns';
import { getDatabase, ref, get, set } from 'firebase/database';

export const saveToSafe = async (shift, safeData, performSave = true) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();

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
        const newEntryRef = ref(db, `${LOCAL_ID}/CAJAS/${shift.date}/turnos/${shift.id}/CAJAFUERTE/${nextId}`);
        await set(newEntryRef, dataToSave);
        return { nextId, dataToSave };
    }

    return { nextId, dataToSave };
};