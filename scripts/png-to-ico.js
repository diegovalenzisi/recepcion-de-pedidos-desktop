/**
 * Convierte build/icon.png a build/icon.ico con múltiples resoluciones
 * usando solo Node.js + módulos nativos (no depende de sharp ni Pillow).
 *
 * Requiere: npm install png-to-ico  (instalado automáticamente abajo si hace falta)
 * Uso: node scripts/png-to-ico.js
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const srcPng = resolve(root, 'build', 'icon.png');
const destIco = resolve(root, 'build', 'icon.ico');

if (!existsSync(srcPng)) {
  console.error(`ERROR: No se encontró ${srcPng}`);
  console.error('Guardá la imagen PNG en build/icon.png primero.');
  process.exit(1);
}

console.log('Convirtiendo PNG → ICO...');

// Instalar png-to-ico si no está disponible
try {
  await import('png-to-ico');
} catch {
  console.log('Instalando png-to-ico temporalmente...');
  execSync('npm install --no-save png-to-ico', { cwd: root, stdio: 'inherit' });
}

const pngToIco = (await import('png-to-ico')).default;
const buf = await pngToIco([srcPng]);
writeFileSync(destIco, buf);

console.log(`ICO generado: ${destIco} (${(buf.length / 1024).toFixed(1)} KB)`);
