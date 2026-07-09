
import { getDatabase, ref, get, set, runTransaction, remove, update } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';

/**
 * Initializes the provider ID counter if it doesn't exist
 */
export const initializeProviderIdCounter = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/PROVEEDORES`);
  
  const snapshot = await get(counterRef);
  if (!snapshot.exists()) {
    await set(counterRef, 1);
    return 1;
  }
  return snapshot.val();
};

/**
 * Gets the next available sequential provider ID and increments the counter
 */
export const getNextProviderId = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/PROVEEDORES`);
  
  let newId = null;
  await runTransaction(counterRef, (currentValue) => {
    if (currentValue === null) {
      newId = 1;
      return 2;
    }
    newId = currentValue;
    return currentValue + 1;
  });
  
  return newId.toString();
};

/**
 * Migrates existing providers with random IDs to sequential numeric IDs.
 * Also updates provider references in existing remitos.
 */
export const migrateProvidersToSequentialIds = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  const providersRef = ref(db, `${LOCAL_ID}/PROVEEDORES_META`);
  const providersSnapshot = await get(providersRef);
  
  if (!providersSnapshot.exists()) {
    return { migrated: 0, message: 'No hay proveedores para migrar.', mapping: {} };
  }
  
  const providersData = providersSnapshot.val();
  const allKeys = Object.keys(providersData);
  
  // Filter out those that are already purely numeric
  const isNumeric = (str) => /^\d+$/.test(str);
  const randomIdProviders = allKeys.filter(key => !isNumeric(key) && key !== 'nextProviderId');
  const numericIdProviders = allKeys.filter(key => isNumeric(key));
  
  if (randomIdProviders.length === 0) {
    return { migrated: 0, message: 'Todos los proveedores ya tienen IDs numéricos.', mapping: {} };
  }
  
  // Determine starting ID based on highest existing numeric ID
  let nextId = 1;
  if (numericIdProviders.length > 0) {
    nextId = Math.max(...numericIdProviders.map(id => parseInt(id, 10))) + 1;
  }
  
  const mapping = {};
  const updates = {};
  
  // Prepare provider updates
  for (const oldId of randomIdProviders) {
    const currentId = nextId++;
    const newIdStr = currentId.toString();
    mapping[oldId] = newIdStr;
    
    // Set new ID data
    updates[`${LOCAL_ID}/PROVEEDORES_META/${newIdStr}`] = providersData[oldId];
    // Delete old ID data
    updates[`${LOCAL_ID}/PROVEEDORES_META/${oldId}`] = null;
  }
  
  // Update remitos that reference these providers
  const remitosRef = ref(db, `${LOCAL_ID}/PROVEEDORES`);
  const remitosSnapshot = await get(remitosRef);
  
  if (remitosSnapshot.exists()) {
    const allRemitosData = remitosSnapshot.val();
    Object.keys(allRemitosData).forEach(numeroRemito => {
      const numeroNode = allRemitosData[numeroRemito];
      Object.keys(numeroNode).forEach(fechaFormato => {
        const remitoData = numeroNode[fechaFormato];
        if (remitoData.providerId && mapping[remitoData.providerId]) {
          updates[`${LOCAL_ID}/PROVEEDORES/${numeroRemito}/${fechaFormato}/providerId`] = mapping[remitoData.providerId];
        }
      });
    });
  }
  
  // Update the counter
  updates[`${LOCAL_ID}/CONTADORES/PROVEEDORES`] = nextId;
  
  // Apply all updates transactionally
  await update(ref(db), updates);
  
  return {
    migrated: randomIdProviders.length,
    message: `Se han migrado exitosamente ${randomIdProviders.length} proveedores a IDs numéricos.`,
    mapping
  };
};
