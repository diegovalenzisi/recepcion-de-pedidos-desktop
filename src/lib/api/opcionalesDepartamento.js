// ---------------------------------------------------------------------------
// GRUPOS DE OPCIONALES CON ORIGEN EN UN DEPARTAMENTO
//
// Un grupo manual sigue funcionando exactamente igual: sus opciones salen de
// OPCIONALES/{id} y su precio de `precio`. Un grupo con origen `departamento`
// no guarda copia de los artículos: resuelve dinámicamente los artículos
// ACTUALES del departamento, y toma precio y costo del artículo real.
//
// Configuración del grupo (se persiste SOLO si se editó con la función nueva;
// un grupo sin `origen` se lee como manual y no se migra):
//
//   {
//     origen: "departamento",
//     departamentoId: "D-TOP",          // ID completo, nunca solo dígitos
//     usarPrecioArticulo: true,
//     controlarStock: true,
//     consumoStockUnitarioDefault: 1,
//     consumosPorArticulo: { "A-ROCKLETS": 1, "A-VASITOS": 2 }   // solo overrides
//   }
//
// Módulo puro: recibe catálogos ya leídos. Idéntico en los tres repos.
// ---------------------------------------------------------------------------

import { idCanonico, mismoIdExacto } from './idsCanonicos.js';
import { normalizarImporte } from './optionalsPricing.js';

/**
 * Tipo de stock efectivo de un artículo, con la misma regla que ya usa el
 * sistema. Vive acá (y no en stockPlan) porque DLV Pedidos necesita inspeccionar
 * artículos para mostrar opciones, pero NO tiene el motor de stock.
 */
export function tipoDeStock(articulo) {
  const s = (articulo && articulo.stock) || {};
  if (s.stockType) return s.stockType;
  if (s.receta && Object.keys(s.receta).length > 0) return 'receta';
  if (s.heredadoDe) return 'heredado';
  if (s.propio !== undefined) return 'propio';
  return 'ninguno';
}

export const ORIGEN_MANUAL = 'manual';
export const ORIGEN_DEPARTAMENTO = 'departamento';

/**
 * Origen efectivo de un grupo. Un grupo existente SIN el campo se comporta como
 * manual; no se migra ni se le escriben campos nuevos al leerlo.
 */
export function origenDeGrupo(config) {
  return (config && config.origen === ORIGEN_DEPARTAMENTO) ? ORIGEN_DEPARTAMENTO : ORIGEN_MANUAL;
}

/** Configuración normalizada de un grupo por departamento (sin tocar el original). */
export function configDepartamento(config) {
  if (origenDeGrupo(config) !== ORIGEN_DEPARTAMENTO) return null;
  return {
    departamentoId: idCanonico(config.departamentoId),
    usarPrecioArticulo: config.usarPrecioArticulo !== false,
    controlarStock: config.controlarStock !== false,
    consumoDefault: resolverConsumoNumerico(config.consumoStockUnitarioDefault, 1),
    overrides: (config.consumosPorArticulo && typeof config.consumosPorArticulo === 'object')
      ? config.consumosPorArticulo : {},
  };
}

/** Consumo válido: número finito y mayor que cero. Si no, el valor por defecto. */
function resolverConsumoNumerico(valor, porDefecto) {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  const n = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
  return (Number.isFinite(n) && n > 0) ? n : porDefecto;
}

/**
 * Consumo efectivo de un artículo dentro de un grupo.
 * Override por articleId → default del grupo. NUNCA se deduce del nombre:
 * "Vasitos x 5" no descuenta 5 salvo que esté configurado así.
 *
 * @returns {{ consumo:number, fuente:'override'|'default', valido:boolean, motivo?:string }}
 */
export function consumoEfectivo(config, articleId) {
  const cfg = configDepartamento(config);
  if (!cfg) return { consumo: 0, fuente: 'default', valido: false, motivo: 'grupo-no-es-departamento' };

  const id = idCanonico(articleId);
  const crudoOverride = id ? cfg.overrides[id] : undefined;

  if (crudoOverride !== undefined) {
    const n = typeof crudoOverride === 'string' ? Number(String(crudoOverride).replace(',', '.')) : Number(crudoOverride);
    if (!Number.isFinite(n) || n <= 0) {
      return { consumo: cfg.consumoDefault, fuente: 'default', valido: false, motivo: 'override-invalido' };
    }
    return { consumo: n, fuente: 'override', valido: true };
  }
  return { consumo: cfg.consumoDefault, fuente: 'default', valido: cfg.consumoDefault > 0 };
}

/**
 * Costo EFECTIVO de un artículo, con la misma regla que ya usa el sistema para
 * un artículo normal: costo de receta si la tiene, costo del padre si hereda,
 * costo unitario si es propio. Nunca se usa `valor` (precio de venta) como costo.
 */
export function costoEfectivo(articleId, articulos = {}, materiaPrima = {}, visitados = new Set()) {
  const id = idCanonico(articleId);
  if (!id || visitados.has(id)) return 0;
  const vistos = new Set(visitados); vistos.add(id);

  const art = articulos[id];
  if (!art) {
    const mp = materiaPrima[id];
    if (!mp) return 0;
    const n = Number(mp.costoUnitario ?? mp.costo ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  // Si el artículo ya trae el costo consolidado, se respeta: es el mismo campo
  // que usan los informes actuales.
  const consolidado = Number(art.costoTotalReceta);
  if (Number.isFinite(consolidado) && consolidado > 0) return consolidado;

  const tipo = tipoDeStock(art);
  if (tipo === 'heredado' && art.stock.heredadoDe) {
    return costoEfectivo(art.stock.heredadoDe, articulos, materiaPrima, vistos);
  }
  if (tipo === 'receta' && art.stock.receta) {
    const receta = art.stock.receta;
    const entradas = Array.isArray(receta)
      ? receta.map((i) => [i.codigo || i.id || i.nombre, i.cantidad])
      : Object.entries(receta);
    let total = 0;
    for (const [ingId, cant] of entradas) {
      const q = Number(String(cant).replace(',', '.'));
      if (!ingId || !Number.isFinite(q)) continue;
      total += q * costoEfectivo(ingId, articulos, materiaPrima, vistos);
    }
    return total;
  }
  const propio = Number(art.costoUnitario ?? art.costo ?? 0);
  return Number.isFinite(propio) ? propio : 0;
}

/**
 * Resuelve las opciones ACTUALES de un grupo por departamento.
 * Filtra por local (el catálogo recibido ya es del local), departamento EXACTO,
 * activo según el canal y disponibilidad según el motor que se le pase.
 *
 * @param {object} params
 *   config        — configuración del grupo
 *   articulos     — ARTICULOS del local
 *   materiaPrima  — MATERIA_PRIMA del local
 *   canal         — 'delivery' | 'mostrador'
 *   estaDisponible— (articleId) => boolean  (isArticleAvailable del sistema)
 */
export function resolverOpcionesDeDepartamento({ config, articulos = {}, materiaPrima = {}, canal = 'mostrador', estaDisponible = null }) {
  const cfg = configDepartamento(config);
  if (!cfg || !cfg.departamentoId) return { opciones: [], avisos: [{ tipo: 'grupo-sin-departamento' }] };

  const avisos = [];
  const opciones = [];

  for (const [articleId, art] of Object.entries(articulos)) {
    if (!art || art.eliminado === true) continue;
    // Comparación por ID EXACTO. Nunca por nombre, nunca normalizando dígitos.
    if (!mismoIdExacto(art.departamento, cfg.departamentoId)) continue;

    const activo = canal === 'delivery' ? art.activoDelivery !== false : art.activoMostrador !== false;
    if (!activo) continue;

    const rPrecio = normalizarImporte(cfg.usarPrecioArticulo ? art.valor : undefined);
    const { consumo, fuente, valido: consumoValido, motivo } = consumoEfectivo(config, articleId);
    if (!consumoValido && motivo) avisos.push({ tipo: 'consumo-invalido', articleId, motivo });

    const controlaStock = cfg.controlarStock && art.controlStock !== false;
    const disponible = typeof estaDisponible === 'function' ? !!estaDisponible(articleId) : true;

    opciones.push({
      articleId,
      departamentoId: cfg.departamentoId,
      nombre: art.nombre || '(sin nombre)',
      // El precio sale del ARTÍCULO REAL, no de OPCIONALES.
      precio: rPrecio.valido && !rPrecio.ausente ? rPrecio.valor : 0,
      precioInvalido: !rPrecio.valido,
      costo: costoEfectivo(articleId, articulos, materiaPrima),
      stock: Number(art.stock?.propio ?? 0),
      controlaStock,
      consumoStockUnitario: controlaStock ? consumo : 0,
      consumoFuente: fuente,
      activo,
      disponible,
      origen: ORIGEN_DEPARTAMENTO,
      grupoId: config.id || null,
      grupoNombre: config.nombre || null,
    });
  }

  opciones.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  return { opciones, avisos };
}

/**
 * Snapshot que se persiste cuando el cliente elige una opción de departamento.
 * Congela nombre, precio, costo y consumo: si mañana cambia el artículo, el
 * historial y la ganancia no se mueven.
 */
export function construirSnapshotDepartamento(opcion, { cantidad = 1, unidadIndice = null, unidadTotal = null } = {}) {
  const cant = Number(cantidad) > 0 ? Number(cantidad) : 1;
  const precioUnitario = Number(opcion.precio) || 0;
  const costoUnitario = Number(opcion.costo) || 0;
  const consumoUnit = Number(opcion.consumoStockUnitario) || 0;
  return {
    grupoId: opcion.grupoId ?? null,
    grupoNombre: opcion.grupoNombre ?? null,
    origen: ORIGEN_DEPARTAMENTO,
    articleId: opcion.articleId,
    departamentoId: opcion.departamentoId,
    nombre: opcion.nombre,
    precioUnitario,
    cantidad: cant,
    total: precioUnitario * cant,
    costoUnitarioAplicado: costoUnitario,
    costoTotal: costoUnitario * cant,
    controlaStock: !!opcion.controlaStock,
    consumoStockUnitario: consumoUnit,
    consumoStockTotal: consumoUnit * cant,
    unidadIndice,
    unidadTotal,
    // Alias histórico para que impresión y resumen sigan funcionando.
    precio: precioUnitario,
    quantity: cant,
  };
}
