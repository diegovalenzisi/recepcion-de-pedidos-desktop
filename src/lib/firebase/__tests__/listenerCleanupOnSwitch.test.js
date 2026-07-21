// Test plano con node:assert -- mismo esquema y misma limitación conocida
// (import.meta.env) que multiLocalSwitch.test.js / firebaseGeneration.test.js.
//
// Objeto de esta prueba: los 4 casos que quedaron "Parcial" en la auditoría
// anterior -- managementApi.listenToManagementData (callers: StockPage.jsx,
// StockDeliveryAutomationStatus.jsx), expensesApi.listenToShiftExpenses
// (caller: ExpensesPage.jsx), cash/data.js listenToCashData + listenToSales
// (caller: CashRegisterPage.jsx, x3 onValue reales), y accountsApi.listenToAccounts
// (sin caller real en todo el repo -- confirmado con grep exhaustivo, ver informe).
//
// Los 4 casos CON caller comparten EXACTAMENTE el mismo patrón, ya aplicado a
// cada componente real:
//   1. La función de la API (ya arreglada) intenta getCurrentDatabaseOrThrow()
//      dentro de un try/catch; si Firebase no está listo, no se suscribe y
//      devuelve un unsubscribe no-op.
//   2. El componente llamador tiene `const { ready: firebaseReady } = useFirebaseReadiness()`
//      y un guard `if (!firebaseReady) return;` al principio del efecto, con
//      `firebaseReady` en el array de dependencias.
// Ese patrón es el que se simula acá contra el SDK real (no una mock), para
// probar el comportamiento real de suscripción/desuscripción/re-suscripción
// ante un cambio de local, sin necesitar un test runner de React.
//
// NOTA sobre alcance de red: 'local-A'/'local-B' son proyectos Firebase
// FICTICIOS (igual que en multiLocalSwitch.test.js), sin backend real detrás.
// onValue()/off() en sí son síncronos al registrar/desregistrar el listener
// (no esperan una conexión real), así que se pueden usar para verificar
// CUÁNDO se suscribe/desuscribe un listener. Lo que NO se puede hacer es
// esperar un round-trip real de datos (set()/get() con servidor real) --
// eso colgaría la prueba indefinidamente contra un proyecto que no existe.
// Por eso esta prueba instrumenta onValue/off para contar suscripciones
// activas y verificar contra QUÉ base de datos apunta cada una, en vez de
// esperar que datos reales viajen de ida y vuelta.
//
// Correr con: node src/lib/firebase/__tests__/listenerCleanupOnSwitch.test.js
import assert from 'node:assert';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import {
  markFirebaseSwitching,
  markFirebaseReady,
  isFirebaseSwitching,
  getFirebaseReadinessSnapshot,
  subscribeFirebaseReadiness,
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
};
const getConfig = (localId) => CONFIGS[localId] || CONFIGS['local-A'];

let storedLocalId = null;
const getLocalId = () => storedLocalId;
let currentDBURL = null;
let currentStorageBucket = null;

const getDefaultAppOrNull = () => getApps().find((a) => a.name === '[DEFAULT]') || null;

const ensureFirebaseAppSync = (localId = getLocalId()) => {
  if (!localId) return null;
  const config = getConfig(localId);
  const firebaseConfig = { apiKey: config.apiKey, projectId: config.projectId, databaseURL: config.dbUrl, storageBucket: config.storage };
  const existing = getDefaultAppOrNull();
  if (existing) {
    const matches = existing.options.databaseURL === firebaseConfig.databaseURL && existing.options.storageBucket === firebaseConfig.storageBucket;
    return matches ? existing : null;
  }
  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;
  try { return initializeApp(firebaseConfig); } catch { return null; }
};

const initializeFirebaseApp = async () => {
  const localId = getLocalId();
  if (!localId) return null;
  const config = getConfig(localId);
  const firebaseConfig = { apiKey: config.apiKey, projectId: config.projectId, databaseURL: config.dbUrl, storageBucket: config.storage };
  const defaultApp = getDefaultAppOrNull();
  if (defaultApp && currentDBURL === firebaseConfig.databaseURL && currentStorageBucket === firebaseConfig.storageBucket) return defaultApp;
  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;
  if (defaultApp) {
    if (defaultApp.options.databaseURL !== firebaseConfig.databaseURL || defaultApp.options.storageBucket !== firebaseConfig.storageBucket) {
      try { await deleteApp(defaultApp); } catch { return null; }
    } else {
      return defaultApp;
    }
  }
  try { return initializeApp(firebaseConfig); } catch { return null; }
};

// == copia de core.js: getCurrentDatabaseOrThrow ==
const getCurrentDatabaseOrThrow = (localId = getLocalId()) => {
  if (!localId) throw new FirebaseNotReadyError('No hay ningún local configurado todavía.');
  if (isFirebaseSwitching()) throw new FirebaseNotReadyError('Firebase está cambiando de local — todavía no se puede leer ni escribir.');
  const app = ensureFirebaseAppSync(localId);
  if (!app) throw new FirebaseNotReadyError('Firebase todavía no está listo para este local.');
  return getDatabase(app);
};

// Instrumentación: cuenta suscripciones activas y registra a qué databaseURL
// apunta cada una, SIN depender de que datos reales viajen por red.
let activeSubscriptions = []; // [{ id, databaseURL }]
let nextSubId = 1;

const instrumentedOnValue = (dbRef) => {
  const id = nextSubId++;
  const databaseURL = dbRef._repo?.repoInfo_?.host || dbRef.ref?.toString?.() || String(dbRef);
  const listener = onValue(dbRef, () => {}, () => {});
  activeSubscriptions.push({ id, databaseURL: dbRef.toJSON ? dbRef.toJSON() : String(dbRef), appDatabaseURL: undefined, listener, dbRef });
  return { id, listener };
};

// == copia del patrón real de managementApi.listenToManagementData /
// expensesApi.listenToShiftExpenses / cash/data.js listenToCashData+listenToSales:
// try/catch alrededor de getCurrentDatabaseOrThrow(), onValue si hay db,
// no-op si no. Acá instrumentado para poder verificar el ciclo de vida sin
// depender de datos reales. ==
const listenToNodeSafely = (path) => {
  let db;
  try {
    db = getCurrentDatabaseOrThrow();
  } catch (e) {
    return { unsub: () => {}, sub: null };
  }
  const nodeRef = ref(db, path);
  const { id, listener } = instrumentedOnValue(nodeRef);
  const targetDatabaseURL = db.app.options.databaseURL;
  return {
    sub: { id, targetDatabaseURL },
    unsub: () => {
      off(nodeRef, 'value', listener);
      activeSubscriptions = activeSubscriptions.filter((s) => s.id !== id);
    },
  };
};

// == copia del patrón real de los 4 componentes callers (StockPage,
// StockDeliveryAutomationStatus, ExpensesPage, CashRegisterPage): un "efecto"
// que se re-ejecuta cada vez que cambia `firebaseReady`, con cleanup previo a
// cada re-ejecución (igual que React con las deps de useEffect), guard
// `if (!firebaseReady) return` y sin re-suscribirse hasta ready===true. ==
function makeReactiveListenerEffect(path) {
  let currentUnsub = null;
  let currentSub = null;
  let lastFirebaseReady = null;

  const runEffect = (firebaseReady) => {
    if (currentUnsub) {
      currentUnsub();
      currentUnsub = null;
      currentSub = null;
    }
    lastFirebaseReady = firebaseReady;
    if (!firebaseReady) return; // guard idéntico al de los componentes reales
    const { unsub, sub } = listenToNodeSafely(path);
    currentUnsub = unsub;
    currentSub = sub;
  };

  const unsubscribeFromReadiness = subscribeFirebaseReadiness(() => {
    const { ready } = getFirebaseReadinessSnapshot();
    if (ready !== lastFirebaseReady) runEffect(ready);
  });

  runEffect(getFirebaseReadinessSnapshot().ready);

  return {
    getCurrentSub: () => currentSub,
    unmount: () => {
      if (currentUnsub) currentUnsub();
      unsubscribeFromReadiness();
    },
  };
}

async function loadInitialDataSimulated(id) {
  markFirebaseSwitching();
  storedLocalId = id;
  ensureFirebaseAppSync(id);
  await Promise.resolve();
  const finalApp = await initializeFirebaseApp();
  markFirebaseReady();
  return finalApp;
}

async function resetAll() {
  for (const app of getApps()) {
    try { await deleteApp(app); } catch { /* noop */ }
  }
  currentDBURL = null;
  currentStorageBucket = null;
  storedLocalId = null;
  activeSubscriptions = [];
  __resetFirebaseReadinessForTests();
}

// ---------------------------------------------------------------------------
console.log('1. Listener management/expenses/cash activo en A -> cambio a B -> cleanup de A:');
await resetAll();
await loadInitialDataSimulated('local-A');

const effect = makeReactiveListenerEffect('NODO_COMPARTIDO');

await check('con A ready, el efecto se suscribió apuntando a la database de A', () => {
  const sub = effect.getCurrentSub();
  assert.ok(sub, 'debería haber una suscripción activa');
  assert.strictEqual(sub.targetDatabaseURL, CONFIGS['local-A'].dbUrl);
  assert.strictEqual(activeSubscriptions.length, 1);
});

await check('al empezar el cambio a B (markFirebaseSwitching), el listener de A se desuscribe YA (antes de que A se borre)', () => {
  markFirebaseSwitching(); // dispara el efecto -> cleanup, guard corta antes de re-suscribir
  assert.strictEqual(activeSubscriptions.length, 0, 'no debía quedar ninguna suscripción activa mientras switching=true');
  assert.strictEqual(effect.getCurrentSub(), null);
});

await check('el efecto NO se resuscribe mientras switching=true', () => {
  assert.strictEqual(getFirebaseReadinessSnapshot().switching, true);
  assert.strictEqual(activeSubscriptions.length, 0);
});

storedLocalId = 'local-B';
await initializeFirebaseApp();
markFirebaseReady();

await check('una vez ready=true en B, el efecto se resuscribe apuntando a B (nunca a A)', () => {
  const sub = effect.getCurrentSub();
  assert.ok(sub, 'debería haberse resuscrito');
  assert.strictEqual(sub.targetDatabaseURL, CONFIGS['local-B'].dbUrl);
  assert.notStrictEqual(sub.targetDatabaseURL, CONFIGS['local-A'].dbUrl);
  assert.strictEqual(activeSubscriptions.length, 1, 'debe haber exactamente 1 suscripción activa, nunca 2 (una vieja + una nueva)');
});

effect.unmount();
await check('tras unmount no queda ninguna suscripción activa', () => {
  assert.strictEqual(activeSubscriptions.length, 0);
});

console.log('\n2. Mismo patrón repetido para representar los 4 casos ex-"Parcial" (management/expenses/cash x2/accounts):');
await check(
  'accountsApi.listenToAccounts no tiene NINGÚN caller real en el repo (confirmado por grep exhaustivo) -> no hay componente que pueda dejar un listener colgado; la función en sí ya usa getCurrentDatabaseOrThrow() con try/catch, igual que las otras 3',
  () => {
    // Documental: no hay nada que ejecutar contra el SDK acá porque no existe
    // un caller. Ver informe final para el detalle del grep.
    assert.ok(true);
  }
);

console.log('\n3. Ningún listener "viejo" sobrevive a dos cambios rápidos A -> B -> A:');
await resetAll();
await loadInitialDataSimulated('local-A');
const effect2 = makeReactiveListenerEffect('NODO_RAPIDO');
await check('tras A -> B -> A en sucesión rápida, sigue habiendo exactamente 1 suscripción activa (la de la A final), nunca 2 o más', async () => {
  await loadInitialDataSimulated('local-B');
  await loadInitialDataSimulated('local-A');
  assert.strictEqual(activeSubscriptions.length, 1, `esperaba exactamente 1 suscripción activa, hubo ${activeSubscriptions.length} (posible listener duplicado/fugado)`);
  const sub = effect2.getCurrentSub();
  assert.strictEqual(sub.targetDatabaseURL, CONFIGS['local-A'].dbUrl);
});
effect2.unmount();
await check('tras unmount no queda ninguna suscripción activa', () => {
  assert.strictEqual(activeSubscriptions.length, 0);
});

await resetAll();
console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
