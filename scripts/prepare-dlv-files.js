/**
 * prepare-dlv-files.js
 * Prepara D:\dlvsistema_archivos\ con todo lo necesario para instalar
 * el sistema en una PC nueva: instalador + deps-pack (node_modules AFIP).
 *
 * Uso: npm run prepare:dlv
 */

import {
  existsSync, mkdirSync, rmSync, readdirSync,
  statSync, writeFileSync, copyFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const DEST       = 'D:\\dlvsistema_archivos';

// ── helpers ──────────────────────────────────────────────────────────────────

function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB'; }

function robocopy(src, dst) {
  mkdirSync(dst, { recursive: true });
  const r = spawnSync('robocopy', [
    src, dst,
    '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP',
  ], { shell: false, windowsHide: true });
  return r.status >= 0 && r.status <= 7; // robocopy 0-7 = éxito
}

// ── 1. Limpiar y crear destino ────────────────────────────────────────────────

console.log('\n📦 Preparando carpeta de distribución DLV...\n');

if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
  console.log('✓ Carpeta anterior limpiada');
}
mkdirSync(DEST, { recursive: true });
mkdirSync(join(DEST, 'deps-pack', 'facturacion'), { recursive: true });

// ── 2. Instalador más reciente ────────────────────────────────────────────────

const releaseDir = join(ROOT, 'release');
const installers = readdirSync(releaseDir)
  .filter(f => f.endsWith('.exe') && f.includes('Setup'))
  .map(f => ({ name: f, mtime: statSync(join(releaseDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (installers.length === 0) {
  console.error('❌ No se encontró instalador en release/. Ejecutá npm run electron:build primero.');
  process.exit(1);
}

const installerName = installers[0].name;
copyFileSync(join(releaseDir, installerName), join(DEST, installerName));
const installerSize = statSync(join(DEST, installerName)).size;
console.log(`✓ Instalador: ${installerName} (${mb(installerSize)})`);

// ── 3. Deps-pack: node_modules AFIP (soap 1.2.1 + moment) ────────────────────
// Fuente preferida: D:\Facturacion\Diego\node_modules (probado y funcional)
// Fallback: userData/facturacion/node_modules (si ya fue actualizado)

const DIEGO_MODULES  = 'D:\\Facturacion\\Diego\\node_modules';
const USERDATA       = join(os.homedir(), 'AppData', 'Roaming', 'recepcion-de-pedidos-desktop');
const USERDATA_MODS  = join(USERDATA, 'facturacion', 'node_modules');
const DEST_MODULES   = join(DEST, 'deps-pack', 'facturacion', 'node_modules');

let moduleSrc = null;
if (existsSync(DIEGO_MODULES)) {
  moduleSrc = DIEGO_MODULES;
} else if (existsSync(USERDATA_MODS)) {
  moduleSrc = USERDATA_MODS;
  console.log('ℹ️  Usando node_modules desde AppData (D:\\Facturacion\\Diego no encontrado)');
}

if (moduleSrc) {
  // Verificar soap version antes de copiar
  const soapPkg = join(moduleSrc, 'soap', 'package.json');
  let soapVersion = '?';
  if (existsSync(soapPkg)) {
    try { soapVersion = JSON.parse(await import('fs').then(m => m.promises.readFile(soapPkg, 'utf8'))).version; } catch {}
  }
  console.log(`Copiando node_modules (fuente: ${moduleSrc}, soap v${soapVersion})...`);
  if (robocopy(moduleSrc, DEST_MODULES)) {
    console.log(`✓ node_modules copiados (${mb(dirSize(DEST_MODULES))})`);
  } else {
    console.warn('⚠️  robocopy completó con advertencias — revisar manualmente');
  }
} else {
  console.warn('⚠️  No se encontró fuente de node_modules AFIP.');
  console.warn('    Copiá manualmente D:\\Facturacion\\Diego\\node_modules a deps-pack\\facturacion\\node_modules\\');
}

// ── 4. LEEME_INSTALACION.txt ──────────────────────────────────────────────────

const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const appdataPath = '%APPDATA%\\recepcion-de-pedidos-desktop';

const leeme = `INSTRUCCIONES DE INSTALACIÓN — Recepción de Pedidos
=====================================================
Preparado: ${today}  |  Versión: ${installerName.replace('Recepción de Pedidos Setup ', '').replace('.exe', '')}

CONTENIDO DE ESTA CARPETA
--------------------------
  📄 ${installerName}
        → Instalador principal. Ejecutar primero.

  📁 deps-pack\\facturacion\\node_modules\\
        → Módulos AFIP (soap, firebase-admin, moment, etc.)
        → Copiar a mano DESPUÉS de instalar la app (ver Paso 2).

  📄 LEEME_INSTALACION.txt
        → Este archivo.


PASOS PARA INSTALAR EN PC NUEVA
---------------------------------

PASO 1 — INSTALAR LA APP
  Ejecutar: ${installerName}
  Seguir el asistente de instalación.
  La app queda en el Menú Inicio como "Recepción de Pedidos".

PASO 2 — COPIAR MÓDULOS AFIP (deps-pack, 1 vez por PC)
  Copiar la carpeta:
    deps-pack\\facturacion\\node_modules\\

  A esta ruta en la PC nueva:
    ${appdataPath}\\facturacion\\node_modules\\

  ► Cómo llegar a esa ruta:
    1. Presionar Windows + R
    2. Escribir:  ${appdataPath}
    3. Enter → se abre la carpeta de la app
    4. Abrir la subcarpeta "facturacion"
    5. Pegar la carpeta "node_modules" ahí adentro

PASO 3 — ABRIR LA APP
  Abrir "Recepción de Pedidos" desde el Menú Inicio.
  Al primer uso pide el ID del local.
  Ingresarlo → el sistema descarga automáticamente:
    - Certificados AFIP desde la nube
    - Configuración del local
    - Cuentas de facturación

PASO 4 — VERIFICAR ESTADO
  Ir a Configuración → Admin → el panel de diagnóstico muestra
  el estado de todos los componentes con indicadores verdes/rojos.
  Si algo falta, el panel indica qué hacer.


QUÉ NO SE INCLUYE AQUÍ (por seguridad)
----------------------------------------
  ✗ Certificados AFIP (.crt / .key)  → se descargan desde Firebase
  ✗ serviceAccount.json              → se descarga desde Firebase
  ✗ Archivos .env con datos reales   → se generan automáticamente
  ✗ Tokens de MercadoPago            → se ingresan 1 sola vez desde la app
  ✗ Claves o contraseñas             → nunca se distribuyen en pendrive


SOLUCIÓN DE PROBLEMAS
----------------------
  • Facturación AFIP no inicia:
    Verificar que "node_modules" esté copiado (Paso 2).
    Ir a panel de diagnóstico en la app.

  • Error "local ID no configurado":
    Es el primer uso — ingresar el ID del local cuando lo pida.

  • Error de conexión a Firebase:
    Verificar conexión a Internet.


Soporte: dlvalenzisi@gmail.com
`;

writeFileSync(join(DEST, 'LEEME_INSTALACION.txt'), leeme, 'utf8');
console.log('✓ LEEME_INSTALACION.txt generado');

// ── 5. Resumen final ──────────────────────────────────────────────────────────

const totalSize = dirSize(DEST);
console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Carpeta lista: ${DEST}`);
console.log(`📊 Tamaño total: ${mb(totalSize)}\n`);
console.log('Contenido:');
for (const entry of readdirSync(DEST, { withFileTypes: true })) {
  const full = join(DEST, entry.name);
  const size = entry.isDirectory() ? mb(dirSize(full)) : mb(statSync(full).size);
  console.log(`  ${entry.isDirectory() ? '📁' : '📄'} ${entry.name.padEnd(55)} ${size}`);
}
console.log(`\n🚀 Lista para copiar a pendrive o compartir por red.`);
