'use strict';

// Preferencia LOCAL por máquina — machine-settings.json.
//
// Decide si ESTA instalación autoarranca sus motores fiscales. Nunca depende
// de qué local esté activo, nunca de FACTURACION_OWNERS, nunca de Firebase.
// Default TRUE: ausente o cualquier cosa que no sea `false` explícito se
// comporta como siempre ("toda PC factura por defecto").
//
// Correr con: node electron/lib/__tests__/machineSettings.test.js

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const {
  MACHINE_SETTINGS_FILE,
  machineSettingsPath,
  leerMachineSettings,
  escribirMachineSettings,
  facturacionAutoStartHabilitado,
  setFacturacionAutoStartEnabled,
} = require('../machineSettings');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

/** fs en memoria: ni un byte real toca el disco. */
function fsFalso(archivos = {}) {
  const store = new Map(Object.entries(archivos));
  return {
    _store: store,
    readFileSync(p) {
      if (!store.has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
      return store.get(p);
    },
    writeFileSync(p, data) { store.set(p, data); },
    mkdirSync() { /* no-op: en memoria no hacen falta directorios */ },
  };
}

const USER_DATA = 'C:\\Users\\alguien\\AppData\\Roaming\\recepcion-de-pedidos-desktop';

// ---------------------------------------------------------------------------
console.log('\nDefault: ausente o inválido → TRUE (comportamiento de siempre):');

check('configuración inexistente (archivo ausente) → autoarranque permitido', () => {
  const memfs = fsFalso();
  const settings = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.deepStrictEqual(settings, {});
  assert.strictEqual(facturacionAutoStartHabilitado(settings), true);
});

check('JSON corrupto → se trata como ausente, nunca tumba el arranque', () => {
  const memfs = fsFalso({ [machineSettingsPath(USER_DATA)]: '{ esto no es json' });
  const settings = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.deepStrictEqual(settings, {});
  assert.strictEqual(facturacionAutoStartHabilitado(settings), true);
});

check('un array o un valor no-objeto en el archivo → tratado como ausente', () => {
  for (const raw of ['[1,2,3]', '"texto"', '42', 'null']) {
    const memfs = fsFalso({ [machineSettingsPath(USER_DATA)]: raw });
    assert.deepStrictEqual(leerMachineSettings(USER_DATA, { fs: memfs }), {}, `raw=${raw}`);
  }
});

check('objeto vacío → permitido', () => {
  assert.strictEqual(facturacionAutoStartHabilitado({}), true);
});

check('undefined → permitido (nunca explota si no hay settings)', () => {
  assert.strictEqual(facturacionAutoStartHabilitado(undefined), true);
});

// ---------------------------------------------------------------------------
console.log('\ntrue explícito → autoarranque permitido:');

check('facturacionAutoStartEnabled:true → permitido', () => {
  assert.strictEqual(facturacionAutoStartHabilitado({ facturacionAutoStartEnabled: true }), true);
});

check('escribir true y releer → sigue permitido', () => {
  const memfs = fsFalso();
  escribirMachineSettings(USER_DATA, { facturacionAutoStartEnabled: true }, { fs: memfs });
  const settings = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.strictEqual(facturacionAutoStartHabilitado(settings), true);
});

// ---------------------------------------------------------------------------
console.log('\nfalse explícito → autoarranque NO permitido (cero motores):');

check('facturacionAutoStartEnabled:false → NO permitido', () => {
  assert.strictEqual(facturacionAutoStartHabilitado({ facturacionAutoStartEnabled: false }), false);
});

check('escribir false y releer → sigue sin permitir', () => {
  const memfs = fsFalso();
  setFacturacionAutoStartEnabled(USER_DATA, false, { fs: memfs });
  const settings = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.strictEqual(facturacionAutoStartHabilitado(settings), false);
});

check('setFacturacionAutoStartEnabled no pisa otras claves del archivo', () => {
  const memfs = fsFalso({ [machineSettingsPath(USER_DATA)]: JSON.stringify({ otraPreferenciaFutura: 'x' }) });
  setFacturacionAutoStartEnabled(USER_DATA, false, { fs: memfs });
  const settings = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.strictEqual(settings.otraPreferenciaFutura, 'x', 'no debía perderse');
  assert.strictEqual(settings.facturacionAutoStartEnabled, false);
});

check('valores "verdaderos" no estrictos (1, "true", etc.) NO cuentan como false: siguen permitiendo', () => {
  for (const v of [1, 'true', 'false', 0, '', null, undefined]) {
    assert.strictEqual(facturacionAutoStartHabilitado({ facturacionAutoStartEnabled: v }), true, `v=${JSON.stringify(v)}`);
  }
});

// ---------------------------------------------------------------------------
console.log('\nUbicación: userData, NUNCA el directorio de instalación:');

check('la ruta se arma con el userDataDir recibido, no con __dirname ni con la app instalada', () => {
  const p1 = machineSettingsPath('C:\\Users\\A\\AppData\\Roaming\\recepcion-de-pedidos-desktop');
  const p2 = machineSettingsPath('C:\\Users\\B\\AppData\\Roaming\\recepcion-de-pedidos-desktop');
  assert.notStrictEqual(p1, p2, 'dos userData distintos deben dar rutas distintas');
  assert.ok(p1.endsWith(path.join('recepcion-de-pedidos-desktop', MACHINE_SETTINGS_FILE)));
  assert.ok(!p1.toLowerCase().includes('program files'), 'no debe vivir en el directorio de instalación');
});

// ---------------------------------------------------------------------------
console.log('\nSobrevive a una actualización de versión:');

check('false escrito por una versión sigue false después de "actualizar" (releer desde cero)', () => {
  const memfs = fsFalso();
  // Versión vieja: escribe el switch.
  setFacturacionAutoStartEnabled(USER_DATA, false, { fs: memfs });
  // "Actualización de versión" = un proceso nuevo, sin estado en memoria,
  // releyendo el MISMO archivo en el MISMO userData (que una actualización
  // nunca toca).
  const settingsDespuesDeActualizar = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.strictEqual(facturacionAutoStartHabilitado(settingsDespuesDeActualizar), false);
});

check('una versión NUEVA que agrega más campos al archivo no reactiva el autoarranque', () => {
  const memfs = fsFalso();
  setFacturacionAutoStartEnabled(USER_DATA, false, { fs: memfs });
  // La versión nueva guarda una preferencia que todavía no existía.
  const actuales = leerMachineSettings(USER_DATA, { fs: memfs });
  escribirMachineSettings(USER_DATA, { ...actuales, otraPreferenciaDeVersionNueva: true }, { fs: memfs });
  const final = leerMachineSettings(USER_DATA, { fs: memfs });
  assert.strictEqual(facturacionAutoStartHabilitado(final), false, 'el false original no puede perderse');
});

// ---------------------------------------------------------------------------
console.log('\nIntegración con electron/main.js (verificación de código fuente):');
// main.js requiere 'electron' y no se puede importar/ejecutar en un test de
// Node plano; se audita el código fuente en su lugar — mismo criterio que
// paridadRemitos.test.js usa para verificar contratos sin ejecutar la app.

const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf-8');

check('tickHostFiscal() consulta la preferencia de máquina ANTES de enumerar cualquier local, y no depende de getActiveLocalId()', () => {
  // El autoarranque dejó de ser "arrancar el local activo" (autoStartFacturacion,
  // versión vieja) y pasó a ser un host fiscal por local con lease/heartbeat
  // (tickHostFiscal) — ver electron/lib/facturacionHost.js. El requisito que
  // esta prueba protege sigue siendo el mismo: el gate de máquina se evalúa
  // PRIMERO, sin enumerar nada, y el mecanismo entero es independiente de qué
  // local esté activo visualmente en esta PC.
  const inicioFn = MAIN_JS.indexOf('async function tickHostFiscal()');
  assert.ok(inicioFn >= 0, 'no se encontró tickHostFiscal()');
  const finFn = MAIN_JS.indexOf('\n}', inicioFn);
  const cuerpo = MAIN_JS.slice(inicioFn, finFn);
  const idxGate = cuerpo.indexOf('facturacionAutoStartHabilitado(');
  const idxLocales = cuerpo.indexOf('localesConfiguradosEnEstaPC(');
  assert.ok(idxGate >= 0, 'no llama a facturacionAutoStartHabilitado');
  assert.ok(idxLocales >= 0, 'no enumera los locales configurados en esta PC');
  assert.ok(idxGate < idxLocales, 'el gate de la máquina tiene que evaluarse ANTES de enumerar locales');
  assert.ok(!cuerpo.includes('getActiveLocalId()'), 'el autoarranque por host fiscal no debe depender del local activo visualmente');
});

check('el mensaje exacto pedido queda en el código', () => {
  assert.ok(
    MAIN_JS.includes('[Facturación] Autoarranque deshabilitado para esta PC'),
    'falta el log exacto cuando el autoarranque está deshabilitado'
  );
});

check('local:set-active NO toca hosts ni motores fiscales — cambiar el local visual es independiente del host fiscal', () => {
  const inicio = MAIN_JS.indexOf("ipcMain.handle('local:set-active'");
  assert.ok(inicio >= 0, "no se encontró el handler 'local:set-active'");
  const fin = MAIN_JS.indexOf('\n  });', inicio);
  const cuerpo = MAIN_JS.slice(inicio, fin);
  assert.ok(!cuerpo.includes('autoStartFacturacion('), 'cambiar de local no debe disparar el autoarranque viejo');
  assert.ok(!cuerpo.includes('tickHostFiscal('), 'cambiar de local no debe disparar el ciclo de host fiscal');
  assert.ok(!cuerpo.includes('spawnFacturacionProc('), 'cambiar de local no debe arrancar motores directamente');
  assert.ok(!cuerpo.includes('stopAllFacturacion('), 'cambiar de local no debe frenar motores fiscales');
  assert.ok(!cuerpo.includes('stopFacturacionDeLocal('), 'cambiar de local no debe frenar el host de ningún local');
  assert.ok(!cuerpo.includes('liberarHostDelLocal('), 'cambiar de local no debe soltar ningún host fiscal');
});

check('los botones manuales (facturacion:start / facturacion:restart) NO dependen de la preferencia de máquina', () => {
  for (const nombre of ["ipcMain.handle('facturacion:start'", "ipcMain.handle('facturacion:restart'"]) {
    const inicio = MAIN_JS.indexOf(nombre);
    assert.ok(inicio >= 0, `no se encontró ${nombre}`);
    const fin = MAIN_JS.indexOf('\n  });', inicio);
    const cuerpo = MAIN_JS.slice(inicio, fin);
    assert.ok(!cuerpo.includes('facturacionAutoStartHabilitado'), `${nombre} no debe verse afectado: es una acción manual`);
  }
});

check('spawnFacturacionProc (lo que arranca un proceso node-afip) sigue existiendo intacto para el uso manual', () => {
  assert.ok(MAIN_JS.includes('function spawnFacturacionProc('), 'no se tocó la función de arranque manual');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
