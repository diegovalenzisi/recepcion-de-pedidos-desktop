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

const getConfig = (localId) => LOCATION_CONFIG[localId] ?? DEFAULT_CONFIG;

let LOCAL_ID = null;

export const getLocalId = () => localStorage.getItem('localId');

export const getFirebaseUrl = () => getConfig(getLocalId()).dbUrl;

export const getLocationSpecificDatabaseURL = (localId) => getConfig(localId).dbUrl;
export const getLocationSpecificStorageBucket = (localId) => getConfig(localId).storage;

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

export const initializeFirebaseApp = async () => {
  const localId = getLocalId();

  if (!localId) {
    return null;
  }

  const config = getConfig(localId);
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };

  if (
    currentDBURL === firebaseConfig.databaseURL &&
    currentStorageBucket === firebaseConfig.storageBucket &&
    getApps().length > 0
  ) {
    return getApps()[0];
  }

  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  if (getApps().length > 0) {
    const defaultApp = getApps()[0];
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
    return initializeApp(firebaseConfig);
  } catch (e) {
    console.error("Firebase initialization error:", e);
    return null;
  }
};

export const getFirebaseApp = () => {
  if (getApps().length === 0) {
    return initializeFirebaseApp();
  }
  return getApp();
};

/**
 * Firebase Security Rules Documentation:
 *
 * /whatsappMessages/{delivererId}/ - readable/writable by authenticated users managing that deliverer
 * Message data structure: { lastMessage: string, createdAt: timestamp, updatedAt: timestamp, generatedBy: userId }
 * Each deliverer has isolated message storage
 */
