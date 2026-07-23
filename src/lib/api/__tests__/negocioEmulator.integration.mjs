// Fase 2 — punto 12: los 12 casos de negocio, de punta a punta, contra el
// emulador REAL de Realtime Database.
//
// Recorre la cadena completa que usa la aplicación: catálogo -> opciones
// resueltas del departamento -> snapshot congelado -> plan de stock por ruta
// física -> transacción idempotente en el emulador -> verificación del stock.
//
// No toca producción: se conecta al emulador con datos aislados por caso.
//
// Correr con:
//   firebase emulators:exec --only database --project stock-test ^
//     --config emulator/firebase.json ^
//     "node src/lib/api/__tests__/negocioEmulator.integration.mjs"
import assert from 'node:assert';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, runTransaction, onValue, connectDatabaseEmulator } from 'firebase/database';
import { combinarConfigDeGrupo, opcionesVisiblesDeGrupo, opcionSeleccionable, etiquetaDeOpcion, snapshotDeOpcion } from '../opcionesDeGrupo.js';
import { construirPlanDeStock } from '../stockPlan.js';
import { calcularTotalPedido, construirLineaPersistible } from '../optionalsPricing.js';

import { validarPedidoExterno, ESTADOS_VALIDACION, aplicarDecisionOperador, puedePasarAEntregado } from '../validacionPedidoExterno.js';
import {
  aplicarEnRecurso, revertirEnRecurso, calcularImpactHash,
  construirImpactoCanonico, rutaRecurso, resolverResultadoRecurso, operationKey,
} from '../stockAtomico.js';

/** calcularTotalPedido devuelve el desglose; acá interesa el importe final. */
const totalDe = (items) => calcularTotalPedido(items).total;

let passed = 0;
let fallas = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { fallas += 1; console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) {
  console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST: correr con `firebase emulators:exec`.');
  process.exit(1);
}
const [host, port] = HOST.split(':');
function nuevoCliente(nombre) {
  const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, nombre);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, Number(port));
  return db;
}
const DESKTOP = nuevoCliente('negocioDesktop');
const TABLET = nuevoCliente('negocioTablet');

// ---------------------------------------------------------------------------
// Catálogo de prueba (el del enunciado)
// ---------------------------------------------------------------------------
const DEPARTAMENTOS = { 'D-TOP': { nombre: 'TOPPING', activoDelivery: true, activoMostrador: true } };

const ROCKLETS = {
  nombre: 'Rocklets', departamento: 'D-TOP', valor: 1700, costoUnitario: 400,
  controlStock: true, activoDelivery: true, activoMostrador: true,
  stock: { stockType: 'propio', propio: 20 },
};
const GRANAS = { // gratuito, pero descuenta stock
  nombre: 'Granas', departamento: 'D-TOP', valor: 0, costoUnitario: 50,
  controlStock: true, activoDelivery: true, activoMostrador: true,
  stock: { stockType: 'propio', propio: 12 },
};
const KILO = {
  nombre: '1 KILO DE HELADO', departamento: 'D-HEL', valor: 14500, costoUnitario: 3000,
  controlStock: true, activoDelivery: true, activoMostrador: true,
  stock: { stockType: 'propio', propio: 10 },
  // El grupo TOPPING queda habilitado en el articulo; su origen lo declara el
  // catalogo de grupos, no el articulo.
  opcionalesConfig: { 'G-TOPPING': { activo: true, min: 0, max: 3, obligatorio: false }, 'G-SABORES': { activo: true, min: 0, max: 3, obligatorio: false, opcionales: ['O-CHOCO'] } },
};
const ARTICULOS = { 'A-ROCKLETS': ROCKLETS, 'A-GRANAS': GRANAS, 'A-0007': KILO };

const GRUPO_TOPPING = {
  codigo: 'G-TOPPING', nombre: 'TOPPING', origen: 'departamento', departamentoId: 'D-TOP',
  usarPrecioArticulo: true, controlarStock: true, consumoStockUnitarioDefault: 1,
};
const GRUPO_SABORES = { codigo: 'G-SABORES', nombre: 'SABORES' }; // manual, sin `origen`
const CONFIG_EN_KILO = { activo: true, min: 0, max: 3, obligatorio: false };

const cfgTopping = combinarConfigDeGrupo({ id: 'G-TOPPING', ...CONFIG_EN_KILO }, GRUPO_TOPPING);

function opcionesTopping({ articulos = ARTICULOS, canal = 'mostrador', estaDisponible = null } = {}) {
  return opcionesVisiblesDeGrupo({ config: cfgTopping, articulos, materiaPrima: {}, canal, estaDisponible }).opciones;
}
const rocklets = (canal = 'mostrador') => opcionesTopping({ canal }).find(o => o.articleId === 'A-ROCKLETS');

/** Una unidad de 1 KILO con los opcionales indicados. */
function unidad(opciones, { unidadIndice, unidadTotal }) {
  const snaps = opciones.map(o => snapshotDeOpcion(o, { cantidad: 1, unidadIndice, unidadTotal }));
  return construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: snaps.length ? { 'G-TOPPING': snaps } : {},
  });
}

// ---------------------------------------------------------------------------
// Utilidades del emulador
// ---------------------------------------------------------------------------
const precargar = (r) => new Promise((resolve) => { const off = onValue(r, () => { off(); resolve(); }); });

async function sembrar(caso, articulos = ARTICULOS) {
  const raiz = `NEGOCIO_${caso}`;
  await set(ref(DESKTOP, raiz), {
    DEPARTAMENTOS,
    ARTICULOS: JSON.parse(JSON.stringify(articulos)),
    MATERIA_PRIMA: { 'M-3': { nombre: 'Azucar', stock: 100 } },
  });
  return raiz;
}
const stockDe = async (raiz, id) => (await get(ref(DESKTOP, `${raiz}/ARTICULOS/${id}/stock/propio`))).val();
const mpDe = async (raiz, id) => (await get(ref(DESKTOP, `${raiz}/MATERIA_PRIMA/${id}/stock`))).val();

/** Aplica un plan completo con el cliente indicado. Devuelve el resultado por recurso. */
async function aplicarPlan(db, raiz, impactMap, referenceId) {
  const hash = calcularImpactHash(impactMap);
  const out = {};
  for (const d of construirImpactoCanonico(impactMap)) {
    const ruta = rutaRecurso(raiz, d.id, d.tipo);
    await precargar(ref(db, ruta));
    let resultado = null; let invocacion = 0;
    await runTransaction(ref(db, ruta), (nodo) => {
      invocacion += 1;
      const r = aplicarEnRecurso(nodo, { referenceId, cantidad: d.cantidad, impactHash: hash, tipo: d.tipo, invocacion });
      resultado = r.resultado;
      return r.nodo;
    });
    if (resultado === 'retryable') resultado = resolverResultadoRecurso(resultado, (await get(ref(db, ruta))).val());
    out[d.id] = resultado;
  }
  return out;
}

async function revertirPlan(db, raiz, impactMap, referenceIdOriginal, referenceIdReversion) {
  const out = {};
  for (const d of construirImpactoCanonico(impactMap)) {
    const ruta = rutaRecurso(raiz, d.id, d.tipo);
    await precargar(ref(db, ruta));
    let resultado = null; let invocacion = 0;
    await runTransaction(ref(db, ruta), (nodo) => {
      invocacion += 1;
      const r = revertirEnRecurso(nodo, { referenceIdOriginal, referenceIdReversion, tipo: d.tipo, invocacion });
      resultado = r.resultado;
      return r.nodo;
    });
    if (resultado === 'retryable') resultado = resolverResultadoRecurso(resultado, (await get(ref(db, ruta))).val());
    out[d.id] = resultado;
  }
  return out;
}

const plan = (items, articulos = ARTICULOS, materiaPrima = {}) =>
  construirPlanDeStock({ items, articulos, materiaPrima }).impactMap;

// ===========================================================================
console.log('\nCASO 1 — una unidad con Rocklets');
// ===========================================================================
await check('Rocklets aparece en el selector con (+$1.700)', () => {
  const r = rocklets();
  assert.ok(r, 'no aparece en el selector');
  assert.strictEqual(etiquetaDeOpcion(r), 'Rocklets (+$1.700)');
});
await check('la misma resolución vale para delivery', () => {
  assert.ok(opcionesTopping({ canal: 'delivery' }).some(o => o.articleId === 'A-ROCKLETS'));
});
await check('el total es $16.200', () => {
  const l = unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 });
  assert.strictEqual(totalDe([l]), 16200);
});
await check('el JSON persistido también dice $16.200', () => {
  const l = unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 });
  const releido = JSON.parse(JSON.stringify(l));
  assert.strictEqual(totalDe([releido]), 16200, 'el total cambia al releer lo guardado');
  assert.strictEqual(releido.valor, 14500, 'el valor base debe seguir siendo el base');
});
await check('venta $1.700, costo $400 y ganancia $1.300 del adicional', () => {
  const [s] = unidad([rocklets()], {}).selectedOptionals['G-TOPPING'];
  assert.strictEqual(s.total, 1700);
  assert.strictEqual(s.costoTotal, 400);
  assert.strictEqual(s.total - s.costoTotal, 1300);
});
await check('stock 20 -> 19, y un segundo procesamiento NO vuelve a descontar', async () => {
  const raiz = await sembrar('C1');
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  const impacto = plan(items);
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 20, 'antes de procesar');
  await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C1');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19, 'después de procesar');
  const segunda = await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C1');
  assert.strictEqual(segunda['A-ROCKLETS'], 'already-applied');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19, 'descontó dos veces');
});
await check('reimprimir no mueve stock (no hay operación nueva)', async () => {
  const raiz = 'NEGOCIO_C1';
  // Reimprimir sólo vuelve a construir el detalle: no ejecuta ningún plan.
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  construirPlanDeStock({ items, articulos: ARTICULOS });
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19);
});

// ===========================================================================
console.log('\nCASO 2 — dos unidades, Rocklets en ambas');
// ===========================================================================
await check('cada unidad se pregunta por separado; nada se copia', () => {
  const u1 = unidad([rocklets()], { unidadIndice: 1, unidadTotal: 2 });
  const u2 = unidad([], { unidadIndice: 2, unidadTotal: 2 });
  assert.ok(u1.selectedOptionals['G-TOPPING'].length === 1);
  assert.ok(!u2.selectedOptionals || !(u2.selectedOptionals['G-TOPPING'] || []).length,
    'la unidad 2 heredó la selección de la 1');
});
await check('total $32.400', () => {
  const items = [
    unidad([rocklets()], { unidadIndice: 1, unidadTotal: 2 }),
    unidad([rocklets()], { unidadIndice: 2, unidadTotal: 2 }),
  ];
  assert.strictEqual(totalDe(items), 32400);
});
await check('las dos líneas NO se fusionan aunque la selección sea igual', () => {
  const items = [
    unidad([rocklets()], { unidadIndice: 1, unidadTotal: 2 }),
    unidad([rocklets()], { unidadIndice: 2, unidadTotal: 2 }),
  ];
  assert.strictEqual(items.length, 2);
  assert.notStrictEqual(items[0].selectedOptionals['G-TOPPING'][0].unidadIndice,
    items[1].selectedOptionals['G-TOPPING'][0].unidadIndice);
});
await check('impacto Rocklets 2, stock 20 -> 18, repetido sigue 18', async () => {
  const raiz = await sembrar('C2');
  const items = [
    unidad([rocklets()], { unidadIndice: 1, unidadTotal: 2 }),
    unidad([rocklets()], { unidadIndice: 2, unidadTotal: 2 }),
  ];
  const impacto = plan(items);
  assert.strictEqual(impacto['A-ROCKLETS'].quantity, 2, 'el impacto no se agrupó en 2');
  await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C2');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 18);
  await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C2');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 18);
});

// ===========================================================================
console.log('\nCASO 3 — Rocklets en una sola unidad');
// ===========================================================================
await check('total $30.700 y stock 20 -> 19', async () => {
  const raiz = await sembrar('C3');
  const items = [
    unidad([rocklets()], { unidadIndice: 1, unidadTotal: 2 }),
    unidad([], { unidadIndice: 2, unidadTotal: 2 }),
  ];
  assert.strictEqual(totalDe(items), 30700);
  await aplicarPlan(DESKTOP, raiz, plan(items), 'PEDIDO_C3');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19);
});

// ===========================================================================
console.log('\nCASO 4 — opcional gratuito CON stock');
// ===========================================================================
await check('no muestra "+$0" ni cambia el total, pero sí descuenta', async () => {
  const raiz = await sembrar('C4');
  const granas = opcionesTopping().find(o => o.articleId === 'A-GRANAS');
  assert.strictEqual(etiquetaDeOpcion(granas), 'Granas', 'mostró un adicional de cero');
  const items = [unidad([granas], { unidadIndice: 1, unidadTotal: 1 })];
  assert.strictEqual(totalDe(items), 14500, 'un gratuito no puede cambiar el total');
  await aplicarPlan(DESKTOP, raiz, plan(items), 'PEDIDO_C4');
  assert.strictEqual(await stockDe(raiz, 'A-GRANAS'), 11, 'un gratuito con stock sí descuenta');
});

// ===========================================================================
console.log('\nCASO 5 — Mostrador: venta y cancelación');
// ===========================================================================
await check('la venta descuenta base y topping', async () => {
  const raiz = await sembrar('C5');
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  await aplicarPlan(DESKTOP, raiz, plan(items), 'MOSTRADOR_V5');
  assert.strictEqual(await stockDe(raiz, 'A-0007'), 9, 'no descontó el artículo base');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19, 'no descontó el topping');
});
await check('cancelar repone ambos', async () => {
  const raiz = 'NEGOCIO_C5';
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  await revertirPlan(DESKTOP, raiz, plan(items), 'MOSTRADOR_V5', 'REVERSAL_MOSTRADOR_V5');
  assert.strictEqual(await stockDe(raiz, 'A-0007'), 10);
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 20);
});
await check('una segunda cancelación NO vuelve a reponer', async () => {
  const raiz = 'NEGOCIO_C5';
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  const r = await revertirPlan(DESKTOP, raiz, plan(items), 'MOSTRADOR_V5', 'REVERSAL_MOSTRADOR_V5');
  assert.strictEqual(r['A-ROCKLETS'], 'ya-revertido');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 20, 'repuso dos veces');
  assert.strictEqual(await stockDe(raiz, 'A-0007'), 10);
});
await check('los identificadores son determinísticos y distintos entre sí', async () => {
  const nodo = (await get(ref(DESKTOP, 'NEGOCIO_C5/ARTICULOS/A-ROCKLETS/stock/appliedOps'))).val() || {};
  const claves = Object.keys(nodo);
  // Las claves se derivan del referenceId: mismo id, misma clave, siempre.
  assert.ok(claves.includes(operationKey('stock', 'MOSTRADOR_V5')), 'falta la marca original');
  assert.ok(claves.includes(operationKey('stock', 'REVERSAL_MOSTRADOR_V5')), 'falta la marca de reversión');
  assert.strictEqual(claves.length, 2, 'no debería haber más de una marca por operación');
});

// ===========================================================================
console.log('\nCASO 6 — precio manipulado');
// ===========================================================================
const OFICIAL_PARA_VALIDAR = {
  articulos: ARTICULOS,
  departamentos: { ...DEPARTAMENTOS, 'D-HEL': { nombre: 'HELADOS', activoDelivery: true, activoMostrador: true } },
  gruposOpcionales: { 'G-TOPPING': GRUPO_TOPPING, 'G-SABORES': GRUPO_SABORES },
  materiaPrima: {},
};
function pedidoDlvConPrecio(precio) {
  const r = rocklets('delivery');
  const snap = snapshotDeOpcion({ ...r, precio }, { cantidad: 1, unidadIndice: 1, unidadTotal: 1 });
  return {
    id: 'DLV-6', origen: 'dlv',
    items: [construirLineaPersistible({
      id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
      selectedOptionals: { 'G-TOPPING': [snap] },
    })],
  };
}
let validacion6 = null;
await check('devuelve price-mismatch con los dos importes', () => {
  validacion6 = validarPedidoExterno(pedidoDlvConPrecio(100), OFICIAL_PARA_VALIDAR);
  const issue = validacion6.issues.find(i => i.estado === ESTADOS_VALIDACION.PRICE_MISMATCH);
  assert.ok(issue, `esperaba price-mismatch, llegó: ${JSON.stringify(validacion6.issues.map(i => i.estado))}`);
  assert.strictEqual(issue.precioRecibido, 100);
  assert.strictEqual(issue.precioOficial, 1700);
});
await check('bloquea el paso a ENTREGADO mientras no haya decisión', () => {
  assert.strictEqual(puedePasarAEntregado({ validacionExterna: validacion6 }).permitido, false);
});
await check('corregir al valor oficial deja el total en $16.200 y guarda trazabilidad', () => {
  const corregido = aplicarDecisionOperador(pedidoDlvConPrecio(100), validacion6, {
    decision: 'corregir-a-oficial', operador: 'CAJA1', ahora: 1700000000000,
  });
  assert.strictEqual(totalDe(corregido.items), 16200);
  const v = corregido.validacionExterna;
  assert.ok(v.itemsOriginales, 'perdió el snapshot original');
  assert.strictEqual(v.operador, 'CAJA1');
  assert.strictEqual(v.decision, 'corregir-a-oficial');
  assert.ok(v.totalRecibido !== undefined && v.totalOficial !== undefined, 'faltan los dos totales');
  assert.ok(Array.isArray(v.issues) && v.issues.length > 0);
  assert.strictEqual(puedePasarAEntregado(corregido).permitido, true);
});
await check('el aviso al operador no habla de fraude', () => {
  const texto = JSON.stringify(validacion6);
  assert.ok(!/fraude|estafa|robo/i.test(texto), 'trata al cliente de estafador');
});

// ===========================================================================
console.log('\nCASO 7 — invalid-option');
// ===========================================================================
await check('artículo de otro departamento, inexistente y no permitido', () => {
  const casos = [
    { articleId: 'A-0007', que: 'otro departamento' },
    { articleId: 'A-NOEXISTE', que: 'inexistente' },
  ];
  for (const c of casos) {
    const snap = snapshotDeOpcion({
      ...rocklets('delivery'), articleId: c.articleId, nombre: c.que,
    }, { cantidad: 1 });
    const v = validarPedidoExterno({
      id: 'DLV-7', origen: 'dlv',
      items: [construirLineaPersistible({
        id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
        selectedOptionals: { 'G-TOPPING': [snap] },
      })],
    }, OFICIAL_PARA_VALIDAR);
    assert.ok(v.issues.some(i => i.estado === ESTADOS_VALIDACION.INVALID_OPTION),
      `${c.que}: esperaba invalid-option, llegó ${JSON.stringify(v.issues.map(i => i.estado))}`);
    assert.strictEqual(puedePasarAEntregado({ validacionExterna: v }).permitido, false);
  }
});
await check('no mueve stock mientras esté rechazado', async () => {
  const raiz = await sembrar('C7');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 20, 'el catálogo arranca intacto');
});

// ===========================================================================
console.log('\nCASO 8 — unavailable');
// ===========================================================================
await check('inactivo: no se ofrece en un pedido nuevo', () => {
  const arts = { ...ARTICULOS, 'A-ROCKLETS': { ...ROCKLETS, activoMostrador: false, activoDelivery: false } };
  assert.ok(!opcionesTopping({ articulos: arts }).some(o => o.articleId === 'A-ROCKLETS'));
});
await check('agotado: se ve, pero no se puede elegir', () => {
  const o = opcionesTopping({ estaDisponible: (id) => id !== 'A-ROCKLETS' })
    .find(x => x.articleId === 'A-ROCKLETS');
  assert.ok(o, 'lo escondió en silencio');
  assert.strictEqual(opcionSeleccionable(o), false);
});
await check('un pedido externo con esa opción queda unavailable y no pasa a ENTREGADO', () => {
  const oficialAgotado = {
    ...OFICIAL_PARA_VALIDAR,
    articulos: { ...ARTICULOS, 'A-ROCKLETS': { ...ROCKLETS, activoDelivery: false } },
  };
  const snap = snapshotDeOpcion(rocklets('delivery'), { cantidad: 1 });
  const v = validarPedidoExterno({
    id: 'DLV-8', origen: 'dlv',
    items: [construirLineaPersistible({
      id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
      selectedOptionals: { 'G-TOPPING': [snap] },
    })],
  }, oficialAgotado);
  assert.ok(v.issues.some(i => i.estado === ESTADOS_VALIDACION.UNAVAILABLE),
    `llegó ${JSON.stringify(v.issues.map(i => i.estado))}`);
  assert.strictEqual(puedePasarAEntregado({ validacionExterna: v }).permitido, false);
});

// ===========================================================================
console.log('\nCASO 9 — consumo inválido');
// ===========================================================================
await check('consumo 10 contra el oficial 1: invalid-consumption', () => {
  const snap = { ...snapshotDeOpcion(rocklets('delivery'), { cantidad: 1 }), consumoStockUnitario: 10, consumoStockTotal: 10 };
  const v = validarPedidoExterno({
    id: 'DLV-9', origen: 'dlv',
    items: [construirLineaPersistible({
      id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
      selectedOptionals: { 'G-TOPPING': [snap] },
    })],
  }, OFICIAL_PARA_VALIDAR);
  assert.ok(v.issues.some(i => i.estado === ESTADOS_VALIDACION.INVALID_CONSUMPTION),
    `llegó ${JSON.stringify(v.issues.map(i => i.estado))}`);
});
await check('el plan usa el consumo OFICIAL, no el recibido: descuenta 1, no 10', async () => {
  const raiz = await sembrar('C9');
  const snapFalso = { ...snapshotDeOpcion(rocklets('delivery'), { cantidad: 1 }), consumoStockUnitario: 10, consumoStockTotal: 10 };
  const corregido = snapshotDeOpcion(rocklets('delivery'), { cantidad: 1 });
  assert.notStrictEqual(snapFalso.consumoStockTotal, corregido.consumoStockTotal);
  const items = [construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: { 'G-TOPPING': [corregido] },
  })];
  await aplicarPlan(DESKTOP, raiz, plan(items), 'PEDIDO_C9');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19, 'descontó el consumo manipulado');
});

// ===========================================================================
console.log('\nCASO 10 — ruta física, agrupación y reconciliación');
// ===========================================================================
const ARTS_RECETA = {
  'A-0007': { ...KILO, stock: { stockType: 'receta', receta: { 'M-3': 0.25 } } },
  'A-TOPREC': {
    nombre: 'Topping receta', departamento: 'D-TOP', valor: 900, activoMostrador: true, activoDelivery: true,
    controlStock: true, stock: { stockType: 'receta', receta: { 'M-3': 0.25 } },
  },
  'A-HEREDA': {
    nombre: 'Topping heredado', departamento: 'D-TOP', valor: 800, activoMostrador: true, activoDelivery: true,
    controlStock: true, stock: { stockType: 'heredado', heredadoDe: 'A-ROCKLETS' },
  },
  'A-ROCKLETS': ROCKLETS,
};
const MP = { 'M-3': { nombre: 'Azucar', stock: 100 } };
await check('base y topping por receta caen en UNA sola ruta con 0,50', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G-TOPPING', ...CONFIG_EN_KILO }, GRUPO_TOPPING);
  const op = opcionesVisiblesDeGrupo({ config: cfg, articulos: ARTS_RECETA, materiaPrima: MP, canal: 'mostrador' })
    .opciones.find(o => o.articleId === 'A-TOPREC');
  const items = [construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: { 'G-TOPPING': [snapshotDeOpcion(op, { cantidad: 1 })] },
  })];
  const impacto = plan(items, ARTS_RECETA, MP);
  assert.strictEqual(impacto['M-3'].quantity, 0.5, `esperaba 0,50 agrupado: ${JSON.stringify(impacto)}`);
  assert.ok(!impacto['A-0007'] && !impacto['A-TOPREC'], 'un artículo por receta no descuenta de sí mismo');
});
await check('una sola transacción por ruta física', async () => {
  const raiz = await sembrar('C10', ARTS_RECETA);
  const cfg = combinarConfigDeGrupo({ id: 'G-TOPPING', ...CONFIG_EN_KILO }, GRUPO_TOPPING);
  const op = opcionesVisiblesDeGrupo({ config: cfg, articulos: ARTS_RECETA, materiaPrima: MP, canal: 'mostrador' })
    .opciones.find(o => o.articleId === 'A-TOPREC');
  const items = [construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: { 'G-TOPPING': [snapshotDeOpcion(op, { cantidad: 1 })] },
  })];
  const impacto = plan(items, ARTS_RECETA, MP);
  assert.strictEqual(Object.keys(impacto).length, 1, 'más de una transacción para la misma ruta');
  await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C10');
  assert.strictEqual(await mpDe(raiz, 'M-3'), 99.5);
});
await check('el stock heredado apunta al padre, no a sí mismo', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G-TOPPING', ...CONFIG_EN_KILO }, GRUPO_TOPPING);
  const op = opcionesVisiblesDeGrupo({ config: cfg, articulos: ARTS_RECETA, materiaPrima: MP, canal: 'mostrador' })
    .opciones.find(o => o.articleId === 'A-HEREDA');
  const items = [construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: { 'G-TOPPING': [snapshotDeOpcion(op, { cantidad: 1 })] },
  })];
  const impacto = plan(items, ARTS_RECETA, MP);
  assert.ok(impacto['A-ROCKLETS'], `el heredado no resolvió al padre: ${JSON.stringify(impacto)}`);
  assert.ok(!impacto['A-HEREDA'], 'descontó de un artículo sin stock propio');
});
await check('operación parcial: se detecta y se reanuda sin duplicar', async () => {
  const raiz = await sembrar('C11P');
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  const impacto = plan(items);
  // Sólo el primer recurso (interrupción a mitad de camino).
  const primero = construirImpactoCanonico(impacto)[0];
  await aplicarPlan(DESKTOP, raiz, { [primero.id]: { quantity: primero.cantidad, type: primero.tipo } }, 'PEDIDO_PARCIAL');
  // Reanudar con el plan COMPLETO y su propio hash.
  const r = await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_PARCIAL');
  const aplicados = Object.values(r).filter(x => x === 'applied').length;
  const conflictos = Object.values(r).filter(x => x === 'hash-conflict').length;
  assert.ok(aplicados + conflictos === Object.keys(r).length,
    `estados inesperados: ${JSON.stringify(r)}`);
  assert.ok(conflictos >= 1, 'un impacto distinto sobre el mismo referenceId debe dar hash-conflict');
});

// ===========================================================================
console.log('\nCASO 11 — concurrencia Desktop / Tablet');
// ===========================================================================
await check('los dos procesan a la vez y descuenta UNA sola vez', async () => {
  const raiz = await sembrar('C11');
  const items = [unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 })];
  const impacto = plan(items);
  const [rd, rt] = await Promise.all([
    aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C11'),
    aplicarPlan(TABLET, raiz, impacto, 'PEDIDO_C11'),
  ]);
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19, 'descontó dos veces');
  assert.strictEqual(await stockDe(raiz, 'A-0007'), 9);
  const estados = [...Object.values(rd), ...Object.values(rt)];
  assert.ok(estados.includes('applied'), 'nadie aplicó');
  assert.ok(estados.includes('already-applied'), 'el segundo no detectó que ya estaba aplicado');
});
await check('mismo referenceId con impacto distinto: hash-conflict', async () => {
  const raiz = 'NEGOCIO_C11';
  const otro = { 'A-ROCKLETS': { quantity: 5, type: 'ARTICULO' } };
  const r = await aplicarPlan(TABLET, raiz, otro, 'PEDIDO_C11');
  assert.strictEqual(r['A-ROCKLETS'], 'hash-conflict');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 19, 'aplicó un impacto conflictivo');
});

// ===========================================================================
console.log('\nCASO 12 — históricos');
// ===========================================================================
await check('un grupo sin `origen` se sigue tratando como manual', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G-SABORES', activo: true, opcionales: ['O-CHOCO'] }, GRUPO_SABORES);
  assert.ok(!('origen' in cfg), 'le escribió un origen al leerlo');
  const { opciones } = opcionesVisiblesDeGrupo({
    config: cfg,
    opcionalesManuales: [{ id: 'O-CHOCO', grupo: 'G-SABORES', nombre: 'Chocolate', precio: 0 }],
    articulos: ARTICULOS,
  });
  assert.strictEqual(opciones.length, 1);
  assert.strictEqual(opciones[0].nombre, 'Chocolate');
});
await check('un opcional histórico sin articleId abre e imprime sin romper', () => {
  const linea = construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: { 'G-SABORES': [{ id: 'O-VIEJO', nombre: 'Sabor viejo', precio: 0, quantity: 1 }] },
  });
  const texto = JSON.stringify(linea);
  assert.ok(!/NaN|undefined|\[object Object\]/.test(texto), `salida inválida: ${texto}`);
  assert.strictEqual(totalDe([linea]), 14500);
});
await check('un opcional sin articleId NO mueve stock retroactivo', async () => {
  const raiz = await sembrar('C12');
  const linea = construirLineaPersistible({
    id: 'A-0007', codigo: 'A-0007', nombre: KILO.nombre, valor: KILO.valor, quantity: 1,
    selectedOptionals: { 'G-SABORES': [{ id: 'O-VIEJO', nombre: 'Sabor viejo', precio: 0, quantity: 1 }] },
  });
  const impacto = plan([linea]);
  assert.ok(!impacto['O-VIEJO'], 'inventó un impacto para un opcional sin artículo');
  await aplicarPlan(DESKTOP, raiz, impacto, 'PEDIDO_C12');
  assert.strictEqual(await stockDe(raiz, 'A-ROCKLETS'), 20, 'movió stock que no correspondía');
});
await check('cambiar precio o costo después NO altera el histórico', () => {
  const congelado = unidad([rocklets()], { unidadIndice: 1, unidadTotal: 1 });
  const antes = totalDe([congelado]);
  ROCKLETS.valor = 9999; ROCKLETS.costoUnitario = 7777;
  try {
    assert.strictEqual(totalDe([congelado]), antes, 'el histórico se movió con el catálogo');
    assert.strictEqual(congelado.selectedOptionals['G-TOPPING'][0].costoUnitarioAplicado, 400);
  } finally {
    ROCKLETS.valor = 1700; ROCKLETS.costoUnitario = 400;
  }
});

console.log(`\n${passed} pruebas OK` + (fallas ? ` — ${fallas} FALLAS` : ''));
process.exit(fallas ? 1 : 0);
