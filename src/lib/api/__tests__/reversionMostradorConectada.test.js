// Fase 2 — punto 11: la reversión de Mostrador es idempotente y ÚNICA.
//
// Verifica el cableado real de counterApi/transactionsApi: que el camino viejo
// (restoreStockForItem + bulkUpdateStock, sin referenceId) ya no conviva con el
// nuevo, y que la reversión use su propio identificador determinístico.
//
// Correr con: node src/lib/api/__tests__/reversionMostradorConectada.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { revertirEnRecurso } from '../stockAtomico.js';
import { operationKey } from '../stockAtomico.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counter = fs.readFileSync(path.join(API, 'counterApi.js'), 'utf8');
const trans = fs.readFileSync(path.join(API, 'transactionsApi.js'), 'utf8');

console.log('Una sola autoridad de reversión:');
check('cancelCounterSale usa la reversión idempotente', () => {
  const i = counter.indexOf('export const cancelCounterSale');
  assert.ok(i !== -1);
  const cuerpo = counter.slice(i, i + 3000);
  assert.ok(cuerpo.includes('reverseStockForCounterSale('), 'no invoca la reversión nueva');
});
check('el camino viejo ya NO se ejecuta en la cancelación', () => {
  const i = counter.indexOf('export const cancelCounterSale');
  const cuerpo = counter.slice(i, i + 3000);
  assert.ok(!/await restoreStockForItem\(/.test(cuerpo), 'sigue el camino sin idempotencia');
  assert.ok(!/await bulkUpdateStock\(/.test(cuerpo));
});
check('counterApi ya no importa el camino viejo', () => {
  assert.ok(!/import\s*\{[^}]*restoreStockForItem[^}]*\}/.test(counter));
  assert.ok(!/import\s*\{[^}]*bulkUpdateStock[^}]*\}/.test(counter));
});

console.log('\nIdentificadores determinísticos:');
check('la reversión usa REVERSAL_MOSTRADOR_{saleId}', () => {
  assert.ok(trans.includes('`REVERSAL_MOSTRADOR_${sale.id}`'), 'falta el id de reversión');
  assert.ok(trans.includes('`MOSTRADOR_${sale.id}`'), 'falta el id original');
});
check('NO borra ni reutiliza la marca original', () => {
  const i = trans.indexOf('export const reverseStockForCounterSale');
  const cuerpo = trans.slice(i, trans.indexOf('export const processStockForCounterSale'));
  assert.ok(!/set\([^)]*PROCESSED_STOCK_IDS\/\$\{referenceIdOriginal\}[^)]*\),\s*null/.test(cuerpo));
  assert.ok(cuerpo.includes('referenceIdReversion'), 'escribe bajo su propia referencia');
});
check('no revierte una venta que nunca descontó; sí una que quedó parcial', () => {
  const i = trans.indexOf('export const reverseStockForCounterSale');
  const cuerpo = trans.slice(i, trans.indexOf('export const processStockForCounterSale'));
  // `partial` también se revierte: el reductor solo repone los recursos que
  // registraron la operación original, así que devuelve exactamente lo aplicado.
  assert.ok(cuerpo.includes("['completed', 'partial'].includes(marcaOriginal.status)"));
  assert.ok(cuerpo.includes("'original-not-applied'"));
});
check('una segunda cancelación devuelve already-reversed', () => {
  const i = trans.indexOf('export const reverseStockForCounterSale');
  const cuerpo = trans.slice(i, trans.indexOf('export const processStockForCounterSale'));
  assert.ok(cuerpo.includes("'already-reversed'"));
});
check('usa el mismo plan que el descuento (base + promo + opcionales)', () => {
  const i = trans.indexOf('export const reverseStockForCounterSale');
  const cuerpo = trans.slice(i, trans.indexOf('export const processStockForCounterSale'));
  assert.ok(cuerpo.includes('construirPlanDeStock('), 'no reconstruye desde el pedido actual');
});
check('NO usa el patrón de precarga con onValue, que se colgaba con listeners vivos', () => {
  // El nodo null de la primera invocación ya lo resuelve `revertirEnRecurso`
  // (devuelve {} para forzar la reejecución) y `resolverResultadoRecurso`
  // distingue después caché fría de recurso inexistente. La "precarga" con
  //   const off = onValue(ref, () => { off(); resolve(); })
  // rompía con cualquier otro listener activo sobre la ruta: RTDB invoca el
  // callback sincrónicamente y `off` todavía está en la zona muerta del const.
  const i = trans.indexOf('export const reverseStockForCounterSale');
  const cuerpo = trans.slice(i, trans.indexOf('export const processStockForCounterSale'));
  assert.ok(!/const\s+off\s*=\s*onValue\(/.test(cuerpo), 'volvió el patrón que se colgaba');
  assert.ok(cuerpo.includes('resolverResultadoRecurso('), 'falta resolver el retryable');
});
check('el descuento tampoco usa esa precarga', () => {
  const i = trans.indexOf('const processStockUpdate');
  const cuerpo = trans.slice(i, trans.indexOf('\nexport const processStockForDeliveredOrder'));
  assert.ok(!/const\s+off\s*=\s*onValue\(/.test(cuerpo), 'volvió el patrón que se colgaba');
});
check('registra el estado parcial en vez de darlo por completo', () => {
  const i = trans.indexOf('export const reverseStockForCounterSale');
  const cuerpo = trans.slice(i, trans.indexOf('export const processStockForCounterSale'));
  assert.ok(cuerpo.includes("'reversal-partial'"));
});

console.log('\nComportamiento del reductor de reversión:');
const claveOrig = operationKey('stock', 'MOSTRADOR_1');
const claveRev = operationKey('stock', 'REVERSAL_MOSTRADOR_1');
const params = { referenceIdOriginal: 'MOSTRADOR_1', referenceIdReversion: 'REVERSAL_MOSTRADOR_1', tipo: 'ARTICULO' };

check('repone exactamente lo que el recurso registró', () => {
  const nodo = { propio: 18, appliedOps: { [claveOrig]: { amount: 2, impactHash: 'h', at: 1 } } };
  const r = revertirEnRecurso(nodo, params);
  assert.strictEqual(r.resultado, 'revertido');
  assert.strictEqual(r.nodo.propio, 20);
});
check('segunda reversión: ya-revertido, no repone', () => {
  const nodo = { propio: 20, appliedOps: { [claveOrig]: { amount: 2, impactHash: 'h', at: 1 }, [claveRev]: { amount: -2, at: 2 } } };
  const r = revertirEnRecurso(nodo, params);
  assert.strictEqual(r.resultado, 'ya-revertido');
  assert.strictEqual(r.nodo, undefined, 'no escribe');
});
check('recurso que nunca recibió la operación original: no repone', () => {
  const r = revertirEnRecurso({ propio: 5, appliedOps: {} }, params);
  assert.strictEqual(r.resultado, 'original-no-aplicada');
  assert.strictEqual(r.nodo, undefined);
});
check('original PARCIAL: solo se repone donde sí se aplicó', () => {
  const aplicado = revertirEnRecurso({ propio: 18, appliedOps: { [claveOrig]: { amount: 2, impactHash: 'h', at: 1 } } }, params);
  const noAplicado = revertirEnRecurso({ propio: 20, appliedOps: {} }, params);
  assert.strictEqual(aplicado.resultado, 'revertido');
  assert.strictEqual(noAplicado.resultado, 'original-no-aplicada');
});
check('recurso eliminado tras la venta: missing-resource, no lo recrea', () => {
  const r = revertirEnRecurso(null, { ...params, invocacion: 2 });
  assert.strictEqual(r.resultado, 'missing-resource');
  assert.strictEqual(r.nodo, undefined);
});
check('stock corrupto: no repone sobre un dato ilegible', () => {
  const nodo = { propio: 'basura', appliedOps: { [claveOrig]: { amount: 2, impactHash: 'h', at: 1 } } };
  assert.strictEqual(revertirEnRecurso(nodo, params).resultado, 'corrupt-stock');
});
check('la marca original se conserva junto a la de reversión', () => {
  const nodo = { propio: 18, appliedOps: { [claveOrig]: { amount: 2, impactHash: 'h', at: 1 } } };
  const r = revertirEnRecurso(nodo, params);
  assert.ok(r.nodo.appliedOps[claveOrig], 'la original sigue');
  assert.ok(r.nodo.appliedOps[claveRev], 'la reversión tiene su entrada');
  assert.strictEqual(r.nodo.appliedOps[claveRev].revierteA, 'MOSTRADOR_1');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
