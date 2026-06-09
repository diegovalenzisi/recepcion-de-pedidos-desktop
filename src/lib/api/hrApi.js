import { getDatabase, ref, get, set, push, remove, runTransaction, update } from 'firebase/database';
import { getLocalId } from '@/lib/firebase/core';
import { addExpenseToShift } from '@/lib/api/expensesApi';
import { format } from 'date-fns';

const getHrRef = (path) => {
  const db = getDatabase();
  const localId = getLocalId();
  if (!localId) throw new Error("Local ID no está configurado.");
  return ref(db, `${localId}/RRHH/${path}`);
};

const getHistorialRef = (path) => {
  const db = getDatabase();
  const localId = getLocalId();
  if (!localId) throw new Error("Local ID no está configurado.");
  return ref(db, `${localId}/HISTORIAL/${path}`);
}

const getNextId = async (counterName) => {
  const db = getDatabase();
  const localId = getLocalId();
  const counterRef = ref(db, `${localId}/CONTADORES/${counterName}`);
  const { committed, snapshot } = await runTransaction(counterRef, (currentValue) => {
    return (currentValue || 0) + 1;
  });
  if (!committed) {
    throw new Error(`No se pudo generar el siguiente ID para ${counterName}.`);
  }
  return snapshot.val();
};

// --- Employee Functions ---

export const fetchEmployees = async () => {
  const employeesRef = getHrRef('EMPLEADOS');
  const snapshot = await get(employeesRef);
  if (snapshot.exists()) {
    const data = snapshot.val();
    return Object.entries(data).map(([legajo, value]) => ({ legajo, ...value }));
  }
  return [];
};

export const fetchVendorsByCategory = async () => {
  try {
    const employees = await fetchEmployees();
    return employees
      .filter(emp => emp.categoriaNombre && emp.categoriaNombre.toUpperCase() === 'VENDEDOR')
      .map(emp => ({
        legajo: emp.legajo,
        nombre: emp.nombre || '',
        apellido: emp.apellido || '',
        categoriaNombre: emp.categoriaNombre
      }))
      .sort((a, b) => {
        const aName = `${a.nombre} ${a.apellido}`.trim();
        const bName = `${b.nombre} ${b.apellido}`.trim();
        return aName.localeCompare(bName);
      });
  } catch (error) {
    console.error("Error fetching vendors by category:", error);
    return [];
  }
};

export const saveEmployee = async (employeeData, isEditing) => {
  const db = getDatabase();
  const localId = getLocalId();
  let legajo;
  if (isEditing && employeeData.legajo) {
    legajo = employeeData.legajo;
  } else {
    legajo = await getNextId('legajo_empleado');
  }

  const employeeRef = ref(db, `${localId}/RRHH/EMPLEADOS/${legajo}`);
  
  // Ensure "estado" field is present and defaults to "activo" if missing (e.g. for new employees)
  const dataToSave = { 
    ...employeeData, 
    legajo,
    estado: employeeData.estado || 'activo' 
  };
  
  await set(employeeRef, dataToSave);
  return dataToSave;
};

export const deleteEmployee = async (legajo) => {
  const employeeRef = ref(getDatabase(), `${getLocalId()}/RRHH/EMPLEADOS/${legajo}`);
  await remove(employeeRef);
};


// --- Payment Functions ---

export const savePaymentHistory = async (employeeName, accumulatedData, paymentMethod, shiftDate) => {
    const employeeNameKey = employeeName.replace(/[.#$[\]]/g, '_');
    const dateKey = shiftDate;

    const historyCounterRef = getHistorialRef(`CONTADORES/PAGOS_EMPLEADOS/${employeeNameKey}`);
    const { committed, snapshot } = await runTransaction(historyCounterRef, (currentValue) => {
        return (currentValue || 0) + 1;
    });

    if (!committed) {
        throw new Error("No se pudo generar el número de pago para el historial.");
    }
    const paymentNumber = snapshot.val();

    const historyRef = getHistorialRef(`PAGOS/${dateKey}/${employeeNameKey}/${paymentNumber}`);
    
    const details = {};
    Object.keys(accumulatedData).forEach(key => {
        if (key !== 'totalAcumulado' && key !== 'contadorPagos') {
            const date = key;
            const entries = accumulatedData[date];
            details[date] = {};
            Object.keys(entries).forEach(entryKey => {
                details[date][entryKey] = entries[entryKey];
            });
        }
    });

    const historyData = {
        fechaPago: new Date().toISOString(),
        metodoPago: paymentMethod,
        totalPagado: accumulatedData.totalAcumulado,
        detalle: details
    };
    
    await set(historyRef, historyData);
};


export const fetchHRPayments = async () => {
  const paymentsRef = getHrRef('PAGOS');
  const snapshot = await get(paymentsRef);
  if (snapshot.exists()) {
    const data = snapshot.val();
    return Object.entries(data).map(([id, value]) => ({ id, ...value })).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }
  return [];
};

export const saveHRPayment = async (paymentData, isEditing, currentShift, allEmployees) => {
  const db = getDatabase();
  const localId = getLocalId();
  let paymentId;

  if (isEditing && paymentData.id) {
    paymentId = paymentData.id;
  } else {
    paymentId = await getNextId('rrhh_pagos');
  }

  const paymentRef = ref(db, `${localId}/RRHH/PAGOS/${paymentId}`);
  
  const employee = allEmployees.find(e => e.legajo === paymentData.employeeId);
  const employeeName = employee ? `${employee.nombre} ${employee.apellido}` : 'Desconocido';

  const dataToSave = { ...paymentData, id: paymentId, employeeName: employeeName };

  await set(paymentRef, dataToSave);

  if (currentShift && currentShift.estado === 'abierto') {
      const expenseData = {
        concepto: paymentData.concepto,
        monto: paymentData.monto,
        timestamp: paymentData.fecha,
        paymentMethod: paymentData.paymentMethod,
        origen: 'RRHH',
        empleado: dataToSave.employeeName,
        status: 'Pagado',
      };
      await addExpenseToShift(currentShift, expenseData);
  }
  
  if (paymentData.type === 'pago_acumulado' && currentShift?.date) {
    const employeeNameKey = dataToSave.employeeName.replace(/[.#$[\]]/g, '_');
    const accumulatedRef = getHrRef(`ACUMULATIVO/${employeeNameKey}`);
    
    const snapshot = await get(accumulatedRef);
    if (snapshot.exists()) {
      const accumulatedVal = snapshot.val();
      const dateKey = currentShift.date;
      const archiveRef = getHrRef(`PAGOACUMULATIVO/${dateKey}/${employeeNameKey}`);
      
      await set(archiveRef, accumulatedVal);
      await remove(accumulatedRef);
    }
  }
};

export const deleteHRPayment = async (paymentId) => {
  const paymentRef = ref(getDatabase(), `${getLocalId()}/RRHH/PAGOS/${paymentId}`);
  await remove(paymentRef);
};

export const accumulateHRPayment = async (paymentData, employeeName, currentShift) => {
    const { monto, descripcion } = paymentData;
    
    if (!currentShift || !currentShift.date) {
        throw new Error("No hay un turno activo con fecha de caja válida para acumular el pago.");
    }
    const dateKey = currentShift.date;
    
    const employeeNameKey = employeeName.replace(/[.#$[\]]/g, '_');
    const accumulatedRef = getHrRef(`ACUMULATIVO/${employeeNameKey}`);

    const snapshot = await get(accumulatedRef);
    const currentData = snapshot.val() || { totalAcumulado: 0, contadorPagos: 0 };
    const newTotal = (currentData.totalAcumulado || 0) + monto;
    const nextPaymentIndex = (currentData.contadorPagos || 0) + 1;

    const updates = {};
    
    const entryData = {
        descripcion: descripcion,
        monto: monto
    };
    
    updates[`${dateKey}/${nextPaymentIndex}`] = entryData;
    updates['totalAcumulado'] = newTotal;
    updates['contadorPagos'] = nextPaymentIndex;
    
    await update(accumulatedRef, updates);

    if (currentShift && currentShift.estado === 'abierto') {
      const expenseData = {
        concepto: entryData.descripcion,
        monto: monto,
        timestamp: new Date().toISOString(),
        paymentMethod: 'acumulado',
        origen: 'RRHH',
        empleado: employeeName,
        status: 'A Pagar',
      };
      await addExpenseToShift(currentShift, expenseData);
    }
};

export const fetchAccumulatedDataForEmployee = async (employeeId, employees) => {
    if (!employeeId || !employees) return null;
    const employee = employees.find(e => e.legajo === employeeId);
    if (!employee) return null;
    
    const employeeName = `${employee.nombre} ${employee.apellido}`;
    const employeeNameKey = employeeName.replace(/[.#$[\]]/g, '_');
    
    const accumulatedRef = getHrRef(`ACUMULATIVO/${employeeNameKey}`);
    const snapshot = await get(accumulatedRef);
    if (snapshot.exists()) {
        return snapshot.val();
    }
    return null;
};

// --- Category Functions ---

export const fetchCategories = async () => {
  const categoriesRef = getHrRef('CATEGORIAS');
  const snapshot = await get(categoriesRef);
  if (snapshot.exists()) {
    const data = snapshot.val();
    return Object.entries(data).map(([id, value]) => ({ id, ...value }));
  }
  return [];
};

export const saveCategory = async (categoryData, isEditing) => {
  const db = getDatabase();
  const localId = getLocalId();
  let categoryId;

  if (isEditing && categoryData.id) {
    categoryId = categoryData.id;
  } else {
    categoryId = await getNextId('rrhh_categorias');
  }

  const categoryRef = ref(db, `${localId}/RRHH/CATEGORIAS/${categoryId}`);
  const dataToSave = { ...categoryData, id: categoryId };
  await set(categoryRef, dataToSave);
  return dataToSave;
};

export const deleteCategory = async (categoryId) => {
  const categoryRef = ref(getDatabase(), `${getLocalId()}/RRHH/CATEGORIAS/${categoryId}`);
  await remove(categoryRef);
};