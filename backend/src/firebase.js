import admin from 'firebase-admin';
import { existsSync, readFileSync } from 'fs';
import { join, isAbsolute } from 'path';

// Normaliza la private_key de Firebase sin importar cómo fue almacenada:
// - con \\n doble-escapado (backend.env generado por scripts anteriores)
// - con \n literal (texto, no newline real)
// - con comillas envolventes
// - con espacios extra
function normalizePrivateKey(key) {
  if (!key) return key;
  let k = key;
  k = k.replace(/\\\\n/g, '\n'); // doble-escapado → newline real
  k = k.replace(/\\n/g, '\n');   // literal \n → newline real
  k = k.replace(/^["']|["']$/g, '').trim(); // quitar comillas envolventes
  return k;
}

function validatePrivateKey(key, label) {
  const normalized = normalizePrivateKey(key);
  const ok = normalized.includes('-----BEGIN PRIVATE KEY-----') &&
             normalized.includes('-----END PRIVATE KEY-----');
  console.log(`[BACKEND FIREBASE] ${label} formato OK=${ok}`);
  if (!ok) {
    console.error('[BACKEND FIREBASE] private_key inválida — debe empezar con "-----BEGIN PRIVATE KEY-----" y terminar con "-----END PRIVATE KEY-----"');
  }
  return ok;
}

if (!admin.apps.length) {
  const userDataPath = process.env.ELECTRON_USER_DATA_PATH || null;

  // --- Estrategia 1: variables de entorno directas (FIREBASE_PROJECT_ID etc.) ---
  const hasEnvVars =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY;

  // --- Estrategia 2: GOOGLE_APPLICATION_CREDENTIALS (ruta ya resuelta por Electron main) ---
  const resolvedGAC = resolveGoogleCredentials(userDataPath);

  // --- Estrategia 3: serviceAccountKey.json en userData ---
  const serviceAccountPath = userDataPath
    ? join(userDataPath, 'serviceAccountKey.json')
    : null;

  // --- Estrategia 4: serviceAccount.json de AFIP RI (si está en el path de resources) ---
  const riSaPath = process.env.ELECTRON_RESOURCES_PATH
    ? join(process.env.ELECTRON_RESOURCES_PATH, 'facturacion', 'RI', 'serviceAccount.json')
    : null;

  console.log(`[BACKEND FIREBASE] serviceAccount path=${serviceAccountPath || 'n/a'}`);
  console.log(`[BACKEND FIREBASE] file exists=${serviceAccountPath ? existsSync(serviceAccountPath) : false}`);
  console.log(`[BACKEND FIREBASE] project_id=${process.env.FIREBASE_PROJECT_ID || 'n/a (usando SA file)'}`);
  console.log(`[BACKEND FIREBASE] client_email=${process.env.FIREBASE_CLIENT_EMAIL || 'n/a (usando SA file)'}`);

  if (hasEnvVars) {
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
    const keyOk = validatePrivateKey(privateKey, 'desde env vars');
    if (!keyOk) {
      throw new Error(
        'FIREBASE_PRIVATE_KEY en backend.env está mal formateada. ' +
        'Necesita contener "-----BEGIN PRIVATE KEY-----". ' +
        'Regenerá backend.env usando "Reparar Mercado Pago en esta PC".'
      );
    }
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[BACKEND FIREBASE] Inicializado con variables de entorno (FIREBASE_PROJECT_ID)');
  } else if (resolvedGAC) {
    const serviceAccount = JSON.parse(readFileSync(resolvedGAC, 'utf-8'));
    serviceAccount.private_key = normalizePrivateKey(serviceAccount.private_key);
    validatePrivateKey(serviceAccount.private_key, 'desde GOOGLE_APPLICATION_CREDENTIALS');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[BACKEND FIREBASE] Inicializado con GOOGLE_APPLICATION_CREDENTIALS:', resolvedGAC);
  } else if (serviceAccountPath && existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
    serviceAccount.private_key = normalizePrivateKey(serviceAccount.private_key);
    validatePrivateKey(serviceAccount.private_key, 'desde serviceAccountKey.json en userData');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[BACKEND FIREBASE] Inicializado con serviceAccountKey.json desde:', serviceAccountPath);
  } else {
    const configDir = userDataPath || 'el directorio actual';
    console.error(
      '[BACKEND FIREBASE] ERROR: No se encontraron credenciales de Firebase.\n' +
      'Configurar en:\n' +
      `  ${userDataPath ? join(userDataPath, 'backend.env') : 'backend/.env'}\n` +
      '  FIREBASE_PROJECT_ID=...\n' +
      '  FIREBASE_CLIENT_EMAIL=...\n' +
      '  FIREBASE_PRIVATE_KEY=...\n' +
      '  FIREBASE_DATABASE_URL=...\n' +
      'O copiá serviceAccountKey.json en:\n' +
      `  ${serviceAccountPath || 'backend/serviceAccountKey.json'}`
    );
    throw new Error(
      `Credenciales de Firebase no configuradas. Configurar en: ${configDir}`
    );
  }
}

// Resuelve GOOGLE_APPLICATION_CREDENTIALS a una ruta absoluta existente.
// Electron main ya lo resuelve, pero esta función actúa como fallback.
function resolveGoogleCredentials(userDataPath) {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) return null;

  // Si ya es absoluta y existe → usar directamente
  if (isAbsolute(raw) && existsSync(raw)) return raw;

  // Si es relativa → intentar contra userData
  if (userDataPath) {
    const resolved = join(userDataPath, raw);
    if (existsSync(resolved)) return resolved;
  }

  // No encontrado → null (se loguea warning en el bloque de inicialización)
  if (!isAbsolute(raw)) {
    console.warn(
      `[firebase] GOOGLE_APPLICATION_CREDENTIALS="${raw}" es relativa y no se encontró en userData.`
    );
  }
  return null;
}

export const db = admin.database();
