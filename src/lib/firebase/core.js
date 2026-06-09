import { initializeApp, getApps, deleteApp, getApp } from 'firebase/app';
import { getStorage } from 'firebase/storage';

const BASE_URL_DEFAULT = "https://achava3703-default-rtdb.firebaseio.com";
const BASE_URL_TEMPERLEY = "https://bdtemperley-default-rtdb.firebaseio.com";
const BASE_URL_CENTENARIO = "https://centenario1199-default-rtdb.firebaseio.com";
const BASE_URL_BURANO = "https://buranoheladerias-default-rtdb.firebaseio.com";
const BASE_URL_CANADA = "https://lanyulinacanada-default-rtdb.firebaseio.com";
const BASE_URL_BYNNON = "https://heladeriabynnonadrogue-default-rtdb.firebaseio.com";
const BASE_URL_ILCAPO = "https://ilcapogelatojls2026-default-rtdb.firebaseio.com";

const STORAGE_BUCKET_DEFAULT = "achava3703.firebasestorage.app";
const STORAGE_BUCKET_TEMPERLEY = "bdtemperley.firebasestorage.app";
const STORAGE_BUCKET_CENTENARIO = "centenario1199.firebasestorage.app";
const STORAGE_BUCKET_CANADA = "lanyulinacanada.firebasestorage.app";
const STORAGE_BUCKET_BURANO = "buranoheladerias.firebasestorage.app";
const STORAGE_BUCKET_ILCAPO = "ilcapogelatojls2026.firebasestorage.app";

const API_KEY_DEFAULT = "AIzaSyDFsKxM8F5v9YqJxT8pYxQZvLzRxNmWqKs";
const API_KEY_TEMPERLEY = "AIzaSyBxYqJ8pWxFzT9KvLmNqRzPyDtCxWvXyUs";
const API_KEY_CENTENARIO = "AIzaSyCxZqK9qXyGzU0LwNmOsRpTzQyExWyYzVt";
const API_KEY_CANADA = "AIzaSyDyArL0rYzHaV1MxPnQtSzRyFxGxXzZaWu";

const PROJECT_ID_DEFAULT = "achava3703";
const PROJECT_ID_TEMPERLEY = "bdtemperley";
const PROJECT_ID_CENTENARIO = "centenario1199";
const PROJECT_ID_CANADA = "lanyulinacanada";
const PROJECT_ID_BURANO = "buranoheladerias";
const PROJECT_ID_ILCAPO = "ilcapogelatojls2026";

let LOCAL_ID = null;

export const getLocalId = () => localStorage.getItem('localId');

export const getFirebaseUrl = () => {
  const localId = getLocalId();
  switch (localId) {
    case '38827976': return BASE_URL_TEMPERLEY;
    case '51501748': return BASE_URL_CENTENARIO;
    case '25230974': return BASE_URL_BURANO;
    case '34734081': return BASE_URL_CANADA;
    case '34516605': return BASE_URL_BYNNON;
    case '31915636': return BASE_URL_ILCAPO;
    case '40508022': return BASE_URL_DEFAULT;
    default: return BASE_URL_DEFAULT;
  }
};

const getStorageBucketUrl = () => {
  const localId = getLocalId();
  switch (localId) {
    case '38827976': return STORAGE_BUCKET_TEMPERLEY;
    case '51501748': return STORAGE_BUCKET_CENTENARIO;
    case '25230974': return STORAGE_BUCKET_BURANO;
    case '40508022': return STORAGE_BUCKET_DEFAULT;
    case '34734081': return STORAGE_BUCKET_CANADA;
    case '31915636': return STORAGE_BUCKET_ILCAPO;
    default: return STORAGE_BUCKET_DEFAULT;
  }
};

const getApiKey = () => {
  const localId = getLocalId();
  switch (localId) {
    case '38827976': return API_KEY_TEMPERLEY;
    case '51501748': return API_KEY_CENTENARIO;
    case '40508022': return API_KEY_DEFAULT;
    case '34734081': return API_KEY_CANADA;
    case '31915636': return API_KEY_DEFAULT; // Using default API key for Il Capo
    default: return API_KEY_DEFAULT;
  }
};

const getProjectId = () => {
  const localId = getLocalId();
  switch (localId) {
    case '38827976': return PROJECT_ID_TEMPERLEY;
    case '51501748': return PROJECT_ID_CENTENARIO;
    case '25230974': return PROJECT_ID_BURANO;
    case '40508022': return PROJECT_ID_DEFAULT;
    case '34734081': return PROJECT_ID_CANADA;
    case '31915636': return PROJECT_ID_ILCAPO;
    default: return PROJECT_ID_DEFAULT;
  }
};

/**
 * Returns the location-specific database URL based on local ID
 * For local 31915636, returns the dedicated Il Capo database URL
 * For other locations, returns their respective database URLs
 */
export const getLocationSpecificDatabaseURL = (localId) => {
  switch (localId) {
    case '38827976': return BASE_URL_TEMPERLEY;
    case '51501748': return BASE_URL_CENTENARIO;
    case '25230974': return BASE_URL_BURANO;
    case '34734081': return BASE_URL_CANADA;
    case '34516605': return BASE_URL_BYNNON;
    case '31915636': return BASE_URL_ILCAPO;
    case '40508022': return BASE_URL_DEFAULT;
    default: return BASE_URL_DEFAULT;
  }
};

/**
 * Returns the location-specific storage bucket based on local ID
 * For local 31915636, returns the dedicated Il Capo storage bucket
 * For other locations, returns their respective storage buckets
 */
export const getLocationSpecificStorageBucket = (localId) => {
  switch (localId) {
    case '38827976': return STORAGE_BUCKET_TEMPERLEY;
    case '51501748': return STORAGE_BUCKET_CENTENARIO;
    case '25230974': return STORAGE_BUCKET_BURANO;
    case '40508022': return STORAGE_BUCKET_DEFAULT;
    case '34734081': return STORAGE_BUCKET_CANADA;
    case '31915636': return STORAGE_BUCKET_ILCAPO;
    default: return STORAGE_BUCKET_DEFAULT;
  }
};

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

export const initializeFirebaseApp = () => {
  const localId = getLocalId();
  const firebaseConfig = {
    apiKey: getApiKey(),
    projectId: getProjectId(),
    databaseURL: getLocationSpecificDatabaseURL(localId),
    storageBucket: getLocationSpecificStorageBucket(localId),
  };
  
  if (!localId) {
      return null;
  }

  if (currentDBURL === firebaseConfig.databaseURL && currentStorageBucket === firebaseConfig.storageBucket && getApps().length > 0) {
    return getApps()[0];
  }

  currentDBURL = firebaseConfig.databaseURL; 
  currentStorageBucket = firebaseConfig.storageBucket;

  const reinitialize = () => {
    try {
        return initializeApp(firebaseConfig);
    } catch(e) {
        console.error("Firebase initialization error:", e);
        return null;
    }
  };

  if (getApps().length) {
    const defaultApp = getApps()[0];
    if (defaultApp.options.databaseURL !== firebaseConfig.databaseURL || defaultApp.options.storageBucket !== firebaseConfig.storageBucket) {
      return deleteApp(defaultApp).then(reinitialize).catch(err => {
        console.error("Error deleting old Firebase app:", err);
        return null;
      });
    }
    return defaultApp;
  } else {
    return reinitialize();
  }
};

export const getFirebaseApp = () => {
  if (getApps().length === 0) {
    return initializeFirebaseApp();
  }
  return getApp();
};

const getTodayDateString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Firebase Security Rules Documentation:
 * 
 * /whatsappMessages/{delivererId}/ - readable/writable by authenticated users managing that deliverer
 * Message data structure: { lastMessage: string, createdAt: timestamp, updatedAt: timestamp, generatedBy: userId }
 * Each deliverer has isolated message storage
 */