
import { getDatabase, ref, get, set, remove, onValue, off, runTransaction } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';
import { getNextProviderId } from './providerIdUtils';

/**
 * Providers API Module
 * Manages providers (suppliers) and their remitos (delivery receipts/invoices)
 */

/**
 * Helper function to format date to dd-mm-aaaa format
 */
const formatDateToDDMMAAAA = (dateString) => {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  const [year, month, day] = parts;
  return `${day}-${month}-${year}`; // Returns dd-mm-aaaa
};

/**
 * Helper function to parse dd-mm-aaaa back to yyyy-mm-dd
 */
const parseDDMMAAAAtoYYYYMMDD = (dateString) => {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  const [day, month, year] = parts;
  return `${year}-${month}-${day}`;
};

/**
 * Generate a sequential, unique numeroRemito (Kept for backwards compatibility if needed, but manual entry is now preferred)
 */
export const getNextRemitoId = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  const counterRef = ref(db, `${LOCAL_ID}/PROVEEDORES/counter`);

  try {
    const result = await runTransaction(counterRef, (currentData) => {
      if (currentData === null) {
        return 1;
      }
      return currentData + 1;
    });

    if (result.committed) {
      return result.snapshot.val().toString();
    } else {
      throw new Error('Transaction aborted');
    }
  } catch (error) {
    console.error('[Providers API] Error in transaction for next remito ID, falling back to manual get/set', error);
    const snap = await get(counterRef);
    const nextId = (snap.val() || 0) + 1;
    await set(counterRef, nextId);
    return nextId.toString();
  }
};

/**
 * Check if a remito number already exists
 */
export const checkRemitoExists = async (numeroRemito) => {
  if (!numeroRemito) return false;
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const newRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${numeroRemito}`);
    const snapshot = await get(newRef);
    return snapshot.exists();
  } catch (error) {
    console.error('[Providers API] Error checking remito existence:', error);
    return false;
  }
};

/**
 * Fetch all providers
 */
export const fetchProviders = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const providersRef = ref(db, `${LOCAL_ID}/PROVEEDORES_META`);
    const snapshot = await get(providersRef);
    
    if (!snapshot.exists()) return [];
    
    const providersData = snapshot.val();
    return Object.keys(providersData)
      .filter(key => key !== 'nextProviderId') // Ignore counter
      .map(key => ({
        id: key,
        ...providersData[key]
      })).sort((a, b) => {
        const aId = parseInt(a.id, 10);
        const bId = parseInt(b.id, 10);
        if (!isNaN(aId) && !isNaN(bId)) {
          return aId - bId;
        }
        return (a.nombre || '').localeCompare(b.nombre || '');
      });
  } catch (error) {
    console.error('[Providers API] Error fetching providers:', error);
    throw new Error('No se pudieron cargar los proveedores');
  }
};

/**
 * Save a new provider using sequential ID
 */
export const saveProvider = async (providerData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const newId = await getNextProviderId();
    const newProviderRef = ref(db, `${LOCAL_ID}/PROVEEDORES_META/${newId}`);
    
    const dataToSave = {
      nombre: providerData.nombre,
      telefono: providerData.telefono || '',
      email: providerData.email || '',
      direccion: providerData.direccion || '',
      cuit: providerData.cuit || '',
      notas: providerData.notas || '',
      fechaCreacion: Date.now(),
      activo: true
    };
    
    await set(newProviderRef, dataToSave);
    
    return { id: newId, ...dataToSave };
  } catch (error) {
    console.error('[Providers API] Error saving provider:', error);
    throw new Error('No se pudo guardar el proveedor');
  }
};

/**
 * Update an existing provider
 */
export const updateProvider = async (providerId, providerData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const providerRef = ref(db, `${LOCAL_ID}/PROVEEDORES_META/${providerId}`);
    
    const dataToUpdate = {
      nombre: providerData.nombre,
      telefono: providerData.telefono || '',
      email: providerData.email || '',
      direccion: providerData.direccion || '',
      cuit: providerData.cuit || '',
      notas: providerData.notas || '',
      fechaModificacion: Date.now()
    };
    
    await set(providerRef, { ...providerData, ...dataToUpdate });
  } catch (error) {
    console.error('[Providers API] Error updating provider:', error);
    throw new Error('No se pudo actualizar el proveedor');
  }
};

/**
 * Delete a provider
 */
export const deleteProvider = async (providerId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const providerRef = ref(db, `${LOCAL_ID}/PROVEEDORES_META/${providerId}`);
    await remove(providerRef);
  } catch (error) {
    console.error('[Providers API] Error deleting provider:', error);
    throw new Error('No se pudo eliminar el proveedor');
  }
};

/**
 * Fetch all remitos for a specific provider
 * Works with both new global structure and backwards compatible provider-nested structure
 */
export const fetchRemitos = async (providerId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const remitosRef = ref(db, `${LOCAL_ID}/PROVEEDORES`);
    const snapshot = await get(remitosRef);
    
    if (!snapshot.exists()) return [];
    
    const allData = snapshot.val();
    const remitosList = [];
    
    Object.keys(allData).forEach(key => {
      if (key === 'counter') return;
      
      const nodeData = allData[key];
      // New structure
      if (nodeData && nodeData.idProveedor === String(providerId)) {
        remitosList.push({
          id: key,
          ...nodeData
        });
      }
      // Old structure
      else if (key === String(providerId) && typeof nodeData === 'object' && !nodeData.idProveedor) {
        Object.keys(nodeData).forEach(dateKey => {
          if (typeof nodeData[dateKey] === 'object') {
            remitosList.push({
              id: dateKey,
              idProveedor: providerId,
              numeroRemito: nodeData[dateKey].numero,
              ...nodeData[dateKey]
            });
          }
        });
      }
    });
    
    return remitosList.sort((a, b) => {
      const dateA = new Date(parseDDMMAAAAtoYYYYMMDD(a.fecha) || 0);
      const dateB = new Date(parseDDMMAAAAtoYYYYMMDD(b.fecha) || 0);
      return dateB - dateA;
    });
  } catch (error) {
    console.error('[Providers API] Error fetching remitos:', error);
    throw new Error('No se pudieron cargar los remitos');
  }
};

/**
 * Save a new remito for a provider (New Flat Structure)
 */
export const saveRemito = async (providerId, remitoData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const numeroRemito = String(remitoData.numeroRemito).trim();
    if (!numeroRemito) throw new Error('El número de remito es obligatorio');
    
    const exists = await checkRemitoExists(numeroRemito);
    if (exists) throw new Error('El número de remito ya existe');

    const fechaFormato = formatDateToDDMMAAAA(remitoData.fecha);
    if (!fechaFormato) throw new Error('La fecha del remito es obligatoria');
    
    const remitoRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${numeroRemito}`);
    
    const dataToSave = {
      numeroRemito: numeroRemito,
      idProveedor: String(providerId),
      fecha: fechaFormato,
      monto: parseFloat(remitoData.monto) || 0,
      descripcion: remitoData.descripcion || '',
      items: (remitoData.items || []).map(item => {
        const cantStr = item.cantidad ? item.cantidad.toString().replace(',', '.') : '0';
        return {
          descripcion: item.descripcion || '',
          cantidad: Number(parseFloat(cantStr).toFixed(3)),
          precioUnitario: parseFloat(item.precioUnitario) || 0
        };
      }),
      fechaCreacion: Date.now()
    };
    
    await set(remitoRef, dataToSave);
    
    return {
      id: numeroRemito,
      ...dataToSave
    };
  } catch (error) {
    console.error('[Providers API] Error saving remito:', error);
    throw new Error(error.message || 'No se pudo guardar el remito');
  }
};

/**
 * Update an existing remito
 */
export const updateRemito = async (providerId, remitoId, remitoData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const fechaFormato = formatDateToDDMMAAAA(remitoData.fecha);
    if (!fechaFormato) throw new Error('La fecha del remito es obligatoria');
    
    const dataToUpdate = {
      fecha: fechaFormato,
      monto: parseFloat(remitoData.monto) || 0,
      descripcion: remitoData.descripcion || '',
      items: (remitoData.items || []).map(item => {
        const cantStr = item.cantidad ? item.cantidad.toString().replace(',', '.') : '0';
        return {
          descripcion: item.descripcion || '',
          cantidad: Number(parseFloat(cantStr).toFixed(3)),
          precioUnitario: parseFloat(item.precioUnitario) || 0
        };
      }),
      fechaModificacion: Date.now()
    };

    // Verify if it's new structure
    const newRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${remitoId}`);
    const newSnap = await get(newRef);
    
    if (newSnap.exists() && newSnap.val().idProveedor) {
      await set(newRef, { ...newSnap.val(), ...remitoData, ...dataToUpdate });
    } else {
      // Legacy Structure
      const oldRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${providerId}/${remitoId}`);
      const oldSnap = await get(oldRef);
      if (oldSnap.exists()) {
        if (remitoId !== fechaFormato) {
          // Date changed on old structure, move to new date node
          const newOldRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${providerId}/${fechaFormato}`);
          await set(newOldRef, { ...oldSnap.val(), ...remitoData, ...dataToUpdate });
          await remove(oldRef);
        } else {
          await set(oldRef, { ...oldSnap.val(), ...remitoData, ...dataToUpdate });
        }
      }
    }
  } catch (error) {
    console.error('[Providers API] Error updating remito:', error);
    throw new Error(error.message || 'No se pudo actualizar el remito');
  }
};

/**
 * Delete a remito
 */
export const deleteRemito = async (providerId, remitoId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    if (!remitoId) throw new Error('ID de remito inválido');
    
    // Attempt delete in new structure first
    const newRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${remitoId}`);
    const newSnap = await get(newRef);
    
    if (newSnap.exists() && newSnap.val().idProveedor) {
      await remove(newRef);
    } else {
      // Fallback to legacy structure
      const oldRef = ref(db, `${LOCAL_ID}/PROVEEDORES/${providerId}/${remitoId}`);
      await remove(oldRef);
    }
  } catch (error) {
    console.error('[Providers API] Error deleting remito:', error);
    throw new Error('No se pudo eliminar el remito');
  }
};

/**
 * Listen to real-time updates for all providers
 */
export const listenToProviders = (callback) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  const providersRef = ref(db, `${LOCAL_ID}/PROVEEDORES_META`);
  
  const listener = onValue(providersRef, (snapshot) => {
    const providersData = snapshot.val();
    
    if (!providersData) {
      callback([]);
      return;
    }
    
    const providersList = Object.keys(providersData)
      .filter(key => key !== 'nextProviderId')
      .map(key => ({
        id: key,
        ...providersData[key]
      })).sort((a, b) => {
        const aId = parseInt(a.id, 10);
        const bId = parseInt(b.id, 10);
        if (!isNaN(aId) && !isNaN(bId)) {
          return aId - bId;
        }
        return (a.nombre || '').localeCompare(b.nombre || '');
      });
    
    callback(providersList);
  }, (error) => {
    console.error('[Providers API] Listener error:', error);
    callback([]);
  });
  
  return () => off(providersRef, 'value', listener);
};

/**
 * Listen to real-time updates for remitos of a specific provider
 */
export const listenToRemitos = (providerId, callback) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  const remitosRef = ref(db, `${LOCAL_ID}/PROVEEDORES`);
  
  const listener = onValue(remitosRef, (snapshot) => {
    const allData = snapshot.val();
    
    if (!allData) {
      callback([]);
      return;
    }
    
    const remitosList = [];
    
    Object.keys(allData).forEach(key => {
      if (key === 'counter') return;
      
      const nodeData = allData[key];
      // New flat structure
      if (nodeData && String(nodeData.idProveedor) === String(providerId)) {
        remitosList.push({
          id: key,
          ...nodeData
        });
      }
      // Old provider-nested structure
      else if (key === String(providerId) && typeof nodeData === 'object' && !nodeData.idProveedor) {
        Object.keys(nodeData).forEach(dateKey => {
          if (typeof nodeData[dateKey] === 'object') {
            remitosList.push({
              id: dateKey,
              idProveedor: providerId,
              numeroRemito: nodeData[dateKey].numero,
              ...nodeData[dateKey]
            });
          }
        });
      }
    });
    
    const sortedList = remitosList.sort((a, b) => {
      const dateA = new Date(parseDDMMAAAAtoYYYYMMDD(a.fecha) || 0);
      const dateB = new Date(parseDDMMAAAAtoYYYYMMDD(b.fecha) || 0);
      return dateB - dateA;
    });
    
    callback(sortedList);
  }, (error) => {
    console.error('[Providers API] Remitos listener error:', error);
    callback([]);
  });
  
  return () => off(remitosRef, 'value', listener);
};
