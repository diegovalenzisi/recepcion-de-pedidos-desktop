// ---------------------------------------------------------------------------
// APAGADO AUTOMÁTICO POR FALTA DE STOCK DE MATERIA PRIMA
//
// Cuando el stock de una materia prima llega a 0 o queda negativo:
//   · la MATERIA PRIMA pasa a `activo = false`;
//   · cada ARTÍCULO que la usa en su receta pasa a `activoDelivery = false`.
//
// Cuando el stock vuelve, se restauran los estados anteriores SOLO si el apagado
// había sido automático y antes estaban activos. Nunca se reactiva algo que el
// usuario apagó manualmente. Un artículo puede depender de varias materias primas
// (mapa `materiasPrimasBloqueantes`): recién se restaura cuando NO queda ninguna.
//
// IGNORA STOCK (`MATERIA_PRIMA/{id}/ignoraStock`): una materia prima marcada así
// deja de considerarse agotada. Su stock se sigue descontando y puede quedar
// negativo (se ve tal cual para reponer), pero ni ella ni los artículos que la
// usan se apagan por falta de stock. Campo AUSENTE = false. "Ignora Stock" solo
// ignora el STOCK: jamás una desactivación MANUAL (`activo === false`).
//
//   disponible = activo !== false && (ignoraStock === true || stock suficiente)
//
// NUNCA se toca `ARTICULOS/{id}/activo`. NUNCA se escribe
// `MATERIA_PRIMA/{id}/activoDelivery` (esa automatización anterior era incorrecta
// y fue reemplazada).
//
// Campos técnicos:
//   MATERIA_PRIMA/{id}: activo, ignoraStock,
//                       apagadoAutomaticoPorStock, activoAntesDeAgotarse
//   ARTICULOS/{id}:     activoDelivery,
//                       apagadoDeliveryAutomaticoPorMateriaPrima,
//                       activoDeliveryAntesDeFaltaMateriaPrima,
//                       materiasPrimasBloqueantes: { "<mpId>": true, ... }
//
// Todas las reglas se computan desde el estado propio del nodo (más el conjunto
// de materias primas bloqueantes ya resuelto), por eso son IDEMPOTENTES y seguras
// ante concurrencia: dos PCs/Tablets convergen al mismo resultado.
//
// Módulo puro: sin Firebase, sin React, sin DOM. Idéntico en los tres repos.
// ---------------------------------------------------------------------------

const obj = (x) => (x && typeof x === 'object' ? x : {});

/** Cantidad numérica tolerante a coma decimal y strings. Nunca NaN. */
export function normalizarStock(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : 0; }
  return 0;
}

/** ¿El stock cuenta como agotado (0 o negativo, o valor no interpretable)? */
export function stockAgotado(v) {
  return normalizarStock(v) <= 0;
}

// ---------------------------------------------------------------------------
// IGNORA STOCK
// ---------------------------------------------------------------------------

/**
 * ¿La materia prima tiene el interruptor "Ignora Stock" encendido? Lectura
 * cruda del campo: AUSENTE (o cualquier valor que no sea `true`) = false. Se usa
 * donde todavía se está DECIDIENDO `activo` — por eso no mira `activo`.
 */
export function tieneIgnoraStock(nodoMP) {
  return !!(nodoMP && typeof nodoMP === 'object' && nodoMP.ignoraStock === true);
}

/**
 * ¿Hay que ignorar el stock de esta materia prima al evaluar disponibilidad y
 * consumo? Es la regla ÚNICA que comparten Desktop, Tablet y DLV Pedidos:
 *
 *     ignora = ignoraStock === true && activo !== false
 *
 * La segunda condición es la que impide que "Ignora Stock" pise una
 * desactivación MANUAL: si el usuario apagó la materia prima, sigue apagada y
 * su stock vuelve a evaluarse exactamente como antes de existir esta opción.
 */
export function materiaPrimaIgnoraStock(nodoMP) {
  if (!tieneIgnoraStock(nodoMP)) return false;
  return nodoMP.activo !== false;
}

// ---------------------------------------------------------------------------
// MATERIA PRIMA: activo según stock
// ---------------------------------------------------------------------------

/**
 * Transición de `activo` de una materia prima según su stock. No muta el nodo:
 * devuelve `{ patch }` con los campos a escribir (null = borrar en Firebase).
 * Idempotente.
 *
 * Con `ignoraStock === true` la materia prima NUNCA cuenta como agotada, así que
 * cae siempre en la rama de "reposición": si estaba apagada AUTOMÁTICAMENTE y
 * antes estaba activa, se restaura y se borran sus marcadores; si la había
 * apagado el usuario a mano (sin marcadores), sigue apagada. Acá se lee el campo
 * CRUDO (`tieneIgnoraStock`) y no la regla efectiva, justamente porque esta
 * función es la que decide `activo`.
 */
export function aplicarReglaMateriaPrima(nodo) {
  const n = obj(nodo);
  const patch = {};
  const set = (k, v) => { const a = n[k] === undefined ? null : n[k]; if (a !== v) patch[k] = v; };

  if (!tieneIgnoraStock(n) && stockAgotado(n.stock)) {
    if (n.activo === true && n.apagadoAutomaticoPorStock !== true) {
      set('activoAntesDeAgotarse', true);
      set('apagadoAutomaticoPorStock', true);
    }
    set('activo', false);
  } else {
    if (n.apagadoAutomaticoPorStock === true && n.activoAntesDeAgotarse === true) {
      set('activo', true);
    }
    set('apagadoAutomaticoPorStock', null);
    set('activoAntesDeAgotarse', null);
  }
  return { patch };
}

/** Aplica el patch de MP a un nodo nuevo (null borra). Reductor de runTransaction. */
export function aplicarReglaMateriaPrimaANodo(nodo) {
  const base = { ...obj(nodo) };
  const { patch } = aplicarReglaMateriaPrima(base);
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete base[k]; else base[k] = v; }
  return { nodo: base, patch, cambio: Object.keys(patch).length > 0 };
}

/**
 * Edición MANUAL de `activo` de una materia prima.
 *  - stock > 0 (o `ignoraStock === true`): aplica el valor deseado y limpia
 *    marcadores. Con "Ignora Stock" encendido, encender la materia prima
 *    funciona aunque su stock esté en 0 o negativo.
 *  - stock <= 0 y ENCIENDE: queda `activo=false` pero registra intención de
 *    restaurar al reponer.
 *  - stock <= 0 y APAGA: cancela la restauración automática (limpia marcadores).
 */
export function resolverToggleManualMateriaPrima(nodo, activoDeseado) {
  const n = obj(nodo);
  const deseado = activoDeseado === true;
  const patch = {};
  if (tieneIgnoraStock(n) || !stockAgotado(n.stock)) {
    patch.activo = deseado;
    patch.apagadoAutomaticoPorStock = null;
    patch.activoAntesDeAgotarse = null;
    return { patch };
  }
  patch.activo = false;
  if (deseado) {
    patch.apagadoAutomaticoPorStock = true;
    patch.activoAntesDeAgotarse = true;
  } else {
    patch.apagadoAutomaticoPorStock = null;
    patch.activoAntesDeAgotarse = null;
  }
  return { patch };
}

/**
 * ¿Una materia prima está DISPONIBLE para producir? Se usa para decidir si
 * bloquea a los artículos que la usan. `controlStock === false` = ilimitada.
 *
 *     disponible = activo !== false && (ignoraStock === true || stock suficiente)
 *
 * Una materia prima con "Ignora Stock" nunca bloquea por stock (aunque esté en
 * 0 o negativo), pero una desactivación MANUAL la sigue bloqueando.
 */
export function materiaPrimaDisponible(nodoMP) {
  const n = nodoMP;
  if (!n || typeof n !== 'object') return false;
  if (n.controlStock === false) return true;
  if (n.activo === false) return false;
  if (tieneIgnoraStock(n)) return true;
  return !stockAgotado(n.stock);
}

// ---------------------------------------------------------------------------
// ARTÍCULOS: activoDelivery según materias primas bloqueantes
// ---------------------------------------------------------------------------

const mismoMapa = (a, b) => {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b[k] === a[k]);
};

/**
 * Reconcila `activoDelivery` de un artículo dado el conjunto de materias primas
 * de su receta que están actualmente bloqueando (agotadas o inactivas). No muta:
 * devuelve `{ patch }`. Idempotente: se recomputa desde el estado propio + el
 * conjunto de bloqueantes.
 *
 * Con bloqueantes:
 *   · si estaba activo y no había apagado automático → recuerda estado y apaga;
 *   · guarda el mapa `materiasPrimasBloqueantes`.
 * Sin bloqueantes:
 *   · restaura activoDelivery=true SOLO si el apagado fue automático y antes
 *     estaba activo (si el usuario canceló, `activoDeliveryAntesDeFaltaMateriaPrima`
 *     estará limpio y no se restaura);
 *   · limpia los tres campos técnicos.
 *
 * @param {object} nodo            nodo actual del artículo
 * @param {Iterable<string>} idsBloqueantes  ids de materia prima que bloquean HOY
 */
export function reconciliarArticuloDelivery(nodo, idsBloqueantes) {
  const n = obj(nodo);
  const bloqueantes = Array.from(idsBloqueantes || []);
  const patch = {};

  if (bloqueantes.length > 0) {
    if (n.activoDelivery === true && n.apagadoDeliveryAutomaticoPorMateriaPrima !== true) {
      patch.activoDeliveryAntesDeFaltaMateriaPrima = true;
      patch.apagadoDeliveryAutomaticoPorMateriaPrima = true;
      patch.activoDelivery = false;
    } else if (n.apagadoDeliveryAutomaticoPorMateriaPrima === true && n.activoDelivery !== false) {
      // ya estaba apagado automáticamente: asegurar el estado
      patch.activoDelivery = false;
    }
    const nuevoMapa = {};
    for (const id of bloqueantes) nuevoMapa[id] = true;
    if (!mismoMapa(obj(n.materiasPrimasBloqueantes), nuevoMapa)) {
      patch.materiasPrimasBloqueantes = nuevoMapa;
    }
  } else {
    if (n.apagadoDeliveryAutomaticoPorMateriaPrima === true && n.activoDeliveryAntesDeFaltaMateriaPrima === true) {
      if (n.activoDelivery !== true) patch.activoDelivery = true;
    }
    if (n.apagadoDeliveryAutomaticoPorMateriaPrima !== undefined) patch.apagadoDeliveryAutomaticoPorMateriaPrima = null;
    if (n.activoDeliveryAntesDeFaltaMateriaPrima !== undefined) patch.activoDeliveryAntesDeFaltaMateriaPrima = null;
    if (n.materiasPrimasBloqueantes !== undefined) patch.materiasPrimasBloqueantes = null;
  }
  return { patch };
}

/** Aplica el patch de artículo a un nodo nuevo (null borra). Reductor de transacción. */
export function reconciliarArticuloDeliveryANodo(nodo, idsBloqueantes) {
  const base = { ...obj(nodo) };
  const { patch } = reconciliarArticuloDelivery(base, idsBloqueantes);
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete base[k]; else base[k] = v; }
  return { nodo: base, patch, cambio: Object.keys(patch).length > 0 };
}

/**
 * Edición MANUAL de `activoDelivery` de un artículo, respetando el bloqueo por
 * materia prima:
 *  - sin bloqueantes: aplica el valor deseado y limpia marcadores.
 *  - con bloqueantes y ENCIENDE: queda false pero registra intención de restaurar.
 *  - con bloqueantes y APAGA: cancela la restauración automática (limpia
 *    `activoDeliveryAntesDeFaltaMateriaPrima`); conserva el mapa de bloqueantes.
 */
export function resolverToggleManualArticuloDelivery(nodo, activoDeliveryDeseado) {
  const n = obj(nodo);
  const deseado = activoDeliveryDeseado === true;
  const mapa = obj(n.materiasPrimasBloqueantes);
  const hayBloqueantes = Object.keys(mapa).length > 0;
  const patch = {};

  if (!hayBloqueantes) {
    patch.activoDelivery = deseado;
    patch.apagadoDeliveryAutomaticoPorMateriaPrima = null;
    patch.activoDeliveryAntesDeFaltaMateriaPrima = null;
    return { patch };
  }

  patch.activoDelivery = false;
  if (deseado) {
    patch.apagadoDeliveryAutomaticoPorMateriaPrima = true;
    patch.activoDeliveryAntesDeFaltaMateriaPrima = true;
  } else {
    // cancela la restauración automática; conserva materiasPrimasBloqueantes.
    patch.activoDeliveryAntesDeFaltaMateriaPrima = null;
  }
  return { patch };
}
