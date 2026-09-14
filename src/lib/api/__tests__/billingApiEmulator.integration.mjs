// AVISO EN VIVO DE /VENTAS — INTEGRACIÓN CONTRA EL EMULADOR REAL.
//
// `suscribirCambiosDeVentas()` (billingApi.js) depende de `getCurrentDatabasePath()`
// (firebase/core.js), que a su vez depende de `localStorage`/`import.meta.env` —
// no disponibles en un script de Node plano. Por eso, como el resto de las
// pruebas de integración de este proyecto, ESTA prueba reproduce la MISMA
// consulta y el MISMO manejo de eventos que la función real (rango por letra
// FCA..FCC + onChildAdded/Changed/Removed + debounce), contra el emulador
// real, en vez de importar la función. La lógica en sí es tan corta que
// reproducirla acá es lo que se está probando: que la consulta y el debounce
// se comportan como se espera contra Firebase de verdad.
//
// Correr con:
//   npm run test:billing-emulator
import assert from 'node:assert';
import { initializeApp } from 'firebase/app';
import {
  getDatabase, ref, set, update, remove, query, orderByKey, startAt, endAt,
  onChildAdded, onChildChanged, onChildRemoved, connectDatabaseEmulator,
} from 'firebase/database';

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
const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'billingLive');
const db = getDatabase(app);
connectDatabaseEmulator(db, host, Number(port));

const LOCAL = '77777777';
const DEBOUNCE_MS = 300;

/** Copia EXACTA de la consulta de suscribirCambiosDeVentas(). */
const consultaVentasEnVivo = (localId) => query(
  ref(db, `${localId}/VENTAS`),
  orderByKey(),
  startAt('FCA'),
  endAt(`FCC${String.fromCharCode(0xf8ff)}`)
);

/** Copia EXACTA del wiring de suscribirCambiosDeVentas(): 3 listeners + debounce. */
function suscribir(localId, callback) {
  const consulta = consultaVentasEnVivo(localId);
  let temporizador = null;
  const avisar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => { temporizador = null; callback(); }, DEBOUNCE_MS);
  };
  const cancelarAlta = onChildAdded(consulta, avisar, (e) => console.error(e));
  const cancelarCambio = onChildChanged(consulta, avisar, (e) => console.error(e));
  const cancelarBaja = onChildRemoved(consulta, avisar, (e) => console.error(e));
  return () => {
    if (temporizador) clearTimeout(temporizador);
    cancelarAlta();
    cancelarCambio();
    cancelarBaja();
  };
}

/** Cuenta invocaciones del callback durante `ms`, después de correr `accion`. */
async function contarAvisos(localId, accion, ms = DEBOUNCE_MS + 400) {
  let avisos = 0;
  const cancelar = suscribir(localId, () => { avisos += 1; });
  // Deja asentar el "alta inicial" del propio listener antes de medir, para
  // que la ráfaga de arranque no se cuente como parte de la acción.
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200));
  avisos = 0;
  await accion();
  await new Promise((r) => setTimeout(r, ms));
  cancelar();
  return avisos;
}

await set(ref(db, LOCAL), null);

console.log('\n1. Alta de una factura real dispara el aviso:');
await check('FCB/FCC nueva -> UN aviso', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    await set(ref(db, `${LOCAL}/VENTAS/FCB0001-00000001`), { CAE: '111', total: 1000 });
  });
  assert.strictEqual(n, 1);
});

console.log('\n2. Ráfaga de varias altas casi simultáneas: UN solo aviso (debounce):');
await check('5 facturas seguidas -> UN aviso, no cinco', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    for (let i = 2; i <= 6; i += 1) {
      await set(ref(db, `${LOCAL}/VENTAS/FCB0001-${String(i).padStart(8, '0')}`), { CAE: `x${i}`, total: 1000 });
    }
  });
  assert.strictEqual(n, 1, `disparó ${n} avisos en vez de agruparlos en uno`);
});

console.log('\n3. Claves fuera de rango (remitos u otro formato) NO disparan nada:');
await check('escribir un remito en /Remitos no toca el listener de VENTAS', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    await set(ref(db, `${LOCAL}/Remitos/FCX0001-00000099`), { total: 500 });
  });
  assert.strictEqual(n, 0);
});
await check('una clave FCX legado dentro de VENTAS no dispara nada (no es factura)', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    await set(ref(db, `${LOCAL}/VENTAS/FCX0001-00000001`), { CLIENTE: 'Viejo', IMPORTE: 500 });
  });
  assert.strictEqual(n, 0, 'la clave heredada FCX no debería estar en el rango FCA..FCC');
});

console.log('\n4. Cambiar una factura existente (CAE que llega después, reconciliación) dispara el aviso:');
await check('onChildChanged: actualizar un campo de una factura ya escrita', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    await update(ref(db, `${LOCAL}/VENTAS/FCB0001-00000001`), { PDF_BASE64: 'JVBERi0=' });
  });
  assert.strictEqual(n, 1);
});

console.log('\n5. Eliminar una factura dispara el aviso:');
await check('onChildRemoved', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    await remove(ref(db, `${LOCAL}/VENTAS/FCB0001-00000006`));
  });
  assert.strictEqual(n, 1);
});

console.log('\n6. Varias cuentas fiscales con el MISMO punto de venta: cualquiera dispara el aviso:');
await check('dos CUIT distintos, mismo prefijo de clave (caso real de IL CAPO)', async () => {
  const n = await contarAvisos(LOCAL, async () => {
    await set(ref(db, `${LOCAL}/VENTAS/FCC0001-00000900`), { CAE: 'cuentaA', total: 1000, CUIT: '20111111111' });
    await set(ref(db, `${LOCAL}/VENTAS/FCC0001-00000901`), { CAE: 'cuentaB', total: 2000, CUIT: '27222222222' });
  });
  assert.strictEqual(n, 1, 'las dos altas deberían agruparse en un solo aviso, pero ambas tienen que dispararlo');
});

console.log('\n7. Local con MUCHO volumen previo (> 100 ventas) + basura FCX: una factura nueva SIGUE avisando:');
await check('caso Temperley: > 100 ventas históricas y 60 claves FCX, la nueva factura avisa igual', async () => {
  const VOLUMEN = '88888888';
  await set(ref(db, VOLUMEN), null);
  const historicas = {};
  for (let i = 1; i <= 150; i += 1) historicas[`FCC0002-${String(i).padStart(8, '0')}`] = { CAE: `h${i}`, total: 500 };
  for (let i = 1; i <= 60; i += 1) historicas[`FCX0001-${String(i).padStart(8, '0')}`] = { CLIENTE: 'Viejo' };
  await update(ref(db, `${VOLUMEN}/VENTAS`), historicas);

  const n = await contarAvisos(VOLUMEN, async () => {
    await set(ref(db, `${VOLUMEN}/VENTAS/FCC0002-00000200`), { CAE: 'nueva', total: 999 });
  });
  assert.strictEqual(n, 1, 'con la vieja ventana de últimas-80 esto podía no avisar nunca');
});

console.log('\n8. Cancelar la suscripción: ningún evento posterior vuelve a avisar:');
await check('cancelar() detiene los tres listeners', async () => {
  let avisos = 0;
  const cancelar = suscribir(LOCAL, () => { avisos += 1; });
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 200));
  cancelar();
  avisos = 0;
  await set(ref(db, `${LOCAL}/VENTAS/FCB0001-00000010`), { CAE: 'z', total: 1000 });
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 300));
  assert.strictEqual(avisos, 0, 'siguió avisando después de cancelar la suscripción');
});

console.log('\n9. Aislamiento entre locales: escribir en OTRO local no dispara el listener de éste:');
await check('el listener de LOCAL no reacciona a cambios de otro local', async () => {
  const OTRO = '66666666';
  await set(ref(db, OTRO), null);
  const n = await contarAvisos(LOCAL, async () => {
    await set(ref(db, `${OTRO}/VENTAS/FCB0001-00000001`), { CAE: 'ajeno', total: 1000 });
  });
  assert.strictEqual(n, 0);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
process.exit(process.exitCode || 0);
