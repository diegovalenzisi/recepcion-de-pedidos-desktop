// ANCHO DE ROLLO TÉRMICO: 80 mm (actual) y 58 mm (nuevo).
//
// LA PRUEBA QUE IMPORTA es la primera sección: con 80 mm —que es el default y
// lo que usan hoy todos los locales— las tres plantillas tienen que emitir
// EXACTAMENTE el mismo CSS de siempre. El soporte de 58 mm se agrega al lado,
// nunca en lugar de.
//
// Correr con: node src/lib/print/__tests__/anchoPapel.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  ANCHOS_SOPORTADOS, ANCHO_POR_DEFECTO,
  normalizarAncho, esAngosto, medidasDePapel, cssExtraAngosto,
} from '../paper.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const COMANDA = leer('../command.js');
const MOSTRADOR = leer('../counterTicket.js');
const CAJA = leer('../safeTicket.js');
const AJUSTES = leer('../settings.js');

// ---------------------------------------------------------------------------
console.log('\n1. 80 mm NO CAMBIA (es el comportamiento actual):');

check('80 es el ancho por defecto', () => {
  assert.strictEqual(ANCHO_POR_DEFECTO, 80);
  assert.strictEqual(medidasDePapel(undefined).anchoMm, 80);
});

check('con 80 mm las medidas son las que ya estaban escritas', () => {
  const m = medidasDePapel(80);
  assert.strictEqual(m.anchoMm, 80, 'cambió el ancho');
  assert.strictEqual(m.paddingMm, 3, 'cambió el padding de la comanda');
  assert.strictEqual(m.escala, 1, 'la tipografía de 80 mm no puede escalarse');
  assert.strictEqual(m.escalaTitulo, 1);
  assert.strictEqual(m.anchoQrPx, 130, 'cambió el QR del ticket de mostrador');
});

check('con 80 mm NO se agrega ni una línea de CSS', () => {
  assert.strictEqual(cssExtraAngosto(80), '', 'se coló CSS extra en 80 mm');
  assert.strictEqual(cssExtraAngosto(undefined), '');
  assert.strictEqual(cssExtraAngosto(null), '');
  assert.strictEqual(cssExtraAngosto('cualquier cosa'), '');
});

check('el tamaño de fuente de 80 mm queda intacto', () => {
  // Es la cuenta exacta que hacen las plantillas.
  for (const px of [16, 20, 24, 32, 40]) {
    assert.strictEqual(Math.round(px * medidasDePapel(80).escala), px, `cambió la fuente ${px}px`);
  }
});

// ---------------------------------------------------------------------------
console.log('\n2. Cualquier valor raro cae en 80 (nadie queda sin imprimir):');

check('ausente, vacío, 0, basura y anchos no soportados → 80', () => {
  for (const v of [undefined, null, '', 0, -58, 'ancho', {}, [], NaN, 57, 76, 110, true]) {
    assert.strictEqual(normalizarAncho(v), 80, `${JSON.stringify(v)} no cayó en 80`);
  }
});

check('58 se acepta como número y como texto', () => {
  assert.strictEqual(normalizarAncho(58), 58);
  assert.strictEqual(normalizarAncho('58'), 58);
  assert.strictEqual(normalizarAncho(' 58 '), 58);
  assert.strictEqual(normalizarAncho('58mm'), 58);
});

check('80 se acepta igual', () => {
  assert.strictEqual(normalizarAncho(80), 80);
  assert.strictEqual(normalizarAncho('80'), 80);
});

check('los anchos soportados son 80 y 58', () => {
  assert.deepStrictEqual([...ANCHOS_SOPORTADOS], [80, 58]);
});

// ---------------------------------------------------------------------------
console.log('\n3. 58 mm: medidas coherentes con el rollo angosto:');

check('esAngosto distingue los dos rollos', () => {
  assert.strictEqual(esAngosto(58), true);
  assert.strictEqual(esAngosto(80), false);
  assert.strictEqual(esAngosto(undefined), false);
});

check('el ancho y el padding bajan', () => {
  const m = medidasDePapel(58);
  assert.strictEqual(m.anchoMm, 58);
  assert.ok(m.paddingMm < medidasDePapel(80).paddingMm, 'el padding no se redujo');
  assert.ok(m.anchoQrPx < medidasDePapel(80).anchoQrPx, 'el QR no entra en 58 mm');
});

check('la letra se achica pero sigue siendo legible', () => {
  const m = medidasDePapel(58);
  assert.ok(m.escala < 1, 'no se achicó nada');
  assert.ok(m.escala >= 0.75, 'se achicó tanto que deja de leerse en la cocina');
  // Con la fuente mínima configurable (16px) sigue por encima de 12px.
  assert.ok(Math.round(16 * m.escala) >= 12, `16px quedaría en ${Math.round(16 * m.escala)}px`);
});

check('58 mm agrega el CSS que evita los cortes', () => {
  const css = cssExtraAngosto(58);
  assert.match(css, /overflow-wrap:\s*anywhere/, 'los textos largos se van a cortar');
  assert.match(css, /word-break:\s*break-word/, 'los nombres largos no bajan de línea');
  assert.match(css, /table-layout:\s*fixed/, 'la tabla de items puede desbordar');
  assert.match(css, /min-width:\s*0/, 'en flex el importe se sale del papel');
  assert.match(css, /\.client-address/, 'la dirección no está contemplada');
  assert.match(css, /\.observation-text/, 'las observaciones no están contempladas');
});

check('las medidas son inmutables (nadie las pisa en caliente)', () => {
  const m = medidasDePapel(58);
  assert.throws(() => { 'use strict'; m.anchoMm = 999; }, 'el objeto de medidas es mutable');
});

// ---------------------------------------------------------------------------
console.log('\n4. Las tres plantillas usan la fuente única, sin 80 hardcodeado:');

const plantillas = [['comanda', COMANDA], ['mostrador', MOSTRADOR], ['caja fuerte', CAJA]];

for (const [nombre, src] of plantillas) {
  check(`${nombre}: importa el módulo de medidas`, () => {
    assert.match(src, /from '\.\/paper'/, 'no usa el módulo de medidas');
    assert.match(src, /medidasDePapel\(settings\.printPaperWidth\)/, 'no resuelve el ancho configurado');
  });

  check(`${nombre}: el ancho sale de las medidas, no de un literal`, () => {
    const codigo = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/size:\s*80mm/.test(codigo), 'quedó un @page de 80mm fijo');
    assert.ok(!/width:\s*80mm/.test(codigo), 'quedó un width de 80mm fijo');
    assert.match(codigo, /\$\{papel\.anchoMm\}mm/, 'el ancho no es dinámico');
  });

  check(`${nombre}: agrega el CSS de 58 mm solo cuando corresponde`, () => {
    assert.match(src, /cssExtraAngosto\(settings\.printPaperWidth\)/, 'no inyecta el CSS angosto');
  });
}

check('la impresión sigue siendo directa: nadie tocó el transporte', () => {
  const electronPrint = leer('../electronPrint.js');
  assert.ok(!/paper|ancho|58/i.test(electronPrint), 'el transporte se contaminó con el ancho');
  assert.match(electronPrint, /window\.electron\.printDirect/, 'cambió el camino de impresión');
});

// ---------------------------------------------------------------------------
console.log('\n5. El ancho viaja por la configuración que ya existía:');

check('cachedPrintSettings expone printPaperWidth con 80 por defecto', () => {
  assert.match(AJUSTES, /printPaperWidth: ANCHO_POR_DEFECTO/, 'no hay default de 80');
  assert.match(AJUSTES, /printPaperWidth: normalizarAncho\(settings\.printPaperWidth\)/,
    'no se normaliza lo que viene de CONFIGURACION');
});

check('el formulario guarda en el mismo settings de siempre', () => {
  const form = leer('../../../components/settings/local/PrintingSettings.jsx');
  assert.match(form, /Ancho del Papel/, 'no se ve la opción en pantalla');
  assert.match(form, /handleDirectChange\?\.\('printPaperWidth', ancho\)/, 'no guarda la selección');
  assert.match(form, /ANCHOS_SOPORTADOS/, 'las opciones no salen de la fuente única');
  // No inventa una ruta ni un mecanismo de guardado nuevo.
  assert.ok(!/fetch\(|firebase|set\(/i.test(form), 'el formulario escribe por su cuenta');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
