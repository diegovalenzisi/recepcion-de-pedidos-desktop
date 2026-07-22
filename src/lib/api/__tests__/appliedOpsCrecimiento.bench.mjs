// Fase 2 — MEDICIÓN del crecimiento de `appliedOps`.
//
// El diseño de idempotencia por recurso guarda una entrada por operación dentro
// del nodo `stock` del artículo. `runTransaction` lee y reenvía ese nodo entero
// en cada intento, así que para un topping muy vendido el costo crece con el
// historial. Esto lo mide de verdad, contra el EMULADOR REAL, en vez de
// suponerlo.
//
// Correr con:
//   firebase emulators:exec --only database --project stock-test ^
//     --config emulator/firebase.json ^
//     "node src/lib/api/__tests__/appliedOpsCrecimiento.bench.mjs"
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction, connectDatabaseEmulator } from 'firebase/database';
import { aplicarEnRecurso, calcularImpactHash, operationKey, construirEntradaOperacion } from '../stockAtomico.js';

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) { console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST'); process.exit(1); }
const [host, port] = HOST.split(':');

const cliente = (nombre) => {
  const app = initializeApp({ databaseURL: `http://${HOST}?ns=bench` }, nombre);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, Number(port));
  return { app, db };
};
const A = cliente('benchA');
const B = cliente('benchB');

const LOCAL = 'L_BENCH';
const ART = 'A-ROCKLETS';
const RUTA = `${LOCAL}/ARTICULOS/${ART}/stock`;

/** Siembra N operaciones ya aplicadas, en lotes, sin pasar por transacciones. */
async function sembrarOperaciones(n) {
  await set(ref(A.db, RUTA), { stockType: 'propio', propio: 1000000 });
  const LOTE = 2000;
  for (let base = 0; base < n; base += LOTE) {
    const payload = {};
    for (let i = base; i < Math.min(base + LOTE, n); i += 1) {
      const referenceId = `MOSTRADOR_${i}`;
      const clave = operationKey('stock', referenceId);
      payload[`${RUTA}/appliedOps/${clave}`] = construirEntradaOperacion({
        tipo: 'stock', referenceId, impactHash: `sha256:${'a'.repeat(64)}`, amount: 1, at: 1700000000000 + i,
      });
    }
    await update(ref(A.db), payload);
  }
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const kb = (b) => (b / 1024).toFixed(1);
const ms = (t) => t.toFixed(1);

async function medir(n) {
  await sembrarOperaciones(n);

  const t0 = performance.now();
  const snap = await get(ref(A.db, RUTA));
  const tLectura = performance.now() - t0;
  const tamano = bytes(snap.val());

  // Transacción real sobre el nodo cargado (el caso de una venta nueva).
  const referenceId = `MOSTRADOR_NUEVA_${n}`;
  const hash = calcularImpactHash({ [ART]: { quantity: 1, type: 'ARTICULO' } }, { localId: LOCAL });
  const t1 = performance.now();
  await runTransaction(ref(A.db, RUTA), (nodo) => {
    const r = aplicarEnRecurso(nodo, { referenceId, cantidad: 1, impactHash: hash, tipo: 'ARTICULO' });
    return r.nodo;
  });
  const tTx = performance.now() - t1;

  // Dos clientes a la vez sobre el mismo nodo: mide el costo del conflicto.
  const ref2 = `MOSTRADOR_CONC_${n}`;
  const t2 = performance.now();
  const conflictos = { A: 0, B: 0 };
  await Promise.all([
    runTransaction(ref(A.db, RUTA), (nodo) => {
      conflictos.A += 1;
      return aplicarEnRecurso(nodo, { referenceId: ref2, cantidad: 1, impactHash: hash, tipo: 'ARTICULO' }).nodo;
    }),
    runTransaction(ref(B.db, RUTA), (nodo) => {
      conflictos.B += 1;
      return aplicarEnRecurso(nodo, { referenceId: ref2, cantidad: 1, impactHash: hash, tipo: 'ARTICULO' }).nodo;
    }),
  ]);
  const tConc = performance.now() - t2;

  const final = (await get(ref(A.db, RUTA))).val();
  const descuentoConcurrente = 1000000 - final.propio;

  return {
    n,
    tamanoKB: kb(tamano),
    bytesPorOp: n > 0 ? Math.round(tamano / n) : 0,
    lecturaMs: ms(tLectura),
    txMs: ms(tTx),
    concurrenteMs: ms(tConc),
    reejecuciones: conflictos.A + conflictos.B,
    descuentoTotal: descuentoConcurrente,
  };
}

console.log('Crecimiento de appliedOps en un artículo muy vendido (emulador real)\n');
const filas = [];
for (const n of [0, 1000, 10000, 50000]) {
  const r = await medir(n);
  filas.push(r);
  console.log(`  ${String(n).padStart(6)} ops aplicadas → nodo ${r.tamanoKB.padStart(9)} KB`
    + ` | ${String(r.bytesPorOp).padStart(3)} B/op`
    + ` | lectura ${r.lecturaMs.padStart(8)} ms`
    + ` | transacción ${r.txMs.padStart(8)} ms`
    + ` | 2 clientes ${r.concurrenteMs.padStart(8)} ms (${r.reejecuciones} pasadas)`);
}

console.log('\nTabla:');
console.log('| ops | tamaño nodo | B/op | lectura | transacción | 2 clientes | descuento |');
console.log('|---|---|---|---|---|---|---|');
for (const r of filas) {
  console.log(`| ${r.n} | ${r.tamanoKB} KB | ${r.bytesPorOp} | ${r.lecturaMs} ms | ${r.txMs} ms | ${r.concurrenteMs} ms | ${r.descuentoTotal === 2 ? 'OK (1 por ref)' : `REVISAR: ${r.descuentoTotal}`} |`);
}

const ultima = filas[filas.length - 1];
console.log(`\nTráfico por venta con ${ultima.n} operaciones acumuladas: ~${ultima.tamanoKB} KB de lectura`
  + ` + ~${ultima.tamanoKB} KB de reenvío por cada pasada de la transacción.`);

await Promise.all([deleteApp(A.app), deleteApp(B.app)]);
process.exit(0);
