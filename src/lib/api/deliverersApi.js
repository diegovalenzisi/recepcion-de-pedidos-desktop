import { getDatabase, ref, get, set, remove, runTransaction } from 'firebase/database';
import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

const getNextDelivererId = async () => {
    checkLocalId();
    const db = getDatabase();
    const localId = getCurrentLocalId();
    const counterRef = ref(db, `${localId}/CONTADORES/repartidor`);
    const { committed, snapshot } = await runTransaction(counterRef, (currentValue) => {
        return (currentValue || 0) + 1;
    });
    if (!committed) {
        throw new Error("No se pudo generar el ID del repartidor.");
    }
    return snapshot.val();
};

export const fetchDeliverers = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  try {
    const response = await fetch(`${FIREBASE_URL}/${LOCAL_ID}/REPARTIDORES.json`);
    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    if (!data) return [];
    return Object.entries(data)
      .map(([id, value]) => ({ id, ...value }))
      .filter(d => d && d.id && d.nombre);
  } catch (error) {
    console.error("Error fetching deliverers:", error);
    throw error;
  }
};

export const saveDeliverer = async (delivererData, isEditing) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  
  try {
    let delivererId;
    if (isEditing && delivererData.id) {
        delivererId = delivererData.id;
    } else {
        delivererId = await getNextDelivererId();
    }
  
    const dataToSave = { ...delivererData, id: delivererId };

    const delivererRef = ref(db, `${LOCAL_ID}/REPARTIDORES/${delivererId}`);
    await set(delivererRef, dataToSave);
    
    return dataToSave;
  } catch (error) {
    console.error("Error saving deliverer:", error);
    throw error;
  }
};

export const deleteDeliverer = async (delivererId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  try {
    const delivererRef = ref(db, `${LOCAL_ID}/REPARTIDORES/${delivererId}`);
    await remove(delivererRef);
    return true;
  } catch (error) {
    console.error("Error deleting deliverer:", error);
    throw error;
  }
};