// Fase 2 — punto 11: el precio inválido BLOQUEA el pedido en las rutas reales.
//
// Verifica dos cosas distintas:
//   1. el mensaje identifica producto, Unidad N de M, grupo, opcional y valor;
//   2. la ruta REAL de confirmación de este proyecto lo invoca y corta.
//
// Corre en los tres repos (byte a byte idéntico). Cada uno revisa su propia
// ruta: NewOrderModal en Desktop y Tablet, useOrderHandler en DLV.
//
// Correr con: node src/lib/api/__tests__/bloqueoPrecioInvalido.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluarBloqueoPrecioInvalido, detectarBloqueos, describirBloqueo } from '../bloqueoPrecioInvalido.js';
import { calcularTotalPedido } from '../optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// __tests__ → api → lib → src
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KILO = { id: 'A-0007', nombre: '1 KILO DE HELADO', valor: 14500, quantity: 1 };
const roto = (over = {}) => ({ nombre: 'Rocklets', grupoNombre: 'TOPPING', precio: 'abc', ...over });

console.log('Detección y mensaje:');
check('un precio ilegible bloquea', () => {
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { 'G-TOP': [roto()] } }]);
  assert.strictEqual(r.bloquear, true);
  assert.strictEqual(r.motivos.length, 1);
});
check('el mensaje identifica producto, grupo, opcional y valor inválido', () => {
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { 'G-TOP': [roto()] } }]);
  for (const esperado of ['1 KILO DE HELADO', 'TOPPING', 'Rocklets', 'abc']) {
    assert.ok(r.mensaje.includes(esperado), `falta "${esperado}" en: ${r.mensaje}`);
  }
});
check('el mensaje identifica la Unidad N de M', () => {
  const r = evaluarBloqueoPrecioInvalido([{
    ...KILO, unidadIndice: 2, unidadTotal: 3, selectedOptionals: { 'G-TOP': [roto()] },
  }]);
  assert.ok(r.mensaje.includes('Unidad 2 de 3'), r.mensaje);
});
check('con una sola unidad NO se menciona la unidad', () => {
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, unidadIndice: 1, unidadTotal: 1, selectedOptionals: { 'G-TOP': [roto()] } }]);
  assert.ok(!r.mensaje.includes('Unidad'), r.mensaje);
});
check('informa cada opcional roto, no solo el primero', () => {
  const r = evaluarBloqueoPrecioInvalido([
    { ...KILO, unidadIndice: 1, unidadTotal: 2, selectedOptionals: { 'G-TOP': [roto()] } },
    { ...KILO, unidadIndice: 2, unidadTotal: 2, selectedOptionals: { 'G-EX': [roto({ nombre: 'Oreo', grupoNombre: 'EXTRAS', precio: 'xyz' })] } },
  ]);
  assert.strictEqual(r.motivos.length, 2);
  assert.ok(r.mensaje.includes('Rocklets') && r.mensaje.includes('Oreo'));
  assert.ok(r.titulo.includes('2'), r.titulo);
});
check('detecta también en hijos de promoción, indicando el hijo', () => {
  const r = evaluarBloqueoPrecioInvalido([{
    nombre: 'PROMO 2 KILOS', valor: 25000, quantity: 1, isPromo: true,
    promoItems: [
      { nombre: 'KILO 1', selectedOptionals: { 'G-TOP': [roto()] } },
      { nombre: 'KILO 2', selectedOptionals: { 'G-S': [{ nombre: 'Salsa', precio: 0 }] } },
    ],
  }]);
  assert.strictEqual(r.motivos.length, 1);
  assert.ok(r.mensaje.includes('KILO 1'), r.mensaje);
  assert.strictEqual(r.motivos[0].esHijoDePromo, true);
});

console.log('\nQué NO bloquea:');
check('precio 0 válido no bloquea', () => {
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { 'G-S': [{ nombre: 'Salsa', precio: 0 }] } }]);
  assert.strictEqual(r.bloquear, false);
});
check('opcional histórico SIN precio no bloquea', () => {
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { g: [{ nombre: 'Rocklets' }] } }]);
  assert.strictEqual(r.bloquear, false);
});
check('precio vacío es AUSENTE (gratuito), no inválido', () => {
  // Un campo vacío significa "sin precio configurado" y equivale a gratuito.
  // Lo inválido es un valor presente que no se puede interpretar.
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { g: [{ nombre: 'Salsa', precio: '' }] } }]);
  assert.strictEqual(r.bloquear, false);
});
check('precio válido como string tampoco bloquea', () => {
  const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { g: [roto({ precio: '$ 1.700,00' })] } }]);
  assert.strictEqual(r.bloquear, false);
});
check('pedido sin opcionales no bloquea', () => {
  assert.strictEqual(evaluarBloqueoPrecioInvalido([{ ...KILO }]).bloquear, false);
  assert.strictEqual(evaluarBloqueoPrecioInvalido([]).bloquear, false);
  assert.strictEqual(evaluarBloqueoPrecioInvalido(null).bloquear, false);
});

console.log('\nEl resultado defensivo NO alcanza para dejar pasar el pedido:');
check('el cálculo devuelve 14.500 pero el pedido queda bloqueado igual', () => {
  const items = [{ ...KILO, selectedOptionals: { 'G-TOP': [roto()] } }];
  assert.strictEqual(calcularTotalPedido(items).total, 14500, 'defensivo: no produce NaN');
  assert.strictEqual(evaluarBloqueoPrecioInvalido(items).bloquear, true, 'pero NO se puede confirmar');
});
check('un precio inválido NUNCA se trata como gratuito', () => {
  const b = detectarBloqueos([{ ...KILO, selectedOptionals: { 'G-TOP': [roto()] } }]);
  assert.strictEqual(b.length, 1);
  assert.notStrictEqual(b[0].valorInvalido, '0');
  assert.ok(describirBloqueo(b[0]).includes('precio inválido'));
});
check('valores raros se describen sin romper el mensaje', () => {
  for (const v of [undefined, null, '', {}, -5, 'abc']) {
    const r = evaluarBloqueoPrecioInvalido([{ ...KILO, selectedOptionals: { g: [{ nombre: 'X', precio: v }] } }]);
    if (r.bloquear) assert.ok(!/NaN|undefined|\[object Object\]/.test(r.mensaje), `${v}: ${r.mensaje}`);
  }
});

console.log('\nCableado en la ruta REAL de confirmación de este proyecto:');
const rutas = [
  { archivo: path.join(SRC, 'components/attention/NewOrderModal.jsx'), fn: 'handleConfirmOrder' },
  { archivo: path.join(SRC, 'hooks/useOrderHandler.js'), fn: 'handleCheckout' },
].filter((r) => fs.existsSync(r.archivo));

check('existe la ruta real de confirmación de este proyecto', () => {
  assert.ok(rutas.length > 0, 'no se encontró NewOrderModal ni useOrderHandler');
});
for (const ruta of rutas) {
  const src = fs.readFileSync(ruta.archivo, 'utf8');
  const nombre = path.basename(ruta.archivo);

  check(`${nombre} importa el bloqueo compartido`, () => {
    assert.ok(/evaluarBloqueoPrecioInvalido/.test(src), 'no importa el módulo de bloqueo');
    assert.ok(/from ['"][^'"]*bloqueoPrecioInvalido['"]/.test(src), 'no lo importa del módulo compartido');
  });
  check(`${nombre} lo INVOCA dentro de ${ruta.fn}`, () => {
    const i = src.indexOf(ruta.fn);
    assert.ok(i !== -1, `no se encontró ${ruta.fn}`);
    const cuerpo = src.slice(i, i + 4000);
    assert.ok(cuerpo.includes('evaluarBloqueoPrecioInvalido('), 'la confirmación no evalúa el bloqueo');
  });
  check(`${nombre} CORTA la confirmación cuando bloquea`, () => {
    const i = src.indexOf('evaluarBloqueoPrecioInvalido(');
    const cuerpo = src.slice(i, i + 600);
    assert.ok(/if\s*\(\s*bloqueo\.bloquear\s*\)/.test(cuerpo), 'no comprueba bloqueo.bloquear');
    assert.ok(/return/.test(cuerpo), 'no corta el flujo');
  });
  check(`${nombre} avisa al operador con el detalle`, () => {
    const i = src.indexOf('evaluarBloqueoPrecioInvalido(');
    const cuerpo = src.slice(i, i + 600);
    assert.ok(cuerpo.includes('bloqueo.mensaje'), 'no muestra el mensaje con el detalle');
    assert.ok(cuerpo.includes('bloqueo.titulo'));
  });
}
check('el bloqueo ocurre ANTES de cualquier escritura', () => {
  for (const ruta of rutas) {
    const src = fs.readFileSync(ruta.archivo, 'utf8');
    const iBloqueo = src.indexOf('evaluarBloqueoPrecioInvalido(');
    for (const escritura of ['saveOrder(', 'updateOrder(', 'saveOrderToFirebase(', 'onOrderCreated(', 'construirItemsParaFirebase(']) {
      const iEscritura = src.indexOf(escritura);
      if (iEscritura === -1) continue;
      assert.ok(iBloqueo < iEscritura, `${path.basename(ruta.archivo)}: ${escritura} aparece antes del bloqueo`);
    }
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
