// BLOQUEO DE MANTENIMIENTO — la barrera real durante el reset.
//
// Mientras "Finalizar pruebas" corre, ninguna operación comercial nueva puede
// entrar: una venta creada a mitad del reset no está en el respaldo y su stock
// no cuadra con el estado base.
//
// Estos tests cubren la decisión (pura) y el cableado en los puntos de entrada
// reales, incluido el motor de facturación, que es un proceso aparte.
//
// Correr con: node src/lib/api/__tests__/mantenimiento.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  RUTA_MANTENIMIENTO, MENSAJE_MANTENIMIENTO,
  MantenimientoActivoError, esErrorDeMantenimiento, bloquea,
} from '../mantenimiento.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
console.log('\n1. La decisión: qué bloquea y qué no:');

check('mantenimiento APAGADO → la operación pasa', () => {
  for (const flag of [null, undefined, false, {}, { activo: false }, { activo: 'true' }, { activo: 1 }, 0, '']) {
    assert.strictEqual(bloquea(flag), false, `${JSON.stringify(flag)} bloqueó de más`);
  }
});

check('mantenimiento ENCENDIDO → la operación se bloquea', () => {
  assert.strictEqual(bloquea({ activo: true }), true);
  assert.strictEqual(bloquea({ activo: true, resetId: 'reset-x', desde: '…' }), true);
  assert.strictEqual(bloquea(true), true);
});

check('el bloqueo tiene que ser EXPLÍCITO: nada ambiguo bloquea', () => {
  // Un objeto raro en CONFIGURACION no puede dejar al comercio sin vender.
  for (const flag of [{ otra: 'cosa' }, { activo: null }, [], 'activo', 42]) {
    assert.strictEqual(bloquea(flag), false, `${JSON.stringify(flag)} bloqueó`);
  }
});

check('la ruta del flag vive FUERA del nodo del local', () => {
  // Esencial: la restauración reemplaza /{localId} entero. Un flag adentro se
  // borraría a sí mismo a mitad de la escritura y las guardas dejarían de verlo.
  assert.strictEqual(RUTA_MANTENIMIENTO('58290322'), 'BACKUP/58290322/MANTENIMIENTO');
  assert.ok(!RUTA_MANTENIMIENTO('58290322').startsWith('58290322/'), 'quedó dentro del local');
});

check('el error se distingue de cualquier otro', () => {
  const e = new MantenimientoActivoError();
  assert.strictEqual(e.code, 'MANTENIMIENTO_ACTIVO');
  assert.strictEqual(e.message, MENSAJE_MANTENIMIENTO);
  assert.strictEqual(esErrorDeMantenimiento(e), true);
  assert.strictEqual(esErrorDeMantenimiento(new Error('otra cosa')), false);
  assert.strictEqual(esErrorDeMantenimiento(null), false);
});

check('el módulo de la decisión es PURO', () => {
  const src = leer('../mantenimiento.js');
  assert.ok(!/^import /m.test(src), 'el módulo puro tiene imports');
});

check('el mensaje al usuario es uno solo, y es el pedido', () => {
  assert.strictEqual(MENSAJE_MANTENIMIENTO,
    'El sistema se encuentra en mantenimiento. Esperá unos segundos.');
});

check('un fallo de lectura NO bloquea', () => {
  // Deliberado: el mantenimiento dura segundos y ocurre con el comercio
  // cerrado. Bloquear una venta real por un error de red sería peor.
  const src = leer('../mantenimientoApi.js');
  assert.match(src, /catch\s*\{\s*return false;\s*\}/, 'un error de lectura bloquearía');
});

check('se consulta con get puntual, no con un listener', () => {
  // Un onValue de precarga fue lo que colgó el stock una vez.
  const src = leer('../mantenimientoApi.js');
  assert.ok(!/onValue/.test(src), 'usa un listener');
  assert.match(src, /await get\(ref\(db, RUTA_MANTENIMIENTO/);
});

// ---------------------------------------------------------------------------
console.log('\n2. Puntos de entrada protegidos:');

const PUNTOS = [
  ['venta de mostrador',        '../counterApi.js',        'saveCounterSale'],
  ['anulación de mostrador',    '../counterApi.js',        'cancelCounterSale'],
  ['alta de pedido',            '../ordersApi.js',         'saveOrder'],
  ['apertura de caja',          '../cash/shift.js',        'createNewShift'],
  ['cierre de caja',            '../cash/shift.js',        'closeShift'],
  ['fondo inicial de caja',     '../cash/fund.js',         'setInitialCashFund'],
  ['movimiento de caja',        '../expensesApi.js',       'addExpenseToShift'],
  ['baja de movimiento',        '../expensesApi.js',       'deleteExpenseFromShift'],
  ['stock de un pedido',        '../transactionsApi.js',   'processStockForDeliveredOrder'],
  ['stock de mostrador',        '../transactionsApi.js',   'processStockForCounterSale'],
  ['reversión de stock',        '../transactionsApi.js',   'reverseStockForCounterSale'],
];

for (const [nombre, archivo, funcion] of PUNTOS) {
  check(`${nombre}: la guarda corre ANTES de escribir`, () => {
    const src = leer(archivo);
    const i = src.indexOf(`export const ${funcion} =`);
    assert.ok(i > 0, `no se encontró ${funcion}`);
    const cuerpo = src.slice(i, i + 1400);
    const iGuarda = cuerpo.indexOf('await asegurarOperable(');
    assert.ok(iGuarda > 0, `${funcion} no tiene la guarda`);
    // Antes de la guarda no puede haber ninguna escritura.
    const antes = cuerpo.slice(0, iGuarda);
    for (const escritura of ['await set(', 'await update(', 'await push(', 'await remove(', 'runTransaction(']) {
      assert.ok(!antes.includes(escritura), `${funcion} escribe (${escritura}) antes de la guarda`);
    }
  });
}

check('los diez puntos importan la guarda del módulo único', () => {
  const archivos = [...new Set(PUNTOS.map(([, a]) => a))];
  for (const a of archivos) {
    const src = leer(a);
    assert.ok(src.includes("asegurarOperable } from '") && src.includes("mantenimientoApi'"),
      `${a} no importa la guarda`);
  }
});

check('las guardas estan en los modulos que la app IMPORTA, no en homonimos muertos', () => {
  // Habia dos addExpenseToShift: cash/expense.js (que nadie importa y Vite
  // elimina del bundle) y expensesApi.js (el real, usado por counterApi, hrApi
  // y ExpensesPage). La guarda quedo primero en el muerto: en la app compilada
  // los movimientos de caja NO estaban protegidos.
  const fuentes = ['../counterApi.js', '../hrApi.js', '../../../pages/ExpensesPage.jsx'];
  for (const f of fuentes) {
    let src; try { src = leer(f); } catch { continue; }
    if (!src.includes('addExpenseToShift')) continue;
    assert.ok(src.includes("from './expensesApi'") || src.includes("from '@/lib/api/expensesApi'"),
      `${f} importa addExpenseToShift de otro modulo que el guardado`);
  }
  // Y el modulo real tiene la guarda.
  const real = leer('../expensesApi.js');
  assert.ok(real.includes('asegurarOperable'), 'expensesApi.js no tiene la guarda');
});

check('la ruta del flag NO está duplicada: el que restaura la importa', () => {
  const api = leer('../imagenLocalApi.js');
  assert.ok(api.includes("RUTA_MANTENIMIENTO } from './mantenimiento'"), 'no la importa');
  assert.ok(!/export const RUTA_MANTENIMIENTO/.test(api), 'define su propia ruta');
});

// ---------------------------------------------------------------------------
console.log('\n3. El lock y la restauracion completa:');

const API = leer('../imagenLocalApi.js');

check('lo levanta y CONFIRMA antes de leer la imagen y de escribir', () => {
  const cuerpo = API.slice(API.indexOf('export const restaurarImagen'));
  const iLock = cuerpo.indexOf('RUTA_MANTENIMIENTO(localId)), {');
  const iConfirma = cuerpo.indexOf('confirmado.activo !== true');
  const iLeer = cuerpo.indexOf('RUTA_IMAGEN(localId)');
  const iEscribir = cuerpo.indexOf('await update(ref(db), updates)');
  assert.ok(iLock > 0, 'no levanta el flag');
  assert.ok(iConfirma > iLock, 'no verifica que el lock haya quedado puesto');
  assert.ok(iLeer > iConfirma, 'lee la imagen antes de confirmar el bloqueo');
  assert.ok(iEscribir > iLock, 'escribe antes de bloquear');
});

check('lo libera SIEMPRE: en el camino feliz y en el catch', () => {
  const n = (API.match(/await liberarLock()/g) || []).length;
  assert.ok(n >= 2, 'solo ' + n + ' liberaciones');
  const iCatch = API.indexOf('} catch (e) {');
  assert.ok(iCatch > 0 && API.slice(iCatch).includes('await liberarLock()'),
    'el catch no libera el bloqueo');
});

check('liberar es escribir null, no activo:false', () => {
  assert.ok(API.includes('RUTA_MANTENIMIENTO(localId)), null)'), 'no lo borra');
});

check('una falla al liberar no tumba la restauración', () => {
  const i2 = API.indexOf('const liberarLock');
  assert.match(API.slice(i2, i2 + 300), /catch/);
});

// ---------------------------------------------------------------------------
console.log('\n4. El motor de facturación (proceso aparte):');

for (const motor of ['responsable-inscripto', 'monotributo']) {
  const src = leer(`../../../../resources/facturacion/${motor}/index.mjs`);

  check(`${motor}: consulta el flag antes de tocar el pedido`, () => {
    assert.match(src, /async function hayMantenimiento\(\)/, 'no sabe leer el flag');
    assert.ok(src.includes('BACKUP/') && src.includes('/MANTENIMIENTO'), 'no mira la ruta nueva del flag');
    const i = src.indexOf('async function procesarSnapshot');
    const cuerpo = src.slice(i, i + 900);
    const iGuarda = cuerpo.indexOf('if (await hayMantenimiento())');
    assert.ok(iGuarda > 0, 'no consulta el flag');
    // La guarda va ANTES del claim: no se reclama el pedido.
    const iClaim = cuerpo.indexOf('CLAIM');
    assert.ok(iClaim === -1 || iGuarda < iClaim, 'reclama el pedido antes de mirar el flag');
  });

  check(`${motor}: el pedido NO se pierde ni se marca procesado`, () => {
    const i = src.indexOf('if (await hayMantenimiento())');
    const bloque = src.slice(i, i + 400);
    // Sale sin tocar nada.
    assert.match(bloque, /return;/, 'no corta el procesamiento');
    assert.ok(!/pedidosYaFacturados\.add|snapshot\.ref\.remove|\.set\(/.test(bloque),
      'marca el pedido o lo borra durante el mantenimiento');
    // Y lo reintenta cuando el mantenimiento termina.
    assert.match(bloque, /reintentarTrasMantenimiento\(snapshot\)/, 'no lo reintenta: quedaría parado');
  });

  check(`${motor}: el reintento está acotado`, () => {
    assert.match(src, /MANTENIMIENTO_REINTENTOS = \d+/, 'reintentaría para siempre');
    assert.match(src, /MANTENIMIENTO_ESPERA_MS/, 'no espera entre reintentos');
    assert.match(src, /se agotaron los reintentos/, 'no avisa al agotarse');
  });

  check(`${motor}: un fallo de lectura del flag no detiene la facturación`, () => {
    const i = src.indexOf('async function hayMantenimiento');
    const cuerpo = src.slice(i, i + 500);
    assert.match(cuerpo, /catch\s*\{\s*return false;\s*\}/, 'dejaría de facturar ante un error de red');
  });
}

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
