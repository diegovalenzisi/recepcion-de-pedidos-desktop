// ---------------------------------------------------------------------------
// PALETA DE TEMAS — FUENTE ÚNICA.
//
// El color del local vivía en TRES lugares que había que mantener a mano y en
// sincronía: el bloque `body[data-theme='x']` de index.css, la lista de
// círculos de ThemeSelector.jsx y el `themeColorMap` de useThemeButtonColors.js,
// que repetía los HSL en JavaScript. Agregar un color implicaba tocar los tres
// y era cuestión de tiempo que quedaran desalineados.
//
// Acá está la definición y de acá salen los tres consumidores.
//
// COMPATIBILIDAD: los seis nombres originales (orange, blue, green, magenta,
// red, golden) conservan EXACTAMENTE sus valores HSL. Están guardados en
// CONFIGURACION/themeColor de los locales y no pueden cambiar de aspecto.
// Ningún nombre existente se renombra nunca: la clave guardada en Firebase es
// la identidad del tema.
// ---------------------------------------------------------------------------

/**
 * Los temas BASE. Cada uno genera además su versión pastel (ver abajo), así que
 * agregar un color acá agrega automáticamente los dos.
 *
 * Los 6 primeros son los históricos, con sus valores originales intactos.
 */
const BASE = [
  // ---- históricos: NO cambiar los HSL ----
  { nombre: 'orange',    etiqueta: 'Naranja',        h: 24,  s: 95, l: 53, clase: 'bg-orange-500' },
  { nombre: 'blue',      etiqueta: 'Azul',           h: 217, s: 91, l: 60, clase: 'bg-blue-500' },
  { nombre: 'green',     etiqueta: 'Verde',          h: 142, s: 71, l: 45, clase: 'bg-green-500' },
  { nombre: 'golden',    etiqueta: 'Dorado',         h: 45,  s: 93, l: 47, clase: 'bg-amber-500' },
  { nombre: 'magenta',   etiqueta: 'Magenta',        h: 312, s: 84, l: 51, clase: 'bg-fuchsia-600' },
  { nombre: 'red',       etiqueta: 'Rojo',           h: 0,   s: 84, l: 60, clase: 'bg-red-600' },
  // ---- agregados después ----
  { nombre: 'orangeDark', etiqueta: 'Naranja oscuro', h: 18,  s: 88, l: 42, clase: 'bg-orange-700' },
  { nombre: 'yellow',     etiqueta: 'Amarillo',       h: 52,  s: 96, l: 50, clase: 'bg-yellow-400' },
  { nombre: 'greenDark',  etiqueta: 'Verde oscuro',   h: 152, s: 65, l: 30, clase: 'bg-green-800' },
  { nombre: 'lime',       etiqueta: 'Verde lima',     h: 84,  s: 78, l: 44, clase: 'bg-lime-500' },
  { nombre: 'aqua',       etiqueta: 'Verde agua',     h: 168, s: 72, l: 41, clase: 'bg-emerald-500' },
  { nombre: 'turquoise',  etiqueta: 'Turquesa',       h: 182, s: 80, l: 40, clase: 'bg-teal-500' },
  { nombre: 'skyBlue',    etiqueta: 'Celeste',        h: 199, s: 89, l: 55, clase: 'bg-sky-500' },
  { nombre: 'blueDark',   etiqueta: 'Azul oscuro',    h: 226, s: 71, l: 40, clase: 'bg-blue-800' },
  { nombre: 'indigo',     etiqueta: 'Índigo',         h: 243, s: 75, l: 59, clase: 'bg-indigo-500' },
  { nombre: 'violet',     etiqueta: 'Violeta',        h: 258, s: 82, l: 62, clase: 'bg-violet-500' },
  { nombre: 'purple',     etiqueta: 'Púrpura',        h: 280, s: 68, l: 45, clase: 'bg-purple-700' },
  { nombre: 'pink',       etiqueta: 'Rosa',           h: 330, s: 85, l: 60, clase: 'bg-pink-500' },
  { nombre: 'wine',       etiqueta: 'Bordó',          h: 348, s: 72, l: 36, clase: 'bg-rose-900' },
  { nombre: 'brown',      etiqueta: 'Marrón',         h: 25,  s: 45, l: 34, clase: 'bg-amber-900' },
  { nombre: 'slate',      etiqueta: 'Gris',           h: 215, s: 16, l: 42, clase: 'bg-slate-600' },
  // Almendra: beige cálido. Se separa del marrón por ser mucho más claro y
  // menos saturado, y del dorado/amarillo por tener el tono bastante más rojo.
  { nombre: 'almond',     etiqueta: 'Almendra',       h: 34,  s: 42, l: 62, clase: 'bg-[hsl(34,42%,62%)]' },
];

// ---------------------------------------------------------------------------
// VERSIÓN PASTEL
//
// No es opacidad: es un HSL propio. Se conserva el TONO —que es lo que hace
// reconocible al color— y se baja la saturación y se sube la luminosidad hasta
// una banda pastel común, para que los 22 pasteles se vean como una familia.
//
// La luminosidad es fija (84%) a propósito: si cada pastel heredara la del
// original, "Verde oscuro pastel" quedaría oscuro y no sería un pastel.
//
// La saturación se limita a [25, 65]: por debajo el color se vuelve gris y deja
// de distinguirse del resto; por encima deja de ser pastel. Pero nunca sube por
// encima de la del original: el pastel de un gris tiene que seguir siendo gris,
// no un gris MÁS colorido que el tema base.
// ---------------------------------------------------------------------------

const LUMINOSIDAD_PASTEL = 84;
const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

/** El pastel de un tema base. */
const pastelDe = (t) => ({
  nombre: `${t.nombre}Pastel`,
  etiqueta: `${t.etiqueta} pastel`,
  h: t.h,
  s: Math.min(t.s, limitar(Math.round(t.s * 0.55), 25, 65)),
  l: LUMINOSIDAD_PASTEL,
  clase: `bg-[hsl(${t.h},${Math.min(t.s, limitar(Math.round(t.s * 0.55), 25, 65))}%,${LUMINOSIDAD_PASTEL}%)]`,
  pastel: true,
});

/**
 * Los 22 base seguidos de sus 22 pasteles. Cada base aparece junto a su pastel
 * en el selector, para poder compararlos de un vistazo.
 */
export const TEMAS = Object.freeze(BASE.flatMap((t) => [Object.freeze({ ...t, pastel: false }), Object.freeze(pastelDe(t))]));

/** Nombre por defecto si el local no tiene tema configurado. */
export const TEMA_POR_DEFECTO = 'orange';

/** Los seis nombres que ya estaban en uso y no se pueden perder. */
export const TEMAS_HISTORICOS = Object.freeze(['orange', 'blue', 'green', 'golden', 'magenta', 'red']);

/** Índice por nombre. */
const PORNOMBRE = new Map(TEMAS.map((t) => [t.nombre, t]));

/** Tema por nombre, con caída al por defecto si no existe. */
export const temaPorNombre = (nombre) => PORNOMBRE.get(String(nombre ?? '')) || PORNOMBRE.get(TEMA_POR_DEFECTO);

/** ¿Es un nombre de tema conocido? */
export const esTemaValido = (nombre) => PORNOMBRE.has(String(nombre ?? ''));

/** ¿Este tema es una versión pastel? */
export const esPastel = (nombre) => temaPorNombre(nombre).pastel === true;

/** `hsl(24, 95%, 53%)` — el color primario del tema, para uso inline. */
export const colorDeTema = (nombre) => {
  const t = temaPorNombre(nombre);
  return `hsl(${t.h}, ${t.s}%, ${t.l}%)`;
};

/**
 * CONTRASTE DEL TEXTO SOBRE EL COLOR PRIMARIO.
 *
 * Los temas normales son oscuros y llevan texto casi blanco, como siempre. Un
 * pastel es claro: con texto blanco encima no se leería nada. Por eso cada
 * pastel define su propio `--primary-foreground`, un tono muy oscuro del MISMO
 * color, que además queda más elegante que un negro plano.
 *
 * Se devuelve en el formato de canales sueltos que usa Tailwind/shadcn
 * (`H S% L%`, sin `hsl()`), igual que el resto de las variables del tema.
 */
export const foregroundDeTema = (nombre) => {
  const t = temaPorNombre(nombre);
  return t.pastel ? `${t.h} 45% 20%` : '210 40% 98%';
};

/**
 * Mapa nombre → color, con la MISMA forma que el `themeColorMap` que estaba
 * escrito a mano en useThemeButtonColors.js.
 */
export const mapaDeColores = () =>
  Object.fromEntries(TEMAS.map((t) => [t.nombre, colorDeTema(t.nombre)]));

/**
 * Bloques CSS de todos los temas, para el `@layer base` de index.css.
 *
 * Se genera con esta función y se pega en el archivo: el test compara el CSS
 * real contra esta salida, así que si alguien agrega un tema y no regenera el
 * CSS, la prueba falla.
 *
 * Los pasteles agregan `--primary-foreground` para que el texto sobre el color
 * primario siga siendo legible.
 */
export const cssDeTemas = () =>
  TEMAS.map((t) => `  body[data-theme='${t.nombre}'] {
    --primary-hue: ${t.h};
    --primary-saturation: ${t.s}%;
    --primary-lightness: ${t.l}%;
    --primary-dark-lightness: ${t.l}%;${t.pastel ? `
    --primary-foreground: ${foregroundDeTema(t.nombre)};` : ''}
  }`).join('\n');
