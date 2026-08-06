// ---------------------------------------------------------------------------
// PUBLICACIÓN DE UNA VERSIÓN (Desktop y/o TAB) EN FIREBASE STORAGE.
//
// Uso:
//   node scripts/publicar-release.mjs desktop 1.3.70
//   node scripts/publicar-release.mjs tab 1.0.9
//
// Respeta el orden obligatorio: subir artefacto → descargarlo y comparar
// tamaño+SHA-256 → subir version.json → recién entonces latest.json → probar el
// actualizador → borrar la carpeta de la versión anterior.
//
// Si la verificación del artefacto descargado no coincide, ABORTA antes de
// tocar latest.json: nunca se anuncia una versión que no se pudo verificar.
//
// Credenciales: usa el refresh_token de la sesión de firebase-tools ya
// iniciada en esta PC. No las imprime nunca.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const BUCKET = 'achava3703.firebasestorage.app';
const API = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const urlDe = (obj) => `${API}/${encodeURIComponent(obj)}?alt=media`;

function credencialesCliente() {
  const p = path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'api.js');
  const s = fs.readFileSync(p, 'utf8');
  // envOverride("NOMBRE", "<valor>") — el valor es el SEGUNDO argumento.
  const id = s.match(/envOverride\(\s*["']FIREBASE_CLIENT_ID["']\s*,\s*["']([^"']+)["']/);
  const secret = s.match(/envOverride\(\s*["']FIREBASE_CLIENT_SECRET["']\s*,\s*["']([^"']+)["']/);
  if (!id || !secret) throw new Error('No se pudieron leer las credenciales de cliente de firebase-tools.');
  return { clientId: id[1], clientSecret: secret[1] };
}

async function accessToken() {
  const cfg = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const refresh = j?.tokens?.refresh_token || j?.user?.refresh_token;
  if (!refresh) throw new Error('No hay sesión de firebase-tools (falta refresh_token).');
  const { clientId, clientSecret } = credencialesCliente();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  if (!r.ok) throw new Error(`No se pudo renovar el access_token (HTTP ${r.status}).`);
  const { access_token: at } = await r.json();
  if (!at) throw new Error('Respuesta sin access_token.');
  return at;
}

async function subir(obj, archivo, contentType) {
  const at = await accessToken();
  const data = fs.readFileSync(archivo);
  const r = await fetch(`${API}?uploadType=media&name=${encodeURIComponent(obj)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': contentType },
    body: data,
  });
  if (!r.ok) throw new Error(`Falló la subida de ${obj}: HTTP ${r.status} ${await r.text()}`);
  return { size: data.length, sha256: sha256(data) };
}

async function descargar(obj) {
  const r = await fetch(urlDe(obj));
  if (!r.ok) throw new Error(`No se pudo descargar ${obj}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { size: buf.length, sha256: sha256(buf), buf };
}

async function listar(prefijo) {
  const at = await accessToken();
  const r = await fetch(`${API}?prefix=${encodeURIComponent(prefijo)}`, { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) throw new Error(`No se pudo listar ${prefijo}: HTTP ${r.status}`);
  return ((await r.json()).items || []).map((i) => i.name);
}

async function borrarPrefijo(prefijo) {
  const at = await accessToken();
  const borrados = [];
  for (const nombre of await listar(prefijo)) {
    const r = await fetch(`${API}/${encodeURIComponent(nombre)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${at}` } });
    if (!r.ok) throw new Error(`No se pudo borrar ${nombre}: HTTP ${r.status}`);
    borrados.push(nombre);
  }
  return borrados;
}

/** Sube el artefacto y NO sigue si lo publicado no coincide byte a byte. */
async function subirYVerificar(obj, archivo, contentType) {
  const local = fs.readFileSync(archivo);
  const hLocal = sha256(local);
  console.log(`   local  : ${local.length} bytes  sha256=${hLocal}`);
  await subir(obj, archivo, contentType);
  const rem = await descargar(obj);
  console.log(`   remoto : ${rem.size} bytes  sha256=${rem.sha256}`);
  if (rem.size !== local.length) throw new Error('ABORTA: el tamaño publicado no coincide.');
  if (rem.sha256 !== hLocal) throw new Error('ABORTA: el SHA-256 publicado no coincide.');
  console.log('   OK: tamaño y SHA-256 verificados contra el remoto.');
  return rem;
}

async function publicarDesktop(v) {
  const raizRepo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
  const exe = path.join(raizRepo, 'release', `Recepcion-de-Pedidos-Setup-${v}.exe`);
  const vjson = path.join(raizRepo, 'storage-componentes', 'software', v, 'version.json');
  const latest = path.join(raizRepo, 'storage-componentes', 'software', 'latest.json');
  for (const f of [exe, vjson, latest]) if (!fs.existsSync(f)) throw new Error(`Falta ${f}`);

  const anterior = JSON.parse((await descargar('instalaciones/software/latest.json')).buf.toString()).latest;
  console.log(`versión publicada actual: ${anterior} → nueva: ${v}\n`);
  if (anterior === v) throw new Error('Esa versión ya está publicada: no se reutilizan versiones.');

  console.log('1) instalador');
  const art = await subirYVerificar(`instalaciones/software/${v}/Recepcion-de-Pedidos-Setup-${v}.exe`, exe, 'application/octet-stream');

  console.log('2) version.json');
  await subirYVerificar(`instalaciones/software/${v}/version.json`, vjson, 'application/json');

  console.log('3) latest.json (recién ahora que el instalador está verificado)');
  const l = JSON.parse(fs.readFileSync(latest, 'utf8'));
  if (l.latest !== v) throw new Error(`latest.json local dice ${l.latest}, no ${v}.`);
  if (l.sha256 !== art.sha256 || l.size !== art.size) throw new Error('latest.json no coincide con el artefacto publicado.');
  await subirYVerificar('instalaciones/software/latest.json', latest, 'application/json');

  console.log('4) prueba del actualizador (lo que ve una PC con la versión anterior)');
  const pub = JSON.parse((await descargar('instalaciones/software/latest.json')).buf.toString());
  console.log(`   ofrece ${pub.latest} (mandatory=${pub.mandatory})`);
  const head = await fetch(pub.installerUrl, { method: 'GET', headers: { Range: 'bytes=0-1048575' } });
  if (!head.ok && head.status !== 206) throw new Error(`El installerUrl no se puede descargar: HTTP ${head.status}`);
  console.log(`   installerUrl descargable (HTTP ${head.status})`);
  if (pub.latest === anterior) throw new Error('El actualizador seguiría ofreciendo la versión vieja.');

  console.log(`5) limpieza de ${anterior}/`);
  console.log('   borrados:', (await borrarPrefijo(`instalaciones/software/${anterior}/`)).join(', ') || '(nada)');
  console.log('\nqueda en Storage:');
  console.log((await listar('instalaciones/software/')).map((x) => `   ${x}`).join('\n'));
}

async function publicarTab(v) {
  const raizTab = 'c:/DLVSistema/recepcion-de-pedidos-tab';
  const vjsonPath = path.join(raizTab, 'storage-tab', v, 'version.json');
  const latestPath = path.join(raizTab, 'storage-tab', 'latest.json');
  const meta = JSON.parse(fs.readFileSync(vjsonPath, 'utf8'));
  const apk = path.join(raizTab, 'android', 'app', 'build', 'outputs', 'apk', 'release', meta.fileName);
  for (const f of [apk, vjsonPath, latestPath]) if (!fs.existsSync(f)) throw new Error(`Falta ${f}`);

  const ant = JSON.parse((await descargar('instalaciones/tab/latest.json')).buf.toString());
  console.log(`versión publicada actual: ${ant.versionName} vc${ant.versionCode} → nueva: ${v} vc${meta.versionCode}\n`);
  if (ant.versionCode >= meta.versionCode) throw new Error('El versionCode nuevo no es mayor: la tablet no lo tomaría.');

  console.log('1) APK release');
  const art = await subirYVerificar(`instalaciones/tab/${v}/${meta.fileName}`, apk, 'application/vnd.android.package-archive');

  console.log('2) version.json');
  await subirYVerificar(`instalaciones/tab/${v}/version.json`, vjsonPath, 'application/json');

  console.log('3) latest.json (al final)');
  const l = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  if (l.versionName !== v || l.sha256 !== art.sha256 || l.size !== art.size) {
    throw new Error('latest.json no coincide con el APK publicado.');
  }
  await subirYVerificar('instalaciones/tab/latest.json', latestPath, 'application/json');

  console.log('4) prueba del actualizador (lo que ve una tablet con la versión anterior)');
  const pub = JSON.parse((await descargar('instalaciones/tab/latest.json')).buf.toString());
  console.log(`   ofrece ${pub.versionName} vc${pub.versionCode}; la tablet tiene vc${ant.versionCode}`);
  if (!(pub.versionCode > ant.versionCode)) throw new Error('La tablet vieja NO detectaría la nueva versión.');
  const r = await fetch(pub.apkUrl, { method: 'GET', headers: { Range: 'bytes=0-1048575' } });
  if (!r.ok && r.status !== 206) throw new Error(`El apkUrl no se puede descargar: HTTP ${r.status}`);
  console.log(`   apkUrl descargable (HTTP ${r.status})`);

  console.log(`5) limpieza de ${ant.versionName}/`);
  console.log('   borrados:', (await borrarPrefijo(`instalaciones/tab/${ant.versionName}/`)).join(', ') || '(nada)');

  console.log('\nqueda en Storage:');
  console.log((await listar('instalaciones/tab/')).map((x) => `   ${x}`).join('\n'));
}

const [destino, version] = process.argv.slice(2);
if (!['desktop', 'tab'].includes(destino) || !version) {
  console.error('Uso: node scripts/publicar-release.mjs <desktop|tab> <version>');
  process.exit(1);
}
await (destino === 'desktop' ? publicarDesktop(version) : publicarTab(version));
console.log('\nPublicación completa.');
