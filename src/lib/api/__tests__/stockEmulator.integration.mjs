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
  resolverResultadoRecurso,
} from '../stockAtomico.js';
import { construirPlanDeStock } from '../stockPlan.js';
import { materiaPrimaDisponible } from '../deliveryPorStock.js';

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
 * Deja el nodo en el árbol de sincronización del cliente.
 *
 * OJO con el patrón `const off = onValue(ref, () => { off(); ... })`: si otro
 * listener ya cubre la ruta, RTDB invoca el callback SINCRÓNICAMENTE, dentro de
 * la llamada a onValue(), cuando `off` todavía está en la zona muerta temporal
 * del const — y lanza "Cannot access 'off' before initialization". Es
 * exactamente el bug que dejó a Achaval vendiendo sin descontar. Se desuscribe
 * fuera del callback, que además es más simple.
 */
const precargar = (refNodo) => new Promise((resolve) => {
  let listo = false;
  const off = onValue(refNodo, () => { listo = true; resolve(); });
  // Si ya disparó (sincrónico), off() acá es seguro; si no, se corta igual.
  queueMicrotask(() => { if (listo) off(); else resolve(); });
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
    let invocacion = 0;
    await runTransaction(ref(db, rutaRecurso(raiz, d.id, d.tipo)), (nodo) => {
      invocacion += 1;
      const r = aplicarEnRecurso(nodo, { referenceId, cantidad: d.cantidad, impactHash: HASH, tipo: d.tipo, invocacion });
      resultado = r.resultado;
      return r.nodo;
    });
    out.push({ id: d.id, resultado });
  }
  return out;
}

/**
 * Patrón obligatorio del punto 4: transacción + resolución del `retryable`
 * mediante una lectura posterior, para distinguir caché fría de recurso
 * inexistente sin crear nada.
 */
async function aplicarRecurso(db, ruta, params) {
  let resultado = null;
  let invocacion = 0;
  await runTransaction(ref(db, ruta), (nodo) => {
    invocacion += 1;
    const r = aplicarEnRecurso(nodo, { ...params, invocacion });
    resultado = r.resultado;
    return r.nodo;
  });
  if (resultado === 'retryable') {
    resultado = resolverResultadoRecurso(resultado, (await get(ref(db, ruta))).val());
  }
  return resultado;
}

async function revertirRecurso(db, ruta, params) {
  await precargar(ref(db, ruta));
  let resultado = null;
  let invocacion = 0;
  await runTransaction(ref(db, ruta), (nodo) => {
    invocacion += 1;
    const r = revertirEnRecurso(nodo, { ...params, invocacion });
    resultado = r.resultado;
    return r.nodo;
  });
  if (resultado === 'retryable') {
    resultado = resolverResultadoRecurso(resultado, (await get(ref(db, ruta))).val());
  }
  return resultado;
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
  assert.ok(r.every((x) => x.resultado === 'already-applied'));
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});
await check('mismo referenceId con impactHash DISTINTO se rechaza', async () => {
  const raiz = await sembrar('_id3');
  await aplicar(A.db, raiz, refMostrador(3));
  let resultado = null;
  let invocacion = 0;
  await runTransaction(ref(A.db, rutaRecurso(raiz, 'A-ROCKLETS', 'ARTICULO')), (nodo) => {
    invocacion += 1;
    const r = aplicarEnRecurso(nodo, { referenceId: refMostrador(3), cantidad: 5, impactHash: 'OTRO_HASH', tipo: 'ARTICULO', invocacion });
    resultado = r.resultado;
    return r.nodo;
  });
  assert.strictEqual(resultado, 'hash-conflict');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});

console.log('\nPunto 4 — null inicial vs recurso realmente inexistente:');
await check('nodo existente con caché fría: se aplica (no se toma por inexistente)', async () => {
  const raiz = await sembrar('_n1');
  // Cliente B nunca leyó este nodo: su primera invocación recibe null.
  const r = await aplicar(B.db, raiz, refMostrador(70));
  assert.ok(r.every((x) => x.resultado === 'applied'), JSON.stringify(r));
  assert.strictEqual(await stock(B.db, raiz, 'A-ROCKLETS'), 18);
});
await check('artículo realmente inexistente: missing-resource y NO se crea', async () => {
  const raiz = await sembrar('_n2');
  const rutaFantasma = rutaRecurso(raiz, 'A-NO-EXISTE', 'ARTICULO');
  const resultado = await aplicarRecurso(A.db, rutaFantasma, { referenceId: refMostrador(71), cantidad: 1, impactHash: HASH, tipo: 'ARTICULO' });
  assert.strictEqual(resultado, 'missing-resource');
  assert.strictEqual((await get(ref(A.db, rutaFantasma))).val(), null, 'no se creó ninguna estructura');
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/A-NO-EXISTE`))).val(), null);
});
await check('materia prima inexistente: tampoco se crea', async () => {
  const raiz = await sembrar('_n3');
  const ruta = rutaRecurso(raiz, 'M-NO-EXISTE', 'MATERIA_PRIMA');
  const resultado = await aplicarRecurso(A.db, ruta, { referenceId: refMostrador(72), cantidad: 1, impactHash: HASH, tipo: 'MATERIA_PRIMA' });
  assert.strictEqual(resultado, 'missing-resource');
  assert.strictEqual((await get(ref(A.db, ruta))).val(), null);
});
await check('recurso eliminado ENTRE el preflight y la transacción', async () => {
  const raiz = await sembrar('_n4');
  const ruta = rutaRecurso(raiz, 'A-ROCKLETS', 'ARTICULO');
  // Preflight: existe.
  assert.ok((await get(ref(A.db, ruta))).exists());
  // Alguien lo borra antes de que apliquemos.
  await set(ref(B.db, `${raiz}/ARTICULOS/A-ROCKLETS`), null);
  const resultado = await aplicarRecurso(A.db, ruta, { referenceId: refMostrador(73), cantidad: 2, impactHash: HASH, tipo: 'ARTICULO' });
  assert.strictEqual(resultado, 'missing-resource');
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/A-ROCKLETS`))).val(), null, 'no se resucita');
});
await check('recurso eliminado entre DOS recursos de la misma operación → partial', async () => {
  const raiz = await sembrar('_n5');
  const resultados = [];
  let idx = 0;
  for (const d of CANONICO) {
    if (idx === 1) await set(ref(B.db, `${raiz}/ARTICULOS/A-ROCKLETS`), null);  // se borra a mitad
    idx += 1;
    const resultado = await aplicarRecurso(A.db, rutaRecurso(raiz, d.id, d.tipo), { referenceId: refMostrador(74), cantidad: d.cantidad, impactHash: HASH, tipo: d.tipo });
    resultados.push({ id: d.id, resultado });
  }
  assert.strictEqual(resultados.find((r) => r.id === 'A-0007').resultado, 'applied');
  assert.strictEqual(resultados.find((r) => r.id === 'A-ROCKLETS').resultado, 'missing-resource');
  assert.strictEqual(resultados.find((r) => r.id === 'M-3').resultado, 'applied');
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9, 'lo que sí existía se aplicó');
});
await check('stock existente con valor null: se trata como ausente, no como corrupto', async () => {
  const raiz = await sembrar('_n6');
  await set(ref(A.db, `${raiz}/ARTICULOS/A-ROCKLETS/stock`), { stockType: 'propio', propio: null });
  let resultado = null; let invocacion = 0;
  await runTransaction(ref(A.db, rutaRecurso(raiz, 'A-ROCKLETS', 'ARTICULO')), (nodo) => {
    invocacion += 1;
    const r = aplicarEnRecurso(nodo, { referenceId: refMostrador(75), cantidad: 2, impactHash: HASH, tipo: 'ARTICULO', invocacion });
    resultado = r.resultado;
    return r.nodo;
  });
  assert.strictEqual(resultado, 'applied');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), -2, 'política vigente: permite negativo');
});
await check('stock corrupto: corrupt-stock y NO se escribe', async () => {
  const raiz = await sembrar('_n7');
  await set(ref(A.db, `${raiz}/ARTICULOS/A-ROCKLETS/stock`), { stockType: 'propio', propio: 'basura' });
  let resultado = null; let invocacion = 0;
  await runTransaction(ref(A.db, rutaRecurso(raiz, 'A-ROCKLETS', 'ARTICULO')), (nodo) => {
    invocacion += 1;
    const r = aplicarEnRecurso(nodo, { referenceId: refMostrador(76), cantidad: 2, impactHash: HASH, tipo: 'ARTICULO', invocacion });
    resultado = r.resultado;
    return r.nodo;
  });
  assert.strictEqual(resultado, 'corrupt-stock');
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 'basura', 'el dato ilegible queda intacto');
});
await check('reversión sobre recurso eliminado: missing-resource, no lo recrea', async () => {
  const raiz = await sembrar('_n8');
  await aplicar(A.db, raiz, refMostrador(77));
  await set(ref(B.db, `${raiz}/ARTICULOS/A-ROCKLETS`), null);
  const resultado = await revertirRecurso(A.db, rutaRecurso(raiz, 'A-ROCKLETS', 'ARTICULO'), {
    referenceIdOriginal: refMostrador(77), referenceIdReversion: refReversionMostrador(77), tipo: 'ARTICULO',
  });
  assert.strictEqual(resultado, 'missing-resource');
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/A-ROCKLETS`))).val(), null);
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
  assert.ok(rb.every((x) => x.resultado === 'applied'), 'B aplicó');
  assert.ok(ra.every((x) => x.resultado === 'already-applied'), 'A, dueño vencido, no pudo aplicar');
});
await check('el orden inverso tampoco duplica (A confirma primero)', async () => {
  const raiz = await sembrar('_cc3');
  const referenceId = refMostrador(12);
  const ra = await aplicar(A.db, raiz, referenceId);
  const rb = await aplicar(B.db, raiz, referenceId);
  assert.ok(ra.every((x) => x.resultado === 'applied'));
  assert.ok(rb.every((x) => x.resultado === 'already-applied'));
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 18);
});

console.log('\nOperación parcial y reintento:');
await check('corte a mitad y reintento: cada recurso se descuenta una sola vez', async () => {
  const raiz = await sembrar('_pp1');
  await aplicar(A.db, raiz, refMostrador(20), { hasta: 1 });
  assert.strictEqual(await stock(A.db, raiz, 'A-0007'), 9);
  assert.strictEqual(await stock(A.db, raiz, 'A-ROCKLETS'), 20, 'todavía no');
  const r = await aplicar(B.db, raiz, refMostrador(20));   // reintenta OTRO cliente
  assert.strictEqual(r[0].resultado, 'already-applied');
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
      let invocacion = 0;
      await runTransaction(refRecurso, (nodo) => {
        invocacion += 1;
        const r = revertirEnRecurso(nodo, {
          invocacion,
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

// ---------------------------------------------------------------------------
// REGRESIÓN REAL: producto ELABORADO con controlStock=false.
//
// Configuración exacta encontrada en producción (local 40508022): 32 de los 42
// artículos con receta tenían `controlStock: false` —lo normal en un elaborado,
// que no lleva cuenta propia porque su stock vive en la materia prima— y el
// plan salía vacío. Ni el artículo ni su materia prima se descontaban.
//
// Se prueba la cadena COMPLETA y real: plan → aplicación atómica → reversión.
// ---------------------------------------------------------------------------
console.log('\nProducto elaborado con controlStock=false (regresión real):');

const ELABORADO_ARTICULOS = {
  'A-KILO': {
    nombre: '1 KILO DE HELADO', controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-3': 1, 'M-9': 0.25 } },
  },
  'A-SIN-CONTROL-PROPIO': {
    nombre: 'Ilimitado con cuenta propia', controlStock: false,
    stock: { stockType: 'propio', propio: 7 },
  },
};
const ELABORADO_MP = {
  'M-3': { nombre: 'Azucar', stock: 100 },
  'M-9': { nombre: 'Cacao', stock: 50 },
};

async function sembrarElaborado(sufijo) {
  const raiz = `${LOCAL}${sufijo}`;
  await set(ref(A.db, raiz), { ARTICULOS: ELABORADO_ARTICULOS, MATERIA_PRIMA: ELABORADO_MP });
  return raiz;
}

/** Aplica un plan completo contra el emulador, como lo hace processStockUpdate. */
async function aplicarPlan(db, raiz, referenceId, impactMap) {
  const hash = calcularImpactHash(impactMap, { localId: raiz, operation: 'decrement' });
  const out = [];
  for (const d of construirImpactoCanonico(impactMap)) {
    const ruta = rutaRecurso(raiz, d.id, d.tipo);
    await precargar(ref(db, ruta));
    out.push({
      id: d.id,
      resultado: await aplicarRecurso(db, ruta, {
        referenceId, cantidad: d.cantidad, impactHash: hash, tipo: d.tipo,
      }),
    });
  }
  return { resultados: out, hash };
}

await check('2 unidades de un elaborado descuentan su receta ×2 (antes: nada)', async () => {
  const raiz = await sembrarElaborado('_elab1');
  const { impactMap } = construirPlanDeStock({
    items: [{ id: 'A-KILO', quantity: 2 }],
    articulos: ELABORADO_ARTICULOS, materiaPrima: ELABORADO_MP,
  });
  assert.deepStrictEqual(impactMap, {
    'M-3': { quantity: 2, type: 'MATERIA_PRIMA' },
    'M-9': { quantity: 0.5, type: 'MATERIA_PRIMA' },
  });

  const { resultados } = await aplicarPlan(A.db, raiz, refMostrador(900), impactMap);
  assert.ok(resultados.every((r) => r.resultado === 'applied'), JSON.stringify(resultados));
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-3/stock`))).val(), 98);
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-9/stock`))).val(), 49.5);
});

await check('el elaborado NO se descuenta a sí mismo: no tiene cuenta propia', async () => {
  const raiz = await sembrarElaborado('_elab2');
  const { impactMap } = construirPlanDeStock({
    items: [{ id: 'A-SIN-CONTROL-PROPIO', quantity: 3 }],
    articulos: ELABORADO_ARTICULOS, materiaPrima: ELABORADO_MP,
  });
  assert.deepStrictEqual(impactMap, {}, 'controlStock=false + propio sigue siendo ilimitado');
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/A-SIN-CONTROL-PROPIO/stock/propio`))).val(), 7);
});

await check('reintento del mismo pedido NO vuelve a descontar la receta', async () => {
  const raiz = await sembrarElaborado('_elab3');
  const { impactMap } = construirPlanDeStock({
    items: [{ id: 'A-KILO', quantity: 1 }],
    articulos: ELABORADO_ARTICULOS, materiaPrima: ELABORADO_MP,
  });
  await aplicarPlan(A.db, raiz, refMostrador(901), impactMap);
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-3/stock`))).val(), 99);

  // Segundo intento (doble clic / reintento / otro dispositivo).
  const segundo = await aplicarPlan(B.db, raiz, refMostrador(901), impactMap);
  assert.ok(segundo.resultados.every((r) => r.resultado === 'already-applied'), JSON.stringify(segundo.resultados));
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-3/stock`))).val(), 99, 'nunca 98');
});

await check('cancelar repone la receta: el descuento dejó appliedOps', async () => {
  const raiz = await sembrarElaborado('_elab4');
  const { impactMap } = construirPlanDeStock({
    items: [{ id: 'A-KILO', quantity: 2 }],
    articulos: ELABORADO_ARTICULOS, materiaPrima: ELABORADO_MP,
  });
  await aplicarPlan(A.db, raiz, refMostrador(902), impactMap);
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-3/stock`))).val(), 98);

  // Antes esto devolvía 'original-no-aplicada' SIEMPRE, porque el descuento
  // usaba una resta cruda y nunca registraba la operación en el recurso.
  for (const d of construirImpactoCanonico(impactMap)) {
    const r = await revertirRecurso(A.db, rutaRecurso(raiz, d.id, d.tipo), {
      referenceIdOriginal: refMostrador(902),
      referenceIdReversion: refReversionMostrador(902),
      tipo: d.tipo,
    });
    assert.strictEqual(r, 'revertido', `${d.id}: ${r}`);
  }
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-3/stock`))).val(), 100);
  assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-9/stock`))).val(), 50);
});

// ---------------------------------------------------------------------------
// CASO REAL: pedido 4046 del local 40508022 (2026-07-27).
//
// Catálogo EXACTO de producción. Los tres artículos son elaborados con
// `controlStock:false`, así que antes del arreglo el pedido no descontaba nada:
// ni los envases (que son materia prima real y se agotan) ni el helado.
// ---------------------------------------------------------------------------
console.log('\nPedido 4046 (caso real de producción):');

const CAT_4046_ART = {
  '5A':  { nombre: '1 KILO DE HELADO',   controlStock: false, stock: { stockType: 'receta', receta: { '3M': 1, '6M': 1 } } },
  '67A': { nombre: '1/2 KILO DE HELADO', controlStock: false, stock: { stockType: 'receta', receta: { '2M': 1, '6M': 0.5 } } },
  '66A': { nombre: '1/4 KILO DE HELADO', controlStock: false, stock: { stockType: 'receta', receta: { '1M': 1, '6M': 0.25 } } },
};
const CAT_4046_MP = {
  '1M': { nombre: 'Termico de 1/4',  stock: 220 },
  '2M': { nombre: 'Termico de 1/2',  stock: 204 },
  '3M': { nombre: 'Termico de Kilo', stock: 258 },
  '6M': { nombre: 'Helado',          stock: 1000 },
};
const ITEMS_4046 = [
  { id: '5A',  quantity: 1 },
  { id: '67A', quantity: 1 },
  { id: '66A', quantity: 1 },
];

async function sembrar4046(sufijo) {
  const raiz = `${LOCAL}${sufijo}`;
  await set(ref(A.db, raiz), { ARTICULOS: CAT_4046_ART, MATERIA_PRIMA: CAT_4046_MP });
  return raiz;
}
const mp = async (db, raiz, id) => (await get(ref(db, `${raiz}/MATERIA_PRIMA/${id}/stock`))).val();

await check('descuenta envases -1 cada uno y helado -1,75, una sola vez', async () => {
  const raiz = await sembrar4046('_4046a');
  const { impactMap, avisos } = construirPlanDeStock({
    items: ITEMS_4046, articulos: CAT_4046_ART, materiaPrima: CAT_4046_MP,
  });
  assert.deepStrictEqual(impactMap, {
    '3M': { quantity: 1,    type: 'MATERIA_PRIMA' },
    '2M': { quantity: 1,    type: 'MATERIA_PRIMA' },
    '1M': { quantity: 1,    type: 'MATERIA_PRIMA' },
    '6M': { quantity: 1.75, type: 'MATERIA_PRIMA' },
  });
  // Los tres elaborados NO figuran: no tienen cuenta propia.
  for (const a of ['5A', '67A', '66A']) assert.ok(!(a in impactMap), `${a} no debe descontarse a sí mismo`);
  assert.ok(avisos.every((x) => x.tipo !== 'recurso-inexistente'), JSON.stringify(avisos));

  const { resultados } = await aplicarPlan(A.db, raiz, 'DELIVERY_4046', impactMap);
  assert.ok(resultados.every((r) => r.resultado === 'applied'), JSON.stringify(resultados));
  assert.strictEqual(await mp(A.db, raiz, '1M'), 219);
  assert.strictEqual(await mp(A.db, raiz, '2M'), 203);
  assert.strictEqual(await mp(A.db, raiz, '3M'), 257);
  assert.strictEqual(await mp(A.db, raiz, '6M'), 998.25);
});

await check('doble clic sobre el pedido 4046 no descuenta dos veces', async () => {
  const raiz = await sembrar4046('_4046b');
  const { impactMap } = construirPlanDeStock({ items: ITEMS_4046, articulos: CAT_4046_ART, materiaPrima: CAT_4046_MP });
  // Dos clientes distintos, en paralelo, con el MISMO referenceId.
  await Promise.all([
    aplicarPlan(A.db, raiz, 'DELIVERY_4046', impactMap),
    aplicarPlan(B.db, raiz, 'DELIVERY_4046', impactMap),
  ]);
  assert.strictEqual(await mp(A.db, raiz, '6M'), 998.25, 'nunca 996,5');
  assert.strictEqual(await mp(A.db, raiz, '3M'), 257);
});

await check('cancelar el delivery 4046 repone exactamente lo descontado', async () => {
  const raiz = await sembrar4046('_4046c');
  const { impactMap } = construirPlanDeStock({ items: ITEMS_4046, articulos: CAT_4046_ART, materiaPrima: CAT_4046_MP });
  await aplicarPlan(A.db, raiz, 'DELIVERY_4046', impactMap);

  const revertirTodo = async (db) => {
    const out = [];
    for (const d of construirImpactoCanonico(impactMap)) {
      out.push(await revertirRecurso(db, rutaRecurso(raiz, d.id, d.tipo), {
        referenceIdOriginal: 'DELIVERY_4046',
        referenceIdReversion: 'REVERSAL_DELIVERY_4046',
        tipo: d.tipo,
      }));
    }
    return out;
  };
  assert.ok((await revertirTodo(A.db)).every((r) => r === 'revertido'));
  assert.strictEqual(await mp(A.db, raiz, '1M'), 220);
  assert.strictEqual(await mp(A.db, raiz, '6M'), 1000);

  // Segunda cancelación: no repone de nuevo.
  assert.ok((await revertirTodo(B.db)).every((r) => r === 'ya-revertido'));
  assert.strictEqual(await mp(A.db, raiz, '6M'), 1000, 'nunca 1001,75');
});

await check('no repone una venta cuyo stock nunca se aplicó', async () => {
  const raiz = await sembrar4046('_4046d');
  const { impactMap } = construirPlanDeStock({ items: ITEMS_4046, articulos: CAT_4046_ART, materiaPrima: CAT_4046_MP });
  for (const d of construirImpactoCanonico(impactMap)) {
    const r = await revertirRecurso(A.db, rutaRecurso(raiz, d.id, d.tipo), {
      referenceIdOriginal: 'DELIVERY_9999',
      referenceIdReversion: 'REVERSAL_DELIVERY_9999',
      tipo: d.tipo,
    });
    assert.strictEqual(r, 'original-no-aplicada', d.id);
  }
  assert.strictEqual(await mp(A.db, raiz, '6M'), 1000, 'no inventa stock');
});

await check('facturar el remito después NO vuelve a mover stock', async () => {
  const raiz = await sembrar4046('_4046e');
  const { impactMap } = construirPlanDeStock({ items: ITEMS_4046, articulos: CAT_4046_ART, materiaPrima: CAT_4046_MP });
  await aplicarPlan(A.db, raiz, 'DELIVERY_4046', impactMap);
  const despuesDeVender = await mp(A.db, raiz, '6M');

  // Facturar a posteriori y reimprimir usan el MISMO referenceId de la venta:
  // el recurso ya lo tiene en appliedOps, así que no se descuenta otra vez.
  const otra = await aplicarPlan(B.db, raiz, 'DELIVERY_4046', impactMap);
  assert.ok(otra.resultados.every((r) => r.resultado === 'already-applied'));
  assert.strictEqual(await mp(A.db, raiz, '6M'), despuesDeVender);
});

// ---------------------------------------------------------------------------
// localId !== databasePath contra el emulador REAL.
// La raíz de datos es el databasePath; el localId es sólo identidad. Dos
// comercios no pueden mezclarse ni siquiera compartiendo IDs de artículo.
// ---------------------------------------------------------------------------
console.log('\nlocalId !== databasePath (aislamiento real):');
await check('venta, stock y materias primas caen bajo la raíz correcta', async () => {
  const raizA = 'RAIZ_ALTERNATIVA_A';
  const raizB = 'RAIZ_ALTERNATIVA_B';
  for (const raiz of [raizA, raizB]) {
    await set(ref(A.db, raiz), { ARTICULOS: CAT_4046_ART, MATERIA_PRIMA: CAT_4046_MP });
  }
  const { impactMap } = construirPlanDeStock({ items: ITEMS_4046, articulos: CAT_4046_ART, materiaPrima: CAT_4046_MP });

  // Misma venta, mismo referenceId, distinto comercio: cada uno lleva su cuenta.
  await aplicarPlan(A.db, raizA, 'MOSTRADOR_1', impactMap);
  assert.strictEqual(await mp(A.db, raizA, '6M'), 998.25);
  assert.strictEqual(await mp(A.db, raizB, '6M'), 1000, 'el otro comercio no se tocó');

  await aplicarPlan(A.db, raizB, 'MOSTRADOR_1', impactMap);
  assert.strictEqual(await mp(A.db, raizB, '6M'), 998.25);
  assert.strictEqual(await mp(A.db, raizA, '6M'), 998.25, 'no se descontó dos veces en A');

  // El turno y la venta también viven bajo la raíz, no bajo el localId.
  await set(ref(A.db, `${raizA}/CAJAS/27-07-2026/turnos/1`), { estado: 'abierto' });
  assert.strictEqual((await get(ref(A.db, `${raizB}/CAJAS`))).val(), null, 'la caja no se mezcla');
});

// ---------------------------------------------------------------------------
// La materia prima se descuenta SIEMPRE, y el artículo heredado sin control
// descuenta contra su padre (caso BOMBON SUIZO de Achaval: 4 IDs, uno por
// departamento; el del depto 1 lleva la cuenta y los otros tres heredan de él
// con el control de stock apagado).
// ---------------------------------------------------------------------------
console.log('\nBanderas de disponibilidad vs. consumo (contra el emulador):');

const ART_BAND = {
  BASE: { nombre: 'Bombon base', controlStock: true, stock: { stockType: 'propio', propio: 5 } },
  'HIJO-1': { nombre: 'Bombon depto 2', controlStock: false, stock: { heredadoDe: 'BASE' } },
  'HIJO-2': { nombre: 'Bombon depto 9', controlStock: false, stock: { heredadoDe: 'BASE' } },
  'A-RECETA': {
    nombre: 'Elaborado', controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-IGNORA': 0.25, 'M-SINCTRL': 0.25, 'M-NORMAL': 0.25 } },
  },
};
const MP_BAND = {
  'M-NORMAL': { nombre: 'Normal', stock: 1 },
  'M-IGNORA': { nombre: 'Ignora stock', stock: 1, ignoraStock: true },
  'M-SINCTRL': { nombre: 'Sin control', stock: 1, controlStock: false },
};
async function sembrarBand(sufijo) {
  const raiz = `${LOCAL}${sufijo}`;
  await set(ref(A.db, raiz), { ARTICULOS: ART_BAND, MATERIA_PRIMA: MP_BAND });
  return raiz;
}
const planDe = (items) => construirPlanDeStock({ items, articulos: ART_BAND, materiaPrima: MP_BAND }).impactMap;

await check('1 unidad de un heredado sin control descuenta 1 de la base', async () => {
  const raiz = await sembrarBand('_band1');
  const impactMap = planDe([{ id: 'HIJO-1', quantity: 1 }]);
  assert.deepStrictEqual(impactMap, { BASE: { quantity: 1, type: 'ARTICULO' } });
  const { resultados } = await aplicarPlan(A.db, raiz, refMostrador(910), impactMap);
  assert.ok(resultados.every((r) => r.resultado === 'applied'));
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/BASE/stock/propio`))).val(), 4);
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/HIJO-1/stock/propio`))).val(), null, 'el hijo no lleva cuenta');
});

await check('ignoraStock y controlStock NO impiden el descuento; el saldo queda negativo', async () => {
  const raiz = await sembrarBand('_band2');
  // 8 unidades × 0,25 = 2 de cada materia prima, con saldo 1: todas van a -1.
  const impactMap = planDe([{ id: 'A-RECETA', quantity: 8 }]);
  assert.deepStrictEqual(impactMap, {
    'M-IGNORA': { quantity: 2, type: 'MATERIA_PRIMA' },
    'M-SINCTRL': { quantity: 2, type: 'MATERIA_PRIMA' },
    'M-NORMAL': { quantity: 2, type: 'MATERIA_PRIMA' },
  });
  const { resultados } = await aplicarPlan(A.db, raiz, refMostrador(911), impactMap);
  assert.ok(resultados.every((r) => r.resultado === 'applied'), JSON.stringify(resultados));
  for (const id of ['M-IGNORA', 'M-SINCTRL', 'M-NORMAL']) {
    assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/${id}/stock`))).val(), -1, id);
  }
});

await check('descontar NO borra las banderas: disponibilidad y consumo son cosas distintas', async () => {
  const raiz = await sembrarBand('_band3');
  await aplicarPlan(A.db, raiz, refMostrador(912), planDe([{ id: 'A-RECETA', quantity: 8 }]));
  const ignora = (await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-IGNORA`))).val();
  const sinCtrl = (await get(ref(A.db, `${raiz}/MATERIA_PRIMA/M-SINCTRL`))).val();
  assert.strictEqual(ignora.ignoraStock, true, 'la bandera sigue ahí para decidir disponibilidad');
  assert.strictEqual(sinCtrl.controlStock, false);
  assert.strictEqual(ignora.stock, -1, 'pero el saldo refleja el consumo real');
  // La decisión de disponibilidad vive en otro módulo y sigue diciendo "activa".
  assert.strictEqual(materiaPrimaDisponible(ignora, 1), true, 'con ignoraStock no bloquea aunque esté en -1');
  assert.strictEqual(materiaPrimaDisponible({ nombre: 'x', stock: -1 }, 1), false, 'sin la bandera, sí bloquea');
});

await check('cancelar repone también lo que tenía las banderas puestas', async () => {
  const raiz = await sembrarBand('_band4');
  const impactMap = planDe([{ id: 'A-RECETA', quantity: 8 }]);
  await aplicarPlan(A.db, raiz, refMostrador(913), impactMap);
  for (const d of construirImpactoCanonico(impactMap)) {
    const r = await revertirRecurso(A.db, rutaRecurso(raiz, d.id, d.tipo), {
      referenceIdOriginal: refMostrador(913),
      referenceIdReversion: refReversionMostrador(913),
      tipo: d.tipo,
    });
    assert.strictEqual(r, 'revertido', d.id);
  }
  for (const id of ['M-IGNORA', 'M-SINCTRL', 'M-NORMAL']) {
    assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/${id}/stock`))).val(), 1, id);
  }
});

// ---------------------------------------------------------------------------
// REGRESIÓN DE PRODUCCIÓN (Achaval, 2026-07-28): con OTRO LISTENER VIVO sobre
// la ruta, el descuento se colgaba y la venta quedaba sin stock.
//
// La app siempre tiene listeners sobre ARTICULOS/MATERIA_PRIMA (pantalla de
// Stock, useStockStatus, automatizaciones). En esa condición RTDB invoca el
// callback de `onValue` SINCRÓNICAMENTE, y el patrón de "precarga"
//
//     const off = onValue(refNodo, () => { off(); resolve(); });
//
// explota con "Cannot access 'off' before initialization" (zona muerta temporal
// del const) DENTRO del executor de la Promise: la promesa se rechaza y toda la
// operación muere en silencio con la marca en `processing`.
//
// Estas pruebas montan el listener ANTES de descontar, que es lo que las
// pruebas anteriores no hacían y por eso pasaban mientras producción fallaba.
// ---------------------------------------------------------------------------
console.log('\nCon listeners vivos sobre las rutas (condición real de la app):');

await check('el patrón de precarga con onValue es el que rompía', async () => {
  const raiz = await sembrarBand('_lis0');
  // Listener vivo sobre el padre, igual que la pantalla de Stock.
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/MATERIA_PRIMA`), () => res()); });

  let errorDelPatron = null;
  await new Promise((resolve) => {
    try {
      const off = onValue(ref(A.db, `${raiz}/MATERIA_PRIMA/M-NORMAL`), () => {
        try { off(); } catch (e) { errorDelPatron = e; }
        resolve();
      });
    } catch (e) { errorDelPatron = e; resolve(); }
  });
  assert.ok(errorDelPatron instanceof ReferenceError, 'el patrón viejo debe seguir siendo demostrablemente inválido');
  assert.match(errorDelPatron.message, /before initialization/);
});

await check('descontar SIN precarga funciona con listeners vivos', async () => {
  const raiz = await sembrarBand('_lis1');
  // Los mismos listeners que tiene la app abierta.
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/MATERIA_PRIMA`), () => res()); });
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/ARTICULOS`), () => res()); });

  const impactMap = planDe([{ id: 'A-RECETA', quantity: 4 }]);   // 1 de cada materia prima
  const t0 = Date.now();
  const { resultados } = await aplicarPlan(A.db, raiz, refMostrador(920), impactMap);
  const ms = Date.now() - t0;

  assert.ok(resultados.every((r) => r.resultado === 'applied'), JSON.stringify(resultados));
  for (const id of ['M-IGNORA', 'M-SINCTRL', 'M-NORMAL']) {
    assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/${id}/stock`))).val(), 0, id);
  }
  // Inmediato: si tarda segundos, algo volvió a colgarse.
  assert.ok(ms < 3000, `el descuento tardó ${ms} ms — debe ser inmediato`);
  console.log(`      (plan completo aplicado en ${ms} ms con listeners activos)`);
});

await check('el artículo heredado descuenta en su padre con listeners vivos', async () => {
  const raiz = await sembrarBand('_lis2');
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/ARTICULOS`), () => res()); });
  const impactMap = planDe([{ id: 'HIJO-1', quantity: 1 }]);
  const { resultados } = await aplicarPlan(A.db, raiz, refMostrador(921), impactMap);
  assert.ok(resultados.every((r) => r.resultado === 'applied'));
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/BASE/stock/propio`))).val(), 4);
});

await check('la REPOSICIÓN por cancelación también funciona con listeners vivos', async () => {
  const raiz = await sembrarBand('_lis4');
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/MATERIA_PRIMA`), () => res()); });
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/ARTICULOS`), () => res()); });

  const impactMap = planDe([{ id: 'A-RECETA', quantity: 4 }, { id: 'HIJO-1', quantity: 1 }]);
  await aplicarPlan(A.db, raiz, refMostrador(930), impactMap);
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/BASE/stock/propio`))).val(), 4);

  const t0 = Date.now();
  for (const d of construirImpactoCanonico(impactMap)) {
    const r = await revertirRecurso(A.db, rutaRecurso(raiz, d.id, d.tipo), {
      referenceIdOriginal: refMostrador(930),
      referenceIdReversion: refReversionMostrador(930),
      tipo: d.tipo,
    });
    assert.strictEqual(r, 'revertido', `${d.id}: ${r}`);
  }
  const ms = Date.now() - t0;
  assert.strictEqual((await get(ref(A.db, `${raiz}/ARTICULOS/BASE/stock/propio`))).val(), 5);
  for (const id of ['M-IGNORA', 'M-SINCTRL', 'M-NORMAL']) {
    assert.strictEqual((await get(ref(A.db, `${raiz}/MATERIA_PRIMA/${id}/stock`))).val(), 1, id);
  }
  assert.ok(ms < 3000, `la reposición tardó ${ms} ms — debe ser inmediata`);
  console.log(`      (reposición completa en ${ms} ms con listeners activos)`);
});

await check('ninguna promesa queda pendiente ni rechazada en silencio', async () => {
  const raiz = await sembrarBand('_lis5');
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/MATERIA_PRIMA`), () => res()); });

  const rechazos = [];
  const onRej = (e) => rechazos.push(e);
  process.on('unhandledRejection', onRej);
  try {
    const impactMap = planDe([{ id: 'A-RECETA', quantity: 4 }]);
    // Con timeout propio: si alguna promesa quedara pendiente, esto falla.
    const carrera = await Promise.race([
      aplicarPlan(A.db, raiz, refMostrador(931), impactMap).then(() => 'listo'),
      new Promise((r) => setTimeout(() => r('COLGADO'), 5000)),
    ]);
    assert.strictEqual(carrera, 'listo', 'la operación quedó pendiente');
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(rechazos, [], `hubo rechazos silenciosos: ${rechazos.map(String).join(' | ')}`);
  } finally {
    process.off('unhandledRejection', onRej);
  }
});

await check('TODOS los recursos del plan se aplican, no solo el primero', async () => {
  const raiz = await sembrarBand('_lis3');
  await new Promise((res) => { onValue(ref(A.db, `${raiz}/MATERIA_PRIMA`), () => res()); });
  // Es exactamente lo que fallaba: se aplicaba 1M y se moría en el segundo.
  const impactMap = planDe([{ id: 'A-RECETA', quantity: 4 }]);
  await aplicarPlan(A.db, raiz, refMostrador(922), impactMap);
  const nodos = (await get(ref(A.db, `${raiz}/MATERIA_PRIMA`))).val();
  for (const id of Object.keys(impactMap)) {
    assert.ok(nodos[id].appliedOps, `${id} no registró appliedOps: quedó a medias`);
  }
});

console.log(`\n${passed} pruebas de integración OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
await Promise.all([deleteApp(A.app), deleteApp(B.app)]);
process.exit(process.exitCode || 0);
