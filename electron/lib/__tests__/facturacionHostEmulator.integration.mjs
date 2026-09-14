// HOST FISCAL ÚNICO POR LOCAL — SMOKE TEST CONTRA EL EMULADOR REAL.
//
// Los tests puros de facturacionHost.test.js prueban `reductorDeHost` /
// `reductorDeLiberacion` contra un nodo Firebase FALSO que imita
// `transaction()` a mano. Este archivo complementa eso corriendo los MISMOS
// reductores contra `runTransaction` del SDK real (`firebase/database`) y el
// wire protocol real del emulador — para confirmar que el contrato de la
// transacción (reductor que puede devolver `undefined` para abortar) se
// comporta igual ahí que en la simulación, no sólo en el modelo mental.
//
// No reemplaza los tests puros: no vuelve a probar la lógica de decisión
// (eso ya está cubierto, sin emulador, en facturacionHost.test.js), sólo la
// plomería real.
//
// Correr con:
//   npm run test:facturacion-host-emulator
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, runTransaction, onValue, connectDatabaseEmulator } from 'firebase/database';

const require = createRequire(import.meta.url);
const { reductorDeHost, reductorDeLiberacion, LEASE_MS } = require('../facturacionHost.js');

/**
 * Mismo mecanismo que `armarListenerDeTransferencia` en electron/main.js:
 * espera a que el cache local del SDK cliente tenga un valor REAL de ese
 * path antes de devolver. Hace falta porque `runTransaction` decide su
 * PRIMER pase con lo que YA haya en el cache local
 * (`syncTreeCalcCompleteEventCache`, ver node_modules/@firebase/database) —
 * sin ningún listener activo sobre el path, ese primer pase ve `null`. El
 * test "REGRESIÓN" de abajo reproduce, a propósito, lo que pasa SIN esto.
 */
function esperarCacheCaliente(db, path) {
  return new Promise((resolve) => {
    let resuelto = false;
    onValue(ref(db, path), () => {
      if (!resuelto) { resuelto = true; resolve(); }
    });
  });
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) {
  console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST: hay que correrlo con `firebase emulators:exec`.');
  process.exit(1);
}
const [host, port] = HOST.split(':');
const cliente = (nombre) => {
  const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, nombre);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, Number(port));
  return db;
};
// Dos PCs de verdad, dos conexiones independientes al mismo emulador.
const PC_A = cliente('hostFiscalPcA');
const PC_B = cliente('hostFiscalPcB');

const LOCAL = 'joao-58290322';
const hostPath = `${LOCAL}/FACTURACION_HOST`;

async function limpiar() {
  await set(ref(PC_A, LOCAL), null);
}

await check('nodo ausente: una PC gana con runTransaction real', async () => {
  await limpiar();
  const ahora = Date.now();
  const tx = await runTransaction(
    ref(PC_A, hostPath),
    reductorDeHost({ machineId: 'pcA', hostname: 'PC-A', ahora })
  );
  assert.ok(tx.committed, 'la transacción debería haber comprometido');
  assert.strictEqual(tx.snapshot.val().machineId, 'pcA');

  const leido = await get(ref(PC_B, hostPath));
  assert.strictEqual(leido.val().machineId, 'pcA', 'PC B lee el mismo host que escribió PC A — el nodo es real, no local');
});

await check('dueño vigente ajeno: la segunda PC aborta contra el emulador real, no se pisa nada', async () => {
  await limpiar();
  const ahora = Date.now();
  await runTransaction(ref(PC_A, hostPath), reductorDeHost({ machineId: 'pcA', hostname: 'PC-A', ahora }));

  const tx = await runTransaction(
    ref(PC_B, hostPath),
    reductorDeHost({ machineId: 'pcB', hostname: 'PC-B', ahora: ahora + 1000 })
  );
  assert.strictEqual(tx.committed, false, 'PC B no debería poder comprometer mientras el lease de A es vigente');

  const leido = await get(ref(PC_A, hostPath));
  assert.strictEqual(leido.val().machineId, 'pcA', 'el nodo real sigue diciendo pcA — nadie lo pisó');
});

await check('dos PCs simultáneas sobre nodo libre: exactamente una gana (carrera real, no simulada)', async () => {
  await limpiar();
  const ahora = Date.now();
  const [txA, txB] = await Promise.all([
    runTransaction(ref(PC_A, hostPath), reductorDeHost({ machineId: 'pcA', hostname: 'PC-A', ahora })),
    runTransaction(ref(PC_B, hostPath), reductorDeHost({ machineId: 'pcB', hostname: 'PC-B', ahora })),
  ]);
  const comprometidas = [txA.committed, txB.committed].filter(Boolean).length;
  assert.strictEqual(comprometidas, 1, `debería comprometer exactamente una, comprometieron ${comprometidas}`);
});

await check('lease vencido: otra PC lo reclama contra el emulador real', async () => {
  await limpiar();
  const t0 = Date.now();
  await runTransaction(ref(PC_A, hostPath), reductorDeHost({ machineId: 'pcA', hostname: 'PC-A', ahora: t0 }));

  const tras_vencer = t0 + LEASE_MS + 1;
  const tx = await runTransaction(
    ref(PC_B, hostPath),
    reductorDeHost({ machineId: 'pcB', hostname: 'PC-B', ahora: tras_vencer })
  );
  assert.ok(tx.committed, 'PC B debería poder tomar el lease vencido');
  assert.strictEqual(tx.snapshot.val().machineId, 'pcB');
});

await check('liberación real: sólo suelta si machineId coincide, y el nodo real queda ausente', async () => {
  await limpiar();
  const ahora = Date.now();
  await runTransaction(ref(PC_A, hostPath), reductorDeHost({ machineId: 'pcA', hostname: 'PC-A', ahora }));
  // Igual que `armarListenerDeTransferencia` en producción: calentar el cache
  // ANTES de liberar. Sin esto, ver el test de REGRESIÓN de abajo.
  await esperarCacheCaliente(PC_A, hostPath);

  const txAjena = await runTransaction(ref(PC_B, hostPath), reductorDeLiberacion({ machineId: 'pcB' }));
  assert.strictEqual(txAjena.committed, false, 'PC B no puede liberar el host de PC A');

  const txPropia = await runTransaction(ref(PC_A, hostPath), reductorDeLiberacion({ machineId: 'pcA' }));
  assert.ok(txPropia.committed, 'PC A sí puede liberar su propio host');

  const leido = await get(ref(PC_A, hostPath));
  assert.strictEqual(leido.val(), null, 'el nodo real queda ausente tras la liberación');
});

await check(
  'REGRESIÓN (documenta un comportamiento real del SDK cliente): sin el cache tibio, runTransaction puede abortar una liberación legítima en su PRIMER pase, sin llegar a consultar el servidor',
  async () => {
    await limpiar();
    const ahora = Date.now();
    // Conexión nueva y aislada, sin NINGÚN listener previo sobre este path —
    // cache local frío a propósito, replicando lo que pasaba antes de que
    // `armarListenerDeTransferencia` calentara el cache al ganar el host.
    const appFrio = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'hostFiscalCacheFrio');
    const dbFrio = getDatabase(appFrio);
    connectDatabaseEmulator(dbFrio, host, Number(port));

    await runTransaction(ref(dbFrio, hostPath), reductorDeHost({ machineId: 'pcFrio', hostname: 'PC-Fria', ahora }));
    // Liberar en la MISMA conexión que acaba de ganar, pero sin ningún
    // listener activo de por medio: el cache local para este path sigue frío.
    const tx = await runTransaction(ref(dbFrio, hostPath), reductorDeLiberacion({ machineId: 'pcFrio' }));
    assert.strictEqual(
      tx.committed, false,
      'si esto empieza a dar true, el SDK cambió de comportamiento y el calentado de cache en armarListenerDeTransferencia ya no hace falta (pero tampoco molesta)'
    );

    // El nodo real, visto desde OTRA conexión, nunca se tocó: la liberación
    // abortó antes de escribir nada, no perdió el host de nadie.
    const leido = await get(ref(PC_A, hostPath));
    assert.strictEqual(leido.val()?.machineId, 'pcFrio', 'el host real sigue en pie — el abort del primer pase no corrompió nada, sólo no liberó');
  }
);

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
process.exit(process.exitCode || 0);
