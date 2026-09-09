'use strict';

// NODE_MODULES COMPARTIDO DEL MOTOR DE FACTURACIÓN (junction, no copia).
//
// Reproduce el problema real confirmado en Lepo Lepo y Joao: un motor ESM en
// facturacion/locales/{localId}/ri/index.mjs con `import 'dotenv'` no resuelve
// porque facturacion-runtime/node_modules es HERMANO de facturacion/, nunca
// ancestro — Node nunca lo encuentra subiendo el árbol. Se prueba con
// filesystem REAL (temp dirs, junctions reales de Windows), no con mocks,
// porque la resolución de módulos de Node es exactamente lo que hay que
// probar de verdad.
//
// Correr con: node electron/lib/__tests__/facturacionRuntimeLink.test.js

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  REQUIRED_PACKAGES,
  decidirAccionNodeModules,
  ensureFacturacionNodeModulesLink,
  verificarPaquetesResolubles,
} = require('../facturacionRuntimeLink');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e && e.message}`);
    process.exitCode = 1;
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'facturacion-runtime-link-'));
const nuevoTmp = (nombre) => {
  const d = path.join(tmpRoot, `${nombre}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

/** Crea un paquete mínimo real (package.json + entry) en node_modules/{pkg}. */
function crearPaqueteFalso(nodeModulesDir, pkg) {
  const dir = path.join(nodeModulesDir, pkg);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0-test', main: 'index.js' }), 'utf-8');
  fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { nombre: ${JSON.stringify(pkg)} };\n`, 'utf-8');
}

function crearRuntimeCompleto() {
  const runtimeDir = nuevoTmp('runtime');
  const nodeModulesDir = path.join(runtimeDir, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  for (const pkg of REQUIRED_PACKAGES) crearPaqueteFalso(nodeModulesDir, pkg);
  return nodeModulesDir;
}

(async () => {
  console.log('decidirAccionNodeModules (pura, sin fs):');

  await check('sin runtime todavía → sin-runtime', () => {
    const r = decidirAccionNodeModules({ runtimeExists: false, linkKind: 'none', linkTargetReal: null, runtimeRealPath: null });
    assert.strictEqual(r.accion, 'sin-runtime');
  });
  await check('no existe el link, existe el runtime → crear', () => {
    const r = decidirAccionNodeModules({ runtimeExists: true, linkKind: 'none', linkTargetReal: null, runtimeRealPath: '/x/runtime/node_modules' });
    assert.strictEqual(r.accion, 'crear');
  });
  await check('link ya apunta al runtime correcto → nada', () => {
    const r = decidirAccionNodeModules({ runtimeExists: true, linkKind: 'link', linkTargetReal: '/x/runtime/node_modules', runtimeRealPath: '/x/runtime/node_modules' });
    assert.strictEqual(r.accion, 'nada');
  });
  await check('link apunta a otro lado → reparar', () => {
    const r = decidirAccionNodeModules({ runtimeExists: true, linkKind: 'link', linkTargetReal: '/x/OTRO/node_modules', runtimeRealPath: '/x/runtime/node_modules' });
    assert.strictEqual(r.accion, 'reparar');
  });
  await check('link roto (no resuelve destino) → reparar', () => {
    const r = decidirAccionNodeModules({ runtimeExists: true, linkKind: 'link', linkTargetReal: null, runtimeRealPath: '/x/runtime/node_modules' });
    assert.strictEqual(r.accion, 'reparar');
  });
  await check('ya hay una carpeta REAL (copia legacy) → respetar, nunca reemplazar', () => {
    const r = decidirAccionNodeModules({ runtimeExists: true, linkKind: 'real-dir', linkTargetReal: null, runtimeRealPath: '/x/runtime/node_modules' });
    assert.strictEqual(r.accion, 'respetar-copia-real');
  });
  await check('carpeta real incluso SIN runtime instalado → sigue respetando (no hay nada que reparar)', () => {
    const r = decidirAccionNodeModules({ runtimeExists: false, linkKind: 'real-dir', linkTargetReal: null, runtimeRealPath: null });
    assert.strictEqual(r.accion, 'respetar-copia-real');
  });

  console.log('\nensureFacturacionNodeModulesLink — filesystem real:');

  await check('instalación nueva: no existe facturacion/node_modules, se crea el junction', () => {
    const facturacionDir = nuevoTmp('factur-nueva');
    const runtimeModulesDir = crearRuntimeCompleto();
    const logs = [];
    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: (m) => logs.push(m) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accion, 'crear');
    const linkPath = path.join(facturacionDir, 'node_modules');
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink());
    assert.strictEqual(fs.realpathSync(linkPath), fs.realpathSync(runtimeModulesDir));
    assert.ok(logs.some((l) => l.includes('Junction creado')));
  });

  await check('junction ya correcto: segunda llamada no hace nada (idempotente)', () => {
    const facturacionDir = nuevoTmp('factur-idempotente');
    const runtimeModulesDir = crearRuntimeCompleto();
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    const logs = [];
    const r2 = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: (m) => logs.push(m) });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.accion, 'nada');
    assert.ok(logs.some((l) => l.includes('node_modules compartido OK')));
  });

  await check('reinicio de la app: tres llamadas seguidas dan el mismo resultado, sin acumular nada raro', () => {
    const facturacionDir = nuevoTmp('factur-reinicios');
    const runtimeModulesDir = crearRuntimeCompleto();
    const r1 = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    const r2 = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    const r3 = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    assert.strictEqual(r1.accion, 'crear');
    assert.strictEqual(r2.accion, 'nada');
    assert.strictEqual(r3.accion, 'nada');
  });

  await check('junction roto (apunta a un runtime viejo que ya no existe): se repara', () => {
    const facturacionDir = nuevoTmp('factur-rota');
    const runtimeViejo = crearRuntimeCompleto();
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir: runtimeViejo, log: () => {} });
    // El "runtime viejo" desaparece (reinstalación de componentes, por ejemplo).
    fs.rmSync(path.dirname(runtimeViejo), { recursive: true, force: true });

    const runtimeNuevo = crearRuntimeCompleto();
    const logs = [];
    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir: runtimeNuevo, log: (m) => logs.push(m) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accion, 'reparar');
    const linkPath = path.join(facturacionDir, 'node_modules');
    assert.strictEqual(fs.realpathSync(linkPath), fs.realpathSync(runtimeNuevo));
    assert.ok(logs.some((l) => l.includes('Junction reparado')));
  });

  await check('junction apuntando a un lugar totalmente distinto (mal configurado a mano): se repara al correcto', () => {
    const facturacionDir = nuevoTmp('factur-mal-apuntado');
    const runtimeCorrecto = crearRuntimeCompleto();
    const runtimeIncorrecto = crearRuntimeCompleto();
    const linkPath = path.join(facturacionDir, 'node_modules');
    fs.mkdirSync(facturacionDir, { recursive: true });
    fs.symlinkSync(runtimeIncorrecto, linkPath, 'junction');

    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir: runtimeCorrecto, log: () => {} });
    assert.strictEqual(r.accion, 'reparar');
    assert.strictEqual(fs.realpathSync(linkPath), fs.realpathSync(runtimeCorrecto));
  });

  await check('carpeta facturacion/node_modules REAL (copia legacy, no un link): nunca se toca', () => {
    const facturacionDir = nuevoTmp('factur-copia-legacy');
    const runtimeModulesDir = crearRuntimeCompleto();
    const linkPath = path.join(facturacionDir, 'node_modules');
    fs.mkdirSync(linkPath, { recursive: true });
    crearPaqueteFalso(linkPath, 'dotenv'); // instalación vieja que copió sus propias deps

    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    assert.strictEqual(r.accion, 'respetar-copia-real');
    assert.ok(fs.lstatSync(linkPath).isDirectory() && !fs.lstatSync(linkPath).isSymbolicLink(), 'sigue siendo una carpeta real, no un link');
    assert.ok(fs.existsSync(path.join(linkPath, 'dotenv', 'package.json')), 'la copia legacy sigue intacta');
  });

  await check('runtime todavía no instalado: no falla, no crea nada, se puede reintentar después', () => {
    const facturacionDir = nuevoTmp('factur-sin-runtime');
    const runtimeModulesDir = path.join(nuevoTmp('runtime-inexistente'), 'no-existe', 'node_modules');
    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.accion, 'sin-runtime');
    assert.strictEqual(fs.existsSync(path.join(facturacionDir, 'node_modules')), false);

    // Ahora aparece el runtime (se terminó de descargar) → el próximo intento sí resuelve.
    const runtimeYaListo = crearRuntimeCompleto();
    const r2 = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir: runtimeYaListo, log: () => {} });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.accion, 'crear');
  });

  await check('carpeta facturacion existente con locales/cuentas: el junction no toca ningún archivo de cuenta', () => {
    // Simula una PC como la de Joao: ya tiene cuentas reales configuradas.
    const facturacionDir = nuevoTmp('factur-con-locales');
    const runtimeModulesDir = crearRuntimeCompleto();
    const cuentaDir = path.join(facturacionDir, 'locales', '31915636', 'mono', 'c1786113469909');
    fs.mkdirSync(cuentaDir, { recursive: true });
    fs.writeFileSync(path.join(cuentaDir, '.env'), 'LOCAL_ID=31915636\nCUIT=20111111111\n', 'utf-8');
    fs.mkdirSync(path.join(cuentaDir, 'cert'), { recursive: true });
    fs.writeFileSync(path.join(cuentaDir, 'cert', 'certificado.crt'), 'CERTIFICADO-FALSO-DE-PRUEBA', 'utf-8');
    const envAntes = fs.readFileSync(path.join(cuentaDir, '.env'), 'utf-8');
    const certAntes = fs.readFileSync(path.join(cuentaDir, 'cert', 'certificado.crt'), 'utf-8');

    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(cuentaDir, '.env'), 'utf-8'), envAntes, '.env intacto');
    assert.strictEqual(fs.readFileSync(path.join(cuentaDir, 'cert', 'certificado.crt'), 'utf-8'), certAntes, 'certificado intacto');
  });

  await check('actualización de una instalación vieja (como la PC de Joao): pasa de sin-junction a reparado sin tocar la cuenta', () => {
    const facturacionDir = nuevoTmp('factur-actualizacion-joao');
    const cuentaDir = path.join(facturacionDir, 'locales', '_JOAO_LOCAL_', 'ri');
    fs.mkdirSync(cuentaDir, { recursive: true });
    fs.writeFileSync(path.join(cuentaDir, 'serviceAccount.json'), '{"tipo":"cuenta-de-servicio-real"}', 'utf-8');

    // Antes de la corrección: node_modules ni existe (PC vieja, recién actualizada).
    assert.strictEqual(fs.existsSync(path.join(facturacionDir, 'node_modules')), false);

    const runtimeModulesDir = crearRuntimeCompleto();
    const r = ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accion, 'crear');
    assert.strictEqual(
      fs.readFileSync(path.join(cuentaDir, 'serviceAccount.json'), 'utf-8'),
      '{"tipo":"cuenta-de-servicio-real"}',
      'serviceAccount.json de la cuenta existente no se tocó',
    );
  });

  console.log('\nEl import ESM real, desde la profundidad real de un motor, ya resuelve:');

  await check('facturacion/locales/{localId}/ri/index.mjs puede "import \'dotenv\'" sin npm ni Node global', async () => {
    const facturacionDir = nuevoTmp('factur-import-real');
    const runtimeModulesDir = crearRuntimeCompleto();
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });

    // Misma profundidad EXACTA que un motor real: facturacion/locales/{id}/ri/.
    const riDir = path.join(facturacionDir, 'locales', '36390005', 'ri');
    fs.mkdirSync(riDir, { recursive: true });
    const indexPath = path.join(riDir, 'index.mjs');
    fs.writeFileSync(indexPath, "import dotenv from 'dotenv';\nexport const nombreResuelto = dotenv.nombre;\n", 'utf-8');

    const mod = await import(pathToFileURL(indexPath).href);
    assert.strictEqual(mod.nombreResuelto, 'dotenv');
  });

  await check('misma resolución para Monotributo (locales/{id}/mono/{cuenta}/), mismo runtime compartido', async () => {
    const facturacionDir = nuevoTmp('factur-import-mono');
    const runtimeModulesDir = crearRuntimeCompleto();
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });

    const monoDir = path.join(facturacionDir, 'locales', '40508022', 'mono', 'c123');
    fs.mkdirSync(monoDir, { recursive: true });
    const indexPath = path.join(monoDir, 'index.mjs');
    fs.writeFileSync(indexPath, "import 'dotenv';\nimport 'firebase-admin';\nimport 'moment';\nimport 'pdfkit';\nimport 'qrcode';\nimport 'soap';\nexport const ok = true;\n", 'utf-8');

    const mod = await import(pathToFileURL(indexPath).href);
    assert.strictEqual(mod.ok, true);
  });

  await check('varios localId distintos bajo el MISMO junction, todos resuelven (un solo runtime compartido)', async () => {
    const facturacionDir = nuevoTmp('factur-multi-local');
    const runtimeModulesDir = crearRuntimeCompleto();
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });

    for (const localId of ['11111111', '22222222', '99999999']) {
      const dir = path.join(facturacionDir, 'locales', localId, 'ri');
      fs.mkdirSync(dir, { recursive: true });
      const indexPath = path.join(dir, 'index.mjs');
      fs.writeFileSync(indexPath, "import 'dotenv';\nexport const localId = " + JSON.stringify(localId) + ';\n');
      const mod = await import(pathToFileURL(indexPath).href);
      assert.strictEqual(mod.localId, localId);
    }
  });

  console.log('\nverificarPaquetesResolubles:');

  await check('con el runtime completo, las 6 dependencias reales resuelven', async () => {
    const facturacionDir = nuevoTmp('factur-verificacion-ok');
    const runtimeModulesDir = crearRuntimeCompleto();
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir, log: () => {} });

    const r = await verificarPaquetesResolubles(facturacionDir);
    assert.strictEqual(r.ok, true, `faltantes: ${r.faltantes.join(', ')}`);
    assert.deepStrictEqual(r.faltantes, []);
    for (const pkg of REQUIRED_PACKAGES) assert.strictEqual(r.resultados[pkg].ok, true, pkg);
  });

  await check('si falta una dependencia real en el runtime, la verificación la reporta puntualmente', async () => {
    const facturacionDir = nuevoTmp('factur-verificacion-falta');
    const runtimeDir = nuevoTmp('runtime-incompleto');
    const nodeModulesDir = path.join(runtimeDir, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    for (const pkg of REQUIRED_PACKAGES) {
      if (pkg === 'soap') continue; // falta a propósito
      crearPaqueteFalso(nodeModulesDir, pkg);
    }
    ensureFacturacionNodeModulesLink({ facturacionDir, runtimeModulesDir: nodeModulesDir, log: () => {} });

    const r = await verificarPaquetesResolubles(facturacionDir);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.faltantes, ['soap']);
    assert.strictEqual(r.resultados.dotenv.ok, true);
  });

  await check('sin ningún runtime enlazado, la verificación falla para todos sin excepción no manejada', async () => {
    const facturacionDir = nuevoTmp('factur-verificacion-sin-runtime');
    fs.mkdirSync(facturacionDir, { recursive: true });
    const r = await verificarPaquetesResolubles(facturacionDir);
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.faltantes.sort(), [...REQUIRED_PACKAGES].sort());
  });

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* temporal */ }

  console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
})();
