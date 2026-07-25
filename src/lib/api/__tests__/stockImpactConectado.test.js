// Fase 2 — punto 10: los opcionales entran en el camino REAL de stock.
//
// Verifica el cableado de transactionsApi (que no se puede importar en node
// porque arrastra Firebase) y el comportamiento del plan que ahora usa.
//
// Correr con: node src/lib/api/__tests__/stockImpactConectado.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirPlanDeStock } from '../stockPlan.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(API, 'transactionsApi.js'), 'utf8');

console.log('Cableado en transactionsApi:');
check('importa el plan de stock compartido', () => {
  assert.ok(/import\s*\{[^}]*construirPlanDeStock[^}]*\}\s*from\s*['"]\.\/stockPlan['"]/.test(src));
});
check('lo INVOCA dentro de processStockUpdate', () => {
  const i = src.indexOf('const processStockUpdate');
  assert.ok(i !== -1, 'no se encontró processStockUpdate');
  const cuerpo = src.slice(i, src.indexOf('\nexport const processStockForDeliveredOrder'));
  assert.ok(cuerpo.includes('construirPlanDeStock('), 'el motor no usa el plan');
});
check('ya NO arma el impactMap con el bucle viejo (que ignoraba opcionales)', () => {
  const i = src.indexOf('const processStockUpdate');
  const cuerpo = src.slice(i, src.indexOf('\nexport const processStockForDeliveredOrder'));
  assert.ok(!/items\.forEach\(item\s*=>\s*\{[\s\S]*resolveStockImpact\(/.test(cuerpo),
    'volvió el bucle que solo resolvía base y promo');
});
check('sigue habiendo UNA sola operación de stock (un solo referenceId)', () => {
  // Las definiciones son `const X = async (...)`, así que estas cuentas son
  // invocaciones: exactamente una toma de lock y una marca de completado.
  assert.strictEqual((src.match(/await acquireTransactionLock\(/g) || []).length, 1);
  assert.strictEqual((src.match(/await markTransactionAsCompleted\(/g) || []).length, 1);
  assert.strictEqual((src.match(/const processStockUpdate\s*=/g) || []).length, 1, 'un solo motor de descuento');
});
check('los momentos de descuento no cambiaron', () => {
  assert.ok(src.includes("referenceId = order.id ? `DELIVERY_${order.id}`"), 'Delivery por pedido');
  assert.ok(src.includes("referenceId = sale.id ? `MOSTRADOR_${sale.id}`"), 'Mostrador por venta');
  assert.ok(src.includes('processStockForDeliveredOrder'));
  assert.ok(src.includes('processStockForCounterSale'));
});
check('deja aviso cuando se usa el fallback por nombre', () => {
  assert.ok(/fallback-por-nombre/.test(src), 'el uso del camino legado debe quedar registrado');
});

console.log('\nComportamiento del plan en el pedido real:');
const ARTICULOS = {
  'A-0007': { nombre: '1 KILO DE HELADO', stock: { stockType: 'propio', propio: 50 } },
  'A-ROCKLETS': { nombre: 'Rocklets', stock: { stockType: 'propio', propio: 20 } },
  'A-KILO-RECETA': { nombre: 'Kilo receta', stock: { stockType: 'receta', receta: { 'M-3': 0.25 } } },
  'A-TOP-RECETA': { nombre: 'Topping receta', stock: { stockType: 'receta', receta: { 'M-3': 0.25 } } },
};
const MP = { 'M-3': { nombre: 'Azúcar', stock: 100 } };
const plan = (items) => construirPlanDeStock({ items, articulos: ARTICULOS, materiaPrima: MP });

const topping = (over = {}) => ({
  nombre: 'Rocklets', articleId: 'A-ROCKLETS',
  controlaStock: true, consumoStockUnitario: 1, cantidad: 1, ...over,
});
const unidad = (ops, i, t) => ({
  id: 'A-0007', codigo: 'A-0007', nombre: '1 KILO DE HELADO', quantity: 1,
  unidadIndice: i, unidadTotal: t, ...(ops ? { selectedOptionals: { 'G-TOP': ops } } : {}),
});

check('CASO 1 — una unidad con Rocklets: base 1 y topping 1', () => {
  const { impactMap } = plan([unidad([topping()], 1, 1)]);
  assert.strictEqual(impactMap['A-0007'].quantity, 1);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1);
});
check('CASO 2 — dos unidades con Rocklets: impacto AGRUPADO en 2', () => {
  const { impactMap } = plan([unidad([topping()], 1, 2), unidad([topping()], 2, 2)]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 2, 'una sola entrada, no dos');
  assert.strictEqual(impactMap['A-0007'].quantity, 2);
  assert.strictEqual(Object.keys(impactMap).length, 2);
});
check('CASO 3 — Rocklets solo en una unidad: consumo 1', () => {
  const { impactMap } = plan([unidad([topping()], 1, 2), unidad(null, 2, 2)]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1);
  assert.strictEqual(impactMap['A-0007'].quantity, 2);
});
check('CASO 4 — opcional gratuito basado en artículo igual descuenta', () => {
  const { impactMap } = plan([unidad([topping({ precioUnitario: 0, total: 0 })], 1, 1)]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1);
});
check('opcional manual sin articleId NO mueve stock', () => {
  const { impactMap } = plan([unidad([{ nombre: 'Rocklets', precio: 1700 }], 1, 1)]);
  assert.ok(!impactMap['A-ROCKLETS']);
  assert.strictEqual(impactMap['A-0007'].quantity, 1);
});
check('CASO 7 — base y topping por receta caen en la MISMA ruta física', () => {
  const { impactMap, porRuta } = plan([{
    id: 'A-KILO-RECETA', quantity: 1,
    selectedOptionals: { 'G-TOP': [topping({ articleId: 'A-TOP-RECETA' })] },
  }]);
  assert.strictEqual(impactMap['M-3'].quantity, 0.5, 'una sola entrada con la suma');
  assert.strictEqual(porRuta['MATERIA_PRIMA/M-3'].origenes.length, 2);
});
check('promoción: cada hijo aporta su propio impacto y sus opcionales', () => {
  const { impactMap } = plan([{
    id: 'A-PROMO', quantity: 1, isPromo: true,
    promoItems: [
      { id: 'A-0007', cantidad: 1, selectedOptionals: { 'G-TOP': [topping()] } },
      { id: 'A-0007', cantidad: 1 },
    ],
  }]);
  assert.strictEqual(impactMap['A-0007'].quantity, 2, 'los dos hijos');
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1, 'el topping de un solo hijo');
});
check('el consumo configurado en 2 se respeta', () => {
  const { impactMap } = plan([unidad([topping({ consumoStockUnitario: 2 })], 1, 1)]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 2);
});
check('un pedido sin opcionales produce el mismo impacto que antes', () => {
  const { impactMap } = plan([{ id: 'A-0007', quantity: 3 }]);
  assert.deepStrictEqual(impactMap, { 'A-0007': { quantity: 3, type: 'ARTICULO' } });
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
