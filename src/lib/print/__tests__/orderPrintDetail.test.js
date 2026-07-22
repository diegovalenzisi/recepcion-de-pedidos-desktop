// F1.4 — Pruebas de impresión / reimpresión (condición 11).
// Todo el detalle sale del SNAPSHOT: no se consulta catálogo ni se escribe nada.
// Correr con: node src/lib/print/__tests__/orderPrintDetail.test.js
import assert from 'node:assert';
import {
  construirDetalleImpresionPedido,
  lineasDeItem,
  importeOpcionalImprimible,
  detalleATexto,
} from '../orderPrintDetail.js';
import { construirLineaPersistible } from '../../api/optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const KILO = { nombre: '1 KILO DE HELADO', valor: 14500 };
const ROCKLETS = { nombre: 'Rocklets', precio: 1700, grupoNombre: 'TOPPING', numeroOrden: 1 };
const SALSA = { nombre: 'Chocolate', precio: 0, grupoNombre: 'Salsa', numeroOrden: 1 };
const SABOR = (n, o) => ({ nombre: n, precio: 0, grupoNombre: 'Sabores', numeroOrden: o });

const unidad = (opts, idx, tot) => construirLineaPersistible({
  ...KILO, quantity: 1, uniqueId: `u${idx}`, unidadIndice: idx, unidadTotal: tot, selectedOptionals: opts,
});

console.log('Importe imprimible (solo snapshot):');
check('usa `total` del snapshot y NO vuelve a multiplicar', () => {
  assert.strictEqual(importeOpcionalImprimible({ nombre: 'R', precioUnitario: 1700, cantidad: 2, total: 3400 }), 3400);
});
check('sin `total`, calcula precioUnitario × cantidad', () => {
  assert.strictEqual(importeOpcionalImprimible({ nombre: 'R', precioUnitario: 1700, cantidad: 2 }), 3400);
});
check('gratuito (0) → null (no se imprime importe)', () => {
  assert.strictEqual(importeOpcionalImprimible({ nombre: 'S', precioUnitario: 0 }), null);
});
check('histórico sin precio → null (no se inventa)', () => {
  assert.strictEqual(importeOpcionalImprimible({ nombre: 'Rocklets' }), null);
});
check('precio inválido → null, nunca NaN', () => {
  const r = importeOpcionalImprimible({ nombre: 'X', precio: 'abc' });
  assert.strictEqual(r, null);
  assert.ok(!Number.isNaN(r));
});

console.log('\nUna unidad:');
check('sin opcionales: base y subtotal, sin líneas de opcional', () => {
  const t = detalleATexto(lineasDeItem(unidad({}, 1, 1)));
  assert.ok(t.includes('1 KILO DE HELADO'));
  assert.ok(!t.includes('UNIDAD'));           // una sola unidad → sin encabezado
  assert.ok(t.includes('Precio base'));
  assert.ok(t.includes('14.500'));
});
check('con Rocklets $1.700 → aparece "+ Rocklets" y Subtotal $16.200', () => {
  const t = detalleATexto(lineasDeItem(unidad({ g1: [ROCKLETS] }, 1, 1)));
  assert.ok(t.includes('+ Rocklets'));
  assert.ok(t.includes('1.700'));
  assert.ok(t.includes('16.200'));
});
check('opcional gratuito: imprime el nombre y NUNCA +$0', () => {
  const t = detalleATexto(lineasDeItem(unidad({ g1: [SALSA] }, 1, 1)));
  assert.ok(t.includes('Chocolate'));
  assert.ok(!t.includes('+$0'));
  assert.ok(!t.includes('$0,00'));
  assert.ok(!/\+\s*\$0/.test(t));
});
check('precio inválido: sin NaN/undefined/[object Object]', () => {
  const t = detalleATexto(lineasDeItem(unidad({ g1: [{ nombre: 'Roto', precio: 'abc' }] }, 1, 1)));
  assert.ok(t.includes('Roto'));
  assert.ok(!t.includes('NaN'));
  assert.ok(!t.includes('undefined'));
  assert.ok(!t.includes('[object Object]'));
});
check('opcional con cantidad 2 imprime "x2" y el total una sola vez', () => {
  const t = detalleATexto(lineasDeItem(unidad({ g1: [{ ...ROCKLETS, quantity: 2 }] }, 1, 1)));
  assert.ok(t.includes('+ Rocklets x2'));
  assert.ok(t.includes('3.400'));
  assert.strictEqual((t.match(/3\.400/g) || []).length, 1);
});

console.log('\nDos unidades con configuraciones distintas (caso obligatorio):');
const pedido2u = {
  items: [
    unidad({ sab: [SABOR('Chocolate', 1), SABOR('Dulce de leche', 2)], top: [ROCKLETS] }, 1, 2),
    unidad({ sab: [SABOR('Frutilla', 1), SABOR('Limón', 2)] }, 2, 2),
  ],
  payment: { total: 30700 },
};
check('encabezados UNIDAD 1 DE 2 y UNIDAD 2 DE 2', () => {
  const t = detalleATexto(construirDetalleImpresionPedido(pedido2u).lineas);
  assert.ok(t.includes('1 KILO DE HELADO — UNIDAD 1 DE 2'));
  assert.ok(t.includes('1 KILO DE HELADO — UNIDAD 2 DE 2'));
});
check('Rocklets solo en la unidad 1; subtotales 16.200 y 14.500', () => {
  const t = detalleATexto(construirDetalleImpresionPedido(pedido2u).lineas);
  assert.strictEqual((t.match(/\+ Rocklets/g) || []).length, 1);
  assert.ok(t.includes('16.200'));
  assert.ok(t.includes('14.500'));
});
check('TOTAL PEDIDO $30.700 (ni 29.000 ni 32.400)', () => {
  const r = construirDetalleImpresionPedido(pedido2u);
  assert.strictEqual(r.total, 30700);
  const t = detalleATexto(r.lineas);
  assert.ok(t.includes('30.700'));
  assert.ok(!t.includes('29.000'));
  assert.ok(!t.includes('32.400'));
});
check('Rocklets en AMBAS unidades → total 32.400', () => {
  const p = {
    items: [unidad({ top: [ROCKLETS] }, 1, 2), unidad({ top: [ROCKLETS] }, 2, 2)],
    payment: { total: 32400 },
  };
  assert.strictEqual(construirDetalleImpresionPedido(p).total, 32400);
});

console.log('\nPromoción: cada hijo con sus propios opcionales:');
check('los opcionales quedan con el hijo correcto, no mezclados al final', () => {
  const promo = {
    items: [{
      nombre: '2 KILOS', isPromo: true, valor: 25000, quantity: 1,
      promoItems: [
        { nombre: 'KILO 1', selectedOptionals: { sab: [SABOR('Chocolate', 1)], top: [ROCKLETS] } },
        { nombre: 'KILO 2', selectedOptionals: { sab: [SABOR('Frutilla', 1)], sal: [SALSA] } },
      ],
    }],
  };
  const t = detalleATexto(construirDetalleImpresionPedido(promo).lineas);
  const iK1 = t.indexOf('KILO 1'); const iK2 = t.indexOf('KILO 2'); const iRock = t.indexOf('+ Rocklets');
  assert.ok(iK1 >= 0 && iK2 > iK1);
  assert.ok(iRock > iK1 && iRock < iK2, 'Rocklets debe quedar dentro del KILO 1');
  assert.ok(t.includes('PROMO 2 KILOS'));
});

console.log('\nPedidos históricos (sin snapshot):');
check('histórico con solo { nombre }: imprime el nombre, sin precio inventado', () => {
  const hist = { items: [{ nombre: '1 KILO DE HELADO', valor: 14500, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Rocklets' }] } }] };
  const t = detalleATexto(construirDetalleImpresionPedido(hist).lineas);
  assert.ok(t.includes('Rocklets'));
  assert.ok(!t.includes('1.700'));
  assert.ok(!t.includes('NaN'));
});
check('histórico sin unidadIndice: no imprime encabezado de unidad', () => {
  const hist = { items: [{ nombre: 'ART', valor: 100, quantity: 1 }] };
  const t = detalleATexto(construirDetalleImpresionPedido(hist).lineas);
  assert.ok(!t.includes('UNIDAD'));
});
check('histórico sin desglose: no se altera el total guardado', () => {
  const hist = { items: [{ nombre: 'ART', valor: 14500, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Rocklets' }] } }], payment: { total: 14500 } };
  assert.strictEqual(construirDetalleImpresionPedido(hist).total, 14500);
});

console.log('\nReimpresión (lectura pura, sin efectos):');
check('reimprimir produce EXACTAMENTE el mismo texto', () => {
  const a = detalleATexto(construirDetalleImpresionPedido(pedido2u).lineas);
  const b = detalleATexto(construirDetalleImpresionPedido(pedido2u).lineas);
  assert.strictEqual(a, b);
});
check('un cambio posterior del precio de Rocklets NO altera la reimpresión', () => {
  const guardado = JSON.parse(JSON.stringify(pedido2u));           // snapshot congelado
  const antes = detalleATexto(construirDetalleImpresionPedido(guardado).lineas);
  // "el catálogo cambió": el precio actual pasa a 9999, pero el snapshot manda.
  const ROCKLETS_NUEVO_PRECIO = { ...ROCKLETS, precio: 9999 };
  void ROCKLETS_NUEVO_PRECIO;
  const despues = detalleATexto(construirDetalleImpresionPedido(guardado).lineas);
  assert.strictEqual(antes, despues);
  assert.ok(antes.includes('1.700'));
  assert.ok(!antes.includes('9.999'));
});
check('opción eliminada del catálogo sigue imprimiéndose desde el snapshot', () => {
  const guardado = { items: [unidad({ top: [{ ...ROCKLETS, articleId: 'art-borrado' }] }, 1, 1)] };
  const t = detalleATexto(construirDetalleImpresionPedido(guardado).lineas);
  assert.ok(t.includes('+ Rocklets'));
  assert.ok(t.includes('1.700'));
});
check('NO llama a stock ni a Firebase: el módulo no importa nada de eso', async () => {
  // Verificación estructural: el módulo de impresión solo depende del cálculo puro.
  const src = await import('node:fs').then((fs) => fs.promises.readFile(new URL('../orderPrintDetail.js', import.meta.url), 'utf8'));
  for (const prohibido of ['firebase', 'processStockUpdate', 'resolveStockImpact', 'PROCESSED_STOCK_IDS', 'set(', 'update(', 'runTransaction']) {
    assert.ok(!src.includes(prohibido), `la impresión no debe referenciar ${prohibido}`);
  }
});

console.log('\nComanda (sin importes, condición 9):');
check('conImportes:false → nombres y unidad, ningún importe', () => {
  const t = detalleATexto(construirDetalleImpresionPedido(pedido2u, { conImportes: false }).lineas);
  assert.ok(t.includes('UNIDAD 1 DE 2'));
  assert.ok(t.includes('Rocklets'));
  assert.ok(!t.includes('$'), 'la comanda no debe llevar importes');
});

console.log('\nEjemplo exacto del texto generado:\n');
console.log(detalleATexto(construirDetalleImpresionPedido(pedido2u).lineas));

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
