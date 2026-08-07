// El switch de facturación de ESTA PC.
//
// Regla: campo ausente = ON. Sólo un OFF expreso frena la facturación, y ese OFF
// se respeta en todos los arranques siguientes.
//
// Correr con: node src/lib/api/__tests__/switchFacturacion.test.js
import assert from 'node:assert';
import {
  facturacionActivaEnEstaPC,
  aplicarSwitchFacturacion,
  clavesDeProceso,
  cuentasFiscales,
} from '../switchFacturacion.js';
import { migrarPoliticaAutoStart, facturacionHabilitada } from '../../../../electron/lib/decidirArranqueFacturacion.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const localMono = () => ({
  tipo: 'monotributo',
  monotributo: { cuentas: [{ id: 1, nombre: 'Transferencia' }, { id: 2, nombre: 'Transferencia 2' }] },
});
const localRI = () => ({ tipo: 'responsable_inscripto', ri: { nombre: 'RI' } });

/** Cerrar y volver a abrir: el config se relee tal cual quedó en disco. */
const reiniciar = (cfg) => JSON.parse(JSON.stringify(cfg));

// ---------------------------------------------------------------------------
console.log('\nValor por defecto:');

check('campo inexistente → el switch se ve en ON', () => {
  assert.strictEqual(facturacionActivaEnEstaPC(localMono()), true);
  assert.strictEqual(facturacionActivaEnEstaPC(localRI()), true);
});

check('una PC sin cuentas configuradas también se ve en ON', () => {
  assert.strictEqual(facturacionActivaEnEstaPC({}), true);
});

check('`activo:false` viejo no apaga el switch', () => {
  const cfg = localMono();
  cfg.monotributo.cuentas[0].activo = false;
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), true);
});

// ---------------------------------------------------------------------------
console.log('\nApagar y prender:');

check('OFF apaga TODAS las cuentas de la PC', () => {
  const cfg = aplicarSwitchFacturacion(localMono(), false);
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), false);
  for (const c of cuentasFiscales(cfg)) {
    assert.strictEqual(c.facturacionAutomatica, false);
    assert.strictEqual(facturacionHabilitada(c), false, 'el arranque tiene que verlo apagado');
  }
});

check('ON vuelve a encender todas', () => {
  const cfg = aplicarSwitchFacturacion(aplicarSwitchFacturacion(localMono(), false), true);
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), true);
  for (const c of cuentasFiscales(cfg)) {
    assert.strictEqual(facturacionHabilitada(c), true);
  }
});

check('no muta el config original', () => {
  const original = localMono();
  aplicarSwitchFacturacion(original, false);
  assert.strictEqual(original.monotributo.cuentas[0].facturacionAutomatica, undefined);
});

check('también aplica a Responsable Inscripto', () => {
  const off = aplicarSwitchFacturacion(localRI(), false);
  assert.strictEqual(off.ri.facturacionAutomatica, false);
  assert.strictEqual(facturacionActivaEnEstaPC(off), false);
});

// ---------------------------------------------------------------------------
console.log('\nPersistencia entre reinicios:');

check('OFF persiste: la migración NO lo vuelve a encender', () => {
  let cfg = aplicarSwitchFacturacion(localMono(), false);
  for (let i = 0; i < 3; i += 1) {
    cfg = reiniciar(cfg);
    migrarPoliticaAutoStart(cfg);            // corre en cada arranque
    assert.strictEqual(facturacionActivaEnEstaPC(cfg), false, `reinicio ${i + 1}`);
    for (const c of cuentasFiscales(cfg)) {
      assert.strictEqual(facturacionHabilitada(c), false, `reinicio ${i + 1}`);
    }
  }
});

check('ON persiste después de reiniciar', () => {
  let cfg = aplicarSwitchFacturacion(localMono(), true);
  for (let i = 0; i < 3; i += 1) {
    cfg = reiniciar(cfg);
    migrarPoliticaAutoStart(cfg);
    assert.strictEqual(facturacionActivaEnEstaPC(cfg), true, `reinicio ${i + 1}`);
  }
});

check('el ciclo completo: default ON → OFF → reinicio → ON → reinicio', () => {
  let cfg = localMono();
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), true, 'arranca en ON');

  cfg = aplicarSwitchFacturacion(cfg, false);
  cfg = reiniciar(cfg); migrarPoliticaAutoStart(cfg);
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), false, 'sigue OFF tras reiniciar');

  cfg = aplicarSwitchFacturacion(cfg, true);
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), true, 'vuelve a ON en el acto');
  cfg = reiniciar(cfg); migrarPoliticaAutoStart(cfg);
  assert.strictEqual(facturacionActivaEnEstaPC(cfg), true, 'sigue ON tras reiniciar');
});

// ---------------------------------------------------------------------------
console.log('\nQué motores toca el switch:');

check('monotributo: una clave por cuenta', () => {
  assert.deepStrictEqual(clavesDeProceso(localMono()), ['mono_1', 'mono_2']);
});

check('responsable inscripto: la clave ri', () => {
  assert.deepStrictEqual(clavesDeProceso(localRI()), ['ri']);
});

check('sin cuentas no hay nada que arrancar ni detener', () => {
  assert.deepStrictEqual(clavesDeProceso({ tipo: 'monotributo' }), []);
});

// ---------------------------------------------------------------------------
console.log('\nEl switch es de ESTA PC y de ninguna otra:');

check('apagar una PC no toca el config de la otra', () => {
  const pc1 = localMono();
  const pc2 = JSON.parse(JSON.stringify(pc1));      // misma config fiscal, otra PC
  const pc2Off = aplicarSwitchFacturacion(pc2, false);

  assert.strictEqual(facturacionActivaEnEstaPC(pc2Off), false, 'PC 2 apagada');
  assert.strictEqual(facturacionActivaEnEstaPC(pc1), true, 'PC 1 sigue facturando');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
