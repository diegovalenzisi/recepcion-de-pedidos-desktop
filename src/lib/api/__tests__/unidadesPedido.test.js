// F1.5 — punto 4: selección independiente por unidad.
// Prueba el módulo REAL que usan NewOrderModal de Desktop y de Tablet.
//
// Correr con: node src/lib/api/__tests__/unidadesPedido.test.js
import assert from 'node:assert';
import {
  esLineaConfigurable,
  renumerarUnidades,
  quitarUnidad,
  contarUnidadesConfiguradas,
  baseParaUnidadNueva,
  agregarUnidadConfigurada,
} from '../unidadesPedido.js';
import { calcularTotalPedido } from '../optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const KILO = { id: 'A1', nombre: '1 KILO DE HELADO', valor: 14500 };
const AGUA = { id: 'A2', nombre: 'AGUA', valor: 1200 };
const ROCKLETS = { nombre: 'Rocklets', precio: 1700, grupoNombre: 'TOPPING' };
const conTop = { ...KILO, selectedOptionals: { t: [ROCKLETS] } };
const sinTop = { ...KILO, selectedOptionals: { s: [{ nombre: 'Frutilla', precio: 0 }] } };

console.log('Alta de unidades:');
check('cada unidad entra con quantity 1 y su propio uniqueId', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  assert.strictEqual(items.length, 2);
  assert.deepStrictEqual(items.map((i) => i.quantity), [1, 1]);
  assert.deepStrictEqual(items.map((i) => i.uniqueId), ['u1', 'u2']);
});
check('se numeran "Unidad 1 de 2" y "Unidad 2 de 2"', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  assert.deepStrictEqual(items.map((i) => `${i.unidadIndice}/${i.unidadTotal}`), ['1/2', '2/2']);
});
check('cada unidad conserva SU selección (no se copia la anterior)', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  assert.ok(items[0].selectedOptionals.t, 'la unidad 1 tiene el topping');
  assert.ok(!items[1].selectedOptionals.t, 'la unidad 2 NO debe heredarlo');
});
check('el total refleja las dos configuraciones: 30.700', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  assert.strictEqual(calcularTotalPedido(items).total, 30700);
});
check('Rocklets en las dos unidades: 32.400', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, conTop, 'u2');
  assert.strictEqual(calcularTotalPedido(items).total, 32400);
});
check('una sola unidad NO muestra "Unidad 1 de 1" en el resumen', () => {
  const items = agregarUnidadConfigurada([], conTop, 'u1');
  assert.strictEqual(items[0].unidadTotal, 1, 'la marca existe pero el resumen la oculta si es 1');
});

console.log('\nBase para configurar una unidad nueva:');
check('no arrastra selección, uniqueId ni importes de otra unidad', () => {
  const previa = { ...conTop, uniqueId: 'u1', quantity: 1, unidadIndice: 1, unidadTotal: 1, subtotalLinea: 16200, precioBaseUnitario: 14500, totalOpcionales: 1700 };
  const base = baseParaUnidadNueva(previa);
  for (const campo of ['selectedOptionals', 'uniqueId', 'quantity', 'unidadIndice', 'unidadTotal', 'subtotalLinea', 'precioBaseUnitario', 'totalOpcionales']) {
    assert.strictEqual(base[campo], undefined, `no debe arrastrar ${campo}`);
  }
  assert.strictEqual(base.nombre, '1 KILO DE HELADO');
  assert.strictEqual(base.valor, 14500);
});
check('cancelar la configuración no agrega nada (nunca se llamó a agregar)', () => {
  const antes = agregarUnidadConfigurada([], conTop, 'u1');
  const copia = JSON.stringify(antes);
  baseParaUnidadNueva(antes[0]); // se abrió el selector y se canceló
  assert.strictEqual(JSON.stringify(antes), copia, 'el carrito queda intacto');
  assert.strictEqual(antes.length, 1);
});
check('cuenta las unidades ya configuradas del artículo correcto', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  items = agregarUnidadConfigurada(items, { ...AGUA, selectedOptionals: {} }, 'u3');
  assert.strictEqual(contarUnidadesConfiguradas(items, 'A1'), 2);
  assert.strictEqual(contarUnidadesConfiguradas(items, 'A2'), 1);
  assert.strictEqual(contarUnidadesConfiguradas(items, 'ZZZ'), 0);
});

console.log('\nBaja de unidades:');
check('quitar la unidad 1 deja intacta la 2 (con su uniqueId y su selección)', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  const r = quitarUnidad(items, 'u1');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].uniqueId, 'u2', 'debe quedar EXACTAMENTE la que no se quitó');
  assert.ok(r[0].selectedOptionals.s, 'su selección no cambia');
  assert.strictEqual(calcularTotalPedido(r).total, 14500);
});
check('quitar la unidad del medio conserva los uniqueId restantes', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  items = agregarUnidadConfigurada(items, conTop, 'u3');
  const r = quitarUnidad(items, 'u2');
  assert.deepStrictEqual(r.map((i) => i.uniqueId), ['u1', 'u3']);
});
check('al quitar se renumera SOLO la presentación', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = agregarUnidadConfigurada(items, sinTop, 'u2');
  items = agregarUnidadConfigurada(items, conTop, 'u3');
  const r = quitarUnidad(items, 'u1');
  assert.deepStrictEqual(r.map((i) => `${i.unidadIndice}/${i.unidadTotal}`), ['1/2', '2/2']);
  assert.deepStrictEqual(r.map((i) => i.uniqueId), ['u2', 'u3'], 'los uniqueId NO se renumeran');
});
check('quitar un uniqueId inexistente no altera el carrito', () => {
  const items = agregarUnidadConfigurada([], conTop, 'u1');
  assert.strictEqual(quitarUnidad(items, 'nope').length, 1);
});

console.log('\nArtículos SIN opcionales (comportamiento de siempre):');
check('no se marcan como configurables ni se les pone unidad', () => {
  const items = renumerarUnidades([{ ...AGUA, quantity: 3, uniqueId: 'A2' }]);
  assert.strictEqual(esLineaConfigurable(items[0]), false);
  assert.strictEqual(items[0].unidadIndice, undefined);
  assert.strictEqual(items[0].quantity, 3, 'siguen agrupándose por cantidad');
});
check('conviven con líneas configurables sin interferir', () => {
  let items = agregarUnidadConfigurada([], conTop, 'u1');
  items = renumerarUnidades([...items, { ...AGUA, quantity: 2, uniqueId: 'A2' }]);
  assert.strictEqual(items[1].unidadTotal, undefined);
  assert.strictEqual(calcularTotalPedido(items).total, 16200 + 2400);
});

console.log('\nRobustez:');
check('entradas basura no rompen', () => {
  assert.deepStrictEqual(renumerarUnidades(null), []);
  assert.deepStrictEqual(quitarUnidad(undefined, 'x'), []);
  assert.strictEqual(contarUnidadesConfiguradas(null, 'A1'), 0);
  assert.strictEqual(esLineaConfigurable(null), false);
});
check('renumerar no muta la lista original', () => {
  const items = [{ ...conTop, uniqueId: 'u1' }];
  const copia = JSON.stringify(items);
  renumerarUnidades(items);
  assert.strictEqual(JSON.stringify(items), copia);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
