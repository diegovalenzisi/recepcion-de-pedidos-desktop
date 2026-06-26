const DB_NAME = 'DLV_OrdersCache';
const DB_VERSION = 2; // Incremented version for TTL support
const STORE_NAME = 'orders';
const META_STORE = 'meta';
const CACHE_STORE = 'general_cache';

const DEFAULT_TTL = 1000 * 60 * 60; // 1 hour

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