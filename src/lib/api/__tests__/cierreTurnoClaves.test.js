// EL CIERRE DE TURNO NO SE PUEDE ROMPER POR EL NOMBRE DE UNA CUENTA.
//
// El 16/08/2026 el turno 103 de Achaval quedó cerrado a la mitad: los 117
// pedidos ya respaldados y borrados de los nodos vivos, el backup de la CAJA
// nunca escrito y el turno todavía en "abierto". La cuenta se llamaba
// "PREPAGO M.PAGO" y ese punto es ilegal como clave de Realtime Database.
//
// Estas pruebas cubren las dos defensas que se agregaron:
//   · SANEO   — la clave se construye sin caracteres prohibidos, siempre;
//   · ORDEN   — el payload se valida ANTES del primer paso destructivo.
//
// Correr con: node src/lib/api/__tests__/cierreTurnoClaves.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  claveSeguraRTDB,
  esClaveValidaRTDB,
  totalesPorMedioDePago,
  clavesInvalidasDe,
  validarPayloadDeCierre,
  CierreInvalidoError,
  CLAVE_SIN_NOMBRE,
} from '../cash/clavesCierre.js';
import { normalizarClaveMedioPago } from '../facturaORemito.js';
import { normalizarPlataforma } from '../ventasApps.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Los seis caracteres que Realtime Database rechaza en una clave. */
const PROHIBIDOS = ['.', '#', '$', '/', '[', ']'];

// ---------------------------------------------------------------------------
console.log('\n1. El saneo de claves:');

check('los nombres de siempre pasan intactos (byte a byte)', () => {
  for (const n of ['Efectivo', 'Transferencia', 'Transferencia 5', 'Mercado Pago',
                   'Cuenta DNI', 'Banco 1', 'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI',
                   'PREPAGO MPAGO', 'Regalo', 'Sorteo', 'Mal Armado']) {
    assert.strictEqual(claveSeguraRTDB(n), n, `${n} no debe cambiar`);
  }
});

check('cada uno de los 6 caracteres prohibidos se saca', () => {
  for (const c of PROHIBIDOS) {
    const clave = claveSeguraRTDB(`BANCO${c}2`);
    assert.strictEqual(clave, 'BANCO2', `no se sacó "${c}"`);
    assert.ok(esClaveValidaRTDB(clave));
  }
});

check('casos reales que podrían existir mañana', () => {
  assert.strictEqual(claveSeguraRTDB('TRANSF. 6'), 'TRANSF 6');
  assert.strictEqual(claveSeguraRTDB('BANCO #2'), 'BANCO 2');
  assert.strictEqual(claveSeguraRTDB('MP $'), 'MP');
  assert.strictEqual(claveSeguraRTDB('A/B'), 'AB');
  assert.strictEqual(claveSeguraRTDB('CTA [1]'), 'CTA 1');
});

check('un nombre que queda vacío no produce una clave vacía', () => {
  // Una clave "" también es ilegal en RTDB: hay que reemplazarla, no dejarla.
  for (const n of ['...', '#', '', null, undefined, '   ', '$/[]']) {
    const clave = claveSeguraRTDB(n);
    assert.strictEqual(clave, CLAVE_SIN_NOMBRE);
    assert.ok(esClaveValidaRTDB(clave));
  }
});

check('el nombre actual y el histórico de M.PAGO dan la MISMA clave', () => {
  assert.strictEqual(claveSeguraRTDB('PREPAGO M.PAGO'), 'PREPAGO MPAGO');
  assert.strictEqual(claveSeguraRTDB('PREPAGO M.PAGO'), claveSeguraRTDB('PREPAGO MPAGO'));
});

// ---------------------------------------------------------------------------
console.log('\n2. Los totales por medio de pago:');

check('suma igual que siempre para una venta normal', () => {
  const t = totalesPorMedioDePago([
    { payments: [{ method: 'Efectivo', amount: 1000 }] },
    { payments: [{ method: 'Efectivo', amount: 500 }, { method: 'Transferencia', amount: 2000 }] },
  ]);
  assert.deepStrictEqual(t, { Efectivo: 1500, Transferencia: 2000 });
});

check('un cierre con PREPAGO MPAGO funciona', () => {
  const t = totalesPorMedioDePago([
    { payments: [{ method: 'Efectivo', amount: 962700 }] },
    { payments: [{ method: 'PREPAGO MPAGO', amount: 31200 }] },
    { payments: [{ method: 'PREPAGO MPAGO', amount: 6000 }] },
  ]);
  assert.deepStrictEqual(t, { Efectivo: 962700, 'PREPAGO MPAGO': 37200 });
  assert.deepStrictEqual(clavesInvalidasDe(t), []);
});

check('un cierre con el histórico PREPAGO M.PAGO tampoco falla', () => {
  // Es EXACTAMENTE el turno 103 de Achaval: esto es lo que rompía.
  const t = totalesPorMedioDePago([
    { payments: [{ method: 'Efectivo', amount: 962700 }] },
    { payments: [{ method: 'Transferencia', amount: 645100 }] },
    { payments: [{ method: 'PREPAGO PEDIDOSYA', amount: 18500 }] },
    { payments: [{ method: 'PREPAGO M.PAGO', amount: 31200 }] },
    { payments: [{ method: 'PREPAGO M.PAGO', amount: 6000 }] },
  ]);
  assert.deepStrictEqual(t, {
    Efectivo: 962700, Transferencia: 645100,
    'PREPAGO PEDIDOSYA': 18500, 'PREPAGO MPAGO': 37200,
  });
  assert.deepStrictEqual(clavesInvalidasDe(t), []);
  assert.strictEqual(Object.values(t).reduce((a, b) => a + b, 0), 1663500);
});

check('los dos nombres de M.PAGO en el MISMO turno caen en una sola clave', () => {
  const t = totalesPorMedioDePago([
    { payments: [{ method: 'PREPAGO M.PAGO', amount: 1000 }] },
    { payments: [{ method: 'PREPAGO MPAGO', amount: 500 }] },
  ]);
  assert.deepStrictEqual(t, { 'PREPAGO MPAGO': 1500 }, 'no se pueden contar por separado');
});

check('un cierre con . # $ / [ ] en el nombre no falla', () => {
  const t = totalesPorMedioDePago([
    { payments: [{ method: 'TRANSF. 6', amount: 100 }] },
    { payments: [{ method: 'BANCO #2', amount: 200 }] },
    { payments: [{ method: 'MP $', amount: 300 }] },
    { payments: [{ method: 'A/B', amount: 400 }] },
    { payments: [{ method: 'CTA [1]', amount: 500 }] },
  ]);
  assert.deepStrictEqual(clavesInvalidasDe(t), [], 'quedó una clave imposible');
  assert.strictEqual(Object.values(t).reduce((a, b) => a + b, 0), 1500, 'no se perdió plata');
});

check('tolera ventas sin pagos, pagos nulos e importes no numéricos', () => {
  const t = totalesPorMedioDePago([
    null, {}, { payments: null }, { payments: [null] },
    { payments: [{ method: 'Efectivo', amount: '250' }] },
    { payments: [{ method: 'Efectivo', amount: undefined }] },
  ]);
  assert.deepStrictEqual(t, { Efectivo: 250 });
});

// ---------------------------------------------------------------------------
console.log('\n3. La validación del payload:');

check('detecta una clave imposible en el primer nivel', () => {
  assert.deepStrictEqual(clavesInvalidasDe({ 'A.B': 1 }), ['A.B']);
});

check('la detecta también anidada y dentro de arrays', () => {
  assert.deepStrictEqual(clavesInvalidasDe({ cierreTotalesPorPago: { 'PREPAGO M.PAGO': 1 } }),
    ['cierreTotalesPorPago.PREPAGO M.PAGO']);
  assert.deepStrictEqual(clavesInvalidasDe({ CAJAFUERTE: [null, { 'a#b': 1 }] }),
    ['CAJAFUERTE[1].a#b']);
});

check('una clave vacía también es inválida', () => {
  assert.deepStrictEqual(clavesInvalidasDe({ '': 1 }), ['']);
});

check('un payload sano no reporta nada', () => {
  assert.deepStrictEqual(clavesInvalidasDe({
    estado: 'cerrado', cierreTotalVentas: 1663500,
    cierreTotalesPorPago: { Efectivo: 962700, 'PREPAGO MPAGO': 37200 },
    gastos: { 485: { monto: 8400 } }, CAJAFUERTE: [null, { valor: 50000 }],
  }), []);
});

check('validarPayloadDeCierre lanza CierreInvalidoError y NO marca datos movidos', () => {
  let capturado = null;
  try { validarPayloadDeCierre({ cierreTotalesPorPago: { 'X.Y': 1 } }); }
  catch (e) { capturado = e; }
  assert.ok(capturado instanceof CierreInvalidoError, 'no lanzó el error esperado');
  assert.strictEqual(capturado.pedidosYaMovidos, false, 'debe constar que no se tocó nada');
  assert.strictEqual(capturado.faseCierre, 'validacion');
  assert.deepStrictEqual(capturado.claves, ['cierreTotalesPorPago.X.Y']);
  assert.match(capturado.message, /no se pueden guardar/i, 'el mensaje tiene que ser legible');
});

check('el payload que arma el cierre con nombres raros SÍ pasa la validación', () => {
  // El saneo corre antes: para cuando se valida, ya no queda nada imposible.
  const payload = {
    estado: 'cerrado',
    cierreTotalesPorPago: totalesPorMedioDePago([
      { payments: [{ method: 'TRANSF. 6', amount: 100 }] },
      { payments: [{ method: 'BANCO #2', amount: 200 }] },
      { payments: [{ method: 'PREPAGO M.PAGO', amount: 300 }] },
    ]),
  };
  assert.strictEqual(validarPayloadDeCierre(payload), true);
});

// ---------------------------------------------------------------------------
// EL ORDEN DE LOS PASOS.
//
// Es lo único que realmente evita un turno a medias, y no se puede comprobar
// llamando a closeShift (depende de Firebase), así que se verifica sobre el
// código fuente. Si alguien vuelve a poner el borrado antes de la validación,
// esto falla.
// ---------------------------------------------------------------------------
console.log('\n4. La validación ocurre ANTES de limpiar pedidos:');

const fuenteShift = leer('../cash/shift.js');

check('closeShift valida el payload antes de respaldar y borrar', () => {
  const iValida = fuenteShift.indexOf('validarPayloadDeCierre(closingPayload)');
  const iBorra = fuenteShift.indexOf('await backupAndClearOrders(');
  assert.ok(iValida > 0, 'closeShift ya no valida el payload');
  assert.ok(iBorra > 0, 'no se encontró el paso de respaldo/limpieza');
  assert.ok(iValida < iBorra, 'el paso DESTRUCTIVO quedó antes de la validación');
});

check('los totales se arman con las claves saneadas, no con el nombre crudo', () => {
  assert.match(fuenteShift, /totalesPorMedioDePago\(sales\)/, 'volvió a indexar por payment.method');
  assert.ok(!/acc\[payment\.method\]/.test(fuenteShift), 'quedó la indexación cruda que rompió el turno 103');
});

check('el respaldo de pedidos sigue siendo atómico: backup y borrado en el mismo update', () => {
  assert.match(fuenteShift, /updates\[`\$\{backupBasePath\}\/\$\{type\}\/\$\{statusFolder\}\/\$\{item\.id\}`\] = item;/,
    'cambió la escritura del backup del pedido');
  assert.match(fuenteShift, /updates\[`\$\{LOCAL_ID\}\/\$\{path\}\/\$\{item\.id\}`\] = null;/,
    'cambió el borrado del pedido vivo');
  assert.match(fuenteShift, /await update\(ref\(op\.getDatabaseOrAbort\(\)\), updates\)/,
    'el lote dejó de escribirse con un update multipath');
});

check('cada fase deja anotado si los pedidos ya se habían movido', () => {
  assert.match(fuenteShift, /marcarFase\(error, 'respaldo-pedidos', true\)/);
  assert.match(fuenteShift, /marcarFase\(error, 'respaldo-caja', true\)/);
});

console.log('\n5. El error que ve el operador dice qué pasó y en qué punto quedó:');

const fuenteModal = leer('../../../components/cash/CloseShiftModal.jsx');

check('el toast muestra el motivo real, no un texto fijo', () => {
  assert.match(fuenteModal, /error\?\.message/, 'volvió al mensaje genérico');
  assert.ok(!/description: 'No se pudo cerrar el turno\.'/.test(fuenteModal),
    'quedó el texto que ocultó el problema del turno 103');
});

check('distingue si los pedidos ya se movieron', () => {
  assert.match(fuenteModal, /error\?\.pedidosYaMovidos/);
  assert.match(fuenteModal, /No se movió ningún pedido y el turno sigue abierto/);
});

// ---------------------------------------------------------------------------
console.log('\n6. La cuenta nueva y la histórica son la misma para buscar el alias:');

check('normalizarClaveMedioPago iguala los dos nombres', () => {
  assert.strictEqual(normalizarClaveMedioPago('PREPAGO M.PAGO'), 'PREPAGOMPAGO');
  assert.strictEqual(normalizarClaveMedioPago('PREPAGO MPAGO'), 'PREPAGOMPAGO');
  assert.strictEqual(normalizarClaveMedioPago('PREPAGO M.PAGO'), normalizarClaveMedioPago('PREPAGO MPAGO'));
});

check('y NO iguala cuentas que son distintas de verdad', () => {
  assert.notStrictEqual(normalizarClaveMedioPago('Mercado Pago'), normalizarClaveMedioPago('PREPAGO MPAGO'));
  assert.notStrictEqual(normalizarClaveMedioPago('Transferencia'), normalizarClaveMedioPago('Transferencia 2'));
  assert.notStrictEqual(normalizarClaveMedioPago('PREPAGO RAPPI'), normalizarClaveMedioPago('PREPAGO MPAGO'));
});

const fuenteCuentas = leer('../accountsApi.js');

check('findAccountByExactPaymentMethod prueba primero exacto y después normalizado', () => {
  const i = fuenteCuentas.indexOf('export const findAccountByExactPaymentMethod');
  const cuerpo = fuenteCuentas.slice(i);
  const iExacto = cuerpo.indexOf('data[key].nombre === exactPaymentMethod');
  const iNorm = cuerpo.indexOf('normalizarClaveMedioPago(data[key].nombre) === buscado');
  assert.ok(iExacto > 0, 'se perdió la coincidencia exacta');
  assert.ok(iNorm > 0, 'falta la segunda pasada normalizada');
  assert.ok(iExacto < iNorm, 'la exacta tiene que seguir teniendo prioridad');
});

check('un pedido histórico "PREPAGO M.PAGO" encuentra la cuenta "PREPAGO MPAGO"', () => {
  // Réplica de las dos pasadas, con las CUENTAS reales de un local ya migrado.
  const CUENTAS = {
    'cta-1': { nombre: 'Transferencia', alias: 'ali.transf' },
    'cta-5': { nombre: 'PREPAGO MPAGO', alias: 'ali.mpago', aNombreDe: 'Heladería' },
  };
  const buscar = (metodo) => {
    for (const k in CUENTAS) if (CUENTAS[k].nombre === metodo) return k;
    const buscado = normalizarClaveMedioPago(metodo);
    if (buscado) for (const k in CUENTAS) if (normalizarClaveMedioPago(CUENTAS[k].nombre) === buscado) return k;
    return null;
  };
  assert.strictEqual(buscar('PREPAGO M.PAGO'), 'cta-5', 'el pedido viejo quedaría sin alias');
  assert.strictEqual(buscar('PREPAGO MPAGO'), 'cta-5');
  assert.strictEqual(buscar('Transferencia'), 'cta-1', 'no se rompe lo que ya andaba');
  assert.strictEqual(buscar('Efectivo'), null, 'no puede inventar una cuenta');
});

// ---------------------------------------------------------------------------
console.log('\n7. Mostrador y delivery reconocen los dos nombres:');

const RECONOCE_MPAGO = (metodo) => {
  // La MISMA condición que corre en counterApi.js y NewOrderModal.jsx.
  const m = String(metodo).toUpperCase();
  return m.includes('PREPAGO MPAGO') || m.includes('PREPAGO M.PAGO') || m === 'PREPAGO_MPAGO';
};

check('la condición reconoce el nombre actual, el histórico y la clave del nodo', () => {
  assert.ok(RECONOCE_MPAGO('PREPAGO MPAGO'), 'no reconoce el nombre actual');
  assert.ok(RECONOCE_MPAGO('PREPAGO M.PAGO'), 'no reconoce el histórico');
  assert.ok(RECONOCE_MPAGO('prepago mpago'), 'tiene que ser insensible a mayúsculas');
  assert.ok(RECONOCE_MPAGO('PREPAGO_MPAGO'));
});

check('y NO se confunde con la cuenta "Mercado Pago" ni con los otros prepagos', () => {
  for (const m of ['Mercado Pago', 'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI', 'Efectivo', 'Transferencia']) {
    assert.ok(!RECONOCE_MPAGO(m), `${m} no es M.PAGO`);
  }
});

for (const [archivo, ruta] of [['counterApi.js (mostrador)', '../counterApi.js'],
                               ['NewOrderModal.jsx (delivery)', '../../../components/attention/NewOrderModal.jsx']]) {
  check(`${archivo} escribe el ledger con los dos nombres`, () => {
    const fuente = leer(ruta);
    assert.ok(fuente.includes("methodUpper.includes('PREPAGO MPAGO')"), 'falta el nombre actual');
    assert.ok(fuente.includes("methodUpper.includes('PREPAGO M.PAGO')"), 'falta el histórico');
    assert.match(fuente, /savePrepaymentForApp\('MPAGO'/, 'dejó de escribir el ledger de M.PAGO');
  });
}

check('los dos nombres agrupan como MPAGO en los reportes', () => {
  assert.strictEqual(normalizarPlataforma('PREPAGO MPAGO'), 'MPAGO');
  assert.strictEqual(normalizarPlataforma('PREPAGO M.PAGO'), 'MPAGO');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
