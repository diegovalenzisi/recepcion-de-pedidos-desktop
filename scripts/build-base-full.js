/**
 * build-base-full.js
 * Genera el instalador BASE FULL de DLVSistema.
 *
 * Pasos:
 *   1. Robocopy D:\Facturacion\Diego\node_modules → resources\facturacion\node_modules
 *   2. vite build (app)
 *   3. npm install --omit=dev (backend)
 *   4. electron-builder --config electron-builder.base-full.yml
 *
 * Uso: npm run build:base-full
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');

const DIEGO_MODULES = 'D:\\Facturacion\\Diego\\node_modules';
const DEST_MODULES  = join(ROOT, 'resources', 'facturacion', 'node_modules');

function runCmd(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: ROOT,
    ...opts,
  });
  if (r.status !== 0 && r.status !== null) {
    console.error(`❌ Falló con código ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║  BUILD BASE FULL — DLVSistema Recepcion Pedidos  ║');
console.log('╚══════════════════════════════════════════════════╝\n');

// ── 1. Verificar fuente ───────────────────────────────────────────────────────
if (!existsSync(DIEGO_MODULES)) {
  console.error(`❌ No se encontró la fuente de node_modules:`);
  console.error(`   ${DIEGO_MODULES}`);
  console.error('   Verificá que D:\\Facturacion\\Diego\\node_modules existe.');
  process.exit(1);
}

// ── 2. Copiar node_modules → resources/facturacion/node_modules ───────────────
console.log('[1/4] Copiando node_modules AFIP...');
console.log(`      desde: ${DIEGO_MODULES}`);
console.log(`      hacia: ${DEST_MODULES}`);

mkdirSync(DEST_MODULES, { recursive: true });

const rc = spawnSync('robocopy', [
  DIEGO_MODULES, DEST_MODULES,
  '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP',
], { shell: false, windowsHide: true, stdio: 'pipe' });

if (rc.status < 0 || rc.status > 7) {
  console.error(`❌ robocopy falló con código ${rc.status}`);
  process.exit(1);
}

try {
  const soapPkg = join(DEST_MODULES, 'soap', 'package.json');
  if (existsSync(soapPkg)) {
    const soapVersion = JSON.parse(readFileSync(soapPkg, 'utf-8')).version;
    console.log(`✓ node_modules copiados (soap v${soapVersion})`);
  } else {
    console.log('✓ node_modules copiados');
  }
} catch { console.log('✓ node_modules copiados'); }

// ── 3. Vite build ─────────────────────────────────────────────────────────────
console.log('\n[2/4] Compilando app (vite build)...');
runCmd('npm', ['run', 'build']);

// ── 4. Backend deps ───────────────────────────────────────────────────────────
console.log('\n[3/4] Instalando deps del backend...');
runCmd('npm', ['install', '--omit=dev'], { cwd: join(ROOT, 'backend') });

// ── 5. electron-builder ───────────────────────────────────────────────────────
console.log('\n[4/4] Generando instalador BASE FULL (compression: store)...');
runCmd('npx', ['electron-builder', '--config', 'electron-builder.base-full.yml']);

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║  ✅ BASE FULL generado en release/               ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('\nPróximo paso: npm run prepare:base-full\n');
