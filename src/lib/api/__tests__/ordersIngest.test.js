// F1.5 — punto 6: la Tablet NO confía ciegamente en el total que le llega de
// Desktop o de DLV Pedidos, pero tampoco rompe ni "corrige" pedidos históricos.
//
// Correr con: node src/lib/api/__tests__/ordersIngest.test.js
import assert from 'node:assert';
import { construirLineaPersistible } from '../optionalsPricing.js';
import {
  normalizarPedidoRecibido,
  normalizarPedidosRecibidos,
  pedidoEsReconstruible,
  tieneSnapshotCompleto,
} from '../ordersIngest.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const KILO = { id: 'A1', nombre: '1 KILO DE HELADO', valor: 14500 };
const ROCKLETS = { nombre: 'Rocklets', precio: 1700, grupoNombre: 'TOPPING' };
const unidad = (opts, idx, tot) => construirLineaPersistible({
  ...KILO, quantity: 1, uniqueId: `u${idx}`, unidadIndice: idx, unidadTotal: tot, selectedOptionals: opts,
});

console.log('Pedidos recibidos con snapshot completo:');
check('total correcto de DLV se acepta tal cual', () => {
  const p = normalizarPedidoRecibido({
    id: 10, items: [unidad({ t: [ROCKLETS] }, 1, 1)], payment: { total: 16200 },
  });
  assert.strictEqual(p.totalCanonico, 16200);
  assert.strictEqual(p.totalDiscrepante, false);
  assert.strictEqual(p.snapshotCompleto, true);
});
check('total MANIPULADO por el navegador se detecta y manda el canónico', () => {
  const avisos = [];
  const p = normalizarPedidoRecibido(
    { id: 11, items: [unidad({ t: [ROCKLETS] }, 1, 1)], payment: { total: 14500 } }, // "olvidó" el topping
    { onWarn: (w) => avisos.push(w) }
  );
  assert.strictEqual(p.totalCanonico, 16200, 'debe imponerse el total canónico');
  assert.strictEqual(p.totalGuardado, 14500);
  assert.strictEqual(p.totalDiscrepante, true);
  assert.ok(avisos.length > 0, 'debe dejar constancia del desvío');
});
check('dos unidades: 30.700 reconstruido desde los snapshots', () => {
  const p = normalizarPedidoRecibido({
    id: 12,
    items: [unidad({ t: [ROCKLETS] }, 1, 2), unidad({ s: [{ nombre: 'Frutilla', precio: 0 }] }, 2, 2)],
    payment: { total: 30700 },
  });
  assert.strictEqual(p.totalCanonico, 30700);
  assert.strictEqual(p.totalDiscrepante, false);
});
check('no se vuelve a sumar el adicional (nunca 17.900 ni 16.200+1.700)', () => {
  const p = normalizarPedidoRecibido({
    id: 13, items: [unidad({ t: [ROCKLETS] }, 1, 1)], payment: { total: 16200 },
  });
  assert.strictEqual(p.totalCanonico, 16200);
});

console.log('\nPedidos históricos / incompletos:');
check('pedido viejo sin snapshot: se respeta el total guardado', () => {
  const avisos = [];
  const p = normalizarPedidoRecibido({
    id: 20,
    items: [{ ...KILO, quantity: 1, selectedOptionals: { g: [{ nombre: 'Rocklets' }] } }],
    payment: { total: 14500 },
  }, { onWarn: (w) => avisos.push(w) });
  assert.strictEqual(p.totalCanonico, 14500, 'no se corrige un pedido histórico');
  assert.strictEqual(p.snapshotCompleto, false);
  assert.strictEqual(p.totalDiscrepante, false);
  assert.strictEqual(avisos.length, 0, 'un histórico no es una discrepancia');
});
check('mezcla de líneas nuevas e históricas: manda el total guardado', () => {
  const p = normalizarPedidoRecibido({
    id: 21,
    items: [unidad({ t: [ROCKLETS] }, 1, 2), { ...KILO, quantity: 1 }],
    payment: { total: 30700 },
  });
  assert.strictEqual(p.snapshotCompleto, false);
  assert.strictEqual(p.totalCanonico, 30700);
});
check('pedido sin items ni total: abre sin romper (nada de NaN)', () => {
  const p = normalizarPedidoRecibido({ id: 22, items: [] });
  assert.strictEqual(p.totalCanonico, null);
  assert.ok(!Number.isNaN(p.totalCanonico));
});
check('pedido con total en payment.amount (formato viejo)', () => {
  const p = normalizarPedidoRecibido({ id: 23, items: [{ ...KILO, quantity: 1 }], payment: { amount: 14500 } });
  assert.strictEqual(p.totalCanonico, 14500);
});

console.log('\nGarantías generales:');
check('no muta el pedido original', () => {
  const original = { id: 30, items: [unidad({ t: [ROCKLETS] }, 1, 1)], payment: { total: 14500 } };
  const copia = JSON.stringify(original);
  normalizarPedidoRecibido(original);
  assert.strictEqual(JSON.stringify(original), copia);
});
check('normalizarPedidosRecibidos tolera entradas basura', () => {
  assert.deepStrictEqual(normalizarPedidosRecibidos(null), []);
  const r = normalizarPedidosRecibidos([null, undefined, 7]);
  assert.strictEqual(r.length, 3);
});
check('helpers de snapshot detectan bien cada caso', () => {
  assert.strictEqual(tieneSnapshotCompleto(unidad({ t: [ROCKLETS] }, 1, 1)), true);
  assert.strictEqual(tieneSnapshotCompleto({ ...KILO }), false);
  assert.strictEqual(pedidoEsReconstruible({ items: [] }), false);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
