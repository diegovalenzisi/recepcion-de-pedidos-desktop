/**
 * upload-installer.js
 * Sube el instalador real a Firebase Storage y guarda metadata en RTDB.
 *
 * Ejecutar desde el directorio raíz del proyecto:
 *   node backend/upload-installer.js
 *
 * Requiere backend.env en AppData con:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL
 */

import admin from 'firebase-admin';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── 1. Leer backend.env ──────────────────────────────────────────────────────
const envPath = join(
  process.env.APPDATA || '',
  'recepcion-de-pedidos-desktop',
  'backend.env'
);

if (!existsSync(envPath)) {
  console.error(`ERROR: No se encontró backend.env en:\n  ${envPath}`);
  process.exit(1);
}

function parseEnvFile(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split('\n');
  const env = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();
    // Quitar comillas envolventes si existen
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = parseEnvFile(envPath);

const PROJECT_ID    = env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL  = env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY   = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const DATABASE_URL  = env.FIREBASE_DATABASE_URL;
const BUCKET_NAME   = 'achava3703.firebasestorage.app';

if (!PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  console.error('ERROR: Faltan credenciales Firebase en backend.env');
  console.error(`  FIREBASE_PROJECT_ID: ${PROJECT_ID ? '✓' : '✗'}`);
  console.error(`  FIREBASE_CLIENT_EMAIL: ${CLIENT_EMAIL ? '✓' : '✗'}`);
  console.error(`  FIREBASE_PRIVATE_KEY: ${PRIVATE_KEY ? '✓' : '✗'}`);
  process.exit(1);
}

// ── 2. Inicializar firebase-admin ────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({ projectId: PROJECT_ID, clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY }),
  databaseURL: DATABASE_URL,
  storageBucket: BUCKET_NAME,
});

console.log(`[upload] Firebase inicializado (proyecto: ${PROJECT_ID})`);

// ── 3. Localizar el instalador ───────────────────────────────────────────────
const INSTALLER_PATH = join(ROOT, 'release', 'Recepción de Pedidos Setup 1.3.14.exe');

if (!existsSync(INSTALLER_PATH)) {
  console.error(`ERROR: Instalador no encontrado en:\n  ${INSTALLER_PATH}`);
  process.exit(1);
}

const INSTALLER_NAME = basename(INSTALLER_PATH);
const INSTALLER_SIZE = statSync(INSTALLER_PATH).size;
const STORAGE_PATH   = `dlvsistema/instaladores/${INSTALLER_NAME}`;

console.log(`[upload] Archivo: ${INSTALLER_NAME}`);
console.log(`[upload] Tamaño: ${(INSTALLER_SIZE / 1024 / 1024).toFixed(1)} MB`);
console.log(`[upload] Ruta Storage: ${STORAGE_PATH}`);

// ── 4. Calcular SHA256 ───────────────────────────────────────────────────────
console.log('[upload] Calculando SHA256...');
const sha256 = await new Promise((resolve, reject) => {
  const hash   = createHash('sha256');
  const stream = createReadStream(INSTALLER_PATH);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end',  () => resolve(hash.digest('hex')));
  stream.on('error', reject);
});
console.log(`[upload] SHA256: ${sha256}`);

// ── 5. Subir a Firebase Storage ──────────────────────────────────────────────
console.log('[upload] Subiendo a Firebase Storage...');
const bucket       = admin.storage().bucket();
const downloadToken = randomUUID();

const uploadStart = Date.now();
await bucket.upload(INSTALLER_PATH, {
  destination: STORAGE_PATH,
  resumable:   false,
  metadata: {
    contentType: 'application/octet-stream',
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
    },
  },
});

const uploadSecs = ((Date.now() - uploadStart) / 1000).toFixed(1);
console.log(`[upload] Upload completo en ${uploadSecs}s`);

// ── 6. Construir URL de descarga ─────────────────────────────────────────────
const encodedPath  = encodeURIComponent(STORAGE_PATH);
const downloadUrl  = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodedPath}?alt=media&token=${downloadToken}`;
console.log(`[upload] URL de descarga:\n  ${downloadUrl}`);

// ── 7. Guardar metadata en RTDB ──────────────────────────────────────────────
const metadata = {
  version:      '1.3.14',
  nombreArchivo: INSTALLER_NAME,
  url:          downloadUrl,
  fecha:        new Date().toISOString().split('T')[0],
  tipo:         'base-full',
  sha256,
  descripcion:  'Instalador completo para PC nueva',
  storagePath:  STORAGE_PATH,
  tamanoBytes:  INSTALLER_SIZE,
};

const db      = admin.database();
const ref     = db.ref('DLVSistema/instaladores/baseFull');
await ref.set(metadata);
console.log('[upload] Metadata guardada en RTDB: DLVSistema/instaladores/baseFull');

// ── 8. Verificar leyendo de vuelta ───────────────────────────────────────────
const snap = await ref.once('value');
const saved = snap.val();
console.log('\n[upload] ✅ VERIFICACIÓN — dato leído de Firebase:');
console.log(JSON.stringify(saved, null, 2));

// ── 9. Probar URL del bootstrapper ───────────────────────────────────────────
const testUrl = `https://achava3703-default-rtdb.firebaseio.com/DLVSistema/instaladores/baseFull.json`;
console.log(`\n[upload] URL que usa el bootstrapper:\n  ${testUrl}`);
console.log('[upload] → Probá abrirla en el navegador para confirmar que devuelve el JSON.');

await admin.app().delete();
console.log('\n[upload] Proceso completado exitosamente.');
