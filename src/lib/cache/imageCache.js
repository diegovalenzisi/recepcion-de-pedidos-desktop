const memoryCache = new Map();
const CACHE_KEY_PREFIX = 'imageCache_metadata_';
const CACHE_EXPIRATION_DAYS = 7;

export const cacheImage = (url) => {
  if (!url) return;
  memoryCache.set(url, true);
  
  try {
    const metadata = {
      url,
      timestamp: Date.now(),
    };
    localStorage.setItem(`${CACHE_KEY_PREFIX}${btoa(url).slice(0, 20)}`, JSON.stringify(metadata));
  } catch (e) {
    console.warn("Could not save image metadata to localStorage", e);
  }
};

export const getCachedImage = (url) => {
  if (!url) return null;
  if (memoryCache.has(url)) return url;
  
  try {
    const key = `${CACHE_KEY_PREFIX}${btoa(url).slice(0, 20)}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      const daysOld = (Date.now() - parsed.timestamp) / (1000 * 60 * 60 * 24);
      if (daysOld < CACHE_EXPIRATION_DAYS) {
        memoryCache.set(url, true);
        return url;
      } else {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  return null;
};

export const preloadImage = (url) => {
  return new Promise((resolve, reject) => {
    if (!url) {
      resolve(null);
      return;
    }
    
    if (getCachedImage(url)) {
      resolve(url);
      return;
    }

    const img = new Image();
    img.src = url;
    img.onload = () => {
      cacheImage(url);
      resolve(url);
    };
    img.onerror = (err) => {
      reject(err);
    };
  });
};

export const initializeImageCache = () => {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_KEY_PREFIX)) {
        const stored = localStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored);
          const daysOld = (Date.now() - parsed.timestamp) / (1000 * 60 * 60 * 24);
          if (daysOld >= CACHE_EXPIRATION_DAYS) {
            keysToRemove.push(key);
          } else {
            memoryCache.set(parsed.url, true);
          }
        }
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn("Failed to initialize image cache from localStorage", e);
  }
};