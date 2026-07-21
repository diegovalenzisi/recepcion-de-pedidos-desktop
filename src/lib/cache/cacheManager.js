import { CACHE_KEY_PREFIX as IMAGE_CACHE_KEY_PREFIX } from './imageCache.js';

const DB_NAME = 'DLV_OrdersCache';
const DB_VERSION = 2; // Incremented version for TTL support
const STORE_NAME = 'orders';
const META_STORE = 'meta';
const CACHE_STORE = 'general_cache';

const DEFAULT_TTL = 1000 * 60 * 60; // 1 hour

// Identificación de los caches de Cache Storage que crea el Service Worker
// (ver public/sw.js) SIN depender de una lista de nombres exactos duplicada
// entre los dos archivos: cualquier cache cuyo nombre empiece con este
// prefijo se considera propio de la app y reconstruible (archivos estáticos
// versionados, se vuelven a descargar solos) — si el nombre cambia en
// sw.js en el futuro (ej. se le agrega una versión), con que conserve el
// mismo prefijo esta limpieza lo sigue encontrando sin tocar código acá.
// Nunca se borra un cache que no empiece con este prefijo (no se tocan
// caches ajenos a la app).
const SW_CACHE_PREFIX = 'dlv-';
// Nombres sin el prefijo, de antes de este cambio — se siguen limpiando por
// compatibilidad con lo que ya esté cacheado en instalaciones existentes.
const LEGACY_SW_CACHE_NAMES = ['html-cache', 'static-resources'];

export const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('status', 'status.main', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
    };
  });
};

export const saveOrdersToCache = async (orders) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const metaStore = transaction.objectStore(META_STORE);

      store.clear();
      orders.forEach(order => {
        store.put(order);
      });

      metaStore.put({ key: 'lastSync', value: Date.now() });

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("IndexedDB not available or failed:", error);
    return false;
  }
};

export const getOrdersFromCache = async () => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("Failed to read from cache:", error);
    return [];
  }
};

export const updateOrderInCache = async (order) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(order);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Failed to update cache:", error);
    return false;
  }
};

export const clearDelivererCache = async (orderId) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(orderId);
      
      request.onsuccess = () => {
        const order = request.result;
        if (order) {
          delete order.deliverer;
          delete order.repartidor;
          store.put(order);
        }
        resolve(true);
      };
      
      request.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Failed to clear deliverer from cache:", error);
    return false;
  }
};

export const clearCache = async () => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, META_STORE, CACHE_STORE], 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.objectStore(META_STORE).clear();
      transaction.objectStore(CACHE_STORE).clear();
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("Failed to clear cache:", error);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Limpieza SEGURA para el botón "Limpiar Caché Local" de la UI.
//
// A diferencia de clearCache() (arriba, ya no la usa la UI), esta función
// NUNCA toca: localId, overrides de rutas por local, cuentas de Mercado Pago,
// preferencias de voz/WhatsApp/vista de entregas, sessionStorage (sesión del
// usuario), ni los stores de IndexedDB de pedidos (STORE_NAME) o última
// sincronización (META_STORE).
//
// Solo borra datos temporales y reconstruibles:
//   - IndexedDB "general_cache": cache genérica con TTL (sin uso de pedidos).
//   - localStorage con el prefijo de metadatos de imágenes cacheadas.
//   - Cache Storage del Service Worker (html-cache, static-resources) —
//     archivos estáticos versionados que se vuelven a descargar solos.
//
// Devuelve un reporte de qué se borró (usado también por el test automatizado).
export const clearSafeLocalCache = async () => {
  const report = { generalCacheCleared: false, imageCacheKeysRemoved: 0, swCachesRemoved: [] };

  try {
    const db = await initDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([CACHE_STORE], 'readwrite');
      transaction.objectStore(CACHE_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    report.generalCacheCleared = true;
  } catch (error) {
    console.warn('[clearSafeLocalCache] No se pudo limpiar la cache general (IndexedDB):', error);
  }

  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(IMAGE_CACHE_KEY_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    report.imageCacheKeysRemoved = keysToRemove.length;
  } catch (error) {
    console.warn('[clearSafeLocalCache] No se pudo limpiar la cache de imágenes:', error);
  }

  try {
    if (typeof caches !== 'undefined') {
      // Se descubren por prefijo (o por los nombres legacy conocidos) en vez
      // de una lista fija — así sigue funcionando aunque sw.js cambie los
      // nombres, y nunca se toca un cache que no sea reconociblemente propio.
      const allCacheNames = await caches.keys();
      const namesToDelete = allCacheNames.filter(
        (name) => name.startsWith(SW_CACHE_PREFIX) || LEGACY_SW_CACHE_NAMES.includes(name)
      );
      for (const name of namesToDelete) {
        const deleted = await caches.delete(name);
        if (deleted) report.swCachesRemoved.push(name);
      }
    }
  } catch (error) {
    console.warn('[clearSafeLocalCache] No se pudo limpiar Cache Storage:', error);
  }

  return report;
};

export const getCacheMeta = async () => {
   try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([META_STORE, STORE_NAME], 'readonly');
      const metaStore = transaction.objectStore(META_STORE);
      const store = transaction.objectStore(STORE_NAME);
      
      const lastSyncReq = metaStore.get('lastSync');
      const countReq = store.count();

      transaction.oncomplete = () => {
         resolve({
            lastSync: lastSyncReq.result ? lastSyncReq.result.value : null,
            count: countReq.result || 0
         });
      };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    return { lastSync: null, count: 0 };
  }
};

// General Purpose Cache Methods
export const setCacheItem = async (key, data, ttl = DEFAULT_TTL) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([CACHE_STORE], 'readwrite');
      const store = transaction.objectStore(CACHE_STORE);
      
      const item = {
        key,
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttl
      };
      
      store.put(item);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    return false;
  }
};

export const getCacheItem = async (key) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([CACHE_STORE], 'readonly');
      const store = transaction.objectStore(CACHE_STORE);
      const request = store.get(key);
      
      request.onsuccess = () => {
        const result = request.result;
        if (!result) return resolve(null);
        
        if (Date.now() > result.expiresAt) {
          // Clean up expired item silently
          deleteCacheItem(key);
          resolve(null);
        } else {
          resolve(result.data);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    return null;
  }
};

export const deleteCacheItem = async (key) => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([CACHE_STORE], 'readwrite');
      const store = transaction.objectStore(CACHE_STORE);
      store.delete(key);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    return false;
  }
};