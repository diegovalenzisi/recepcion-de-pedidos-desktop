// REPARACIÓN DE UNA CUENTA YA INSTALADA A LA QUE LE FALTA EL MÓDULO COMPARTIDO.
//
// Reproduce la PC real de IL CAPO (local 31915636, cuenta c1786113469909) tal
// como quedó con la 1.3.85:
//
//   facturacion/locales/31915636/mono/c1786113469909/
//   └── index.mjs          ← el NUEVO, que importa './claimPedido.mjs'
//       (falta claimPedido.mjs → ERR_MODULE_NOT_FOUND en bucle)
//
// Verifica que la rutina de sincronización de la 1.3.86:
//   · repare la cuenta existente sin recrearla ni entrar a Configuración;
//   · NO deje la cuenta a medias cuando la FUENTE está incompleta;
//   · no arranque el motor si falta algo (spawn = 0 llamadas).
//
// El import se prueba DE VERDAD desde el layout final, no con mocks.
//
// Correr con: node src/lib/api/__tests__/reparacionRuntimeFacturacion.test.js
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
const templatesReales = path.join(repo, 'resources', 'facturacion');
const MODULOS_COMPARTIDOS = ['claimPedido.mjs'];

// ---------------------------------------------------------------------------
// Réplica EXACTA de syncFacturacionEngine() de electron/main.js (1.3.86).
// Se mantiene en paralelo porque main.js no se puede importar sin Electron; la
// prueba de layout verifica que la lista de módulos no se desincronice.
// ---------------------------------------------------------------------------
function syncFacturacionEngine(accountDir, tipo, templatesDir) {
  if (!fs.existsSync(accountDir)) return { ok: false, faltantes: ['(no existe la cuenta)'] };
  const subdir = tipo === 'responsable_inscripto' ? 'responsable-inscripto' : 'monotributo';

  const fuentes = [
    { nombre: 'index.mjs', src: path.join(templatesDir, subdir, 'index.mjs'), dest: path.join(accountDir, 'index.mjs') },
    ...MODULOS_COMPARTIDOS.map((n) => ({
      nombre: `lib/${n}`, src: path.join(templatesDir, 'lib', n), dest: path.join(accountDir, n),
    })),
  ];

  // 1. Verificar TODAS las fuentes antes de tocar un solo archivo.
  const faltanFuentes = fuentes.filter((f) => !fs.existsSync(f.src));
  if (faltanFuentes.length > 0) {
    return { ok: false, faltantes: faltanFuentes.map((f) => f.nombre), fuente: templatesDir };
  }
  // 2. Copiar.
  for (const f of fuentes) fs.copyFileSync(f.src, f.dest);
  // 3. Verificar el destino.
  const faltanDestinos = fuentes.filter((f) => !fs.existsSync(f.dest));
  if (faltanDestinos.length > 0) {
    return { ok: false, faltantes: faltanDestinos.map((f) => f.nombre), fuente: templatesDir };
  }
  return { ok: true, faltantes: [], fuente: templatesDir };
}

/** spawn con contador, para demostrar que NO se llama con runtime incompleto. */
function spawnFacturacionProc(accountDir, tipo, templatesDir, contador) {
  const sync = syncFacturacionEngine(accountDir, tipo, templatesDir);
  if (!sync.ok) return { arrancado: false, faltantes: sync.faltantes };
  contador.llamadas += 1;
  return { arrancado: true, faltantes: [] };
}

/** Arma la PC de IL CAPO tal como quedó: index.mjs sí, claimPedido.mjs no. */
function pcDeIlCapo() {
  const raíz = fs.mkdtempSync(path.join(os.tmpdir(), 'ilcapo-'));
  const cuenta = path.join(raíz, 'facturacion', 'locales', '31915636', 'mono', 'c1786113469909');
  fs.mkdirSync(cuenta, { recursive: true });
  fs.copyFileSync(path.join(templatesReales, 'monotributo', 'index.mjs'), path.join(cuenta, 'index.mjs'));
  return { raíz, cuenta };
}

// ---------------------------------------------------------------------------
console.log('\nEl estado exacto de la PC rota:');

const { raíz, cuenta } = pcDeIlCapo();

check('la cuenta tiene index.mjs y NO tiene claimPedido.mjs', () => {
  assert.ok(fs.existsSync(path.join(cuenta, 'index.mjs')));
  assert.ok(!fs.existsSync(path.join(cuenta, 'claimPedido.mjs')));
});

check('ese index.mjs importa ./claimPedido.mjs (por eso explota)', () => {
  const src = fs.readFileSync(path.join(cuenta, 'index.mjs'), 'utf8');
  assert.match(src, /from '\.\/claimPedido\.mjs'/);
});

await checkAsync('hoy el import falla con ERR_MODULE_NOT_FOUND', async () => {
  await assert.rejects(
    () => import(pathToFileURL(path.join(cuenta, 'claimPedido.mjs')).href),
    (e) => e.code === 'ERR_MODULE_NOT_FOUND',
  );
});

// ---------------------------------------------------------------------------
console.log('\nDespués de la sincronización de 1.3.86:');

check('la cuenta EXISTENTE se repara sola, sin recrearla', () => {
  const r = syncFacturacionEngine(cuenta, 'monotributo', templatesReales);
  assert.strictEqual(r.ok, true, `faltantes: ${r.faltantes.join(', ')}`);
  assert.ok(fs.existsSync(path.join(cuenta, 'index.mjs')), 'index.mjs');
  assert.ok(fs.existsSync(path.join(cuenta, 'claimPedido.mjs')), 'claimPedido.mjs');
});

await checkAsync('el import REAL desde el destino ya funciona', async () => {
  const mod = await import(pathToFileURL(path.join(cuenta, 'claimPedido.mjs')).href);
  assert.strictEqual(typeof mod.reductorDeClaim, 'function');
  assert.strictEqual(typeof mod.decidirEmision, 'function');
});

check('todos los imports relativos del motor resuelven en el destino', () => {
  const src = fs.readFileSync(path.join(cuenta, 'index.mjs'), 'utf8');
  for (const [, imp] of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    assert.ok(fs.existsSync(path.resolve(cuenta, imp)), `no resuelve: ${imp}`);
  }
});

// ---------------------------------------------------------------------------
console.log('\nFuente incompleta: no se arranca y no se rompe la cuenta:');

check('con una fuente SIN lib/ no se llama a spawn ni una vez', () => {
  const fuenteRota = fs.mkdtempSync(path.join(os.tmpdir(), 'fuente-rota-'));
  fs.mkdirSync(path.join(fuenteRota, 'monotributo'), { recursive: true });
  fs.mkdirSync(path.join(fuenteRota, 'responsable-inscripto'), { recursive: true });
  fs.copyFileSync(path.join(templatesReales, 'monotributo', 'index.mjs'), path.join(fuenteRota, 'monotributo', 'index.mjs'));
  fs.copyFileSync(path.join(templatesReales, 'responsable-inscripto', 'index.mjs'), path.join(fuenteRota, 'responsable-inscripto', 'index.mjs'));
  // …pero SIN lib/. Es el runtime v1 de respaldo.

  const { cuenta: c2 } = pcDeIlCapo();
  fs.rmSync(path.join(c2, 'index.mjs'));           // cuenta vacía, como una nueva

  const contador = { llamadas: 0 };
  const r = spawnFacturacionProc(c2, 'monotributo', fuenteRota, contador);

  assert.strictEqual(r.arrancado, false, 'no puede arrancar');
  assert.strictEqual(contador.llamadas, 0, 'spawn NO puede llamarse');
  assert.deepStrictEqual(r.faltantes, ['lib/claimPedido.mjs']);
});

check('con la fuente incompleta NO se copia el index (la cuenta no queda a medias)', () => {
  const fuenteRota = fs.mkdtempSync(path.join(os.tmpdir(), 'fuente-rota2-'));
  fs.mkdirSync(path.join(fuenteRota, 'monotributo'), { recursive: true });
  fs.copyFileSync(path.join(templatesReales, 'monotributo', 'index.mjs'), path.join(fuenteRota, 'monotributo', 'index.mjs'));

  const raíz3 = fs.mkdtempSync(path.join(os.tmpdir(), 'cuenta-limpia-'));
  const c3 = path.join(raíz3, 'mono', 'c1');
  fs.mkdirSync(c3, { recursive: true });

  const r = syncFacturacionEngine(c3, 'monotributo', fuenteRota);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fs.existsSync(path.join(c3, 'index.mjs')), false,
    'ESTE era el bug de la 1.3.85: copiaba el index y después descubría que faltaba el módulo');
});

check('una cuenta rota se repara y ENTONCES sí arranca', () => {
  const { cuenta: c4 } = pcDeIlCapo();       // index sin claimPedido
  const contador = { llamadas: 0 };
  const r = spawnFacturacionProc(c4, 'monotributo', templatesReales, contador);
  assert.strictEqual(r.arrancado, true);
  assert.strictEqual(contador.llamadas, 1);
  assert.ok(fs.existsSync(path.join(c4, 'claimPedido.mjs')));
});

// ---------------------------------------------------------------------------
console.log('\nResponsable Inscripto, mismo escenario:');

check('la cuenta ri también se repara sola', () => {
  const raízRI = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-'));
  const cRI = path.join(raízRI, 'facturacion', 'locales', '31915636', 'ri');
  fs.mkdirSync(cRI, { recursive: true });
  fs.copyFileSync(path.join(templatesReales, 'responsable-inscripto', 'index.mjs'), path.join(cRI, 'index.mjs'));
  assert.ok(!fs.existsSync(path.join(cRI, 'claimPedido.mjs')));

  const r = syncFacturacionEngine(cRI, 'responsable_inscripto', templatesReales);
  assert.strictEqual(r.ok, true);
  assert.ok(fs.existsSync(path.join(cRI, 'claimPedido.mjs')));
  fs.rmSync(raízRI, { recursive: true, force: true });
});

try { fs.rmSync(raíz, { recursive: true, force: true }); } catch { /* temporal */ }

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
