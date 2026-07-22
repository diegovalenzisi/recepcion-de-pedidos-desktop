// Fase 2 — INTEGRACIÓN CONTRA EL EMULADOR REAL de Realtime Database.
//
// El backend en memoria sirve para la lógica, pero no prueba `increment()`,
// `update()` multi-ruta, `runTransaction` real, ni la concurrencia entre DOS
// CLIENTES distintos. Esto sí.
//
// Se conecta con dos apps Firebase independientes (clienteA y clienteB) al
// emulador, sobre datos aislados. No toca producción.
//
// Correr con:
//   firebase emulators:exec --only database --config <ruta>/firebase.json ^
//     "node src/lib/api/__tests__/stockEmulator.integration.mjs"
//
// Requiere FIREBASE_DATABASE_EMULATOR_HOST (lo define emulators:exec).
import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction, increment, onValue, connectDatabaseEmulator } from 'firebase/database';
import {
  aplicarEnRecurso, revertirEnRecurso, calcularImpactHash,
  construirImpactoCanonico, rutaRecurso, refMostrador, refReversionMostrador,
} from '../stockAtomico.js';

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

function nuevoCliente(nombre) {
  const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, nombre);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, Number(port));
  return { app, db };
}

const A = nuevoCliente('clienteA');
const B = nuevoCliente('clienteB');

const LOCAL = 'LOCAL_A';
const IMPACTO = {
  'A-0007': { quantity: 1, type: 'ARTICULO' },
  'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' },
  'M-3': { quantity: 0.5, type: 'MATERIA_PRIMA' },
};
const HASH = calcularImpactHash(IMPACTO);
const CANONICO = construirImpactoCanonico(IMPACTO);

async function sembrar(sufijo) {
  const raiz = `${LOCAL}${sufijo}`;
  await set(ref(A.db, raiz), {
    ARTICULOS: {
      'A-0007': { nombre: '1 KILO', stock: { stockType: 'propio', propio: 10 } },
      'A-ROCKLETS': { nombre: 'Rocklets', stock: { stockType: 'propio', propio: 20 } },
    },
    MATERIA_PRIMA: { 'M-3': { nombre: 'Azucar', stock: 100 } },
  });
  return raiz;
}
/**
 * Deja el nodo en el árbol de sincronización del cliente para que el reductor
 * de runTransaction reciba el valor REAL en su primera llamada. `get()` no
 * alcanza: no puebla esa caché.
 */
const precargar = (refNodo) => new Promise((resolve) => {
  const off = onValue(refNodo, () => { off(); resolve(); }, { onlyOnce: false });
});

const stock = async (db, raiz, id) => (await get(ref(db, `${raiz}/ARTICULOS/${id}/stock/propio`))).val();
const mpStock = async (db, raiz) => (await get(ref(db, `${raiz}/MATERIA_PRIMA/M-3/stock`))).val();

/** Aplica el impacto con el cliente indicado, recurso por recurso. */
async function aplicar(db, raiz, referenceId, { hasta = Infinity } = {}) {
  const out = [];
  let i = 0;
  for (const d of CANONICO) {
    if (i >= hasta) break;
    i += 1;
    let resultado = null;
    await runTransaction(ref(db, rutaRecurso(raiz, d.id, d.tipo)), (nodo) => {
      const r = aplicarEnRecurso(nodo, { referenceId, cantidad: d.cantidad, impactHash: HASH, tipo: d.tipo });
      resultado = r.resultado;
      return r.nodo;
    });
    out.push({ id: d.id, resultado });
  }
  return out;
}

console.log(`Emulador RTDB en ${HOST}\n`);

console.log('increment() y update() multi-ruta reales:');
await check('update multipath exitoso con increment', async () => {
  const raiz = await sembrar('_mp1');
  await update(ref(A.db), {
    [`${raiz}/ARTICULOS/A-0007/stock/propio`]: increment(-1),
    [`${raiz}/ARTICULOS/A-ROCKLETS/stock/propio`]: increment(-2),
    [`${raiz}/MATERIA_PRIMA/M-3/stock`]: increment(-0.5),
  });
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9);
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
  assert.strictEqual(await mpStock(A.db, raiz), 99.5);
});
await check('error ANTES del update: no cambia nada', async () => {
  const raiz = await sembrar('_mp2');
  const payload = {
    [`${raiz}/ARTICULOS/A-0007/stock/propio`]: increment(-1),
    [`${raiz}/ARTICULOS/A-ROCKLETS/stock/propio`]: increment(-2),
  };
  try {
    throw new Error('caída antes de escribir');
    // eslint-disable-next-line no-unreachable
    await update(ref(A.db), payload);
  } catch { /* esperado */ }
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 10);
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 20);
});
await check('update multipath inválido: TODO o NADA (ninguna ruta se aplica)', async () => {
  const raiz = await sembrar('_mp3');
  try {
    await update(ref(A.db), {
      [`${raiz}/ARTICULOS/A-0007/stock/propio`]: increment(-1),
      [`${raiz}/ARTICULOS/A-ROCKLETS/stock/propio`]: increment(-2),
      // Ruta padre e hija a la vez: el servidor rechaza la operación entera.
      [`${raiz}/ARTICULOS/A-0007/stock`]: { propio: 0 },
    });
    assert.fail('el servidor debería haber rechazado el update');
  } catch { /* esperado */ }
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 10, 'nada se aplicó');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 20);
});

console.log('\nIdempotencia por recurso con transacciones reales:');
await check('primera aplicación descuenta', async () => {
  const raiz = await sembrar('_id1');
  await aplicar(A.db, raiz, refMostrador(1));
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});
await check('segunda aplicación del mismo referenceId NO descuenta', async () => {
  const raiz = await sembrar('_id2');
  await aplicar(A.db, raiz, refMostrador(2));
  const r = await aplicar(A.db, raiz, refMostrador(2));
  assert.ok(r.every((x) => x.resultado === 'ya-aplicado'));
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});
await check('mismo referenceId con impactHash DISTINTO se rechaza', async () => {
  const raiz = await sembrar('_id3');
  await aplicar(A.db, raiz, refMostrador(3));
  let resultado = null;
  await runTransaction(ref(A.db, rutaRecurso(raiz, 'A-ROCKLETS', 'ARTICULO')), (nodo) => {
    const r = aplicarEnRecurso(nodo, { referenceId: refMostrador(3), cantidad: 5, impactHash: 'OTRO_HASH', tipo: 'ARTICULO' });
    resultado = r.resultado;
    return r.nodo;
  });
  assert.strictEqual(resultado, 'conflicto-de-hash');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});

console.log('\nDOS CLIENTES sobre el mismo referenceId:');
await check('A y B en paralelo → un solo descuento', async () => {
  const raiz = await sembrar('_cc1');
  await Promise.all([
    aplicar(A.db, raiz, refMostrador(10)),
    aplicar(B.db, raiz, refMostrador(10)),
  ]);
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9, 'nunca 8');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18, 'nunca 16');
  assert.strictEqual(await mpStock(A.db, raiz), 99.5, 'nunca 99');
});
await check('A pausado → lease vencido → B recupera → A vuelve: UN solo descuento', async () => {
  const raiz = await sembrar('_cc2');
  const referenceId = refMostrador(11);
  const rutaMarca = `${raiz}/PROCESSED_STOCK_IDS/${referenceId}`;

  // 1. A adquiere la reserva.
  await set(ref(A.db, rutaMarca), { status: 'processing', ownerId: 'A', timestamp: Date.now() - 10 * 60 * 1000 });
  // 2. A queda suspendido antes de aplicar.
  // 3-4. B considera vencido el lease y lo recupera.
  await set(ref(B.db, rutaMarca), { status: 'processing', ownerId: 'B', timestamp: Date.now() });
  // 5-6. B confirma y DESPUÉS A despierta y también confirma, con su lease vencido.
  const rb = await aplicar(B.db, raiz, referenceId);
  const ra = await aplicar(A.db, raiz, referenceId);

  // 7. El stock baja una sola vez.
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9, 'nunca 8');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18, 'nunca 16');
  assert.ok(rb.every((x) => x.resultado === 'aplicado'), 'B aplicó');
  assert.ok(ra.every((x) => x.resultado === 'ya-aplicado'), 'A, dueño vencido, no pudo aplicar');
});
await check('el orden inverso tampoco duplica (A confirma primero)', async () => {
  const raiz = await sembrar('_cc3');
  const referenceId = refMostrador(12);
  const ra = await aplicar(A.db, raiz, referenceId);
  const rb = await aplicar(B.db, raiz, referenceId);
  assert.ok(ra.every((x) => x.resultado === 'aplicado'));
  assert.ok(rb.every((x) => x.resultado === 'ya-aplicado'));
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});

console.log('\nOperación parcial y reintento:');
await check('corte a mitad y reintento: cada recurso se descuenta una sola vez', async () => {
  const raiz = await sembrar('_pp1');
  await aplicar(A.db, raiz, refMostrador(20), { hasta: 1 });
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9);
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 20, 'todavía no');
  const r = await aplicar(B.db, raiz, refMostrador(20));   // reintenta OTRO cliente
  assert.strictEqual(r[0].resultado, 'ya-aplicado');
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9, 'nunca 8');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
  assert.strictEqual(await mpStock(A.db, raiz), 99.5);
});

console.log('\nAislamiento entre locales:');
await check('dos locales con el mismo articleId no se mezclan', async () => {
  const raizA = await sembrar('_locA');
  const raizB = await sembrar('_locB');
  await aplicar(A.db, raizA, refMostrador(30));
  assert.strictEqual(await stock(A.db, raizA, 'A-ROCKLETS'), 18);
  assert.strictEqual(await stock(A.db, raizB, 'A-ROCKLETS'), 20);
});

console.log('\nReversión:');
await check('repone lo aplicado y una segunda cancelación no repone dos veces', async () => {
  const raiz = await sembrar('_rv1');
  await aplicar(A.db, raiz, refMostrador(40));
  const revertir = async (db) => {
    const out = [];
    for (const d of CANONICO) {
      let resultado = null;
      const refRecurso = ref(db, rutaRecurso(raiz, d.id, d.tipo));
      // Precarga OBLIGATORIA con un listener: `get()` NO puebla el árbol de
      // sincronización que usa runTransaction, así que el reductor recibiría
      // null en su primera llamada, abortaría y la reversión no repondría nada.
      await precargar(refRecurso);
      await runTransaction(refRecurso, (nodo) => {
        const r = revertirEnRecurso(nodo, {
          referenceIdOriginal: refMostrador(40),
          referenceIdReversion: refReversionMostrador(40),
          tipo: d.tipo,
        });
        resultado = r.resultado;
        return r.nodo;
      });
      out.push(resultado);
    }
    return out;
  };
  await revertir(A.db);
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 20);
  const r2 = await revertir(B.db);
  assert.ok(r2.every((x) => x === 'ya-revertido'));
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 20, 'nunca 22');
});

console.log(`\n${passed} pruebas de integración OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
await Promise.all([deleteApp(A.app), deleteApp(B.app)]);
process.exit(process.exitCode || 0);
