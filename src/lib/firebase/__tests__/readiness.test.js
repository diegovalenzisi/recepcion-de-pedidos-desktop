// Test plano con node:assert. A diferencia de core.js, readiness.js NO tiene
// import.meta.env.VITE_* en el top-level, así que se puede importar DIRECTO
// (no una réplica) — ver comentario en readiness.js.
//
// Correr con: node src/lib/firebase/__tests__/readiness.test.js
import assert from 'node:assert';
import {
  getFirebaseReadinessSnapshot,
  subscribeFirebaseReadiness,
  markFirebaseSwitching,
  markFirebaseReady,
  markFirebaseError,
  isFirebaseReady,
  isFirebaseSwitching,
  FirebaseNotReadyError,
  __resetFirebaseReadinessForTests,
} from '../readiness.js';

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

__resetFirebaseReadinessForTests();

console.log('Estado inicial:');
check('empieza no-ready, no-switching, sin error', () => {
  const s = getFirebaseReadinessSnapshot();
  assert.deepStrictEqual(s, { ready: false, switching: false, error: null });
});

console.log('\nmarkFirebaseSwitching():');
check('pone switching=true, ready=false, limpia error', () => {
  markFirebaseError('algo falló antes');
  markFirebaseSwitching();
  assert.strictEqual(isFirebaseSwitching(), true);
  assert.strictEqual(isFirebaseReady(), false);
  assert.strictEqual(getFirebaseReadinessSnapshot().error, null);
});

console.log('\nmarkFirebaseReady():');
check('pone ready=true, switching=false, sin error', () => {
  markFirebaseReady();
  assert.strictEqual(isFirebaseReady(), true);
  assert.strictEqual(isFirebaseSwitching(), false);
  assert.strictEqual(getFirebaseReadinessSnapshot().error, null);
});

console.log('\nmarkFirebaseError():');
check('pone ready=false, switching=false, guarda el mensaje', () => {
  markFirebaseError(new Error('sin conexión'));
  assert.strictEqual(isFirebaseReady(), false);
  assert.strictEqual(isFirebaseSwitching(), false);
  assert.strictEqual(getFirebaseReadinessSnapshot().error, 'sin conexión');
});

console.log('\nSnapshot estable (requisito de useSyncExternalStore):');
check('dos lecturas seguidas sin cambios devuelven el MISMO objeto', () => {
  const a = getFirebaseReadinessSnapshot();
  const b = getFirebaseReadinessSnapshot();
  assert.strictEqual(a, b);
});
check('un cambio real sí produce un objeto nuevo', () => {
  const before = getFirebaseReadinessSnapshot();
  markFirebaseReady();
  const after = getFirebaseReadinessSnapshot();
  assert.notStrictEqual(before, after);
});

console.log('\nSubscripción:');
check('subscribeFirebaseReadiness notifica en cada cambio', () => {
  let calls = 0;
  const unsub = subscribeFirebaseReadiness(() => { calls += 1; });
  markFirebaseSwitching();
  markFirebaseReady();
  markFirebaseError('x');
  assert.strictEqual(calls, 3);
  unsub();
});
check('un subscriber roto no rompe a los demás', () => {
  let secondCalled = false;
  const unsub1 = subscribeFirebaseReadiness(() => { throw new Error('subscriber roto'); });
  const unsub2 = subscribeFirebaseReadiness(() => { secondCalled = true; });
  markFirebaseReady();
  assert.strictEqual(secondCalled, true);
  unsub1();
  unsub2();
});
check('unsubscribe deja de notificar', () => {
  let calls = 0;
  const unsub = subscribeFirebaseReadiness(() => { calls += 1; });
  unsub();
  markFirebaseSwitching();
  assert.strictEqual(calls, 0);
});

console.log('\nFirebaseNotReadyError:');
check('tiene code "firebase/not-ready" y es instancia de Error', () => {
  const err = new FirebaseNotReadyError('no listo');
  assert.strictEqual(err.code, 'firebase/not-ready');
  assert.strictEqual(err.name, 'FirebaseNotReadyError');
  assert.ok(err instanceof Error);
  assert.strictEqual(err.message, 'no listo');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
