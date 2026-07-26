// GUARDA DE REGRESIÓN de la regla de almacenamiento por local.
//
// El test de `rutasLocales.test.js` prueba el helper. Este recorre el CÓDIGO REAL
// del repo y falla si aparece una ruta de datos de un local fuera de su número:
// rutas invertidas (`priceHistory/{localId}`), escrituras en la raíz
// (`articulos/...` en Storage) o fallbacks prohibidos (`|| 'default'`).
//
// Es el equivalente "conectado" de la regla: si alguien agrega mañana un
// `ref(db, 'ALGO/${localId}')`, esta prueba lo detiene.
//
// Idéntico en Desktop y Tablet.
// Correr con: node src/lib/api/__tests__/rutasLocalesConectado.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../../../..');
const EXCLUIR = /node_modules|[\\/]dist[\\/]|[\\/]release[\\/]|[\\/]android[\\/]|[\\/]__tests__[\\/]|\.min\.js$/;

const archivos = (dir, out = []) => {
  let entradas = [];
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entradas) {
    const p = path.join(dir, e.name);
    if (EXCLUIR.test(p)) continue;
    if (e.isDirectory()) archivos(p, out);
    else if (/\.(js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

const FUENTES = [...archivos(path.join(RAIZ, 'src')), ...archivos(path.join(RAIZ, 'electron'))];
const rel = (p) => path.relative(RAIZ, p).replace(/\\/g, '/');
const leer = (p) => fs.readFileSync(p, 'utf8');

// Primeros segmentos permitidos fuera de un local (globales justificados) más los
// identificadores que RESUELVEN al local.
const GLOBALES_OK = new Set(['rutas', 'ids', '.info', 'instalaciones', 'LOCALES']);
const RESUELVE_A_LOCAL = /^\$\{\s*(LOCAL_ID|localId|localID|LOCALID|currentId|currentLocalId|id|base|basePath|rootPath|root|dbPath|backupBase|path|API_URL|FIREBASE_URL|getLocalId\(\)|getCurrentLocalId\(\)|getCurrentDatabasePath\(\)|getFirebaseUrl\(\)|getLocationSpecificDatabasePath\([^)]*\)|getPromotionsPath\(\)|mapsBase\([^)]*\)|rutaLocal\([^)]*\)|rutaCanonica\([^)]*\)|storagePrefix\([^)]*\)|construirRutaLocal\([^)]*\)|construirRutaStorageLocal\([^)]*\))\s*\}/;

// ---------------------------------------------------------------------------
console.log('El helper canónico existe y se usa:');
// ---------------------------------------------------------------------------
check('src/lib/api/rutasLocales.js está presente', () => {
  assert.ok(fs.existsSync(path.join(RAIZ, 'src/lib/api/rutasLocales.js')));
});
check('exporta el contrato pactado', () => {
  const src = leer(path.join(RAIZ, 'src/lib/api/rutasLocales.js'));
  for (const nombre of ['normalizarLocalId', 'construirRutaLocal', 'construirRutaStorageLocal',
    'rutaPerteneceAlLocal', 'verificarMismoLocal', 'esStorageGlobalPermitido', 'esRtdbGlobalPermitido']) {
    assert.ok(new RegExp(`export function ${nombre}\\b`).test(src), `falta export ${nombre}`);
  }
  assert.ok(/export const LOCAL_ID_REQUERIDO = 'LOCAL_ID_REQUIRED'/.test(src));
});
check('Storage lo usa para componer TODAS sus rutas', () => {
  const p = path.join(RAIZ, 'src/lib/firebase/storage.js');
  const src = leer(p);
  assert.ok(/from '@\/lib\/api\/rutasLocales'/.test(src), 'storage.js no importa el helper');
  // Ninguna llamada a ref(storage, `literal/...`) con primer segmento literal.
  const malas = [...src.matchAll(/ref\(\s*storage\s*,\s*`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((r) => !RESUELVE_A_LOCAL.test(r.split('/')[0]));
  assert.deepStrictEqual(malas, [], `rutas de Storage con primer segmento literal: ${malas.join(', ')}`);
});

// ---------------------------------------------------------------------------
console.log('\nNinguna ruta de datos de un local cuelga de la raíz:');
// ---------------------------------------------------------------------------
check('ref(db, ...) siempre empieza por el local (o un global justificado)', () => {
  const infracciones = [];
  for (const f of FUENTES) {
    const lineas = leer(f).split('\n');
    lineas.forEach((linea, i) => {
      for (const m of linea.matchAll(/\bref\s*\([^,]*,\s*`([^`]+)`/g)) {
        const ruta = m[1];
        const seg = ruta.split('/')[0];
        if (RESUELVE_A_LOCAL.test(seg)) continue;
        if (GLOBALES_OK.has(seg)) continue;
        if (seg.startsWith('${')) continue;          // variable no catalogada: se revisa aparte
        infracciones.push(`${rel(f)}:${i + 1} → ${ruta}`);
      }
    });
  }
  assert.deepStrictEqual(infracciones, [], `rutas RTDB fuera del local:\n        ${infracciones.join('\n        ')}`);
});
check('las rutas invertidas concretas que había quedaron eliminadas', () => {
  const prohibidas = [
    /ref\([^,]*,\s*`priceHistory\/\$\{/,
    /ref\([^,]*,\s*`locales\/\$\{/,
    /`actualizaciones\/\$\{localId\}/,
    /`app-icons\/\$\{localId\}/,
    /`facturacion\/\$\{localId\}/,
  ];
  const encontradas = [];
  for (const f of FUENTES) {
    const src = leer(f);
    for (const re of prohibidas) if (re.test(src)) encontradas.push(`${rel(f)} → ${re}`);
  }
  assert.deepStrictEqual(encontradas, [], encontradas.join('\n        '));
});

// ---------------------------------------------------------------------------
console.log('\nFalla segura: sin local no se escribe:');
// ---------------------------------------------------------------------------
check('no queda ningún fallback a "default" ni a la raíz', () => {
  const encontradas = [];
  for (const f of FUENTES) {
    const lineas = leer(f).split('\n');
    lineas.forEach((linea, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;   // comentarios: pueden citar el antipatrón
      // Centinelas que producirían `/default/...`, `/undefined/...`, `/null/...`.
      // `|| ''` NO se marca acá: en este código se usa para etiquetas visibles y
      // metadatos, nunca para componer una ruta (las rutas pasan por el helper,
      // que rechaza el vacío).
      if (/get(Current)?LocalId\(\)\s*\|\|\s*['"](default|undefined|null|NaN|0)['"]/.test(linea)) {
        encontradas.push(`${rel(f)}:${i + 1} → ${linea.trim()}`);
      }
      // Y un `|| ''` interpolado DIRECTAMENTE en una ruta sí es un error.
      if (/`[^`]*\$\{\s*get(Current)?LocalId\(\)\s*\|\|\s*['"]['"]\s*\}\//.test(linea)) {
        encontradas.push(`${rel(f)}:${i + 1} (vacío dentro de una ruta) → ${linea.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(encontradas, [], `fallbacks prohibidos:\n        ${encontradas.join('\n        ')}`);
});

// ---------------------------------------------------------------------------
console.log('\nFACTURACION_OWNERS: escritura solo dentro del local, lectura con fallback:');
// ---------------------------------------------------------------------------
const modulosOwnership = FUENTES.filter((f) => /FACTURACION_OWNERS/.test(leer(f)));

check('hay al menos un módulo de ownership', () => {
  assert.ok(modulosOwnership.length > 0, 'no se encontró el módulo de ownership');
});
check('la URL/ruta canónica se construye DENTRO del local', () => {
  const conRutaCanonica = modulosOwnership.filter((f) => {
    const s = leer(f);
    return /construirRutaLocal\([\s\S]{0,120}?FACTURACION_OWNERS/.test(s)
      || /\$\{\s*localId[A-Za-z]*\s*\}\/FACTURACION_OWNERS/.test(s);
  });
  assert.ok(conRutaCanonica.length > 0,
    `ningún módulo construye /{localId}/FACTURACION_OWNERS (revisados: ${modulosOwnership.map(rel).join(', ')})`);
});
check('la ruta global vieja SOLO aparece en un helper de lectura marcado como legado', () => {
  const infracciones = [];
  for (const f of modulosOwnership) {
    const src = leer(f);
    // Cualquier literal de la ruta global debe estar en una definición cuyo
    // nombre contenga "Legado"/"legado", o en un comentario.
    const lineas = src.split('\n');
    lineas.forEach((linea, i) => {
      const esComentario = /^\s*(\/\/|\*|\/\*)/.test(linea);
      const tieneGlobal = /(\$\{base\}|\$\{getFirebaseUrl\(\)\}|baseUrl\([^)]*\))\/FACTURACION_OWNERS/.test(linea);
      if (!tieneGlobal || esComentario) return;
      const contexto = lineas.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!/[Ll]egado/.test(contexto)) infracciones.push(`${rel(f)}:${i + 1} → ${linea.trim()}`);
    });
  }
  assert.deepStrictEqual(infracciones, [],
    `la ruta global vieja se usa fuera del fallback:\n        ${infracciones.join('\n        ')}`);
});
check('ninguna escritura (PUT/PATCH/DELETE/set/update) apunta al nodo legado', () => {
  const infracciones = [];
  for (const f of modulosOwnership) {
    const src = leer(f);
    // Un método de escritura no puede estar en la misma llamada que ownerUrlLegado.
    for (const m of src.matchAll(/ownerUrlLegado\([^)]*\)[^;]{0,200}/g)) {
      if (/method:\s*'(PUT|PATCH|DELETE|POST)'/.test(m[0])) {
        infracciones.push(`${rel(f)} → ${m[0].slice(0, 80)}`);
      }
    }
  }
  assert.deepStrictEqual(infracciones, [], infracciones.join('\n        '));
});
check('la lectura consulta PRIMERO la ruta nueva y solo después la legada', () => {
  const revisados = modulosOwnership.filter((f) => /ownerUrlLegado|FACTURACION_OWNERS/.test(leer(f)) && /Legado|legado/.test(leer(f)));
  assert.ok(revisados.length > 0, 'ningún módulo implementa el fallback');
  for (const f of revisados) {
    const src = leer(f);
    const iNueva = src.search(/const nuevo = await leer\(ownerUrl\(/);
    const iLegado = src.search(/const legado = await leer\(ownerUrlLegado\(/);
    if (iNueva === -1 && iLegado === -1) continue;   // otro estilo: lo cubre el check anterior
    assert.ok(iNueva !== -1, `${rel(f)}: no lee la ruta nueva`);
    assert.ok(iLegado !== -1, `${rel(f)}: no tiene fallback`);
    assert.ok(iNueva < iLegado, `${rel(f)}: el fallback se consulta ANTES que la ruta nueva`);
  }
});

// ---------------------------------------------------------------------------
console.log('\nCompatibilidad: la ruta vieja se lee, no se borra ni se duplica:');
// ---------------------------------------------------------------------------
check('priceHistory y whatsappMessages leen la ruta nueva primero', () => {
  for (const nombre of ['PriceHistoryApi.js', 'whatsappMessageApi.js']) {
    const p = path.join(RAIZ, 'src/lib/api', nombre);
    if (!fs.existsSync(p)) continue;
    const src = leer(p);
    assert.ok(/construirRutaLocal\(/.test(src), `${nombre}: no usa el helper`);
    assert.ok(/rutaLegado\(/.test(src), `${nombre}: no tiene fallback de lectura`);
    // La ruta legada nunca se usa con set/push (escritura).
    assert.ok(!/(set|push)\(\s*ref\([^)]*rutaLegado\(/.test(src), `${nombre}: escribe en la ruta legada`);
  }
});

// ---------------------------------------------------------------------------
console.log('\nParidad Desktop ↔ Tablet de los helpers de rutas:');
//
// Se comprueba acá y no en paridadCanonica.test.js porque ese archivo es
// byte-idéntico también con DLV Pedidos, que en esta tarea no se toca. La regla
// es la misma: estos archivos no se modifican en un repo sin reflejarlo en el otro.
// ---------------------------------------------------------------------------
const RECEPTORES = ['recepcion-de-pedidos-desktop', 'recepcion-de-pedidos-tab'];
const CONTENEDOR = path.dirname(RAIZ);
const OTROS = RECEPTORES
  .map((n) => path.join(CONTENEDOR, n))
  .filter((p) => path.resolve(p) !== path.resolve(RAIZ) && fs.existsSync(p));

const COMPARTIDOS = [
  'src/lib/api/rutasLocales.js',
  'src/lib/api/__tests__/rutasLocales.test.js',
  'src/lib/api/__tests__/rutasLocalesConectado.test.js',
  'src/lib/api/PriceHistoryApi.js',
];

const normalizarFin = (s) => s.replace(/\r\n/g, '\n');

for (const relPath of COMPARTIDOS) {
  check(`${relPath} es byte-idéntico entre Desktop y Tablet`, () => {
    const aqui = path.join(RAIZ, relPath);
    assert.ok(fs.existsSync(aqui), `falta en este repo: ${relPath}`);
    if (OTROS.length === 0) { console.log('        (el otro repo no está disponible)'); return; }
    for (const otro of OTROS) {
      const alla = path.join(otro, relPath);
      assert.ok(fs.existsSync(alla), `falta en ${path.basename(otro)}: ${relPath}`);
      assert.strictEqual(
        normalizarFin(leer(aqui)),
        normalizarFin(fs.readFileSync(alla, 'utf8')),
        `${relPath} difiere de ${path.basename(otro)}: sincronizá el cambio`
      );
    }
  });
}

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
