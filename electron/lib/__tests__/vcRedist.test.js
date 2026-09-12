'use strict';

// VCRUNTIME140.dll / Microsoft Visual C++ Redistributable.
// Correr con: node electron/lib/__tests__/vcRedist.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  vcRedistExitoso,
  verificarOpenssl,
  instalarVcRedist,
  asegurarVcRedistSiHaceFalta,
  getVcRedistResourcePath,
} = require('../vcRedist.js');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// --- vcRedistExitoso ---------------------------------------------------
check('0 es exito', () => assert.strictEqual(vcRedistExitoso(0), true));
check('3010 (reinicio requerido) es exito', () => assert.strictEqual(vcRedistExitoso(3010), true));
check('1638 (version mas nueva ya instalada) es exito', () => assert.strictEqual(vcRedistExitoso(1638), true));
check('1603 (error fatal) NO es exito', () => assert.strictEqual(vcRedistExitoso(1603), false));
check('1 NO es exito', () => assert.strictEqual(vcRedistExitoso(1), false));
check('null NO es exito', () => assert.strictEqual(vcRedistExitoso(null), false));

// --- verificarOpenssl ---------------------------------------------------
console.log('\nverificarOpenssl (spawnSync fakeado, sin tocar el sistema real):');

check('openssl responde version 0 -> ok true, devuelve el stdout', () => {
  const fakeSpawn = () => ({ status: 0, stdout: 'OpenSSL 3.5.1 1 Jul 2025', stderr: '' });
  const r = verificarOpenssl('C:/fake/openssl.exe', { spawnSyncFn: fakeSpawn });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stdout, 'OpenSSL 3.5.1 1 Jul 2025');
});

check('falta VCRUNTIME140.dll -> spawnSync devuelve error, no status -> ok false', () => {
  const fakeSpawn = () => ({ error: new Error('spawn openssl.exe ENOENT'), status: null });
  const r = verificarOpenssl('C:/fake/openssl.exe', { spawnSyncFn: fakeSpawn });
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /ENOENT/);
});

check('openssl termina con exit code distinto de 0 -> ok false', () => {
  const fakeSpawn = () => ({ status: 1, stdout: '', stderr: 'algo salio mal' });
  const r = verificarOpenssl('C:/fake/openssl.exe', { spawnSyncFn: fakeSpawn });
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /exit 1/);
});

check('sin ruta -> ok false, no llama a spawnSync', () => {
  let llamado = false;
  const r = verificarOpenssl(null, { spawnSyncFn: () => { llamado = true; } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(llamado, false);
});

// --- instalarVcRedist ---------------------------------------------------
console.log('\ninstalarVcRedist (spawnSync fakeado):');

check('instalador inexistente -> ok false, no llama a spawnSync', () => {
  let llamado = false;
  const r = instalarVcRedist('C:/no/existe/vc_redist.x64.exe', {
    spawnSyncFn: () => { llamado = true; },
    existsSyncFn: () => false,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'instalador-no-encontrado');
  assert.strictEqual(llamado, false);
});

check('exit 0 -> ok true', () => {
  const r = instalarVcRedist('C:/fake/vc_redist.x64.exe', {
    spawnSyncFn: () => ({ status: 0 }),
    existsSyncFn: () => true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.codigo, 0);
});

check('exit 3010 (reinicio requerido) -> ok true', () => {
  const r = instalarVcRedist('C:/fake/vc_redist.x64.exe', {
    spawnSyncFn: () => ({ status: 3010 }),
    existsSyncFn: () => true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.codigo, 3010);
});

check('exit 1603 (error fatal) -> ok false, con el codigo real', () => {
  const r = instalarVcRedist('C:/fake/vc_redist.x64.exe', {
    spawnSyncFn: () => ({ status: 1603 }),
    existsSyncFn: () => true,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codigo, 1603);
  assert.match(r.motivo, /1603/);
});

check('el comando invoca powershell.exe con Start-Process -Verb RunAs (eleva solo ese proceso)', () => {
  let comandoUsado = null;
  const fakeSpawn = (cmd, args) => { comandoUsado = { cmd, args }; return { status: 0 }; };
  instalarVcRedist('C:/fake/vc_redist.x64.exe', { spawnSyncFn: fakeSpawn, existsSyncFn: () => true });
  assert.strictEqual(comandoUsado.cmd, 'powershell.exe');
  const scriptPS = comandoUsado.args.join(' ');
  assert.match(scriptPS, /-Verb RunAs/);
  assert.match(scriptPS, /\/install.*\/quiet.*\/norestart/);
});

// --- asegurarVcRedistSiHaceFalta -----------------------------------------
console.log('\nasegurarVcRedistSiHaceFalta (orquestacion completa):');

check('OpenSSL ya funciona -> NO instala nada (no llama ni a existsSync ni a instalar)', () => {
  let intentosDeInstalar = 0;
  const r = asegurarVcRedistSiHaceFalta({
    opensslExePath: 'C:/fake/openssl.exe',
    vcRedistExePath: 'C:/fake/vc_redist.x64.exe',
    spawnSyncFn: (cmd) => {
      if (cmd === 'powershell.exe') intentosDeInstalar += 1;
      return { status: 0, stdout: 'OpenSSL 3.5.1' };
    },
    log: () => {},
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.instalado, false);
  assert.strictEqual(intentosDeInstalar, 0, 'no debia intentar instalar: openssl ya funcionaba');
});

check('falta VCRUNTIME140.dll -> instala el runtime -> openssl funciona despues -> ok true, instalado true', () => {
  let llamadasOpenssl = 0;
  const fakeSpawn = (cmd) => {
    if (cmd === 'powershell.exe') return { status: 0 }; // instalacion del redistribuible
    llamadasOpenssl += 1;
    // 1ra llamada (antes de instalar): falla. 2da (despues): funciona.
    return llamadasOpenssl === 1
      ? { error: new Error('spawn openssl.exe ENOENT (falta VCRUNTIME140.dll)') }
      : { status: 0, stdout: 'OpenSSL 3.5.1 1 Jul 2025' };
  };
  const logs = [];
  const r = asegurarVcRedistSiHaceFalta({
    opensslExePath: 'C:/fake/openssl.exe',
    vcRedistExePath: 'C:/fake/vc_redist.x64.exe',
    spawnSyncFn: fakeSpawn,
    existsSyncFn: () => true,
    log: (m) => logs.push(m),
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.instalado, true);
  assert.strictEqual(r.version, 'OpenSSL 3.5.1 1 Jul 2025');
  assert.strictEqual(llamadasOpenssl, 2, 'debia verificar openssl dos veces: antes y despues');
  assert.ok(logs.some((m) => /no pudo arrancar/.test(m)), 'el motivo real del primer fallo debe quedar logueado');
  assert.ok(logs.some((m) => /verificado OK/.test(m)));
});

check('instalador devuelve 3010 (reinicio requerido) -> se refleja en el resultado', () => {
  let llamadasOpenssl = 0;
  const fakeSpawn = (cmd) => {
    if (cmd === 'powershell.exe') return { status: 3010 };
    llamadasOpenssl += 1;
    return llamadasOpenssl === 1
      ? { error: new Error('ENOENT') }
      : { status: 0, stdout: 'OpenSSL 3.5.1' };
  };
  const r = asegurarVcRedistSiHaceFalta({
    opensslExePath: 'C:/fake/openssl.exe',
    vcRedistExePath: 'C:/fake/vc_redist.x64.exe',
    spawnSyncFn: fakeSpawn,
    existsSyncFn: () => true,
    log: () => {},
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reinicioRequerido, true);
});

check('la instalacion del redistribuible falla -> ok false, se conserva el motivo real de openssl y de la instalacion', () => {
  const fakeSpawn = (cmd) => (cmd === 'powershell.exe' ? { status: 1603 } : { error: new Error('ENOENT') });
  const logs = [];
  const r = asegurarVcRedistSiHaceFalta({
    opensslExePath: 'C:/fake/openssl.exe',
    vcRedistExePath: 'C:/fake/vc_redist.x64.exe',
    spawnSyncFn: fakeSpawn,
    existsSyncFn: () => true,
    log: (m) => logs.push(m),
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /1603/);
  assert.strictEqual(r.errorOpenssl, 'ENOENT');
});

check('se instala el runtime pero OpenSSL SIGUE sin arrancar -> ok false, instalado true, motivo real logueado', () => {
  const fakeSpawn = (cmd) => (cmd === 'powershell.exe' ? { status: 0 } : { error: new Error('ENOENT persistente') });
  const logs = [];
  const r = asegurarVcRedistSiHaceFalta({
    opensslExePath: 'C:/fake/openssl.exe',
    vcRedistExePath: 'C:/fake/vc_redist.x64.exe',
    spawnSyncFn: fakeSpawn,
    existsSyncFn: () => true,
    log: (m) => logs.push(m),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.instalado, true);
  assert.ok(logs.some((m) => /SIGUE sin poder arrancar/.test(m)));
});

// --- getVcRedistResourcePath ---------------------------------------------
console.log('\ngetVcRedistResourcePath:');

check('empaquetada: resuelve dentro de resourcesPath/vcredist', () => {
  const r = getVcRedistResourcePath({ isPackaged: true, resourcesPath: 'C:/App/resources' });
  assert.strictEqual(r, path.join('C:/App/resources', 'vcredist', 'vc_redist.x64.exe'));
});

check('dev: resuelve dentro de <repo>/resources/vcredist', () => {
  const r = getVcRedistResourcePath({ isPackaged: false, repoRoot: 'C:/repo' });
  assert.strictEqual(r, path.join('C:/repo', 'resources', 'vcredist', 'vc_redist.x64.exe'));
});

// --- El binario real está presente en el repo ----------------------------
console.log('\nRecurso real:');
check('resources/vcredist/vc_redist.x64.exe existe en el repo (se empaqueta con extraResources)', () => {
  const raiz = path.resolve(__dirname, '..', '..', '..');
  const p = path.join(raiz, 'resources', 'vcredist', 'vc_redist.x64.exe');
  assert.ok(fs.existsSync(p), `falta ${p}`);
  const tam = fs.statSync(p).size;
  assert.ok(tam > 5 * 1024 * 1024, 'el archivo es demasiado chico para ser el instalador real');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
