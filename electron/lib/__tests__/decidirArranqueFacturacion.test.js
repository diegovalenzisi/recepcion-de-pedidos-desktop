'use strict';

// Política de arranque de la facturación automática.
//
// La regla que se fija acá: TODA PC factura por defecto, y lo único que la frena
// es que alguien haya apagado el switch a propósito en esa computadora.
//
// Correr con: node electron/lib/__tests__/decidirArranqueFacturacion.test.js

const assert = require('node:assert');
const {
  BILLING_AUTOSTART_POLICY_VERSION,
  migrarPoliticaAutoStart,
  facturacionHabilitada,
  decidirArranqueCuenta,
  colaDesdeFirebasePath,
  cuentasDeConfig,
} = require('../decidirArranqueFacturacion');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

/** Todos los requisitos de archivo presentes. */
const TODO_OK = {
  env: true, cert: true, key: true, serviceAccount: true,
  engine: true, firebaseUrl: true, firebasePath: true,
};

const arranca = (cuenta, requisitos = TODO_OK, yaCorriendo = false) =>
  decidirArranqueCuenta({ cuenta, requisitos, yaCorriendo }).arranca;

// ---------------------------------------------------------------------------
console.log('\nToda PC factura por defecto:');

check('configuración NUEVA sin el campo → ARRANCA', () => {
  assert.strictEqual(arranca({ nombre: 'Transferencia' }), true);
});

check('facturacionAutomatica:true → ARRANCA', () => {
  assert.strictEqual(arranca({ facturacionAutomatica: true }), true);
});

check('facturacionAutomatica:false EXPRESO → NO ARRANCA', () => {
  const r = decidirArranqueCuenta({ cuenta: { facturacionAutomatica: false }, requisitos: TODO_OK });
  assert.strictEqual(r.arranca, false);
  assert.strictEqual(r.motivo, 'detenida-manualmente');
});

check('el rol del usuario NO interviene (dueño / encargado / empleado)', () => {
  for (const rol of ['dueño', 'encargado', 'empleado', undefined]) {
    assert.strictEqual(arranca({ rolUsuarioLogueado: rol }), true, `falló con rol=${rol}`);
  }
});

check('`activo:false` viejo, por sí solo, ya NO frena nada', () => {
  // Es el estado de las PCs instaladas: nadie entró nunca a encender.
  assert.strictEqual(arranca({ activo: false, initialized: false }), true);
});

// ---------------------------------------------------------------------------
console.log('\nMigración de una sola vez (PCs ya instaladas):');

check('configuración ANTIGUA activo:false → ARRANCA después de migrar', () => {
  const config = {
    tipo: 'monotributo',
    monotributo: { cuentas: [{ id: 1, nombre: 'Transferencia', activo: false, initialized: false }] },
  };
  assert.strictEqual(arranca(config.monotributo.cuentas[0]), true, 'ya arranca sin migrar');

  const r = migrarPoliticaAutoStart(config);
  assert.strictEqual(r.migrado, true);
  assert.strictEqual(r.cuentasTocadas, 1);
  assert.strictEqual(config.billingAutoStartPolicyVersion, BILLING_AUTOSTART_POLICY_VERSION);
  assert.strictEqual(config.monotributo.cuentas[0].facturacionAutomatica, true);
  assert.strictEqual(config.monotributo.cuentas[0].activo, false, 'el campo viejo no se toca');
});

check('la migración NO pisa un OFF expreso del usuario', () => {
  const config = {
    monotributo: { cuentas: [
      { id: 1, facturacionAutomatica: false },   // apagada a propósito
      { id: 2 },                                  // nunca tocada
    ] },
  };
  const r = migrarPoliticaAutoStart(config);
  assert.strictEqual(r.cuentasTocadas, 1, 'solo debe tocar la que no tenía el campo');
  assert.strictEqual(config.monotributo.cuentas[0].facturacionAutomatica, false, 'el OFF se respeta');
  assert.strictEqual(config.monotributo.cuentas[1].facturacionAutomatica, true);
});

check('la migración corre UNA sola vez', () => {
  const config = { monotributo: { cuentas: [{ id: 1 }] } };
  assert.strictEqual(migrarPoliticaAutoStart(config).migrado, true);
  assert.strictEqual(migrarPoliticaAutoStart(config).migrado, false, 'no debe volver a migrar');
});

check('migrar NO reactiva una cuenta apagada en un arranque posterior', () => {
  const config = { monotributo: { cuentas: [{ id: 1 }] } };
  migrarPoliticaAutoStart(config);                       // primer arranque
  config.monotributo.cuentas[0].facturacionAutomatica = false;  // el usuario apaga
  migrarPoliticaAutoStart(config);                       // arranques siguientes
  assert.strictEqual(config.monotributo.cuentas[0].facturacionAutomatica, false);
  assert.strictEqual(arranca(config.monotributo.cuentas[0]), false);
});

check('también migra la cuenta de Responsable Inscripto', () => {
  const config = { tipo: 'responsable_inscripto', ri: { nombre: 'RI', activo: false } };
  const r = migrarPoliticaAutoStart(config);
  assert.strictEqual(r.cuentasTocadas, 1);
  assert.strictEqual(config.ri.facturacionAutomatica, true);
  assert.strictEqual(arranca(config.ri), true);
});

// ---------------------------------------------------------------------------
console.log('\nPersistencia del switch entre reinicios:');

/** Simula cerrar y volver a abrir: el config se relee tal cual quedó en disco. */
const reiniciar = (config) => JSON.parse(JSON.stringify(config));

check('OFF persiste después de reiniciar', () => {
  let config = { monotributo: { cuentas: [{ id: 1 }] } };
  migrarPoliticaAutoStart(config);
  config.monotributo.cuentas[0].facturacionAutomatica = false;   // el usuario apaga

  for (let i = 0; i < 3; i += 1) {
    config = reiniciar(config);
    migrarPoliticaAutoStart(config);                              // corre en cada arranque
    assert.strictEqual(arranca(config.monotributo.cuentas[0]), false, `reinicio ${i + 1}`);
  }
});

check('ON persiste después de reiniciar', () => {
  let config = { monotributo: { cuentas: [{ id: 1 }] } };
  migrarPoliticaAutoStart(config);
  config.monotributo.cuentas[0].facturacionAutomatica = true;     // el usuario prende

  for (let i = 0; i < 3; i += 1) {
    config = reiniciar(config);
    migrarPoliticaAutoStart(config);
    assert.strictEqual(arranca(config.monotributo.cuentas[0]), true, `reinicio ${i + 1}`);
  }
});

check('apagar y volver a prender vuelve a facturar', () => {
  const cuenta = {};
  migrarPoliticaAutoStart({ monotributo: { cuentas: [cuenta] } });
  assert.strictEqual(arranca(cuenta), true);
  cuenta.facturacionAutomatica = false;
  assert.strictEqual(arranca(cuenta), false);
  cuenta.facturacionAutomatica = true;
  assert.strictEqual(arranca(cuenta), true);
});

// ---------------------------------------------------------------------------
console.log('\nConfiguración fiscal incompleta:');

check('falta el certificado → esa cuenta NO arranca, y se dice qué falta', () => {
  const r = decidirArranqueCuenta({ cuenta: {}, requisitos: { ...TODO_OK, cert: false } });
  assert.strictEqual(r.arranca, false);
  assert.strictEqual(r.motivo, 'falta-configuracion-fiscal');
  assert.deepStrictEqual(r.faltantes, ['cert']);
});

check('faltan varias cosas → se listan todas', () => {
  const r = decidirArranqueCuenta({
    cuenta: {},
    requisitos: { ...TODO_OK, cert: false, key: false, firebasePath: false },
  });
  assert.deepStrictEqual(r.faltantes.sort(), ['cert', 'firebasePath', 'key']);
});

check('una cuenta incompleta NO frena a las demás', () => {
  const cuentas = [
    { id: 1, _req: TODO_OK },                          // completa
    { id: 2, _req: { ...TODO_OK, cert: false } },      // sin certificado
    { id: 3, _req: TODO_OK },                          // completa
  ];
  const resultados = cuentas.map((c) => decidirArranqueCuenta({ cuenta: c, requisitos: c._req }));
  assert.deepStrictEqual(resultados.map((r) => r.arranca), [true, false, true]);
});

check('un proceso ya vivo no se duplica', () => {
  const r = decidirArranqueCuenta({ cuenta: {}, requisitos: TODO_OK, yaCorriendo: true });
  assert.strictEqual(r.arranca, false);
  assert.strictEqual(r.motivo, 'ya-corriendo');
});

// ---------------------------------------------------------------------------
console.log('\nDescubrimiento dinámico de colas:');

check('la cola sale del FIREBASE_PATH, sin hardcodear _1/_2/_3', () => {
  assert.strictEqual(colaDesdeFirebasePath('40508022/FACTURACION_1'), 'FACTURACION_1');
  assert.strictEqual(colaDesdeFirebasePath('40508022/FACTURACION_4'), 'FACTURACION_4');
  assert.strictEqual(colaDesdeFirebasePath('34516605/FACTURACION_7'), 'FACTURACION_7', 'una cola futura debe funcionar sola');
  assert.strictEqual(colaDesdeFirebasePath(''), null);
});

check('varias cuentas → una cola por cada una, sin repetir', () => {
  const config = { monotributo: { cuentas: [
    { id: 1, _path: '40508022/FACTURACION_1' },
    { id: 2, _path: '40508022/FACTURACION_2' },
    { id: 3, _path: '40508022/FACTURACION_3' },
    { id: 4, _path: '40508022/FACTURACION_4' },
  ] } };
  migrarPoliticaAutoStart(config);
  const colas = cuentasDeConfig(config)
    .filter((c) => arranca(c))
    .map((c) => colaDesdeFirebasePath(c._path));
  assert.deepStrictEqual(colas, ['FACTURACION_1', 'FACTURACION_2', 'FACTURACION_3', 'FACTURACION_4']);
  assert.strictEqual(new Set(colas).size, 4, 'no puede haber colas duplicadas');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
