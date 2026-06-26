import { getDatabase, ref, set, get } from 'firebase/database';
import { initializeApp, getApps } from 'firebase/app';

// Base Firebase configuration for the central IDs database
const IDS_DB_CONFIG = {
  apiKey: "AIzaSyDFsKxM8F5v9YqJxT8pYxQZvLzRxNmWqKs",
  projectId: "achava3703",
  databaseURL: "https://achava3703-default-rtdb.firebaseio.com",
  storageBucket: "achava3703.firebasestorage.app",
};

// Initialize or get the IDs database app instance
const getIDsDBApp = () => {
  const existingApp = getApps().find(app => app.name === 'ids-db');
  if (existingApp) {
    return existingApp;
  }
  return initializeApp(IDS_DB_CONFIG, 'ids-db');
};

/**
 * Saves local configuration to the central IDs database
 * @param {string} numeroLocal - Local number/ID
 * @param {string} firebaseDatabase - Firebase database URL
 * @param {string} firebaseStorage - Firebase storage bucket
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const saveLocalConfiguration = async (numeroLocal, firebaseDatabase, firebaseStorage) => {
  try {
    if (!numeroLocal || !firebaseDatabase || !firebaseStorage) {
      return { success: false, error: 'Todos los campos son obligatorios' };
    }

    const app = getIDsDBApp();
    const db = getDatabase(app);
    const configRef = ref(db, `ids/${numeroLocal}`);

    const configData = {
      numeroLocal,
      firebaseDatabase,
      firebaseStorage,
      updatedAt: new Date().toISOString(),
    };

    await set(configRef, configData);

    return { success: true };
  } catch (error) {
    console.error('Error saving local configuration:', error);
    return { 
      success: false, 
      error: error.message || 'Error al guardar la configuración' 
    };
  }
};

/**
 * Fetches local configuration from the central IDs database
 * @param {string} numeroLocal - Local number/ID to fetch
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export const fetchLocalConfiguration = async (numeroLocal) => {
  try {
    if (!numeroLocal) {
      return { success: false, error: 'Número de local requerido' };
    }

    const app = getIDsDBApp();
    const db = getDatabase(app);
    const configRef = ref(db, `ids/${numeroLocal}`);

    const snapshot = await get(configRef);

    if (snapshot.exists()) {
      return { 
        success: true, 
        data: snapshot.val() 
      };
    } else {
      return { 
        success: false, 
        error: 'No se encontró configuración para este número de local' 
      };
    }
  } catch (error) {
    console.error('Error fetching local configuration:', error);
    return { 
      success: false, 
      error: error.message || 'Error al obtener la configuración' 
    };
  }
};

/**
 * Fetches all local configurations from the central IDs database
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export const fetchAllLocalConfigurations = async () => {
  try {
    const app = getIDsDBApp();
    const db = getDatabase(app);
    const idsRef = ref(db, 'ids');

    const snapshot = await get(idsRef);

    if (snapshot.exists()) {
      return { 
        success: true, 
        data: snapshot.val() 
      };
    } else {
      return { 
        success: true, 
        data: {} 
      };
    }
  } catch (error) {
    console.error('Error fetching all local configurations:', error);
    return { 
      success: false, 
      error: error.message || 'Error al obtener las configuraciones' 
    };
  }
};