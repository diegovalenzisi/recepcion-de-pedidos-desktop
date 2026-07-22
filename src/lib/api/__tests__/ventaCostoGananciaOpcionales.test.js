// F1.4 / condición 10: venta, costo y ganancia con opcionales pagos.
// Correr con: node src/lib/api/__tests__/ventaCostoGananciaOpcionales.test.js
import assert from 'node:assert';
import { calcularVentaCostoGanancia } from '../ventaUtils.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const KILO = { nombre: '1 KILO DE HELADO', valor: 14500, costoTotalReceta: 6000, quantity: 1 };

console.log('Venta / costo / ganancia con opcionales:');
check('sin opcionales: venta 14.500, costo 6.000, ganancia 8.500', () => {
  const r = calcularVentaCostoGanancia([{ ...KILO }]);
  assert.strictEqual(r.totalVenta, 14500);
  assert.strictEqual(r.totalCosto, 6000);
  assert.strictEqual(r.ganancia, 8500);
});

check('Rocklets $1.700 SUMA a la venta (antes quedaba afuera)', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Rocklets', precio: 1700 }] } },
  ]);
  assert.strictEqual(r.totalVenta, 16200);
});

check('opcional MANUAL sin costo configurado NO aporta costo (no usa su precio de venta)', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Rocklets', precio: 1700 }] } },
  ]);
  assert.strictEqual(r.totalCosto, 6000);            // costo del kilo únicamente
  assert.strictEqual(r.ganancia, 16200 - 6000);
});

check('opcional con artículo real usa su COSTO real, no su precio de venta', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Rocklets', precio: 1700, articleId: 'art-rock', costoUnitario: 400 }] } },
  ]);
  assert.strictEqual(r.totalVenta, 16200);
  assert.strictEqual(r.totalCosto, 6400);            // 6000 + 400 (costo real, NO 1700)
  assert.strictEqual(r.ganancia, 9800);
});

check('opcional gratuito no altera venta ni costo', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Salsa', precio: 0 }] } },
  ]);
  assert.strictEqual(r.totalVenta, 14500);
  assert.strictEqual(r.totalCosto, 6000);
});

check('2 unidades como 2 líneas: venta 30.700 con Rocklets solo en la unidad 1', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Rocklets', precio: 1700 }] } },
    { ...KILO },
  ]);
  assert.strictEqual(r.totalVenta, 30700);
  assert.strictEqual(r.totalCosto, 12000);
});

check('cantidad de opcional > 1 multiplica venta y costo real', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Rocklets', precio: 1700, quantity: 2, articleId: 'a', costoUnitario: 400 }] } },
  ]);
  assert.strictEqual(r.totalVenta, 14500 + 3400);
  assert.strictEqual(r.totalCosto, 6000 + 800);
});

check('precio inválido de opcional no genera NaN en venta/costo', () => {
  const r = calcularVentaCostoGanancia([
    { ...KILO, selectedOptionals: { g1: [{ nombre: 'Roto', precio: 'abc' }] } },
  ]);
  assert.ok(!Number.isNaN(r.totalVenta));
  assert.ok(!Number.isNaN(r.totalCosto));
  assert.strictEqual(r.totalVenta, 14500);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
