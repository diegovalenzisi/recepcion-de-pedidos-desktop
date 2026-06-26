#!/usr/bin/env node
/**
 * setup-desktop-config.js
 *
 * Prepara el archivo backend.env (y opcionalmente serviceAccountKey.json)
 * en el directorio de configuración de la app Electron:
 *   %APPDATA%\recepcion-de-pedidos-desktop\
 *
 * Uso:
 *   npm run desktop:setup-config
 *
 * Para otra PC: copiar D:\heladeria\mercadopago-webhook-backend\.env y
 * ejecutar este script. Lee la fuente en el orden de prioridad descrito abajo.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const CONFIG_DIR = path.join(APPDATA, 'recepcion-de-pedidos-desktop');
const DEST_ENV = path.join(CONFIG_DIR, 'backend.env');
const DEST_KEY = path.join(CONFIG_DIR, 'serviceAccountKey.json');

const PROJECT_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXAMPLE_ENV = path.join(PROJECT_ROOT, 'backend', '.env.example');

// Fuentes externas (prioridad 1: backend de Mercado Pago ya configurado)
const EXTERNAL_BACKEND = 'D:\\heladeria\\mercadopago-webhook-backend';
const EXTERNAL_ENV = path.join(EXTERNAL_BACKEND, '.env');
const EXTERNAL_KEY = path.join(EXTERNAL_BACKEND, 'serviceAccountKey.json');

// Variables mínimas requeridas para que el backend funcione
const REQUIRED_VARS = [
  'MERCADOPAGO_ACCESS_TOKEN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL',
  'LOCAL_ID',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg) { console.log(`[setup] ${msg}`); }
function warn(msg) { console.warn(`[setup] ADVERTENCIA: ${msg}`); }
function err(msg) { console.error(`[setup] ERROR: ${msg}`); }

/** Parsea un .env devolviendo { clave: valor } sin mostrar valores. */
function parseEnv(filePath) {
  const vars = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

/**
 * Busca un archivo .json en `dir` (sin entrar en node_modules) que parezca
 * una service account de Firebase (tiene project_id, client_email, private_key).
 */
function findServiceAccountJson(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      if (e.isFile() && e.name.endsWith('.json') &&
          e.name !== 'package.json' && e.name !== 'package-lock.json') {
        const full = path.join(dir, e.name);
        try {
          const obj = JSON.parse(fs.readFileSync(full, 'utf-8'));
          if (obj.project_id && obj.client_email && obj.private_key) {
            return full;
          }
        } catch { /* json malformado o no legible */ }
      }
    }
  } catch { /* no se pudo leer el directorio */ }
  return null;
}

/**
 * Agrega o reemplaza una variable en el contenido de un .env.
 * No modifica otras líneas.
 */
function upsertEnvVar(content, key, value) {
  const lines = content.split('\n');
  const regex = new RegExp(`^${key}\\s*=`);
  let found = false;
  const updated = lines.map(line => {
    if (regex.test(line.trim())) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) {
    // Agregar al final (antes del trailing newline si existe)
    updated.push(`${key}=${value}`);
  }
  return updated.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
log('=== Configuración del backend de Recepción de Pedidos Desktop ===');
log(`Directorio destino: ${CONFIG_DIR}`);

// 1. Crear carpeta de configuración
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  log(`Carpeta creada: ${CONFIG_DIR}`);
} else {
  log(`Carpeta ya existe: ${CONFIG_DIR}`);
}

// 2 & 3 & 4. Copiar backend.env
let envSource = null;
if (fs.existsSync(EXTERNAL_ENV)) {
  envSource = EXTERNAL_ENV;
  log(`Fuente de configuración: ${EXTERNAL_ENV}`);
} else if (fs.existsSync(EXAMPLE_ENV)) {
  envSource = EXAMPLE_ENV;
  warn(`No se encontró ${EXTERNAL_ENV}. Usando plantilla: ${EXAMPLE_ENV}`);
  warn('Editá manualmente el archivo backend.env creado con tus credenciales reales.');
} else {
  err('No se encontró ninguna fuente de configuración (.env ni .env.example).');
  process.exit(1);
}

let envContent = fs.readFileSync(envSource, 'utf-8');

// 8. Asegurar GOOGLE_APPLICATION_CREDENTIALS sin rutas fijas
envContent = upsertEnvVar(envContent, 'GOOGLE_APPLICATION_CREDENTIALS', 'serviceAccountKey.json');

fs.writeFileSync(DEST_ENV, envContent, 'utf-8');
log(`backend.env creado en: ${DEST_ENV}`);

// 5 & 6. Copiar serviceAccountKey.json si existe
let serviceAccountFound = false;
let serviceAccountSource = null;

if (fs.existsSync(EXTERNAL_KEY)) {
  serviceAccountSource = EXTERNAL_KEY;
} else {
  const found = findServiceAccountJson(EXTERNAL_BACKEND);
  if (found) serviceAccountSource = found;
}

if (serviceAccountSource) {
  fs.copyFileSync(serviceAccountSource, DEST_KEY);
  serviceAccountFound = true;
  log(`serviceAccountKey.json copiado desde: ${serviceAccountSource}`);
  log(`serviceAccountKey.json destino: ${DEST_KEY}`);
} else {
  warn('No se encontró serviceAccountKey.json en el backend externo.');
  warn('Si usás variables FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
  warn('en backend.env, no necesitás el archivo JSON — el backend las usa directamente.');
}

// 9. Verificar variables mínimas
const parsedVars = parseEnv(DEST_ENV);
const missing = REQUIRED_VARS.filter(v => {
  const val = parsedVars[v];
  // Detectar valores placeholder del .env.example
  if (!val) return true;
  if (val.startsWith('APP_USR-...') || val.includes('tu-') || val.includes('...')) return true;
  return false;
});

log('');
log('=== Verificación de variables ===');
if (missing.length === 0) {
  log('Todas las variables requeridas están presentes.');
} else {
  warn('Faltan o tienen valores de ejemplo las siguientes variables en backend.env:');
  for (const v of missing) warn(`  - ${v}`);
  warn(`Editá el archivo: ${DEST_ENV}`);
}

// Resumen final
log('');
log('=== Resumen ===');
log(`backend.env: ${DEST_ENV}`);
log(`serviceAccountKey.json: ${serviceAccountFound ? DEST_KEY : 'NO copiado (usar vars de entorno directas)'}`);
log(`Fuente .env: ${envSource === EXTERNAL_ENV ? 'D:\\heladeria\\mercadopago-webhook-backend\\.env' : 'plantilla .env.example'}`);
log(`Variables faltantes: ${missing.length === 0 ? 'ninguna' : missing.join(', ')}`);
log('');
log('Setup completado.');
