// Fase 2 — punto 9: qué opciones ve el cliente en un grupo, sea manual o por
// departamento. Único punto donde se decide; los tres sistemas lo usan igual.
//
// Un grupo manual sigue leyendo `opcionales[]` exactamente como antes. Un grupo
// por departamento NUNCA lee `opcionales[]`: resuelve el catálogo vigente del
// local por ID de departamento exacto. Por eso la lista se arma en un solo lugar
// y las pantallas sólo dibujan lo que reciben.
import {
  ORIGEN_MANUAL,
  ORIGEN_DEPARTAMENTO,
  origenDeGrupo,
  resolverOpcionesDeDepartamento,
  construirSnapshotDepartamento,
} from './opcionalesDepartamento.js';
import { obtenerPrecioOpcional, precioOpcionalInvalido } from './optionalsPricing.js';

export { ORIGEN_MANUAL, ORIGEN_DEPARTAMENTO };

/**
 * Une la configuración del grupo en el artículo (activo/min/max/obligatorio y,
 * en los manuales, la lista de opciones) con la definición del grupo en el
 * catálogo (origen y datos de departamento). La definición manda en el origen:
 * el artículo no puede declarar un origen distinto al del grupo.
 */
export function combinarConfigDeGrupo(configEnArticulo, grupoDelCatalogo) {
  const enArt = configEnArticulo && typeof configEnArticulo === 'object' ? configEnArticulo : {};
  const grupo = grupoDelCatalogo && typeof grupoDelCatalogo === 'object' ? grupoDelCatalogo : {};
  const combinado = { ...enArt };

  if (grupo.nombre !== undefined && combinado.nombre === undefined) combinado.nombre = grupo.nombre;
  if (combinado.id === undefined) combinado.id = grupo.codigo || grupo.id || enArt.id;

  if (origenDeGrupo(grupo) === ORIGEN_DEPARTAMENTO) {
    combinado.origen = ORIGEN_DEPARTAMENTO;
    combinado.departamentoId = grupo.departamentoId;
    combinado.usarPrecioArticulo = grupo.usarPrecioArticulo;
    combinado.controlarStock = grupo.controlarStock;
    combinado.consumoStockUnitarioDefault = grupo.consumoStockUnitarioDefault;
    combinado.consumosPorArticulo = grupo.consumosPorArticulo;
  } else {
    // Manual: no se escribe `origen`, para no migrar grupos viejos al leerlos.
    delete combinado.departamentoId;
    delete combinado.consumosPorArticulo;
  }
  return combinado;
}

/**
 * Opciones visibles de un grupo, ya en la forma que las pantallas dibujan.
 *
 * @param config             configuración combinada del grupo
 * @param opcionalesManuales OPCIONALES del local (sólo se usa si el grupo es manual)
 * @param articulos          ARTICULOS del local (sólo si es por departamento)
 * @param materiaPrima       MATERIA_PRIMA del local (para el costo por receta)
 * @param canal              'delivery' | 'mostrador'
 * @param estaDisponible     (articleId) => boolean, la disponibilidad real del sistema
 * @param ordenPersonalizado ids en el orden elegido por el usuario (grupos manuales)
 */
export function opcionesVisiblesDeGrupo({
  config,
  opcionalesManuales = [],
  articulos = {},
  materiaPrima = {},
  canal = 'mostrador',
  estaDisponible = null,
  ordenPersonalizado = null,
} = {}) {
  const cfg = config && typeof config === 'object' ? config : {};
  const grupoId = cfg.id || null;

  if (origenDeGrupo(cfg) !== ORIGEN_DEPARTAMENTO) {
    const ids = Array.isArray(ordenPersonalizado) && ordenPersonalizado.length > 0
      ? ordenPersonalizado
      : (Array.isArray(cfg.opcionales) ? cfg.opcionales : []);
    const opciones = ids
      .map((id) => (opcionalesManuales || []).find((op) => op && op.id === id && op.grupo === grupoId))
      .filter(Boolean)
      .map((op) => ({
        ...op,
        origen: ORIGEN_MANUAL,
        grupoId,
        grupoNombre: cfg.nombre || null,
        optionalId: op.id,
        articleId: op.articleId || null,
        precioInvalido: precioOpcionalInvalido(op),
        precioMostrado: obtenerPrecioOpcional(op),
        controlaStock: false,
        consumoStockUnitario: 0,
        disponible: true,
      }));
    return { opciones, avisos: [] };
  }

  const { opciones, avisos } = resolverOpcionesDeDepartamento({
    config: cfg, articulos, materiaPrima, canal, estaDisponible,
  });

  return {
    opciones: opciones.map((o) => ({
      ...o,
      // El ID visible de una opción dinámica ES el artículo: no hay registro en
      // OPCIONALES al que referirse.
      id: o.articleId,
      optionalId: o.articleId,
      grupoId,
      grupoNombre: cfg.nombre || null,
      precioMostrado: o.precioInvalido ? 0 : o.precio,
    })),
    avisos,
  };
}

/**
 * Cómo se muestra una opción al cliente. Nunca "+$0", nunca NaN/undefined, y
 * jamás el costo ni el consumo de stock.
 */
export function etiquetaDeOpcion(opcion, { formatearImporte } = {}) {
  const o = opcion && typeof opcion === 'object' ? opcion : {};
  const nombre = typeof o.nombre === 'string' && o.nombre.trim() !== '' ? o.nombre : '(sin nombre)';
  if (o.precioInvalido) return `${nombre} — precio inválido`;
  const precio = Number(o.precioMostrado);
  if (!Number.isFinite(precio) || precio <= 0) return nombre;
  const fmt = typeof formatearImporte === 'function'
    ? formatearImporte(precio)
    : `$${precio.toLocaleString('es-AR')}`;
  return `${nombre} (+${fmt})`;
}

/** ¿Se puede elegir? Sin stock queda visible pero bloqueada, nunca oculta. */
export function opcionSeleccionable(opcion) {
  const o = opcion && typeof opcion === 'object' ? opcion : {};
  if (o.precioInvalido) return false;
  if (o.disponible === false) return false;
  return true;
}

/**
 * Snapshot que se guarda al confirmar. Los dinámicos usan el congelador ya
 * probado; los manuales conservan su forma histórica intacta.
 */
export function snapshotDeOpcion(opcion, { cantidad = 1, unidadIndice = null, unidadTotal = null } = {}) {
  const o = opcion && typeof opcion === 'object' ? opcion : {};
  if (o.origen === ORIGEN_DEPARTAMENTO) {
    return construirSnapshotDepartamento(o, { cantidad, unidadIndice, unidadTotal });
  }
  const cant = Number(cantidad) > 0 ? Number(cantidad) : 1;
  const precioUnitario = obtenerPrecioOpcional(o);
  return {
    id: o.id,
    nombre: o.nombre,
    precio: precioUnitario,
    quantity: cant,
    grupoId: o.grupoId ?? null,
    grupoNombre: o.grupoNombre ?? null,
    origen: ORIGEN_MANUAL,
    articleId: o.articleId || null,
    unidadIndice,
    unidadTotal,
  };
}
