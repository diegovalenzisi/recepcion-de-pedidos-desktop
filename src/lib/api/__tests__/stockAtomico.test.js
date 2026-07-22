// Fase 2 — idempotencia POR RECURSO del impacto de stock.
//
// Backend en memoria que reproduce `runTransaction` de RTDB: lee, aplica el
// reductor y escribe; si el reductor devuelve undefined, aborta sin escribir.
// Permite intercalar dos clientes paso a paso para probar la carrera real.
//
// Las pruebas contra el emulador real están en
// src/lib/api/__tests__/stockEmulator.integration.mjs
//
// Correr con: node src/lib/api/__tests__/stockAtomico.test.js
import assert from 'node:assert';
import {
  aplicarEnRecurso, revertirEnRecurso, leerStockActual,
  construirImpactoCanonico, calcularImpactHash, validarPlan, rutaRecurso,
  decidirIntento, construirMarcaFinal, movimientoIdDe,
  refMostrador, refReversionMostrador, RESERVA_VENCIDA_MS,
} from '../stockAtomico.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// --- Backend en memoria con runTransaction ---------------------------------
class Db {
  constructor(datos = {}) { this.datos = JSON.parse(JSON.stringify(datos)); this.transacciones = 0; }
  leer(ruta) { return ruta.split('/').reduce((o, k) => (o == null ? undefined : o[k]), this.datos); }
  escribir(ruta, valor) {
    const p = ruta.split('/'); const u = p.pop();
    let n = this.datos;
    for (const k of p) { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; }
    n[u] = valor;
  }
  /** runTransaction: compare-and-set del servidor. undefined = abortar. */
  runTransaction(ruta, reductor) {
    this.transacciones += 1;
    const actual = this.leer(ruta) ?? null;
    const r = reductor(actual);
    const nodo = r && typeof r === 'object' && 'nodo' in r ? r.nodo : r;
    if (nodo === undefined) return { committed: false, resultado: r };
    this.escribir(ruta, nodo);
    return { committed: true, resultado: r };
  }
}

const LOCAL = 'LOCAL_A';
const base = () => ({
  [LOCAL]: {
    ARTICULOS: {
      'A-0007': { nombre: '1 KILO', stock: { stockType: 'propio', propio: 10 } },
      'A-ROCKLETS': { nombre: 'Rocklets', stock: { stockType: 'propio', propio: 20 } },
    },
    MATERIA_PRIMA: { 'M-3': { nombre: 'Azúcar', stock: 100 } },
  },
});

const IMPACTO = {
  'A-0007': { quantity: 1, type: 'ARTICULO' },
  'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' },
  'M-3': { quantity: 0.5, type: 'MATERIA_PRIMA' },
};

const stock = (db, id) => db.leer(`${LOCAL}/ARTICULOS/${id}/stock/propio`);
const mp = (db) => db.leer(`${LOCAL}/MATERIA_PRIMA/M-3/stock`);

/** Aplica el impacto recurso por recurso, como lo hará el motor real. */
function aplicar(db, referenceId, impactMap = IMPACTO, { hasta = Infinity, ahora = Date.now() } = {}) {
  const impactHash = calcularImpactHash(impactMap);
  const canonico = construirImpactoCanonico(impactMap);
  const resultados = [];
  let i = 0;
  for (const d of canonico) {
    if (i >= hasta) break;           // corte simulado a mitad de camino
    i += 1;
    const ruta = rutaRecurso(LOCAL, d.id, d.tipo);
    const { resultado } = db.runTransaction(ruta, (nodo) =>
      aplicarEnRecurso(nodo, { referenceId, cantidad: d.cantidad, impactHash, tipo: d.tipo, ahora }));
    resultados.push({ id: d.id, ...resultado });
  }
  return { resultados, impactHash, completo: i === canonico.length };
}

console.log('Impacto canónico y hash:');
check('el orden canónico no depende del recorrido del pedido', () => {
  const a = construirImpactoCanonico({ 'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' }, 'A-0007': { quantity: 1, type: 'ARTICULO' } });
  const b = construirImpactoCanonico({ 'A-0007': { quantity: 1, type: 'ARTICULO' }, 'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' } });
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a.map((d) => d.id), ['A-0007', 'A-ROCKLETS']);
});
check('mismo impacto → mismo hash, en cualquier orden', () => {
  assert.strictEqual(
    calcularImpactHash({ 'A-1': { quantity: 1, type: 'ARTICULO' }, 'A-2': { quantity: 2, type: 'ARTICULO' } }),
    calcularImpactHash({ 'A-2': { quantity: 2, type: 'ARTICULO' }, 'A-1': { quantity: 1, type: 'ARTICULO' } }),
  );
});
check('cambiar una cantidad cambia el hash', () => {
  assert.notStrictEqual(
    calcularImpactHash({ 'A-1': { quantity: 1, type: 'ARTICULO' } }),
    calcularImpactHash({ 'A-1': { quantity: 2, type: 'ARTICULO' } }),
  );
});
check('el movimiento tiene identidad determinística (no un push por intento)', () => {
  assert.strictEqual(movimientoIdDe(refMostrador(9)), 'MOV_MOSTRADOR_9');
  assert.strictEqual(movimientoIdDe(refMostrador(9)), movimientoIdDe(refMostrador(9)));
});

console.log('\nValidación del plan:');
check('rechaza cantidades corruptas, negativas, cero y tipos inválidos', () => {
  const r = validarPlan({ localId: LOCAL, impactMap: {
    'A-1': { quantity: NaN, type: 'ARTICULO' },
    'A-2': { quantity: -1, type: 'ARTICULO' },
    'A-3': { quantity: 0, type: 'ARTICULO' },
    'A-4': { quantity: Infinity, type: 'ARTICULO' },
    'A-5': { quantity: 1, type: 'OTRA_COSA' },
  } });
  assert.strictEqual(r.valido, false);
  const tipos = r.problemas.map((p) => p.tipo).sort();
  assert.deepStrictEqual(tipos, ['cantidad-cero', 'cantidad-negativa', 'cantidad-no-finita', 'cantidad-no-finita', 'tipo-invalido']);
});
check('receta y heredado que caen en la MISMA ruta física se detectan', () => {
  // Dos entradas distintas del mapa no pueden apuntar al mismo nodo.
  const r = validarPlan({ localId: LOCAL, impactMap: { 'A-1': { quantity: 1, type: 'ARTICULO' } } });
  assert.strictEqual(r.valido, true);
  assert.strictEqual(rutaRecurso(LOCAL, 'A-1', 'ARTICULO'), `${LOCAL}/ARTICULOS/A-1/stock`);
  assert.notStrictEqual(rutaRecurso(LOCAL, 'A-1', 'ARTICULO'), rutaRecurso(LOCAL, 'A-1', 'MATERIA_PRIMA'));
});
check('rechaza IDs no validados y con barra', () => {
  assert.strictEqual(validarPlan({ localId: LOCAL, impactMap: { 'A-9': { quantity: 1, type: 'ARTICULO' } }, idsValidos: ['A-1'] }).valido, false);
  assert.ok(validarPlan({ localId: LOCAL, impactMap: { 'a/b': { quantity: 1, type: 'ARTICULO' } } }).problemas.some((p) => p.tipo === 'id-con-barra'));
});
check('un plan sano pasa y no mezcla locales', () => {
  const r = validarPlan({ localId: LOCAL, impactMap: IMPACTO });
  assert.strictEqual(r.valido, true);
  assert.ok(r.rutas.every((x) => x.startsWith(`${LOCAL}/`)));
});

console.log('\nAplicación e idempotencia por recurso:');
check('descuenta base, opcional y materia prima', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(1));
  assert.strictEqual(stock(db, 'A-0007'), 9);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
  assert.strictEqual(mp(db), 99.5);
});
check('cada recurso registra el referenceId que se le aplicó', () => {
  const db = new Db(base());
  const { impactHash } = aplicar(db, refMostrador(1));
  const ops = db.leer(`${LOCAL}/ARTICULOS/A-ROCKLETS/stock/appliedOps`);
  assert.strictEqual(ops['MOSTRADOR_1'].amount, 2);
  assert.strictEqual(ops['MOSTRADOR_1'].impactHash, impactHash);
});
check('reintento completo NO vuelve a descontar', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(1));
  const r = aplicar(db, refMostrador(1));
  assert.ok(r.resultados.every((x) => x.resultado === 'ya-aplicado'));
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
});
check('mismo referenceId con OTRO impacto se rechaza, no se procesa', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(1));
  const otro = { 'A-ROCKLETS': { quantity: 5, type: 'ARTICULO' } };
  const r = aplicar(db, refMostrador(1), otro);
  assert.strictEqual(r.resultados[0].resultado, 'conflicto-de-hash');
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18, 'no se aplicó el impacto distinto');
});

console.log('\nOperación PARCIAL y reanudación:');
check('corte tras el primer recurso: el resto queda sin aplicar', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(2), IMPACTO, { hasta: 1 });
  assert.strictEqual(stock(db, 'A-0007'), 9, 'el primero sí se aplicó');
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20, 'el segundo no');
  assert.strictEqual(mp(db), 100);
});
check('reanudar completa SOLO lo que faltaba', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(2), IMPACTO, { hasta: 1 });
  const r = aplicar(db, refMostrador(2));
  assert.strictEqual(r.resultados[0].resultado, 'ya-aplicado', 'el primero no se toca');
  assert.strictEqual(r.resultados[1].resultado, 'aplicado');
  assert.strictEqual(stock(db, 'A-0007'), 9, 'nunca 8');
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
  assert.strictEqual(mp(db), 99.5);
});
check('la operación parcial es DETECTABLE por recurso', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(2), IMPACTO, { hasta: 1 });
  const aplicado = db.leer(`${LOCAL}/ARTICULOS/A-0007/stock/appliedOps`);
  const faltante = db.leer(`${LOCAL}/ARTICULOS/A-ROCKLETS/stock/appliedOps`);
  assert.ok(aplicado && aplicado['MOSTRADOR_2']);
  assert.ok(!faltante || !faltante['MOSTRADOR_2']);
});

console.log('\nLA CARRERA: A pausado → vence el lease → B recupera → A vuelve:');
check('el pedido se descuenta UNA SOLA VEZ', () => {
  const db = new Db(base());
  const ref = refMostrador(42);
  const t0 = Date.now();
  const rutaMarca = `${LOCAL}/PROCESSED_STOCK_IDS/${ref}`;

  // 1. A adquiere la reserva.
  assert.strictEqual(decidirIntento(db.leer(rutaMarca), t0).intentar, true);
  db.escribir(rutaMarca, { status: 'processing', ownerId: 'A', timestamp: t0 });

  // 2. A se pausa aquí, ANTES de aplicar nada.

  // 3. Vence el lease. 4. B lo recupera.
  const t1 = t0 + RESERVA_VENCIDA_MS + 1;
  const d = decidirIntento(db.leer(rutaMarca), t1);
  assert.strictEqual(d.intentar, true);
  assert.strictEqual(d.motivo, 'reserva-huerfana');
  db.escribir(rutaMarca, { status: 'processing', ownerId: 'B', timestamp: t1 });

  // 5 y 6. LOS DOS confirman: B primero, y después A despierta y aplica.
  const rb = aplicar(db, ref, IMPACTO, { ahora: t1 });
  const ra = aplicar(db, ref, IMPACTO, { ahora: t1 + 1 });   // A, con su lease vencido

  // 7. Un solo descuento.
  assert.strictEqual(stock(db, 'A-0007'), 9, 'nunca 8');
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18, 'nunca 16');
  assert.strictEqual(mp(db), 99.5, 'nunca 99');
  assert.ok(rb.resultados.every((x) => x.resultado === 'aplicado'));
  assert.ok(ra.resultados.every((x) => x.resultado === 'ya-aplicado'), 'A no puede aplicar de nuevo');
});
check('da igual el orden: si A confirma primero, B tampoco duplica', () => {
  const db = new Db(base());
  const ref = refMostrador(43);
  aplicar(db, ref);                       // A
  const rb = aplicar(db, ref);            // B, dueño "vigente"
  assert.ok(rb.resultados.every((x) => x.resultado === 'ya-aplicado'));
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
});
check('intercalados recurso por recurso tampoco duplican', () => {
  const db = new Db(base());
  const ref = refMostrador(44);
  const hash = calcularImpactHash(IMPACTO);
  const canonico = construirImpactoCanonico(IMPACTO);
  // A y B avanzan alternadamente sobre los mismos recursos.
  for (const d of canonico) {
    const ruta = rutaRecurso(LOCAL, d.id, d.tipo);
    const paso = (quien) => db.runTransaction(ruta, (n) =>
      aplicarEnRecurso(n, { referenceId: ref, cantidad: d.cantidad, impactHash: hash, tipo: d.tipo, ahora: Date.now() + (quien === 'B' ? 1 : 0) }));
    paso('A'); paso('B'); paso('A');
  }
  assert.strictEqual(stock(db, 'A-0007'), 9);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
  assert.strictEqual(mp(db), 99.5);
});
check('la reserva ya NO es el mecanismo de corrección (se puede saltear)', () => {
  // Aun ignorando por completo el lock, no hay doble descuento.
  const db = new Db(base());
  for (let i = 0; i < 4; i += 1) aplicar(db, refMostrador(45));
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 18);
});

console.log('\nAislamiento por local:');
check('dos locales con el mismo articleId no se mezclan', () => {
  const db = new Db({
    LOCAL_A: { ARTICULOS: { 'A-R': { stock: { propio: 20 } } } },
    LOCAL_B: { ARTICULOS: { 'A-R': { stock: { propio: 50 } } } },
  });
  db.runTransaction(rutaRecurso('LOCAL_A', 'A-R', 'ARTICULO'), (n) =>
    aplicarEnRecurso(n, { referenceId: 'MOSTRADOR_1', cantidad: 2, impactHash: 'h', tipo: 'ARTICULO' }));
  assert.strictEqual(db.leer('LOCAL_A/ARTICULOS/A-R/stock/propio'), 18);
  assert.strictEqual(db.leer('LOCAL_B/ARTICULOS/A-R/stock/propio'), 50);
  assert.ok(!db.leer('LOCAL_B/ARTICULOS/A-R/stock/appliedOps'));
});

console.log('\nValores de stock corruptos o históricos:');
check('distingue ausente, número, string histórico y corrupto', () => {
  assert.deepStrictEqual(leerStockActual({}, 'ARTICULO'), { valor: 0, estado: 'ausente' });
  assert.deepStrictEqual(leerStockActual({ propio: 5 }, 'ARTICULO'), { valor: 5, estado: 'ok' });
  assert.deepStrictEqual(leerStockActual({ propio: '7,5' }, 'ARTICULO'), { valor: 7.5, estado: 'string-historico' });
  assert.deepStrictEqual(leerStockActual({ propio: 'abc' }, 'ARTICULO'), { valor: 0, estado: 'corrupto' });
  assert.deepStrictEqual(leerStockActual({ propio: {} }, 'ARTICULO'), { valor: 0, estado: 'corrupto' });
});
check('un campo corrupto avisa y NO se convierte en un número en silencio', () => {
  const r = aplicarEnRecurso({ propio: 'abc' }, { referenceId: 'R', cantidad: 2, impactHash: 'h', tipo: 'ARTICULO' });
  assert.strictEqual(r.resultado, 'aplicado');
  assert.ok(r.aviso && r.aviso.tipo === 'stock-no-numerico');
  assert.strictEqual(r.aviso.estado, 'corrupto');
});
check('un string histórico avisa pero conserva el valor', () => {
  const r = aplicarEnRecurso({ propio: '20' }, { referenceId: 'R', cantidad: 2, impactHash: 'h', tipo: 'ARTICULO' });
  assert.strictEqual(r.stockNuevo, 18);
  assert.strictEqual(r.aviso.estado, 'string-historico');
});
check('stock válido insuficiente se permite negativo (política vigente) y sin aviso de corrupción', () => {
  const r = aplicarEnRecurso({ propio: 1 }, { referenceId: 'R', cantidad: 5, impactHash: 'h', tipo: 'ARTICULO' });
  assert.strictEqual(r.stockNuevo, -4);
  assert.strictEqual(r.aviso, null, 'faltante no es lo mismo que corrupto');
});
check('consumo decimal', () => {
  const r = aplicarEnRecurso({ stock: 100 }, { referenceId: 'R', cantidad: 0.25, impactHash: 'h', tipo: 'MATERIA_PRIMA' });
  assert.strictEqual(r.stockNuevo, 99.75);
});

console.log('\nReversión de mostrador:');
const revertir = (db, saleId, ahora = Date.now()) => {
  const canonico = construirImpactoCanonico(IMPACTO);
  return canonico.map((d) => db.runTransaction(rutaRecurso(LOCAL, d.id, d.tipo), (n) =>
    revertirEnRecurso(n, {
      referenceIdOriginal: refMostrador(saleId),
      referenceIdReversion: refReversionMostrador(saleId),
      tipo: d.tipo, ahora,
    })).resultado);
};
check('repone base, opcional y materia prima', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(60));
  revertir(db, 60);
  assert.strictEqual(stock(db, 'A-0007'), 10);
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20);
  assert.strictEqual(mp(db), 100);
});
check('segunda cancelación devuelve already-reversed y NO repone dos veces', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(61));
  revertir(db, 61);
  const r2 = revertir(db, 61);
  assert.ok(r2.every((x) => x.resultado === 'ya-revertido'));
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20, 'nunca 22');
});
check('con el nodo en null NO aborta: deja que RTDB reejecute con datos reales', () => {
  // RTDB llama al reductor la primera vez con el cache en null. Abortar ahí
  // (devolver undefined) impedía la reejecución y la reversión no reponía nada:
  // bug real detectado contra el emulador (daba 18 en vez de 20).
  const r = revertirEnRecurso(null, { referenceIdOriginal: 'MOSTRADOR_1', referenceIdReversion: 'REVERSAL_MOSTRADOR_1', tipo: 'ARTICULO' });
  assert.notStrictEqual(r.nodo, undefined, 'no debe abortar la transacción');
  assert.strictEqual(r.resultado, 'esperando-datos-del-servidor');
  assert.deepStrictEqual(r.nodo, {}, 'un objeto vacío equivale a null en RTDB: no deja basura');
});
check('no se puede revertir lo que nunca se aplicó en ese recurso', () => {
  const db = new Db(base());
  const r = revertir(db, 62);
  assert.ok(r.every((x) => x.resultado === 'original-no-aplicada'));
  assert.strictEqual(stock(db, 'A-ROCKLETS'), 20);
});
check('la marca original NO se borra ni se reutiliza', () => {
  const db = new Db(base());
  aplicar(db, refMostrador(63));
  revertir(db, 63);
  const ops = db.leer(`${LOCAL}/ARTICULOS/A-ROCKLETS/stock/appliedOps`);
  assert.ok(ops['MOSTRADOR_63'], 'la original sigue registrada');
  assert.ok(ops['REVERSAL_MOSTRADOR_63'], 'la reversión tiene su propia entrada');
});

console.log('\nMarca final:');
check('guarda hash, ledger y movimiento determinístico', () => {
  const m = construirMarcaFinal({
    referenceId: refMostrador(1), impactHash: calcularImpactHash(IMPACTO),
    impacto: construirImpactoCanonico(IMPACTO), source: 'Venta Mostrador', ownerId: 'A',
  });
  assert.strictEqual(m.status, 'completed');
  assert.strictEqual(m.movementId, 'MOV_MOSTRADOR_1');
  assert.strictEqual(m.impacto.length, 3);
});
check('una operación incompleta se marca partial, no completed', () => {
  const m = construirMarcaFinal({ referenceId: 'X', impactHash: 'h', impacto: [], parcial: true });
  assert.strictEqual(m.status, 'partial');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
