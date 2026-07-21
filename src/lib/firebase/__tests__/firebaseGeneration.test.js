// Test plano con node:assert -- mismo esquema que multiLocalSwitch.test.js.
//
// LIMITACIÓN CONOCIDA (igual que multiLocalSwitch.test.js): core.js usa
// import.meta.env.VITE_* en el top-level, así que no se puede importar
// directo en Node puro. Este archivo replica VERBATIM (ver comentarios
// "== copia de core.js ==") la lógica de beginFirebaseOperation() y
// getCurrentDatabaseOrThrow() contra el SDK real de firebase/app y
// firebase/database, más las importaciones REALES de readiness.js
// (getFirebaseGeneration, markFirebaseSwitching, etc. -- sin réplica, ver
// justificación en readiness.js). Si core.js cambia esta lógica, actualizar
// acá a mano.
//
// Cubre el punto 3 (firebaseGeneration / beginFirebaseOperation) y las
// pruebas obligatorias de operaciones en vuelo del pedido de auditoría:
// guardado con await intermedio + cambio de local antes de la escritura
// final, guardado después de que el nuevo local está ready, dos cambios
// rápidos A->B->A, error inicializando B con una operación de A en vuelo, y
// que ningún callback de A se ejecute después de markFirebaseReady(B).
//
// Correr con: node src/lib/firebase/__tests__/firebaseGeneration.test.js
import assert from 'node:assert';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import {
  markFirebaseSwitching,
  markFirebaseReady,
  markFirebaseError,
  isFirebaseSwitching,
  isFirebaseReady,
  getFirebaseGeneration,
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

const CONFIGS = {
  'local-A': { apiKey: 'key-A', projectId: 'proj-a', dbUrl: 'https://proj-a-default-rtdb.firebaseio.com', storage: 'proj-a.firebasestorage.app' },
  'local-B': { apiKey: 'key-B', projectId: 'proj-b', dbUrl: 'https://proj-b-default-rtdb.firebaseio.com', storage: 'proj-b.firebasestorage.app' },
  'local-incompleto': { apiKey: '', projectId: 'proj-x', dbUrl: 'https://proj-x-default-rtdb.firebaseio.com', storage: 'proj-x.firebasestorage.app' },
};
const getConfig = (localId) => CONFIGS[localId] || CONFIGS['local-A'];

let storedLocalId = null;
const getLocalId = () => storedLocalId;
let currentLocalIdVar = null; // == copia de core.js: getCurrentLocalId() (variable de módulo, seteada por checkLocalId/setFirebaseLocalId)
const getCurrentLocalId = () => currentLocalIdVar;

let currentDBURL = null;
let currentStorageBucket = null;

// == copia de core.js: getDefaultAppOrNull ==
const getDefaultAppOrNull = () => getApps().find((a) => a.name === '[DEFAULT]') || null;

// == copia de core.js: ensureFirebaseAppSync ==
const ensureFirebaseAppSync = (localId = getLocalId()) => {
  if (!localId) return null;
  const config = getConfig(localId);
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };
  if (!firebaseConfig.databaseURL || !firebaseConfig.apiKey || !firebaseConfig.projectId) return null;

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

// == copia de core.js: initializeFirebaseApp ==
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
  if (!firebaseConfig.databaseURL || !firebaseConfig.apiKey || !firebaseConfig.projectId) return null;

  const defaultApp = getDefaultAppOrNull();
  if (defaultApp && currentDBURL === firebaseConfig.databaseURL && currentStorageBucket === firebaseConfig.storageBucket) {
    return defaultApp;
  }
  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  if (defaultApp) {
    if (defaultApp.options.databaseURL !== firebaseConfig.databaseURL || defaultApp.options.storageBucket !== firebaseConfig.storageBucket) {
      try { await deleteApp(defaultApp); } catch (err) { return null; }
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

// == copia de core.js: getCurrentDatabaseOrThrow ==
const getCurrentDatabaseOrThrow = (localId = getCurrentLocalId() || getLocalId()) => {
  if (!localId) throw new FirebaseNotReadyError('No hay ningún local configurado todavía.');
  if (isFirebaseSwitching()) throw new FirebaseNotReadyError('Firebase está cambiando de local — todavía no se puede leer ni escribir.');
  const app = ensureFirebaseAppSync(localId);
  if (!app) throw new FirebaseNotReadyError('Firebase todavía no está listo para este local.');
  return getDatabase(app);
};

// == copia de core.js: beginFirebaseOperation ==
const beginFirebaseOperation = (localId = getCurrentLocalId() || getLocalId()) => {
  const generation = getFirebaseGeneration();
  const getDatabaseOrAbort = () => {
    if (!isFirebaseReady()) {
      throw new FirebaseNotReadyError('Firebase no está listo — operación abortada (posible cambio de local en curso).');
    }
    if (isFirebaseSwitching()) {
      throw new FirebaseNotReadyError('Firebase está cambiando de local — operación abortada para evitar escribir en el local incorrecto.');
    }
    if (getFirebaseGeneration() !== generation) {
      throw new FirebaseNotReadyError('El local cambió mientras la operación estaba en curso — operación abortada para evitar escribir en el local incorrecto.');
    }
    const activeLocalId = getCurrentLocalId() || getLocalId();
    if (!localId || activeLocalId !== localId) {
      throw new FirebaseNotReadyError('El local activo cambió mientras la operación estaba en curso — operación abortada.');
    }
    return getCurrentDatabaseOrThrow(localId);
  };
  return { localId, generation, getDatabaseOrAbort };
};

async function loadInitialDataSimulated(id) {
  markFirebaseSwitching();
  storedLocalId = id;
  currentLocalIdVar = id;
  ensureFirebaseAppSync(id);
  await Promise.resolve();
  const finalApp = await initializeFirebaseApp();
  if (!finalApp) {
    markFirebaseError(new Error('No se pudo inicializar Firebase para este local.'));
  } else {
    markFirebaseReady();
  }
  return finalApp;
}

async function resetAll() {
  for (const app of getApps()) {
    try { await deleteApp(app); } catch { /* noop */ }
  }
  currentDBURL = null;
  currentStorageBucket = null;
  storedLocalId = null;
  currentLocalIdVar = null;
  __resetFirebaseReadinessForTests();
}

// ---------------------------------------------------------------------------
console.log('1. firebaseGeneration -- contador básico:');
await resetAll();
await check('empieza en 0 tras el reset', () => {
  assert.strictEqual(getFirebaseGeneration(), 0);
});
await check('sube exactamente 1 por cada markFirebaseSwitching(), nunca por markFirebaseReady/Error', () => {
  markFirebaseSwitching();
  assert.strictEqual(getFirebaseGeneration(), 1);
  markFirebaseReady();
  assert.strictEqual(getFirebaseGeneration(), 1);
  markFirebaseError('x');
  assert.strictEqual(getFirebaseGeneration(), 1);
  markFirebaseSwitching();
  assert.strictEqual(getFirebaseGeneration(), 2);
});

console.log('\n2. beginFirebaseOperation() -- captura y revalidación básica:');
await resetAll();
await loadInitialDataSimulated('local-A');
await check('getDatabaseOrAbort() devuelve la db de A si nada cambió', () => {
  const op = beginFirebaseOperation('local-A');
  const db = op.getDatabaseOrAbort();
  assert.strictEqual(db.app.options.databaseURL, CONFIGS['local-A'].dbUrl);
});
await check('getDatabaseOrAbort() puede llamarse varias veces mientras nada cambia', () => {
  const op = beginFirebaseOperation('local-A');
  op.getDatabaseOrAbort();
  op.getDatabaseOrAbort();
  const db = op.getDatabaseOrAbort();
  assert.ok(db);
});

// NOTA: estas pruebas usan projectos Firebase FICTICIOS (proj-a/proj-b, sin
// backend real detrás) — igual que multiLocalSwitch.test.js. Por eso, al
// igual que ese archivo, nunca se hace un await de un set()/get() real (eso
// intentaría una conexión de red real y colgaría la prueba indefinidamente).
// Lo que importa probar es el chequeo SINCRÓNICO de getDatabaseOrAbort():
// si lanza, el caller nunca llega a la línea del set() real, así que no hace
// falta ejecutar el set() de verdad para demostrar que no se escribe.

console.log('\n3. Guardado con await intermedio + cambio de local ANTES de la escritura final:');
await resetAll();
await loadInitialDataSimulated('local-A');
await check(
  'op capturado en A + await intermedio + cambio a B => getDatabaseOrAbort() lanza ANTES de llegar a la línea de escritura',
  async () => {
    const op = beginFirebaseOperation('local-A');
    // Simula el await real entre "obtener db" y "escribir" (ej. getNextOrderId(),
    // una subida a Storage, un fetch externo).
    await Promise.resolve();
    // El usuario cambia de local mientras la operación estaba esperando.
    await loadInitialDataSimulated('local-B');

    let reachedWriteLine = false;
    assert.throws(() => {
      op.getDatabaseOrAbort(); // debe explotar ACÁ, antes de construir el ref/set
      reachedWriteLine = true;
    }, FirebaseNotReadyError);
    assert.strictEqual(reachedWriteLine, false, 'no debía llegar a la línea de escritura ni en A ni en B');
  }
);

console.log('\n4. Guardado iniciado DESPUÉS de que el nuevo local ya está ready:');
await check('un op capturado luego de markFirebaseReady(B) obtiene una db válida apuntando solo a B (nunca a A)', () => {
  const op = beginFirebaseOperation('local-B');
  const db = op.getDatabaseOrAbort(); // no lanza: nada cambió desde que se capturó
  assert.strictEqual(db.app.options.databaseURL, CONFIGS['local-B'].dbUrl);
  assert.notStrictEqual(db.app.options.databaseURL, CONFIGS['local-A'].dbUrl);
});

console.log('\n5. Dos cambios rápidos A -> B -> A:');
await resetAll();
await loadInitialDataSimulated('local-A');
await check('un op capturado antes de A->B->A queda inválido aunque el local final vuelva a ser el mismo (A)', async () => {
  const op = beginFirebaseOperation('local-A');
  const generationAtStart = op.generation;
  await loadInitialDataSimulated('local-B');
  await loadInitialDataSimulated('local-A'); // vuelve a A, pero la generación ya subió dos veces
  assert.notStrictEqual(getFirebaseGeneration(), generationAtStart);
  assert.throws(() => op.getDatabaseOrAbort(), FirebaseNotReadyError);
});
await check('un op capturado DESPUÉS de las dos vueltas sí funciona normalmente', () => {
  const op = beginFirebaseOperation('local-A');
  const db = op.getDatabaseOrAbort();
  assert.strictEqual(db.app.options.databaseURL, CONFIGS['local-A'].dbUrl);
});

console.log('\n6. Error inicializando B mientras había una operación de A en vuelo:');
await resetAll();
await loadInitialDataSimulated('local-A');
await check('op capturado en A se invalida apenas EMPIEZA el cambio a B, sin esperar a que B falle o no', async () => {
  const op = beginFirebaseOperation('local-A');
  await Promise.resolve();
  // 'local-incompleto' hace que initializeFirebaseApp() falle de verdad.
  await loadInitialDataSimulated('local-incompleto');
  const snap = { ready: isFirebaseReady(), switching: isFirebaseSwitching() };
  assert.strictEqual(snap.ready, false);
  assert.strictEqual(snap.switching, false); // quedó en pantalla de error, no colgado en "switching"
  // El op de A sigue inválido pase lo que pase con B: no hay forma de que
  // termine escribiendo, ni en A (que ya no es el local activo) ni en el
  // estado de error de B.
  assert.throws(() => op.getDatabaseOrAbort(), FirebaseNotReadyError);
});

console.log('\n7. Ningún callback de A se ejecuta después de markFirebaseReady(B):');
await resetAll();
await loadInitialDataSimulated('local-A');
await check('un op de A queda permanentemente inválido una vez que B está ready, incluso mucho después', async () => {
  const op = beginFirebaseOperation('local-A');
  await loadInitialDataSimulated('local-B');
  assert.strictEqual(isFirebaseReady(), true); // B está operativo
  // Múltiples intentos tardíos de "terminar" la operación de A: todos deben abortar.
  assert.throws(() => op.getDatabaseOrAbort(), FirebaseNotReadyError);
  await Promise.resolve();
  assert.throws(() => op.getDatabaseOrAbort(), FirebaseNotReadyError);
});

console.log('\n8. Operación crítica sin await previo (Categoría B) sigue funcionando sin cambios:');
await resetAll();
await loadInitialDataSimulated('local-A');
await check('beginFirebaseOperation()+getDatabaseOrAbort() inmediato equivale a getCurrentDatabaseOrThrow()', () => {
  const op = beginFirebaseOperation();
  const db1 = op.getDatabaseOrAbort();
  const db2 = getCurrentDatabaseOrThrow();
  assert.strictEqual(db1.app.options.databaseURL, db2.app.options.databaseURL);
});

await resetAll();
console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
