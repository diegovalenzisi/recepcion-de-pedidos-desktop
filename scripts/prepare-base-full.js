/**
 * prepare-base-full.js
 * Prepara D:\dlvsistema_archivos\base-full\ con el instalador BASE FULL.
 *
 * Uso: npm run prepare:base-full
 */

import {
  existsSync, mkdirSync, rmSync, readdirSync,
  statSync, writeFileSync, copyFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const DEST       = 'D:\\dlvsistema_archivos\\base-full';

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB'; }

// ── 1. Limpiar y crear destino ────────────────────────────────────────────────
console.log('\n📦 Preparando carpeta BASE FULL para distribución...\n');

if (existsSync(DEST)) {
  rmSync(DEST, { recursive: true, force: true });
  console.log('✓ Carpeta anterior limpiada');
}
mkdirSync(DEST, { recursive: true });

// ── 2. Buscar instalador BASE FULL en release/ ────────────────────────────────
const releaseDir = join(ROOT, 'release');
const installers = readdirSync(releaseDir)
  .filter((f) => f.includes('BASE-FULL') && f.endsWith('.exe'))
  .map((f) => ({ name: f, mtime: statSync(join(releaseDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (installers.length === 0) {
  console.error('❌ No se encontró instalador BASE FULL en release/');
  console.error('   Ejecutá npm run build:base-full primero.');
  process.exit(1);
}

const installerName = installers[0].name;
copyFileSync(join(releaseDir, installerName), join(DEST, installerName));
const installerSize = statSync(join(DEST, installerName)).size;
console.log(`✓ Instalador: ${installerName} (${mb(installerSize)})`);

// ── 3. metadata.json ──────────────────────────────────────────────────────────
const version = installerName.match(/BASE-FULL-([\d.]+)\.exe$/)?.[1] ?? '1.0.0';
const today   = new Date().toISOString().split('T')[0];

const metadata = {
  version,
  nombreArchivo: installerName,
  url: '',
  fecha: today,
  tipo: 'base-full',
  descripcion: 'Instalador completo para PC nueva. No requiere instalación manual de dependencias.',
  contiene: [
    'App Recepción de Pedidos (frontend + Electron)',
    'Backend Mercado Pago (utilityProcess.fork, Node embebido de Electron)',
    'Node.js 16.20.2 para AFIP (resources/node-afip/node.exe)',
    'OpenSSL 1.1.1v incluido en Node 16.20.2',
    'node_modules AFIP: soap 1.2.1, firebase-admin, pdfkit, qrcode, moment, dotenv',
    'Motor Responsable Inscripto (resources/facturacion/ri/index.mjs)',
    'Motor Monotributo (resources/facturacion/monotributo/index.mjs)',
    'openssl.cnf (resources/facturacion/openssl.cnf)',
  ],
  noContiene: [
    'Certificados AFIP (.crt/.key) — se descargan desde Firebase Storage',
    'serviceAccount.json — se descarga desde Firebase Storage',
    '.env con datos reales — se genera automáticamente',
    'Tokens de Mercado Pago — se ingresan desde Configuración',
    'Claves privadas — nunca se distribuyen',
  ],
  rutasDestino: {
    app: '%LOCALAPPDATA%\\Programs\\recepcion-de-pedidos-desktop\\',
    nodeAfip: '%resources%\\node-afip\\node.exe',
    facturacionNodeModules: '%APPDATA%\\recepcion-de-pedidos-desktop\\facturacion\\node_modules\\ (copiado automáticamente al primer arranque)',
  },
};

writeFileSync(join(DEST, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
console.log('✓ metadata.json generado');

// ── 4. LEEME ──────────────────────────────────────────────────────────────────
const leeme = `INSTALADOR BASE FULL — DLVSistema Recepción de Pedidos
=======================================================
Versión BASE FULL : ${version}
Fecha             : ${today}
Archivo           : ${installerName}
Tamaño            : ${mb(installerSize)}


QUÉ INCLUYE
-----------
  ✓ App Recepción de Pedidos (frontend + Electron)
  ✓ Backend Mercado Pago (corriendo con el Node de Electron)
  ✓ Node.js 16.20.2 para AFIP con OpenSSL 1.1.1v integrado
  ✓ node_modules AFIP completos (soap 1.2.1, firebase-admin, pdfkit, qrcode, moment)
  ✓ Motor Responsable Inscripto (RI)
  ✓ Motor Monotributo (hasta 5 cuentas)
  ✓ openssl.cnf para compatibilidad TLS AFIP


INSTALACIÓN EN PC NUEVA (WINDOWS)
----------------------------------
PASO 1 — Ejecutar: ${installerName}
         Seguir el asistente. Todo se instala automáticamente.

PASO 2 — Abrir "Recepción de Pedidos" desde el Menú Inicio.
         Al PRIMER arranque, la app copia los módulos AFIP a %APPDATA%
         automáticamente (proceso silencioso, dura 10-30 segundos).

PASO 3 — Ingresar el ID del local cuando la app lo pida.

PASO 4 — La app descarga automáticamente desde Firebase:
         ✓ Configuración del local
         ✓ Certificados AFIP (si el local está configurado en Firebase)
         ✓ serviceAccount Firebase
         ✓ Genera los archivos .env necesarios


NO NECESITÁS:
  ✗ Instalar Node.js
  ✗ Instalar npm
  ✗ Instalar OpenSSL
  ✗ Copiar node_modules manualmente
  ✗ Copiar node.exe manualmente
  ✗ Configurar rutas técnicas
  ✗ Abrir consola ni terminal


NO INCLUYE (por seguridad):
  ✗ Certificados AFIP reales (.crt/.key)
  ✗ serviceAccount.json real
  ✗ .env con datos de producción
  ✗ Tokens de Mercado Pago
  ✗ Claves privadas de ningún tipo


SUBIR A FIREBASE (para distribución remota):
  1. Subir ${installerName} a Firebase Storage
     Ruta sugerida: dlvsistema/base-full/${installerName}
  2. Obtener URL de descarga
  3. Actualizar en Firebase RTDB:
     /DLVSistema/instaladores/baseFull/
     {
       "version": "${version}",
       "nombreArchivo": "${installerName}",
       "url": "URL_DE_STORAGE",
       "fecha": "${today}",
       "tipo": "base-full"
     }


ACTUALIZACIONES FUTURAS
-----------------------
Las actualizaciones normales (UPDATE LITE) son livianas (~131 MB) y
NO reemplazan los node_modules ni node.exe ya copiados en %APPDATA%.
Solo actualizan el código de la app (archivo .asar).


Soporte: dlvalenzisi@gmail.com
`;

writeFileSync(join(DEST, 'LEEME_BASE_FULL.txt'), leeme, 'utf-8');
console.log('✓ LEEME_BASE_FULL.txt generado');

// ── 5. Resumen ────────────────────────────────────────────────────────────────
const totalSize = installerSize;
console.log(`\n${'─'.repeat(55)}`);
console.log(`✅ Carpeta lista: ${DEST}`);
console.log(`📊 Tamaño instalador: ${mb(totalSize)}`);
console.log('\nContenido:');
for (const entry of readdirSync(DEST, { withFileTypes: true })) {
  const full  = join(DEST, entry.name);
  const size  = mb(statSync(full).size);
  console.log(`  📄 ${entry.name.padEnd(65)} ${size}`);
}
console.log(`\n🚀 Lista para copiar a pendrive, red o subir a Firebase Storage.`);
console.log(`\nPara subir a Firebase (próximamente):`);
console.log(`  npm run upload:base-full`);
console.log('');
