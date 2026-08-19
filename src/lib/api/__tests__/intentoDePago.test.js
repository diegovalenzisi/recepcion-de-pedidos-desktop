// CICLO DE VIDA DEL INTENTO DE PAGO DE COMISIÓN.
//
// La idempotencia del servidor (opId `P-{idPago}` + regla create-only) solo
// sirve si el cliente REUTILIZA el mismo id al reintentar. Estas pruebas cubren
// esa mitad: que el id se genere una sola vez y sobreviva al doble clic, al
// timeout, a la pérdida de conexión y al cierre y reapertura de la aplicación.
//
// Correr con: node src/lib/api/__tests__/intentoDePago.test.js
import assert from 'node:assert';
import {
  PREFIJO_MARCA, claveDeMarca, nuevoIdPago, nuevaMarca, marcaEsDelLocal,
  decidirDesdeMarca, guardarMarca, leerMarca, limpiarMarca,
} from '../intentoDePago.js';
import { opIdPago } from '../comisionMovimiento.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

/** localStorage de mentira, para probar sin navegador. */
const almacenFalso = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _mapa: m,
  };
};

const L = '40508022';

// ---------------------------------------------------------------------------
console.log('\n1. Identidad del intento:');

check('cada intento nuevo tiene su propio id', () => {
  assert.notStrictEqual(nuevoIdPago(), nuevoIdPago());
});

check('la marca guarda local, importe, responsable y origen', () => {
  const m = nuevaMarca({ localId: L, montoCentavos: 1000000, responsable: 'CAROLINA', ahora: 111 });
  assert.strictEqual(m.localId, L);
  assert.strictEqual(m.montoCentavos, 1000000);
  assert.strictEqual(m.responsable, 'CAROLINA');
  assert.strictEqual(m.origen, 'desktop');
  assert.strictEqual(m.creadoEn, 111);
  assert.ok(m.idPago);
});

check('la clave de la marca incluye el local', () => {
  assert.strictEqual(claveDeMarca(L), `${PREFIJO_MARCA}${L}`);
  assert.notStrictEqual(claveDeMarca('40508022'), claveDeMarca('31915636'));
});

check('el opId del movimiento sale del idPago de la marca', () => {
  const m = nuevaMarca({ localId: L, montoCentavos: 100, responsable: 'x' });
  assert.strictEqual(opIdPago(m.idPago), `P-${m.idPago}`);
});

// ---------------------------------------------------------------------------
console.log('\n2. Persistencia:');

check('se guarda y se recupera igual', () => {
  const a = almacenFalso();
  const m = nuevaMarca({ localId: L, montoCentavos: 5000, responsable: 'CARO' });
  assert.strictEqual(guardarMarca(m, a), true);
  assert.deepStrictEqual(leerMarca(L, a), m);
});

check('una marca de OTRO local no se usa', () => {
  const a = almacenFalso();
  guardarMarca(nuevaMarca({ localId: '31915636', montoCentavos: 5000, responsable: 'x' }), a);
  assert.strictEqual(leerMarca(L, a), null, 'no puede tomar el intento de otro local');
  assert.ok(leerMarca('31915636', a), 'en su propio local si');
});

check('limpiar borra la marca', () => {
  const a = almacenFalso();
  const m = nuevaMarca({ localId: L, montoCentavos: 100, responsable: 'x' });
  guardarMarca(m, a);
  limpiarMarca(L, a);
  assert.strictEqual(leerMarca(L, a), null);
});

check('un almacen roto no rompe el pago', () => {
  const roto = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
  assert.strictEqual(guardarMarca(nuevaMarca({ localId: L, montoCentavos: 1, responsable: 'x' }), roto), false);
  assert.strictEqual(leerMarca(L, roto), null);
});

// ---------------------------------------------------------------------------
console.log('\n3. Doble clic:');

check('el segundo clic reutiliza el MISMO id y el MISMO monto', () => {
  const a = almacenFalso();
  // Primer clic: se genera y se persiste.
  const m1 = nuevaMarca({ localId: L, montoCentavos: 2000000, responsable: 'CARO' });
  guardarMarca(m1, a);
  // Segundo clic: hay marca -> se reusa, NO se genera otra.
  const existente = leerMarca(L, a);
  assert.strictEqual(existente.idPago, m1.idPago, 'genero un id nuevo: descontaria dos veces');
  assert.strictEqual(existente.montoCentavos, m1.montoCentavos);
});

// ---------------------------------------------------------------------------
console.log('\n4. Timeout despues del commit:');

check('el commit entro pero el cliente no lo supo: se detecta y no se descuenta de nuevo', () => {
  const a = almacenFalso();
  const m = nuevaMarca({ localId: L, montoCentavos: 1000000, responsable: 'CARO' });
  guardarMarca(m, a);
  // Al reintentar se consulta MOVIMIENTOS/P-{idPago}: EXISTE.
  const d = decidirDesdeMarca(leerMarca(L, a), true);
  assert.strictEqual(d.accion, 'ya-aplicado');
  assert.strictEqual(d.idPago, m.idPago);
  assert.match(d.motivo, /ya se había registrado/);
});

check('tras detectarlo se limpia la marca', () => {
  const a = almacenFalso();
  const m = nuevaMarca({ localId: L, montoCentavos: 100, responsable: 'x' });
  guardarMarca(m, a);
  if (decidirDesdeMarca(leerMarca(L, a), true).accion === 'ya-aplicado') limpiarMarca(L, a);
  assert.strictEqual(leerMarca(L, a), null);
});

// ---------------------------------------------------------------------------
console.log('\n5. Perdida de conexion / reintento:');

check('el commit NO entro: se reintenta con el mismo id y el mismo monto', () => {
  const a = almacenFalso();
  const m = nuevaMarca({ localId: L, montoCentavos: 1500000, responsable: 'CARO' });
  guardarMarca(m, a);
  const d = decidirDesdeMarca(leerMarca(L, a), false);
  assert.strictEqual(d.accion, 'reintentar');
  assert.strictEqual(d.idPago, m.idPago, 'tiene que ser el MISMO id');
  assert.strictEqual(d.montoCentavos, 1500000, 'y el MISMO importe');
});

check('un reintento no puede cambiar el importe', () => {
  const a = almacenFalso();
  guardarMarca(nuevaMarca({ localId: L, montoCentavos: 1000, responsable: 'x' }), a);
  const d = decidirDesdeMarca(leerMarca(L, a), false);
  assert.strictEqual(d.montoCentavos, 1000, 'el importe viaja con la identidad');
});

// ---------------------------------------------------------------------------
console.log('\n6. Cierre y reapertura con pago pendiente:');

check('al reabrir sin marca no pasa nada', () => {
  const a = almacenFalso();
  assert.strictEqual(decidirDesdeMarca(leerMarca(L, a), false).accion, 'ninguna');
});

check('al reabrir con marca y movimiento existente: ya aplicado', () => {
  const a = almacenFalso();
  guardarMarca(nuevaMarca({ localId: L, montoCentavos: 700, responsable: 'x' }), a);
  // "cierre y reapertura": la marca sobrevive porque esta persistida
  assert.strictEqual(decidirDesdeMarca(leerMarca(L, a), true).accion, 'ya-aplicado');
});

check('al reabrir con marca y sin movimiento: se puede reintentar', () => {
  const a = almacenFalso();
  guardarMarca(nuevaMarca({ localId: L, montoCentavos: 700, responsable: 'x' }), a);
  assert.strictEqual(decidirDesdeMarca(leerMarca(L, a), false).accion, 'reintentar');
});

// ---------------------------------------------------------------------------
console.log('\n7. El circuito completo:');

check('pagar -> timeout -> reabrir -> ya estaba -> limpiar: UN solo descuento', () => {
  const a = almacenFalso();
  let descuentos = 0;
  const movimientos = new Set();

  // Simula el servidor: crear P-{id} solo si no existe.
  const aplicarEnServidor = (idPago) => {
    const opId = opIdPago(idPago);
    if (movimientos.has(opId)) return false;
    movimientos.add(opId); descuentos++; return true;
  };

  // 1) Aprieta Pagar
  const m = nuevaMarca({ localId: L, montoCentavos: 1000000, responsable: 'CARO' });
  guardarMarca(m, a);
  aplicarEnServidor(m.idPago);            // entra, pero el cliente no se entera

  // 2) Doble clic
  const reintento1 = leerMarca(L, a);
  aplicarEnServidor(reintento1.idPago);   // rechazado

  // 3) Cierra y reabre
  const alReabrir = leerMarca(L, a);
  const d = decidirDesdeMarca(alReabrir, movimientos.has(opIdPago(alReabrir.idPago)));
  assert.strictEqual(d.accion, 'ya-aplicado');
  limpiarMarca(L, a);

  assert.strictEqual(descuentos, 1, 'la deuda se descontó más de una vez');
  assert.strictEqual(leerMarca(L, a), null);
});

check('pagar -> falla -> reintentar -> entra: UN solo descuento', () => {
  const a = almacenFalso();
  let descuentos = 0;
  const movimientos = new Set();
  const aplicarEnServidor = (idPago, falla = false) => {
    if (falla) return false;
    const opId = opIdPago(idPago);
    if (movimientos.has(opId)) return false;
    movimientos.add(opId); descuentos++; return true;
  };

  const m = nuevaMarca({ localId: L, montoCentavos: 500000, responsable: 'CARO' });
  guardarMarca(m, a);
  aplicarEnServidor(m.idPago, true);      // no entra: se corto la conexion

  const alReabrir = leerMarca(L, a);
  const d = decidirDesdeMarca(alReabrir, movimientos.has(opIdPago(alReabrir.idPago)));
  assert.strictEqual(d.accion, 'reintentar');
  aplicarEnServidor(d.idPago);            // ahora si
  limpiarMarca(L, a);

  assert.strictEqual(descuentos, 1);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
