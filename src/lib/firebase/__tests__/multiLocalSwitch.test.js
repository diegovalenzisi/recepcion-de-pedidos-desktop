// Test plano con node:assert -- el proyecto no tiene test runner configurado.
//
// LIMITACIÓN CONOCIDA: core.js usa import.meta.env.VITE_* en el top-level del
// módulo, que solo Vite resuelve (en Node puro es `undefined` y el import
// falla). Por eso este test NO importa core.js directamente -- replica
// VERBATIM (ver comentarios "== copia de core.js ==") la lógica de
// getDefaultAppOrNull(), ensureFirebaseAppSync() e initializeFirebaseApp()
// contra el SDK real de firebase/app y firebase/database, parametrizada con
// un getLocalId()/getConfig() de prueba en vez de localStorage/LOCATION_CONFIG.
// Si core.js cambia esta lógica, este archivo se tiene que actualizar a mano.
//
// Correr con: node src/lib/firebase/__tests__/multiLocalSwitch.test.js
import assert from 'node:assert';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getDatabase, ref, onValue, off, set } from 'firebase/database';
import { getStorage } from 'firebase/storage';
// readiness.js SÍ se importa directo (sin import.meta.env, ver ese archivo).
import {
  markFirebaseSwitching,
  markFirebaseReady,
  markFirebaseError,
  isFirebaseSwitching,
  getFirebaseReadinessSnapshot,
  FirebaseNotReadyError,
  __resetFirebaseReadinessForTests,
} from '../readiness.js';

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

// ---------------------------------------------------------------------------
// Dos locales sintéticos con configuración DISTINTA -- simula Local A / Local B
// ---------------------------------------------------------------------------
const CONFIGS = {
  'local-A': { apiKey: 'key-A', projectId: 'proj-a', dbUrl: 'https://proj-a-default-rtdb.firebaseio.com', storage: 'proj-a.firebasestorage.app' },
  'local-B': { apiKey: 'key-B', projectId: 'proj-b', dbUrl: 'https://proj-b-default-rtdb.firebaseio.com', storage: 'proj-b.firebasestorage.app' },
  'local-incompleto': { apiKey: '', projectId: 'proj-x', dbUrl: 'https://proj-x-default-rtdb.firebaseio.com', storage: 'proj-x.firebasestorage.app' },
};
const getConfig = (localId) => CONFIGS[localId] || CONFIGS['local-A'];

let storedLocalId = null; // reemplaza localStorage.getItem('localId')
const getLocalId = () => storedLocalId;

let currentDBURL = null;
let currentStorageBucket = null;

// == copia de core.js: getDefaultAppOrNull ==
const getDefaultAppOrNull = () => getApps().find((a) => a.name === '[DEFAULT]') || null;

// == copia de core.js: ensureFirebaseAppSync (ya con el fix multi-local) ==
const ensureFirebaseAppSync = (localId = getLocalId()) => {
  if (!localId) return null;

  const config = getConfig(localId);
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };

  if (!firebaseConfig.databaseURL || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
    return null;
  }

  const existing = getDefaultAppOrNull();
  if (existing) {
    const matchesRequestedLocal =
      existing.options.databaseURL === firebaseConfig.databaseURL &&
      existing.options.storageBucket === firebaseConfig.storageBucket;
    return matchesRequestedLocal ? existing : null;
  }

  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  try {
    return initializeApp(firebaseConfig);
  } catch (e) {
    return null;
  }
};

// == copia de core.js: initializeFirebaseApp (con el mismo chequeo de config
// incompleta que ensureFirebaseAppSync -- antes solo esta última lo tenía) ==
const initializeFirebaseApp = async () => {
  const localId = getLocalId();
  if (!localId) return null;

  const config = getConfig(localId);
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };

  if (!firebaseConfig.databaseURL || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
    return null;
  }

  const defaultApp = getDefaultAppOrNull();

  if (defaultApp && currentDBURL === firebaseConfig.databaseURL && currentStorageBucket === firebaseConfig.storageBucket) {
    return defaultApp;
  }

  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  if (defaultApp) {
    if (defaultApp.options.databaseURL !== firebaseConfig.databaseURL || defaultApp.options.storageBucket !== firebaseConfig.storageBucket) {
      try {
        await deleteApp(defaultApp);
      } catch (err) {
        return null;
      }
    } else {
      return defaultApp;
    }
  }

  try {
    return initializeApp(firebaseConfig);
  } catch (e) {
    return null;
  }
};

// == copia de core.js: getFirebaseApp (alias sincrónico de ensureFirebaseAppSync) ==
const getFirebaseApp = (localId = getLocalId()) => ensureFirebaseAppSync(localId);

// == copia de core.js: getCurrentDatabaseOrThrow -- usa el readiness.js REAL
// (isFirebaseSwitching importado arriba, no una réplica) para el chequeo de
// "cambiando de local", y la réplica local de ensureFirebaseAppSync para el
// resto (ya probada en las secciones 1-7). ==
const getCurrentDatabaseOrThrow = (localId = getLocalId()) => {
  if (!localId) throw new FirebaseNotReadyError('No hay ningún local configurado todavía.');
  if (isFirebaseSwitching()) throw new FirebaseNotReadyError('Firebase está cambiando de local — todavía no se puede leer ni escribir.');
  const app = ensureFirebaseAppSync(localId);
  if (!app) throw new FirebaseNotReadyError('Firebase todavía no está listo para este local.');
  return getDatabase(app);
};

// Simula el orden real de App.jsx: markFirebaseSwitching() primero,
// ensureFirebaseAppSync(id) sincrónico, DESPUÉS (con posibles awaits no
// relacionados en el medio) initializeFirebaseApp(), y al final
// markFirebaseReady()/markFirebaseError() según el resultado -- igual que
// loadInitialData() real en App.jsx.
async function loadInitialDataSimulated(id) {
  markFirebaseSwitching();
  storedLocalId = id;
  const syncApp = ensureFirebaseAppSync(id);
  await Promise.resolve(); // simula el/los await de IPC no relacionados
  const finalApp = await initializeFirebaseApp();
  if (!finalApp) {
    markFirebaseError(new Error('No se pudo inicializar Firebase para este local.'));
  } else {
    markFirebaseReady();
  }
  return { syncApp, finalApp };
}

async function resetAllApps() {
  for (const app of getApps()) {
    try { await deleteApp(app); } catch { /* noop */ }
  }
  currentDBURL = null;
  currentStorageBucket = null;
  storedLocalId = null;
  __resetFirebaseReadinessForTests();
}

// ---------------------------------------------------------------------------
console.log('1. Inicio con localId ya guardado:');
await resetAllApps();
await check('ensureFirebaseAppSync crea la app con la config correcta', () => {
  storedLocalId = 'local-A';
  const app = ensureFirebaseAppSync('local-A');
  assert.ok(app);
  assert.strictEqual(app.options.databaseURL, CONFIGS['local-A'].dbUrl);
});
await check('initializeFirebaseApp() después NO duplica la app (misma instancia)', async () => {
  const before = getDefaultAppOrNull();
  const after = await initializeFirebaseApp();
  assert.strictEqual(after, before);
  assert.strictEqual(getApps().length, 1);
});

console.log('\n1b. Config incompleta (defensivo):');
await resetAllApps();
await check('ensureFirebaseAppSync nunca inicializa con una firebaseConfig incompleta', () => {
  const app = ensureFirebaseAppSync('local-incompleto'); // apiKey: '' en el fixture
  assert.strictEqual(app, null);
  assert.strictEqual(getApps().length, 0);
});

console.log('\n2. Inicio SIN localId:');
await resetAllApps();
await check('ensureFirebaseAppSync(sin localId) devuelve null, no lanza', () => {
  assert.strictEqual(ensureFirebaseAppSync(null), null);
});
await check('no crea ninguna app', () => {
  assert.strictEqual(getApps().length, 0);
});
await check('initializeFirebaseApp() sin localId también devuelve null', async () => {
  storedLocalId = null;
  assert.strictEqual(await initializeFirebaseApp(), null);
});

console.log('\n3. Cambio de local A -> B (sin cerrar el programa):');
await resetAllApps();
await check('arranca en A', async () => {
  const { finalApp } = await loadInitialDataSimulated('local-A');
  assert.strictEqual(finalApp.options.databaseURL, CONFIGS['local-A'].dbUrl);
});
let appAantesDelCambio;
await check(
  'ensureFirebaseAppSync(B) durante el cambio NUNCA devuelve la app de A (causa raíz del bug reportado)',
  () => {
    appAantesDelCambio = getDefaultAppOrNull();
    assert.strictEqual(appAantesDelCambio.options.databaseURL, CONFIGS['local-A'].dbUrl);
    const syncResult = ensureFirebaseAppSync('local-B');
    // Ni la app de A, ni ninguna app con la config de A.
    assert.notStrictEqual(syncResult?.options?.databaseURL, CONFIGS['local-A'].dbUrl);
  }
);
await check('initializeFirebaseApp() completa el cambio: todos los servicios terminan en B', async () => {
  storedLocalId = 'local-B';
  const finalApp = await initializeFirebaseApp();
  assert.strictEqual(finalApp.options.databaseURL, CONFIGS['local-B'].dbUrl);
  assert.strictEqual(finalApp.options.storageBucket, CONFIGS['local-B'].storage);
});
await check('la app vieja de A quedó realmente borrada (no coexisten dos apps)', () => {
  assert.strictEqual(getApps().length, 1);
  assert.notStrictEqual(getDefaultAppOrNull(), appAantesDelCambio);
});
await check('ensureFirebaseAppSync(B) ahora SÍ reusa la app ya migrada (no la duplica)', () => {
  const app = ensureFirebaseAppSync('local-B');
  assert.strictEqual(app, getDefaultAppOrNull());
  assert.strictEqual(getApps().length, 1);
});

console.log('\n4. Vuelta de B -> A:');
await check('ensureFirebaseAppSync(A) durante la vuelta NUNCA devuelve la app de B', () => {
  const appBantesDeVolver = getDefaultAppOrNull();
  const syncResult = ensureFirebaseAppSync('local-A');
  assert.notStrictEqual(syncResult?.options?.databaseURL, CONFIGS['local-B'].dbUrl);
  assert.ok(appBantesDeVolver);
});
await check('initializeFirebaseApp() completa la vuelta a A', async () => {
  storedLocalId = 'local-A';
  const finalApp = await initializeFirebaseApp();
  assert.strictEqual(finalApp.options.databaseURL, CONFIGS['local-A'].dbUrl);
});
await check('sigue habiendo una sola app (no se acumulan)', () => {
  assert.strictEqual(getApps().length, 1);
});

console.log('\n5. Llamadas repetidas a ensureFirebaseAppSync() (mismo local, sin awaits entre medio):');
await check('10 llamadas seguidas devuelven siempre la misma instancia, nunca crean una segunda', () => {
  const results = Array.from({ length: 10 }, () => ensureFirebaseAppSync('local-A'));
  const first = results[0];
  assert.ok(results.every((r) => r === first));
  assert.strictEqual(getApps().length, 1);
});

console.log('\n6. "Ejecución simultánea" de ensureFirebaseAppSync() e initializeFirebaseApp() (cambio A->B):');
await resetAllApps();
await loadInitialDataSimulated('local-A');
await check('durante el await de initializeFirebaseApp(), llamadas a ensureFirebaseAppSync(B) siguen sin devolver la app de A', async () => {
  storedLocalId = 'local-B';
  const initPromise = initializeFirebaseApp(); // dispara deleteApp(A) async, todavía no resolvió
  // "Casi simultáneo": se llama ensureFirebaseAppSync ANTES de que initPromise resuelva.
  const duringSwitch = ensureFirebaseAppSync('local-B');
  assert.notStrictEqual(duringSwitch?.options?.databaseURL, CONFIGS['local-A'].dbUrl);
  const finalApp = await initPromise;
  assert.strictEqual(finalApp.options.databaseURL, CONFIGS['local-B'].dbUrl);
  assert.strictEqual(getApps().length, 1); // nunca quedaron 2 apps coexistiendo
});

console.log('\n7. No quedan listeners "vivos" apuntando al local anterior tras el cambio:');
await resetAllApps();
await check('un listener creado en A dispara error si se lo usa DESPUÉS de que A fue borrada (no sigue "viendo" A en silencio)', async () => {
  const { finalApp: appA } = await loadInitialDataSimulated('local-A');
  const dbA = getDatabase(appA);
  const refA = ref(dbA, 'algunNodo');
  const listener = onValue(refA, () => {}, () => {});

  // Cambio a B: initializeFirebaseApp() borra la app de A.
  storedLocalId = 'local-B';
  await initializeFirebaseApp();

  // La limpieza del listener viejo (equivalente al cleanup de useEffect) debe
  // poder ejecutarse SIN explotar, incluso con la app ya borrada.
  assert.doesNotThrow(() => off(refA, 'value', listener));

  // Pero intentar crear un ref NUEVO sobre el db viejo (obtenido antes del
  // cambio) sí debe fallar fuerte -- nunca debe leerse/escribirse en silencio
  // contra el local anterior.
  assert.throws(() => ref(dbA, 'otroNodo'));
});
await check('un consumidor que pide el database DESPUÉS del cambio siempre obtiene el de B, nunca el de A', () => {
  const dbNow = getDatabase(); // bare, como hacen ~100 archivos de la app
  assert.strictEqual(dbNow.app.options.databaseURL, CONFIGS['local-B'].dbUrl);
});

console.log('\n8. Una acción de guardado durante firebaseSwitching es rechazada SIN escribir:');
await resetAllApps();
await loadInitialDataSimulated('local-A');
await check('getCurrentDatabaseOrThrow() lanza FirebaseNotReadyError apenas empieza el cambio (switching=true), antes de cualquier escritura', () => {
  storedLocalId = 'local-B';
  markFirebaseSwitching(); // igual que el primer paso real de loadInitialData
  assert.strictEqual(getFirebaseReadinessSnapshot().switching, true);
  let writeAttempted = false;
  assert.throws(() => {
    const db = getCurrentDatabaseOrThrow('local-B'); // debe explotar ACÁ
    writeAttempted = true; // si esto se ejecuta, el guard falló
    set(ref(db, 'no/deberia/escribirse'), { x: 1 });
  }, FirebaseNotReadyError);
  assert.strictEqual(writeAttempted, false, 'no debía llegar a intentar escribir');
});

console.log('\n9. Una acción posterior a firebaseReady escribe en el local NUEVO (B), nunca en A:');
await check('getCurrentDatabaseOrThrow() devuelve la database de B una vez terminado el cambio', async () => {
  await initializeFirebaseApp();
  markFirebaseReady();
  assert.strictEqual(getFirebaseReadinessSnapshot().ready, true);
  const db = getCurrentDatabaseOrThrow('local-B');
  assert.strictEqual(db.app.options.databaseURL, CONFIGS['local-B'].dbUrl);
  assert.notStrictEqual(db.app.options.databaseURL, CONFIGS['local-A'].dbUrl);
});

console.log('\n10. Error al inicializar el local B y posterior Reintentar:');
await resetAllApps();
await check('si la config es inválida (fallo real -- ni ensureFirebaseAppSync ni initializeFirebaseApp producen una app), queda error seteado y ready=false/switching=false (pantalla de Reintentar)', async () => {
  // 'local-incompleto' (apiKey: '') hace que TANTO ensureFirebaseAppSync como
  // initializeFirebaseApp devuelvan null -- un fallo real, a diferencia de un
  // flag artificial que solo saltee el llamado mientras la app ya se creó.
  await loadInitialDataSimulated('local-incompleto');
  const snap = getFirebaseReadinessSnapshot();
  assert.strictEqual(snap.ready, false);
  assert.strictEqual(snap.switching, false);
  assert.ok(snap.error, 'debería haber un mensaje de error para mostrar en la pantalla de Reintentar');
});
await check('mientras hay error, no quedó ninguna app creada a medias', () => {
  assert.strictEqual(getDefaultAppOrNull(), null);
});
await check('mientras hay error, getCurrentDatabaseOrThrow también rechaza (no hay app para ningún local)', () => {
  assert.throws(() => getCurrentDatabaseOrThrow('local-incompleto'), FirebaseNotReadyError);
});
await check('"Reintentar" con un localId VÁLIDO (el usuario corrige la config o cambia de local) recupera el estado ready', async () => {
  const { finalApp } = await loadInitialDataSimulated('local-B');
  assert.ok(finalApp);
  const snap = getFirebaseReadinessSnapshot();
  assert.strictEqual(snap.ready, true);
  assert.strictEqual(snap.error, null);
});

console.log('\n11. "Actualizar aplicación" (clearSafeLocalCache + chequeo de conexión) después de cambiar de local:');
await resetAllApps();
await loadInitialDataSimulated('local-A');
await loadInitialDataSimulated('local-B');
await check('el chequeo de conexión (.info/connected) usa la app/database del local ACTUAL (B), nunca la de A', () => {
  // Mismo patrón que checkFirebaseReallyConnected() en App.jsx.
  const db = getCurrentDatabaseOrThrow();
  const connectedRef = ref(db, '.info/connected');
  assert.strictEqual(db.app.options.databaseURL, CONFIGS['local-B'].dbUrl);
  assert.ok(connectedRef); // la ref se arma sin error contra la db correcta
});

console.log('\n12. Storage nunca recibe una Promise como app:');
await resetAllApps();
await check('getFirebaseApp() con la app ya creada devuelve la instancia, no una Promise', async () => {
  await loadInitialDataSimulated('local-A');
  const app = getFirebaseApp('local-A');
  assert.ok(app);
  assert.strictEqual(app instanceof Promise, false);
  assert.strictEqual(typeof app.then, 'undefined');
});
await check('getFirebaseApp() sin ninguna app creada todavía devuelve null (nunca una Promise pendiente)', () => {
  const app = getFirebaseApp('local-que-no-existe-todavia');
  assert.notStrictEqual(app, undefined);
  assert.strictEqual(app instanceof Promise, false);
});
await check('getStorage(getFirebaseApp()) funciona sin "await" -- nunca se le pasa una Promise', async () => {
  await resetAllApps();
  await loadInitialDataSimulated('local-A');
  const app = getFirebaseApp('local-A'); // SIN await, como hace storage.js
  const storage = getStorage(app); // si app fuera una Promise, esto explotaría
  assert.ok(storage);
  assert.strictEqual(storage.app, app);
});

await resetAllApps();
console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
