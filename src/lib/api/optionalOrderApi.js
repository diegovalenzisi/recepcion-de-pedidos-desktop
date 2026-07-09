import { getDatabase, ref, get, set } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';

/**
 * Optional Order API Module
 * Manages the saved order of optional items for each group in Firebase
 * Path: /CONFIGURACION/ORDEN_OPCIONALES/{groupId}/
 */

/**
 * Save the order of optional items for a specific group
 * @param {string} groupId - The group ID (e.g., "GUSTOS", "TOPPINGS")
 * @param {Array<string>} orderedItemIds - Array of optional item IDs in the desired order
 * @returns {Promise<void>}
 */
export const saveOptionalOrder = async (groupId, orderedItemIds) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  if (!groupId || !orderedItemIds || !Array.isArray(orderedItemIds)) {
    console.warn('[Optional Order API] Invalid parameters for saveOptionalOrder');
    return;
  }
  
  try {
    const orderRef = ref(db, `${LOCAL_ID}/CONFIGURACION/ORDEN_OPCIONALES/${groupId}`);
    
    const dataToSave = {
      order: orderedItemIds,
      lastUpdated: Date.now()
    };
    
    await set(orderRef, dataToSave);
    
    console.log(`[Optional Order API] Order saved for group: ${groupId}`, orderedItemIds);
  } catch (error) {
    console.error('[Optional Order API] Error saving optional order:', error);
    throw new Error(`No se pudo guardar el orden de opcionales para el grupo ${groupId}`);
  }
};

/**
 * Fetch the saved order of optional items for a specific group
 * @param {string} groupId - The group ID (e.g., "GUSTOS", "TOPPINGS")
 * @returns {Promise<Array<string>|null>} - Array of optional item IDs in saved order, or null if not found
 */
export const fetchOptionalOrder = async (groupId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  if (!groupId) {
    console.warn('[Optional Order API] Invalid groupId for fetchOptionalOrder');
    return null;
  }
  
  try {
    const orderRef = ref(db, `${LOCAL_ID}/CONFIGURACION/ORDEN_OPCIONALES/${groupId}`);
    const snapshot = await get(orderRef);
    
    if (!snapshot.exists()) {
      console.log(`[Optional Order API] No saved order found for group: ${groupId}`);
      return null;
    }
    
    const data = snapshot.val();
    
    if (data && Array.isArray(data.order)) {
      console.log(`[Optional Order API] Order fetched for group: ${groupId}`, data.order);
      return data.order;
    }
    
    return null;
  } catch (error) {
    console.error('[Optional Order API] Error fetching optional order:', error);
    // Return null instead of throwing to allow fallback to default order
    return null;
  }
};

/**
 * Save orders for multiple groups at once
 * @param {Object} ordersMap - Object where keys are groupIds and values are ordered item ID arrays
 * @returns {Promise<void>}
 */
export const saveMultipleOptionalOrders = async (ordersMap) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  if (!ordersMap || typeof ordersMap !== 'object') {
    console.warn('[Optional Order API] Invalid ordersMap for saveMultipleOptionalOrders');
    return;
  }
  
  try {
    const ordersRef = ref(db, `${LOCAL_ID}/CONFIGURACION/ORDEN_OPCIONALES`);
    
    const dataToSave = {};
    Object.entries(ordersMap).forEach(([groupId, orderedItemIds]) => {
      if (Array.isArray(orderedItemIds) && orderedItemIds.length > 0) {
        dataToSave[groupId] = {
          order: orderedItemIds,
          lastUpdated: Date.now()
        };
      }
    });
    
    if (Object.keys(dataToSave).length === 0) {
      console.log('[Optional Order API] No valid orders to save');
      return;
    }
    
    await set(ordersRef, dataToSave);
    
    console.log('[Optional Order API] Multiple orders saved:', Object.keys(dataToSave));
  } catch (error) {
    console.error('[Optional Order API] Error saving multiple optional orders:', error);
    throw new Error('No se pudo guardar el orden de opcionales');
  }
};

/**
 * Fetch all saved orders for all groups
 * @returns {Promise<Object>} - Object where keys are groupIds and values are ordered item ID arrays
 */
export const fetchAllOptionalOrders = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const ordersRef = ref(db, `${LOCAL_ID}/CONFIGURACION/ORDEN_OPCIONALES`);
    const snapshot = await get(ordersRef);
    
    if (!snapshot.exists()) {
      console.log('[Optional Order API] No saved orders found');
      return {};
    }
    
    const allData = snapshot.val();
    const ordersMap = {};
    
    Object.entries(allData).forEach(([groupId, data]) => {
      if (data && Array.isArray(data.order)) {
        ordersMap[groupId] = data.order;
      }
    });
    
    console.log('[Optional Order API] All orders fetched:', Object.keys(ordersMap));
    return ordersMap;
  } catch (error) {
    console.error('[Optional Order API] Error fetching all optional orders:', error);
    return {};
  }
};