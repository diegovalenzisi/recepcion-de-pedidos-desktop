// Apagado automático por falta de stock de materia prima:
//   MATERIA_PRIMA.activo (por stock) + cascada a ARTICULOS.activoDelivery.
// Idéntico en Desktop, Tablet y DLV Pedidos.
// Correr con: node src/lib/api/__tests__/deliveryPorStock.test.js
import assert from 'node:assert';
import {
  stockAgotado,
  aplicarReglaMateriaPrima,
  aplicarReglaMateriaPrimaANodo,
  resolverToggleManualMateriaPrima,
  materiaPrimaDisponible,
  reconciliarArticuloDelivery,
  reconciliarArticuloDeliveryANodo,
  resolverToggleManualArticuloDelivery,
} from '../deliveryPorStock.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

console.log('stockAgotado:');
check('0, negativo, "0" y basura = agotado; positivos no', () => {
  assert.strictEqual(stockAgotado(0), true);
  assert.strictEqual(stockAgotado(-3), true);
  assert.strictEqual(stockAgotado('0'), true);
  assert.strictEqual(stockAgotado('abc'), true);
  assert.strictEqual(stockAgotado(5), false);
  assert.strictEqual(stockAgotado('2,5'), false);
});

console.log('\nMATERIA PRIMA — activo por stock:');
check('activa 10→0: activo false + recuerda', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: 0, activo: true });
  assert.strictEqual(patch.activo, false);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, true);
  assert.strictEqual(patch.activoAntesDeAgotarse, true);
});
check('stock negativo estando ya apagada auto: sin cambios (idempotente)', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: -1, activo: false, apagadoAutomaticoPorStock: true, activoAntesDeAgotarse: true });
  assert.strictEqual(Object.keys(patch).length, 0);
});
check('agotada estando desactivada manual: NO marca restauración', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: 0, activo: false });
  assert.strictEqual(patch.apagadoAutomaticoPorStock, undefined);
  assert.strictEqual(patch.activoAntesDeAgotarse, undefined);
});
check('reponer con apagado auto previo activa: restaura y limpia', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: 10, activo: false, apagadoAutomaticoPorStock: true, activoAntesDeAgotarse: true });
  assert.strictEqual(patch.activo, true);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, null);
  assert.strictEqual(patch.activoAntesDeAgotarse, null);
});
check('reponer sin marcador: NO reactiva sola', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: 10, activo: false });
  assert.strictEqual(patch.activo, undefined);
});
check('idempotencia MP: 2da pasada sin cambios', () => {
  const r1 = aplicarReglaMateriaPrimaANodo({ stock: 0, activo: true });
  assert.strictEqual(r1.nodo.activo, false);
  assert.strictEqual(aplicarReglaMateriaPrimaANodo(r1.nodo).cambio, false);
});

console.log('\nMATERIA PRIMA — edición manual:');
check('apagar manual durante agotamiento cancela restauración', () => {
  const { patch } = resolverToggleManualMateriaPrima({ stock: 0, activo: false, apagadoAutomaticoPorStock: true, activoAntesDeAgotarse: true }, false);
  assert.strictEqual(patch.activo, false);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, null);
  assert.strictEqual(patch.activoAntesDeAgotarse, null);
});
check('encender manual con stock 0: queda false, registra intención', () => {
  const { patch } = resolverToggleManualMateriaPrima({ stock: 0, activo: false }, true);
  assert.strictEqual(patch.activo, false);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, true);
  assert.strictEqual(patch.activoAntesDeAgotarse, true);
});

console.log('\nmateriaPrimaDisponible:');
check('stock>0 y activo!==false → disponible', () => assert.strictEqual(materiaPrimaDisponible({ stock: 5, activo: true }), true));
check('stock 0 → no disponible', () => assert.strictEqual(materiaPrimaDisponible({ stock: 0, activo: true }), false));
check('activo false → no disponible aunque tenga stock', () => assert.strictEqual(materiaPrimaDisponible({ stock: 5, activo: false }), false));
check('controlStock false → siempre disponible', () => assert.strictEqual(materiaPrimaDisponible({ stock: 0, controlStock: false }), true));

console.log('\nARTÍCULO — cascada activoDelivery:');
check('artículo activo con MP bloqueante: apaga y recuerda + mapa', () => {
  const { patch } = reconciliarArticuloDelivery({ activo: true, activoDelivery: true }, ['11M']);
  assert.strictEqual(patch.activoDelivery, false);
  assert.strictEqual(patch.apagadoDeliveryAutomaticoPorMateriaPrima, true);
  assert.strictEqual(patch.activoDeliveryAntesDeFaltaMateriaPrima, true);
  assert.deepStrictEqual(patch.materiasPrimasBloqueantes, { '11M': true });
});
check('NO toca ARTICULOS.activo', () => {
  const { patch } = reconciliarArticuloDelivery({ activo: true, activoDelivery: true }, ['11M']);
  assert.strictEqual('activo' in patch, false);
});
check('artículo ya inactivo para delivery: no se marca para restauración', () => {
  const { patch } = reconciliarArticuloDelivery({ activo: true, activoDelivery: false }, ['11M']);
  assert.strictEqual(patch.apagadoDeliveryAutomaticoPorMateriaPrima, undefined);
  assert.strictEqual(patch.activoDeliveryAntesDeFaltaMateriaPrima, undefined);
  assert.deepStrictEqual(patch.materiasPrimasBloqueantes, { '11M': true });
});
check('reponer (sin bloqueantes) restaura si correspondía y limpia', () => {
  const nodo = { activo: true, activoDelivery: false, apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true, materiasPrimasBloqueantes: { '11M': true } };
  const { patch } = reconciliarArticuloDelivery(nodo, []);
  assert.strictEqual(patch.activoDelivery, true);
  assert.strictEqual(patch.apagadoDeliveryAutomaticoPorMateriaPrima, null);
  assert.strictEqual(patch.activoDeliveryAntesDeFaltaMateriaPrima, null);
  assert.strictEqual(patch.materiasPrimasBloqueantes, null);
});
check('reponer sin marcador de restauración: no reactiva', () => {
  const { patch } = reconciliarArticuloDelivery({ activo: true, activoDelivery: false }, []);
  assert.strictEqual(patch.activoDelivery, undefined);
});

console.log('\nARTÍCULO — varias materias primas bloqueantes:');
check('se agota 11M y luego 25M: mapa acumula ambas', () => {
  let r = reconciliarArticuloDeliveryANodo({ activo: true, activoDelivery: true }, ['11M']);
  assert.deepStrictEqual(r.nodo.materiasPrimasBloqueantes, { '11M': true });
  r = reconciliarArticuloDeliveryANodo(r.nodo, ['11M', '25M']);
  assert.deepStrictEqual(r.nodo.materiasPrimasBloqueantes, { '11M': true, '25M': true });
  assert.strictEqual(r.nodo.activoDelivery, false);
});
check('reponer solo 11M (queda 25M): sigue false, no restaura', () => {
  const nodo = { activo: true, activoDelivery: false, apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true, materiasPrimasBloqueantes: { '11M': true, '25M': true } };
  const r = reconciliarArticuloDeliveryANodo(nodo, ['25M']);
  assert.strictEqual(r.nodo.activoDelivery, false);
  assert.deepStrictEqual(r.nodo.materiasPrimasBloqueantes, { '25M': true });
});
check('reponer todas: restaura', () => {
  const nodo = { activo: true, activoDelivery: false, apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true, materiasPrimasBloqueantes: { '25M': true } };
  const r = reconciliarArticuloDeliveryANodo(nodo, []);
  assert.strictEqual(r.nodo.activoDelivery, true);
  assert.ok(!('materiasPrimasBloqueantes' in r.nodo));
});

console.log('\nARTÍCULO — edición manual con bloqueo:');
check('apagar manual durante bloqueo cancela restauración', () => {
  const nodo = { activoDelivery: false, apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true, materiasPrimasBloqueantes: { '11M': true } };
  const { patch } = resolverToggleManualArticuloDelivery(nodo, false);
  assert.strictEqual(patch.activoDelivery, false);
  assert.strictEqual(patch.activoDeliveryAntesDeFaltaMateriaPrima, null);
  // reponer luego NO restaura
  const nodo2 = { ...nodo, activoDeliveryAntesDeFaltaMateriaPrima: undefined };
  delete nodo2.activoDeliveryAntesDeFaltaMateriaPrima;
  const r = reconciliarArticuloDelivery(nodo2, []);
  assert.strictEqual(r.patch.activoDelivery, undefined);
});
check('encender manual con bloqueo: queda false, registra intención', () => {
  const nodo = { activoDelivery: false, materiasPrimasBloqueantes: { '11M': true } };
  const { patch } = resolverToggleManualArticuloDelivery(nodo, true);
  assert.strictEqual(patch.activoDelivery, false);
  assert.strictEqual(patch.apagadoDeliveryAutomaticoPorMateriaPrima, true);
  assert.strictEqual(patch.activoDeliveryAntesDeFaltaMateriaPrima, true);
});
check('cambiar manual sin bloqueo aplica el valor y limpia', () => {
  const { patch } = resolverToggleManualArticuloDelivery({ activoDelivery: false, apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true }, true);
  assert.strictEqual(patch.activoDelivery, true);
  assert.strictEqual(patch.apagadoDeliveryAutomaticoPorMateriaPrima, null);
  assert.strictEqual(patch.activoDeliveryAntesDeFaltaMateriaPrima, null);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
