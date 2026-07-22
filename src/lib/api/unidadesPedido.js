// ---------------------------------------------------------------------------
// Manejo de UNIDADES de una línea del carrito.
//
// Regla del negocio: cada unidad de un artículo con opcionales se configura por
// separado y vive como su propia línea con quantity: 1. Nunca se copia la
// selección de una unidad a otra ni se multiplica un opcional por la cantidad.
// Los artículos SIN opcionales conservan el comportamiento de siempre (se
// agrupan y suben/bajan por `quantity`).
//
// Funciones puras: sin React, sin Firebase, sin DOM. Módulo compartido entre
// Desktop y Tablet (deben ser byte a byte idénticos).
// ---------------------------------------------------------------------------

/** ¿Esta línea se configura por unidad? (tiene opcionales elegidos) */
export function esLineaConfigurable(item) {
  return !!(item && item.selectedOptionals);
}

/**
 * Renumera unidadIndice/unidadTotal por artículo, para poder mostrar
 * "Unidad N de M". Afecta SOLO la presentación: no toca uniqueId, ni
 * selectedOptionals, ni ningún importe.
 */
export function renumerarUnidades(items) {
  const lista = Array.isArray(items) ? items : [];
  const totales = {};
  lista.forEach((it) => {
    if (esLineaConfigurable(it)) totales[it.id] = (totales[it.id] || 0) + 1;
  });
  const vistos = {};
  return lista.map((it) => {
    if (!esLineaConfigurable(it)) return it;
    vistos[it.id] = (vistos[it.id] || 0) + 1;
    return { ...it, unidadIndice: vistos[it.id], unidadTotal: totales[it.id] };
  });
}

/**
 * Quita LA línea indicada (no "la última" ni "una cualquiera del mismo
 * artículo") y renumera la presentación. Las demás unidades conservan su
 * uniqueId y su selección intactos.
 */
export function quitarUnidad(items, uniqueId) {
  const lista = Array.isArray(items) ? items : [];
  return renumerarUnidades(lista.filter((i) => i && i.uniqueId !== uniqueId));
}

/**
 * Cuántas unidades configuradas hay ya de un artículo. Se usa para titular el
 * selector de la unidad NUEVA ("Unidad 3 de 3") antes de agregarla al carrito.
 */
export function contarUnidadesConfiguradas(items, articuloId) {
  const lista = Array.isArray(items) ? items : [];
  return lista.filter((i) => i && i.id === articuloId && esLineaConfigurable(i)).length;
}

/**
 * Datos base para configurar una unidad nueva: se parte del artículo del
 * catálogo (o de la línea, si no está) y se limpian los campos propios de otra
 * unidad, para que NO se arrastre la selección anterior.
 */
export function baseParaUnidadNueva(articulo) {
  if (!articulo || typeof articulo !== 'object') return articulo;
  const {
    selectedOptionals: _so,
    uniqueId: _u,
    quantity: _q,
    unidadIndice: _ui,
    unidadTotal: _ut,
    subtotalLinea: _sl,
    precioBaseUnitario: _pb,
    totalOpcionales: _to,
    ...limpio
  } = articulo;
  return limpio;
}

/** Agrega una unidad ya confirmada al carrito, siempre con quantity: 1. */
export function agregarUnidadConfigurada(items, articuloConfigurado, uniqueId) {
  const lista = Array.isArray(items) ? items : [];
  return renumerarUnidades([...lista, { ...articuloConfigurado, quantity: 1, uniqueId }]);
}
