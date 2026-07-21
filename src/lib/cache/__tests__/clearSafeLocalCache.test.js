// Test plano con node:assert -- el proyecto no tiene test runner configurado
// (sin jest/vitest en package.json). Ejercita las funciones REALES exportadas
// por cacheManager.js (no una reimplementación de su lógica), contra shims
// mínimos de localStorage/indexedDB/caches hechos a mano para no sumar una
// dependencia nueva (no hay fake-indexeddb/jsdom instalado).
//
// Correr con: node src/lib/cache/__tests__/clearSafeLocalCache.test.js
// (los módulos ES ya son estrictos por defecto, no hace falta 'use strict')

import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Shims mínimos de APIs de navegador -- deben instalarse ANTES de importar
// cacheManager.js/imageCache.js (aunque ambos las usan de forma perezosa
// dentro de funciones, no al cargar el módulo, así que el orden no es
// estrictamente crítico, pero se hace así para que quede explícito).
// ---------------------------------------------------------------------------

function createFakeLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

function createFakeCaches(existingNames = []) {
  const names = new Set(existingNames);
  const deletedNames = [];
  return {
    async keys() { return Array.from(names); },
    async delete(name) {
      if (!names.has(name)) return false;
      names.delete(name);
      deletedNames.push(name);
      return true;
    },
    _deletedNames: deletedNames,
  };
}

class FakeRequest {
  constructor() {
    this.onsuccess = null;
    this.onerror = null;
    this.result = undefined;
  }
  _succeed(result) {
    this.result = result;
    queueMicrotask(() => this.onsuccess && this.onsuccess({ target: this }));
  }
}

class FakeObjectStore {
  constructor(map) { this._map = map; }
  clear() { this._map.clear(); const r = new FakeRequest(); r._succeed(); return r; }
  put(value) { const key = value.id ?? value.key; this._map.set(key, value); const r = new FakeRequest(); r._succeed(key); return r; }
  get(key) { const r = new FakeRequest(); r._succeed(this._map.get(key)); return r; }
  getAll() { const r = new FakeRequest(); r._succeed(Array.from(this._map.values())); return r; }
  count() { const r = new FakeRequest(); r._succeed(this._map.size); return r; }
  createIndex() {}
}

class FakeTransaction {
  constructor(storesByName) {
    this._storesByName = storesByName;
    this.oncomplete = null;
    this.onerror = null;
    queueMicrotask(() => this.oncomplete && this.oncomplete());
  }
  objectStore(name) {
    if (!this._storesByName.has(name)) throw new Error(`Fake IndexedDB: object store inexistente: ${name}`);
    return new FakeObjectStore(this._storesByName.get(name));
  }
}

class FakeDB {
  constructor() {
    this._stores = new Map(); // storeName -> Map(key -> value)
    this.objectStoreNames = { contains: (n) => this._stores.has(n) };
  }
  createObjectStore(name) {
    this._stores.set(name, new Map());
    return new FakeObjectStore(this._stores.get(name));
  }
  transaction(storeNames) {
    return new FakeTransaction(this._stores);
  }
}

function createFakeIndexedDB() {
  const databases = new Map(); // name -> FakeDB
  return {
    open(name) {
      const req = new FakeRequest();
      const isNew = !databases.has(name);
      const db = databases.get(name) || new FakeDB();
      if (isNew) databases.set(name, db);
      queueMicrotask(() => {
        if (isNew && req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
        req._succeed(db);
      });
      return req;
    },
  };
}

// Claves de localStorage que la app usa para configuración/sesión/datos que
// el botón "Limpiar Caché Local" NUNCA debe tocar (ver App.jsx, core.js,
// useMpAccounts.js, useVoicePaymentAlerts.js, DeliveryTab.jsx).
const PROTECTED_LOCALSTORAGE_KEYS = {
  localId: '40508022',
  firebaseRoutesOverride_40508022: JSON.stringify({ databaseURL: 'https://achava3703-default-rtdb.firebaseio.com' }),
  'mp-accounts-safe': JSON.stringify([{ nombreCuenta: 'principal' }]),
  whatsapp_read_from_db: 'true',
  deliveryViewMode: 'table',
  voice_payment_alerts_volume: '80',
};
const SAFE_IMAGE_CACHE_KEY = 'imageCache_metadata_abcdefghij';

globalThis.localStorage = createFakeLocalStorage({
  ...PROTECTED_LOCALSTORAGE_KEYS,
  [SAFE_IMAGE_CACHE_KEY]: JSON.stringify({ url: 'https://example.com/img.png', timestamp: Date.now() }),
});
globalThis.indexedDB = createFakeIndexedDB();
// Simula: los 2 caches actuales con prefijo (public/sw.js), un nombre legacy
// sin prefijo (de una versión anterior a este cambio, sigue en disco hasta
// que el usuario actualice una vez), y un cache AJENO que nunca debe tocarse.
const FOREIGN_CACHE_NAME = 'algun-otro-cache-no-relacionado';
globalThis.caches = createFakeCaches(['dlv-html-cache', 'dlv-static-resources', 'html-cache', FOREIGN_CACHE_NAME]);

const {
  saveOrdersToCache,
  getOrdersFromCache,
  getCacheMeta,
  setCacheItem,
  getCacheItem,
  clearSafeLocalCache,
} = await import('../cacheManager.js');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('Preparación: poblar pedidos, meta y cache general (simula uso real)');
await saveOrdersToCache([{ id: 'PEDIDO-1', TOTAL: 1000 }]);
await setCacheItem('algunaClaveTemporal', { foo: 'bar' });

console.log('\nclearSafeLocalCache():');
const report = await clearSafeLocalCache();

await check('reporta que limpió la cache general', () => {
  assert.strictEqual(report.generalCacheCleared, true);
});
await check('reporta 1 clave de imagen eliminada', () => {
  assert.strictEqual(report.imageCacheKeysRemoved, 1);
});
await check('reporta los 2 caches con prefijo + el legacy sin prefijo eliminados (descubiertos por prefijo, no por lista fija)', () => {
  assert.deepStrictEqual(report.swCachesRemoved.sort(), ['dlv-html-cache', 'dlv-static-resources', 'html-cache']);
});
await check('NUNCA borra un cache ajeno a la app', async () => {
  const remaining = await caches.keys();
  assert.ok(remaining.includes(FOREIGN_CACHE_NAME), 'el cache ajeno debería seguir existiendo');
  assert.ok(!report.swCachesRemoved.includes(FOREIGN_CACHE_NAME));
});

console.log('\nNO debe tocar pedidos ni sincronización:');
await check('los pedidos en cache siguen intactos', async () => {
  const orders = await getOrdersFromCache();
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].id, 'PEDIDO-1');
});
await check('el meta de última sincronización sigue intacto', async () => {
  const meta = await getCacheMeta();
  assert.strictEqual(meta.count, 1);
  assert.ok(meta.lastSync, 'lastSync no debería ser null');
});

console.log('\nSÍ debe limpiar la cache general (TTL, sin uso real hoy):');
await check('la clave de cache general ya no existe', async () => {
  const value = await getCacheItem('algunaClaveTemporal');
  assert.strictEqual(value, null);
});

console.log('\nNO debe tocar localStorage protegido:');
for (const [key, expected] of Object.entries(PROTECTED_LOCALSTORAGE_KEYS)) {
  await check(`localStorage['${key}'] se preserva`, () => {
    assert.strictEqual(localStorage.getItem(key), expected);
  });
}

console.log('\nSÍ debe limpiar metadatos de imágenes cacheadas:');
await check(`localStorage['${SAFE_IMAGE_CACHE_KEY}'] fue eliminada`, () => {
  assert.strictEqual(localStorage.getItem(SAFE_IMAGE_CACHE_KEY), null);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
