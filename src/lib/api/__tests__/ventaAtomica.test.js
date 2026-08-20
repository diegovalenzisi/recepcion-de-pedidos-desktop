// UNA VENTA ACTIVA ES UNA SOLA ESCRITURA. UNA ANULACIÓN ACTIVA TAMBIÉN.
//
// EL BUG QUE ESTO IMPIDE QUE VUELVA
// ---------------------------------
// Una venta con la contabilidad activa eran TRES escrituras separadas:
//
//     1. runTransaction(COMISIONES/TOTALES/totalAcumulado)
//     2. set(COMISIONES/REGISTRO/{ventaKey})
//     3. update(MOVIMIENTOS/V-… + TOTALES)
//
// Un corte entre 2 y 3 dejaba el registro escrito con la deuda sin subir. Y era
// IRRECUPERABLE: al reintentar, la deduplicación del principio encuentra el
// registro ya existente y devuelve sin crear el movimiento. La comisión se
// perdía en silencio — el mismo daño que la colisión de Il Capo, por otra causa.
//
// Ahora el registro viaja DENTRO del `update()` del plan: o entra todo, o no
// entra nada, y un reintento choca contra la regla create-only sin dejar a
// medias ni el registro ni los acumuladores.
//
// Estas pruebas son ESTRUCTURALES a propósito: leen el código y verifican que
// no exista ningún camino activo que escriba REGISTRO por separado. La prueba
// de comportamiento contra la base real está en comisionEmulator.integration.mjs.
//
// Correr con: node src/lib/api/__tests__/ventaAtomica.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  planDeVenta, planDeAnulacion, deltasDeVenta, deltasDeAnulacion,
  tieneEfectoContable, aCentavos,
} from '../comisionMovimiento.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const fuente = readFileSync(new URL('../comisionesApi.js', import.meta.url), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Cuerpo de una función exportada, hasta la siguiente. */
const cuerpoDe = (nombre) => {
  const i = fuente.indexOf(`export const ${nombre}`);
  assert.ok(i > 0, `no encuentro ${nombre}`);
  const j = fuente.indexOf('\nexport const ', i + 10);
  return fuente.slice(i, j > 0 ? j : fuente.length);
};

/** El tramo del camino ACTIVO: entre `if (activa)` y la marca del dormido. */
const caminoActivo = (nombre) => {
  const cuerpo = cuerpoDe(nombre);
  const i = cuerpo.indexOf('if (activa)');
  const j = cuerpo.indexOf('CAMINO DORMIDO');
  assert.ok(i > 0, `${nombre}: no hay bifurcación por contabilidad activa`);
  assert.ok(j > i, `${nombre}: no está marcado el camino dormido`);
  return sinComentarios(cuerpo.slice(i, j));
};

const escriturasDe = (txt) => (txt.match(/await (set|update|runTransaction|aplicarPlan|aplicarPlanCompleto)\b/g) || [])
  .map((s) => s.replace('await ', ''));

// ---------------------------------------------------------------------------
console.log('\n1. VENTA activa: una sola escritura, con el registro adentro:');

check('el camino activo no usa runTransaction', () => {
  const activo = caminoActivo('registrarComision');
  assert.ok(!activo.includes('runTransaction'),
    'volvió la transacción sobre totalAcumulado: eso son dos escrituras');
});

check('el camino activo NO escribe totalAcumulado (pesos, legado)', () => {
  const activo = caminoActivo('registrarComision');
  assert.ok(!activo.includes('totalAcumulado'),
    'el contador legado en pesos tiene que quedar congelado con la contabilidad activa');
});

check('el REGISTRO viaja como extra del MISMO update() del plan', () => {
  const activo = caminoActivo('registrarComision');
  assert.match(activo, /aplicarPlan\([\s\S]*planDeVenta\(\{[\s\S]*\}\),\s*\{\s*\[rutaRegistro\]:\s*registro,?\s*\}/,
    'el registro ya no entra dentro de la escritura del plan');
});

check('solo se ejecuta UNA escritura por venta', () => {
  const activo = caminoActivo('registrarComision');
  const escrituras = escriturasDe(activo);
  // Dos ramas EXCLUYENTES: comisión 0 → set del registro solo; si no →
  // aplicarPlan con el registro adentro. Nunca las dos.
  assert.deepStrictEqual(escrituras, ['set', 'aplicarPlan'],
    `escrituras encontradas: ${escrituras.join(', ')}`);
  assert.match(activo, /if \(!tieneEfectoContable\(deltasDeVenta\(comisionCentavos\)\)\) \{[\s\S]*?await set\([\s\S]*?return;\s*\}/,
    'la rama de comisión 0 no corta con return: podrían ejecutarse las dos');
});

check('el registro activo lleva su opId', () => {
  assert.match(caminoActivo('registrarComision'), /datosDelRegistro\(\{ opId: opIdDeVenta \}\)/);
});

// ---------------------------------------------------------------------------
console.log('\n2. ANULACIÓN activa: una sola escritura, con el estado adentro:');

check('el camino activo no usa runTransaction', () => {
  assert.ok(!caminoActivo('cancelarComision').includes('runTransaction'),
    'volvió la transacción sobre totalAcumulado');
});

check('el estado cancelada viaja como extra del MISMO update() del plan', () => {
  const activo = caminoActivo('cancelarComision');
  assert.match(activo, /aplicarPlan\([\s\S]*planDeAnulacion\(\{[\s\S]*\}\),\s*detalleCancelacion,?\s*\)/,
    'el estado del registro ya no entra dentro de la escritura del plan');
});

check('solo se ejecuta UNA escritura por anulación', () => {
  const escrituras = escriturasDe(caminoActivo('cancelarComision'));
  // Dos ramas excluyentes: con efecto contable → aplicarPlan; sin efecto (o sin
  // canal conocido) → update del detalle solo.
  assert.deepStrictEqual(escrituras, ['aplicarPlan', 'update'],
    `escrituras encontradas: ${escrituras.join(', ')}`);
  assert.match(caminoActivo('cancelarComision'), /\} else \{[\s\S]*?await update\(/,
    'las dos escrituras no están en ramas excluyentes');
});

check('si el llamador no informa el canal, se toma del propio registro', () => {
  // Sin canal no hay opId y la deuda no bajaría: es el agujero que esto cierra.
  assert.match(caminoActivo('cancelarComision'),
    /const modoEfectivo = modoVenta \?\? registro\.canal \?\? registro\.modoVenta/);
});

// ---------------------------------------------------------------------------
console.log('\n3. Ningún otro camino activo escribe REGISTRO por su cuenta:');

check('REGISTRO solo se escribe en el plan, o en el camino dormido', () => {
  // Se ubica sobre la fuente CRUDA: el marcador del camino dormido vive en un
  // comentario, así que despojarlos primero lo haría invisible.
  const sospechosas = [];
  const re = /await (set|update)\(([^;]*?)\);/gs;
  let m;
  while ((m = re.exec(fuente)) !== null) {
    if (!/REGISTRO|rutaRegistro|freshRegistroRef|detalleCancelacion/.test(m[2])) continue;
    const antes = fuente.slice(0, m.index);
    // Una escritura suelta de REGISTRO solo es legítima si el último hito antes
    // de ella es el del camino dormido, o si es el detalle que viaja adentro
    // del plan de anulación.
    const enDormido = antes.lastIndexOf('CAMINO DORMIDO') > antes.lastIndexOf('if (activa)');
    const esDetalle = /detalleCancelacion/.test(m[2]);
    // Comisión 0: no hay movimiento con el cual empaquetarla, así que el
    // registro se escribe solo. Sigue siendo UNA escritura y no mueve deuda.
    const esComisionCero = antes.lastIndexOf('!tieneEfectoContable') > antes.lastIndexOf('if (activa)');
    if (!enDormido && !esDetalle && !esComisionCero) {
      sospechosas.push(m[0].slice(0, 60).split('\n').join(' '));
    }
  }
  assert.deepStrictEqual(sospechosas, [],
    `hay escrituras de REGISTRO fuera del plan en un camino activo:\n${sospechosas.join('\n')}`);
});

check('el pago activo sigue siendo una sola escritura, sin regresiones', () => {
  const cuerpo = cuerpoDe('registrarPagoComision');
  const i = cuerpo.indexOf('if (contabilidadActiva(totales) && idPagoIntento)');
  const j = cuerpo.indexOf('CAMINO DORMIDO', i);
  assert.ok(i > 0 && j > i, 'no encuentro la bifurcacion del pago');
  const activo = sinComentarios(cuerpo.slice(i, j));
  assert.deepStrictEqual(escriturasDe(activo), ['aplicarPlanCompleto'],
    'el pago activo dejó de ser una sola escritura');
});

// ---------------------------------------------------------------------------
console.log('\n4. Los planes siguen siendo independientes por canal:');

check('M50 y D50 producen movimientos distintos', () => {
  const m = planDeVenta({ localId: 'L', modoVenta: 'mostrador', idVenta: 50, comisionCentavos: 100 });
  const d = planDeVenta({ localId: 'L', modoVenta: 'delivery', idVenta: 50, comisionCentavos: 100 });
  assert.strictEqual(m.opId, 'V-M50');
  assert.strictEqual(d.opId, 'V-D50');
  assert.notStrictEqual(m.movimiento.ruta, d.movimiento.ruta);
});

check('anular M50 no toca el movimiento de D50', () => {
  const m = planDeAnulacion({ localId: 'L', modoVenta: 'mostrador', idVenta: 50, comisionCentavos: 100 });
  const d = planDeAnulacion({ localId: 'L', modoVenta: 'delivery', idVenta: 50, comisionCentavos: 100 });
  assert.strictEqual(m.opId, 'A-M50');
  assert.strictEqual(d.opId, 'A-D50');
});

check('una venta de comisión 0 no tiene efecto contable', () => {
  assert.strictEqual(tieneEfectoContable(deltasDeVenta(0)), false);
  assert.strictEqual(tieneEfectoContable(deltasDeAnulacion(0)), false);
  assert.strictEqual(tieneEfectoContable(deltasDeVenta(aCentavos(0.01))), true);
});

// ---------------------------------------------------------------------------
console.log('\n5. ANULAR UNA VENTA PARCIALMENTE PAGADA no devuelve lo ya cobrado:');
// ---------------------------------------------------------------------------
//
// Anular resta lo que la venta TODAVÍA DEBE, no la comisión completa. Es el
// mismo criterio que ya rige para una venta 'pagada', que directamente no se
// anula: la comisión ya cobrada no vuelve.
//
//     comisión 100, pagado 40, pendiente 60  →  anular resta 60
//     queda: acumulado 40, pagado 40, saldo 0
//
// Restar los 100 le daría al local crédito por plata que ya cobramos y, si no
// hubiera otra deuda, dejaría el saldo negativo: las reglas rechazarían la
// escritura entera y la anulación fallaría del todo.

/** La misma lectura que hace el código: entero si está, pesos si es legado. */
const pendienteDe = (registro) => {
  const enCentavos = (pesos, centavos) => (Number.isInteger(centavos) ? centavos : aCentavos(pesos));
  if (registro.estado === 'pagada_parcial') {
    return enCentavos(registro.saldoPendiente, registro.saldoPendienteCentavos);
  }
  return enCentavos(registro.comisionGenerada, registro.comisionGeneradaCentavos);
};

check('el código usa el PENDIENTE para los deltas, no la comisión completa', () => {
  const activo = caminoActivo('cancelarComision');
  assert.match(activo, /const pendienteCentavos = registro\.estado === 'pagada_parcial'/,
    'no se calcula el pendiente');
  assert.match(activo, /tieneEfectoContable\(deltasDeAnulacion\(pendienteCentavos\)\)/,
    'la decisión de emitir movimiento sigue mirando la comisión completa');
  assert.match(activo, /comisionCentavos: pendienteCentavos/,
    'el plan de anulación sigue restando la comisión completa');
});

check('el pendiente sale del registro, nunca de un porcentaje', () => {
  const activo = caminoActivo('cancelarComision');
  assert.ok(!/porcentaje/i.test(activo), 'apareció el porcentaje en el camino de anulación');
  assert.match(activo, /registro\.saldoPendienteCentavos/);
  assert.match(activo, /registro\.saldoPendiente\b/);
});

check('PENDIENTE normal: se resta la comisión entera', () => {
  const reg = { estado: 'pendiente', comisionGenerada: 100, comisionGeneradaCentavos: 10000 };
  const d = deltasDeAnulacion(pendienteDe(reg));
  assert.deepStrictEqual(d, { dHist: -10000, dSaldo: -10000, dPagado: 0 });
});

check('PAGADA_PARCIAL: se resta solo lo pendiente, y lo pagado queda', () => {
  // comisión 100, pagado 40, pendiente 60
  const reg = { estado: 'pagada_parcial', saldoPendiente: 60, saldoPendienteCentavos: 6000 };
  const d = deltasDeAnulacion(pendienteDe(reg));
  assert.deepStrictEqual(d, { dHist: -6000, dSaldo: -6000, dPagado: 0 },
    'no puede tocar totalPagado: esa plata ya se cobró');

  // Partiendo de acumulado 10000 / pagado 4000 / saldo 6000:
  const acumulado = 10000 + d.dHist;
  const pagado = 4000 + d.dPagado;
  const saldo = 6000 + d.dSaldo;
  assert.deepStrictEqual({ acumulado, pagado, saldo }, { acumulado: 4000, pagado: 4000, saldo: 0 });
  assert.strictEqual(acumulado - pagado, saldo, 'la identidad contable se rompe');
});

check('PAGADA_PARCIAL legada (solo pesos): se convierte, no se recalcula', () => {
  const reg = { estado: 'pagada_parcial', saldoPendiente: 60 };
  assert.strictEqual(pendienteDe(reg), 6000);
});

check('el caso real de produccion (drift de coma flotante) da 0 y no rompe', () => {
  // Il Capo tiene un registro con saldoPendiente: 1.674e-11 — un resto de una
  // resta en pesos. Redondea a 0 centavos: anularlo no mueve nada.
  const reg = { estado: 'pagada_parcial', saldoPendiente: 1.674038685450796e-11 };
  assert.strictEqual(pendienteDe(reg), 0);
  assert.strictEqual(tieneEfectoContable(deltasDeAnulacion(0)), false,
    'una anulación sin nada pendiente no debe emitir movimiento');
});

check('PAGADA total: el código ni siquiera llega a anular', () => {
  // La guarda existe desde antes y no se tocó: es la que sostiene el criterio
  // de que la comisión ya cobrada no se devuelve.
  const cuerpo = cuerpoDe('cancelarComision');
  assert.match(cuerpo, /if \(registro\.estado === 'pagada'\) \{[\s\S]*?return;/,
    'se perdió la guarda que impide anular una venta ya pagada');
});

check('anular dos veces resta una sola vez', () => {
  // `A-{ventaKey}` es único por venta: el segundo intento choca contra la regla
  // create-only y no vuelve a descontar. Verificado contra el emulador en
  // comisionEmulator.integration.mjs; acá se fija la identidad.
  const a = planDeAnulacion({ localId: 'L', modoVenta: 'mostrador', idVenta: 1165, comisionCentavos: 6000 });
  const b = planDeAnulacion({ localId: 'L', modoVenta: 'mostrador', idVenta: 1165, comisionCentavos: 6000 });
  assert.strictEqual(a.opId, b.opId);
  assert.strictEqual(a.movimiento.ruta, b.movimiento.ruta);
});

check('la comisión ORIGINAL queda registrada en el movimiento, para auditar', () => {
  assert.match(caminoActivo('cancelarComision'), /comisionOriginalCentavos: comisionCentavos/,
    'sin eso no se puede saber cuánto se había pagado antes de anular');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
