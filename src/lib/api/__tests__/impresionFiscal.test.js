// Impresión automática del comprobante fiscal: gracia, lock, reintentos.
// Correr con: node src/lib/api/__tests__/impresionFiscal.test.js
import assert from 'node:assert';
import {
  decidirImpresion, marcaImpresa, marcaError, requiereAtencion, backoffMs,
  PENDIENTE, IMPRIMIENDO, IMPRESA, ERROR, GRACIA_MS, LEASE_MS, MAX_INTENTOS,
} from '../impresionFiscal.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const T0 = 1_000_000;
const VENDEDORA = 'term-A';
const OTRA = 'term-B';
/** Factura emitida que pidió impresión desde la terminal A. */
const factura = (over = {}) => ({
  CAE: '75123456789012', imprimirAlEmitir: true,
  impresionSolicitadaPor: VENDEDORA, emitidaAt: T0, ...over,
});

console.log('Qué se imprime y qué no:');
check('sin `imprimirAlEmitir` no se toca', () => {
  const r = decidirImpresion({ nodo: null, registro: { CAE: '1' }, deviceId: VENDEDORA, ahora: T0 });
  assert.strictEqual(r.accion, 'nada');
  assert.strictEqual(r.motivo, 'no-pidio-impresion');
});
check('pidió impresión pero todavía no hay CAE: espera, no imprime', () => {
  const r = decidirImpresion({ nodo: null, registro: factura({ CAE: null }), deviceId: VENDEDORA, ahora: T0 });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.motivo, 'sin-cae-todavia');
});

console.log('\nPrioridad de la terminal que vendió (gracia de 30 s):');
check('la terminal que vendió imprime enseguida', () => {
  const r = decidirImpresion({ nodo: null, registro: factura(), deviceId: VENDEDORA, ahora: T0 + 1000 });
  assert.strictEqual(r.accion, 'imprimir');
  assert.strictEqual(r.motivo, 'terminal-que-vendio');
  assert.strictEqual(r.nodo.estado, IMPRIMIENDO);
  assert.strictEqual(r.nodo.deviceId, VENDEDORA);
});
check('otra terminal ESPERA durante la gracia', () => {
  const r = decidirImpresion({ nodo: null, registro: factura(), deviceId: OTRA, ahora: T0 + GRACIA_MS - 1 });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.motivo, 'gracia-del-solicitante');
});
check('pasada la gracia, otra terminal la toma (takeover)', () => {
  const r = decidirImpresion({ nodo: null, registro: factura(), deviceId: OTRA, ahora: T0 + GRACIA_MS + 1 });
  assert.strictEqual(r.accion, 'imprimir');
  assert.strictEqual(r.motivo, 'takeover-tras-gracia');
  assert.strictEqual(r.nodo.deviceId, OTRA);
});
check('sin terminal solicitante, cualquiera puede imprimir', () => {
  const r = decidirImpresion({ nodo: null, registro: factura({ impresionSolicitadaPor: null }), deviceId: OTRA, ahora: T0 });
  assert.strictEqual(r.accion, 'imprimir');
});

console.log('\nUna sola impresión (lock con lease):');
check('si otra la está imprimiendo, no se duplica', () => {
  const nodo = { estado: IMPRIMIENDO, deviceId: OTRA, lockedAt: T0 };
  const r = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + LEASE_MS - 1 });
  assert.strictEqual(r.accion, 'nada');
  assert.strictEqual(r.motivo, 'la-esta-imprimiendo-otra-terminal');
});
check('ya impresa: nunca se reimprime sola', () => {
  const nodo = { estado: IMPRESA, deviceId: OTRA };
  for (const quien of [VENDEDORA, OTRA]) {
    const r = decidirImpresion({ nodo, registro: factura(), deviceId: quien, ahora: T0 + 10 * LEASE_MS });
    assert.strictEqual(r.accion, 'nada');
    assert.strictEqual(r.motivo, 'ya-impresa');
  }
});
check('lease vencido (la PC murió imprimiendo): otra la retoma', () => {
  const nodo = { estado: IMPRIMIENDO, deviceId: OTRA, lockedAt: T0 };
  const r = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + LEASE_MS + 1 });
  assert.strictEqual(r.accion, 'imprimir');
  assert.strictEqual(r.motivo, 'lease-vencido');
  assert.strictEqual(r.nodo.deviceId, VENDEDORA, 'queda a nombre de quien la retoma');
});
check('el contador de intentos se conserva al retomar', () => {
  const nodo = { estado: IMPRIMIENDO, deviceId: OTRA, lockedAt: T0, intentos: 2, creadoAt: T0 - 5000 };
  const r = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + LEASE_MS + 1 });
  assert.strictEqual(r.nodo.intentos, 2);
  assert.strictEqual(r.nodo.creadoAt, T0 - 5000, 'no se pierde cuándo se creó');
});

console.log('\nReintentos ante fallo de impresora:');
check('tras un error espera el backoff antes de reintentar', () => {
  const nodo = { estado: ERROR, intentos: 1, ultimoIntentoAt: T0 };
  const antes = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + 100 });
  assert.strictEqual(antes.accion, 'esperar');
  assert.strictEqual(antes.motivo, 'backoff');
  const despues = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + backoffMs(1) + 1 });
  assert.strictEqual(despues.accion, 'imprimir');
  assert.strictEqual(despues.motivo, 'reintento');
});
check(`tras ${MAX_INTENTOS} intentos deja de reintentar solo`, () => {
  const nodo = { estado: ERROR, intentos: MAX_INTENTOS, ultimoIntentoAt: T0 };
  const r = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + 10 * 60_000 });
  assert.strictEqual(r.accion, 'nada');
  assert.strictEqual(r.motivo, 'agotados-los-intentos');
  assert.strictEqual(requiereAtencion(nodo), true, 'queda visible para reimprimir a mano');
});
check('el backoff crece y tiene tope', () => {
  assert.ok(backoffMs(2) > backoffMs(1));
  assert.ok(backoffMs(50) <= 30_000);
});

console.log('\nCierre del estado:');
check('marcaImpresa deja IMPRESA y limpia el error', () => {
  const n = marcaImpresa({ estado: IMPRIMIENDO, intentos: 1, ultimoError: 'x' }, { deviceId: VENDEDORA, ahora: T0, numero: '0002-00000011' });
  assert.strictEqual(n.estado, IMPRESA);
  assert.strictEqual(n.numero, '0002-00000011');
  assert.strictEqual(n.ultimoError, null);
});
check('marcaError suma el intento y guarda el motivo real', () => {
  const n = marcaError({ estado: IMPRIMIENDO, intentos: 1 }, { deviceId: VENDEDORA, mensaje: 'ventana-bloqueada', ahora: T0 });
  assert.strictEqual(n.estado, ERROR);
  assert.strictEqual(n.intentos, 2);
  assert.strictEqual(n.ultimoError, 'ventana-bloqueada');
});

console.log('\nRecuperación tras reiniciar:');
check('un PENDIENTE viejo se retoma al volver a abrir la app', () => {
  // La app se cerró con la impresión sin hacer; al arrancar, el barrido la ve.
  const nodo = { estado: PENDIENTE, creadoAt: T0 };
  const r = decidirImpresion({ nodo, registro: factura(), deviceId: VENDEDORA, ahora: T0 + 6 * 60 * 60_000 });
  assert.strictEqual(r.accion, 'imprimir', 'no importa cuánto haya pasado');
});
check('sin deviceId no se imprime (no se puede garantizar exclusión)', () => {
  const r = decidirImpresion({ nodo: null, registro: factura(), deviceId: null, ahora: T0 });
  assert.strictEqual(r.accion, 'nada');
  assert.strictEqual(r.motivo, 'sin-device-id');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
