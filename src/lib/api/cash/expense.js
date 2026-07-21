import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { getDatabase, ref, runTransaction } from 'firebase/database';

const getNextExpenseId = async (db, localId) => {
    const expenseCounterRef = ref(db, `${localId}/CONTADORES/gastos`);
    const { committed, snapshot } = await runTransaction(expenseCounterRef, (currentValue) => {
        return (currentValue || 0) + 1;
    });

    if (!committed) {
        throw new Error("No se pudo obtener el siguiente ID de gasto.");
    }
    return snapshot.val();
};

export const addExpenseToShift = async (shift, expenseData) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation(LOCAL_ID);
    const db = op.getDatabaseOrAbort();

    if (!shift || !shift.id || !shift.date) {
        throw new Error("Datos del turno inválidos.");
    }

    const expenseId = await getNextExpenseId(db, LOCAL_ID);
    const expenseWithId = {
        ...expenseData,
        id: expenseId,
        fechaCaja: shift.date,
    };

    // Revalida antes del PUT definitivo: getNextExpenseId() de arriba hizo su
    // propia transacción (await real).
    op.getDatabaseOrAbort();
    const expensePath = `${API_URL}/${LOCAL_ID}/CAJAS/${shift.date}/turnos/${shift.id}/gastos/${expenseId}.json`;

    const response = await fetch(expensePath, {
        method: 'PUT',
        body: JSON.stringify(expenseWithId)
    });

    if(!response.ok) {
        throw new Error("No se pudo registrar el gasto en la base de datos.");
    }
    return await response.json();
};

export const fetchExpensesForShift = async (shift) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();

    if (!shift || !shift.id || !shift.date) {
        console.error("Invalid shift data for fetching expenses:", shift);
        return {};
    }

    const expensesPath = `${API_URL}/${LOCAL_ID}/CAJAS/${shift.date}/turnos/${shift.id}/gastos.json`;

    try {
        const response = await fetch(expensesPath);
        if (!response.ok) {
            if (response.status === 404) {
                return {};
            }
            throw new Error(`Network response was not ok for expenses: ${response.statusText}`);
        }
        const data = await response.json();
        return data || {};
    } catch (error) {
        console.error("Error fetching expenses for shift:", error);
        return {};
    }
};