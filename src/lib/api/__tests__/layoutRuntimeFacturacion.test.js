// DESPLIEGUE REAL DEL RUNTIME FISCAL.
//
// Que el import funcione desde `resources/` en el repositorio no prueba nada: en
// producción el motor NO corre desde ahí. `syncFacturacionEngine()` copia el
// index.mjs a un directorio por cuenta, y las cuentas cuelgan a profundidades
// distintas:
//
//   userData/facturacion/
//   ├── package.json + node_modules/          ← compartido
//   └── locales/{localId}/
//       ├── ri/index.mjs                      ← 3 niveles hasta la raíz
//       └── mono/{cuentaId}/index.mjs         ← 4 niveles hasta la raíz
//
// Por eso los módulos compartidos se copian AL LADO del index.mjs: es lo único
// que da el MISMO import (`./claimPedido.mjs`) en las dos.
//
// Esta prueba arma ese layout en un directorio temporal, copia lo que copia el
// sync, e IMPORTA DE VERDAD desde ahí. Si alguien mueve el módulo, cambia el
// import o se olvida de sumarlo al sync, esto falla.
//
// Correr con: node src/lib/api/__tests__/layoutRuntimeFacturacion.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}
async function checkAsync(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const aquí = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(aquí, '../../../..');
const templates = path.join(repo, 'resources', 'facturacion');

// Debe coincidir con MODULOS_COMPARTIDOS_MOTOR en electron/main.js.
const MODULOS_COMPARTIDOS = ['claimPedido.mjs'];

// ---------------------------------------------------------------------------
console.log('\nLo que el sync tiene que encontrar en los templates:');

check('existen los dos motores', () => {
  assert.ok(fs.existsSync(path.join(templates, 'monotributo', 'index.mjs')), 'falta monotributo/index.mjs');
  assert.ok(fs.existsSync(path.join(templates, 'responsable-inscripto', 'index.mjs')), 'falta responsable-inscripto/index.mjs');
});

check('existe lib/ con los módulos compartidos', () => {
  for (const m of MODULOS_COMPARTIDOS) {
    assert.ok(fs.existsSync(path.join(templates, 'lib', m)), `falta lib/${m}`);
  }
});

check('electron/main.js declara exactamente esos módulos', () => {
  const main = fs.readFileSync(path.join(repo, 'electron', 'main.js'), 'utf8');
  const m = main.match(/MODULOS_COMPARTIDOS_MOTOR\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'no se encontró MODULOS_COMPARTIDOS_MOTOR en main.js');
  const declarados = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepStrictEqual(declarados.sort(), [...MODULOS_COMPARTIDOS].sort(),
    'la lista de main.js y la de esta prueba se desincronizaron');
});

// ---------------------------------------------------------------------------
console.log('\nLayout real de producción, reproducido en un temporal:');

// userData/facturacion/locales/40508022/{ri, mono/1}
const raíz = fs.mkdtempSync(path.join(os.tmpdir(), 'facturacion-layout-'));
const localeDir = path.join(raíz, 'locales', '40508022');
const cuentaRI = path.join(localeDir, 'ri');
const cuentaMono = path.join(localeDir, 'mono', '1');

/** Reproduce lo que hace syncFacturacionEngine() para una cuenta. */
function sincronizar(accountDir, tipo) {
  fs.mkdirSync(accountDir, { recursive: true });
  const templateDir = path.join(templates, tipo === 'responsable_inscripto' ? 'responsable-inscripto' : 'monotributo');
  fs.copyFileSync(path.join(templateDir, 'index.mjs'), path.join(accountDir, 'index.mjs'));
  for (const m of MODULOS_COMPARTIDOS) {
    fs.copyFileSync(path.join(templates, 'lib', m), path.join(accountDir, m));
  }
}

check('el sync deja el motor y sus módulos en cada cuenta', () => {
  sincronizar(cuentaRI, 'responsable_inscripto');
  sincronizar(cuentaMono, 'monotributo');
  for (const dir of [cuentaRI, cuentaMono]) {
    assert.ok(fs.existsSync(path.join(dir, 'index.mjs')), `falta index.mjs en ${dir}`);
    for (const m of MODULOS_COMPARTIDOS) {
      assert.ok(fs.existsSync(path.join(dir, m)), `falta ${m} en ${dir}`);
    }
  }
});

check('las dos cuentas quedan a PROFUNDIDADES distintas (por eso la copia al lado)', () => {
  const aRaízDesdeRI = path.relative(cuentaRI, raíz).split(path.sep).length;
  const aRaízDesdeMono = path.relative(cuentaMono, raíz).split(path.sep).length;
  assert.notStrictEqual(aRaízDesdeRI, aRaízDesdeMono,
    'si las profundidades fueran iguales, una copia compartida sería viable');
});

check('el import que usa cada motor es relativo a sí mismo', () => {
  for (const [dir, nombre] of [[cuentaMono, 'monotributo'], [cuentaRI, 'responsable-inscripto']]) {
    const src = fs.readFileSync(path.join(dir, 'index.mjs'), 'utf8');
    const imports = [...src.matchAll(/from\s+'(\.[^']+)'/g)].map((x) => x[1]);
    for (const imp of imports) {
      const destino = path.resolve(dir, imp);
      assert.ok(fs.existsSync(destino),
        `${nombre}: el import '${imp}' no resuelve en el layout instalado (${destino})`);
    }
  }
});

// ---------------------------------------------------------------------------
console.log('\nImport REAL desde el layout instalado:');

await checkAsync('claimPedido.mjs se importa y funciona desde la cuenta MONOTRIBUTO', async () => {
  const mod = await import(pathToFileURL(path.join(cuentaMono, 'claimPedido.mjs')).href);
  assert.strictEqual(typeof mod.reductorDeClaim, 'function');
  assert.strictEqual(typeof mod.decidirEmision, 'function');
  const nodo = mod.reductorDeClaim('PC_A', 1000)({ TOTAL: 100 });
  assert.strictEqual(nodo.claim.machineId, 'PC_A');
});

await checkAsync('claimPedido.mjs se importa y funciona desde la cuenta RI', async () => {
  const mod = await import(pathToFileURL(path.join(cuentaRI, 'claimPedido.mjs')).href);
  assert.strictEqual(typeof mod.reductorDeClaim, 'function');
  const d = mod.decidirEmision({ intentoPrevio: { nroCbte: 125 }, comprobanteEnArca: { CodAutorizacion: 'CAE-125' } });
  assert.strictEqual(d.accion, 'reconciliar');
  assert.strictEqual(d.nroCbte, 125);
});

await checkAsync('las dos cuentas cargan el MISMO módulo (misma versión)', async () => {
  const a = await import(pathToFileURL(path.join(cuentaMono, 'claimPedido.mjs')).href);
  const b = await import(pathToFileURL(path.join(cuentaRI, 'claimPedido.mjs')).href);
  assert.strictEqual(a.CLAIM_TTL_MS, b.CLAIM_TTL_MS, 'las dos copias tienen que ser idénticas');
  assert.strictEqual(
    fs.readFileSync(path.join(cuentaMono, 'claimPedido.mjs'), 'utf8'),
    fs.readFileSync(path.join(cuentaRI, 'claimPedido.mjs'), 'utf8'),
  );
});

check('una actualización reemplaza el módulo sin dejar restos', () => {
  const antes = fs.readFileSync(path.join(cuentaMono, 'claimPedido.mjs'), 'utf8');
  fs.writeFileSync(path.join(cuentaMono, 'claimPedido.mjs'), '// version vieja\n', 'utf8');
  sincronizar(cuentaMono, 'monotributo');            // como al actualizar la app
  assert.strictEqual(fs.readFileSync(path.join(cuentaMono, 'claimPedido.mjs'), 'utf8'), antes);
});

// Limpieza
try { fs.rmSync(raíz, { recursive: true, force: true }); } catch { /* temporal */ }

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
