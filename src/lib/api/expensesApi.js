import { getDatabase, ref, get, set, push, remove, runTransaction, onValue } from 'firebase/database';
import { getLocalId, getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { format } from 'date-fns';

const getShiftExpensesRef = (shiftDate, shiftId, path = '') => {
    const db = getDatabase();
    const localId = getLocalId();
    if (!localId) throw new Error("Local ID no está configurado.");
    return ref(db, `${localId}/CAJAS/${shiftDate}/turnos/${shiftId}/gastos/${path}`);
};

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
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();

    if (!shift || !shift.id || !shift.date) {
        throw new Error("Datos del turno inválidos.");
    }

    const expenseId = await getNextExpenseId(db, LOCAL_ID);
    
    // Create a copy to modify
    const cleanExpenseData = { ...expenseData };
    // Ensure 'fecha' is not part of the object saved to the database.
    delete cleanExpenseData.fecha;

    const expenseWithId = { 
        ...cleanExpenseData,
        id: expenseId, 
        fechaCaja: shift.date,
        empleado: expenseData.empleado || 'No especificado'
    };

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

export const deleteExpenseFromShift = async (shift, expenseId) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentLocalId();

    if (!shift || !shift.id || !shift.date) {
        throw new Error("Datos del turno inválidos.");
    }

    const expensePath = `${API_URL}/${LOCAL_ID}/CAJAS/${shift.date}/turnos/${shift.id}/gastos/${expenseId}.json`;

    const response = await fetch(expensePath, {
        method: 'DELETE'
    });

    if(!response.ok) {
        throw new Error("No se pudo eliminar el gasto de la base de datos.");
    }
};

export const listenToShiftExpenses = (shift, callback) => {
    if (!shift || !shift.id || !shift.date) {
        callback([]);
        return () => {};
    }
    const expensesRef = getShiftExpensesRef(shift.date, shift.id);
    const unsubscribe = onValue(expensesRef, (snapshot) => {
        const expensesData = snapshot.val();
        if (expensesData) {
            const expensesList = Object.keys(expensesData).map(key => ({
                id: key,
                ...expensesData[key]
            })).sort((a, b) => {
                // Sort by ID descending if timestamp is not available
                return parseInt(b.id, 10) - parseInt(a.id, 10);
            });
            callback(expensesList);
        } else {
            callback([]);
        }
    });
    return unsubscribe;
};