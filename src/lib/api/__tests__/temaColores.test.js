// LA PALETA DE TEMAS: 22 colores y su versión pastel.
//
// La definición vive SOLO en temaColores.js. Estas pruebas verifican las dos
// cosas que pueden romperse en silencio:
//
//   · que un tema ya guardado en CONFIGURACION/themeColor de un local cambie de
//     aspecto — la clave es la identidad del tema y su HSL no puede moverse;
//   · que el CSS del `@layer base` quede desalineado de la paleta, que fue
//     exactamente lo que pasó cuando los colores vivían en tres archivos.
//
// Correr con: node src/lib/api/__tests__/temaColores.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TEMAS, TEMA_POR_DEFECTO, TEMAS_HISTORICOS, temaPorNombre, esTemaValido,
  esPastel, colorDeTema, foregroundDeTema, mapaDeColores, cssDeTemas,
} from '../temaColores.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const base = TEMAS.filter((t) => !t.pastel);
const pasteles = TEMAS.filter((t) => t.pastel);

// ---------------------------------------------------------------------------
console.log('\n1. Cuántos temas hay:');

check('22 base + 22 pasteles = 44', () => {
  assert.strictEqual(base.length, 22, `hay ${base.length} temas base`);
  assert.strictEqual(pasteles.length, 22, `hay ${pasteles.length} pasteles`);
  assert.strictEqual(TEMAS.length, 44);
});

check('no hay ninguna clave repetida', () => {
  const nombres = TEMAS.map((t) => t.nombre);
  assert.strictEqual(new Set(nombres).size, nombres.length, 'hay claves duplicadas');
  const etiquetas = TEMAS.map((t) => t.etiqueta);
  assert.strictEqual(new Set(etiquetas).size, etiquetas.length, 'hay etiquetas duplicadas');
});

check('cada base tiene EXACTAMENTE un pastel, y viceversa', () => {
  for (const t of base) {
    const p = TEMAS.find((x) => x.nombre === `${t.nombre}Pastel`);
    assert.ok(p, `falta el pastel de ${t.nombre}`);
    assert.strictEqual(p.pastel, true);
  }
  for (const p of pasteles) {
    const nombreBase = p.nombre.replace(/Pastel$/, '');
    assert.ok(base.some((t) => t.nombre === nombreBase), `${p.nombre} no tiene base`);
  }
});

// ---------------------------------------------------------------------------
console.log('\n2. Compatibilidad: ningún tema existente cambió:');

// Los valores con los que están guardados hoy en los locales. Si alguno de
// estos números se mueve, un local cambia de color solo.
const CONGELADOS = {
  orange:     { h: 24,  s: 95, l: 53 },
  blue:       { h: 217, s: 91, l: 60 },
  green:      { h: 142, s: 71, l: 45 },
  golden:     { h: 45,  s: 93, l: 47 },
  magenta:    { h: 312, s: 84, l: 51 },
  red:        { h: 0,   s: 84, l: 60 },
  orangeDark: { h: 18,  s: 88, l: 42 },
  yellow:     { h: 52,  s: 96, l: 50 },
  greenDark:  { h: 152, s: 65, l: 30 },
  lime:       { h: 84,  s: 78, l: 44 },
  aqua:       { h: 168, s: 72, l: 41 },
  turquoise:  { h: 182, s: 80, l: 40 },
  skyBlue:    { h: 199, s: 89, l: 55 },
  blueDark:   { h: 226, s: 71, l: 40 },
  indigo:     { h: 243, s: 75, l: 59 },
  violet:     { h: 258, s: 82, l: 62 },
  purple:     { h: 280, s: 68, l: 45 },
  pink:       { h: 330, s: 85, l: 60 },
  wine:       { h: 348, s: 72, l: 36 },
  brown:      { h: 25,  s: 45, l: 34 },
  slate:      { h: 215, s: 16, l: 42 },
};

check('los 21 temas que ya existían conservan su HSL exacto', () => {
  for (const [nombre, hsl] of Object.entries(CONGELADOS)) {
    const t = temaPorNombre(nombre);
    assert.strictEqual(t.nombre, nombre, `${nombre} dejó de existir`);
    assert.deepStrictEqual({ h: t.h, s: t.s, l: t.l }, hsl, `${nombre} cambió de color`);
  }
});

check('los seis históricos siguen declarados como tales', () => {
  assert.deepStrictEqual([...TEMAS_HISTORICOS], ['orange', 'blue', 'green', 'golden', 'magenta', 'red']);
  for (const n of TEMAS_HISTORICOS) assert.ok(esTemaValido(n));
  assert.strictEqual(TEMA_POR_DEFECTO, 'orange');
});

check('un nombre desconocido cae al tema por defecto, no rompe', () => {
  assert.strictEqual(temaPorNombre('no-existe').nombre, TEMA_POR_DEFECTO);
  assert.strictEqual(temaPorNombre(null).nombre, TEMA_POR_DEFECTO);
  assert.strictEqual(esTemaValido('no-existe'), false);
});

// ---------------------------------------------------------------------------
console.log('\n3. Almendra:');

check('existe, es beige cálido y se distingue de marrón, dorado y amarillo', () => {
  const a = temaPorNombre('almond');
  assert.strictEqual(a.etiqueta, 'Almendra');
  assert.deepStrictEqual({ h: a.h, s: a.s, l: a.l }, { h: 34, s: 42, l: 62 });

  const brown = temaPorNombre('brown');
  const golden = temaPorNombre('golden');
  const yellow = temaPorNombre('yellow');
  // Del marrón lo separa la luminosidad: mismo tono cálido, mucho más claro.
  assert.ok(a.l - brown.l >= 20, 'se confunde con el marrón');
  // Del dorado y del amarillo, el tono y la saturación.
  assert.ok(Math.abs(a.h - golden.h) >= 10 && golden.s - a.s >= 30, 'se confunde con el dorado');
  assert.ok(Math.abs(a.h - yellow.h) >= 15, 'se confunde con el amarillo');
});

check('almondPastel existe y es su pastel', () => {
  const p = temaPorNombre('almondPastel');
  assert.strictEqual(p.etiqueta, 'Almendra pastel');
  assert.strictEqual(p.h, 34);
  assert.strictEqual(esPastel('almondPastel'), true);
  assert.strictEqual(esPastel('almond'), false);
});

// ---------------------------------------------------------------------------
console.log('\n4. Los pasteles son pasteles de verdad:');

check('conservan el TONO del original', () => {
  for (const p of pasteles) {
    const t = temaPorNombre(p.nombre.replace(/Pastel$/, ''));
    assert.strictEqual(p.h, t.h, `${p.nombre} cambió de tono`);
  }
});

check('son más claros y menos saturados que su original', () => {
  for (const p of pasteles) {
    const t = temaPorNombre(p.nombre.replace(/Pastel$/, ''));
    assert.ok(p.l > t.l, `${p.nombre} no es más claro que ${t.nombre}`);
    assert.ok(p.s <= t.s, `${p.nombre} no es menos saturado que ${t.nombre}`);
  }
});

check('no es opacidad: cada pastel tiene su HSL propio', () => {
  for (const p of pasteles) {
    assert.ok(!/rgba|opacity|\/\s*\d/.test(colorDeTema(p.nombre)), `${p.nombre} usa opacidad`);
    assert.match(colorDeTema(p.nombre), /^hsl\(\d+, \d+%, \d+%\)$/);
  }
});

check('forman una familia: misma luminosidad y saturación acotada', () => {
  const luminosidades = new Set(pasteles.map((p) => p.l));
  assert.strictEqual(luminosidades.size, 1, 'los pasteles no comparten luminosidad');
  for (const p of pasteles) {
    const t = temaPorNombre(p.nombre.replace(/Pastel$/, ''));
    assert.ok(p.s <= 65, `${p.nombre} tiene saturación ${p.s}: deja de ser pastel`);
    // El piso de 25 evita grises, pero nunca sube por encima del original: el
    // pastel de 'Gris' (s=16) sigue en 16 y no se vuelve mas colorido que el.
    assert.ok(p.s >= 25 || p.s === t.s, `${p.nombre} quedó en ${p.s}`);
  }
});

// ---------------------------------------------------------------------------
console.log('\n5. Contraste del texto sobre el color primario:');

check('los temas normales conservan el texto casi blanco de siempre', () => {
  for (const t of base) assert.strictEqual(foregroundDeTema(t.nombre), '210 40% 98%');
});

check('los pasteles llevan texto oscuro, del mismo tono', () => {
  for (const p of pasteles) {
    const fg = foregroundDeTema(p.nombre);
    assert.strictEqual(fg, `${p.h} 45% 20%`, `${p.nombre} no define su propio texto`);
  }
});

check('la diferencia de luminosidad alcanza para leer', () => {
  // Fondo pastel 84% contra texto 20%: 64 puntos de diferencia. Muy por encima
  // de lo que haría falta; con texto blanco (98%) serían 14 y no se leería.
  for (const p of pasteles) {
    const lTexto = Number(foregroundDeTema(p.nombre).split(' ')[2].replace('%', ''));
    assert.ok(p.l - lTexto >= 45, `${p.nombre} no tiene contraste suficiente`);
  }
});

check('el hook de botones ya no fuerza texto blanco', () => {
  const hook = readFileSync(new URL('../../../hooks/useThemeButtonColors.js', import.meta.url), 'utf8');
  assert.ok(!/bg-primary text-white/.test(hook),
    'volvió el text-white fijo: sobre un pastel no se leería');
  assert.match(hook, /bg-primary text-primary-foreground/);
});

// ---------------------------------------------------------------------------
console.log('\n6. Los consumidores salen de la paleta, no de listas propias:');

check('index.css tiene EXACTAMENTE los bloques que genera la paleta', () => {
  const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.ok(css.includes(cssDeTemas()),
    'el CSS quedó desalineado de la paleta: regenerar con cssDeTemas()');
  const enCss = (css.match(/body\[data-theme='/g) || []).length;
  assert.strictEqual(enCss, TEMAS.length, `el CSS tiene ${enCss} temas y la paleta ${TEMAS.length}`);
});

check('ThemeSelector y el hook importan la paleta y no repiten colores', () => {
  const sel = readFileSync(new URL('../../../components/settings/local/admin/ThemeSelector.jsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../../../hooks/useThemeButtonColors.js', import.meta.url), 'utf8');
  assert.match(sel, /from '@\/lib\/api\/temaColores'/);
  assert.match(hook, /from '@\/lib\/api\/temaColores'/);
  assert.ok(!/hsl\(\d+,\s*\d+%/.test(sel), 'ThemeSelector volvió a tener HSL propios');
  assert.ok(!/const themeColorMap = \{/.test(hook), 'volvió el mapa de colores escrito a mano');
});

check('el mapa de colores cubre los 44', () => {
  const mapa = mapaDeColores();
  assert.strictEqual(Object.keys(mapa).length, 44);
  assert.strictEqual(mapa.orange, 'hsl(24, 95%, 53%)');
  assert.ok(mapa.almondPastel);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
