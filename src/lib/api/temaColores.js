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
// ---------------------------------------------------------------------------

/**
 * Cada tema: nombre guardado en Firebase, etiqueta visible, HSL de la variable
 * primaria y la clase Tailwind del círculo del selector.
 *
 * Los 6 primeros son los históricos, con sus valores originales intactos.
 */
export const TEMAS = Object.freeze([
  // ---- históricos: NO cambiar los HSL ----
  { nombre: 'orange',    etiqueta: 'Naranja',        h: 24,  s: 95, l: 53, clase: 'bg-orange-500' },
  { nombre: 'blue',      etiqueta: 'Azul',           h: 217, s: 91, l: 60, clase: 'bg-blue-500' },
  { nombre: 'green',     etiqueta: 'Verde',          h: 142, s: 71, l: 45, clase: 'bg-green-500' },
  { nombre: 'golden',    etiqueta: 'Dorado',         h: 45,  s: 93, l: 47, clase: 'bg-amber-500' },
  { nombre: 'magenta',   etiqueta: 'Magenta',        h: 312, s: 84, l: 51, clase: 'bg-fuchsia-600' },
  { nombre: 'red',       etiqueta: 'Rojo',           h: 0,   s: 84, l: 60, clase: 'bg-red-600' },
  // ---- nuevos ----
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
]);

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

/** `hsl(24, 95%, 53%)` — el color primario del tema, para uso inline. */
export const colorDeTema = (nombre) => {
  const t = temaPorNombre(nombre);
  return `hsl(${t.h}, ${t.s}%, ${t.l}%)`;
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
 */
export const cssDeTemas = () =>
  TEMAS.map((t) => `  body[data-theme='${t.nombre}'] {
    --primary-hue: ${t.h};
    --primary-saturation: ${t.s}%;
    --primary-lightness: ${t.l}%;
    --primary-dark-lightness: ${t.l}%;
  }`).join('\n');
