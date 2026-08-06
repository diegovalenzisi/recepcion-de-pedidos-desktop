// VERIFICACIÓN CONTRA LOS DATOS REALES DE BYNNON (solo lectura).
//
// No es una prueba de la batería: sale a Internet y depende del estado actual
// de la base, así que se corre a mano cuando se quiere confirmar el caso real.
//
//   node src/lib/api/__tests__/bynnonReal.check.mjs
//
// Confirma que, con el catálogo REAL, VASITOS X 5 (61A) queda oculto en
// Mostrador y en Delivery mientras VASITO DE PASTA (5M) no alcance, y que
// vuelve a aparecer al reponerlo. NUNCA escribe en Firebase: las reposiciones
// se simulan sobre una copia en memoria.
import assert from 'node:assert';
import { isArticleAvailable, materiasPrimasBloqueantes } from '../stockAvailability.js';
import { evaluarStockDeCarrito, mensajeDeBloqueo } from '../validacionStockVenta.js';

const BASE = 'https://heladeriabynnonadrogue-default-rtdb.firebaseio.com';
const LOCAL = '34516605';
const ART = '61A';   // VASITOS X 5
const MP = '5M';     // VASITO DE PASTA

let passed = 0;
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
};

const leer = async (p) => {
  const r = await fetch(`${BASE}/${LOCAL}/${p}.json`);
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return (await r.json()) || {};
};

const [articulos, materiaPrimaReal] = await Promise.all([leer('ARTICULOS'), leer('MATERIA_PRIMA')]);

const art = articulos[ART];
const mp = materiaPrimaReal[MP];
assert.ok(art, `no se encontró el artículo ${ART}`);
assert.ok(mp, `no se encontró la materia prima ${MP}`);

console.log(`\nLocal Bynnon (${LOCAL}) — datos REALES leídos de Firebase`);
console.log(`  Artículo      ${ART}  "${art.nombre}"`);
console.log(`                stockType=${art.stock?.stockType}  receta=${JSON.stringify(art.stock?.receta)}`);
console.log(`                activoMostrador=${art.activoMostrador}  activoDelivery=${art.activoDelivery}  controlStock=${art.controlStock}`);
console.log(`  Materia prima ${MP}  "${mp.nombre}"`);
console.log(`                stock=${JSON.stringify(mp.stock)}  activo=${mp.activo}  ignoraStock=${mp.ignoraStock}`);
console.log(`  Consume por unidad: ${art.stock?.receta?.[MP]}`);

// Copia con la materia prima en el estado que se quiera simular. NO se escribe.
const conMP = (cambios) => ({ ...materiaPrimaReal, [MP]: { ...mp, ...cambios } });
const canales = (materiaPrima) => ({
  mostrador: isArticleAvailable(ART, articulos, materiaPrima, 'counter'),
  delivery: isArticleAvailable(ART, articulos, materiaPrima, 'delivery'),
});

console.log('\nEstructura real del caso:');

check('el artículo usa stock por RECETA', () => {
  assert.strictEqual(art.stock?.stockType, 'receta');
});

check('la receta consume exactamente 5 unidades de VASITO DE PASTA', () => {
  assert.strictEqual(Number(art.stock.receta[MP]), 5);
});

check('activoMostrador quedó en true: nadie lo apagó (por eso seguía visible)', () => {
  assert.notStrictEqual(art.activoMostrador, false);
});

check('activoDelivery está en false: la automatización sí lo había apagado', () => {
  assert.strictEqual(art.activoDelivery, false);
});

check('el segundo ingrediente de la receta es cantidad 0 y no existe: se ignora', () => {
  const otros = Object.entries(art.stock.receta).filter(([id]) => id !== MP);
  for (const [id, qty] of otros) {
    assert.strictEqual(Number(qty), 0, `${id} tiene cantidad ${qty}`);
    assert.ok(!articulos[id] && !materiaPrimaReal[id], `${id} sí existe`);
  }
});

console.log('\nEstado ACTUAL de la base (VASITO DE PASTA en 0 y activo=false):');

check('con el dato real, queda OCULTO en Mostrador y en Delivery', () => {
  const r = canales(materiaPrimaReal);
  assert.strictEqual(r.mostrador, false, 'con el fix debe desaparecer de Mostrador');
  assert.strictEqual(r.delivery, false);
});

check('la venta de 1 unidad se bloquea, indicando qué falta y cuánto', () => {
  const r = evaluarStockDeCarrito({ items: [{ id: ART, quantity: 1 }], articulos, materiaPrima: materiaPrimaReal });
  assert.strictEqual(r.suficiente, false);
  const msg = mensajeDeBloqueo(r);
  assert.match(msg, /VASITO DE PASTA/);
  assert.match(msg, /se necesitan 5 y hay 0/);
  console.log(`      → "${msg}"`);
});

console.log('\nReposiciones simuladas sobre los datos reales (sin escribir nada):');

check('reponer 4 con el activo restaurado: SIGUE oculto (la receta pide 5)', () => {
  const r = canales(conMP({ stock: '4', activo: true, apagadoAutomaticoPorStock: null }));
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('reponer 5 con el activo restaurado: REAPARECE en Mostrador', () => {
  const r = canales(conMP({ stock: '5', activo: true, apagadoAutomaticoPorStock: null }));
  assert.strictEqual(r.mostrador, true, 'con la materia prima repuesta debe volver solo');

  // Delivery depende del activo MANUAL, que es un control aparte y que la base
  // puede tener en cualquiera de los dos estados según lo último que haya hecho
  // la automatización. Se comprueba la consecuencia, no un valor fijo: mientras
  // `activoDelivery` esté en false el artículo no se ofrece por delivery, y el
  // stock por sí solo no lo reactiva (eso lo hace la automatización, si el
  // apagado había sido automático).
  assert.strictEqual(r.delivery, art.activoDelivery !== false,
    'Delivery debe seguir exactamente el activo manual, ya que el stock alcanza');
  console.log(`      → activoDelivery=${art.activoDelivery}, apagadoAutomatico=${art.apagadoDeliveryAutomaticoPorMateriaPrima} ⇒ delivery=${r.delivery}`);
});

check('el mismo artículo con activoDelivery permitido SÍ vuelve en Delivery', () => {
  // Misma reposición, pero sobre un catálogo donde delivery no está apagado a
  // mano: comprueba que lo único que lo retenía era el activo manual.
  const catalogo = { ...articulos, [ART]: { ...art, activoDelivery: true } };
  const materiaPrima = conMP({ stock: '5', activo: true });
  assert.strictEqual(isArticleAvailable(ART, catalogo, materiaPrima, 'delivery'), true);
  assert.strictEqual(isArticleAvailable(ART, catalogo, conMP({ stock: '4', activo: true }), 'delivery'), false);
});

check('reponer 5 pero con el activo TODAVÍA apagado: sigue oculto en los DOS', () => {
  const r = canales(conMP({ stock: '5', activo: false }));
  assert.strictEqual(r.mostrador, false, 'Mostrador no puede adelantarse a Delivery');
  assert.strictEqual(r.delivery, false);
});

check('con 5 repuestos, la venta de 1 unidad pasa y la de 2 no', () => {
  const materiaPrima = conMP({ stock: '5', activo: true });
  assert.strictEqual(evaluarStockDeCarrito({ items: [{ id: ART, quantity: 1 }], articulos, materiaPrima }).suficiente, true);
  assert.strictEqual(evaluarStockDeCarrito({ items: [{ id: ART, quantity: 2 }], articulos, materiaPrima }).suficiente, false);
});

console.log('\nOtros artículos reales que dependen de la MISMA materia prima:');

// VASITO DE PASTA está en 0: NINGÚN artículo que la consuma puede prepararse,
// tenga o no `controlStock`. Éstos son "1 BOCHA" y "2 BOCHAS", que se venden
// solo por Mostrador y que hasta ahora seguían apareciendo porque el
// interruptor "no controla stock" cortaba la evaluación antes de la receta.
let dependientes = 0;
for (const [id, a] of Object.entries(articulos)) {
  const receta = a.stock?.receta;
  if (!receta || typeof receta !== 'object' || !receta[MP] || id === ART) continue;
  dependientes += 1;

  check(`${id} "${a.nombre}" (consume ${receta[MP]}, controlStock=${a.controlStock}) → OCULTO en Mostrador`, () => {
    assert.strictEqual(isArticleAvailable(id, articulos, materiaPrimaReal, 'counter'), false);

    // Y el bloqueo es por la RECETA, no por el activo de canal: incluso con los
    // dos canales habilitados a mano sigue oculto.
    const catalogo = { ...articulos, [id]: { ...a, activoDelivery: true, activoMostrador: true } };
    assert.strictEqual(isArticleAvailable(id, catalogo, materiaPrimaReal, 'counter'), false);
    assert.strictEqual(isArticleAvailable(id, catalogo, materiaPrimaReal, 'delivery'), false);

    // Con la materia prima repuesta vuelve, respetando la cantidad de su receta.
    const justo = conMP({ stock: String(receta[MP]), activo: true });
    assert.strictEqual(isArticleAvailable(id, catalogo, justo, 'counter'), true);
    const insuficiente = conMP({ stock: String(Number(receta[MP]) - 1), activo: true });
    if (Number(receta[MP]) >= 1) {
      assert.strictEqual(isArticleAvailable(id, catalogo, insuficiente, 'counter'), false);
    }
  });

  check(`${id} "${a.nombre}" → la venta también se bloquea`, () => {
    const r = evaluarStockDeCarrito({ items: [{ id, quantity: 1 }], articulos, materiaPrima: materiaPrimaReal });
    assert.strictEqual(r.suficiente, false);
    assert.ok(r.faltantes.some((f) => f.id === MP), JSON.stringify(r.faltantes));
  });
}

check('se encontraron los artículos dependientes esperados (1 BOCHA y 2 BOCHAS)', () => {
  assert.ok(dependientes >= 2, `esperaba al menos 2, encontré ${dependientes}`);
});

check('un artículo con receta que NO usa esa materia prima sigue visible', () => {
  // 27A "1 CUCURUCHO" usa CUCURUCHO DE OBLEA (7M), que tiene stock: no se toca.
  const otro = Object.entries(articulos).find(([id, a]) =>
    a.stock?.receta && !a.stock.receta[MP] && a.activoMostrador !== false && id !== ART);
  assert.ok(otro, 'no se encontró un artículo de control');
  assert.strictEqual(isArticleAvailable(otro[0], articulos, materiaPrimaReal, 'counter'), true,
    `${otro[0]} "${otro[1].nombre}" no debería haberse ocultado`);
});

console.log('\nCoherencia con el estado ya persistido por la automatización:');

check('el bloqueante calculado coincide con materiasPrimasBloqueantes guardado', () => {
  const calculado = materiasPrimasBloqueantes(ART, articulos, materiaPrimaReal);
  const guardado = Object.keys(art.materiasPrimasBloqueantes || {});
  assert.deepStrictEqual(calculado.sort(), guardado.sort());
});

check('ningún artículo del catálogo real tiene receta circular', () => {
  const circulares = Object.keys(articulos).filter((id) =>
    materiasPrimasBloqueantes(id, articulos, materiaPrimaReal).includes('__RECETA_CIRCULAR__'));
  assert.deepStrictEqual(circulares, []);
});

console.log(`\n${passed} verificaciones OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
