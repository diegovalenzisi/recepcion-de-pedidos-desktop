// Fase 2 — ledger global, estados y reconciliador.
// Correr con: node src/lib/api/__tests__/stockLedger.test.js
import assert from 'node:assert';
import {
  ESTADOS, MAX_INTENTOS, claveLedger, construirReserva, decidirOperacion,
  cerrarOperacion, necesitaReconciliacion, pendientesDe, seleccionarParaReconciliar,
  operacionesParaAvisar, construirMovimiento, construirLedgerReversion, cerrarReversion,
} from '../stockLedger.js';
import { RESERVA_VENCIDA_MS } from '../stockAtomico.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const LOCAL = 'L1';
const IMPACTO = {
  'A-0007': { quantity: 1, type: 'ARTICULO' },
  'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' },
};
const OTRO_IMPACTO = { 'A-ROCKLETS': { quantity: 5, type: 'ARTICULO' } };
const reserva = (over = {}) => ({ ...construirReserva({ localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO, source: 'Venta Delivery', ownerId: 'A' }), ...over });

console.log('Reserva inicial:');
check('fija el plan, el hash y los recursos esperados', () => {
  const l = reserva();
  assert.strictEqual(l.status, ESTADOS.RESERVED);
  assert.match(l.impactHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepStrictEqual(l.recursosEsperados.sort(), ['ARTICULO:A-0007', 'ARTICULO:A-ROCKLETS']);
  assert.deepStrictEqual(l.recursosAplicados, []);
  assert.strictEqual(l.movimientoEscrito, false);
  assert.strictEqual(l.movementId, 'MOV_DELIVERY_1');
});
check('guarda referenceId original y operationKey segura', () => {
  const l = construirReserva({ localId: LOCAL, referenceId: 'a.b#c/d', impactMap: IMPACTO });
  assert.strictEqual(l.referenceId, 'a.b#c/d');
  assert.strictEqual(l.operationKey, claveLedger('a.b#c/d'));
  assert.ok(!/[.#$[\]/]/.test(l.operationKey));
});

console.log('\nDecisión sobre una operación:');
check('sin ledger → reservar', () => {
  const d = decidirOperacion({ ledgerActual: null, localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO });
  assert.strictEqual(d.accion, 'reservar');
});
check('completed → no se hace nada', () => {
  const d = decidirOperacion({ ledgerActual: reserva({ status: ESTADOS.COMPLETED }), localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO });
  assert.strictEqual(d.accion, 'nada');
});
check('partial → se continúa', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.PARTIAL, recursosAplicados: ['ARTICULO:A-0007'], leaseUntil: 0 }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO, ownerId: 'B',
  });
  assert.strictEqual(d.accion, 'continuar');
  assert.strictEqual(d.ledger.intentos, 1);
});
check('lease vigente de otro dueño → esperar (no es corrección, es no duplicar trabajo)', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.PROCESSING, ownerId: 'A', leaseUntil: Date.now() + 60000 }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO, ownerId: 'B',
  });
  assert.strictEqual(d.accion, 'esperar');
});
check('lease vencido → se retoma aunque el dueño sea otro', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.PROCESSING, ownerId: 'A', leaseUntil: Date.now() - 1 }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO, ownerId: 'B',
  });
  assert.strictEqual(d.accion, 'continuar');
});
check('se agotaron los intentos → fallida', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.PARTIAL, intentos: MAX_INTENTOS, leaseUntil: 0 }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: IMPACTO,
  });
  assert.strictEqual(d.accion, 'fallida');
});

console.log('\nPunto 9 — mismo referenceId con impactos DIFERENTES:');
check('con impacto ya aplicado → hash-conflict, no se aplica nada', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.PARTIAL, recursosAplicados: ['ARTICULO:A-0007'], leaseUntil: 0 }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: OTRO_IMPACTO,
  });
  assert.strictEqual(d.accion, 'conflicto');
  assert.strictEqual(d.motivo, 'hash-conflict');
  assert.strictEqual(d.ledger.status, ESTADOS.CONFLICT);
});
check('el plan almacenado NO se cambia en silencio', () => {
  const original = reserva({ status: ESTADOS.PARTIAL, recursosAplicados: ['ARTICULO:A-0007'], leaseUntil: 0 });
  const d = decidirOperacion({ ledgerActual: original, localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: OTRO_IMPACTO });
  assert.strictEqual(d.ledger.impactHash, original.impactHash, 'el hash fijado se conserva');
  assert.deepStrictEqual(d.ledger.plan, original.plan);
});
check('A con Rocklets x1 y B con Rocklets x2 a la vez: uno gana, el otro es conflicto', () => {
  const planA = { 'A-ROCKLETS': { quantity: 1, type: 'ARTICULO' } };
  const planB = { 'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' } };
  // A reserva primero y aplica.
  let ledger = construirReserva({ localId: LOCAL, referenceId: 'DELIVERY_123', impactMap: planA, ownerId: 'A' });
  ledger = cerrarOperacion(ledger, [{ recurso: 'ARTICULO:A-ROCKLETS', aplicado: true }], { movimientoEscrito: true });
  assert.strictEqual(ledger.status, ESTADOS.COMPLETED);
  // B llega con otro plan.
  const d = decidirOperacion({ ledgerActual: ledger, localId: LOCAL, referenceId: 'DELIVERY_123', impactMap: planB, ownerId: 'B' });
  assert.strictEqual(d.accion, 'conflicto');
  assert.strictEqual(d.motivo, 'hash-conflict');
});

console.log('\nPunto 10 — pedido editado ANTES de aplicar:');
check('sin ningún recurso aplicado, se puede reemplazar el plan de forma controlada', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.RESERVED, recursosAplicados: [] }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: OTRO_IMPACTO,
  });
  assert.strictEqual(d.accion, 'reservar');
  assert.strictEqual(d.motivo, 'plan-reemplazado-sin-impacto-aplicado');
  assert.ok(d.ledger.planAnterior, 'queda traza del plan anterior');
});
check('con un recurso aplicado, ya NO se puede cambiar el plan', () => {
  const d = decidirOperacion({
    ledgerActual: reserva({ status: ESTADOS.PARTIAL, recursosAplicados: ['ARTICULO:A-0007'] }),
    localId: LOCAL, referenceId: 'DELIVERY_1', impactMap: OTRO_IMPACTO,
  });
  assert.strictEqual(d.accion, 'conflicto');
});

console.log('\nCierre: partial nunca se confunde con completed:');
check('faltan recursos → partial', () => {
  const l = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: false, error: 'timeout' },
  ], { movimientoEscrito: false });
  assert.strictEqual(l.status, ESTADOS.PARTIAL);
  assert.deepStrictEqual(l.recursosFaltantes, ['ARTICULO:A-ROCKLETS']);
  assert.ok(l.ultimoError.includes('timeout'));
});
check('todos aplicados pero SIN movimiento → sigue partial', () => {
  const l = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: true },
  ], { movimientoEscrito: false });
  assert.strictEqual(l.status, ESTADOS.PARTIAL, 'el movimiento es parte de terminar');
  assert.strictEqual(pendientesDe(l).soloFaltaMovimiento, true);
});
check('todos aplicados y movimiento escrito → completed', () => {
  const l = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: true },
  ], { movimientoEscrito: true });
  assert.strictEqual(l.status, ESTADOS.COMPLETED);
  assert.deepStrictEqual(l.recursosFaltantes, []);
  assert.ok(l.completedAt > 0);
  assert.strictEqual(pendientesDe(l).nadaPendiente, true);
});

console.log('\nPunto 6 — movimiento determinístico:');
check('el ID no cambia entre intentos', () => {
  assert.strictEqual(construirMovimiento(reserva()).id, construirMovimiento(reserva()).id);
  assert.strictEqual(construirMovimiento(reserva()).id, 'MOV_DELIVERY_1');
});
check('si murió tras aplicar todo pero antes del movimiento, se crea SIN volver a descontar', () => {
  const l = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: true },
  ], { movimientoEscrito: false });
  const p = pendientesDe(l);
  assert.strictEqual(p.recursos.length, 0, 'no hay recursos que tocar');
  assert.strictEqual(p.soloFaltaMovimiento, true);
  const cerrado = cerrarOperacion(l, l.recursosAplicados.map((r) => ({ recurso: r, aplicado: true })), { movimientoEscrito: true });
  assert.strictEqual(cerrado.status, ESTADOS.COMPLETED);
});

console.log('\nReconciliador:');
check('detecta partial y reserved con lease vencido', () => {
  const ahora = Date.now();
  assert.strictEqual(necesitaReconciliacion(reserva({ status: ESTADOS.PARTIAL }), ahora), true);
  assert.strictEqual(necesitaReconciliacion(reserva({ status: ESTADOS.RESERVED, leaseUntil: ahora - 1 }), ahora), true);
  assert.strictEqual(necesitaReconciliacion(reserva({ status: ESTADOS.RESERVED, leaseUntil: ahora + RESERVA_VENCIDA_MS }), ahora), false);
  assert.strictEqual(necesitaReconciliacion(reserva({ status: ESTADOS.COMPLETED }), ahora), false);
  assert.strictEqual(necesitaReconciliacion(reserva({ status: ESTADOS.CONFLICT }), ahora), false);
});
check('NO toma operaciones de otro local', () => {
  const ledgers = {
    a: reserva({ status: ESTADOS.PARTIAL, referenceId: 'X', localId: 'L1' }),
    b: reserva({ status: ESTADOS.PARTIAL, referenceId: 'Y', localId: 'L2' }),
  };
  const sel = seleccionarParaReconciliar(ledgers, { localId: 'L1' });
  assert.strictEqual(sel.length, 1);
  assert.strictEqual(sel[0].localId, 'L1');
});
check('limita el lote para no bloquear la interfaz', () => {
  const ledgers = {};
  for (let i = 0; i < 100; i += 1) ledgers[i] = reserva({ status: ESTADOS.PARTIAL, referenceId: `R${i}`, createdAt: i });
  assert.strictEqual(seleccionarParaReconciliar(ledgers, { localId: LOCAL, maximo: 20 }).length, 20);
});
check('procesa primero las más viejas', () => {
  const ledgers = {
    n: reserva({ status: ESTADOS.PARTIAL, referenceId: 'NUEVA', createdAt: 2000 }),
    v: reserva({ status: ESTADOS.PARTIAL, referenceId: 'VIEJA', createdAt: 1000 }),
  };
  assert.strictEqual(seleccionarParaReconciliar(ledgers, { localId: LOCAL })[0].referenceId, 'VIEJA');
});
check('una operación no puede quedar olvidada: se avisa al operador', () => {
  const ahora = Date.now();
  const avisos = operacionesParaAvisar({
    a: reserva({ status: ESTADOS.CONFLICT, referenceId: 'C1' }),
    b: reserva({ status: ESTADOS.PARTIAL, referenceId: 'P1', updatedAt: ahora - 20 * 60 * 1000 }),
    c: reserva({ status: ESTADOS.PARTIAL, referenceId: 'P2', updatedAt: ahora, intentos: MAX_INTENTOS }),
    d: reserva({ status: ESTADOS.COMPLETED, referenceId: 'OK' }),
  }, { localId: LOCAL, ahora });
  const refs = avisos.map((a) => a.referenceId).sort();
  assert.deepStrictEqual(refs, ['C1', 'P1', 'P2']);
  assert.ok(avisos.every((a) => a.motivo && a.motivo.length > 0));
});

console.log('\nPunto 7 — reversión por recurso:');
check('solo revierte lo REALMENTE aplicado (original parcial)', () => {
  const original = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: false, error: 'corte' },
  ], { movimientoEscrito: false });
  const rev = construirLedgerReversion(original, { referenceIdReversion: 'REVERSAL_DELIVERY_1' });
  assert.deepStrictEqual(rev.recursosEsperados, ['ARTICULO:A-0007']);
  assert.strictEqual(rev.plan.length, 1, 'no se repone lo que nunca se descontó');
});
check('original completo → reversión completa', () => {
  const original = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: true },
  ], { movimientoEscrito: true });
  const rev = construirLedgerReversion(original, { referenceIdReversion: 'REVERSAL_DELIVERY_1' });
  assert.strictEqual(rev.recursosEsperados.length, 2);
  assert.strictEqual(rev.operation, 'increment');
  assert.strictEqual(rev.revierteA, 'DELIVERY_1');
  assert.notStrictEqual(rev.impactHash, original.impactHash, 'decremento y reversión tienen hashes distintos');
});
check('no se puede revertir una operación sin impacto aplicado', () => {
  assert.strictEqual(construirLedgerReversion(reserva(), { referenceIdReversion: 'R' }).error, 'original-sin-impacto-aplicado');
  assert.strictEqual(construirLedgerReversion(null, { referenceIdReversion: 'R' }).error, 'sin-original');
});
check('la reversión NO se reconstruye desde el pedido actual, sino del ledger', () => {
  const original = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: true },
  ], { movimientoEscrito: true });
  const rev = construirLedgerReversion(original, { referenceIdReversion: 'REVERSAL_DELIVERY_1' });
  assert.deepStrictEqual(rev.plan, original.plan, 'el plan sale del ledger original');
});
check('cierre de reversión: reversed solo si se repuso todo', () => {
  const original = cerrarOperacion(reserva(), [
    { recurso: 'ARTICULO:A-0007', aplicado: true },
    { recurso: 'ARTICULO:A-ROCKLETS', aplicado: true },
  ], { movimientoEscrito: true });
  const rev = construirLedgerReversion(original, { referenceIdReversion: 'REVERSAL_DELIVERY_1' });
  const parcial = cerrarReversion(rev, [{ recurso: 'ARTICULO:A-0007', aplicado: true }], { movimientoEscrito: true });
  assert.strictEqual(parcial.status, ESTADOS.REVERSAL_PARTIAL);
  const completa = cerrarReversion(rev, rev.recursosEsperados.map((r) => ({ recurso: r, aplicado: true })), { movimientoEscrito: true });
  assert.strictEqual(completa.status, ESTADOS.REVERSED);
});
check('una reversión incompleta también se avisa al operador', () => {
  const avisos = operacionesParaAvisar({ a: reserva({ status: ESTADOS.REVERSAL_PARTIAL, referenceId: 'RV' }) }, { localId: LOCAL });
  assert.strictEqual(avisos.length, 1);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
