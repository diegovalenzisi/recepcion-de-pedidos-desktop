import { initializeApp, getApps, deleteApp, getApp } from 'firebase/app';

const BASE_URL_DEFAULT    = "https://achava3703-default-rtdb.firebaseio.com";
const BASE_URL_TEMPERLEY  = "https://bdtemperley-default-rtdb.firebaseio.com";
const BASE_URL_CENTENARIO = "https://centenario1199-default-rtdb.firebaseio.com";
const BASE_URL_BURANO     = "https://buranoheladerias-default-rtdb.firebaseio.com";
const BASE_URL_CANADA     = "https://lanyulinacanada-default-rtdb.firebaseio.com";
const BASE_URL_BYNNON     = "https://heladeriabynnonadrogue-default-rtdb.firebaseio.com";
const BASE_URL_ILCAPO     = "https://ilcapogelatojls2026-default-rtdb.firebaseio.com";

const STORAGE_BUCKET_DEFAULT    = "achava3703.firebasestorage.app";
const STORAGE_BUCKET_TEMPERLEY  = "bdtemperley.firebasestorage.app";
const STORAGE_BUCKET_CENTENARIO = "centenario1199.firebasestorage.app";
const STORAGE_BUCKET_CANADA     = "lanyulinacanada.firebasestorage.app";
const STORAGE_BUCKET_BURANO     = "buranoheladerias.firebasestorage.app";
const STORAGE_BUCKET_ILCAPO     = "ilcapogelatojls2026.firebasestorage.app";

const API_KEY_DEFAULT    = import.meta.env.VITE_API_KEY_DEFAULT    || "AIzaSyDFsKxM8F5v9YqJxT8pYxQZvLzRxNmWqKs";
const API_KEY_TEMPERLEY  = import.meta.env.VITE_API_KEY_TEMPERLEY  || "AIzaSyBxYqJ8pWxFzT9KvLmNqRzPyDtCxWvXyUs";
const API_KEY_CENTENARIO = import.meta.env.VITE_API_KEY_CENTENARIO || "AIzaSyCxZqK9qXyGzU0LwNmOsRpTzQyExWyYzVt";
const API_KEY_CANADA     = import.meta.env.VITE_API_KEY_CANADA     || "AIzaSyDyArL0rYzHaV1MxPnQtSzRyFxGxXzZaWu";

const PROJECT_ID_DEFAULT    = "achava3703";
const PROJECT_ID_TEMPERLEY  = "bdtemperley";
const PROJECT_ID_CENTENARIO = "centenario1199";
const PROJECT_ID_CANADA     = "lanyulinacanada";
const PROJECT_ID_BURANO     = "buranoheladerias";
const PROJECT_ID_ILCAPO     = "ilcapogelatojls2026";

// Tabla centralizada de configuración por local.
// Antes había 6 switch statements idénticos — ahora hay uno solo.
const LOCATION_CONFIG = {
    '40508022': { dbUrl: BASE_URL_DEFAULT,    storage: STORAGE_BUCKET_DEFAULT,    apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_DEFAULT    },
    '38827976': { dbUrl: BASE_URL_TEMPERLEY,  storage: STORAGE_BUCKET_TEMPERLEY,  apiKey: API_KEY_TEMPERLEY,  projectId: PROJECT_ID_TEMPERLEY  },
    '51501748': { dbUrl: BASE_URL_CENTENARIO, storage: STORAGE_BUCKET_CENTENARIO, apiKey: API_KEY_CENTENARIO, projectId: PROJECT_ID_CENTENARIO },
    '25230974': { dbUrl: BASE_URL_BURANO,     storage: STORAGE_BUCKET_BURANO,     apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_BURANO     },
    '34734081': { dbUrl: BASE_URL_CANADA,     storage: STORAGE_BUCKET_CANADA,     apiKey: API_KEY_CANADA,     projectId: PROJECT_ID_CANADA     },
    '34516605': { dbUrl: BASE_URL_BYNNON,     storage: STORAGE_BUCKET_DEFAULT,    apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_DEFAULT    },
    '31915636': { dbUrl: BASE_URL_ILCAPO,     storage: STORAGE_BUCKET_ILCAPO,     apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_ILCAPO     },
};

const DEFAULT_CONFIG = LOCATION_CONFIG['40508022'];

// Permite distinguir "local ya conocido en la tabla hardcodeada" de "local
// nuevo" SIN exponer la tabla completa — para no precargar por error los
// datos de Achaval (el fallback) como si fueran los de un local desconocido.
export const isKnownLocationConfig = (localId) => Object.prototype.hasOwnProperty.call(LOCATION_CONFIG, localId);

// ---------------------------------------------------------------------------
// Override de rutas configurable por local (pantalla de configuración inicial,
// guardado en https://achava3703-default-rtdb.firebaseio.com/rutas/{localId}/).
// Se cachea en memoria + localStorage para que getConfig() siga siendo 100%
// SÍNCRONA (la usan ~50 archivos con fetch() inmediato) — la única llamada
// async real ocurre una vez, en la pantalla de configuración, que llama a
// applyRoutesOverride() para que quede disponible sincrónicamente de ahí en más.
// ---------------------------------------------------------------------------
const ROUTES_OVERRIDE_KEY_PREFIX = 'firebaseRoutesOverride_';
const overrideCache = {}; // { [localId]: { databaseURL, databasePath, storageBucket, storageBasePath, apiKey, projectId } }

const readOverrideFromStorage = (localId) => {
  try {
    const raw = localStorage.getItem(`${ROUTES_OVERRIDE_KEY_PREFIX}${localId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getOverride = (localId) => {
  if (!localId) return null;
  if (overrideCache[localId] !== undefined) return overrideCache[localId];
  const stored = readOverrideFromStorage(localId);
  overrideCache[localId] = stored; // cachea también el "no hay override" (null)
  return stored;
};

/**
 * Aplica (y persiste localmente) el override de rutas de un local, resultado
 * de guardar desde la pantalla de configuración o de sincronizar desde
 * /rutas/{localId} en el arranque. NO escribe en Firebase — eso lo hace
 * localConfigApi.saveLocalRoutes(); esta función solo actualiza la caché local
 * que consume getConfig().
 */
export const applyRoutesOverride = (localId, routes) => {
  if (!localId || !routes) return;
  overrideCache[localId] = routes;
  try {
    localStorage.setItem(`${ROUTES_OVERRIDE_KEY_PREFIX}${localId}`, JSON.stringify(routes));
  } catch (e) {
    console.warn('[core] No se pudo persistir el override de rutas en localStorage:', e.message);
  }
};

/** Devuelve el override crudo (tal cual quedó guardado) o null si no hay. Uso: precargar el form. */
export const getRoutesOverride = (localId) => getOverride(localId);

const getConfig = (localId) => {
  const override = getOverride(localId);
  if (override?.databaseURL) {
    const base = LOCATION_CONFIG[localId] ?? DEFAULT_CONFIG;
    return {
      dbUrl:     override.databaseURL,
      storage:   override.storageBucket || base.storage,
      // apiKey/projectId son técnicos: si el override no los trae (caso normal
      // para un local YA existente en LOCATION_CONFIG), se resuelven solos.
      apiKey:    override.apiKey    || base.apiKey,
      projectId: override.projectId || base.projectId,
    };
  }
  return LOCATION_CONFIG[localId] ?? DEFAULT_CONFIG;
};

// databasePath resuelto: el override lo trae explícito; si no hay override,
// el comportamiento actual (implícito en todo el código existente) es que la
// raíz de datos = el propio número de local. Getter nuevo, listo para usar,
// pero TODAVÍA NO conectado en las llamadas de pedidos/caja/stock/facturación/
// ventas/historial (eso requiere tocar esos ~50 call sites, fuera de alcance
// de este cambio).
export const getLocationSpecificDatabasePath = (localId) => {
  const override = getOverride(localId);
  return override?.databasePath || localId;
};
// Raíz OFICIAL de la base de datos del local actual: databaseURL + "/" + <esto>.
// Resuelve el id tanto desde la variable de módulo (getCurrentLocalId, seteada
// por checkLocalId) como desde localStorage (getLocalId), para funcionar en
// todos los archivos de src/lib/api independientemente de cuál usaran antes.
export const getCurrentDatabasePath = () => getLocationSpecificDatabasePath(getCurrentLocalId() || getLocalId());

// storageBasePath resuelto: mismo criterio que databasePath — se guarda y se
// puede leer, pero storage.js todavía no lo usa para componer rutas de subida.
export const getLocationSpecificStorageBasePath = (localId) => getOverride(localId)?.storageBasePath || '';

let LOCAL_ID = null;

export const getLocalId = () => localStorage.getItem('localId');

export const getFirebaseUrl = () => getConfig(getLocalId()).dbUrl;

export const getLocationSpecificDatabaseURL = (localId) => getConfig(localId).dbUrl;
export const getLocationSpecificStorageBucket = (localId) => getConfig(localId).storage;
export const getLocationSpecificProjectId = (localId) => getConfig(localId).projectId;

export const setFirebaseLocalId = (localId) => {
  LOCAL_ID = localId;
};

export const setLocalId = (localId) => localStorage.setItem('localId', localId);
export const clearLocalId = () => localStorage.removeItem('localId');
export const getCurrentLocalId = () => LOCAL_ID;

export const checkLocalId = () => {
  if (!LOCAL_ID) {
    const storedId = getLocalId();
    if (storedId) {
      setFirebaseLocalId(storedId);
    } else {
      console.warn("El ID de local no está configurado.");
    }
  }
};

let currentDBURL = null;
let currentStorageBucket = null;

// Devuelve la app Firebase '[DEFAULT]' si existe, o null. NO usar getApps()[0]:
// puede haber apps con NOMBRE (ej. 'routes-config-db' de localConfigApi) creadas
// antes que la default, y getApps()[0] devolvería esa por error.
const getDefaultAppOrNull = () => getApps().find((a) => a.name === '[DEFAULT]') || null;

export const initializeFirebaseApp = async () => {
  const localId = getLocalId();

  if (!localId) {
    return null;
  }

  const config = getConfig(localId);
  // IMPORTANTE: storageBucket es SOLO el bucket (ej. "achava3703.firebasestorage.app").
  // El storageBasePath NUNCA se concatena acá — se guarda aparte para rutas internas.
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };

  const defaultApp = getDefaultAppOrNull();

  if (
    defaultApp &&
    currentDBURL === firebaseConfig.databaseURL &&
    currentStorageBucket === firebaseConfig.storageBucket
  ) {
    return defaultApp;
  }

  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  if (defaultApp) {
    if (
      defaultApp.options.databaseURL !== firebaseConfig.databaseURL ||
      defaultApp.options.storageBucket !== firebaseConfig.storageBucket
    ) {
      try {
        await deleteApp(defaultApp);
      } catch (err) {
        console.error("Error eliminando app Firebase anterior:", err);
        return null;
      }
    } else {
      return defaultApp;
    }
  }

  try {
    // initializeApp SIN nombre crea la app '[DEFAULT]' (coexiste con las nombradas).
    return initializeApp(firebaseConfig);
  } catch (e) {
    console.error("Firebase initialization error:", e);
    return null;
  }
};

export const getFirebaseApp = () => {
  const defaultApp = getDefaultAppOrNull();
  if (defaultApp) return defaultApp;
  return initializeFirebaseApp();
};

/**
 * Firebase Security Rules Documentation:
 *
 * /whatsappMessages/{delivererId}/ - readable/writable by authenticated users managing that deliverer
 * Message data structure: { lastMessage: string, createdAt: timestamp, updatedAt: timestamp, generatedBy: userId }
 * Each deliverer has isolated message storage
 */
