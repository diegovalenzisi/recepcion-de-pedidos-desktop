// Contrato de uso del módulo canónico de precios.
//
// Existe porque una vez se usó `obtenerPrecioOpcional(op).valor` en la interfaz:
// la función devuelve un NÚMERO, así que `.valor` era undefined y el adicional
// se mostraba como $0 sin que ninguna prueba de cálculo lo notara (el total
// estaba bien; lo que mentía era la pantalla).
//
// Corre en los tres repos. Verifica el contrato de retorno y revisa el código
// fuente para que nadie vuelva a tratar el número como si fuera un objeto.
//
// Correr con: node src/lib/api/__tests__/contratoPrecios.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  obtenerPrecioOpcional,
  tienePrecio,
  precioOpcionalInvalido,
  normalizarImporte,
  calcularSubtotalLinea,
  calcularTotalPedido,
  calcularTotalOpcionalesUnidad,
} from '../optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Todos los .js/.jsx del proyecto, sin node_modules ni artefactos de build. */
function archivosFuente(dir, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name === 'dist' || entrada.name === 'build') continue;
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) archivosFuente(p, acc);
    else if (/\.(js|jsx)$/.test(entrada.name)) acc.push(p);
  }
  return acc;
}

console.log('Contrato de retorno:');
check('obtenerPrecioOpcional devuelve un NÚMERO, no un objeto', () => {
  const r = obtenerPrecioOpcional({ nombre: 'Rocklets', precio: 1700 });
  assert.strictEqual(typeof r, 'number');
  assert.strictEqual(r, 1700);
  assert.strictEqual(r.valor, undefined, 'no es un objeto: tratarlo como tal daría undefined');
});
check('con precio inválido devuelve 0 (no NaN) y se marca aparte como inválido', () => {
  const op = { nombre: 'Roto', precio: 'abc' };
  assert.strictEqual(obtenerPrecioOpcional(op), 0);
  assert.ok(!Number.isNaN(obtenerPrecioOpcional(op)));
  assert.strictEqual(precioOpcionalInvalido(op), true);
  assert.strictEqual(tienePrecio(op), false);
});
check('gratuito: precio 0, no inválido, no se muestra importe', () => {
  const op = { nombre: 'Salsa', precio: 0 };
  assert.strictEqual(obtenerPrecioOpcional(op), 0);
  assert.strictEqual(tienePrecio(op), false);
  assert.strictEqual(precioOpcionalInvalido(op), false);
});
check('normalizarImporte SÍ devuelve objeto { valor, valido }', () => {
  const r = normalizarImporte('$ 1.700,00');
  assert.strictEqual(typeof r, 'object');
  assert.strictEqual(r.valor, 1700);
  assert.strictEqual(r.valido, true);
});
check('calcularSubtotalLinea devuelve objeto con .subtotal', () => {
  const r = calcularSubtotalLinea({ valor: 14500, quantity: 1, selectedOptionals: { g: [{ nombre: 'R', precio: 1700 }] } });
  assert.strictEqual(typeof r, 'object');
  assert.strictEqual(r.subtotal, 16200);
});
check('calcularTotalPedido devuelve objeto con .total', () => {
  const r = calcularTotalPedido([{ valor: 14500, quantity: 1 }]);
  assert.strictEqual(typeof r, 'object');
  assert.strictEqual(r.total, 14500);
});
check('calcularTotalOpcionalesUnidad devuelve un NÚMERO', () => {
  const r = calcularTotalOpcionalesUnidad({ g: [{ nombre: 'R', precio: 1700 }] });
  assert.strictEqual(typeof r, 'number');
  assert.strictEqual(r, 1700);
});

console.log('\nUso correcto en todo el código fuente:');
const fuentes = archivosFuente(SRC).filter((p) => !p.includes('__tests__'));
check(`ningún archivo usa obtenerPrecioOpcional(...).valor (${fuentes.length} revisados)`, () => {
  const malos = [];
  for (const f of fuentes) {
    const src = fs.readFileSync(f, 'utf8');
    if (/obtenerPrecioOpcional\([^)]*\)\s*\.\s*valor/.test(src)) malos.push(path.relative(SRC, f));
  }
  assert.strictEqual(malos.length, 0, `devuelve un número, no un objeto: ${malos.join(', ')}`);
});
check('ningún archivo usa calcularTotalOpcionalesUnidad(...).total', () => {
  const malos = [];
  for (const f of fuentes) {
    const src = fs.readFileSync(f, 'utf8');
    if (/calcularTotalOpcionalesUnidad\([^)]*\)\s*\.\s*total/.test(src)) malos.push(path.relative(SRC, f));
  }
  assert.strictEqual(malos.length, 0, malos.join(', '));
});
check('donde se usa .subtotal / .total, es sobre la función que sí devuelve objeto', () => {
  const malos = [];
  for (const f of fuentes) {
    const src = fs.readFileSync(f, 'utf8');
    if (/calcularSubtotalLinea\([^)]*\)\s*(?!\s*\.\s*(subtotal|fuente))\s*[*+\-/]/.test(src)) {
      malos.push(path.relative(SRC, f));
    }
  }
  assert.strictEqual(malos.length, 0, `usan el objeto como número: ${malos.join(', ')}`);
});

console.log('\nImporte que se muestra = importe que se cobra:');
check('la etiqueta del selector coincide con lo que suma el total', () => {
  const op = { nombre: 'Rocklets', precio: 1700 };
  const mostrado = obtenerPrecioOpcional(op);                       // lo que ve el cliente
  const cobrado = calcularTotalPedido([{ valor: 14500, quantity: 1, selectedOptionals: { g: [op] } }]).total - 14500;
  assert.strictEqual(mostrado, cobrado, 'la pantalla no puede decir un importe y cobrar otro');
  assert.strictEqual(mostrado, 1700);
});
check('con cantidad 2 del opcional, lo mostrado por unidad × cantidad = lo cobrado', () => {
  const op = { nombre: 'Rocklets', precio: 1700, cantidad: 2 };
  const mostrado = obtenerPrecioOpcional(op) * 2;
  const cobrado = calcularTotalPedido([{ valor: 14500, quantity: 1, selectedOptionals: { g: [op] } }]).total - 14500;
  assert.strictEqual(mostrado, cobrado);
  assert.strictEqual(mostrado, 3400);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
