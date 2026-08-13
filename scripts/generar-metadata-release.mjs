// ---------------------------------------------------------------------------
// GENERACIÓN LOCAL de version.json y latest.json a partir de metadatos
// VERIFICADOS del artefacto real (SHA-256 y tamaño se calculan leyendo el
// archivo — nunca se aceptan como argumento, para que no puedan tipearse
// mal). Paso previo obligatorio a scripts/publicar-release.mjs, que es el
// que efectivamente sube y verifica contra Firebase.
//
// No toca Firebase. Solo escribe archivos locales.
//
// Uso:
//   node scripts/generar-metadata-release.mjs desktop 1.3.92 [--mandatory] [--notes="..."]
//   node scripts/generar-metadata-release.mjs tab 1.0.12 13 [--mandatory] [--notes="..."]
//
// Desktop espera el instalador ya copiado en:
//   release/Recepcion-de-Pedidos-Setup-<version>.exe
// (electron-builder genera "Recepción de Pedidos Setup <version>.exe", con
// tilde y espacios; publicar-release.mjs espera el nombre sin tilde/espacios
// — igual que todas las versiones publicadas hasta ahora en release/).
//
// Tab espera el APK release ya generado en:
//   android/app/build/outputs/apk/release/app-release.apk
// Este script lo copia (no lo mueve) al nombre versionado
// recepcion-tab-<version>-vc<versionCode>-release.apk antes de hashearlo,
// siguiendo la misma convención que las versiones anteriores en storage-tab/.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function sha256YTamano(filePath) {
  const buf = fs.readFileSync(filePath);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}

function parseFlags(argv) {
  let mandatory = false;
  let notes = '';
  for (const a of argv) {
    if (a === '--mandatory') mandatory = true;
    else if (a.startsWith('--notes=')) notes = a.slice('--notes='.length);
  }
  return { mandatory, notes };
}

function hoy() {
  return new Date().toISOString().split('T')[0];
}

function escribirJson(destino, obj) {
  fs.writeFileSync(destino, JSON.stringify(obj, null, 2) + '\n');
  console.log(`[generar-metadata] escrito: ${destino}`);
}

function generarDesktop(version, { mandatory, notes }) {
  const raizRepo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
  const nombreInstalador = `Recepcion-de-Pedidos-Setup-${version}.exe`;
  const exePath = path.join(raizRepo, 'release', nombreInstalador);
  if (!fs.existsSync(exePath)) {
    throw new Error(
      `No se encontró ${exePath}.\n` +
      `Generá el build con "npm run electron:build" y copiá/renombrá el .exe resultante a ese nombre exacto.`
    );
  }

  const { sha256, size } = sha256YTamano(exePath);
  console.log(`[generar-metadata] ${nombreInstalador}: ${size} bytes, sha256=${sha256}`);

  const versionDir = path.join(raizRepo, 'storage-componentes', 'software', version);
  fs.mkdirSync(versionDir, { recursive: true });
  escribirJson(path.join(versionDir, 'version.json'), {
    version,
    installer: nombreInstalador,
    releaseDate: hoy(),
    sha256,
    notes,
  });

  const objectPath = `instalaciones/software/${version}/${nombreInstalador}`;
  escribirJson(path.join(raizRepo, 'storage-componentes', 'software', 'latest.json'), {
    latest: version,
    installerUrl: `https://firebasestorage.googleapis.com/v0/b/achava3703.firebasestorage.app/o/${encodeURIComponent(objectPath)}?alt=media`,
    sha256,
    size,
    mandatory,
    releaseDate: hoy(),
    notes: `Version ${version}. ${notes}`,
  });
}

function generarTab(version, versionCodeStr, { mandatory, notes }) {
  const versionCode = Number(versionCodeStr);
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error(`versionCode inválido: "${versionCodeStr}"`);
  }

  const raizTab = 'c:/DLVSistema/recepcion-de-pedidos-tab';
  const apkOrigen = path.join(raizTab, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!fs.existsSync(apkOrigen)) {
    throw new Error(`No se encontró ${apkOrigen}. Generalo primero con: cd android && ./gradlew assembleRelease`);
  }

  const fileName = `recepcion-tab-${version}-vc${versionCode}-release.apk`;
  const apkVersionado = path.join(path.dirname(apkOrigen), fileName);
  fs.copyFileSync(apkOrigen, apkVersionado);

  const { sha256, size } = sha256YTamano(apkVersionado);
  console.log(`[generar-metadata] ${fileName}: ${size} bytes, sha256=${sha256}`);

  // Verificación cruzada: la copia debe ser byte a byte idéntica al original.
  const original = sha256YTamano(apkOrigen);
  if (original.sha256 !== sha256 || original.size !== size) {
    throw new Error('La copia del APK no coincide con el original — abortando.');
  }

  const versionDir = path.join(raizTab, 'storage-tab', version);
  fs.mkdirSync(versionDir, { recursive: true });
  escribirJson(path.join(versionDir, 'version.json'), {
    versionName: version,
    versionCode,
    releaseDate: hoy(),
    fileName,
    size,
    sha256,
    applicationId: 'com.dlvsistemas.recepciontab',
    notes,
  });

  const objectPath = `instalaciones/tab/${version}/${fileName}`;
  escribirJson(path.join(raizTab, 'storage-tab', 'latest.json'), {
    versionName: version,
    versionCode,
    mandatory,
    apkUrl: `https://firebasestorage.googleapis.com/v0/b/achava3703.firebasestorage.app/o/${encodeURIComponent(objectPath)}?alt=media`,
    fileName,
    size,
    sha256,
    releaseDate: hoy(),
    notes,
  });
}

const [destino, version, terceroPosicional, ...resto] = process.argv.slice(2);
if (!['desktop', 'tab'].includes(destino) || !version) {
  console.error('Uso: node scripts/generar-metadata-release.mjs desktop <version> [--mandatory] [--notes="..."]');
  console.error('     node scripts/generar-metadata-release.mjs tab <versionName> <versionCode> [--mandatory] [--notes="..."]');
  process.exit(1);
}

try {
  if (destino === 'desktop') {
    generarDesktop(version, parseFlags([terceroPosicional, ...resto].filter(Boolean)));
  } else {
    if (!terceroPosicional) throw new Error('Falta versionCode para tab.');
    generarTab(version, terceroPosicional, parseFlags(resto));
  }
  console.log('\n[generar-metadata] Listo. Nada se subió a Firebase todavía.');
} catch (e) {
  console.error(`\n[generar-metadata] ERROR: ${e.message}`);
  process.exit(1);
}
