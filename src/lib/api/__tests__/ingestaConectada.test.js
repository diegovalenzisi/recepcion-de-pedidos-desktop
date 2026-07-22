// F1.7 — punto 5: la ingesta de pedidos externos debe estar REALMENTE invocada.
//
// No alcanza con que ordersIngest.js exista y esté importado: si alguien quita
// la llamada y deja el import, el pedido de DLV volvería a entrar sin verificar.
// Esta prueba falla en ese caso.
//
// Corre en Desktop y en Tablet (mismo archivo, byte a byte).
//
// Correr con: node src/lib/api/__tests__/ingestaConectada.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizarPedidoRecibido } from '../ordersIngest.js';
import { construirLineaPersistible } from '../optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORDERS_API = path.join(AQUI, '../ordersApi.js');
const src = fs.readFileSync(ORDERS_API, 'utf8');

console.log('Cableado real en ordersApi.js:');
check('importa el módulo de ingesta', () => {
  assert.ok(/import\s*\{[^}]*normalizarPedidosRecibidos[^}]*\}\s*from\s*['"][^'"]*ordersIngest['"]/.test(src),
    'falta el import de normalizarPedidosRecibidos');
});
check('lo INVOCA (no queda importado sin usar)', () => {
  const invocaciones = (src.match(/normalizarPedidosRecibidos\s*\(/g) || []).length;
  assert.ok(invocaciones >= 1, 'el import está pero nunca se llama: los pedidos entrarían sin verificar');
});
check('la invocación está dentro de fetchOrders (la lectura real de pedidos)', () => {
  const i = src.indexOf('export const fetchOrders');
  assert.ok(i !== -1, 'no se encontró fetchOrders');
  // Cuerpo de fetchOrders hasta el siguiente export de nivel superior.
  const resto = src.slice(i);
  const fin = resto.indexOf('\nexport ', 1);
  const cuerpo = fin === -1 ? resto : resto.slice(0, fin);
  assert.ok(cuerpo.includes('normalizarPedidosRecibidos('),
    'fetchOrders devuelve los pedidos sin pasarlos por la ingesta');
});
check('fetchOrders NO devuelve el mapeo crudo sin normalizar', () => {
  const i = src.indexOf('export const fetchOrders');
  const resto = src.slice(i);
  const fin = resto.indexOf('\nexport ', 1);
  const cuerpo = fin === -1 ? resto : resto.slice(0, fin);
  // El patrón viejo era: return Object.keys(data).map(...).sort(...)
  assert.ok(!/return\s+Object\.keys\(data\)\s*\n?\s*\.map\(/.test(cuerpo),
    'volvió el retorno crudo sin verificar el total');
});
check('la ingesta no escribe: ordersIngest no toca Firebase ni stock', () => {
  const ingest = fs.readFileSync(path.join(AQUI, '../ordersIngest.js'), 'utf8');
  for (const prohibido of ['firebase/database', 'set(', 'update(', 'runTransaction',
    'processStockUpdate', 'resolveStockImpact', 'PROCESSED_STOCK_IDS']) {
    assert.ok(!ingest.includes(prohibido), `la ingesta no debe usar ${prohibido}`);
  }
});

console.log('\nComportamiento sobre un pedido emitido por DLV:');
const pedidoDlv = {
  id: 4321,
  items: [construirLineaPersistible({
    id: '0007', nombre: '1 KILO DE HELADO', valor: 14500, quantity: 1, uniqueId: 'u1',
    selectedOptionals: { 'G-TOPPING': [{ nombre: 'Rocklets', precio: 1700, grupoNombre: 'TOPPING' }] },
  })],
  payment: { method: 'Efectivo', total: 16200 },
};

check('un pedido correcto se ingiere en $16.200', () => {
  const r = normalizarPedidoRecibido(JSON.parse(JSON.stringify(pedidoDlv)));
  assert.strictEqual(r.totalCanonico, 16200);
  assert.strictEqual(r.totalDiscrepante, false);
});
check('un total manipulado se corrige y se registra', () => {
  const manipulado = JSON.parse(JSON.stringify(pedidoDlv));
  manipulado.payment.total = 14500;
  const avisos = [];
  const r = normalizarPedidoRecibido(manipulado, { onWarn: (w) => avisos.push(w) });
  assert.strictEqual(r.totalCanonico, 16200);
  assert.strictEqual(r.totalDiscrepante, true);
  assert.ok(avisos.length > 0, 'la discrepancia debe quedar registrada');
});
check('un histórico sin snapshot conserva su total', () => {
  const r = normalizarPedidoRecibido({
    id: 1, items: [{ nombre: '1 KILO', valor: 14500, quantity: 1, selectedOptionals: { g: [{ nombre: 'Rocklets' }] } }],
    payment: { total: 14500 },
  });
  assert.strictEqual(r.totalCanonico, 14500);
  assert.strictEqual(r.snapshotCompleto, false);
});
check('no muta el pedido leído', () => {
  const p = JSON.parse(JSON.stringify(pedidoDlv));
  const antes = JSON.stringify(p);
  normalizarPedidoRecibido(p);
  assert.strictEqual(JSON.stringify(p), antes);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
