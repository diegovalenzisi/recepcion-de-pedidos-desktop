// BORRADO DE IMÁGENES ENTRE LOCALES QUE COMPARTEN BUCKET.
//
// Achaval (40508022), Joao (58290322), Viticos (57641732) y Bynnon (34516605)
// viven en el MISMO bucket de Firebase Storage: los que no tienen proyecto
// propio caen por fallback a la configuración por defecto. Se separan solo por
// la primera carpeta:
//
//     40508022/articulos/...      Achaval
//     58290322/articulos/...      Joao
//
// `deleteArticleImage` borraba la ruta que viniera dentro de la URL sin mirar de
// quién era. Un artículo cuya `foto` apuntara a la carpeta de otro local
// destruía el archivo del OTRO local, en silencio y sin vuelta atrás.
//
// Ahora hay una guarda: solo se borra si la ruta pertenece a la raíz de Storage
// del local actual. La comprobación no se reimplementa acá — sale de
// `rutaPerteneceAlLocal`, la guarda canónica de rutasLocales.js, la misma que
// usan las demás validaciones de ruta.
//
// Correr con: node src/lib/api/__tests__/borradoImagenEntreLocales.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { rutaPerteneceAlLocal, construirRutaStorageLocal } from '../rutasLocales.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

// Locales reales que comparten el bucket achava3703.firebasestorage.app.
const ACHAVAL = '40508022';
const JOAO = '58290322';
const VITICOS = '57641732';

/** Ruta interna de Storage tal como la deja una URL de descarga de Firebase. */
const rutaDe = (localId, archivo) => construirRutaStorageLocal(localId, `articulos/${archivo}`);

/** URL de descarga real, con el path percent-encoded, como la guarda RTDB en `foto`. */
const urlDe = (ruta) =>
  `https://firebasestorage.googleapis.com/v0/b/achava3703.firebasestorage.app/o/${encodeURIComponent(ruta)}?alt=media&token=x`;

/** Lo que hace la guarda: extraer el path de la URL y comprobar pertenencia. */
const pathDeUrl = (url) => decodeURIComponent((url.split('/o/')[1] || '').split('?')[0]);
const seBorra = (url, raizDelLocal) => {
  const filePath = pathDeUrl(url);
  return !!raizDelLocal && rutaPerteneceAlLocal(filePath, raizDelLocal);
};

// ---------------------------------------------------------------------------
console.log('\n1. Cada local borra SOLO dentro de su carpeta:');

check('Joao borra una imagen propia', () => {
  const url = urlDe(rutaDe(JOAO, '30A_1785292321402.png'));
  assert.strictEqual(seBorra(url, JOAO), true);
});

check('Joao NO puede borrar una imagen de Achaval', () => {
  const url = urlDe(rutaDe(ACHAVAL, '12A_1712345678.png'));
  assert.strictEqual(seBorra(url, JOAO), false, 'Joao llegó a la carpeta de Achaval');
});

check('Joao NO puede borrar una imagen de Viticos', () => {
  assert.strictEqual(seBorra(urlDe(rutaDe(VITICOS, '3A_1.png')), JOAO), false);
});

check('Achaval NO puede borrar una imagen de Joao', () => {
  // Es la dirección que importa para el caso reportado: Joao perdió archivos.
  assert.strictEqual(seBorra(urlDe(rutaDe(JOAO, '38A_1785292999999.png')), ACHAVAL), false);
});

check('cada local sí borra lo suyo', () => {
  for (const id of [ACHAVAL, JOAO, VITICOS]) {
    assert.strictEqual(seBorra(urlDe(rutaDe(id, 'X_1.png')), id), true, `${id} no puede borrar lo propio`);
  }
});

// ---------------------------------------------------------------------------
console.log('\n2. Rutas legadas y casos límite:');

check('una imagen en la RAÍZ del bucket (legado, sin prefijo) NO se borra', () => {
  // Achaval todavía conserva artículos con `articulos/...` sin prefijo de local.
  // Esos objetos son de nadie y de todos: no se tocan.
  assert.strictEqual(seBorra(urlDe('articulos/9A_1699999999.png'), ACHAVAL), false);
  assert.strictEqual(seBorra(urlDe('articulos/9A_1699999999.png'), JOAO), false);
});

check('sin local resuelto NO se borra nada', () => {
  assert.strictEqual(seBorra(urlDe(rutaDe(JOAO, '1A.png')), null), false);
  assert.strictEqual(seBorra(urlDe(rutaDe(JOAO, '1A.png')), ''), false);
});

check('un prefijo que solo COMPARTE dígitos no alcanza', () => {
  // '5829032' no es Joao: la guarda exige el segmento completo.
  assert.strictEqual(rutaPerteneceAlLocal('58290322/articulos/x.png', '5829032'), false);
  assert.strictEqual(rutaPerteneceAlLocal('583/articulos/x.png', '58290322'), false);
});

check('la carpeta del local, sola, pertenece al local', () => {
  assert.strictEqual(rutaPerteneceAlLocal(JOAO, JOAO), true);
  assert.strictEqual(rutaPerteneceAlLocal(`${JOAO}/`, JOAO), true);
});

check('el path percent-encoded de una URL real se resuelve bien', () => {
  const ruta = rutaDe(JOAO, '30A_1785292321402.png');
  const url = urlDe(ruta);
  assert.ok(url.includes('58290322%2Farticulos%2F'), 'la URL no quedó codificada como la real');
  assert.strictEqual(pathDeUrl(url), ruta);
});

// ---------------------------------------------------------------------------
console.log('\n3. La guarda está cableada en el circuito de borrado:');

const storageSrc = readFileSync(new URL('../../firebase/storage.js', import.meta.url), 'utf8');

check('deleteArticleImage usa la guarda canónica, no una copia', () => {
  assert.match(storageSrc, /rutaPerteneceAlLocal/, 'no usa la guarda canónica');
  assert.match(storageSrc, /from '@\/lib\/api\/rutasLocales'/, 'no la importa de rutasLocales');
});

check('la guarda corre ANTES del deleteObject', () => {
  const iGuarda = storageSrc.indexOf('rutaPerteneceAlLocal(filePath');
  const iBorrado = storageSrc.indexOf('await deleteObject(');
  assert.ok(iGuarda > 0, 'no hay guarda sobre filePath');
  assert.ok(iBorrado > iGuarda, 'el borrado ocurre antes de comprobar la pertenencia');
});

check('cuando no pertenece: warning y se sale sin borrar', () => {
  const i = storageSrc.indexOf('rutaPerteneceAlLocal(filePath');
  const bloque = storageSrc.slice(i, i + 600);
  assert.match(bloque, /console\.warn/, 'no avisa');
  assert.match(bloque, /BORRADO OMITIDO/, 'el warning no dice qué pasó');
  assert.match(bloque, /return;/, 'no corta el borrado');
});

check('la raíz sale de raizStorage, la MISMA que usan las subidas', () => {
  assert.match(storageSrc, /const raiz = raizStorage\(localId\)/, 'no usa la raíz canónica del local');
  // Y no hay ningún local hardcodeado en el CÓDIGO. Se quitan los comentarios
  // (incluidos los de final de línea): ahí los números de local aparecen a
  // propósito, como ejemplo de la regla de rutas.
  const codigo = storageSrc
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .filter((l) => !/^\s*(\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(!/\b(40508022|58290322|57641732|34516605|38827976|51501748)\b/.test(codigo),
    'hay un localId hardcodeado en el código de storage.js');
});

check('el sistema de SUBIDA no cambió: sigue usando rutaLocal/construirRutaStorageLocal', () => {
  assert.match(storageSrc, /const rutaLocal = \(localId, ruta\) => construirRutaStorageLocal\(raizStorage\(localId\), ruta\)/);
  assert.match(storageSrc, /uploadBytes|uploadBytesResumable/);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
