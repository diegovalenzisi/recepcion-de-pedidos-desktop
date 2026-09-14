'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, utilityProcess, Menu, globalShortcut, protocol } = require('electron');

// Permite que speechSynthesis y audio funcionen sin gesto de usuario al arranque.
// Necesario para anunciar pagos pendientes al iniciar la app (Firebase listener + seenIds vacío).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('path');
const os = require('os');
const { randomUUID, createHash } = require('crypto');
const { spawn, execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync, appendFileSync, createWriteStream, createReadStream, unlink, unlinkSync, mkdirSync, copyFileSync, cpSync, rmSync, statSync, renameSync, readdirSync } = require('fs');
const https = require('https');
const http  = require('http');
const { resolveRequestTransport, normalizeFirebaseDatabaseURL, classifyTransportError } = require('./lib/firebaseHttpTransport');
const { createImageCacheService, assertRedirectAllowed, DEFAULT_ALLOWED_DOWNLOAD_HOSTS, validateDownloadUrl: validateImageDownloadUrl } = require('./lib/imageCacheService');
// Política de arranque de la facturación automática (módulo puro, con pruebas).
const {
  BILLING_AUTOSTART_POLICY_VERSION,
  migrarPoliticaAutoStart: migrarPolitica,
  facturacionHabilitada,
  colaDesdeFirebasePath,
} = require('./lib/decidirArranqueFacturacion');
// node_modules compartido del motor de facturación (junction hacia
// facturacion-runtime/node_modules). Módulo con pruebas propias: ver
// electron/lib/facturacionRuntimeLink.js.
const {
  ensureFacturacionNodeModulesLink,
  verificarPaquetesResolubles,
} = require('./lib/facturacionRuntimeLink');
// Borrado de credenciales de una cuenta fiscal (RI/Monotributo) al eliminarla.
const { eliminarCredencialesDeCuenta } = require('./lib/facturacionAccountDelete');
// Preferencia LOCAL por máquina (nunca por Firebase, nunca por local activo):
// si esta PC debe autoarrancar sus motores fiscales. Ver electron/lib/machineSettings.js.
const {
  leerMachineSettings,
  facturacionAutoStartHabilitado,
  setFacturacionAutoStartEnabled,
} = require('./lib/machineSettings');
// Host fiscal único por local (módulo puro, con pruebas: ver
// electron/lib/facturacionHost.js). Firebase client SDK usado desde el
// proceso principal SOLO para esta elección — nunca para datos de negocio,
// que siguen viviendo en el renderer.
const {
  HEARTBEAT_INTERVALO_MS,
  LEASE_MS: FACTURACION_HOST_LEASE_MS,
  TOMA_CONTROL_REINTENTO_MS,
  TOMA_CONTROL_TIMEOUT_MS,
  reductorDeHost,
  reductorDeLiberacion,
} = require('./lib/facturacionHost');
const { initializeApp: initializeFirebaseApp } = require('firebase/app');
const {
  getDatabase: getFirebaseDatabase,
  ref: firebaseRef,
  onValue: onFirebaseValue,
  runTransaction: runFirebaseTransaction,
  set: setFirebaseValue,
} = require('firebase/database');
// Microsoft Visual C++ Redistributable (VCRUNTIME140.dll) para el OpenSSL
// bundled. Ver electron/lib/vcRedist.js.
const { asegurarVcRedistSiHaceFalta, getVcRedistResourcePath } = require('./lib/vcRedist');
// Orden manual de opcionales/sabores: LOCAL por PC, nunca en Firebase.
// Ver electron/lib/optionalesOrdenLocal.js.
const {
  rutaArchivoOrden: rutaArchivoOrdenOpcionales,
  leerArchivoOrden: leerArchivoOrdenOpcionales,
  escribirArchivoOrden: escribirArchivoOrdenOpcionales,
  obtenerOrdenesDelDispositivo,
  conOrdenActualizado: conOrdenOpcionalActualizado,
  conOrdenesMultiplesActualizadas,
} = require('./lib/optionalesOrdenLocal');

const isDev = !app.isPackaged;

// Instalador oficial de Microsoft, incluido como recurso (nunca se descarga
// de Internet): ver "extraResources" -> resources/vcredist en package.json.
function vcRedistResourcePath() {
  return getVcRedistResourcePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot: path.join(__dirname, '..'),
  });
}

// ---------------------------------------------------------------------------
// UNA SOLA INSTANCIA POR PC
//
// Va ACÁ ARRIBA, antes de registrar IPC, abrir la ventana, levantar el backend,
// Firebase, los listeners, el motor de facturación o la impresión. Ese es el
// punto: la segunda instancia tiene que morir ANTES de llegar a cualquiera de
// esas cosas, no ocultar un formulario después de haberlo abierto.
//
// Sin esto, un doble clic con la aplicación ya abierta arrancaba un segundo
// proceso que volvía a correr la configuración inicial y podía duplicar
// listeners y motores.
//
// `mostrarVentanaPrincipal()` NO cambia de sección ni recarga nada: solo trae al
// frente la ventana que ya existe, con la pantalla donde el usuario estaba.
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[APP] Ya existe una instancia activa. Cerrando segunda instancia.');
  app.quit();
} else {
  app.on('second-instance', () => {
    console.log('[APP] Segundo intento de apertura detectado');
    mostrarVentanaPrincipal();
  });
}

// ---------------------------------------------------------------------------
// Caché local de imágenes de artículos — esquema privilegiado dlvimg://
// El registro del esquema DEBE ocurrir antes de app.ready (por eso está en el
// top-level del módulo). Privilegios mínimos para poder cargar imágenes desde
// <img src> en un contexto seguro: standard + secure + stream. No se habilita
// fetch/CORS (no hace falta para <img>).
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'dlvimg', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: true } },
]);

let imageCacheService = null; // se instancia en app.whenReady (necesita userData)

// httpGet para el servicio de caché: descarga con guardia de tamaño máximo,
// sigue redirects (Firebase puede responder 302), y NUNCA bufferea más de
// maxBytes (aborta la conexión si se excede). Reusa resolveRequestTransport
// para elegir http/https por el parser estándar (nunca por texto).
function dlvimgHttpGet(rawUrl, { maxBytes = 10 * 1024 * 1024, redirectsLeft = 4, allowedHosts = DEFAULT_ALLOWED_DOWNLOAD_HOSTS } = {}) {
  return new Promise((resolve, reject) => {
    let transport;
    try {
      transport = resolveRequestTransport(rawUrl);
    } catch (e) { reject(e); return; }
    const req = transport.module.get(transport.url, (res) => {
      const status = res.statusCode || 0;
      // Redirect — el destino DEBE seguir dentro de los hosts permitidos
      // (requisito 2). assertRedirectAllowed lanza si no.
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('demasiados redirects')); return; }
        let nextUrl;
        try {
          nextUrl = assertRedirectAllowed(res.headers.location, transport.url.toString(), allowedHosts);
        } catch (e) { reject(e); return; }
        resolve(dlvimgHttpGet(nextUrl, { maxBytes, redirectsLeft: redirectsLeft - 1, allowedHosts }));
        return;
      }
      const chunks = [];
      let total = 0;
      let aborted = false;
      res.on('data', (chunk) => {
        if (aborted) return;
        total += chunk.length;
        if (total > maxBytes) { // no bufferear de más
          aborted = true;
          req.destroy();
          resolve({ status, buffer: Buffer.concat(chunks), contentType: res.headers['content-type'], headers: res.headers, truncated: true });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (aborted) return;
        resolve({ status, buffer: Buffer.concat(chunks), contentType: res.headers['content-type'], headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('timeout descargando imagen')); });
  });
}

let imageCacheProtocolRegistered = false; // evita registrar el handler dos veces

// Registra el handler del protocolo dlvimg:// y los IPC del caché de imágenes.
// Debe llamarse DESPUÉS de app.ready. Idempotente.
function setupImageCacheIPC() {
  if (imageCacheProtocolRegistered) return; // ya configurado en este proceso
  if (!imageCacheService) {
    imageCacheService = createImageCacheService({
      root: path.join(app.getPath('userData'), 'cache', 'article-images'),
      httpGet: dlvimgHttpGet,
      debug: process.env.DLV_IMG_DEBUG === '1', // logs con tags solo si se pide
      logger: { warn: (...a) => console.warn(...a), error: (...a) => console.error(...a), info: (...a) => console.log(...a) },
    });
  }

  // Sirve SOLO archivos registrados en el manifiesto, dentro de la carpeta del
  // local. resolveProtocolPath rechaza traversal / keys / locales inválidos y
  // verifica que el archivo exista, sea regular y coincida en tamaño.
  protocol.handle('dlvimg', async (request) => {
    try {
      // dlvimg://img/{localId}/{key}?v={version}  — localId va en el PATH (no en
      // el host) para no ser interpretado como IPv4 cuando es numérico. El `?v=`
      // se ignora para resolver (solo invalida la caché de Chromium).
      const { localId, key } = imageCacheService.parseProtocolUrl(request.url);
      const { path: filePath, contentType } = await imageCacheService.resolveProtocolPath(localId, key);
      const data = await require('fs').promises.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': contentType,
          // no-store: Chromium nunca conserva una versión anterior en su caché
          // HTTP; combinado con el `?v=` versionado, un cambio de imagen fuerza
          // recarga real (requisito 1).
          'cache-control': 'no-store, no-cache, must-revalidate',
        },
      });
    } catch (e) {
      // Nunca exponer detalles de ruta: solo un 404 controlado.
      return new Response('', { status: 404, headers: { 'cache-control': 'no-store' } });
    }
  });
  imageCacheProtocolRegistered = true;

  ipcMain.handle('image-cache:resolve-local', async (_e, { localId, bucket, objectPath }) => {
    try {
      const r = await imageCacheService.resolveLocal(localId, bucket, objectPath);
      return { ok: true, key: r.key, cached: r.cached, protocolUrl: r.protocolUrl || null, entry: r.entry || null };
    } catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });

  ipcMain.handle('image-cache:should-check', async (_e, { entry, force }) => {
    try { return { ok: true, should: imageCacheService.shouldCheckMetadata(entry, { force }) }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });

  ipcMain.handle('image-cache:record-check', async (_e, { localId, bucket, objectPath, remoteMeta, downloadUrl }) => {
    try { const r = await imageCacheService.recordMetadataCheck(localId, bucket, objectPath, remoteMeta, downloadUrl); return { ok: true, ...r }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });

  ipcMain.handle('image-cache:download', async (_e, { localId, bucket, objectPath, url, remoteMeta }) => {
    try {
      // El MAIN valida la URL antes de descargar (requisito 2): https, host de
      // Firebase/Storage permitido, y que el bucket+objectPath del path de la URL
      // coincidan EXACTAMENTE con los declarados por el renderer. Así una llamada
      // IPC alterada no convierte el servicio en un descargador arbitrario.
      const check = validateImageDownloadUrl(url, { bucket, objectPath });
      if (!check.ok) return { ok: false, code: check.code, message: 'URL de descarga rechazada por el main' };
      const r = await imageCacheService.download(localId, bucket, objectPath, { url, remoteMeta });
      return { ok: true, protocolUrl: r.protocolUrl, key: r.key };
    } catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });

  ipcMain.handle('image-cache:mark-remote-deleted', async (_e, { localId, bucket, objectPath }) => {
    try { const r = await imageCacheService.markRemoteDeleted(localId, bucket, objectPath); return { ok: true, ...r }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });

  ipcMain.handle('image-cache:clear-remote-deleted', async (_e, { localId, bucket, objectPath, remoteMeta }) => {
    try { const r = await imageCacheService.clearRemoteDeleted(localId, bucket, objectPath, remoteMeta); return { ok: true, ...r }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });

  ipcMain.handle('image-cache:sweep', async (_e, { localId, validRefs, catalogComplete }) => {
    try {
      // El main calcula las keys (sha1 de bucket+objectPath) para no duplicar el
      // hashing en el renderer y garantizar que coincidan exactamente.
      const keys = new Set();
      for (const r of (validRefs || [])) {
        try { keys.add(imageCacheService.makeStableKey(r.bucket, r.objectPath)); } catch { /* ref inválida: se ignora */ }
      }
      const res = await imageCacheService.sweepOrphans(localId, keys, { catalogComplete });
      return { ok: true, ...res };
    } catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  });
}
const BACKEND_PORT = 3001;

// Node GENERAL — para uso futuro (no AFIP)
function getNodeBin() {
  if (!app.isPackaged) return 'node';
  const userDataNode = path.join(app.getPath('userData'), 'node', 'node.exe');
  if (existsSync(userDataNode)) return userDataNode;
  const resourcesNode = path.join(process.resourcesPath, 'node', 'node.exe');
  if (existsSync(resourcesNode)) return resourcesNode;
  return null;
}

// Node 16 EXCLUSIVO para AFIP — usa OpenSSL 1.1.1 que acepta DH keys legacy
// 1. resources/node-afip/node.exe  → bundleado en instalador
// 2. userData/node-afip/node.exe   → deps pack manual (fallback)
function getNodeAfipBin() {
  if (!app.isPackaged) return 'node';
  const resourcesAfip = path.join(process.resourcesPath, 'node-afip', 'node.exe');
  if (existsSync(resourcesAfip)) return resourcesAfip;
  const userDataAfip = path.join(app.getPath('userData'), 'node-afip', 'node.exe');
  if (existsSync(userDataAfip)) return userDataAfip;
  return null;
}

let mainWindow = null;
let backendProcess   = null;
let backendStatus    = 'stopped';
let backendLastError = null;   // último error de stderr del backend
let backendLastLog   = null;   // última línea de stdout del backend
let backendStartedAt = null;   // timestamp del último startBackend()
let backendCrashFast = false;  // crasheó en < 6s (indica error de config)
let backendAutoRetried = false; // para hacer solo un retry automático

// ---------------------------------------------------------------------------
// Machine ID — identificador único por PC (persistente en userData)
// ---------------------------------------------------------------------------
let MACHINE_ID = null;

function initMachineId() {
  const machineIdPath = path.join(app.getPath('userData'), 'machine-id.json');
  try {
    if (existsSync(machineIdPath)) {
      const data = JSON.parse(readFileSync(machineIdPath, 'utf-8'));
      if (data.machineId) { MACHINE_ID = data.machineId; return; }
    }
    MACHINE_ID = randomUUID();
    writeFileSync(
      machineIdPath,
      JSON.stringify({ machineId: MACHINE_ID, hostname: os.hostname(), createdAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (e) {
    MACHINE_ID = `fallback-${Date.now()}`;
    console.warn('[machine-id] Error:', e.message);
  }
  console.log('[machine-id]', MACHINE_ID, '— hostname:', os.hostname());
}

// ---------------------------------------------------------------------------
// Facturación AFIP — plantillas bundleadas + procesos gestionados
// ---------------------------------------------------------------------------

// COMPARTIDO por PC: aloja node_modules + package.json del motor y la subcarpeta locales/.
const FACTURACION_USER_DIR = () => path.join(app.getPath('userData'), 'facturacion');

// --- Local activo (facturación/config por local) --------------------------------
const ACTIVE_LOCAL_FILE = () => path.join(app.getPath('userData'), 'active-local.json');
let activeLocalId = null;

function getActiveLocalId() {
  if (activeLocalId) return activeLocalId;
  try {
    const j = JSON.parse(readFileSync(ACTIVE_LOCAL_FILE(), 'utf-8'));
    if (j && j.localId) activeLocalId = String(j.localId);
  } catch { /* todavía no hay marca */ }
  return activeLocalId;
}

function setActiveLocalId(localId) {
  activeLocalId = localId ? String(localId) : null;
  try {
    writeFileSync(
      ACTIVE_LOCAL_FILE(),
      JSON.stringify({ localId: activeLocalId, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.error('[LOCAL] no se pudo persistir active-local.json:', e.message);
  }
}

// Carpeta de facturación POR LOCAL. Queda BAJO FACTURACION_USER_DIR para que el motor
// (index.mjs, ESM: import 'firebase-admin') resuelva el node_modules compartido por
// árbol de directorios (userData/facturacion/node_modules).
function getLocaleFacturacionDir(localId = getActiveLocalId()) {
  return path.join(FACTURACION_USER_DIR(), 'locales', String(localId || '_sin_local'));
}

function getFacturacionConfigPath(localId = getActiveLocalId()) {
  return path.join(getLocaleFacturacionDir(localId), 'facturacion-config.json');
}

// --- Mercado Pago / backend de cobro POR LOCAL (Fase 2) -------------------------
// Viven en la misma carpeta por local que la facturación.
function getBackendEnvPath(localId = getActiveLocalId()) {
  return path.join(getLocaleFacturacionDir(localId), 'backend.env');
}
function getMpAccountsPath(localId = getActiveLocalId()) {
  return path.join(getLocaleFacturacionDir(localId), 'mp-accounts.json');
}
function getMpServiceAccountPath(localId = getActiveLocalId()) {
  return path.join(getLocaleFacturacionDir(localId), 'serviceAccountKey.json');
}

// Migración AUTOMÁTICA RESPONSABLE del MP global viejo → local activo.
// Coherencia FUERTE: el LOCAL_ID embebido en backend.env / mp-accounts.json global
// debe coincidir con el local activo. Si no coincide o no se puede verificar → no migra.
// No pisa config local existente. No borra lo global. Deja marca. Una sola vez.
function maybeMigrateMpToLocal(localId) {
  if (!localId) return { result: 'no_active_local' };
  const userDataPath = app.getPath('userData');
  const localeDir  = getLocaleFacturacionDir(localId);
  const marker     = path.join(localeDir, '.mp-migrated.json');
  const destEnv    = getBackendEnvPath(localId);
  const destMp     = getMpAccountsPath(localId);
  const destSa     = getMpServiceAccountPath(localId);
  const globalEnv  = path.join(userDataPath, 'backend.env');
  const globalMp   = path.join(userDataPath, 'mp-accounts.json');
  const globalSa   = path.join(userDataPath, 'serviceAccountKey.json');

  const writeMarker = (result, reason, filesCopied = []) => {
    try {
      mkdirSync(localeDir, { recursive: true });
      writeFileSync(marker, JSON.stringify({
        date: new Date().toISOString(), localId, result, reason, filesCopied,
      }, null, 2), 'utf-8');
    } catch { /* marca informativa */ }
    console.log(`[MIGRACION MP] local=${localId} result=${result} reason=${reason || ''}`);
  };

  // 6) No pisar config MP local existente
  if (existsSync(destEnv) || existsSync(destMp)) { return { result: 'already_exists' }; }
  // 1) Una sola vez
  if (existsSync(marker)) return { result: 'already_attempted' };
  // Nada global que migrar
  if (!existsSync(globalEnv) && !existsSync(globalMp)) { writeMarker('skipped', 'no hay MP global'); return { result: 'no_global' }; }

  // 3) Verificar coherencia por LOCAL_ID embebido
  let globalLocalId = null;
  try { if (existsSync(globalEnv)) globalLocalId = parseEnvFile(globalEnv).LOCAL_ID || null; } catch {}
  if (!globalLocalId) {
    try {
      if (existsSync(globalMp)) {
        const arr = JSON.parse(readFileSync(globalMp, 'utf-8'));
        globalLocalId = (Array.isArray(arr) ? (arr.find(a => a.activo) || arr[0]) : null)?.localId || null;
      }
    } catch {}
  }
  if (!globalLocalId) { writeMarker('skipped', 'MP global sin LOCAL_ID para verificar'); return { result: 'mismatch' }; }
  if (String(globalLocalId) !== String(localId)) {
    writeMarker('mismatch', `MP global pertenece a ${globalLocalId}, no a ${localId}`);
    return { result: 'mismatch' };
  }

  // 4) Coincidencia clara → migrar
  try {
    mkdirSync(localeDir, { recursive: true });
    const copied = [];
    if (existsSync(globalEnv)) { copyFileSync(globalEnv, destEnv); copied.push('backend.env'); }
    if (existsSync(globalMp))  { copyFileSync(globalMp,  destMp);  copied.push('mp-accounts.json'); }
    if (existsSync(globalSa))  { copyFileSync(globalSa,  destSa);  copied.push('serviceAccountKey.json'); }
    writeMarker('migrated', `LOCAL_ID coincide (${localId})`, copied); // 7) no borra lo global
    return { result: 'migrated', filesCopied: copied };
  } catch (e) {
    console.error('[MIGRACION MP] error:', e.message);
    return { result: 'error', error: e.message };
  }
}

/**
 * De dónde salen el motor y sus módulos compartidos.
 *
 * Un candidato sirve solo si está COMPLETO: los dos motores Y los módulos
 * compartidos. Antes alcanzaba con que existiera `responsable-inscripto/index.mjs`,
 * así que un runtime viejo sin `lib/` se daba por bueno y las cuentas quedaban
 * sin `claimPedido.mjs` — exactamente el error de la 1.3.85. La ruta elegida se
 * logea siempre: sin eso no había forma de saber de dónde salió el index.
 */
const MODULOS_COMPARTIDOS_MOTOR = ['claimPedido.mjs'];

function getTemplatesDir() {
  const candidatos = isDev
    ? [path.join(__dirname, '..', 'resources', 'facturacion')]
    : [
      path.join(process.resourcesPath, 'facturacion'),
      path.join(app.getPath('userData'), 'facturacion-runtime'),
    ];

  const completo = (dir) => (
    existsSync(path.join(dir, 'responsable-inscripto', 'index.mjs')) &&
    existsSync(path.join(dir, 'monotributo', 'index.mjs')) &&
    MODULOS_COMPARTIDOS_MOTOR.every((n) => existsSync(path.join(dir, 'lib', n)))
  );

  for (const dir of candidatos) {
    if (completo(dir)) {
      console.log(`[AFIP TEMPLATES] fuente completa: ${dir}`);
      return dir;
    }
    if (existsSync(dir)) {
      console.warn(`[AFIP TEMPLATES] descartada por incompleta (le falta el motor o lib/): ${dir}`);
    }
  }

  // Ninguno completo: se devuelve el primero que exista para que el error diga
  // exactamente qué falta y de dónde, en vez de fallar en un lugar cualquiera.
  const fallback = candidatos.find((d) => existsSync(d)) || candidatos[0];
  console.error(`❌ [AFIP TEMPLATES] ninguna fuente está completa. Se reporta contra: ${fallback}`);
  return fallback;
}

function getOpensslDir() {
  if (isDev) return path.join(__dirname, '..', 'resources', 'openssl');
  const resourcesOpenssl = path.join(process.resourcesPath, 'openssl');
  if (existsSync(path.join(resourcesOpenssl, 'openssl.exe'))) return resourcesOpenssl;
  const userDataOpenssl = path.join(app.getPath('userData'), 'tools', 'openssl');
  if (existsSync(path.join(userDataOpenssl, 'openssl.exe'))) return userDataOpenssl;
  return null;
}

function getRIDir(localId = getActiveLocalId()) {
  return path.join(getLocaleFacturacionDir(localId), 'ri');
}

function getMonoDir(cuentaId, localId = getActiveLocalId()) {
  return path.join(getLocaleFacturacionDir(localId), 'mono', cuentaId);
}

// Refresca SOLO el motor de facturación (index.mjs) de una cuenta ya configurada
// desde el template empaquetado en la app. NUNCA toca .env, certificados,
// serviceAccount ni configuración del local. Sirve para que las correcciones del
// motor (p. ej. el armado del QR ARCA) lleguen a instalaciones existentes al actualizar.
// (declarado más arriba, antes de getTemplatesDir, que también lo consulta)
// Módulos compartidos que el motor importa con ruta relativa PROPIA
// (`./claimPedido.mjs`). Van copiados AL LADO del index.mjs de cada cuenta.
//
// Por qué al lado y no una sola copia en FACTURACION_USER_DIR(): las cuentas
// cuelgan a PROFUNDIDADES distintas —`locales/{id}/ri/` y
// `locales/{id}/mono/{cuentaId}/`—, así que una copia compartida obligaría a dos
// rutas relativas distintas según el tipo de cuenta, que es justo lo contrario a
// un import estable. (Con `node_modules` no pasa porque Node lo busca subiendo
// solo; para un archivo suelto ese mecanismo no existe.) Copiarlo junto al motor
// da el MISMO import en los dos, y se actualiza en cada sync igual que index.mjs.
// (la constante se declara junto a getTemplatesDir, que también la consulta)

/**
 * Copia un archivo de forma segura: primero a un temporal en el MISMO directorio
 * y recién después el rename, que en el mismo volumen es atómico. Así el motor
 * nunca ve un archivo a medio escribir si el proceso muere en el medio.
 */
function copiarAtomico(src, dest) {
  const tmp = `${dest}.tmp-${process.pid}`;
  copyFileSync(src, tmp);
  try {
    renameSync(tmp, dest);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ya no está */ }
    throw e;
  }
}

/**
 * Deja el motor de una cuenta al día: `index.mjs` + los módulos compartidos que
 * importa.
 *
 * @returns {{ ok: boolean, faltantes: string[], error?: string }}
 *   ok:false → el runtime quedó INCOMPLETO y NO hay que arrancar el motor. Una
 *   PC facturando con media copia del motor es peor que una PC que no factura.
 */
/**
 * Deja el motor de una cuenta al día: `index.mjs` + los módulos compartidos que
 * importa, y VERIFICA que los destinos existan de verdad.
 *
 * Lo que salió mal en la 1.3.85 y esto corrige:
 *
 *  1. Se copiaba `index.mjs` PRIMERO y recién después se miraba si existía el
 *     módulo compartido. Si no existía, la cuenta quedaba con el index NUEVO
 *     —que importa './claimPedido.mjs'— y sin el módulo: rota. Ahora se
 *     resuelven y verifican TODAS las fuentes antes de tocar un solo archivo.
 *  2. No se comprobaba el DESTINO. Ahora, después de copiar, se verifica que
 *     los archivos estén físicamente ahí.
 *  3. La fuente elegida no quedaba registrada, así que era imposible saber de
 *     dónde había salido el index. Ahora se logea la ruta real.
 *
 * @returns {{ ok: boolean, faltantes: string[], fuente?: string, destinos?: string[] }}
 */
function syncFacturacionEngine(accountDir, tipo) {
  try {
    if (!existsSync(accountDir)) {
      return { ok: false, faltantes: ['(el directorio de la cuenta no existe)'] };
    }

    const templatesDir = getTemplatesDir();
    const subdir = tipo === 'responsable_inscripto' ? 'responsable-inscripto' : 'monotributo';

    // 1. RESOLVER todas las fuentes y verificarlas ANTES de copiar nada.
    const fuentes = [
      { nombre: 'index.mjs', src: path.join(templatesDir, subdir, 'index.mjs'), dest: path.join(accountDir, 'index.mjs') },
      ...MODULOS_COMPARTIDOS_MOTOR.map((n) => ({
        nombre: `lib/${n}`, src: path.join(templatesDir, 'lib', n), dest: path.join(accountDir, n),
      })),
    ];

    const faltanFuentes = fuentes.filter((f) => !existsSync(f.src));
    if (faltanFuentes.length > 0) {
      console.error(
        `❌ Runtime fiscal incompleto EN LA FUENTE.\n` +
        `   Fuente: ${templatesDir}\n` +
        faltanFuentes.map((f) => `   Falta: ${f.src}`).join('\n') +
        `\n   Motor NO iniciado. No se toca la cuenta ${accountDir} para no dejarla a medias.`
      );
      return { ok: false, faltantes: faltanFuentes.map((f) => f.nombre), fuente: templatesDir };
    }

    // 2. COPIAR (atómico: temporal + rename en el mismo directorio).
    for (const f of fuentes) copiarAtomico(f.src, f.dest);

    // 3. VERIFICAR EL DESTINO. Copiar sin comprobar fue justamente el agujero.
    const faltanDestinos = fuentes.filter((f) => !existsSync(f.dest));
    if (faltanDestinos.length > 0) {
      console.error(
        `❌ Runtime fiscal incompleto EN EL DESTINO.\n` +
        faltanDestinos.map((f) => `   Falta: ${f.dest}`).join('\n') +
        `\n   Motor NO iniciado.`
      );
      return { ok: false, faltantes: faltanDestinos.map((f) => f.nombre), fuente: templatesDir };
    }

    console.log(`[AFIP ENGINE SYNC] ${accountDir}\n   fuente: ${templatesDir}\n   copiados: ${fuentes.map((f) => f.nombre).join(', ')}`);
    return { ok: true, faltantes: [], fuente: templatesDir, destinos: fuentes.map((f) => f.dest) };
  } catch (e) {
    console.error(`❌ [AFIP ENGINE SYNC] error sincronizando ${accountDir}: ${e.message}. Motor NO iniciado.`);
    return { ok: false, faltantes: [`(error: ${e.message})`] };
  }
}

// Ensure shared package.json for node_modules in the parent dir
function ensureSharedPkg() {
  const dir = FACTURACION_USER_DIR();
  mkdirSync(dir, { recursive: true });
  const destPkg = path.join(dir, 'package.json');
  const srcPkg  = path.join(getTemplatesDir(), 'package.json');
  if (!existsSync(destPkg) && existsSync(srcPkg)) {
    copyFileSync(srcPkg, destPkg);
  }
}

// Genera el contenido de un .env a partir de un objeto
function buildEnvContent(envData) {
  return Object.entries(envData)
    .map(([k, v]) => `${k}=${v || ''}`)
    .join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Proceso manager
// ---------------------------------------------------------------------------
const facturacionProcs = {};

function spawnFacturacionProc(key, accountDir) {
  stopFacturacionProc(key);

  const entry = { proc: null, logs: facturacionProcs[key]?.logs || [], status: 'running', accountDir };
  facturacionProcs[key] = entry;

  // ── node_modules compartido, ANTES que nada ─────────────────────────────
  //
  // Los motores son ESM (`import 'dotenv'`, firebase-admin, moment, pdfkit,
  // qrcode, soap) y Node busca node_modules SUBIENDO el árbol desde
  // accountDir — pero facturacion-runtime/node_modules es HERMANO de
  // facturacion/, nunca ancestro, así que nunca aparece solo. Confirmado en
  // Lepo Lepo y Joao. Idempotente: no hace nada si ya está bien.
  const link = ensureFacturacionNodeModulesLink({
    facturacionDir: FACTURACION_USER_DIR(),
    runtimeModulesDir: path.join(app.getPath('userData'), 'facturacion-runtime', 'node_modules'),
  });
  if (!link.ok) {
    entry.status = 'error';
    const detalle = link.accion === 'sin-runtime'
      ? 'Módulos AFIP no encontrados. Instalá los componentes desde Configuración → Sistema.'
      : `No se pudo preparar node_modules compartido: ${link.error || link.motivo}.`;
    entry.logs.push(`[${new Date().toLocaleTimeString('es-AR')}] [ERR] ${detalle}`);
    console.error(`❌ [facturacion] '${key}': ${detalle}`);
    mainWindow?.webContents?.send('facturacion:status', { key, status: 'error' });
    return false;
  }

  // ── GUARD ÚNICO, ANTES DE CUALQUIER spawn ────────────────────────────────
  //
  // Acá pasan TODOS los caminos que arrancan un motor: el autostart del proceso
  // principal, `facturacion:start` y `facturacion:restart` desde la pantalla de
  // Configuración. En la 1.3.85 el guard estaba sólo en el autostart, así que
  // los dos IPC arrancaban el motor sin sincronizar y sin verificar nada: por
  // ahí salió el ERR_MODULE_NOT_FOUND en bucle.
  //
  // Ponerlo dentro de spawn hace imposible saltearlo, y de paso REPARA la cuenta
  // en cada arranque: una cuenta vieja a la que le falte el módulo compartido
  // queda completa sin recrearla ni entrar a Configuración.
  const tipo = key === 'ri' ? 'responsable_inscripto' : 'monotributo';
  const sync = syncFacturacionEngine(accountDir, tipo);
  if (!sync.ok) {
    entry.status = 'error';
    const detalle = `Runtime fiscal incompleto. Falta: ${sync.faltantes.join(', ')}. Motor NO iniciado.`;
    entry.logs.push(`[${new Date().toLocaleTimeString('es-AR')}] [ERR] ${detalle}`);
    console.error(`❌ [facturacion] '${key}': ${detalle}`);
    mainWindow?.webContents?.send('facturacion:status', { key, status: 'error' });
    return false;
  }

  let proc;
  try {
    const nodeBin = getNodeAfipBin();
    if (!nodeBin) {
      entry.status = 'error';
      entry.logs.push(`[${new Date().toLocaleTimeString('es-AR')}] [ERR] Node AFIP no encontrado. Instalá los componentes desde Configuración → Sistema.`);
      mainWindow?.webContents?.send('facturacion:status', { key, status: 'error' });
      return false;
    }
    console.log(`[AFIP NODE] Usando: ${nodeBin}`);

    const opensslDir = getOpensslDir();
    const procEnv = { ...process.env };
    if (opensslDir) {
      procEnv.OPENSSL_BIN  = path.join(opensslDir, 'openssl.exe');
      procEnv.OPENSSL_CONF = path.join(opensslDir, 'openssl.cnf');
      procEnv.PATH         = opensslDir + ';' + (procEnv.PATH || '');

      // VCRUNTIME140.dll: si el OpenSSL bundled no puede arrancar (PC nueva
      // sin el runtime de Visual C++), se repara ACÁ mismo, antes de arrancar
      // el motor — no se descarga nada, usa el redistribuible oficial ya
      // incluido con la app. El motivo real queda en los logs de la cuenta
      // (visibles en el panel de Facturación) tanto si se resuelve solo como
      // si sigue fallando. Ver electron/lib/vcRedist.js.
      const vc = asegurarVcRedistSiHaceFalta({
        opensslExePath: procEnv.OPENSSL_BIN,
        vcRedistExePath: vcRedistResourcePath(),
        log: (msg) => entry.logs.push(`[${new Date().toLocaleTimeString('es-AR')}] [OpenSSL] ${msg}`),
      });
      if (!vc.ok) {
        console.error(`[AFIP OPENSSL] '${key}': OpenSSL no pudo arrancar: ${vc.motivo}`);
      }
    }

    proc = spawn(nodeBin, ['index.mjs'], {
      cwd: accountDir,
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      env: procEnv,
    });
  } catch (err) {
    entry.status = 'error';
    entry.logs.push(`[${new Date().toLocaleTimeString('es-AR')}] [ERR] No pudo iniciar: ${err.message}`);
    mainWindow?.webContents?.send('facturacion:status', { key, status: 'error' });
    return false;
  }

  entry.proc = proc;
  // Notificar al UI que el proceso ya está corriendo
  mainWindow?.webContents?.send('facturacion:status', { key, status: 'running' });

  const appendLog = (data, prefix = '') => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    const stamped = lines.map(l => `[${new Date().toLocaleTimeString('es-AR')}] ${prefix}${l}`);
    entry.logs.push(...stamped);
    if (entry.logs.length > 300) entry.logs = entry.logs.slice(-300);
    mainWindow?.webContents?.send('facturacion:log', { key, lines: stamped });
  };

  proc.stdout?.on('data', data => appendLog(data));
  proc.stderr?.on('data', data => appendLog(data, '[ERR] '));
  proc.on('exit', (code, signal) => {
    entry.status = (signal === 'SIGTERM' || signal === 'SIGKILL' || code === 0) ? 'stopped' : 'error';
    entry.proc = null;
    mainWindow?.webContents?.send('facturacion:status', { key, status: entry.status });
  });
  proc.on('error', (err) => {
    entry.status = 'error';
    entry.proc = null;
    appendLog(Buffer.from(`Error al iniciar proceso: ${err.message}`), '[ERR] ');
    mainWindow?.webContents?.send('facturacion:status', { key, status: 'error' });
  });

  console.log(`[facturacion] '${key}' iniciado desde: ${accountDir}`);
  return true;
}

function stopFacturacionProc(key) {
  const entry = facturacionProcs[key];
  if (!entry?.proc) return false;
  try { entry.proc.kill(); } catch {}
  entry.proc = null;
  entry.status = 'stopped';
  console.log(`[facturacion] '${key}' detenido`);
  return true;
}

function stopAllFacturacion() {
  Object.keys(facturacionProcs).forEach(stopFacturacionProc);
}

/**
 * Detiene ÚNICAMENTE los motores fiscales de UN local — nunca los de otros
 * locales que esta misma PC pudiera tener corriendo. Hace falta desde que el
 * host fiscal es por local: perder (o soltar) el host de un local no puede
 * tocar los motores de otro que esta PC siga hosteando.
 *
 * El criterio es el mismo `accountDir` que ya guarda cada entrada de
 * `facturacionProcs`: pertenece al local si cae bajo
 * `getLocaleFacturacionDir(localId)`.
 */
function stopFacturacionDeLocal(localId) {
  const prefijo = getLocaleFacturacionDir(localId) + path.sep;
  const keys = Object.keys(facturacionProcs).filter((key) => {
    const dir = facturacionProcs[key]?.accountDir;
    return dir && (dir + path.sep).startsWith(prefijo);
  });
  keys.forEach(stopFacturacionProc);
  return keys;
}

// ---------------------------------------------------------------------------
// HOST FISCAL ÚNICO POR LOCAL
//
// Máximo una PC por local corre node-afip; mínimo una, mientras haya al
// menos una PC elegible viva. La decisión (quién gana, cuándo vence, quién
// puede tomarlo) es el módulo puro `./lib/facturacionHost.js`; acá sólo vive
// el I/O: la app de Firebase por base de datos, el reloj corregido por
// offset de servidor, el ciclo que reintenta/renueva, y el listener de
// traslado. Ver el plan aprobado para el diseño completo.
// ---------------------------------------------------------------------------

/** Una sola instancia de Database por databaseURL, reutilizada entre locales. */
const firebaseDbPorURL = new Map();
/** Offset de reloj sv-cliente por databaseURL, actualizado en vivo. */
const offsetServidorPorURL = new Map();

function dbFiscalDe(databaseURL) {
  if (firebaseDbPorURL.has(databaseURL)) return firebaseDbPorURL.get(databaseURL);
  const nombre = `host-fiscal-${firebaseDbPorURL.size}`;
  const firebaseApp = initializeFirebaseApp({ databaseURL }, nombre);
  const db = getFirebaseDatabase(firebaseApp);
  firebaseDbPorURL.set(databaseURL, db);
  offsetServidorPorURL.set(databaseURL, 0);
  // `.info/serverTimeOffset`: referencia de tiempo compartida entre PCs, para
  // que la comparación de `leaseUntil` no dependa del reloj de Windows de
  // cada una. No hay forma de leer `ServerValue.TIMESTAMP` dentro de un
  // reductor de transacción antes de confirmar, así que se usa esto en su
  // lugar — mismo patrón que `claimPedido.mjs` (`ahora` como parámetro
  // calculado ANTES de entrar a la transacción).
  onFirebaseValue(firebaseRef(db, '.info/serverTimeOffset'), (snap) => {
    offsetServidorPorURL.set(databaseURL, Number(snap.val()) || 0);
  });
  return db;
}

/** Reloj corregido: Date.now() + offset de servidor de ESA base. */
function ahoraServidor(databaseURL) {
  return Date.now() + (offsetServidorPorURL.get(databaseURL) || 0);
}

/** FIREBASE_DB de la primera cuenta candidata que lo tenga (todas comparten proyecto). */
function databaseURLDeAccountDir(dir) {
  try {
    const env = parseEnvFile(path.join(dir, '.env'));
    return env.FIREBASE_DB || null;
  } catch {
    return null;
  }
}

/** El `localId` al que pertenece un `accountDir` (`.../locales/{localId}/ri|mono/{cuentaId}`). */
function localIdDeAccountDir(accountDir) {
  const base = path.join(FACTURACION_USER_DIR(), 'locales') + path.sep;
  if (!accountDir || !accountDir.startsWith(base)) return null;
  const resto = accountDir.slice(base.length);
  return resto.split(path.sep)[0] || null;
}

/**
 * Estado de host fiscal, sólo para los locales que ESTA PC llegó a ganar
 * alguna vez en esta sesión: `{ activo: boolean, databaseURL: string }`.
 * `activo` es la fuente de verdad LOCAL de "soy yo el que factura este local
 * ahora mismo" — se pone en `true` sólo tras una transacción ganadora, y en
 * `false` apenas se pierde, se suelta, o se traslada.
 */
const hostFiscalPorLocal = {};
/** Función para desarmar el listener de FACTURACION_HOST_TRANSFER, por local. */
const transferOff = {};
/** localIds con una transacción de host en vuelo — evita ticks superpuestos. */
const hostEnCurso = new Set();

/**
 * Suelta el host de un local (cierre normal, o para cederlo en un traslado).
 * Usa `reductorDeLiberacion`: sólo libera si ESTA PC sigue siendo la dueña —
 * si para ese momento ya no lo es (el lease venció y otra PC lo tomó),
 * aborta sola sin tocar nada ajeno. Nunca lanza.
 */
async function liberarHostDelLocal(localId, databaseURL) {
  try {
    const db = dbFiscalDe(databaseURL);
    const hostRef = firebaseRef(db, `${localId}/FACTURACION_HOST`);
    const r = await runFirebaseTransaction(hostRef, reductorDeLiberacion({ machineId: MACHINE_ID }));
    return r.committed;
  } catch (e) {
    console.error(`[Facturación] ${localId}: no se pudo liberar el host: ${e.message}`);
    return false;
  } finally {
    if (hostFiscalPorLocal[localId]) hostFiscalPorLocal[localId].activo = false;
    desarmarListenerDeTransferencia(localId);
  }
}

/**
 * Handoff seguro ("Tomar control fiscal"): se arma SOLO mientras esta PC es
 * dueña vigente de ese local, se desarma apenas deja de serlo. Al ver una
 * solicitud: detiene los motores del local, suelta el host (verificando que
 * siga siendo mío), y limpia la solicitud. Nunca le "avisa" nada especial al
 * solicitante — el solicitante gana solo, por la vía normal, en cuanto el
 * nodo queda libre.
 *
 * TAMBIÉN mantiene caliente el cache local del SDK cliente sobre
 * `FACTURACION_HOST` con un segundo listener. Es necesario: `runTransaction`
 * del SDK cliente decide su PRIMER pase con lo que ya haya en el cache local
 * (`syncTreeCalcCompleteEventCache`, ver node_modules/@firebase/database) —
 * si no hay ningún listener activo sobre ese path, ese primer pase ve
 * `null`. Como `reductorDeLiberacion` responde a `null` con `undefined`
 * ("nada mío que soltar"), y el SDK trata un `undefined` en el PRIMER pase
 * como un abort DEFINITIVO (nunca consulta al servidor para confirmar), una
 * liberación legítima de esta misma PC podía abortar en falso contra un
 * cache frío — verificado de forma aislada contra el emulador real. Esto NO
 * afecta a `reductorDeHost`: su respuesta al mismo cache vacío siempre es un
 * valor real (nunca `undefined`), así que el SDK sí reintenta contra el
 * servidor en ese caso — motivo por el que la adquisición nunca necesitó
 * este calentamiento.
 *
 * Devuelve una promesa que resuelve en cuanto el cache ya tiene un valor
 * real (o de inmediato si ya estaba armado) — los llamadores la esperan
 * antes de dar por buena la adquisición, así una liberación posterior de
 * ESTE mismo local (cierre normal o traslado) funciona a la primera.
 */
function armarListenerDeTransferencia(localId, databaseURL) {
  if (transferOff[localId]) return Promise.resolve(); // ya armado
  const db = dbFiscalDe(databaseURL);
  const transferRef = firebaseRef(db, `${localId}/FACTURACION_HOST_TRANSFER`);
  const hostRef = firebaseRef(db, `${localId}/FACTURACION_HOST`);

  const cancelarTransfer = onFirebaseValue(transferRef, async (snap) => {
    const solicitud = snap.val();
    if (!solicitud || !hostFiscalPorLocal[localId]?.activo) return;
    console.log(
      `[Facturación] ${localId}: solicitud de traslado de ` +
      `${solicitud.solicitanteHostname || solicitud.solicitanteMachineId}. Deteniendo motores y liberando...`
    );
    stopFacturacionDeLocal(localId);
    await liberarHostDelLocal(localId, databaseURL);
    try { await setFirebaseValue(transferRef, null); } catch { /* best-effort */ }
  });

  return new Promise((resolve) => {
    let resuelto = false;
    const cancelarCache = onFirebaseValue(hostRef, () => {
      if (!resuelto) { resuelto = true; resolve(); }
    });
    transferOff[localId] = () => { cancelarTransfer(); cancelarCache(); };
  });
}

function desarmarListenerDeTransferencia(localId) {
  const cancelar = transferOff[localId];
  if (cancelar) {
    try { cancelar(); } catch { /* best-effort */ }
    delete transferOff[localId];
  }
}

// Registra un fallo de la verificación remota de ownership con el código de
// causa clasificado (URL_INVALIDA / PROTOCOLO_NO_SOPORTADO / ERROR_DE_RED /
// PERMISSION_DENIED) — nunca un genérico "sin conexión" que hubiera ocultado
// el bug real de Canadá (esquema HTTPS:// en mayúsculas). No incluye tokens,
// claves ni credenciales — solo identificadores públicos de la cuenta.
function logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code, message }) {
  console.error('[Facturación AutoStart] Error consultando ownership', {
    localId: getActiveLocalId(),
    firebaseDb,
    cuit,
    ptoVta,
    code,
    message,
  });
}

// Lee el "dueño de facturación" desde el RTDB propio de la cuenta (mismo Firebase
// que usa el motor, path FACTURACION_OWNERS/{cuit}_{ptoVta}). NUNCA asume ownership
// en caso de error/timeout — devuelve { ok:false } y el caller debe tratarlo como
// "no confirmado" (no arrancar). Esto evita que dos PCs se crean dueñas por estar
// sin conexión (regla de seguridad explícita del usuario).
//
// El transporte (http vs https) se resuelve con resolveRequestTransport(), que
// parsea la URL con el parser estándar de Node (new URL) en vez de comparar
// texto — un firebaseDb guardado como "HTTPS://..." (mayúsculas) ya no elige
// el módulo equivocado ni tira ERR_INVALID_PROTOCOL.
// El proceso principal no tiene acceso al localStorage del renderer, así que el
// número de local se deriva del FIREBASE_PATH de la cuenta (cuya convención es
// `{localId}/FACTURACION_1`): el PRIMER segmento ES el local. Si no se puede
// derivar un id válido, no se construye ninguna ruta — falla segura.
function localIdDesdeFirebasePath(firebasePath) {
  const limpio = String(firebasePath ?? '').trim().replace(/^\/+/, '');
  if (!limpio) return null;
  const seg = limpio.split('/')[0];
  if (!seg) return null;
  const invalidos = new Set(['undefined', 'null', 'nan', 'default', 'none', '0']);
  if (invalidos.has(seg.toLowerCase())) return null;
  if (/[.#$[\]\s]/.test(seg)) return null;
  return seg;
}

// Lee el dueño en `{localId}/FACTURACION_OWNERS/{key}` y, SOLO si ahí no hay
// nada, cae temporalmente al nodo global viejo `/FACTURACION_OWNERS/{key}`
// (compatibilidad hacia atrás; nunca se escribe ahí).
function leerOwnerEn(url, { firebaseDb, cuit, ptoVta }) {
  return new Promise((resolve) => {
    let transport;
    try {
      transport = resolveRequestTransport(url);
    } catch (e) {
      const code = e.code || 'URL_INVALIDA';
      logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code, message: e.message });
      resolve({ ok: false, owner: null, code });
      return;
    }

    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };
    try {
      const req = transport.module.get(
        transport.url,
        { headers: { 'User-Agent': 'recepcion-de-pedidos-desktop' }, timeout: 6000 },
        (res) => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code: 'PERMISSION_DENIED', message: `HTTP ${res.statusCode}` });
            done({ ok: false, owner: null, code: 'PERMISSION_DENIED' });
            return;
          }
          if (res.statusCode !== 200) {
            logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code: 'ERROR_DE_RED', message: `HTTP ${res.statusCode}` });
            done({ ok: false, owner: null, code: 'ERROR_DE_RED' });
            return;
          }
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try {
              const parsed = data ? JSON.parse(data) : null;
              done({ ok: true, owner: parsed || null });
            } catch (e) {
              logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code: 'ERROR_DE_RED', message: `respuesta inválida: ${e.message}` });
              done({ ok: false, owner: null, code: 'ERROR_DE_RED' });
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code: 'ERROR_DE_RED', message: 'timeout' });
        done({ ok: false, owner: null, code: 'ERROR_DE_RED' });
      });
      req.on('error', (e) => {
        logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code: 'ERROR_DE_RED', message: e.message });
        done({ ok: false, owner: null, code: 'ERROR_DE_RED' });
      });
    } catch (e) {
      const code = classifyTransportError(e);
      logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code, message: e.message });
      done({ ok: false, owner: null, code });
    }
  });
}

async function fetchFacturacionOwnerRemote(firebaseDb, cuit, ptoVta, localId) {
  if (!firebaseDb || !cuit || !ptoVta) {
    return { ok: false, owner: null, code: 'URL_INVALIDA' };
  }
  if (!localId) {
    logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code: 'LOCAL_ID_REQUIRED', message: 'no se pudo derivar el local desde FIREBASE_PATH' });
    return { ok: false, owner: null, code: 'LOCAL_ID_REQUIRED' };
  }
  const sanitize = (v) => String(v ?? '').trim().replace(/[.#$[\]/\s]/g, '');
  const key = `${sanitize(cuit)}_${sanitize(ptoVta)}`;

  let base;
  try {
    base = normalizeFirebaseDatabaseURL(firebaseDb);
  } catch (e) {
    const code = e.code || 'URL_INVALIDA';
    logOwnershipCheckFailure({ firebaseDb, cuit, ptoVta, code, message: e.message });
    return { ok: false, owner: null, code };
  }

  const ctx = { firebaseDb, cuit, ptoVta };
  const nuevo = await leerOwnerEn(`${base}/${localId}/FACTURACION_OWNERS/${key}.json`, ctx);
  if (!nuevo.ok) return nuevo;      // error real: NUNCA se asume ownership
  if (nuevo.owner) return nuevo;    // ruta nueva = fuente de verdad

  // Fallback TEMPORAL de solo lectura sobre el nodo global deprecado.
  const legado = await leerOwnerEn(`${base}/FACTURACION_OWNERS/${key}.json`, ctx);
  if (legado.ok && legado.owner) {
    console.log('[Facturación AutoStart] Dueño leído del nodo global antiguo (pendiente de migración a /{localId}/FACTURACION_OWNERS).');
    return { ok: true, owner: legado.owner };
  }
  return nuevo;
}

// TODA PC FACTURA POR DEFECTO.
//
// Antes esta función exigía `activo === true`, un flag que nacía en `false` y
// que sólo se encendía entrando a Configuración y apretando "Iniciar". Por eso
// una PC recién instalada —o una que nadie tocó nunca— no facturaba aunque
// tuviera todo lo necesario. Ahora la decisión es al revés:
//
//     facturacionAutomatica !== false   →   ARRANCA
//
// Es decir, se arranca salvo que alguien haya APAGADO el switch a propósito en
// ESTA PC. Ese OFF es lo único que frena el motor, vive sólo en el archivo local
// (nunca se sincroniza por Firebase) y se respeta en todos los arranques
// siguientes: no se vuelve a encender solo.
//
// Lo que sí se sigue exigiendo son los REQUISITOS REALES: .env, certificado,
// clave, serviceAccount y motor presentes. Sin eso no se escucha Firebase, no se
// pide CAE y no se emite nada — pero se informa exactamente qué falta y las
// demás cuentas del local siguen su camino.
//
// `initialized` dejó de ser una condición: era otro flag de configuración que en
// las PCs viejas quedaba en false aunque los archivos estuvieran completos. Los
// archivos son la verdad; el flag sólo se informa.
//
// Tampoco se consulta "PC dueña": ese concepto se eliminó. Que dos PCs no
// facturen el mismo pedido lo garantiza el claim atómico POR PEDIDO del motor.
async function evaluateAutoStart(key, dir, fields, label) {
  if (!facturacionHabilitada(fields)) {
    console.log(`[Facturación automática] ${label}: DETENIDA MANUALMENTE en esta PC (switch en OFF). No se inicia el motor.`);
    return { start: false, detenidaManualmente: true };
  }
  if (!fields.initialized) {
    console.log(`[Facturación automática] ${label}: la cuenta figura como no inicializada; se valida por los archivos reales.`);
  }

  const envPath  = path.join(dir, '.env');
  const certPath = path.join(dir, 'cert', 'certificado.crt');
  const keyPath  = path.join(dir, 'cert', 'clave.key');
  const saPath   = path.join(dir, 'serviceAccount.json');
  const enginePath = path.join(dir, 'index.mjs');

  const checks = {
    env:            existsSync(envPath),
    cert:           existsSync(certPath),
    key:            existsSync(keyPath),
    serviceAccount: existsSync(saPath),
    engine:         existsSync(enginePath),
  };

  let envVars = {};
  if (checks.env) {
    try { envVars = parseEnvFile(envPath); } catch { /* se reporta abajo como faltante */ }
  }
  checks.firebaseUrl  = !!envVars.FIREBASE_DB;
  checks.firebasePath = !!envVars.FIREBASE_PATH;

  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length > 0) {
    // No rompe nada ni frena a las demás cuentas: se informa qué falta y esta
    // cola queda sin iniciar. El renderer intentará reconstruirla.
    console.log(`⚠️ [Facturación automática] ${label}: no iniciada, falta configuración fiscal [${missing.join(', ')}].`);
    return { start: false, missing };
  }

  if (facturacionProcs[key]?.status === 'running') {
    console.log(`ℹ️ [Facturación automática] ${label}: ya tiene un proceso activo (key=${key}). No se duplica.`);
    return { start: false, yaCorriendo: true };
  }

  // NO se consulta "PC dueña": ese concepto quedó eliminado a propósito. Antes
  // acá se preguntaba a Firebase quién era el dueño y una PC que no lo fuera no
  // arrancaba nunca — es lo que hacía falta desactivar para que toda PC facture.
  // La protección contra doble emisión ya no vive en "qué PC arranca" sino en el
  // claim atómico por pedido que hace el motor antes de pedir el CAE.
  const localIdCuenta = localIdDesdeFirebasePath(envVars.FIREBASE_PATH);
  console.log(`[Facturación automática] ${label}: habilitada (local=${localIdCuenta || '?'}, machineId=${MACHINE_ID}).`);

  return { start: true };
}

/**
 * Migración de una sola vez a la política 2. La regla vive en
 * `decidirArranqueFacturacion.js` (módulo puro, con pruebas); acá sólo se logea.
 * @returns {boolean} true si hubo cambios para persistir.
 */
function migrarPoliticaAutoStart(config, localId) {
  const { migrado, cuentasTocadas } = migrarPolitica(config);
  if (migrado) {
    console.log(
      `[Facturación automática] Migración a política v${BILLING_AUTOSTART_POLICY_VERSION} (local ${localId}): ` +
      `${cuentasTocadas} cuenta(s) quedan con facturación automática habilitada. ` +
      'Los `activo:false` viejos no se interpretan como una decisión del usuario.'
    );
  }
  return migrado;
}

/** Nombre de la cola de una cuenta, leído de su propio `.env`. */
function colaDeCuenta(dir) {
  try {
    const env = parseEnvFile(path.join(dir, '.env'));
    return colaDesdeFirebasePath(env.FIREBASE_PATH) || '(cola desconocida)';
  } catch {
    return '(cola desconocida)';
  }
}

// ---------------------------------------------------------------------------
// AUTOARRANQUE POR HOST FISCAL — no depende de `active-local.json` ni de qué
// se esté mirando en pantalla. Ver electron/lib/facturacionHost.js para el
// diseño completo y las garantías; acá sólo el I/O que lo pone en marcha.
// ---------------------------------------------------------------------------

/**
 * Locales configurados en ESTA PC (`facturacion/locales/*` con su propio
 * `facturacion-config.json`) — no el local activo de la UI, TODOS los que
 * esta instalación tiene datos para correr. Orden estable (alfabético, el
 * que da `readdirSync`) para que "me quedo con el primero que gana" sea
 * determinista entre ciclos.
 */
function localesConfiguradosEnEstaPC() {
  const base = path.join(FACTURACION_USER_DIR(), 'locales');
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((localId) => existsSync(getFacturacionConfigPath(localId)));
  } catch {
    return [];
  }
}

/** Las cuentas que corresponde arrancar para un local, según su config, con sus `fields` para `evaluateAutoStart`. */
function tuplasDeCuentasDelLocal(config, localId) {
  if (config.tipo === 'responsable_inscripto') {
    const ri = config.ri || {};
    const label = `${ri.nombre || 'Responsable Inscripto'} / CUIT ${ri.cuit || '?'} / Pto. Vta. ${ri.ptoVta || '?'}`;
    return [{ key: 'ri', dir: getRIDir(localId), fields: ri, label }];
  }
  if (config.tipo === 'monotributo') {
    return (config.monotributo?.cuentas || []).map((c) => ({
      key: `mono_${c.id}`,
      dir: getMonoDir(c.id, localId),
      fields: c,
      label: `${c.nombre || 'Monotributo'} / CUIT ${c.cuit || '?'} / Pto. Vta. ${c.ptoVta || '?'}`,
    }));
  }
  return [];
}

/**
 * Evalúa TODAS las cuentas debidas de un local con `evaluateAutoStart` (sin
 * side effects todavía). El local sólo califica como candidato a host si
 * NINGUNA cuenta que corresponde arrancar quedó incompleta — una PC que sólo
 * podría facturar 3 de las 4 cuentas de un local no debe ganar su host. Una
 * cuenta apagada a mano, o ya corriendo, no cuenta en contra.
 */
async function evaluarCuentasDelLocal(config, localId) {
  const tuplas = tuplasDeCuentasDelLocal(config, localId);
  const resultados = [];
  let completo = true;
  for (const t of tuplas) {
    const evaluacion = await evaluateAutoStart(t.key, t.dir, t.fields, t.label);
    resultados.push({ ...t, evaluacion });
    if (evaluacion.missing) completo = false;
  }
  return { completo, resultados };
}

/**
 * La transacción normal de adquisición/renovación — la MISMA que usa el
 * ciclo automático, el botón manual "Iniciar" y la adquisición final de un
 * traslado ("Tomar control fiscal"). Nunca hay una variante que pise un
 * lease vigente ajeno. Puede tirar (Firebase inalcanzable) — lo maneja el
 * llamador.
 */
async function intentarGanarHost(localId, databaseURL) {
  const db = dbFiscalDe(databaseURL);
  const hostRef = firebaseRef(db, `${localId}/FACTURACION_HOST`);
  const ahora = ahoraServidor(databaseURL);
  const reductor = reductorDeHost({
    machineId: MACHINE_ID,
    hostname: os.hostname(),
    ahora,
    appVersion: app.getVersion(),
  });
  const tx = await runFirebaseTransaction(hostRef, reductor);
  const registro = tx.snapshot.val();
  const gane = tx.committed && registro?.machineId === MACHINE_ID;
  return { gane, registro, ahora };
}

/**
 * Gate del arranque MANUAL de una cuenta (botón "Iniciar"/"Reiniciar"): usa
 * la misma transacción normal, así que NUNCA puede pisar un lease vigente
 * ajeno — no existe ningún "Iniciar de todos modos". Si gana, deja
 * `hostFiscalPorLocal` y el listener de traslado armados igual que si
 * hubiera ganado por el ciclo automático, para que el heartbeat de ahí en
 * más lo sostenga solo.
 */
async function intentarAdquirirHostParaAccion(accountDir) {
  const localId = localIdDeAccountDir(accountDir);
  if (!localId) return { ok: false, motivo: 'sin-local' };
  const databaseURL = databaseURLDeAccountDir(accountDir);
  if (!databaseURL) return { ok: false, motivo: 'sin-firebase-db' };

  let resultado;
  try {
    resultado = await intentarGanarHost(localId, databaseURL);
  } catch (e) {
    return { ok: false, motivo: 'firebase-inalcanzable', error: e.message };
  }
  const { gane, registro, ahora } = resultado;

  if (!gane) {
    const leaseRestanteMs = registro ? Math.max(0, (registro.leaseUntil || 0) - ahora) : 0;
    return { ok: false, motivo: 'host-ajeno', hostname: registro?.hostname || registro?.machineId || null, leaseRestanteMs };
  }

  hostFiscalPorLocal[localId] = { activo: true, databaseURL };
  await armarListenerDeTransferencia(localId, databaseURL);
  return { ok: true, localId, databaseURL };
}

/** Arranca las cuentas ya evaluadas como `start:true` (apagadas a mano u ocupadas se saltan). */
function arrancarCuentasEvaluadas(resultados) {
  const iniciadas = [];
  for (const r of resultados) {
    if (!r.evaluacion.start) continue; // apagada a mano, o ya corriendo — nada que hacer
    const ok = spawnFacturacionProc(r.key, r.dir);
    const cola = colaDeCuenta(r.dir);
    console.log(`[Facturación] Listener iniciado: ${cola} — ${r.label} (ok=${ok})`);
    if (ok) iniciadas.push(cola);
  }
  return iniciadas;
}

/**
 * Un ciclo de host fiscal para UN local: evalúa si esta PC puede correrlo
 * completo, y si puede, intenta adquirir (o renovar) `FACTURACION_HOST` con
 * la transacción normal — la MISMA que usan el botón manual "Iniciar" y la
 * adquisición final de un traslado, nunca una variante especial. Devuelve
 * `true` si esta PC quedó siendo la dueña vigente al final del ciclo.
 */
async function procesarLocalParaHostFiscal(localId) {
  if (hostEnCurso.has(localId)) return false; // transacción anterior todavía en vuelo

  const cfgPath = getFacturacionConfigPath(localId);
  if (!existsSync(cfgPath)) return false;
  let config;
  try {
    config = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  } catch (e) {
    console.error(`[Facturación] ${localId}: facturacion-config.json inválido: ${e.message}`);
    return false;
  }

  if (migrarPoliticaAutoStart(config, localId)) {
    try { writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8'); } catch (e) {
      console.error(`[Facturación] ${localId}: no se pudo persistir la política de arranque: ${e.message}`);
    }
  }

  const { completo, resultados } = await evaluarCuentasDelLocal(config, localId);
  if (!completo || resultados.length === 0) {
    // No calificó este ciclo (o no tiene cuentas configuradas): se reintenta
    // solo en el próximo tick, sin tocar nada de lo que ya estuviera corriendo.
    return !!hostFiscalPorLocal[localId]?.activo;
  }

  const databaseURL = databaseURLDeAccountDir(resultados[0].dir);
  if (!databaseURL) {
    console.log(`[Facturación] ${localId}: no se pudo determinar FIREBASE_DB de sus cuentas, se reintenta en el próximo ciclo.`);
    return !!hostFiscalPorLocal[localId]?.activo;
  }

  hostEnCurso.add(localId);
  try {
    let resultado;
    try {
      resultado = await intentarGanarHost(localId, databaseURL);
    } catch (e) {
      // Firebase inalcanzable: NO se toca nada — ni arranca a ciegas, ni frena
      // lo que ya corría (si esta PC ya era dueña, su lease sigue vigente en
      // el servidor hasta que realmente venza; el próximo tick reintenta solo).
      console.error(`[Facturación] ${localId}: la transacción de host falló (¿sin red?): ${e.message}`);
      return !!hostFiscalPorLocal[localId]?.activo;
    }
    const { gane, registro, ahora } = resultado;

    if (!gane) {
      if (hostFiscalPorLocal[localId]?.activo) {
        // Defensivo: esta PC creía ser la dueña y la transacción dice otra
        // cosa (venció y otra PC ganó antes de que renovara). Frenar YA.
        console.log(`[Facturación] ${localId}: se perdió el host frente a otra PC. Deteniendo motores de este local.`);
        stopFacturacionDeLocal(localId);
      }
      hostFiscalPorLocal[localId] = { activo: false, databaseURL };
      desarmarListenerDeTransferencia(localId);
      if (registro) {
        const restanteMs = Math.max(0, (registro.leaseUntil || 0) - ahora);
        console.log(`[Facturación] ${localId}: host en ${registro.hostname || registro.machineId}, lease vigente ${restanteMs}ms más. No se arranca acá.`);
      }
      return false;
    }

    const yaEraDueñaAntes = hostFiscalPorLocal[localId]?.activo;
    hostFiscalPorLocal[localId] = { activo: true, databaseURL };
    await armarListenerDeTransferencia(localId, databaseURL);

    const iniciadas = arrancarCuentasEvaluadas(resultados);
    if (!yaEraDueñaAntes) {
      console.log(`✅ [Facturación] ${localId}: host fiscal ganado por esta PC${iniciadas.length ? ` — ${[...new Set(iniciadas)].join(', ')}` : ''}.`);
    }
    return true;
  } finally {
    hostEnCurso.delete(localId);
  }
}

/**
 * Ciclo recurrente: arranque inicial, heartbeat/renovación de los locales ya
 * ganados, y reintento automático de los que Firebase no dejó evaluar recién
 * — todo el mismo mecanismo, sin distinguir "primera vez" de "reconexión".
 *
 * Restricción deliberada de esta entrega: como máximo UN local NUEVO por
 * ciclo por PC (los locales YA ganados siempre se renuevan). El parque real
 * (una PC por local, la administrativa excluida por el gate de abajo) nunca
 * necesita que una misma PC hostee dos locales a la vez; si algún día hiciera
 * falta, `facturacionProcs` necesita namespacing por `localId` primero (hoy
 * sus keys son sólo `'ri'`/`'mono_{cuentaId}'`).
 */
async function tickHostFiscal() {
  // Preferencia LOCAL de esta instalación, ANTES que nada: no depende de qué
  // local esté activo, no depende de FACTURACION_OWNERS, no se sincroniza por
  // Firebase. Una PC administrativa (que se usa para entrar a varios locales
  // pero nunca factura) la pone en `false` una sola vez y esta función corta
  // acá siempre, sin enumerar ni intentar ningún host. Ausente o `true` →
  // participa normalmente.
  if (!facturacionAutoStartHabilitado(leerMachineSettings(app.getPath('userData')))) {
    console.log('[Facturación] Autoarranque deshabilitado para esta PC');
    return;
  }

  const locales = localesConfiguradosEnEstaPC();
  let ganóUnoNuevoEsteCiclo = false;
  for (const localId of locales) {
    const yaEraDueña = !!hostFiscalPorLocal[localId]?.activo;
    if (!yaEraDueña && ganóUnoNuevoEsteCiclo) continue;
    try {
      const gane = await procesarLocalParaHostFiscal(localId);
      if (gane && !yaEraDueña) ganóUnoNuevoEsteCiclo = true;
    } catch (e) {
      console.error(`[Facturación] ${localId}: error en el ciclo de host fiscal: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Simple .env parser — sin dependencia externa
// ---------------------------------------------------------------------------
function parseEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const result = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        val.length >= 2 &&
        ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Reparar private_key malformada en backend.env existente
// El bug: gen-env-from-sa escribía newlines reales → parseEnvFile solo leía 1a línea
// El fix: reescribir la private_key con \n literales usando el serviceAccount.json
// ---------------------------------------------------------------------------
function repairBackendEnvIfNeeded(envPath, riSaPath) {
  if (!existsSync(envPath)) return false;
  try {
    const vars = parseEnvFile(envPath);
    const key = vars.FIREBASE_PRIVATE_KEY || '';
    // Detectar key truncada: tiene comienzo PEM pero no el final
    const hasPemStart = key.includes('-----BEGIN PRIVATE KEY-----');
    const hasPemEnd   = key.includes('-----END PRIVATE KEY-----');
    if (hasPemStart && hasPemEnd) return false; // ya está bien

    // Necesita reparación — usar serviceAccount.json para obtener la private_key correcta
    if (!existsSync(riSaPath)) {
      console.warn('[MP REPAIR] backend.env tiene private_key truncada pero no hay serviceAccount.json para repararla');
      return false;
    }
    const sa = JSON.parse(readFileSync(riSaPath, 'utf-8'));
    if (!sa.private_key?.includes('-----BEGIN PRIVATE KEY-----')) {
      console.warn('[MP REPAIR] serviceAccount.json también tiene private_key inválida');
      return false;
    }
    const privateKey = `"${sa.private_key.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
    // Reescribir solo la línea de FIREBASE_PRIVATE_KEY
    const content = readFileSync(envPath, 'utf-8');
    // Eliminar todas las líneas que sean parte de la private_key (la vieja sin escapar)
    const lines = content.split('\n');
    const newLines = [];
    let skipping = false;
    for (const line of lines) {
      if (line.startsWith('FIREBASE_PRIVATE_KEY=')) {
        newLines.push(`FIREBASE_PRIVATE_KEY=${privateKey}`);
        skipping = true; // saltar las líneas siguientes que eran parte del PEM
      } else if (skipping) {
        // Dejar de saltar cuando encontramos otra KEY=value o línea vacía antes de otra clave
        if (line.match(/^[A-Z_]+=/) || line.trim() === '') {
          skipping = false;
          newLines.push(line);
        }
        // si no → era parte del PEM multi-línea, la descartamos
      } else {
        newLines.push(line);
      }
    }
    writeFileSync(envPath, newLines.join('\n'), 'utf-8');
    console.log('[MP REPAIR] backend.env reparado: private_key reescrita correctamente');
    return true;
  } catch (e) {
    console.error('[MP REPAIR] error al reparar backend.env:', e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cargar backend.env desde userData (producción) o backend/.env (desarrollo)
// ---------------------------------------------------------------------------
function loadBackendEnv() {
  const localId = getActiveLocalId();
  const prodEnvPath = localId ? getBackendEnvPath(localId) : null;

  if (prodEnvPath && existsSync(prodEnvPath)) {
    console.log(`[main] backend.env (local ${localId}):`, prodEnvPath);
    return { vars: parseEnvFile(prodEnvPath), source: prodEnvPath };
  }

  if (isDev) {
    const devEnvPath = path.join(__dirname, '..', 'backend', '.env');
    if (existsSync(devEnvPath)) {
      console.log('[main] backend.env (dev):', devEnvPath);
      return { vars: parseEnvFile(devEnvPath), source: devEnvPath };
    }
  }

  console.warn('[main] backend.env no encontrado para el local activo:', prodEnvPath || '(sin local activo)');
  return { vars: {}, source: null };
}

// ---------------------------------------------------------------------------
// Crear/COMPLETAR el backend.env POR LOCAL con las variables base que el backend
// necesita para arrancar (sobre todo FIREBASE_DATABASE_URL, cuya ausencia produce
// el crash "Can't determine Firebase Database URL"). Rellena SOLO lo que falta:
// nunca pisa un valor ya presente. La URL de Firebase la aporta el renderer desde
// core.js (LOCATION_CONFIG del local) porque no se puede derivar del serviceAccount
// (p.ej. Bynnon usa proyecto achava3703 pero RTDB heladeriabynnonadrogue).
// cfg = { databaseURL, projectId, paymentsPath, token } — todos opcionales.
// ---------------------------------------------------------------------------
function ensureBackendEnv(localId = getActiveLocalId(), cfg = {}) {
  if (!localId) return { ok: false, error: 'Sin local activo.' };
  const envPath = getBackendEnvPath(localId);
  mkdirSync(path.dirname(envPath), { recursive: true });

  const vars = existsSync(envPath) ? parseEnvFile(envPath) : {};
  const changes = [];
  const setIfMissing = (key, value) => {
    if (value && (!vars[key] || String(vars[key]).trim() === '')) {
      vars[key] = String(value);
      changes.push(key);
    }
  };

  // Base coherente con el local activo (nunca pisa lo existente)
  setIfMissing('LOCAL_ID', localId);
  setIfMissing('FIREBASE_DATABASE_URL', cfg.databaseURL);
  setIfMissing('FIREBASE_PROJECT_ID', cfg.projectId); // opcional; credenciales igual vienen del serviceAccount
  setIfMissing('FIREBASE_PAGOS_PATH', cfg.paymentsPath || `${localId}/PAGOS_CONFIRMADOS`);
  setIfMissing('PORT', String(BACKEND_PORT));
  setIfMissing('POLL_INTERVAL_MS', '5000');

  // Token: si se pasa explícitamente, se actualiza (completar backend.env al guardar token)
  if (cfg.token) {
    vars.MERCADOPAGO_ACCESS_TOKEN = String(cfg.token);
    if (!changes.includes('MERCADOPAGO_ACCESS_TOKEN')) changes.push('MERCADOPAGO_ACCESS_TOKEN');
  }

  // Credenciales Firebase: si hay serviceAccountKey.json por local y no hay ni GAC ni
  // el trío de env vars, apuntar GOOGLE_APPLICATION_CREDENTIALS al SA por local (ruta absoluta).
  const saPath = getMpServiceAccountPath(localId);
  const saExists = existsSync(saPath);
  const hasEnvVarCreds = vars.FIREBASE_PROJECT_ID && vars.FIREBASE_CLIENT_EMAIL && vars.FIREBASE_PRIVATE_KEY;
  if (saExists && !vars.GOOGLE_APPLICATION_CREDENTIALS && !hasEnvVarCreds) {
    vars.GOOGLE_APPLICATION_CREDENTIALS = saPath;
    changes.push('GOOGLE_APPLICATION_CREDENTIALS');
  }

  try {
    const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    writeFileSync(envPath, content, 'utf-8');
  } catch (e) {
    return { ok: false, error: 'No se pudo escribir backend.env: ' + e.message };
  }

  // Crear mp-accounts.json si falta pero ya hay token + localId
  const mpAccPath = getMpAccountsPath(localId);
  let mpAccountsCreated = false;
  if (!existsSync(mpAccPath) && vars.MERCADOPAGO_ACCESS_TOKEN && vars.LOCAL_ID) {
    try {
      const accounts = [{
        nombreCuenta: 'Principal',
        accessTokenMercadoPago: vars.MERCADOPAGO_ACCESS_TOKEN,
        localId: vars.LOCAL_ID,
        firebasePathPagos: vars.FIREBASE_PAGOS_PATH || `${vars.LOCAL_ID}/PAGOS_CONFIRMADOS`,
        activo: true,
      }];
      writeFileSync(mpAccPath, JSON.stringify(accounts, null, 2), 'utf-8');
      mpAccountsCreated = true;
    } catch (e) {
      console.warn('[MP ENSURE-ENV] no se pudo crear mp-accounts.json:', e.message);
    }
  }

  if (changes.length) {
    console.log(`[MP ENSURE-ENV] local ${localId}: completado backend.env (${changes.join(', ')})`);
  }

  return {
    ok: true,
    path: envPath,
    localId,
    changes,
    hasDbUrl: !!vars.FIREBASE_DATABASE_URL,
    hasToken: !!vars.MERCADOPAGO_ACCESS_TOKEN,
    saExists,
    mpAccountsCreated,
  };
}

// ---------------------------------------------------------------------------
// Resolver GOOGLE_APPLICATION_CREDENTIALS a ruta absoluta
// Busca en userData, luego en ubicaciones de AFIP, y copia a userData si es necesario
// ---------------------------------------------------------------------------
function resolveCredentialsPath(vars, baseDir) {
  const defaultPath = path.join(baseDir, 'serviceAccountKey.json');
  const raw = vars.GOOGLE_APPLICATION_CREDENTIALS || '';

  console.log(`[MP SERVICE ACCOUNT] GOOGLE_APPLICATION_CREDENTIALS original=${raw || '(no definido)'}`);

  // 1. Si no hay GOOGLE_APPLICATION_CREDENTIALS → usar serviceAccountKey.json en userData directamente
  if (!raw) {
    const exists = existsSync(defaultPath);
    console.log(`[MP SERVICE ACCOUNT] ruta resuelta=${defaultPath}`);
    console.log(`[MP SERVICE ACCOUNT] existe en userData=${exists}`);
    if (exists) return defaultPath;
    // Si tampoco existe, buscar fallback abajo
    console.log('[MP SERVICE ACCOUNT] buscando fallback...');
    return resolveCredentialsFallback(baseDir, defaultPath);
  }

  // 2. Ya es absoluta y existe → usar directamente
  if (path.isAbsolute(raw) && existsSync(raw)) {
    console.log(`[MP SERVICE ACCOUNT] ruta resuelta=${raw}`);
    console.log('[MP SERVICE ACCOUNT] existe en userData=true');
    return raw;
  }

  // 3. Es relativa → resolver contra baseDir (dir del local bajo userData)
  const fromUserData = path.join(baseDir, raw);
  console.log(`[MP SERVICE ACCOUNT] ruta resuelta=${fromUserData}`);
  if (existsSync(fromUserData)) {
    console.log('[MP SERVICE ACCOUNT] existe en userData=true');
    return fromUserData;
  }

  console.log('[MP SERVICE ACCOUNT] existe en userData=false');
  console.log('[MP SERVICE ACCOUNT] buscando fallback...');
  return resolveCredentialsFallback(baseDir, defaultPath);
}

// Busca serviceAccount en ubicaciones conocidas de AFIP y copia a userData/serviceAccountKey.json
function resolveCredentialsFallback(baseDir, destPath) {
  // baseDir es la carpeta por local (contiene ri/ y mono/ del local activo).
  const facturBase = baseDir;
  const candidates = [
    path.join(facturBase, 'RI', 'serviceAccount.json'),
    path.join(facturBase, 'ri', 'serviceAccount.json'),
    path.join(facturBase, 'ri', 'serviceAccountKey.json'),
    path.join(facturBase, 'RI', 'serviceAccountKey.json'),
  ];

  // También buscar en carpetas de MONO: facturacion/mono/*/serviceAccount.json
  try {
    const monoBase = path.join(facturBase, 'mono');
    if (existsSync(monoBase)) {
      const { readdirSync } = require('fs');
      for (const subdir of readdirSync(monoBase)) {
        candidates.push(path.join(monoBase, subdir, 'serviceAccount.json'));
        candidates.push(path.join(monoBase, subdir, 'serviceAccountKey.json'));
      }
    }
  } catch {}

  // También la ruta de resources (AFIP RI en el build)
  if (!isDev) {
    candidates.push(path.join(process.resourcesPath, 'facturacion', 'RI', 'serviceAccount.json'));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.log(`[MP SERVICE ACCOUNT] encontrado en=${candidate}`);
      try {
        // Validar que sea un serviceAccount válido antes de copiar
        const sa = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (!sa.project_id || !sa.client_email || !sa.private_key) {
          console.warn(`[MP SERVICE ACCOUNT] ${candidate} no es un serviceAccount válido, omitido`);
          continue;
        }
        // Normalizar private_key antes de copiar
        const normalizedKey = String(sa.private_key)
          .replace(/\\\\n/g, '\n').replace(/\\n/g, '\n')
          .replace(/^["']|["']$/g, '').trim();
        const keyOk = normalizedKey.includes('-----BEGIN PRIVATE KEY-----') &&
                      normalizedKey.includes('-----END PRIVATE KEY-----');
        console.log(`[MP SERVICE ACCOUNT] private_key OK=${keyOk}`);
        if (!keyOk) {
          console.warn(`[MP SERVICE ACCOUNT] private_key inválida en ${candidate}`);
          continue;
        }
        sa.private_key = normalizedKey;
        writeFileSync(destPath, JSON.stringify(sa, null, 2), 'utf-8');
        console.log(`[MP SERVICE ACCOUNT] copiado a userData=true → ${destPath}`);
        return destPath;
      } catch (e) {
        console.error(`[MP SERVICE ACCOUNT] error al leer/copiar ${candidate}:`, e.message);
      }
    }
  }

  console.warn('[MP SERVICE ACCOUNT] copiado a userData=false — ningún serviceAccount encontrado en fallbacks');
  return null;
}

// ---------------------------------------------------------------------------
// Matar proceso que tenga ocupado el puerto (solo Windows)
// ---------------------------------------------------------------------------
function killPortIfOccupied(port) {
  try {
    const result = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf-8',
      windowsHide: true,
    });
    const pids = new Set();
    for (const line of result.split('\n')) {
      if (!line.includes('LISTENING') && !line.includes('ESTABLISHED')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0' && /^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { windowsHide: true });
        console.log(`[main] Proceso anterior en puerto ${port} terminado (PID ${pid})`);
      } catch { /* ya terminó o sin permisos */ }
    }
  } catch { /* puerto libre o sin permisos — ok */ }
}

// ---------------------------------------------------------------------------
// Iniciar backend MercadoPago sin consola visible
// ---------------------------------------------------------------------------
function startBackend() {
  console.log('[MP BACKEND START] reiniciando backend');
  const localId = getActiveLocalId();
  if (!localId) {
    console.warn('[MP BACKEND START] sin local activo — no se inicia el backend de Mercado Pago hasta seleccionar un local.');
    return;
  }
  // Migración automática responsable del MP global → este local (si coincide LOCAL_ID).
  maybeMigrateMpToLocal(localId);

  const baseDir = getLocaleFacturacionDir(localId);
  mkdirSync(baseDir, { recursive: true });
  const { vars, source: envSource } = loadBackendEnv();

  // Avisar si falta config (no bloqueante) — serviceAccount POR LOCAL
  const missingFirebase =
    !vars.FIREBASE_PROJECT_ID &&
    !vars.GOOGLE_APPLICATION_CREDENTIALS &&
    !existsSync(getMpServiceAccountPath(localId));

  if (!envSource) {
    // Solo log — el panel de salud en la UI muestra el estado y permite configurar
    console.warn(`[main] backend.env no encontrado para el local ${localId}. El SystemHealthPanel ofrecerá auto-generarlo.`);
  } else if (missingFirebase) {
    console.warn('[main] ADVERTENCIA: credenciales de Firebase no encontradas en backend.env.');
  }

  if (!vars.MERCADOPAGO_ACCESS_TOKEN) {
    console.warn('[main] ADVERTENCIA: MERCADOPAGO_ACCESS_TOKEN no configurado.');
  }

  const resolvedCredentials = resolveCredentialsPath(vars, baseDir);

  const env = {
    ...process.env,
    ...vars,
    PORT: vars.PORT || String(BACKEND_PORT),
    DOTENV_CONFIG_PATH: envSource || '',
    // Apunta al dir por local: el backend resuelve serviceAccountKey.json y backend-data ahí.
    ELECTRON_USER_DATA_PATH: baseDir,
    NODE_ENV: isDev ? 'development' : 'production',
  };

  if (resolvedCredentials) {
    env.GOOGLE_APPLICATION_CREDENTIALS = resolvedCredentials;
    console.log('[MP SERVICE ACCOUNT] ruta final usada=', resolvedCredentials);
    // Si el backend.env tenía una ruta relativa y ahora tenemos la absoluta, actualizar backend.env
    // para que la próxima vez dotenv no re-inyecte la relativa
    const rawCred = vars.GOOGLE_APPLICATION_CREDENTIALS || '';
    if (rawCred && !path.isAbsolute(rawCred) && envSource) {
      try {
        const content = readFileSync(envSource, 'utf-8')
          .replace(/^GOOGLE_APPLICATION_CREDENTIALS=.*$/m, `GOOGLE_APPLICATION_CREDENTIALS=${resolvedCredentials}`);
        writeFileSync(envSource, content, 'utf-8');
        console.log('[MP SERVICE ACCOUNT] backend.env actualizado=true (ruta relativa → absoluta)');
      } catch (e) {
        console.warn('[MP SERVICE ACCOUNT] backend.env actualizado=false:', e.message);
      }
    }
  } else {
    // Sin credenciales — borrar del env para evitar que el backend reciba un path inválido
    // pero también borrar del backend.env para evitar re-inyección por dotenv
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    if (vars.GOOGLE_APPLICATION_CREDENTIALS && envSource) {
      try {
        const content = readFileSync(envSource, 'utf-8')
          .replace(/^GOOGLE_APPLICATION_CREDENTIALS=.*\n?/m, '');
        writeFileSync(envSource, content, 'utf-8');
        console.log('[MP SERVICE ACCOUNT] GOOGLE_APPLICATION_CREDENTIALS removido de backend.env (archivo no existe)');
      } catch {}
    }
    console.warn('[MP SERVICE ACCOUNT] No se encontró serviceAccount — Firebase usará FIREBASE_PROJECT_ID vars o fallará');
  }

  // ---------------------------------------------------------------------------
  // Auto-crear mp-accounts.json si falta pero backend.env tiene el token y localId
  // Escenario: PC nueva donde se configuró backend.env manualmente pero no el manager de cuentas
  // ---------------------------------------------------------------------------
  const accountsFilePath = getMpAccountsPath(localId);
  if (!existsSync(accountsFilePath) && vars.MERCADOPAGO_ACCESS_TOKEN && vars.LOCAL_ID) {
    const autoLocalId = vars.LOCAL_ID;
    const autoAccounts = [{
      nombreCuenta: 'Principal',
      accessTokenMercadoPago: vars.MERCADOPAGO_ACCESS_TOKEN,
      localId: autoLocalId,
      firebasePathPagos: vars.FIREBASE_PAGOS_PATH || `${autoLocalId}/PAGOS_CONFIRMADOS`,
      activo: true,
    }];
    try {
      writeFileSync(accountsFilePath, JSON.stringify(autoAccounts, null, 2), 'utf-8');
      console.log(`[mp-config] mp-accounts.json auto-creado desde backend.env → LOCAL_ID=${autoLocalId}`);
    } catch (e) {
      console.warn('[mp-config] no se pudo auto-crear mp-accounts.json:', e.message);
    }
  } else if (!existsSync(accountsFilePath)) {
    console.warn('[mp-config] sin mp-accounts.json y backend.env no tiene MERCADOPAGO_ACCESS_TOKEN + LOCAL_ID → MP no podrá pollear');
  }

  // Sobrescribir con la cuenta activa de Mercado Pago (si está configurada)
  if (existsSync(accountsFilePath)) {
    try {
      const accounts = JSON.parse(readFileSync(accountsFilePath, 'utf-8'));
      const activeAccount = accounts.find((a) => a.activo);
      if (activeAccount) {
        if (activeAccount.accessTokenMercadoPago) {
          env.MERCADOPAGO_ACCESS_TOKEN = activeAccount.accessTokenMercadoPago;
        }
        if (activeAccount.localId) {
          env.LOCAL_ID = activeAccount.localId;
        }
        if (activeAccount.firebasePathPagos) {
          env.FIREBASE_PAGOS_PATH = activeAccount.firebasePathPagos;
          env.FIREBASE_SYNC_PATH = `${activeAccount.localId}/MERCADOPAGO_SYNC`;
        }
        console.log('[mp-config] cuenta activa cargada');
        console.log(`[backend] usando cuenta Mercado Pago: ${activeAccount.nombreCuenta}`);
        console.log(`[backend] ruta pagos Firebase: ${activeAccount.firebasePathPagos}`);
      }
    } catch (e) {
      console.error('[mp-config] error leyendo mp-accounts.json:', e.message);
    }
  }

  // Logs obligatorios de arranque
  const _envSource = envSource || 'no encontrado';
  const _pagosPath = env.FIREBASE_PAGOS_PATH || (env.LOCAL_ID ? `${env.LOCAL_ID}/PAGOS_CONFIRMADOS` : 'no configurado');
  console.log('[MP BACKEND START] iniciando...');
  console.log(`[MP BACKEND START] envPath=${_envSource}`);
  console.log(`[MP BACKEND START] token presente=${!!env.MERCADOPAGO_ACCESS_TOKEN}`);
  console.log(`[MP BACKEND START] localId=${env.LOCAL_ID || 'no configurado'}`);
  console.log(`[MP BACKEND START] ruta pagos=${_pagosPath}`);
  console.log(`[MP BACKEND START] firebase creds=${!!(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL)}`);
  console.log(`[MP BACKEND START] databaseURL presente=${!!env.FIREBASE_DATABASE_URL}`);

  // GUARD ANTI-CRASH: el backend inicializa Firebase con databaseURL=FIREBASE_DATABASE_URL en
  // TODAS sus estrategias (backend/src/firebase.js). Sin esa variable, db.ref() lanza
  // "Can't determine Firebase Database URL" y el proceso muere. Preferimos NO arrancarlo:
  // se completará al entrar a Mercado Pago (backend:ensure-env) o al cargar el local (App.jsx).
  if (!env.FIREBASE_DATABASE_URL) {
    backendLastError = 'backend.env sin FIREBASE_DATABASE_URL — se completará al entrar a Mercado Pago.';
    console.warn(`[MP BACKEND START] ${backendLastError} (no se inicia para evitar el crash de Firebase)`);
    return;
  }

  backendLastError = null;
  backendCrashFast = false;
  backendStartedAt = Date.now();

  killPortIfOccupied(Number(env.PORT));

  if (isDev) {
    const entry = path.join(__dirname, '..', 'backend', 'src', 'server.js');
    if (!existsSync(entry)) {
      console.warn('[main] No se encontró backend/src/server.js');
      return;
    }

    backendProcess = spawn('node', [entry], {
      env,
      windowsHide: true,
      detached: false,
    });

    backendProcess.stdout?.on('data', (d) => {
      const line = d.toString().trimEnd();
      console.log('[backend]', line);
      backendLastLog = line;
    });
    backendProcess.stderr?.on('data', (d) => {
      const line = d.toString().trimEnd();
      console.error('[backend]', line);
      backendLastError = line;
      backendLastLog   = line;
    });
    backendProcess.on('exit', (code) => {
      console.log('[main] Backend (dev) terminó, código:', code);
      backendProcess = null;
      backendStatus  = 'stopped';
    });
  } else {
    const entry = path.join(process.resourcesPath, 'backend', 'src', 'server.js');
    if (!existsSync(entry)) {
      backendLastError = `Archivo backend no encontrado: ${entry}`;
      console.warn('[MP BACKEND START] error=', backendLastError);
      return;
    }

    // utilityProcess.fork() usa el Node.js embebido de Electron
    // stdio: 'pipe' → captura stdout/stderr para diagnóstico visible
    backendProcess = utilityProcess.fork(entry, [], {
      env,
      stdio: 'pipe',
    });

    backendProcess.stdout?.on('data', (d) => {
      const line = d.toString().trimEnd();
      console.log('[backend]', line);
      backendLastLog = line;
    });
    backendProcess.stderr?.on('data', (d) => {
      const line = d.toString().trimEnd();
      console.error('[backend-err]', line);
      backendLastError = line;
      backendLastLog   = line;
    });

    const _startedAt = backendStartedAt;
    backendProcess.on('exit', (code) => {
      const ms = Date.now() - _startedAt;
      console.log(`[MP BACKEND START] terminó | código=${code} | uptime=${ms}ms`);
      if (ms < 6000) {
        backendCrashFast = true;
        console.error(`[MP BACKEND START] error=${backendLastError || 'crash inmediato — revisá backend.env y credenciales Firebase'}`);
      }
      backendProcess = null;
      backendStatus  = 'stopped';

      // Auto-retry ÚNICO: si corrió > 5s (no fue crash de config) y no se reintentó aún
      if (!backendAutoRetried && ms > 5000) {
        backendAutoRetried = true;
        console.log('[MP BACKEND START] backend se detuvo inesperadamente, reintentando en 6s...');
        setTimeout(() => { if (!backendProcess) startBackend(); }, 6000);
      }
    });
  }

  backendStatus = 'running';
  console.log(`[MP BACKEND START] pid=${backendProcess?.pid || 'desconocido'}`);
  console.log('[main] Backend iniciado en puerto:', env.PORT);
}

function stopBackend() {
  if (!backendProcess) return;
  try {
    if (typeof backendProcess.kill === 'function') backendProcess.kill();
    else if (backendProcess.pid) process.kill(backendProcess.pid);
  } catch (err) {
    console.warn('[main] No se pudo detener backend:', err.message);
  }
  backendProcess = null;
  backendStatus = 'stopped';
}

// ---------------------------------------------------------------------------
// Impresión térmica via webContents.print()
// ---------------------------------------------------------------------------
async function handlePrint(_event, htmlContent, printerName, options = {}) {
  return new Promise((resolve, reject) => {
    const printWin = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`;
    printWin.loadURL(dataUrl);

    printWin.webContents.once('did-finish-load', () => {
      const printOptions = {
        silent: true,
        printBackground: true,
        // scaleFactor: solo el ticket fiscal lo manda hoy (comprobanteFiscalPrint.jsx).
        // Ausente en cualquier otro llamado (comandas, ticket de mostrador) = 100,
        // idéntico al comportamiento de siempre.
        scaleFactor: options.scaleFactor || 100,
        ...(printerName ? { deviceName: printerName } : {}),
      };

      printWin.webContents.print(printOptions, (success, reason) => {
        printWin.close();
        if (success) resolve({ success: true });
        else reject(new Error(reason || 'Error de impresión'));
      });
    });

    printWin.on('closed', () => resolve({ success: false, closed: true }));

    setTimeout(() => {
      if (!printWin.isDestroyed()) printWin.close();
      reject(new Error('Timeout: el trabajo de impresión tardó demasiado'));
    }, 30000);
  });
}

// ---------------------------------------------------------------------------
// Chequeo de actualizaciones (Firebase Storage / latest.json)
// ---------------------------------------------------------------------------
const LATEST_JSON_URL = 'https://firebasestorage.googleapis.com/v0/b/achava3703.firebasestorage.app/o/instalaciones%2Fsoftware%2Flatest.json?alt=media';

function newerVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function checkForUpdates() {
  if (isDev) return;
  const currentVersion = app.getVersion();

  const doGet = (url, redirects = 0) => {
    if (redirects > 5) return;
    let transport;
    try {
      transport = resolveRequestTransport(url);
    } catch { /* URL inválida — silencioso, igual que un error de red acá */ return; }
    transport.module.get(transport.url, { headers: { 'User-Agent': 'recepcion-de-pedidos-desktop' }, timeout: 10000 }, (res) => {
      if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
        doGet(res.headers.location, redirects + 1);
        return;
      }
      if (res.statusCode !== 200) return;
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (!info.latest || !info.installerUrl) return;
          if (!newerVersion(info.latest, currentVersion)) return;
          mainWindow?.webContents?.send('update:available', {
            version:      info.latest,
            installerUrl: info.installerUrl,
            sha256:       info.sha256 || null,
            fileName:     `Recepcion-de-Pedidos-Setup-${info.latest}.exe`,
          });
        } catch { /* silencioso */ }
      });
    }).on('error', () => { /* sin red — silencioso */ });
  };

  doGet(LATEST_JSON_URL);
}

// ---------------------------------------------------------------------------
// Ventana principal
// ---------------------------------------------------------------------------
/**
 * Trae al frente la ventana que YA está abierta. La usa el handler de
 * `second-instance` cuando alguien hace doble clic con la app corriendo.
 *
 * NO navega, NO recarga y NO cambia de sección: el usuario tiene que volver a
 * ver exactamente la pantalla donde estaba (Ventas, Configuración, Mostrador,
 * lo que sea). Por eso acá no se toca el renderer para nada.
 *
 * Respeta el modo visual actual: si estaba en pantalla completa se queda en
 * pantalla completa; si no, se maximiza (que es como arranca la app).
 */
function mostrarVentanaPrincipal() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // Caso raro: la instancia primaria está viva pero sin ventana (cerrada a
    // mano). Se abre una, que es lo que el usuario está pidiendo.
    console.log('[APP] No hay ventana principal: se crea una.');
    createWindow();
    return;
  }

  console.log('[APP] Restaurando ventana principal');

  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();          // oculta en tray

  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
  else mainWindow.maximize();

  mainWindow.moveTop();
  mainWindow.focus();

  // El aviso va DESPUÉS de traerla al frente, y colgado de la ventana principal
  // para que sea un cartel de esa ventana y no otra ventana nueva. Sin await: no
  // se bloquea nada mientras el usuario sigue trabajando.
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Recepción de Pedidos',
    message: 'Recepción de Pedidos ya se encuentra abierto.',
    buttons: ['Entendido'],
    noLink: true,
  }).catch(() => { /* si no se puede mostrar el cartel, la ventana ya quedó al frente */ });
}

function createWindow() {
  // Ruta al ícono: en producción está en resources/, en dev en build/
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icono-dlv.ico')
    : path.join(__dirname, '..', 'build', 'icono-dlv.ico');
  const iconExists = existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Recepción de Pedidos',
    ...(iconExists ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function setupIPC() {
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('backend-status', () => backendStatus);
  ipcMain.handle('backend-port', () => BACKEND_PORT);

  ipcMain.handle('autostart-get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('autostart-set', (_e, enable) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enable), path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('open-userData-folder', () => shell.openPath(app.getPath('userData')));

  ipcMain.handle('open-external', (_e, url) => {
    try {
      const parsed = new URL(url);
      const allowed = ['https:', 'http:', 'whatsapp:'];
      if (allowed.includes(parsed.protocol)) {
        shell.openExternal(url);
      }
    } catch { /* URL inválida */ }
  });

  // Chequeo de actualización bajo demanda (pre-login). Lee latest.json de Firebase
  // Storage y devuelve la info SIN descargar nada — el renderer decide según mandatory.
  // Siempre resuelve (nunca rechaza) para no bloquear el arranque si no hay internet.
  ipcMain.handle('check-updates-now', () => {
    if (isDev) return { hasUpdate: false, reason: 'dev' };
    const currentVersion = app.getVersion();

    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => { if (!settled) { settled = true; resolve(val); } };

      const doGet = (url, redirects = 0) => {
        if (redirects > 5) { done({ hasUpdate: false, error: 'too-many-redirects', currentVersion }); return; }
        let transport;
        try {
          transport = resolveRequestTransport(url);
        } catch (e) {
          done({ hasUpdate: false, error: classifyTransportError(e), currentVersion });
          return;
        }
        const req = transport.module.get(transport.url, { headers: { 'User-Agent': 'recepcion-de-pedidos-desktop' }, timeout: 8000 }, (res) => {
          if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
            doGet(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) { done({ hasUpdate: false, error: `http-${res.statusCode}`, currentVersion }); return; }
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const info = JSON.parse(data);
              if (!info.latest || !info.installerUrl) { done({ hasUpdate: false, error: 'bad-latest-json', currentVersion }); return; }
              done({
                hasUpdate:    newerVersion(info.latest, currentVersion),
                version:      info.latest,
                installerUrl: info.installerUrl,
                sha256:       info.sha256 || null,
                fileName:     `Recepcion-de-Pedidos-Setup-${info.latest}.exe`,
                mandatory:    info.mandatory === true,
                currentVersion,
              });
            } catch {
              done({ hasUpdate: false, error: 'parse-error', currentVersion });
            }
          });
        });
        req.on('timeout', () => { req.destroy(); done({ hasUpdate: false, error: 'timeout', currentVersion }); });
        req.on('error', () => { done({ hasUpdate: false, error: 'network', currentVersion }); });
      };

      doGet(LATEST_JSON_URL);
    });
  });

  // Descarga el instalador con progreso real, verifica SHA256 opcional y lo ejecuta
  ipcMain.handle('download-and-install', (_e, downloadUrl, fileName, sha256) => {
    const tmpDir = app.getPath('temp');
    const dest = path.join(tmpDir, fileName || 'update-setup.exe');

    const sendProgress = (pct) => {
      mainWindow?.webContents?.send('download-progress', { pct: Math.min(100, Math.max(0, pct)) });
    };

    return new Promise((resolve, reject) => {
      const doDownload = (url, redirectCount = 0) => {
        if (redirectCount > 5) { reject(new Error('Demasiadas redirecciones')); return; }

        const file = createWriteStream(dest);
        const req = https.get(url, { headers: { 'User-Agent': 'recepcion-de-pedidos-desktop' }, timeout: 180000 }, (res) => {
          // Seguir redirecciones 301/302
          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
            file.close(() => doDownload(res.headers.location, redirectCount + 1));
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            unlink(dest, () => {});
            reject(new Error(`Error HTTP ${res.statusCode}`));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            file.write(chunk);
            if (totalBytes > 0) {
              sendProgress(Math.round((receivedBytes / totalBytes) * 100));
            }
          });

          res.on('end', () => {
            file.close(async () => {
              sendProgress(100);
              if (sha256) {
                try {
                  const fileHash = await computeSha256File(dest);
                  if (fileHash.toLowerCase() !== sha256.toLowerCase()) {
                    unlink(dest, () => {});
                    reject(new Error('El instalador descargado no pasó la verificación de integridad (SHA256). El archivo puede estar corrupto. Intentá de nuevo.'));
                    return;
                  }
                } catch (hashErr) {
                  unlink(dest, () => {});
                  reject(hashErr);
                  return;
                }
              }
              // Sin /S: el installer oneClick muestra una barra de progreso breve
              // y relanza la app automáticamente (runAfterFinish: true en nsis).
              // Con /S la pantalla de finalización se saltea y runAfterFinish nunca dispara.
              const child = spawn(dest, [], { detached: true, stdio: 'ignore' });
              child.unref();
              // Cerrar la app para que el instalador pueda reemplazar el ejecutable
              setTimeout(() => app.quit(), 2000);
              resolve({ ok: true });
            });
          });

          res.on('error', (err) => {
            file.close();
            unlink(dest, () => {});
            reject(err);
          });
        });

        req.on('error', (err) => {
          file.close();
          unlink(dest, () => {});
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          file.close();
          unlink(dest, () => {});
          reject(new Error('Timeout: la descarga tardó demasiado'));
        });
      };

      doDownload(downloadUrl);
    });
  });

  // Gestión de cuentas de Mercado Pago
  ipcMain.handle('mp-accounts:read', () => {
    const localId = getActiveLocalId();
    if (!localId) return [];
    const accountsPath = getMpAccountsPath(localId);
    if (!existsSync(accountsPath)) return [];
    try {
      return JSON.parse(readFileSync(accountsPath, 'utf-8'));
    } catch {
      return [];
    }
  });

  ipcMain.handle('mp-accounts:write', (_e, accounts) => {
    const localId = getActiveLocalId();
    if (!localId) return false;
    const accountsPath = getMpAccountsPath(localId);
    mkdirSync(path.dirname(accountsPath), { recursive: true });
    writeFileSync(accountsPath, JSON.stringify(accounts, null, 2), 'utf-8');
    console.log(`[mp-config] cuentas guardadas (local ${localId}): ${accounts.length}`);
    return true;
  });

  // Migración automática responsable del MP global viejo → local activo (idempotente).
  ipcMain.handle('mp:migrate-global-to-local', () => maybeMigrateMpToLocal(getActiveLocalId()));

  ipcMain.handle('backend:restart', async () => {
    console.log('[mp-config] reiniciando backend por cambio de cuenta');
    stopBackend();
    backendAutoRetried = false; // permitir un retry después de este restart
    await new Promise((resolve) => setTimeout(resolve, 900));
    startBackend();
    // Esperar 3s para detectar si crasheó rápido
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!backendProcess) {
      const err = backendLastError || 'El backend se cerró inmediatamente. Verificá backend.env y credenciales Firebase.';
      console.error('[backend:restart] crash detectado:', err);
      return { ok: false, crashed: true, error: err };
    }
    const pid = backendProcess.pid || null;
    console.log(`[backend:restart] OK | pid=${pid}`);
    return { ok: true, pid };
  });

  // ---------------------------------------------------------------------------
  // Local nuevo — limpia toda la configuración local para instalar en otro local
  // NO borra datos de Firebase. Solo limpia archivos y carpetas de esta PC.
  // ---------------------------------------------------------------------------
  ipcMain.handle('local:reset-for-new', async () => {
    console.log('[LOCAL NUEVO] Confirmado por DiegoL');
    const userDataPath = app.getPath('userData');

    // 1. Detener servicios activos
    console.log('[LOCAL NUEVO] Deteniendo Mercado Pago...');
    stopBackend();
    await new Promise((r) => setTimeout(r, 600));

    console.log('[LOCAL NUEVO] Deteniendo Facturación AFIP...');
    stopAllFacturacion();
    await new Promise((r) => setTimeout(r, 400));

    // 2. Borrar archivos de configuración local (MP — Fase 2, siguen siendo globales por ahora)
    console.log('[LOCAL NUEVO] Borrando configuración local...');
    // 3. Borrar TODA la config POR LOCAL del local activo (facturación + MP:
    //    config, ri, mono, backend.env, mp-accounts.json, serviceAccountKey.json).
    //    Los archivos GLOBALES viejos quedan como respaldo (no se borran).
    //    Se conserva facturacion/node_modules (compartido) para no reinstalar.
    const _resetLocalId = getActiveLocalId();
    if (_resetLocalId) {
      const localFacDir = getLocaleFacturacionDir(_resetLocalId);
      try {
        if (existsSync(localFacDir)) { rmSync(localFacDir, { recursive: true, force: true }); console.log(`[LOCAL NUEVO] Borrada config del local ${_resetLocalId}: ${localFacDir}`); }
      } catch (e) { console.error(`[LOCAL NUEVO] Error borrando config del local ${_resetLocalId}:`, e.message); }
    }

    // 4. Limpiar localStorage y sessionStorage del renderer
    console.log('[LOCAL NUEVO] Borrando ID local guardado...');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              // Claves críticas del local anterior
              localStorage.removeItem('localId');
              localStorage.removeItem('selectedLocalId');
              localStorage.removeItem('idLocal');
              localStorage.removeItem('currentLocal');
              localStorage.removeItem('selectedLocal');
              localStorage.removeItem('localConfig');
              localStorage.removeItem('userLocal');
              localStorage.removeItem('dlvLocal');
              // Cache MP (fallback local de cuentas MP)
              localStorage.removeItem('mp-accounts-safe');
              // Sesión de usuario
              sessionStorage.clear();
              const remaining = localStorage.getItem('localId');
              console.log('[LOCAL NUEVO] localId después de limpiar = ' + remaining);
            } catch(e) { console.error('[LOCAL NUEVO] error limpiando storage:', e); }
          })();
        `);
      }
    } catch (e) { console.error('[LOCAL NUEVO] Error limpiando localStorage:', e.message); }

    // 5. Reiniciar aplicación
    console.log('[LOCAL NUEVO] reinicio solicitado');
    console.log('[LOCAL NUEVO] Reiniciando aplicación...');
    await new Promise((r) => setTimeout(r, 500));
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Facturación AFIP
  // ---------------------------------------------------------------------------
  // Facturación AFIP — IPC handlers
  // ---------------------------------------------------------------------------

  // ─── Logging AFIP ─────────────────────────────────────────────────────────
  const writeAfipLog = (msg) => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      mkdirSync(logsDir, { recursive: true });
      const line = `[${new Date().toISOString()}] ${msg}\n`;
      appendFileSync(path.join(logsDir, 'facturacion-afip.log'), line, 'utf-8');
    } catch {}
  };

  // Diagnóstico completo de una cuenta AFIP
  // ---------------------------------------------------------------------------
  // Helpers de diagnóstico extendido (SOLO LECTURA, no valida emisión ni firma).
  // headerPreview nunca incluye más que la primera línea del archivo: para un PEM
  // válido esa línea es únicamente el marcador "-----BEGIN...-----" (nunca el
  // cuerpo en base64 de la clave/certificado); para un archivo corrupto/HTML,
  // muestra esa misma primera línea recortada, que ayuda a diagnosticar sin
  // exponer contenido sensible completo.
  // ---------------------------------------------------------------------------
  const PEM_HEADER_PREVIEW_MAX = 60;

  const inspectFile = (filePath) => {
    const base = { path: filePath, exists: existsSync(filePath), size: 0, empty: true };
    if (!base.exists) return base;
    try {
      const st = statSync(filePath);
      base.size  = st.size;
      base.empty = st.size === 0;
    } catch (e) {
      base.statError = e.message;
    }
    return base;
  };

  const firstLine = (filePath, maxLen) => {
    try {
      const buf = readFileSync(filePath, { encoding: 'utf-8' });
      const line = buf.split(/\r?\n/, 1)[0] || '';
      return line.length > maxLen ? line.slice(0, maxLen) + '…' : line;
    } catch {
      return null;
    }
  };

  const inspectPemFile = (filePath, validMarkers) => {
    const info = inspectFile(filePath);
    if (!info.exists || info.empty) {
      return { ...info, headerPreview: null, valid: false };
    }
    const preview = firstLine(filePath, PEM_HEADER_PREVIEW_MAX);
    const valid = !!preview && validMarkers.some((m) => preview.startsWith(m));
    return { ...info, headerPreview: preview, valid };
  };

  const inspectJsonFile = (filePath) => {
    const info = inspectFile(filePath);
    if (!info.exists || info.empty) {
      return { ...info, validJson: false };
    }
    let validJson = false;
    try {
      JSON.parse(readFileSync(filePath, 'utf-8'));
      validJson = true;
    } catch {
      validJson = false;
    }
    return { ...info, validJson };
  };

  ipcMain.handle('facturacion:diagnose', (_e, tipo, cuentaId) => {
    const userData       = app.getPath('userData');
    const facturDir      = FACTURACION_USER_DIR();
    const accountDir     = tipo === 'responsable_inscripto' ? getRIDir() : getMonoDir(cuentaId);
    const logsDir        = path.join(userData, 'logs');
    const logPath        = path.join(logsDir, 'facturacion-afip.log');

    const chk = (p) => ({ path: p, exists: existsSync(p) });

    // Leer .env y extraer GOOGLE_APPLICATION_CREDENTIALS
    const envPath = path.join(accountDir, '.env');
    let gcpRaw = null, gcpAbsolute = null;
    if (existsSync(envPath)) {
      try {
        const m = readFileSync(envPath, 'utf-8').match(/^GOOGLE_APPLICATION_CREDENTIALS=(.+)$/m);
        if (m) gcpRaw = m[1].trim();
      } catch {}
    }
    if (gcpRaw) {
      gcpAbsolute = path.isAbsolute(gcpRaw)
        ? gcpRaw
        : path.resolve(accountDir, gcpRaw);
    }

    const certPath = path.join(accountDir, 'cert', 'certificado.crt');
    const keyPath  = path.join(accountDir, 'cert', 'clave.key');
    const saPath   = path.join(accountDir, 'serviceAccount.json');

    const files = {
      env:            inspectFile(envPath),
      indexMjs:       chk(path.join(accountDir, 'index.mjs')),
      serviceAccount: inspectJsonFile(saPath),
      cert:           inspectPemFile(certPath, ['-----BEGIN CERTIFICATE-----']),
      key:            inspectPemFile(keyPath, ['-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----']),
      nodeModules:    chk(path.join(facturDir, 'node_modules', 'firebase-admin')),
    };

    // Alias legibles para el consumo desde la UI/soporte, siguiendo los nombres
    // pedidos: validPemCertificate / validPemPrivateKey / validJson.
    files.cert.validPemCertificate = files.cert.valid;
    files.key.validPemPrivateKey   = files.key.valid;

    const diag = {
      timestamp: new Date().toISOString(),
      userData, facturDir, accountDir, logPath,
      files,
      gcpRaw, gcpAbsolute,
      gcpExists: gcpAbsolute ? existsSync(gcpAbsolute) : false,
    };

    // Escribir al archivo de log — diagnóstico extendido (solo lectura, sin
    // contenido sensible: headerPreview es únicamente la línea "-----BEGIN...-----").
    const lines = [
      `\n=== Diagnóstico AFIP [${diag.timestamp}] ===`,
      `userData:    ${userData}`,
      `accountDir:  ${accountDir}`,
      ``,
      `ARCHIVOS (resumen):`,
      `  .env             ${files.env.exists             ? 'OK    ' : 'FALTA '} ${files.env.path}`,
      `  index.mjs        ${files.indexMjs.exists         ? 'OK    ' : 'FALTA '} ${files.indexMjs.path}`,
      `  serviceAccount   ${files.serviceAccount.exists   ? 'OK    ' : 'FALTA '} ${files.serviceAccount.path}`,
      `  certificado.crt  ${files.cert.exists             ? 'OK    ' : 'FALTA '} ${files.cert.path}`,
      `  clave.key        ${files.key.exists              ? 'OK    ' : 'FALTA '} ${files.key.path}`,
      `  node_modules     ${files.nodeModules.exists      ? 'OK    ' : 'FALTA '} ${files.nodeModules.path}`,
      ``,
      `Certificado:`,
      `  path:                ${files.cert.path}`,
      `  exists:              ${files.cert.exists}`,
      `  size:                ${files.cert.size} bytes`,
      `  empty:               ${files.cert.empty}`,
      `  validPemCertificate: ${files.cert.validPemCertificate}`,
      `  headerPreview:       ${files.cert.headerPreview ?? '(sin contenido)'}`,
      ``,
      `Clave:`,
      `  path:                ${files.key.path}`,
      `  exists:              ${files.key.exists}`,
      `  size:                ${files.key.size} bytes`,
      `  empty:               ${files.key.empty}`,
      `  validPemPrivateKey:  ${files.key.validPemPrivateKey}`,
      `  headerPreview:       ${files.key.headerPreview ?? '(sin contenido)'}`,
      ``,
      `Service Account:`,
      `  path:                ${files.serviceAccount.path}`,
      `  exists:              ${files.serviceAccount.exists}`,
      `  size:                ${files.serviceAccount.size} bytes`,
      `  validJson:           ${files.serviceAccount.validJson}`,
      ``,
      `.env:`,
      `  path:                ${files.env.path}`,
      `  exists:              ${files.env.exists}`,
      `  size:                ${files.env.size} bytes`,
      ``,
      `GOOGLE_APPLICATION_CREDENTIALS: ${gcpRaw || '(no definido en .env)'}`,
      `  → Ruta absoluta: ${gcpAbsolute || 'N/A'}`,
      `  → Archivo existe: ${diag.gcpExists ? 'SÍ ✓' : 'NO ✗'}`,
      ``,
    ].join('\n');

    try {
      mkdirSync(logsDir, { recursive: true });
      appendFileSync(logPath, lines, 'utf-8');
    } catch (e) {
      diag.logError = e.message;
    }

    return diag;
  });

  // Abrir el archivo de log en el editor de texto del sistema
  ipcMain.handle('facturacion:open-log', () => {
    const logPath = path.join(app.getPath('userData'), 'logs', 'facturacion-afip.log');
    if (!existsSync(logPath)) {
      mkdirSync(path.dirname(logPath), { recursive: true });
      writeFileSync(logPath, `[${new Date().toISOString()}] Log iniciado\n`, 'utf-8');
    }
    shell.openPath(logPath);
    return logPath;
  });

  // Machine ID
  ipcMain.handle('machine-id:get', () => MACHINE_ID);
  ipcMain.handle('machine-id:get-info', () => ({ machineId: MACHINE_ID, hostname: os.hostname() }));

  // Leer un archivo como base64 (para subir certs a Firebase Storage desde el renderer)
  ipcMain.handle('facturacion:read-file-base64', (_e, filePath) => {
    try {
      const buf = readFileSync(filePath);
      return { ok: true, data: buf.toString('base64') };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Escribir buffer (base64) a disco — para reconstituir certs descargados de Storage
  ipcMain.handle('facturacion:write-binary-file', (_e, destPath, base64Data) => {
    try {
      mkdirSync(path.dirname(destPath), { recursive: true });
      writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Descargar archivo desde URL y guardar en disco — sigue redirects automáticamente
  ipcMain.handle('facturacion:download-file', (_e, url, destPath) => {
    const writeAfipLogLocal = (msg) => {
      try {
        const logsDir = path.join(app.getPath('userData'), 'logs');
        mkdirSync(logsDir, { recursive: true });
        appendFileSync(path.join(logsDir, 'facturacion-afip.log'),
          `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
      } catch {}
    };

    return new Promise((resolve, reject) => {
      mkdirSync(path.dirname(destPath), { recursive: true });

      const doGet = (currentUrl, redirects) => {
        if (redirects > 5) {
          const err = new Error('Demasiadas redirecciones al descargar ' + path.basename(destPath));
          writeAfipLogLocal(`[DOWNLOAD ERROR] ${err.message} url=${currentUrl}`);
          return reject(err);
        }
        const file = createWriteStream(destPath);
        https.get(currentUrl, (res) => {
          // Seguir redirects 3xx
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            unlink(destPath, () => {});
            writeAfipLogLocal(`[DOWNLOAD] Redirect ${res.statusCode} → ${res.headers.location}`);
            return doGet(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            file.close();
            unlink(destPath, () => {});
            const err = new Error(`HTTP ${res.statusCode} al descargar ${path.basename(destPath)}`);
            writeAfipLogLocal(`[DOWNLOAD ERROR] ${err.message} url=${currentUrl}`);
            return reject(err);
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => {
              writeAfipLogLocal(`[DOWNLOAD OK] ${destPath}`);
              resolve({ ok: true });
            });
          });
          file.on('error', (err) => {
            file.close();
            unlink(destPath, () => {});
            writeAfipLogLocal(`[DOWNLOAD ERROR] ${err.message} dest=${destPath}`);
            reject(err);
          });
        }).on('error', (err) => {
          file.close();
          unlink(destPath, () => {});
          writeAfipLogLocal(`[DOWNLOAD ERROR] ${err.message} url=${currentUrl}`);
          reject(err);
        });
      };

      writeAfipLogLocal(`[DOWNLOAD START] ${path.basename(destPath)} → ${destPath}`);
      doGet(url, 0);
    });
  });

  // Abrir selector de archivo del sistema
  ipcMain.handle('facturacion:pick-file', async (_e, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Inicializar cuenta: crea directorio, copia index.mjs del template
  ipcMain.handle('facturacion:init-account', (_e, tipo, cuentaId) => {
    try {
      ensureSharedPkg();
      const accountDir = tipo === 'responsable_inscripto' ? getRIDir() : getMonoDir(cuentaId);
      mkdirSync(path.join(accountDir, 'cert'), { recursive: true });

      const templateDir = path.join(
        getTemplatesDir(),
        tipo === 'responsable_inscripto' ? 'responsable-inscripto' : 'monotributo'
      );
      const srcIndex  = path.join(templateDir, 'index.mjs');
      const destIndex = path.join(accountDir, 'index.mjs');
      if (existsSync(srcIndex)) copyFileSync(srcIndex, destIndex);

      return { ok: true, accountDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Escribir .env en el directorio de la cuenta
  ipcMain.handle('facturacion:write-env', (_e, accountDir, envData) => {
    try {
      writeFileSync(path.join(accountDir, '.env'), buildEnvContent(envData), 'utf-8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Copiar archivo (cert/key/json) al directorio de la cuenta
  ipcMain.handle('facturacion:copy-file', (_e, srcPath, accountDir, destRelative) => {
    try {
      const dest = path.join(accountDir, destRelative);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(srcPath, dest);
      return { ok: true, dest };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Preparar dependencias AFIP:
  // 1. Si ya están en userData (copiadas manualmente o en instalación previa) → OK
  // 2. Si están en resources (instalador antiguo que las bundleaba) → copiar
  // 3. En desarrollo → npm install
  ipcMain.handle('facturacion:install-deps', () => {
    const sendLog = (msg) => mainWindow?.webContents?.send('facturacion:install-log', msg);
    const destModules = path.join(FACTURACION_USER_DIR(), 'node_modules');

    // Ya están en userData → nada que hacer
    if (existsSync(path.join(destModules, 'firebase-admin'))) {
      sendLog('✓ Módulos AFIP ya presentes en AppData');
      return Promise.resolve({ ok: true });
    }

    const srcModules        = path.join(getTemplatesDir(), 'node_modules');
    const downloadedModules = path.join(app.getPath('userData'), 'facturacion-runtime', 'node_modules');
    const activeSrcModules  = existsSync(path.join(srcModules, 'firebase-admin'))        ? srcModules
                            : existsSync(path.join(downloadedModules, 'firebase-admin')) ? downloadedModules
                            : null;

    ensureSharedPkg();

    return new Promise((resolve, reject) => {
      if (activeSrcModules) {
        const srcModules = activeSrcModules;
        // ── Producción: copiar desde resources o runtime descargado ──────────
        sendLog('Copiando módulos AFIP desde el instalador...');
        mkdirSync(destModules, { recursive: true });

        const proc = spawn('robocopy', [
          srcModules, destModules,
          '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP',
        ], { windowsHide: true, shell: false });

        const dots = setInterval(() => sendLog('Copiando...'), 3000);

        const finish = (code) => {
          clearInterval(dots);
          if (code >= 0 && code <= 7) {
            sendLog('✓ Módulos AFIP listos');
            resolve({ ok: true });
          } else {
            sendLog(`robocopy retornó ${code} — usando copia directa...`);
            try {
              cpSync(srcModules, destModules, { recursive: true });
              sendLog('✓ Módulos copiados');
              resolve({ ok: true });
            } catch (e) {
              reject(new Error(`Error al copiar módulos: ${e.message}`));
            }
          }
        };

        proc.on('close', finish);
        proc.on('error', () => {
          clearInterval(dots);
          sendLog('Usando copia directa (robocopy no disponible)...');
          try {
            cpSync(srcModules, destModules, { recursive: true });
            sendLog('✓ Módulos copiados');
            resolve({ ok: true });
          } catch (e) {
            reject(new Error(`Error al copiar módulos: ${e.message}`));
          }
        });

      } else if (isDev) {
        // ── Desarrollo: npm install ──────────────────────────────────────────
        sendLog('[dev] node_modules no en resources — ejecutando npm install...');
        const proc = spawn('npm', ['install', '--omit=dev'], {
          cwd: FACTURACION_USER_DIR(),
          shell: true,
          stdio: 'pipe',
          windowsHide: true,
        });
        proc.stdout?.on('data', d => sendLog(d.toString()));
        proc.stderr?.on('data', d => sendLog(d.toString()));
        proc.on('exit', code => code === 0 ? resolve({ ok: true }) : reject(new Error(`npm exit ${code}`)));
        proc.on('error', reject);
      } else {
        // ── Sin módulos bundleados ni descargados → instalar componentes ─────
        reject(new Error(
          `Módulos AFIP no encontrados.\n` +
          `Instalá los componentes desde:\nConfiguración → Sistema → Instalar componentes necesarios`
        ));
      }
    });
  });

  // Verificar dependencias: node accesible + node_modules en userData
  ipcMain.handle('facturacion:deps-ok', () => {
    const nodeOk    = isDev || getNodeAfipBin() !== null;
    const ud        = app.getPath('userData');
    const modulesOk = existsSync(path.join(FACTURACION_USER_DIR(), 'node_modules', 'firebase-admin')) ||
                      existsSync(path.join(ud, 'facturacion-runtime', 'node_modules', 'firebase-admin'));
    return nodeOk && modulesOk;
  });

  // Verificar que los archivos de cert/SA existen en disco para una cuenta
  ipcMain.handle('facturacion:files-ok', (_e, tipo, cuentaId) => {
    const dir = tipo === 'responsable_inscripto' ? getRIDir() : getMonoDir(cuentaId);
    return (
      existsSync(path.join(dir, '.env')) &&
      existsSync(path.join(dir, 'serviceAccount.json')) &&
      existsSync(path.join(dir, 'cert', 'certificado.crt')) &&
      existsSync(path.join(dir, 'cert', 'clave.key'))
    );
  });

  /**
   * ELIMINAR CUENTA FISCAL (RI o Monotributo) — detiene el proceso si está
   * corriendo (nunca puede quedar facturando una cuenta que ya no existe) y
   * borra solo credenciales/configuración ACTIVA de esa cuenta, nunca
   * historial (ver electron/lib/facturacionAccountDelete.js, con pruebas
   * propias contra filesystem real).
   */
  ipcMain.handle('facturacion:delete-account-files', (_e, tipo, cuentaId) => {
    const key = tipo === 'responsable_inscripto' ? 'ri' : `mono_${cuentaId}`;
    try {
      stopFacturacionProc(key);
      const accountDir = tipo === 'responsable_inscripto' ? getRIDir() : getMonoDir(cuentaId);
      const { removed } = eliminarCredencialesDeCuenta(accountDir);
      console.log(
        `[facturacion] Cuenta eliminada (${tipo}${cuentaId ? '/' + cuentaId : ''}): ` +
        `borrado ${removed.join(', ') || '(nada)'}. Se preservó cualquier factura-*.pdf histórica y ` +
        `cualquier otro archivo no reconocido en ${accountDir}.`
      );
      return { ok: true, removed };
    } catch (e) {
      console.error('[facturacion] Error eliminando archivos de cuenta:', e.message);
      return { ok: false, error: e.message };
    }
  });

  // Versión del Node (bundleado o manual)
  /**
   * ¿Hay algún motor de facturación CORRIENDO en esta PC?
   *
   * El estado ya existía en `facturacionProcs`, pero sólo se EMITÍA por el canal
   * 'facturacion:status' cuando cambiaba: no había forma de consultarlo. La
   * venta de mostrador lo necesita ANTES de ofrecer "imprimir factura", porque
   * si el motor no está levantado la venta se encola y el CAE no llega nunca.
   *
   * Solo lectura: no arranca, no detiene y no toca ningún proceso.
   */
  ipcMain.handle('facturacion:is-running', () => {
    const activas = Object.entries(facturacionProcs)
      .filter(([, entry]) => entry?.status === 'running' && entry?.proc)
      .map(([key]) => key);
    return { running: activas.length > 0, cuentas: activas };
  });

  ipcMain.handle('facturacion:node-version', () => {
    const bin = getNodeAfipBin();
    if (!bin) {
      const userData = app.getPath('userData');
      return {
        ok: false, version: null, bin: null,
        missingPath: path.join(userData, 'node-afip', 'node.exe'),
        hint: `Instalá los componentes desde Configuración → Sistema`,
      };
    }
    try {
      const version = execSync(`"${bin}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
      return { ok: true, version, bin };
    } catch (e) {
      return { ok: false, error: e.message, bin };
    }
  });

  // Obtener directorio de cuenta
  ipcMain.handle('facturacion:account-dir', (_e, tipo, cuentaId) => {
    return tipo === 'responsable_inscripto' ? getRIDir() : getMonoDir(cuentaId);
  });

  // Proceso: iniciar / detener / reiniciar / estado / logs
  //
  // "Iniciar"/"Reiniciar" YA NO arrancan directo: primero intentan la misma
  // transacción de host que usa el ciclo automático. Si el local ya tiene un
  // dueño vigente en OTRA PC, no arranca nada — no hay bypass. El renderer
  // (FacturacionManager.jsx) debe mostrar `motivo:'host-ajeno'` con
  // `hostname`/`leaseRestanteMs` y ofrecer "Tomar control fiscal" en su lugar.
  ipcMain.handle('facturacion:start', async (_e, key, accountDir) => {
    const adquisicion = await intentarAdquirirHostParaAccion(accountDir);
    if (!adquisicion.ok) return adquisicion;
    return { ok: spawnFacturacionProc(key, accountDir) };
  });
  ipcMain.handle('facturacion:stop', (_e, key) => ({ ok: stopFacturacionProc(key) }));
  ipcMain.handle('facturacion:restart', async (_e, key, accountDir) => {
    const dir = accountDir || facturacionProcs[key]?.accountDir;
    const adquisicion = await intentarAdquirirHostParaAccion(dir);
    if (!adquisicion.ok) return adquisicion;
    stopFacturacionProc(key);
    setTimeout(() => spawnFacturacionProc(key, dir), 800);
    return { ok: true };
  });
  ipcMain.handle('facturacion:status', (_e, key) => facturacionProcs[key]?.status ?? 'stopped');
  ipcMain.handle('facturacion:logs', (_e, key) => facturacionProcs[key]?.logs ?? []);

  // "Tomar control fiscal": traslado deliberado del host de un local a ESTA
  // PC. Nunca roba: si hay un dueño vigente, le pide que suelte
  // (FACTURACION_HOST_TRANSFER) y espera a que realmente libere antes de
  // adquirir por la vía normal — ver electron/lib/facturacionHost.js para la
  // garantía de que ningún reductor puede pisar un lease vigente ajeno.
  ipcMain.handle('facturacion:take-control', async (_e, localId) => {
    if (!localId) return { ok: false, motivo: 'sin-local' };
    const cfgPath = getFacturacionConfigPath(localId);
    if (!existsSync(cfgPath)) return { ok: false, motivo: 'sin-config' };
    let config;
    try {
      config = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    } catch (e) {
      return { ok: false, motivo: 'config-invalida', error: e.message };
    }

    const { completo, resultados } = await evaluarCuentasDelLocal(config, localId);
    if (!completo || resultados.length === 0) {
      return { ok: false, motivo: 'runtime-incompleto' };
    }
    const databaseURL = databaseURLDeAccountDir(resultados[0].dir);
    if (!databaseURL) return { ok: false, motivo: 'sin-firebase-db' };

    const intentarYArrancar = async () => {
      const r = await intentarGanarHost(localId, databaseURL);
      if (!r.gane) return r;
      hostFiscalPorLocal[localId] = { activo: true, databaseURL };
      await armarListenerDeTransferencia(localId, databaseURL);
      arrancarCuentasEvaluadas(resultados);
      return r;
    };

    let primerIntento;
    try {
      primerIntento = await intentarYArrancar();
    } catch (e) {
      return { ok: false, motivo: 'firebase-inalcanzable', error: e.message };
    }
    if (primerIntento.gane) return { ok: true, modo: 'directo' };

    // Dueño vigente ajeno: pedirle que suelte, y reintentar la adquisición
    // normal cada TOMA_CONTROL_REINTENTO_MS mientras esperamos su respuesta.
    // B nunca hace nada distinto de lo que ya hace el ciclo automático —
    // sólo reintenta más seguido.
    const db = dbFiscalDe(databaseURL);
    const transferRef = firebaseRef(db, `${localId}/FACTURACION_HOST_TRANSFER`);
    try {
      await setFirebaseValue(transferRef, {
        solicitanteMachineId: MACHINE_ID,
        solicitanteHostname: os.hostname(),
        solicitadoEn: ahoraServidor(databaseURL),
      });
    } catch (e) {
      return { ok: false, motivo: 'no-se-pudo-solicitar', error: e.message };
    }

    const limite = Date.now() + TOMA_CONTROL_TIMEOUT_MS;
    while (Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, TOMA_CONTROL_REINTENTO_MS));
      let intento;
      try {
        intento = await intentarYArrancar();
      } catch {
        continue; // corte transitorio durante la espera: se reintenta en la próxima vuelta
      }
      if (intento.gane) return { ok: true, modo: 'traspaso' };
    }

    // A no respondió a tiempo (apagada, colgada, sin red): NUNCA se salta el
    // lease vigente. El ciclo automático (tickHostFiscal) va a ganar solo en
    // cuanto el lease real venza — mismo failover de siempre, sin atajos.
    return {
      ok: false,
      motivo: 'esperando-liberacion',
      mensaje: 'La otra PC no respondió al pedido de traslado. Se tomará el control automáticamente cuando venza su lease.',
    };
  });

  // Config persistente POR LOCAL (nunca lee el archivo global viejo como fallback).
  ipcMain.handle('facturacion:config:read', () => {
    const localId = getActiveLocalId();
    if (!localId) return null;
    const p = getFacturacionConfigPath(localId);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
  });
  ipcMain.handle('facturacion:config:write', (_e, config) => {
    const localId = getActiveLocalId();
    if (!localId) return false;
    const p = getFacturacionConfigPath(localId);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  });

  // ORDEN MANUAL DE OPCIONALES/SABORES — local por PC, por local y por grupo.
  // NUNCA se escribe a Firebase (ver electron/lib/optionalesOrdenLocal.js).
  // `localId` y `deviceId` los manda el renderer: localId es el mismo que usa
  // el resto de la pantalla (firebase/core.js), deviceId es el mismo id de
  // equipo que ya registra DISPOSITIVOS (deviceIdentity.js) — no se crea otro.
  ipcMain.handle('optionales-orden:read-all', (_e, { localId, deviceId } = {}) => {
    if (!localId || !deviceId) return {};
    const ruta = rutaArchivoOrdenOpcionales(app.getPath('userData'), localId);
    const data = leerArchivoOrdenOpcionales(ruta);
    return obtenerOrdenesDelDispositivo(data, deviceId);
  });
  ipcMain.handle('optionales-orden:write', (_e, { localId, deviceId, groupId, order } = {}) => {
    if (!localId || !deviceId || !groupId) return { ok: false, motivo: 'parametros-invalidos' };
    try {
      const ruta = rutaArchivoOrdenOpcionales(app.getPath('userData'), localId);
      const actual = leerArchivoOrdenOpcionales(ruta);
      escribirArchivoOrdenOpcionales(ruta, conOrdenOpcionalActualizado(actual, deviceId, groupId, order));
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: e.message };
    }
  });
  ipcMain.handle('optionales-orden:write-multiple', (_e, { localId, deviceId, ordersMap } = {}) => {
    if (!localId || !deviceId) return { ok: false, motivo: 'parametros-invalidos' };
    try {
      const ruta = rutaArchivoOrdenOpcionales(app.getPath('userData'), localId);
      const actual = leerArchivoOrdenOpcionales(ruta);
      escribirArchivoOrdenOpcionales(ruta, conOrdenesMultiplesActualizadas(actual, deviceId, ordersMap));
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: e.message };
    }
  });

  // Setea el local activo (para que main lea/escriba facturación de ese local) y frena
  // el motor de facturación del local anterior. Persiste en active-local.json.
  ipcMain.handle('local:set-active', (_e, localId) => {
    const prev = getActiveLocalId();
    const changed = String(localId || '') !== String(prev || '');
    setActiveLocalId(localId);
    console.log(`[LOCAL] Local activo = ${getActiveLocalId()} (cambió=${changed})`);
    if (changed) {
      // Cambiar el local activo en la UI NO toca los motores fiscales: el
      // host fiscal es por local y no depende de qué se está mirando en
      // pantalla (ver tickHostFiscal). Sólo se reinicia el backend de
      // Mercado Pago con la config del local nuevo (Fase 2).
      try {
        stopBackend();
        backendAutoRetried = false;
        setTimeout(() => { if (!backendProcess) startBackend(); }, 700);
      } catch (e) {
        console.error('[LOCAL] error reiniciando backend MP al cambiar de local:', e.message);
      }
    }
    return { ok: true, localId: getActiveLocalId() };
  });

  // Resumen (solo lectura) del facturacion-config.json GLOBAL viejo, para que el
  // renderer decida (con Firebase) si corresponde migrarlo automáticamente al local activo.
  ipcMain.handle('facturacion:global-config-summary', () => {
    const p = path.join(app.getPath('userData'), 'facturacion-config.json');
    if (!existsSync(p)) return { exists: false };
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf-8'));
      const acc = cfg.tipo === 'responsable_inscripto'
        ? (cfg.ri || {})
        : (cfg.monotributo?.cuentas?.[0] || {});
      return {
        exists: true,
        tipo: cfg.tipo || null,
        cuit: acc.cuit || null,
        razonSocial: acc.razonSocial || acc.nombre || null,
        ptoVta: acc.ptoVta || null,
      };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  });

  // Migración AUTOMÁTICA RESPONSABLE del facturacion-config.json + ri/mono globales
  // al local activo. El renderer solo la invoca si verificó coincidencia (mismo CUIT).
  // Reglas: no pisa config local existente; no borra lo global; deja marca; una sola vez.
  ipcMain.handle('facturacion:migrate-global-to-local', (_e, localId, meta = {}) => {
    const userDataPath = app.getPath('userData');
    const targetLocal = String(localId || getActiveLocalId() || '');
    if (!targetLocal) return { ok: false, result: 'no_active_local' };

    const localeDir  = getLocaleFacturacionDir(targetLocal);
    const marker     = path.join(localeDir, '.facturacion-migrated.json');
    const destCfg    = getFacturacionConfigPath(targetLocal);
    const globalCfg  = path.join(userDataPath, 'facturacion-config.json');
    const globalFac  = path.join(userDataPath, 'facturacion');

    const writeMarker = (result, reason, filesCopied = []) => {
      try {
        mkdirSync(localeDir, { recursive: true });
        writeFileSync(marker, JSON.stringify({
          date: new Date().toISOString(), localId: targetLocal, result, reason,
          filesCopied, sourceCuit: meta.cuit || null,
        }, null, 2), 'utf-8');
      } catch { /* la marca es informativa */ }
      console.log(`[MIGRACION FACTURACION] local=${targetLocal} result=${result} reason=${reason || ''}`);
    };

    // 6) Nunca pisar config local existente
    if (existsSync(destCfg)) { writeMarker('already_exists', 'config local ya presente'); return { ok: true, result: 'already_exists' }; }
    // 1) Una sola vez
    if (existsSync(marker)) return { ok: true, result: 'already_attempted' };
    // Nada que migrar
    if (!existsSync(globalCfg)) { writeMarker('skipped', 'no hay config global'); return { ok: true, result: 'no_global' }; }

    try {
      mkdirSync(localeDir, { recursive: true });
      const copied = [];
      copyFileSync(globalCfg, destCfg); copied.push('facturacion-config.json');
      for (const sub of ['ri', 'mono']) {
        const src = path.join(globalFac, sub);
        if (existsSync(src)) { cpSync(src, path.join(localeDir, sub), { recursive: true }); copied.push(`facturacion/${sub}`); }
      }
      // 7) NO borrar lo global (queda como respaldo)
      writeMarker('migrated', 'coincidencia verificada por el renderer', copied);
      return { ok: true, result: 'migrated', filesCopied: copied };
    } catch (e) {
      console.error('[MIGRACION FACTURACION] error:', e.message);
      return { ok: false, result: 'error', error: e.message };
    }
  });

  // ---------------------------------------------------------------------------
  // Health check del sistema completo
  // ---------------------------------------------------------------------------
  ipcMain.handle('app:system-check', () => {
    const userData   = app.getPath('userData');
    const facturDir  = FACTURACION_USER_DIR();
    const riDir      = getRIDir();
    const backendDir = isDev
      ? path.join(__dirname, '..', 'backend')
      : path.join(process.resourcesPath, 'backend');

    const chk = (ok, label, detail = '') => ({ ok: !!ok, label, detail });

    // Leer facturacion-config del LOCAL ACTIVO para saber si RI está inicializado
    let facturCfg = null;
    try {
      const localId = getActiveLocalId();
      const cfgPath = localId ? getFacturacionConfigPath(localId) : null;
      if (cfgPath && existsSync(cfgPath)) facturCfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    } catch {}

    const riInitialized = facturCfg?.ri?.initialized || false;

    // Leer backend.env del LOCAL ACTIVO para saber si tiene MP token
    const _scLocalId = getActiveLocalId();
    const _scEnvPath = _scLocalId ? getBackendEnvPath(_scLocalId) : null;
    let backendVars = {};
    try {
      if (_scEnvPath && existsSync(_scEnvPath)) backendVars = parseEnvFile(_scEnvPath);
    } catch {}
    const hasMpToken  = !!(backendVars.MERCADOPAGO_ACCESS_TOKEN);
    const hasBackendEnv = !!(_scEnvPath && existsSync(_scEnvPath));

    // SA del RI (para poder derivar backend.env)
    const riSaPath = path.join(riDir, 'serviceAccount.json');

    const nodeBin      = getNodeAfipBin();
    const nodeOk       = isDev || nodeBin !== null;
    const nodePath     = nodeBin ?? path.join(userData, 'node-afip', 'node.exe');
    const runtimeMods  = path.join(userData, 'facturacion-runtime', 'node_modules');
    const legacyMods   = path.join(facturDir, 'node_modules');
    const modulesOk    = existsSync(path.join(legacyMods, 'firebase-admin')) ||
                         existsSync(path.join(runtimeMods, 'firebase-admin'));
    const depPackPath  = existsSync(path.join(legacyMods, 'firebase-admin')) ? legacyMods : runtimeMods;

    const result = {
      nodeBundled:   chk(nodeOk,    'Node.js (deps pack)', isDev ? '(dev: sistema)' : nodePath),
      afipModules:   chk(modulesOk, 'Módulos AFIP',        modulesOk ? depPackPath : `FALTA → instalar desde Configuración → Sistema`),
      afipRI: chk(
        riInitialized &&
          existsSync(path.join(riDir, '.env')) &&
          existsSync(path.join(riDir, 'serviceAccount.json')) &&
          existsSync(path.join(riDir, 'cert', 'certificado.crt')),
        'AFIP RI configurado', riDir
      ),
      backendEngine: chk(existsSync(path.join(backendDir, 'src', 'server.js')), 'Engine MP bundleado', backendDir),
      backendEnv:    chk(hasBackendEnv, 'Config MP (backend.env)', _scEnvPath || '(sin local activo)'),
      mpToken:       chk(hasMpToken, 'Token Mercado Pago', hasMpToken ? 'configurado' : 'falta — ingresar en Cuenta MP'),
      // Datos extra para auto-reparación y guía de deps pack
      _meta: {
        riSaExists: existsSync(riSaPath),
        riSaPath,
        hasMpToken,
        hasBackendEnv,
        afipModulesMissing: !modulesOk,
        nodeMissing: !nodeOk,
        riNotInitialized: !riInitialized,
        userData,
        depsPackPaths: {
          nodeExe:     path.join(userData, 'node-afip', 'node.exe'),
          nodeModules: path.join(userData, 'facturacion-runtime', 'node_modules'),
        },
      }
    };

    return result;
  });

  // ---------------------------------------------------------------------------
  // Estado del backend MP — llama a /health en localhost
  // ---------------------------------------------------------------------------
  function localGet(path, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${BACKEND_PORT}${path}`, { timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    });
  }

  ipcMain.handle('mp:backend-health', async () => {
    try {
      const { status, body } = await localGet('/health');
      if (status !== 200) return { ok: false, error: `HTTP ${status}` };
      return { ok: true, ...body };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('mp:recent-payments', async (_e, horas = 6) => {
    try {
      const { status, body } = await localGet(`/debug/mp-recent?horas=${horas}`, 12000);
      if (status !== 200) return { ok: false, error: `HTTP ${status}` };
      return { ok: true, ...body };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Diagnóstico completo del backend (funciona aunque el backend esté caído)
  ipcMain.handle('mp:backend-diag', () => {
    const _diagLocal = getActiveLocalId();
    const envPath    = _diagLocal ? getBackendEnvPath(_diagLocal) : path.join(app.getPath('userData'), 'backend.env');
    const mpAccPath  = _diagLocal ? getMpAccountsPath(_diagLocal) : path.join(app.getPath('userData'), 'mp-accounts.json');
    const entryProd  = app.isPackaged
      ? path.join(process.resourcesPath, 'backend', 'src', 'server.js')
      : path.join(__dirname, '..', 'backend', 'src', 'server.js');

    let envVars = {};
    const envExists = existsSync(envPath);
    if (envExists) { try { envVars = parseEnvFile(envPath); } catch {} }

    let activeAccountName = null;
    let mpTokenFromAccounts = false;
    let localIdFromAccounts = false;
    let rutaPagosFromAccounts = false;
    const mpAccExists = existsSync(mpAccPath);
    if (mpAccExists) {
      try {
        const accounts = JSON.parse(readFileSync(mpAccPath, 'utf-8'));
        const active   = accounts.find(a => a.activo);
        if (active) {
          activeAccountName     = active.nombreCuenta;
          mpTokenFromAccounts   = !!active.accessTokenMercadoPago;
          localIdFromAccounts   = !!active.localId;
          rutaPagosFromAccounts = !!active.firebasePathPagos;
        }
      } catch {}
    }

    const saPath = _diagLocal ? getMpServiceAccountPath(_diagLocal) : path.join(app.getPath('userData'), 'serviceAccountKey.json');
    const saExists = existsSync(saPath);
    let saKeyOk = false;
    if (saExists) {
      try {
        const sa = JSON.parse(readFileSync(saPath, 'utf-8'));
        const k = String(sa.private_key || '').replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').replace(/^["']|["']$/g, '').trim();
        saKeyOk = k.includes('-----BEGIN PRIVATE KEY-----') && k.includes('-----END PRIVATE KEY-----');
      } catch {}
    }

    const hasEnvVarCreds = !!(envVars.FIREBASE_PROJECT_ID && envVars.FIREBASE_CLIENT_EMAIL && envVars.FIREBASE_PRIVATE_KEY);
    const firebaseCredsPresente = hasEnvVarCreds || saExists;

    // Resolver GOOGLE_APPLICATION_CREDENTIALS para mostrar en diagnóstico
    const rawGac = envVars.GOOGLE_APPLICATION_CREDENTIALS || '';
    let gacResolved = '';
    if (rawGac) {
      // Las rutas relativas se resuelven contra el dir por local (ELECTRON_USER_DATA_PATH=baseDir)
      const diagBaseDir = _diagLocal ? getLocaleFacturacionDir(_diagLocal) : app.getPath('userData');
      if (path.isAbsolute(rawGac) && existsSync(rawGac)) gacResolved = rawGac;
      else if (existsSync(path.join(diagBaseDir, rawGac))) gacResolved = path.join(diagBaseDir, rawGac);
    }

    return {
      // Estado del proceso
      backendStatus,
      backendPort:      BACKEND_PORT,
      backendPid:       backendProcess?.pid || null,
      crashFast:        backendCrashFast,
      lastError:        backendLastError,
      lastLog:          backendLastLog,
      // Archivos
      backendEnvExists: envExists,
      backendEnvPath:   envPath,
      backendEntryExists: existsSync(entryProd),
      backendEntryPath:   entryProd,
      mpAccountsExists: mpAccExists,
      serviceAccountExists: saExists,
      serviceAccountKeyOk:  saKeyOk,
      // Credenciales
      tokenPresente:         !!(envVars.MERCADOPAGO_ACCESS_TOKEN || mpTokenFromAccounts),
      localIdPresente:       !!(envVars.LOCAL_ID || localIdFromAccounts),
      firebaseCredsPresente,
      hasEnvVarCreds,
      firebaseDbUrlPresente: !!envVars.FIREBASE_DATABASE_URL,
      firebaseDbUrl:         envVars.FIREBASE_DATABASE_URL || null,
      rutaPagosPresente:     !!(envVars.FIREBASE_PAGOS_PATH || rutaPagosFromAccounts),
      googleAppCredentials:  rawGac || null,
      googleAppCredentialsResolved: gacResolved || null,
      // Info de cuenta activa
      activeAccountName,
      localId:          envVars.LOCAL_ID || null,
      firebaseProject:  envVars.FIREBASE_PROJECT_ID || null,
    };
  });

  // ---------------------------------------------------------------------------
  // Generar backend.env a partir del serviceAccount.json del AFIP RI
  // Solo escribe las claves Firebase — deja MERCADOPAGO_ACCESS_TOKEN vacío
  // ---------------------------------------------------------------------------
  ipcMain.handle('backend:gen-env-from-sa', (_e, mpToken) => {
    const localId = getActiveLocalId();
    if (!localId) return { ok: false, error: 'Sin local activo.' };
    const riSaPath = path.join(getRIDir(localId), 'serviceAccount.json');
    const destPath = getBackendEnvPath(localId);
    mkdirSync(path.dirname(destPath), { recursive: true });

    // Leer service account
    if (!existsSync(riSaPath)) {
      return { ok: false, error: 'serviceAccount.json de AFIP RI no encontrado. Configurar AFIP primero.' };
    }
    let sa;
    try {
      sa = JSON.parse(readFileSync(riSaPath, 'utf-8'));
    } catch (e) {
      return { ok: false, error: 'No se pudo leer serviceAccount.json: ' + e.message };
    }

    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      return { ok: false, error: 'serviceAccount.json incompleto (falta project_id, client_email o private_key).' };
    }

    // Leer backend.env existente para no perder campos ya guardados
    let existing = {};
    try {
      if (existsSync(destPath)) existing = parseEnvFile(destPath);
    } catch {}

    // La private_key tiene newlines reales — en .env deben ser \n literales (una sola línea)
    // Orden: convertir newlines → \n literal, luego escapar comillas internas, envolver en ""
    const privateKey = `"${sa.private_key.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`;
    const dbUrl = existing.FIREBASE_DATABASE_URL
      || `https://${sa.project_id}-default-rtdb.firebaseio.com`;

    const content = [
      `MERCADOPAGO_ACCESS_TOKEN=${mpToken || existing.MERCADOPAGO_ACCESS_TOKEN || ''}`,
      `FIREBASE_PROJECT_ID=${sa.project_id}`,
      `FIREBASE_CLIENT_EMAIL=${sa.client_email}`,
      `FIREBASE_PRIVATE_KEY=${privateKey}`,
      `FIREBASE_DATABASE_URL=${dbUrl}`,
      `LOCAL_ID=${localId || existing.LOCAL_ID || ''}`,
      `PORT=${existing.PORT || '3001'}`,
      `POLL_INTERVAL_MS=${existing.POLL_INTERVAL_MS || '5000'}`,
      `EMAIL_POLL_INTERVAL_MS=${existing.EMAIL_POLL_INTERVAL_MS || '20000'}`,
    ].join('\n') + '\n';

    try {
      writeFileSync(destPath, content, 'utf-8');
      return { ok: true, path: destPath, localId, project: sa.project_id };
    } catch (e) {
      return { ok: false, error: 'Error al escribir backend.env: ' + e.message };
    }
  });

  // ---------------------------------------------------------------------------
  // Leer / guardar token MP en backend.env (sólo el campo del token)
  // ---------------------------------------------------------------------------
  ipcMain.handle('backend:set-mp-token', (_e, token, cfg = {}) => {
    const localId = getActiveLocalId();
    if (!localId) return { ok: false, error: 'Sin local activo.' };
    // Guardar el token Y completar las variables base (DB URL, LOCAL_ID, ruta pagos, credenciales)
    // para que el backend quede listo para arrancar. cfg trae databaseURL/projectId/paymentsPath del local.
    const res = ensureBackendEnv(localId, { ...cfg, token: token || '' });
    if (!res.ok) return res;
    return { ok: true, path: res.path, changes: res.changes, hasDbUrl: res.hasDbUrl };
  });

  // ---------------------------------------------------------------------------
  // Crear/COMPLETAR backend.env del local activo con las variables base (idempotente).
  // El renderer pasa la URL de Firebase del local (core.js) — imprescindible para no
  // crashear con "Can't determine Firebase Database URL".
  // ---------------------------------------------------------------------------
  ipcMain.handle('backend:ensure-env', (_e, cfg = {}) => {
    const localId = getActiveLocalId();
    if (!localId) return { ok: false, error: 'Sin local activo.' };
    const res = ensureBackendEnv(localId, cfg || {});
    // Si acabamos de completar variables base (incluida la URL) y el backend está caído
    // —típico tras un boot que se saltó por falta de FIREBASE_DATABASE_URL— arrancarlo ahora.
    if (res.ok && res.hasDbUrl && res.changes.length && !backendProcess) {
      console.log('[MP ENSURE-ENV] backend.env completado y backend caído → iniciando backend');
      backendAutoRetried = false;
      startBackend();
    }
    return res;
  });

  // ---------------------------------------------------------------------------
  // Reparar MP: normaliza private_key local, crea mp-accounts si falta, reinicia backend
  // ---------------------------------------------------------------------------
  function normalizeSaPrivateKey(key) {
    if (!key) return { normalized: key, repaired: false, ok: false };
    const k = String(key)
      .replace(/\\\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/^"|"$/g, '')
      .trim();
    const ok = k.includes('-----BEGIN PRIVATE KEY-----') && k.includes('-----END PRIVATE KEY-----');
    return { normalized: k, repaired: k !== key, ok };
  }

  ipcMain.handle('mp:repair', async () => {
    const _repairLocal = getActiveLocalId();
    if (!_repairLocal) return { ok: false, error: 'Sin local activo.' };
    const envPath   = getBackendEnvPath(_repairLocal);
    const mpAccPath = getMpAccountsPath(_repairLocal);
    const saPath    = getMpServiceAccountPath(_repairLocal);
    const diagnostics = {};

    // 1. Reparar serviceAccountKey.json si tiene private_key malformada
    if (existsSync(saPath)) {
      try {
        const sa = JSON.parse(readFileSync(saPath, 'utf-8'));
        const { normalized, repaired, ok } = normalizeSaPrivateKey(sa.private_key);
        diagnostics.saKeyOk       = ok;
        diagnostics.saKeyRepaired = repaired;
        if (ok && repaired) {
          sa.private_key = normalized;
          writeFileSync(saPath, JSON.stringify(sa, null, 2), 'utf-8');
          console.log('[MP REPAIR] serviceAccountKey.json: private_key normalizada');
        }
        if (!ok) diagnostics.saKeyError = 'private_key sin BEGIN/END PRIVATE KEY';
      } catch (e) { diagnostics.saError = e.message; }
    }

    // 2. Reparar backend.env si la private_key estaba truncada
    if (existsSync(envPath)) {
      diagnostics.backendEnvRepaired = repairBackendEnvIfNeeded(envPath, saPath);
    }

    // 3. Crear mp-accounts.json si falta pero backend.env tiene token + localId
    if (!existsSync(mpAccPath) && existsSync(envPath)) {
      try {
        const vars = parseEnvFile(envPath);
        if (vars.MERCADOPAGO_ACCESS_TOKEN && vars.LOCAL_ID) {
          const localId = vars.LOCAL_ID;
          const accounts = [{
            nombreCuenta: 'Principal',
            accessTokenMercadoPago: vars.MERCADOPAGO_ACCESS_TOKEN,
            localId,
            firebasePathPagos: vars.FIREBASE_PAGOS_PATH || `${localId}/PAGOS_CONFIRMADOS`,
            activo: true,
          }];
          writeFileSync(mpAccPath, JSON.stringify(accounts, null, 2), 'utf-8');
          diagnostics.mpAccountsCreated = true;
          console.log('[MP REPAIR] mp-accounts.json creado desde backend.env');
        }
      } catch (e) { diagnostics.mpAccError = e.message; }
    }

    // 4. Reiniciar backend
    console.log('[MP REPAIR] reiniciando backend');
    stopBackend();
    backendLastError = null; backendCrashFast = false; backendAutoRetried = false;
    await new Promise(r => setTimeout(r, 900));
    startBackend();
    await new Promise(r => setTimeout(r, 4000));

    const backendOk = !!backendProcess;
    if (!backendOk) {
      const err = backendLastError || 'Backend crasheó. Revisá los logs.';
      console.error('[MP REPAIR] error=', err);
      return { ok: false, diagnostics, backendStarted: false, error: err };
    }
    console.log('[MP REPAIR] backend activo | pid=', backendProcess.pid);
    return { ok: true, diagnostics, backendStarted: true };
  });
  // Impresión térmica desde el renderer
  ipcMain.handle('print-direct', handlePrint);

  // Listar impresoras disponibles
  ipcMain.handle('get-printers', async () => {
    if (!mainWindow) return [];
    try {
      return await mainWindow.webContents.getPrintersAsync();
    } catch {
      return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Componentes descargables desde Firebase Storage
// ---------------------------------------------------------------------------

const STORAGE_BUCKET  = 'achava3703.firebasestorage.app';
const COMPONENTS_PATH = 'instalaciones/componentes';

function getComponentUrl(filename) {
  const encoded = encodeURIComponent(`${COMPONENTS_PATH}/${filename}`);
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media`;
}

function computeSha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function downloadWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(destPath), { recursive: true });
    const doGet = (currentUrl, redirects) => {
      if (redirects > 5) return reject(new Error('Demasiadas redirecciones'));
      const file = createWriteStream(destPath);
      const req  = https.get(currentUrl, { timeout: 300000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close(() => doGet(res.headers.location, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          unlink(destPath, () => {});
          return reject(new Error(`HTTP ${res.statusCode} al descargar ${path.basename(destPath)}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', chunk => {
          received += chunk.length;
          file.write(chunk);
          if (total > 0) onProgress?.(Math.round((received / total) * 100));
        });
        res.on('end',   () => file.close(() => resolve()));
        res.on('error', err => { file.close(); unlink(destPath, () => {}); reject(err); });
      });
      req.on('error',   err => { file.close(); unlink(destPath, () => {}); reject(err); });
      req.on('timeout', ()  => { req.destroy(); file.close(); unlink(destPath, () => {}); reject(new Error('Timeout de red')); });
    };
    doGet(url, 0);
  });
}

function extractZipPS(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ], { windowsHide: true });
    let stderr = '';
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Expand-Archive falló (${code}): ${stderr.trim()}`)));
    proc.on('error', reject);
  });
}

function checkComponentsState() {
  const userData    = app.getPath('userData');
  const nodeAfipBin = path.join(userData, 'node-afip', 'node.exe');
  const opensslBin  = path.join(userData, 'tools', 'openssl', 'openssl.exe');
  const runtimeMods = path.join(userData, 'facturacion-runtime', 'node_modules', 'firebase-admin');
  const runtimeRI   = path.join(userData, 'facturacion-runtime', 'responsable-inscripto', 'index.mjs');
  const runtimeMono = path.join(userData, 'facturacion-runtime', 'monotributo', 'index.mjs');

  let nodeAfipVersion = null;
  let nodeAfipOk      = false;
  if (existsSync(nodeAfipBin)) {
    try {
      const v = execSync(`"${nodeAfipBin}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
      nodeAfipOk      = /^v16\./.test(v);
      nodeAfipVersion = v;
    } catch {}
  }

  let opensslVersion = null;
  const opensslOk = existsSync(opensslBin);
  if (opensslOk) {
    try {
      opensslVersion = execSync(`"${opensslBin}" version`, { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {}
  }

  const facturacionRuntime = existsSync(runtimeMods) && existsSync(runtimeRI) && existsSync(runtimeMono);

  return {
    nodeAfip:          { ok: nodeAfipOk,        version: nodeAfipVersion, path: nodeAfipBin },
    openssl:           { ok: opensslOk,          version: opensslVersion,  path: opensslBin  },
    facturacionRuntime:{ ok: facturacionRuntime, path: path.join(userData, 'facturacion-runtime') },
  };
}

ipcMain.handle('components:check', () => checkComponentsState());

// Dependencias de facturación requeridas (deben estar TODAS para facturar).
const REQUIRED_COMPONENTS = ['nodeAfip', 'openssl', 'facturacionRuntime'];

function requiredComponentsMissing(state) {
  return REQUIRED_COMPONENTS.filter((k) => !state?.[k]?.ok);
}

// Descarga e instala componentes desde Firebase Storage (instalaciones/componentes).
// Helper compartido por el instalador manual (components:install) y el bootstrap
// automático (components:bootstrap). NO duplica lógica de descarga.
async function installComponents(componentKeys, sendProg = () => {}) {
  const userData = app.getPath('userData');
  const tempDir  = path.join(app.getPath('temp'), 'dlvsistema-components');
  mkdirSync(tempDir, { recursive: true });

  // 1. Descargar manifest
  sendProg({ step: 'manifest', msg: 'Descargando manifest…' });
  const manifestPath = path.join(tempDir, 'manifest.json');
  try {
    await downloadWithProgress(getComponentUrl('manifest.json'), manifestPath, () => {});
  } catch (e) {
    return { ok: false, error: `No se pudo descargar el manifest: ${e.message}`, errors: [e.message] };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    return { ok: false, error: `manifest.json inválido: ${e.message}`, errors: [e.message] };
  }

  const destDirMap = {
    nodeAfip:           path.join(userData, 'node-afip'),
    openssl:            path.join(userData, 'tools', 'openssl'),
    facturacionRuntime: path.join(userData, 'facturacion-runtime'),
  };

  const keys = (componentKeys && componentKeys.length > 0)
    ? componentKeys
    : Object.keys(manifest.components);

  const errors = [];

  for (const key of keys) {
    const comp = manifest.components[key];
    if (!comp) { errors.push(`Componente desconocido: ${key}`); continue; }

    const zipPath    = path.join(tempDir, comp.file);
    const extractDir = path.join(tempDir, `extract-${key}`);
    const destDir    = destDirMap[key];

    try {
      // Descargar
      sendProg({ step: 'download', component: key, label: comp.label, pct: 0 });
      await downloadWithProgress(getComponentUrl(comp.file), zipPath, (pct) =>
        sendProg({ step: 'download', component: key, label: comp.label, pct })
      );
      sendProg({ step: 'download', component: key, label: comp.label, pct: 100 });

      // Validar SHA256
      sendProg({ step: 'validate', component: key, label: comp.label });
      const actual = await computeSha256File(zipPath);
      if (comp.sha256 && actual.toLowerCase() !== comp.sha256.toLowerCase()) {
        unlinkSync(zipPath);
        throw new Error(`SHA256 no coincide. Descarga corrupta — intentá de nuevo.`);
      }

      // Extraer a carpeta temporal
      sendProg({ step: 'extract', component: key, label: comp.label });
      rmSync(extractDir, { recursive: true, force: true });
      await extractZipPS(zipPath, extractDir);

      // Mover a destino final (no pisa archivos del local — solo sobrescribe runtime)
      sendProg({ step: 'install', component: key, label: comp.label });
      mkdirSync(destDir, { recursive: true });
      cpSync(extractDir, destDir, { recursive: true });

      sendProg({ step: 'done', component: key, label: comp.label });
      console.log(`[components] ${key} instalado en: ${destDir}`);

    } catch (err) {
      errors.push(`${comp.label}: ${err.message}`);
      console.error(`[components] error instalando ${key}:`, err.message);
      sendProg({ step: 'error', component: key, label: comp.label, error: err.message });
    } finally {
      try { unlinkSync(zipPath);                            } catch {}
      try { rmSync(extractDir, { recursive: true, force: true }); } catch {}
    }
  }

  // Limpiar manifest temporal
  try { unlinkSync(manifestPath); } catch {}

  // VCRUNTIME140.dll: el OpenSSL recién instalado/actualizado puede necesitar
  // el runtime de Visual C++ para arrancar (PC nueva sin otro software que lo
  // trajera). Se verifica ejecutando `openssl version` de verdad — si ya
  // funciona no se instala nada; si no, se instala el redistribuible oficial
  // YA incluido con la app (nunca se descarga). Ver electron/lib/vcRedist.js.
  if (keys.includes('openssl')) {
    const opensslExePath = path.join(destDirMap.openssl, 'openssl.exe');
    const vc = asegurarVcRedistSiHaceFalta({
      opensslExePath,
      vcRedistExePath: vcRedistResourcePath(),
      log: (msg) => console.log(`[components] [vcredist] ${msg}`),
    });
    if (!vc.ok) {
      errors.push(`Runtime de Visual C++: ${vc.motivo || 'OpenSSL no pudo arrancar'}`);
    }
  }

  const state = checkComponentsState();
  return { ok: errors.length === 0, errors, state };
}

// Instalación MANUAL (SystemHealthPanel → clave DiegoL). Se mantiene como respaldo.
ipcMain.handle('components:install', async (_e, componentKeys) => {
  const sendProg = (payload) => mainWindow?.webContents?.send('components:progress', payload);
  return installComponents(componentKeys, sendProg);
});

// Bootstrap AUTOMÁTICO de dependencias de facturación (primer inicio en PC nueva).
// Chequeo LOCAL por PC. Solo descarga si falta algo. No pide clave. Idempotente.
// No escribe NADA global en Firebase (solo lee componentes de Storage e instala en userData).
let bootstrapPromise = null;              // guardia anti-concurrencia dentro de esta instancia
const LOCK_STALE_MS = 10 * 60 * 1000;     // un lock más viejo que esto se considera abandonado
const bootstrapLockPath = () => path.join(app.getPath('userData'), 'deps-bootstrap.lock');

function bootstrapLockFresh() {
  try {
    const j = JSON.parse(readFileSync(bootstrapLockPath(), 'utf-8'));
    return j && typeof j.ts === 'number' && (Date.now() - j.ts) < LOCK_STALE_MS;
  } catch { return false; }
}

// Verificación + instalación real. La marca deps-bootstrap.json es SOLO informativa:
// nunca reemplaza la verificación real de archivos (checkComponentsState siempre corre).
async function runBootstrap() {
  const userData = app.getPath('userData');
  const state = checkComponentsState();
  const missing = requiredComponentsMissing(state);

  console.log('[BOOTSTRAP] Verificando dependencias de facturación...');
  console.log(`[BOOTSTRAP]   userData: ${userData}`);
  console.log(`[BOOTSTRAP]   node-afip:           ${state.nodeAfip.ok ? 'OK' : 'FALTA'} (${state.nodeAfip.version || 'no encontrado'}) → ${state.nodeAfip.path}`);
  console.log(`[BOOTSTRAP]   openssl:             ${state.openssl.ok ? 'OK' : 'FALTA'} (${state.openssl.version || 'no encontrado'}) → ${state.openssl.path}`);
  console.log(`[BOOTSTRAP]   facturacion-runtime: ${state.facturacionRuntime.ok ? 'OK' : 'FALTA'} → ${state.facturacionRuntime.path}`);

  if (missing.length === 0) {
    console.log('[BOOTSTRAP] Todas las dependencias presentes. Inicio normal.');
    return { ok: true, alreadyInstalled: true, missing: [], state };
  }

  // Anti-concurrencia entre procesos (abrir/cerrar rápido → 2 instancias).
  if (bootstrapLockFresh()) {
    console.warn('[BOOTSTRAP] Otra instancia ya está instalando dependencias (lock activo). Se evita la ejecución en paralelo.');
    return { ok: false, busy: true, missing, state };
  }

  try {
    writeFileSync(bootstrapLockPath(), JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf-8');
  } catch { /* si no se puede escribir el lock igual seguimos, el singleton en-proceso ya protege */ }

  try {
    console.log(`[BOOTSTRAP] Faltan dependencias: ${missing.join(', ')}. Descargando desde Firebase (instalaciones/componentes)...`);
    const sendProg = (payload) => mainWindow?.webContents?.send('components:progress', payload);
    const result = await installComponents(missing, sendProg);

    const state2   = checkComponentsState();
    const missing2 = requiredComponentsMissing(state2);

    if (missing2.length === 0) {
      // Marca informativa de instalación exitosa (NO reemplaza la verificación real).
      try {
        writeFileSync(
          path.join(userData, 'deps-bootstrap.json'),
          JSON.stringify({ installedAt: new Date().toISOString(), appVersion: app.getVersion() }, null, 2),
          'utf-8'
        );
      } catch { /* la marca es informativa */ }
      global.__facturacionDepsReady = true;
      console.log('[BOOTSTRAP] Instalación correcta. Dependencias de facturación completas.');
      return { ok: true, installed: true, missing: [], state: state2 };
    }

    console.error(`[BOOTSTRAP] Instalación INCOMPLETA. Todavía faltan: ${missing2.join(', ')}. No se marca como OK.`);
    if (result.errors?.length) console.error(`[BOOTSTRAP]   detalle: ${result.errors.join(' | ')}`);
    return { ok: false, installed: true, missing: missing2, errors: result.errors || [result.error].filter(Boolean), state: state2 };
  } finally {
    try { unlinkSync(bootstrapLockPath()); } catch { /* noop */ }
  }
}

ipcMain.handle('components:bootstrap', async () => {
  // En desarrollo se saltea (dev usa node del sistema y otro userData).
  if (isDev) {
    console.log('[BOOTSTRAP] modo dev — se saltea verificación de dependencias.');
    return { ok: true, alreadyInstalled: true, missing: [], skipped: 'dev' };
  }
  // Singleton en-proceso: si ya hay un bootstrap corriendo en ESTA instancia, se reutiliza.
  if (bootstrapPromise) {
    console.log('[BOOTSTRAP] Ya hay un bootstrap en curso en esta instancia. Se reutiliza la ejecución.');
    return bootstrapPromise;
  }
  bootstrapPromise = runBootstrap().finally(() => { bootstrapPromise = null; });
  return bootstrapPromise;
});

// El usuario eligió "Continuar sin facturación": entra al sistema pero la facturación
// NO queda preparada. Se deja constancia clara en logs y en un flag interno.
ipcMain.handle('components:mark-not-ready', () => {
  global.__facturacionDepsReady = false;
  console.warn('[BOOTSTRAP] El usuario eligió CONTINUAR SIN facturación. Las dependencias NO están instaladas en esta PC; la facturación automática no funcionará hasta instalarlas (reintentar el bootstrap, o Configuración → Sistema con clave).');
  return { ok: true };
});

// Reinicio controlado tras instalar dependencias. Marca el arranque con
// --deps-bootstrapped para que el renderer NO vuelva a reiniciar (anti-loop).
ipcMain.handle('app:relaunch', () => {
  console.log('[BOOTSTRAP] Reiniciando la aplicación tras instalar dependencias...');
  app.relaunch({ args: ['--deps-bootstrapped'] });
  app.exit(0);
});

// Cierre real de la aplicación pedido por el renderer.
//
// Lo usa el botón SALIR de la pantalla de bloqueo por comisión impaga: ahí
// "salir" tiene que dejar la aplicación cerrada, no devolver al login con la
// ventana abierta.
//
// Mismo patrón que `app:relaunch` de acá arriba: el renderer no cierra nada por
// su cuenta (window.close() no termina el proceso), se lo pide al proceso
// principal. `app.quit()` en vez de `app.exit()` para que corran los handlers de
// `before-quit`, que detienen el backend de Mercado Pago y los procesos de
// facturación.
ipcMain.handle('app:quit', () => {
  console.log('[APP] Cierre solicitado por el renderer.');
  app.quit();
});

// Flags del arranque (para que el renderer sepa si viene de un reinicio post-instalación).
ipcMain.handle('app:boot-flags', () => ({
  depsBootstrapped: process.argv.includes('--deps-bootstrapped'),
}));

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Segunda instancia: no inicializa NADA. `app.quit()` ya se llamó arriba, pero
  // este corte lo hace determinista — sin él, una carrera entre el quit y el
  // ready podría llegar a levantar backend, listeners o el motor de facturación
  // por duplicado, o a mostrar la configuración inicial.
  if (!gotTheLock) {
    console.log('[APP] Segunda instancia: no se inicializa ningún servicio.');
    return;
  }

  // Quitar el menú nativo de Electron (File, Edit, View, Window, Help)
  initMachineId();
  Menu.setApplicationMenu(null);
  setupIPC();
  setupImageCacheIPC();

  // node_modules compartido del motor de facturación: se asegura acá TAMBIÉN
  // (no solo dentro de spawnFacturacionProc) para que quede listo desde el
  // arranque, sin esperar al primer intento de facturar, y para que el log
  // "[Facturación Runtime] ..." aparezca siempre en cada inicio de la app —
  // útil para diagnosticar instalaciones existentes como la de Joao. Barata
  // e idempotente: no rompe el arranque si el runtime todavía no existe.
  ensureFacturacionNodeModulesLink({
    facturacionDir: FACTURACION_USER_DIR(),
    runtimeModulesDir: path.join(app.getPath('userData'), 'facturacion-runtime', 'node_modules'),
  });
  verificarPaquetesResolubles(FACTURACION_USER_DIR())
    .then((r) => {
      if (r.ok) console.log('[Facturación Runtime] Dependencias verificadas: dotenv, firebase-admin, moment, pdfkit, qrcode, soap — todas resuelven.');
      else console.error(`[Facturación Runtime] ERROR preparando dependencias: no resuelven → ${r.faltantes.join(', ')}`);
    })
    .catch((e) => console.error(`[Facturación Runtime] ERROR preparando dependencias: ${e.message}`));
  // Reparar backend.env (del local activo) con private_key malformada ANTES de iniciar el backend
  const _bootLocal = getActiveLocalId();
  if (_bootLocal) {
    const _envPath  = getBackendEnvPath(_bootLocal);
    const _riSaPath = path.join(getRIDir(_bootLocal), 'serviceAccount.json');
    if (existsSync(_envPath)) repairBackendEnvIfNeeded(_envPath, _riSaPath);
  }
  startBackend();
  createWindow();
  // El chequeo de actualizaciones ahora ocurre UNA sola vez antes del login,
  // a pedido del renderer vía IPC 'check-updates-now' (ver PreLoginUpdateCheck en App.jsx).
  // Se eliminó el setTimeout(checkForUpdates, 15000) para evitar un segundo aviso duplicado.
  // ARRANQUE CON WINDOWS, POR DEFECTO.
  //
  // Antes dependía de que alguien encendiera "Auto Start" a mano, así que una PC
  // recién instalada no se abría sola y por lo tanto tampoco facturaba. Ahora se
  // habilita solo, una única vez: si después alguien lo apaga a propósito, queda
  // apagado (se registra la marca y no se vuelve a forzar).
  //
  // OJO: esto es INDEPENDIENTE del switch de facturación. Apagar la facturación
  // en una PC NO le saca el arranque con Windows: la app sigue sirviendo para
  // vender, sólo queda detenido el motor fiscal.
  try {
    const marca = path.join(app.getPath('userData'), 'autostart-windows-aplicado.json');
    if (!existsSync(marca)) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
      writeFileSync(marca, JSON.stringify({ aplicadoAt: Date.now(), version: app.getVersion() }, null, 2), 'utf-8');
      console.log('[Facturación automática] Arranque con Windows habilitado por defecto en esta PC.');
    }
  } catch (e) {
    console.error('[Facturación automática] no se pudo configurar el arranque con Windows:', e.message);
  }

  // Arranque inicial a los 8s (tiempo para que la ventana y el resto del
  // arranque asienten), y de ahí en más un ciclo cada HEARTBEAT_INTERVALO_MS:
  // ese mismo ciclo ES el heartbeat de los locales ya ganados y ES la
  // reconexión automática de los que no calificaron en un tick anterior.
  setTimeout(() => {
    tickHostFiscal();
    setInterval(tickHostFiscal, HEARTBEAT_INTERVALO_MS);
  }, 8000);

  // Retry de arranque del backend MP + creación de mp-accounts.json si falta (por local)
  setTimeout(() => {
    const _retryLocal = getActiveLocalId();
    if (!_retryLocal) return;
    const envPath   = getBackendEnvPath(_retryLocal);
    const mpAccPath = getMpAccountsPath(_retryLocal);
    let envVars = {};
    try { if (existsSync(envPath)) envVars = parseEnvFile(envPath); } catch {}
    const hasFirebaseCreds = !!(envVars.FIREBASE_PROJECT_ID && envVars.FIREBASE_CLIENT_EMAIL && envVars.FIREBASE_PRIVATE_KEY);
    const mpToken = envVars.MERCADOPAGO_ACCESS_TOKEN || '';
    const localId = envVars.LOCAL_ID || '';

    // Crear mp-accounts.json si falta pero backend.env tiene token + localId
    if (!existsSync(mpAccPath) && mpToken && localId) {
      try {
        const accounts = [{
          nombreCuenta: 'Principal',
          accessTokenMercadoPago: mpToken,
          localId,
          firebasePathPagos: envVars.FIREBASE_PAGOS_PATH || `${localId}/PAGOS_CONFIRMADOS`,
          activo: true,
        }];
        writeFileSync(mpAccPath, JSON.stringify(accounts, null, 2), 'utf-8');
        console.log('[MP BACKEND START] mp-accounts.json creado automáticamente desde backend.env');
      } catch (e) {
        console.error('[MP BACKEND START] error al crear mp-accounts.json:', e.message);
      }
    }

    // Retry si el backend no arrancó pero tiene config válida y no crasheó
    if (!backendProcess && !backendCrashFast && !backendAutoRetried && hasFirebaseCreds && mpToken) {
      console.log('[MP BACKEND START] retry: backend detenido con config válida → reiniciando...');
      backendAutoRetried = true;
      startBackend();
    }
  }, 10000);

  // Shortcut temporal de diagnóstico: Ctrl+Shift+I abre DevTools
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.webContents.toggleDevTools();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Cierre normal: intento best-effort de soltar el host fiscal de cada local
// que esta PC tuviera ganado, para que el failover a otra PC sea inmediato en
// vez de esperar `LEASE_MS`. Es una OPTIMIZACIÓN, no una dependencia de
// corrección: si no llega a completarse (se corta la luz, se mata el
// proceso), el `leaseUntil` ya escrito vence solo y cualquier PC candidata lo
// toma en el siguiente tick después de esa expiración — sin `onDisconnect` de
// por medio (descartado deliberadamente, ver electron/lib/facturacionHost.js).
let cierreLiberandoHosts = false;
app.on('before-quit', (event) => {
  if (cierreLiberandoHosts) return; // ya se intentó soltar; dejar salir esta vez
  cierreLiberandoHosts = true;
  event.preventDefault();

  const localesHosteados = Object.entries(hostFiscalPorLocal)
    .filter(([, v]) => v?.activo)
    .map(([localId, v]) => ({ localId, databaseURL: v.databaseURL }));

  const liberaciones = localesHosteados.map(({ localId, databaseURL }) => liberarHostDelLocal(localId, databaseURL));
  const tope = new Promise((resolve) => setTimeout(resolve, 2000));

  Promise.race([Promise.allSettled(liberaciones), tope]).finally(() => {
    stopBackend();
    stopAllFacturacion();
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
