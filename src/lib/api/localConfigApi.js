import { getDatabase, ref, set, get } from 'firebase/database';
import { initializeApp, getApps } from 'firebase/app';

// Configuración fija del proyecto Firebase central donde vive el registro de
// rutas por local (/rutas/{numeroLocal}). Es intencionalmente hardcodeada: es
// el único punto de partida conocido antes de saber a qué proyecto pertenece
// un local — no se puede resolver dinámicamente lo que sirve para resolver
// todo lo demás.
const ROUTES_DB_CONFIG = {
  apiKey: "AIzaSyDFsKxM8F5v9YqJxT8pYxQZvLzRxNmWqKs",
  projectId: "achava3703",
  databaseURL: "https://achava3703-default-rtdb.firebaseio.com",
  storageBucket: "achava3703.firebasestorage.app",
};

const ROUTES_APP_NAME = 'routes-config-db';

const getRoutesDBApp = () => {
  const existingApp = getApps().find(app => app.name === ROUTES_APP_NAME);
  if (existingApp) return existingApp;
  return initializeApp(ROUTES_DB_CONFIG, ROUTES_APP_NAME);
};

const routesRef = (numeroLocal) => {
  const db = getDatabase(getRoutesDBApp());
  return ref(db, `rutas/${numeroLocal}`);
};

/**
 * Guarda la configuración de rutas Firebase de un local en
 * https://achava3703-default-rtdb.firebaseio.com/rutas/{numeroLocal}/
 *
 * Campos principales (los que ve el usuario en la pantalla de configuración):
 *   databaseURL, databasePath, storageBucket, storageBasePath
 * Campos técnicos opcionales (solo necesarios para un local totalmente nuevo,
 * no mostrados como principales en la UI):
 *   apiKey, projectId
 */
export const saveLocalRoutes = async (numeroLocal, routes) => {
  try {
    if (!numeroLocal || !routes?.databaseURL) {
      return { success: false, error: 'databaseURL es obligatorio' };
    }

    const data = {
      databaseURL:     routes.databaseURL,
      databasePath:    routes.databasePath ?? '',
      storageBucket:   routes.storageBucket ?? '',
      storageBasePath: routes.storageBasePath ?? '',
      updatedAt:       new Date().toISOString(),
    };
    // apiKey/projectId son técnicos y opcionales — solo se guardan si vienen.
    if (routes.apiKey)    data.apiKey    = routes.apiKey;
    if (routes.projectId) data.projectId = routes.projectId;

    await set(routesRef(numeroLocal), data);
    return { success: true };
  } catch (error) {
    console.error('[localConfigApi] Error guardando rutas del local:', error);
    return { success: false, error: error.message || 'Error al guardar la configuración' };
  }
};

/**
 * Lee la configuración de rutas de un local desde
 * https://achava3703-default-rtdb.firebaseio.com/rutas/{numeroLocal}/
 * Devuelve { success: false } si no hay nada configurado (comportamiento
 * esperado para la mayoría de los locales existentes — deben caer al
 * fallback de LOCATION_CONFIG).
 */
export const fetchLocalRoutes = async (numeroLocal) => {
  try {
    if (!numeroLocal) return { success: false, error: 'Número de local requerido' };

    const snapshot = await get(routesRef(numeroLocal));
    if (snapshot.exists()) {
      return { success: true, data: snapshot.val() };
    }
    return { success: false, error: 'No hay rutas configuradas para este local' };
  } catch (error) {
    console.error('[localConfigApi] Error leyendo rutas del local:', error);
    return { success: false, error: error.message || 'Error al obtener la configuración' };
  }
};
