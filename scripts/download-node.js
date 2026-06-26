/**
 * Descarga node.exe portable (Windows x64) para incluirlo en el instalador.
 * Ejecutado automáticamente como parte de npm run electron:build.
 * No requiere dependencias externas — solo usa módulos built-in de Node.
 */
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { get } from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

const NODE_VERSION = '20.18.1';
const NODE_URL     = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;
const DEST_DIR     = join(ROOT, 'resources', 'node');
const DEST_PATH    = join(DEST_DIR, 'node.exe');

if (existsSync(DEST_PATH)) {
  console.log(`[download-node] node.exe ya existe (v${NODE_VERSION}), saltando descarga.`);
  process.exit(0);
}

mkdirSync(DEST_DIR, { recursive: true });
console.log(`[download-node] Descargando Node.js v${NODE_VERSION} desde:`);
console.log(`  ${NODE_URL}`);

const file = createWriteStream(DEST_PATH);
let lastPct = -1;

const req = get(NODE_URL, (res) => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    file.close();
    console.log(`[download-node] Redirect → ${res.headers.location}`);
    // Re-invocar con la nueva URL (raro en nodejs.org pero por si acaso)
    get(res.headers.location, handleResponse).on('error', onError);
    return;
  }
  handleResponse(res);
});

function handleResponse(res) {
  if (res.statusCode !== 200) {
    file.close();
    console.error(`[download-node] HTTP ${res.statusCode} — descarga fallida`);
    process.exit(1);
  }

  const total    = parseInt(res.headers['content-length'] || '0', 10);
  let   received = 0;

  res.on('data', (chunk) => {
    received += chunk.length;
    if (total > 0) {
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        lastPct = pct;
        const mb = (received / 1024 / 1024).toFixed(1);
        const tot = (total   / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r[download-node] ${pct}%  ${mb} / ${tot} MB   `);
      }
    }
  });

  res.pipe(file);

  file.on('finish', () => {
    file.close(() => {
      console.log(`\n[download-node] ✓ node.exe guardado en: ${DEST_PATH}`);
      process.exit(0);
    });
  });
}

function onError(err) {
  file.close();
  console.error('[download-node] Error de red:', err.message);
  console.error('Solución: descargá manualmente node.exe desde https://nodejs.org/dist/v20.18.1/win-x64/node.exe');
  console.error(`y colocalo en: ${DEST_PATH}`);
  process.exit(1);
}

req.on('error', onError);
