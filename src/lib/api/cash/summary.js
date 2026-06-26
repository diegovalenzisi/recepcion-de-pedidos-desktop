
import { getDatabase, ref, set, update } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { formatDateForFirebase } from '@/lib/utils';

export const updateShiftSummary = async (summaryData) => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const db = getDatabase();

    const summaryRef = ref(db, `${localId}/RESUMEN_TURNO`);

    try {
        await set(summaryRef, summaryData);
    } catch (error) {
        console.error("Error updating shift summary in Firebase:", error);
        throw new Error("Could not update shift summary.");
    }
};

export const saveShiftSummaryToPath = async (localId, dateString, shiftNumber, summaryData) => {
    if (!localId || !dateString || !shiftNumber) {
        console.error("Missing required parameters for saveShiftSummaryToPath");
        return;
    }
    
    // Ensure dateString is correctly formatted to dd-mm-aaaa, fallback to today's date if needed
    const formattedDate = dateString || formatDateForFirebase(new Date());
    
    const db = getDatabase();
    const summaryRef = ref(db, `${localId}/CAJAS/${formattedDate}/turnos/${shiftNumber}`);

    try {
        await update(summaryRef, summaryData);
        console.log(`Shift summary successfully saved to path: /${localId}/CAJAS/${formattedDate}/turnos/${shiftNumber}`);
    } catch (error) {
        console.error("Error saving shift summary to path:", error);
        throw new Error("Could not save shift summary to path.");
    }
};
