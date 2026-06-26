'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, utilityProcess, Menu, globalShortcut } = require('electron');

// Permite que speechSynthesis y audio funcionen sin gesto de usuario al arranque.
// Necesario para anunciar pagos pendientes al iniciar la app (Firebase listener + seenIds vacío).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('path');
const os = require('os');
const { randomUUID, createHash } = require('crypto');
const { spawn, execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync, appendFileSync, createWriteStream, createReadStream, unlink, unlinkSync, mkdirSync, copyFileSync, cpSync, rmSync } = require('fs');
const https = require('https');
const http  = require('http');

const isDev = !app.isPackaged;
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

const FACTURACION_USER_DIR = () => path.join(app.getPath('userData'), 'facturacion');

function getTemplatesDir() {
  if (isDev) return path.join(__dirname, '..', 'resources', 'facturacion');
  const resourcesDir = path.join(process.resourcesPath, 'facturacion');
  if (existsSync(path.join(resourcesDir, 'responsable-inscripto', 'index.mjs'))) return resourcesDir;
  return path.join(app.getPath('userData'), 'facturacion-runtime');
}

function getOpensslDir() {
  if (isDev) return path.join(__dirname, '..', 'resources', 'openssl');
  const resourcesOpenssl = path.join(process.resourcesPath, 'openssl');
  if (existsSync(path.join(resourcesOpenssl, 'openssl.exe'))) return resourcesOpenssl;
  const userDataOpenssl = path.join(app.getPath('userData'), 'tools', 'openssl');
  if (existsSync(path.join(userDataOpenssl, 'openssl.exe'))) return userDataOpenssl;
  return null;
}

function getRIDir() {
  return path.join(FACTURACION_USER_DIR(), 'ri');
}

function getMonoDir(cuentaId) {
  return path.join(FACTURACION_USER_DIR(), 'mono', cuentaId);
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

function autoStartFacturacion() {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'facturacion-config.json');
    if (!existsSync(cfgPath)) {
      console.log('[AFIP AUTOSTART] no existe facturacion-config.json, saltando');
      return;
    }
    const config = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    // El autostart se controla por ri.activo / cuenta.activo (switch por cuenta).
    // El flag global config.autoStart ya NO es requerido para no confundir al usuario.
    console.log(`[AFIP AUTOSTART] config loaded tipo=${config.tipo} autoStart=${config.autoStart}`);

    const certFilesOk = (dir) =>
      existsSync(path.join(dir, 'serviceAccount.json')) &&
      existsSync(path.join(dir, 'cert', 'certificado.crt')) &&
      existsSync(path.join(dir, 'cert', 'clave.key'));

    if (config.tipo === 'responsable_inscripto') {
      const ri = config.ri || {};
      const riDir = getRIDir();
      const filesOk = certFilesOk(riDir);
      console.log(`[AFIP AUTOSTART] RI: initialized=${ri.initialized} activo=${ri.activo} filesOk=${filesOk}`);
      if (ri.initialized && ri.activo && filesOk) {
        console.log('[AFIP AUTOSTART] calling spawnFacturacionProc(ri)');
        const ok = spawnFacturacionProc('ri', riDir);
        console.log(`[AFIP AUTOSTART] process started ok=${ok}`);
      } else if (ri.activo && !filesOk) {
        console.log('[AFIP AUTOSTART] archivos faltantes — renderer hará rebuild automático antes de iniciar');
      }
    } else if (config.tipo === 'monotributo') {
      (config.monotributo?.cuentas || []).forEach(c => {
        const dir = getMonoDir(c.id);
        const filesOk = certFilesOk(dir);
        console.log(`[AFIP AUTOSTART] Mono ${c.id}: initialized=${c.initialized} activo=${c.activo} filesOk=${filesOk}`);
        if (c.initialized && c.activo && filesOk) {
          console.log(`[AFIP AUTOSTART] calling spawnFacturacionProc(mono_${c.id})`);
          const ok = spawnFacturacionProc(`mono_${c.id}`, dir);
          console.log(`[AFIP AUTOSTART] process started ok=${ok}`);
        }
      });
    }
  } catch (e) {
    console.error('[AFIP AUTOSTART] process failed:', e.message);
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
  const userDataPath = app.getPath('userData');
  const prodEnvPath = path.join(userDataPath, 'backend.env');

  if (existsSync(prodEnvPath)) {
    console.log('[main] backend.env desde userData:', prodEnvPath);
    return { vars: parseEnvFile(prodEnvPath), source: prodEnvPath };
  }

  if (isDev) {
    const devEnvPath = path.join(__dirname, '..', 'backend', '.env');
    if (existsSync(devEnvPath)) {
      console.log('[main] backend.env (dev):', devEnvPath);
      return { vars: parseEnvFile(devEnvPath), source: devEnvPath };
    }
  }

  console.warn('[main] backend.env no encontrado en:', prodEnvPath);
  return { vars: {}, source: null };
}

// ---------------------------------------------------------------------------
// Resolver GOOGLE_APPLICATION_CREDENTIALS a ruta absoluta
// Busca en userData, luego en ubicaciones de AFIP, y copia a userData si es necesario
// ---------------------------------------------------------------------------
function resolveCredentialsPath(vars, userDataPath) {
  const defaultPath = path.join(userDataPath, 'serviceAccountKey.json');
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
    return resolveCredentialsFallback(userDataPath, defaultPath);
  }

  // 2. Ya es absoluta y existe → usar directamente
  if (path.isAbsolute(raw) && existsSync(raw)) {
    console.log(`[MP SERVICE ACCOUNT] ruta resuelta=${raw}`);
    console.log('[MP SERVICE ACCOUNT] existe en userData=true');
    return raw;
  }

  // 3. Es relativa → resolver contra userData
  const fromUserData = path.join(userDataPath, raw);
  console.log(`[MP SERVICE ACCOUNT] ruta resuelta=${fromUserData}`);
  if (existsSync(fromUserData)) {
    console.log('[MP SERVICE ACCOUNT] existe en userData=true');
    return fromUserData;
  }

  console.log('[MP SERVICE ACCOUNT] existe en userData=false');
  console.log('[MP SERVICE ACCOUNT] buscando fallback...');
  return resolveCredentialsFallback(userDataPath, defaultPath);
}

// Busca serviceAccount en ubicaciones conocidas de AFIP y copia a userData/serviceAccountKey.json
function resolveCredentialsFallback(userDataPath, destPath) {
  const facturBase = path.join(userDataPath, 'facturacion');
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
  const userDataPath = app.getPath('userData');
  const { vars, source: envSource } = loadBackendEnv();

  // Avisar si falta config (no bloqueante)
  const missingFirebase =
    !vars.FIREBASE_PROJECT_ID &&
    !vars.GOOGLE_APPLICATION_CREDENTIALS &&
    !existsSync(path.join(userDataPath, 'serviceAccountKey.json'));

  if (!envSource) {
    // Solo log — el panel de salud en la UI muestra el estado y permite configurar
    console.warn('[main] backend.env no encontrado. El SystemHealthPanel ofrecerá auto-generarlo.');
  } else if (missingFirebase) {
    console.warn('[main] ADVERTENCIA: credenciales de Firebase no encontradas en backend.env.');
  }

  if (!vars.MERCADOPAGO_ACCESS_TOKEN) {
    console.warn('[main] ADVERTENCIA: MERCADOPAGO_ACCESS_TOKEN no configurado.');
  }

  const resolvedCredentials = resolveCredentialsPath(vars, userDataPath);

  const env = {
    ...process.env,
    ...vars,
    PORT: vars.PORT || String(BACKEND_PORT),
    DOTENV_CONFIG_PATH: envSource || '',
    ELECTRON_USER_DATA_PATH: userDataPath,
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
  const accountsFilePath = path.join(userDataPath, 'mp-accounts.json');
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
// Chequeo de actualizaciones (GitHub API)
// ---------------------------------------------------------------------------
function checkForUpdates() {
  if (isDev) return;
  const OWNER = 'tu-usuario-github';
  const REPO = 'recepcion-de-pedidos-desktop';
  const currentVersion = app.getVersion();

  https
    .get(
      {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        headers: { 'User-Agent': 'recepcion-de-pedidos-desktop' },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const latest = (release.tag_name || '').replace(/^v/, '');
            if (latest && latest !== currentVersion) {
              const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'info',
                title: 'Actualización disponible',
                message: `Nueva versión: v${latest}`,
                detail: `Instalada: v${currentVersion}. ¿Querés descargarla?`,
                buttons: ['Descargar', 'Ahora no'],
                defaultId: 0,
              });
              if (choice === 0 && release.html_url) shell.openExternal(release.html_url);
            }
          } catch { /* silencioso */ }
        });
      }
    )
    .on('error', () => { /* sin red — silencioso */ });
}

// ---------------------------------------------------------------------------
// Ventana principal
// ---------------------------------------------------------------------------
function createWindow() {
  // Ruta al ícono: en producción está en resources/, en dev en build/
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico');
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

  // Descarga el instalador con progreso real y lo ejecuta en modo silencioso (/S)
  ipcMain.handle('download-and-install', (_e, downloadUrl, fileName) => {
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
            file.close(() => {
              sendProgress(100);
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
    const userDataPath = app.getPath('userData');
    const accountsPath = path.join(userDataPath, 'mp-accounts.json');
    if (!existsSync(accountsPath)) return [];
    try {
      return JSON.parse(readFileSync(accountsPath, 'utf-8'));
    } catch {
      return [];
    }
  });

  ipcMain.handle('mp-accounts:write', (_e, accounts) => {
    const userDataPath = app.getPath('userData');
    const accountsPath = path.join(userDataPath, 'mp-accounts.json');
    writeFileSync(accountsPath, JSON.stringify(accounts, null, 2), 'utf-8');
    console.log(`[mp-config] cuentas guardadas: ${accounts.length}`);
    return true;
  });

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

    // 2. Borrar archivos de configuración local
    console.log('[LOCAL NUEVO] Borrando configuración local...');
    const filesToDelete = [
      'mp-accounts.json',
      'backend.env',
      'serviceAccountKey.json',
      'facturacion-config.json',
    ];
    for (const file of filesToDelete) {
      const p = path.join(userDataPath, file);
      try {
        if (existsSync(p)) { rmSync(p, { force: true }); console.log(`[LOCAL NUEVO] Borrado: ${file}`); }
      } catch (e) { console.error(`[LOCAL NUEVO] Error borrando ${file}:`, e.message); }
    }

    // 3. Borrar carpetas de facturación del local anterior (ri, mono)
    //    Se conserva facturacion/node_modules para no requerir re-instalación
    const facDir = path.join(userDataPath, 'facturacion');
    for (const sub of ['ri', 'mono']) {
      const p = path.join(facDir, sub);
      try {
        if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log(`[LOCAL NUEVO] Borrado directorio: facturacion/${sub}`); }
      } catch (e) { console.error(`[LOCAL NUEVO] Error borrando facturacion/${sub}:`, e.message); }
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

    const files = {
      env:            chk(envPath),
      indexMjs:       chk(path.join(accountDir, 'index.mjs')),
      serviceAccount: chk(path.join(accountDir, 'serviceAccount.json')),
      cert:           chk(path.join(accountDir, 'cert', 'certificado.crt')),
      key:            chk(path.join(accountDir, 'cert', 'clave.key')),
      nodeModules:    chk(path.join(facturDir, 'node_modules', 'firebase-admin')),
    };

    const diag = {
      timestamp: new Date().toISOString(),
      userData, facturDir, accountDir, logPath,
      files,
      gcpRaw, gcpAbsolute,
      gcpExists: gcpAbsolute ? existsSync(gcpAbsolute) : false,
    };

    // Escribir al archivo de log
    const lines = [
      `\n=== Diagnóstico AFIP [${diag.timestamp}] ===`,
      `userData:    ${userData}`,
      `accountDir:  ${accountDir}`,
      ``,
      `ARCHIVOS:`,
      `  .env             ${files.env.exists             ? 'OK    ' : 'FALTA '} ${files.env.path}`,
      `  index.mjs        ${files.indexMjs.exists         ? 'OK    ' : 'FALTA '} ${files.indexMjs.path}`,
      `  serviceAccount   ${files.serviceAccount.exists   ? 'OK    ' : 'FALTA '} ${files.serviceAccount.path}`,
      `  certificado.crt  ${files.cert.exists             ? 'OK    ' : 'FALTA '} ${files.cert.path}`,
      `  clave.key        ${files.key.exists              ? 'OK    ' : 'FALTA '} ${files.key.path}`,
      `  node_modules     ${files.nodeModules.exists      ? 'OK    ' : 'FALTA '} ${files.nodeModules.path}`,
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
    const nodeOk    = isDev || getNodeBin() !== null;
    const modulesOk = existsSync(path.join(FACTURACION_USER_DIR(), 'node_modules', 'firebase-admin'));
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

  // Versión del Node (bundleado o manual)
  ipcMain.handle('facturacion:node-version', () => {
    const bin = getNodeBin();
    if (!bin) {
      const userData = app.getPath('userData');
      return {
        ok: false, version: null, bin: null,
        missingPath: path.join(userData, 'node', 'node.exe'),
        hint: `Copiá node.exe al deps pack: ${path.join(userData, 'node', 'node.exe')}`,
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
  ipcMain.handle('facturacion:start', (_e, key, accountDir) => ({
    ok: spawnFacturacionProc(key, accountDir),
  }));
  ipcMain.handle('facturacion:stop', (_e, key) => ({ ok: stopFacturacionProc(key) }));
  ipcMain.handle('facturacion:restart', (_e, key, accountDir) => {
    const dir = accountDir || facturacionProcs[key]?.accountDir;
    stopFacturacionProc(key);
    setTimeout(() => spawnFacturacionProc(key, dir), 800);
    return { ok: true };
  });
  ipcMain.handle('facturacion:status', (_e, key) => facturacionProcs[key]?.status ?? 'stopped');
  ipcMain.handle('facturacion:logs', (_e, key) => facturacionProcs[key]?.logs ?? []);

  // Config persistente
  ipcMain.handle('facturacion:config:read', () => {
    const p = path.join(app.getPath('userData'), 'facturacion-config.json');
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
  });
  ipcMain.handle('facturacion:config:write', (_e, config) => {
    const p = path.join(app.getPath('userData'), 'facturacion-config.json');
    writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
    return true;
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

    // Leer facturacion-config para saber si RI está inicializado
    let facturCfg = null;
    try {
      const cfgPath = path.join(userData, 'facturacion-config.json');
      if (existsSync(cfgPath)) facturCfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    } catch {}

    const riInitialized = facturCfg?.ri?.initialized || false;

    // Leer backend.env para saber si tiene MP token
    let backendVars = {};
    try {
      const envPath = path.join(userData, 'backend.env');
      if (existsSync(envPath)) backendVars = parseEnvFile(envPath);
    } catch {}
    const hasMpToken  = !!(backendVars.MERCADOPAGO_ACCESS_TOKEN);
    const hasBackendEnv = existsSync(path.join(userData, 'backend.env'));

    // SA del RI (para poder derivar backend.env)
    const riSaPath = path.join(riDir, 'serviceAccount.json');

    const nodeBin      = getNodeBin();
    const nodeOk       = isDev || nodeBin !== null;
    const nodePath     = nodeBin ?? path.join(userData, 'node', 'node.exe');
    const modulesOk    = existsSync(path.join(facturDir, 'node_modules', 'firebase-admin'));
    const depPackPath  = path.join(userData, 'facturacion', 'node_modules');

    const result = {
      nodeBundled:   chk(nodeOk,    'Node.js (deps pack)', isDev ? '(dev: sistema)' : nodePath),
      afipModules:   chk(modulesOk, 'Módulos AFIP',        modulesOk ? depPackPath : `FALTA → copiar a: ${depPackPath}`),
      afipRI: chk(
        riInitialized &&
          existsSync(path.join(riDir, '.env')) &&
          existsSync(path.join(riDir, 'serviceAccount.json')) &&
          existsSync(path.join(riDir, 'cert', 'certificado.crt')),
        'AFIP RI configurado', riDir
      ),
      backendEngine: chk(existsSync(path.join(backendDir, 'src', 'server.js')), 'Engine MP bundleado', backendDir),
      backendEnv:    chk(hasBackendEnv, 'Config MP (backend.env)', path.join(userData, 'backend.env')),
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
          nodeExe:     path.join(userData, 'node', 'node.exe'),
          nodeModules: path.join(userData, 'facturacion', 'node_modules'),
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
    const userData   = app.getPath('userData');
    const envPath    = path.join(userData, 'backend.env');
    const mpAccPath  = path.join(userData, 'mp-accounts.json');
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

    const saPath = path.join(userData, 'serviceAccountKey.json');
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
      if (path.isAbsolute(rawGac) && existsSync(rawGac)) gacResolved = rawGac;
      else if (existsSync(path.join(userData, rawGac))) gacResolved = path.join(userData, rawGac);
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
    const userData = app.getPath('userData');
    const riSaPath = path.join(getRIDir(), 'serviceAccount.json');
    const destPath = path.join(userData, 'backend.env');

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

    // Leer LOCAL_ID desde mp-accounts.json si existe
    let localId = '';
    try {
      const mpAccPath = path.join(userData, 'mp-accounts.json');
      if (existsSync(mpAccPath)) {
        const accounts = JSON.parse(readFileSync(mpAccPath, 'utf-8'));
        const active = accounts.find(a => a.activo) || accounts[0];
        if (active?.localId) localId = active.localId;
      }
    } catch {}

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
  ipcMain.handle('backend:set-mp-token', (_e, token) => {
    const userData = app.getPath('userData');
    const envPath  = path.join(userData, 'backend.env');
    let vars = existsSync(envPath) ? parseEnvFile(envPath) : {};
    vars.MERCADOPAGO_ACCESS_TOKEN = token || '';
    const content = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
    try {
      writeFileSync(envPath, content, 'utf-8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
    const userData  = app.getPath('userData');
    const envPath   = path.join(userData, 'backend.env');
    const mpAccPath = path.join(userData, 'mp-accounts.json');
    const saPath    = path.join(userData, 'serviceAccountKey.json');
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

ipcMain.handle('components:install', async (_e, componentKeys) => {
  const userData = app.getPath('userData');
  const tempDir  = path.join(app.getPath('temp'), 'dlvsistema-components');
  mkdirSync(tempDir, { recursive: true });

  const sendProg = (payload) => mainWindow?.webContents?.send('components:progress', payload);

  // 1. Descargar manifest
  sendProg({ step: 'manifest', msg: 'Descargando manifest…' });
  const manifestPath = path.join(tempDir, 'manifest.json');
  try {
    await downloadWithProgress(getComponentUrl('manifest.json'), manifestPath, () => {});
  } catch (e) {
    return { ok: false, error: `No se pudo descargar el manifest: ${e.message}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    return { ok: false, error: `manifest.json inválido: ${e.message}` };
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

  const state = checkComponentsState();
  return { ok: errors.length === 0, errors, state };
});

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Quitar el menú nativo de Electron (File, Edit, View, Window, Help)
  initMachineId();
  Menu.setApplicationMenu(null);
  setupIPC();
  // Reparar backend.env con private_key malformada ANTES de iniciar el backend
  const _userData   = app.getPath('userData');
  const _envPath    = path.join(_userData, 'backend.env');
  const _riSaPath   = path.join(getRIDir(), 'serviceAccount.json');
  repairBackendEnvIfNeeded(_envPath, _riSaPath);
  startBackend();
  createWindow();
  setTimeout(checkForUpdates, 15000);
  setTimeout(autoStartFacturacion, 8000);

  // Retry de arranque del backend MP + creación de mp-accounts.json si falta
  setTimeout(() => {
    const userData  = app.getPath('userData');
    const envPath   = path.join(userData, 'backend.env');
    const mpAccPath = path.join(userData, 'mp-accounts.json');
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

app.on('before-quit', () => {
  stopBackend();
  stopAllFacturacion();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
