// ---------------------------------------------------------------------------
// RUTAS POR LOCAL — REGLA OBLIGATORIA DE ALMACENAMIENTO
//
// Todo dato o archivo que pertenece a un local vive DENTRO de su número de local,
// y el número de local es SIEMPRE el primer segmento:
//
//   Realtime Database →  /{localId}/...      ej: /40508022/ARTICULOS
//   Firebase Storage  →  {localId}/...       ej: 40508022/articulos/156A.png
//
// Está PROHIBIDO el orden invertido (`ARTICULOS/40508022`, `facturas/40508022`,
// `locales/40508022/...`) y está prohibido escribir datos de un local en la raíz.
//
// FALLA SEGURA: sin un localId válido no se construye ninguna ruta — se lanza
// `LOCAL_ID_REQUIRED` y el caller debe cancelar la operación. Nunca se cae a la
// raíz, ni al último local seleccionado, ni a `undefined`/`null`/`default`.
// Así es imposible generar `/undefined/FACTURACION`, `/null/PEDIDOS`,
// `//ARTICULOS` o `undefined/facturas/`.
//
// Módulo puro: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// ---------------------------------------------------------------------------

/** Código de error único para "no hay local válido". Se compara por igualdad. */
export const LOCAL_ID_REQUERIDO = 'LOCAL_ID_REQUIRED';

/** Error tipado para poder distinguirlo de cualquier otro fallo de red o de Firebase. */
export class LocalIdRequeridoError extends Error {
  constructor(detalle = '') {
    super(LOCAL_ID_REQUERIDO + (detalle ? `: ${detalle}` : ''));
    this.name = 'LocalIdRequeridoError';
    this.code = LOCAL_ID_REQUERIDO;
  }
}

// Valores que NUNCA son un local real, aunque lleguen como string "válido".
// Son exactamente los que producen las rutas basura que hay que impedir.
const CENTINELAS = new Set([
  '', 'undefined', 'null', 'nan', 'default', 'none', 'nil', 'false', '0',
]);

// Caracteres prohibidos como clave de Realtime Database, más el espacio.
const CARACTERES_ILEGALES = /[.#$[\]\s]/;

/**
 * Normaliza el identificador de local (o la raíz de datos configurada para ese
 * local vía `databasePath`). Devuelve el valor limpio o `null` si no sirve.
 *
 * - recorta espacios y barras sobrantes al principio y al final;
 * - colapsa barras repetidas internas (`a//b` → `a/b`);
 * - rechaza centinelas (`undefined`, `null`, `default`, vacío, `0`, …);
 * - rechaza claves con caracteres ilegales de RTDB (`.`, `#`, `$`, `[`, `]`) o espacios.
 *
 * NO exige que sea numérico: un local puede tener una raíz propia configurada
 * (`databasePath`), y esa raíz cumple el mismo rol que el número de local.
 */
export function normalizarLocalId(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor === 0) return null;
    return String(valor);
  }
  if (typeof valor !== 'string') return null;

  const limpio = valor.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!limpio) return null;
  if (CENTINELAS.has(limpio.toLowerCase())) return null;
  if (CARACTERES_ILEGALES.test(limpio)) return null;
  // Un segmento vacío interno (que quedaría de "a///b") ya fue colapsado; si
  // aun así queda alguno, la ruta no es utilizable.
  if (limpio.split('/').some((s) => s.length === 0)) return null;
  return limpio;
}

/** ¿Este valor sirve como identificador de local? */
export function esLocalIdValido(valor) {
  return normalizarLocalId(valor) !== null;
}

/** Limpia el tramo relativo: sin barras al borde, sin barras repetidas. */
function normalizarRutaRelativa(ruta) {
  if (ruta === null || ruta === undefined) return '';
  const s = String(ruta).trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  return s;
}

/**
 * Ruta de Realtime Database DENTRO del local. El localId queda SIEMPRE como
 * primer segmento. Sin local válido lanza `LOCAL_ID_REQUIRED`.
 *
 *   construirRutaLocal('40508022', 'ARTICULOS')  → '40508022/ARTICULOS'
 *   construirRutaLocal('40508022')               → '40508022'
 *   construirRutaLocal(undefined, 'PEDIDOS')     → lanza LOCAL_ID_REQUIRED
 */
export function construirRutaLocal(localId, ruta = '') {
  const id = normalizarLocalId(localId);
  if (!id) throw new LocalIdRequeridoError(`localId inválido: ${JSON.stringify(localId)}`);
  const rel = normalizarRutaRelativa(ruta);
  return rel ? `${id}/${rel}` : id;
}

/**
 * Ruta de Firebase Storage DENTRO del local. Mismo contrato que la de RTDB, pero
 * sin ruta devuelve el prefijo con barra final (`'40508022/'`), que es la forma
 * en que se usa como prefijo de carpeta.
 */
export function construirRutaStorageLocal(localId, ruta = '') {
  const id = normalizarLocalId(localId);
  if (!id) throw new LocalIdRequeridoError(`localId inválido: ${JSON.stringify(localId)}`);
  const rel = normalizarRutaRelativa(ruta);
  return rel ? `${id}/${rel}` : `${id}/`;
}

// ---------------------------------------------------------------------------
// Verificación de pertenencia
// ---------------------------------------------------------------------------

/**
 * ¿Esta ruta pertenece al local indicado? Es la comprobación que usan los tests
 * y las guardas: sirve tanto para RTDB (`40508022/ARTICULOS`) como para Storage
 * (`40508022/articulos/x.png`), con o sin barra inicial.
 */
export function rutaPerteneceAlLocal(ruta, localId) {
  const id = normalizarLocalId(localId);
  if (!id) return false;
  const limpia = String(ruta ?? '').trim().replace(/^\/+/, '');
  if (!limpia) return false;
  return limpia === id || limpia.startsWith(`${id}/`);
}

/** Primer segmento de una ruta (el que debe ser el número de local). */
export function primerSegmento(ruta) {
  const limpia = String(ruta ?? '').trim().replace(/^\/+/, '');
  if (!limpia) return null;
  const seg = limpia.split('/')[0];
  return seg || null;
}

// ---------------------------------------------------------------------------
// Rutas GLOBALES autorizadas
//
// Una ruta NO es global por estar hoy en la raíz. Solo lo es si no pertenece a
// ningún comercio. Las únicas autorizadas son las del actualizador general y el
// registro central que resuelve DÓNDE vive cada local (que por definición se lee
// ANTES de saber cuál es la raíz del local).
// ---------------------------------------------------------------------------

/** Prefijos de Storage que pueden vivir fuera de un local. */
export const STORAGE_GLOBALES = Object.freeze([
  'instalaciones/software/',   // instalador, latest.json y bootstrap del actualizador
]);

/** Nodos de RTDB que pueden vivir fuera de un local. */
export const RTDB_GLOBALES = Object.freeze([
  'rutas/',     // registro central de rutas por local (Desktop) — bootstrap
  'ids/',       // ídem en Tablet — bootstrap
  '.info/',     // nodo interno del SDK de Firebase (estado de conexión), no es un dato
]);

const empiezaConAlguno = (ruta, prefijos) => {
  const limpia = String(ruta ?? '').trim().replace(/^\/+/, '');
  return prefijos.some((p) => limpia === p.replace(/\/$/, '') || limpia.startsWith(p));
};

/** ¿Esta ruta de Storage está autorizada a vivir fuera de un local? */
export function esStorageGlobalPermitido(ruta) {
  return empiezaConAlguno(ruta, STORAGE_GLOBALES);
}

/** ¿Este nodo de RTDB está autorizado a vivir fuera de un local? */
export function esRtdbGlobalPermitido(ruta) {
  return empiezaConAlguno(ruta, RTDB_GLOBALES);
}

// ---------------------------------------------------------------------------
// Guarda de CAMBIO DE LOCAL
// ---------------------------------------------------------------------------

/**
 * Verifica que la operación que empezó en `localIdInicial` siga corriendo en el
 * mismo local antes de escribir. Es la red que impide que una promesa pendiente
 * del local anterior escriba después de que el usuario cambió de local.
 *
 * Lanza `LOCAL_ID_REQUIRED` si alguno de los dos no es válido, y un error de
 * cambio de local si difieren. Nunca devuelve `false` en silencio: quien la usa
 * debe abortar.
 */
export function verificarMismoLocal(localIdInicial, localIdActual) {
  const inicial = normalizarLocalId(localIdInicial);
  const actual = normalizarLocalId(localIdActual);
  if (!inicial || !actual) {
    throw new LocalIdRequeridoError(
      `operación sin local válido (inicial=${JSON.stringify(localIdInicial)}, actual=${JSON.stringify(localIdActual)})`
    );
  }
  if (inicial !== actual) {
    const e = new Error(`LOCAL_CHANGED: la operación empezó en "${inicial}" y el local actual es "${actual}"`);
    e.code = 'LOCAL_CHANGED';
    e.localInicial = inicial;
    e.localActual = actual;
    throw e;
  }
  return inicial;
}
