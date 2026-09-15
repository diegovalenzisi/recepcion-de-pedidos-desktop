'use strict';

// ACTUALIZADOR OBLIGATORIO — nunca debe hacer downgrade.
//
// Bug reportado: con local=1.3.129 y remoto=1.3.128 (mandatory:true), la app
// instaló la 1.3.128, retrocediendo la versión. Causa raíz real (ver informe):
// NO era una comparación de tipo `remoteVersion !== currentVersion` (esa
// condición nunca existió en el código) — la comparación YA era numérica por
// segmento y YA devolvía `false` correctamente para 1.3.129 vs 1.3.128. El
// caso que sí disparaba una actualización era el build de prueba real
// (1.3.29), cuyo tercer segmento (29) es menor que el de producción (128) —
// resultado correcto de cualquier comparador numérico, semver incluido, no
// un bug. Estas pruebas fijan el comportamiento correcto para AMBOS casos y
// agregan la protección redundante antes de instalar.
//
// Correr con: node electron/lib/__tests__/actualizacionVersion.test.js

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { esVersionMayor, esMismaVersion, decidirActualizacion } = require('../actualizacionVersion');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
console.log('\n1. esVersionMayor — comparación NUMÉRICA por segmento (punto 5):');

check('1.3.129 > 1.3.128', () => assert.strictEqual(esVersionMayor('1.3.129', '1.3.128'), true));
check('1.3.130 > 1.3.129', () => assert.strictEqual(esVersionMayor('1.3.130', '1.3.129'), true));
check('1.3.100 > 1.3.99 (NO como string: "1.3.100" < "1.3.99" lexicográficamente)', () => {
  assert.strictEqual(esVersionMayor('1.3.100', '1.3.99'), true);
  assert.ok('1.3.100' < '1.3.99', 'este assert confirma que como STRING el orden es el incorrecto — por eso no se compara así');
});
check('1.10.0 > 1.9.99 (NO como string: "1.10.0" < "1.9.99" lexicográficamente)', () => {
  assert.strictEqual(esVersionMayor('1.10.0', '1.9.99'), true);
  assert.ok('1.10.0' < '1.9.99', 'confirma que la comparación de string daría el resultado opuesto');
});
check('2.0.0 > 1.999.999', () => assert.strictEqual(esVersionMayor('2.0.0', '1.999.999'), true));
check('1.3.128 NO es mayor que 1.3.129 (el caso crítico del downgrade)', () => {
  assert.strictEqual(esVersionMayor('1.3.128', '1.3.129'), false);
});
check('versiones iguales -> ni una ni otra es "mayor"', () => {
  assert.strictEqual(esVersionMayor('1.3.128', '1.3.128'), false);
  assert.strictEqual(esMismaVersion('1.3.128', '1.3.128'), true);
});
check('soporta distinta cantidad de segmentos (1.3 vs 1.3.0)', () => {
  assert.strictEqual(esVersionMayor('1.3.1', '1.3'), true);
  assert.strictEqual(esMismaVersion('1.3', '1.3.0'), true);
});

// ---------------------------------------------------------------------------
console.log('\n2. decidirActualizacion — los 6 casos obligatorios del punto 8:');

check('CASO A: local=1.3.128, remote=1.3.129, mandatory=true -> ACTUALIZACIÓN OBLIGATORIA', () => {
  const d = decidirActualizacion({ currentVersion: '1.3.128', remoteVersion: '1.3.129', mandatory: true });
  assert.strictEqual(d.hasUpdate, true);
  assert.strictEqual(d.blocksStartup, true);
  assert.strictEqual(d.reason, 'actualizacion-obligatoria');
});

check('CASO B: local=1.3.128, remote=1.3.129, mandatory=false -> disponible, NO bloquea', () => {
  const d = decidirActualizacion({ currentVersion: '1.3.128', remoteVersion: '1.3.129', mandatory: false });
  assert.strictEqual(d.hasUpdate, true);
  assert.strictEqual(d.blocksStartup, false);
  assert.strictEqual(d.reason, 'actualizacion-disponible');
});

check('CASO C: local=1.3.129, remote=1.3.129, mandatory=true -> ARRANCA, no actualiza', () => {
  const d = decidirActualizacion({ currentVersion: '1.3.129', remoteVersion: '1.3.129', mandatory: true });
  assert.strictEqual(d.hasUpdate, false);
  assert.strictEqual(d.blocksStartup, false);
  assert.strictEqual(d.reason, 'version-igual');
});

check('CASO D (CRÍTICO): local=1.3.129, remote=1.3.128, mandatory=true -> ARRANCA NORMALMENTE, sin downgrade', () => {
  const d = decidirActualizacion({ currentVersion: '1.3.129', remoteVersion: '1.3.128', mandatory: true });
  assert.strictEqual(d.hasUpdate, false, 'no debería ofrecer "actualizar" a una versión inferior');
  assert.strictEqual(d.blocksStartup, false, 'mandatory:true NUNCA debe bloquear cuando la instalada ya es más nueva');
  assert.strictEqual(d.reason, 'version-local-mas-nueva');
});

check('CASO E: local=1.3.130, remote=1.3.129, mandatory=true -> ARRANCA', () => {
  const d = decidirActualizacion({ currentVersion: '1.3.130', remoteVersion: '1.3.129', mandatory: true });
  assert.strictEqual(d.hasUpdate, false);
  assert.strictEqual(d.blocksStartup, false);
});

check('CASO F: local=1.10.0, remote=1.9.99, mandatory=true -> ARRANCA (verifica que NO se compare como string)', () => {
  const d = decidirActualizacion({ currentVersion: '1.10.0', remoteVersion: '1.9.99', mandatory: true });
  assert.strictEqual(d.hasUpdate, false);
  assert.strictEqual(d.blocksStartup, false);
  assert.strictEqual(d.reason, 'version-local-mas-nueva');
});

check('sin currentVersion o remoteVersion -> no rompe, no actualiza (defensivo)', () => {
  assert.deepStrictEqual(decidirActualizacion({ currentVersion: null, remoteVersion: '1.3.129', mandatory: true }),
    { hasUpdate: false, blocksStartup: false, reason: 'version-ausente' });
  assert.deepStrictEqual(decidirActualizacion({ currentVersion: '1.3.128', remoteVersion: undefined, mandatory: true }),
    { hasUpdate: false, blocksStartup: false, reason: 'version-ausente' });
});

// ---------------------------------------------------------------------------
console.log('\n3. EL BUG REPORTADO NO ES REPRODUCIBLE CON LA COMPARACIÓN REAL DEL CÓDIGO:');

check('local=1.3.129, remote=1.3.128 (el ejemplo EXACTO del reporte) -> nunca hasUpdate, nunca bloquea', () => {
  const d = decidirActualizacion({ currentVersion: '1.3.129', remoteVersion: '1.3.128', mandatory: true });
  assert.strictEqual(d.hasUpdate, false);
  assert.strictEqual(d.blocksStartup, false);
});

check('la causa real del incidente: 1.3.128 SÍ es mayor que 1.3.29 (128 > 29 como número) — no es downgrade, es la comparación correcta', () => {
  // Este es el caso real que ocurrió: el build de prueba se etiquetó "1.3.29"
  // (tercer segmento menor que producción "1.3.128"). Cualquier comparador
  // numérico correcto — este incluido — trata 1.3.128 como más nuevo.
  const d = decidirActualizacion({ currentVersion: '1.3.29', remoteVersion: '1.3.128', mandatory: true });
  assert.strictEqual(d.hasUpdate, true);
  assert.strictEqual(d.blocksStartup, true);
});

// ---------------------------------------------------------------------------
console.log('\n4. INTEGRACIÓN — main.js/preload.js/App.jsx usan el módulo compartido y tienen la protección extra:');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const mainSrc = leer('electron/main.js');
const preloadSrc = leer('electron/preload.js');
const appSrc = leer('src/App.jsx');

check('main.js no tiene una comparación manual propia (usa el módulo compartido)', () => {
  assert.match(mainSrc, /require\('\.\/lib\/actualizacionVersion'\)/);
  assert.ok(!/function newerVersion/.test(mainSrc), 'volvió una comparación de versiones propia y paralela');
});

check('nunca existió (y no volvió) el patrón `!== ` para decidir actualización — el que causaría el downgrade', () => {
  assert.ok(!/remoteVersion\s*!==\s*currentVersion/.test(mainSrc));
  assert.ok(!/remoteVersion\s*!=\s*currentVersion/.test(mainSrc));
});

check('check-updates-now usa decidirActualizacion (no un booleano hecho a mano) y logea con el prefijo [Updater]', () => {
  const i = mainSrc.indexOf("ipcMain.handle('check-updates-now'");
  assert.ok(i > 0);
  const cuerpo = mainSrc.slice(i, i + 2500);
  assert.match(cuerpo, /decidirActualizacion\(\{ currentVersion, remoteVersion: info\.latest, mandatory \}\)/);
  assert.match(cuerpo, /\[Updater\] Versión instalada:/);
  assert.match(cuerpo, /\[Updater\] Versión remota:/);
  assert.match(cuerpo, /\[Updater\] mandatory:/);
  assert.match(cuerpo, /\[Updater\] Comparación:/);
  assert.match(cuerpo, /No se actualiza: versión instalada.*más nueva/);
});

check('download-and-install vuelve a comparar con app.getVersion() ANTES de ejecutar nada (protección extra, punto 9)', () => {
  const i = mainSrc.indexOf("ipcMain.handle('download-and-install'");
  assert.ok(i > 0);
  const cuerpo = mainSrc.slice(i, i + 900);
  assert.match(cuerpo, /const currentVersionAhora = app\.getVersion\(\);/);
  assert.match(cuerpo, /if \(remoteVersion && !esVersionMayor\(remoteVersion, currentVersionAhora\)\) \{/);
  assert.match(cuerpo, /return Promise\.reject/, 'debe abortar (reject), no seguir con la descarga/instalación');
});

check('la protección extra está ANTES de crear el archivo de destino / empezar la descarga', () => {
  const iCheck = mainSrc.indexOf('const currentVersionAhora = app.getVersion();');
  const iDest = mainSrc.indexOf("const dest = path.join(tmpDir, fileName || 'update-setup.exe');");
  assert.ok(iCheck > 0 && iDest > iCheck, 'la comparación debe ocurrir antes de tocar el filesystem/red');
});

check('preload.js propaga remoteVersion hacia download-and-install', () => {
  assert.match(preloadSrc, /downloadAndInstall: \(url, fileName, sha256, remoteVersion\) => ipcRenderer\.invoke\('download-and-install', url, fileName, sha256, remoteVersion\)/);
});

check('App.jsx envía la versión remota al pedir la instalación', () => {
  const i = appSrc.indexOf('window.electronAPI.downloadAndInstall(');
  assert.ok(i > 0);
  const cuerpo = appSrc.slice(i, i + 200);
  assert.match(cuerpo, /updateInfo\.version \|\| null/);
});

check('app.getVersion() sigue siendo la ÚNICA fuente de la versión local (nunca latest.json/caché) — punto 6', () => {
  const i = mainSrc.indexOf("ipcMain.handle('check-updates-now'");
  const cuerpo = mainSrc.slice(i, i + 400);
  assert.match(cuerpo, /const currentVersion = app\.getVersion\(\);/);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
