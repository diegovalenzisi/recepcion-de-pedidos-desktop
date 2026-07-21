// Test plano con node:assert -- el proyecto no tiene test runner configurado.
//
// core.js (ensureFirebaseAppSync) NO se puede importar directamente en Node:
// usa import.meta.env.VITE_*, que solo existe cuando Vite procesa el archivo
// (Node puro no lo define y el import fallaría al cargar el módulo). Por eso
// este test ejercita el MISMO patrón, con el SDK real de firebase/app y
// firebase/database, sin pasar por core.js -- valida que:
//   1. antes de initializeApp(), no existe una app '[DEFAULT]' (el estado que
//      dispara "No Firebase App '[DEFAULT]' has been created").
//   2. getApps().find(a => a.name === '[DEFAULT]') seguido de initializeApp()
//      solo si no existe (el patrón pedido) deja SIEMPRE una app disponible.
//   3. una vez creada, getDatabase(app) funciona sin lanzar el error app/no-app
//      -- la causa raíz que reproducía el bug.
//
// Correr con: node src/lib/firebase/__tests__/firebaseAppPattern.test.js
import assert from 'node:assert';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

// getDefaultAppOrNull() tal cual vive en core.js -- no usa getApps()[0]
// porque puede haber apps CON NOMBRE creadas antes que la default.
const getDefaultAppOrNull = () => getApps().find((a) => a.name === '[DEFAULT]') || null;

const TEST_CONFIG = {
  apiKey: 'test-api-key',
  projectId: 'test-project',
  databaseURL: 'https://test-project-default-rtdb.firebaseio.com',
  storageBucket: 'test-project.firebasestorage.app',
};

console.log('Estado inicial (simula un reload recién ocurrido, sin ninguna app creada):');
check('no existe ninguna app Firebase todavía', () => {
  assert.strictEqual(getApps().length, 0);
});
check('getDefaultAppOrNull() devuelve null', () => {
  assert.strictEqual(getDefaultAppOrNull(), null);
});
check('getDatabase() SIN una app creada lanza el error app/no-app (reproduce el bug)', () => {
  assert.throws(() => getDatabase(), /No Firebase App .* has been created/);
});

console.log('\nPatrón ensureFirebaseAppSync(): getDefaultAppOrNull() ?? initializeApp(config)');
let app;
check('initializeApp() crea la app cuando no existía', () => {
  const existing = getDefaultAppOrNull();
  app = existing || initializeApp(TEST_CONFIG);
  assert.ok(app);
  assert.strictEqual(app.name, '[DEFAULT]');
});
check('getDefaultAppOrNull() ahora la encuentra', () => {
  assert.strictEqual(getDefaultAppOrNull(), app);
});
check('llamar la misma lógica de nuevo NO crea una segunda app (evita "Firebase App already exists")', () => {
  const existing = getDefaultAppOrNull();
  const appAgain = existing || initializeApp(TEST_CONFIG);
  assert.strictEqual(appAgain, app);
  assert.strictEqual(getApps().length, 1);
});

console.log('\nCon la app creada, los servicios ya no explotan (causa raíz resuelta):');
check('getDatabase(app) funciona pasando la instancia explícita', () => {
  const db = getDatabase(app);
  assert.ok(db);
});
check('getDatabase() sin argumentos también funciona una vez que existe la app default', () => {
  const db = getDatabase();
  assert.ok(db);
});

await deleteApp(app);

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
