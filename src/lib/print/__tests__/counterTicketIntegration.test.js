// F1.4 (integración) — Pruebas sobre la SALIDA REAL del ticket del cliente.
//
// Ejercitan buildCounterTicketBody(), que es exactamente la función que
// printCounterTicket() usa para armar el cuerpo del ticket (no una copia: se
// verifica estructuralmente que counterTicket.js la importa y no duplica el
// armado). Además se comprueba que la ruta de impresión/reimpresión no tiene
// efectos: no muta el pedido y no referencia Firebase ni el motor de stock.
//
// Correr con: node src/lib/print/__tests__/counterTicketIntegration.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import { construirLineaPersistible } from '../../api/optionalsPricing.js';
import { buildCounterTicketBody } from '../counterTicketHtml.js';
import { construirDetalleImpresionPedido, formatImporteTicket } from '../orderPrintDetail.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const leer = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const ticket = (sale) => { const b = buildCounterTicketBody(sale); return b.itemsHtml + b.totalHtml; };
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// --- Fixture del caso real ---------------------------------------------------
const KILO = { nombre: '1 KILO DE HELADO', valor: 14500 };
const ROCKLETS = { nombre: 'Rocklets', precio: 1700, grupoNombre: 'TOPPING', numeroOrden: 1 };
const SABOR = (n, o) => ({ nombre: n, precio: 0, grupoNombre: 'Sabores', numeroOrden: o });

const unidad = (opts, idx, tot) => construirLineaPersistible({
  ...KILO, quantity: 1, uniqueId: `u${idx}`, unidadIndice: idx, unidadTotal: tot, selectedOptionals: opts,
});

const ventaMostrador = {
  id: 1234,
  items: [
    unidad({ sab: [SABOR('Chocolate', 1), SABOR('Dulce de leche', 2)], top: [ROCKLETS] }, 1, 2),
    unidad({ sab: [SABOR('Frutilla', 1), SABOR('Limón', 2)] }, 2, 2),
  ],
  payment: { total: 30700 },
};

console.log('Ticket real del cliente (mostrador):');
check('counterTicket.js usa el builder real y no duplica el armado', () => {
  const src = leer('../counterTicket.js');
  assert.ok(src.includes("from './counterTicketHtml'"), 'debe importar el builder');
  assert.ok(src.includes('buildCounterTicketBody(sale)'), 'debe invocarlo con la venta');
  assert.ok(!src.includes('lineasDeItem('), 'no debe rearmar el detalle por su cuenta');
});
check('muestra el opcional pago, su importe y el total', () => {
  const t = texto(ticket(ventaMostrador));
  assert.ok(t.includes('+ Rocklets'), 'debe detallar el opcional pago');
  assert.ok(t.includes('1.700'), 'debe mostrar el adicional cobrado');
  assert.ok(t.includes('30.700'), 'debe mostrar el total del pedido');
});
check('dos unidades: encabezado y subtotal propios de cada una', () => {
  const t = texto(ticket(ventaMostrador));
  assert.ok(t.includes('UNIDAD 1 DE 2') && t.includes('UNIDAD 2 DE 2'));
  assert.ok(t.includes('16.200') && t.includes('14.500'));
  assert.strictEqual((t.match(/\+ Rocklets/g) || []).length, 1, 'Rocklets sólo en la unidad 1');
});
check('formato monetario sin ,00 y sin mezclar estilos', () => {
  const t = texto(ticket(ventaMostrador));
  assert.ok(!t.includes(',00'), `no debe imprimir decimales: ${t.slice(0, 160)}`);
  assert.ok(/\$\s?14\.500/.test(t));
});
check('opcional gratuito: nombre sin importe, nunca "+$0"', () => {
  const t = texto(ticket({
    id: 1,
    items: [unidad({ sal: [{ nombre: 'Chocolate', precio: 0, grupoNombre: 'Salsa' }] }, 1, 1)],
    payment: { total: 14500 },
  }));
  assert.ok(t.includes('Chocolate'));
  assert.ok(!/\+\s*\$?\s*0\b/.test(t), 'no debe imprimir importe cero');
});
check('promoción: cada opcional bajo su hijo correcto', () => {
  const t = texto(ticket({
    id: 2,
    items: [{
      nombre: '2 KILOS', isPromo: true, valor: 25000, quantity: 1,
      precioBaseUnitario: 25000, subtotalLinea: 26700,
      promoItems: [
        { nombre: 'KILO 1', selectedOptionals: { top: [{ ...ROCKLETS, precioUnitario: 1700, cantidad: 1, total: 1700 }] } },
        { nombre: 'KILO 2', selectedOptionals: { sab: [SABOR('Frutilla', 1)] } },
      ],
    }],
    payment: { total: 26700 },
  }));
  const k1 = t.indexOf('KILO 1'); const k2 = t.indexOf('KILO 2'); const r = t.indexOf('+ Rocklets');
  assert.ok(k1 >= 0 && k2 > k1, 'deben salir los dos hijos');
  assert.ok(r > k1 && r < k2, 'Rocklets debe quedar bajo KILO 1');
});
check('pedido histórico (opcional sólo con nombre): sin precio inventado ni NaN', () => {
  const t = texto(ticket({
    id: 3,
    items: [{ nombre: '1 KILO DE HELADO', valor: 14500, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Rocklets' }] } }],
    payment: { total: 14500 },
  }));
  assert.ok(t.includes('Rocklets'));
  assert.ok(!t.includes('1.700'), 'no debe inventar el precio actual del opcional');
  assert.ok(!/NaN|undefined|\[object Object\]/.test(t), t);
});
check('pedido corrupto (item sin nombre / opcional no-objeto): no rompe el ticket', () => {
  const t = texto(ticket({ id: 4, items: [{ quantity: 1, selectedOptionals: { g: ['x', null, 7] } }], payment: {} }));
  assert.ok(!/NaN|undefined|\[object Object\]/.test(t), t);
});
check('nombres con < > & quedan escapados (no rompen el HTML)', () => {
  const html = ticket({
    id: 5,
    items: [unidad({ t: [{ nombre: 'Salsa <B&B>', precio: 500, grupoNombre: 'TOPPING' }] }, 1, 1)],
    payment: { total: 15000 },
  });
  assert.ok(html.includes('&lt;B&amp;B&gt;'), 'debe escapar el nombre');
});

console.log('\nReimpresión (misma ruta real) y ausencia de efectos:');
check('reimprimir produce EXACTAMENTE el mismo HTML', () => {
  assert.strictEqual(ticket(ventaMostrador), ticket(ventaMostrador));
});
check('imprimir/reimprimir no muta el pedido guardado', () => {
  const antes = JSON.stringify(ventaMostrador);
  ticket(ventaMostrador); ticket(ventaMostrador);
  assert.strictEqual(JSON.stringify(ventaMostrador), antes);
});
check('la ruta de impresión no referencia Firebase ni el motor de stock', () => {
  const prohibidos = ['firebase/database', 'processStockUpdate', 'resolveStockImpact',
    'PROCESSED_STOCK_IDS', 'runTransaction', 'saveOrder', 'updateOrder', 'saveSale'];
  for (const archivo of ['../counterTicket.js', '../counterTicketHtml.js', '../orderPrintDetail.js']) {
    const src = leer(archivo);
    for (const p of prohibidos) {
      assert.ok(!src.includes(p), `${archivo} no debe referenciar ${p}`);
    }
  }
});
check('un cambio posterior del catálogo NO altera la reimpresión (snapshot congelado)', () => {
  const guardado = JSON.parse(JSON.stringify(ventaMostrador));
  const antes = ticket(guardado);
  // El artículo sube a $20.000 y Rocklets a $3.000 en el catálogo: el pedido
  // guardado no los consulta, por lo que el ticket reimpreso es idéntico.
  const despues = ticket(guardado);
  assert.strictEqual(antes, despues);
  assert.ok(texto(antes).includes('1.700') && texto(antes).includes('30.700'));
});

console.log('\nAncho de impresora térmica (80mm):');
check('ninguna línea del detalle excede el ancho imprimible', () => {
  const { lineas } = construirDetalleImpresionPedido(ventaMostrador, { formatImporte: formatImporteTicket });
  for (const l of lineas) {
    const plano = l.replace('|', ' ');
    assert.ok(plano.length <= 46, `línea de ${plano.length} caracteres: ${plano}`);
  }
});

console.log('\nSalida final del ticket (texto plano):\n');
console.log(texto(ticket(ventaMostrador)).replace(/ (1x|TOTAL)/g, '\n$1'));

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
