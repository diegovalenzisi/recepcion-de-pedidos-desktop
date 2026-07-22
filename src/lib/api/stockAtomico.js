// ---------------------------------------------------------------------------
// APLICACIÓN IDEMPOTENTE DEL IMPACTO DE STOCK
//
// HISTORIA DE ESTE ARCHIVO (importante para no repetir el error)
// --------------------------------------------------------------
// Intento 1: N runTransaction() sueltas + marcar `completed` al final.
//   Roto: si el proceso muere entre medio, el pedido queda a medio descontar y
//   reintentar duplica lo ya aplicado.
//
// Intento 2: un único update() multi-ruta con increment(), incluyendo la marca
//   `completed`. Elimina el estado parcial DENTRO de una escritura, pero NO
//   resuelve el problema real:
//
//     A toma el lock → A se suspende → vence el lease → B lo recupera →
//     A despierta y hace su update completo → B hace el suyo → SE DESCUENTA DOS VECES.
//
//   Los dos updates son atómicos por separado; la atomicidad no impide dos
//   commits de dueños distintos. Y un `update()` normal no puede condicionarse a
//   que el fencing token siga vigente, así que guardar el token no alcanza.
//   Cualquier chequeo previo tiene su propia carrera contra la escritura.
//
// DISEÑO ACTUAL: IDEMPOTENCIA POR RECURSO (opción A)
// --------------------------------------------------
// La única primitiva de RTDB que da una condición evaluada EN EL SERVIDOR es
// `runTransaction`: lee, decide y escribe en un compare-and-set con reintento.
// Entonces la garantía se pone donde está el dato: cada artículo/materia prima
// registra, DENTRO DE LA MISMA TRANSACCIÓN que cambia su stock, qué
// referenceId ya se le aplicó.
//
//   ARTICULOS/{id}/stock = {
//     stockType, propio, receta, heredadoDe,
//     appliedOps: { "DELIVERY_123": { amount: 2, impactHash: "…", at: … } }
//   }
//
// La transacción de cada recurso:
//   · ya aplicado con el MISMO impactHash  → no descuenta (reintento legítimo);
//   · ya aplicado con OTRO impactHash      → rechaza por inconsistencia;
//   · no aplicado                          → descuenta y registra la operación.
//
// Qué garantiza y qué no:
//   ✔ EXACTLY-ONCE POR RECURSO, impuesto por el servidor. Dos dueños
//     concurrentes (el caso A/B de arriba) producen UN solo descuento: el
//     segundo ve `appliedOps` y no aplica.
//   ✔ Reanudación segura: un reintento vuelve a recorrer todos los recursos;
//     los ya aplicados no se tocan y los faltantes se completan.
//   ✔ El lock deja de ser un mecanismo de corrección y pasa a ser solo una
//     optimización para no hacer trabajo repetido. Recuperarlo por antigüedad
//     ya no puede causar doble descuento.
//   ✘ NO hay atomicidad entre recursos: un corte puede dejar el kilo base
//     aplicado y Rocklets no. Eso es una operación PARCIAL detectable
//     (`appliedOps` por recurso) y RESOLUBLE reintentando. No es doble cobro.
//
// Por eso este motor NO se describe como "exactly once" a nivel pedido, sino
// como "exactly once por recurso, con reanudación idempotente".
//
// Módulo puro: no importa Firebase. Expone los reductores de transacción para
// poder probarlos, y quien lo usa provee `runTransaction`.
// ---------------------------------------------------------------------------

/** Una reserva `processing` más vieja que esto se considera huérfana. */
export const RESERVA_VENCIDA_MS = 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// Impacto canónico y hash
// ---------------------------------------------------------------------------

/**
 * Representación canónica y ORDENADA del impacto. Es la entrada del hash, así
 * que el orden no puede depender del recorrido del pedido.
 */
export function construirImpactoCanonico(impactMap) {
  const salida = [];
  for (const [id, data] of Object.entries(impactMap || {})) {
    const cantidad = Number(data && data.quantity);
    if (!Number.isFinite(cantidad) || cantidad === 0) continue;
    salida.push({ tipo: data.type, id: String(id), cantidad });
  }
  return salida.sort((a, b) => (a.tipo === b.tipo ? a.id.localeCompare(b.id) : a.tipo.localeCompare(b.tipo)));
}

/**
 * Hash estable del impacto (FNV-1a de 32 bits sobre la forma canónica).
 * No necesita ser criptográfico: solo tiene que detectar que un mismo
 * referenceId se está usando con un contenido distinto.
 */
export function calcularImpactHash(impactMap) {
  const canonico = construirImpactoCanonico(impactMap);
  const texto = canonico.map((d) => `${d.tipo}:${d.id}:${d.cantidad}`).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h${h.toString(16).padStart(8, '0')}_${canonico.length}`;
}

// ---------------------------------------------------------------------------
// Identidades determinísticas
// ---------------------------------------------------------------------------
export const refDelivery = (orderId) => `DELIVERY_${orderId}`;
export const refMostrador = (saleId) => `MOSTRADOR_${saleId}`;
export const refReversionMostrador = (saleId) => `REVERSAL_MOSTRADOR_${saleId}`;
export const refReversionDelivery = (orderId) => `REVERSAL_DELIVERY_${orderId}`;
export const refAjuste = (referenceIdOriginal, version) => `ADJUST_${referenceIdOriginal}_v${version}`;

/**
 * Identidad ESTABLE del movimiento: se deriva del referenceId, no de un push()
 * nuevo por intento. Un reintento reescribe el mismo nodo en vez de crear un
 * movimiento duplicado.
 */
export const movimientoIdDe = (referenceId) => `MOV_${referenceId}`;

// ---------------------------------------------------------------------------
// Validación del plan antes de tocar nada
// ---------------------------------------------------------------------------

/** Ruta física de stock de un recurso. */
export function rutaRecurso(localId, id, tipo) {
  return tipo === 'ARTICULO'
    ? `${localId}/ARTICULOS/${id}/stock`
    : `${localId}/MATERIA_PRIMA/${id}`;
}

/**
 * Valida el plan de impacto antes de ejecutarlo. Devuelve los problemas
 * encontrados; si hay alguno, NO debe aplicarse nada.
 */
export function validarPlan({ localId, impactMap, idsValidos = null }) {
  const problemas = [];
  if (!localId) problemas.push({ tipo: 'sin-local' });

  const rutasVistas = new Map();
  for (const [id, data] of Object.entries(impactMap || {})) {
    const tipo = data && data.type;
    const cantidad = Number(data && data.quantity);

    if (tipo !== 'ARTICULO' && tipo !== 'MATERIA_PRIMA') {
      problemas.push({ tipo: 'tipo-invalido', id, valor: tipo });
      continue;
    }
    if (!Number.isFinite(cantidad)) { problemas.push({ tipo: 'cantidad-no-finita', id, valor: data.quantity }); continue; }
    if (cantidad < 0) { problemas.push({ tipo: 'cantidad-negativa', id, valor: cantidad }); continue; }
    if (cantidad === 0) { problemas.push({ tipo: 'cantidad-cero', id }); continue; }
    if (idsValidos && !idsValidos.includes(String(id))) {
      problemas.push({ tipo: 'id-no-validado', id });
      continue;
    }

    // Recetas y stock heredado pueden terminar apuntando al MISMO nodo físico:
    // eso tiene que venir agregado, no como dos entradas.
    const ruta = rutaRecurso(localId, id, tipo);
    if (rutasVistas.has(ruta)) {
      problemas.push({ tipo: 'ruta-duplicada', ruta, ids: [rutasVistas.get(ruta), id] });
    } else {
      rutasVistas.set(ruta, id);
    }
    if (String(id).includes('/')) problemas.push({ tipo: 'id-con-barra', id });
  }

  return { valido: problemas.length === 0, problemas, rutas: [...rutasVistas.keys()] };
}

// ---------------------------------------------------------------------------
// Reductores de transacción (el corazón de la garantía)
// ---------------------------------------------------------------------------

/** Lee el stock actual distinguiendo "ausente" de "corrupto". */
export function leerStockActual(nodo, tipo) {
  const crudo = tipo === 'ARTICULO' ? (nodo && nodo.propio) : (nodo && nodo.stock);
  if (crudo === null || crudo === undefined) return { valor: 0, estado: 'ausente' };
  if (typeof crudo === 'number') {
    return Number.isFinite(crudo) ? { valor: crudo, estado: 'ok' } : { valor: 0, estado: 'corrupto' };
  }
  if (typeof crudo === 'string') {
    const n = Number(crudo.replace(',', '.'));
    // Un stock guardado como string es un dato histórico: se acepta, pero
    // avisando, para no convertir basura en un número en silencio.
    return Number.isFinite(n) ? { valor: n, estado: 'string-historico' } : { valor: 0, estado: 'corrupto' };
  }
  return { valor: 0, estado: 'corrupto' };
}

/**
 * Reductor de la transacción de UN recurso. Es la función que se le pasa a
 * `runTransaction`, y por eso la decisión se evalúa en el servidor.
 *
 * @returns {{ nodo: object|undefined, resultado: string, aviso: object|null }}
 *   nodo === undefined ⇒ abortar la transacción (no escribir).
 */
export function aplicarEnRecurso(nodoActual, { referenceId, cantidad, impactHash, tipo, ahora = Date.now() }) {
  const nodo = nodoActual ? { ...nodoActual } : {};
  const aplicadas = { ...(nodo.appliedOps || {}) };
  const yaAplicada = aplicadas[referenceId];

  if (yaAplicada) {
    if (yaAplicada.impactHash !== impactHash) {
      // Mismo referenceId, contenido distinto: el pedido cambió y alguien está
      // reutilizando la referencia. No se procesa como si fuera el mismo.
      return { nodo: undefined, resultado: 'conflicto-de-hash', aviso: { esperado: impactHash, encontrado: yaAplicada.impactHash } };
    }
    // Reintento legítimo: ya estaba aplicado. No se vuelve a descontar.
    return { nodo: undefined, resultado: 'ya-aplicado', aviso: null };
  }

  const { valor, estado } = leerStockActual(nodo, tipo);
  const aviso = (estado === 'corrupto' || estado === 'string-historico')
    ? { tipo: 'stock-no-numerico', estado, crudo: tipo === 'ARTICULO' ? nodo.propio : nodo.stock }
    : null;

  const nuevo = valor - cantidad;
  if (tipo === 'ARTICULO') nodo.propio = nuevo; else nodo.stock = nuevo;

  aplicadas[referenceId] = { amount: cantidad, impactHash, at: ahora };
  nodo.appliedOps = aplicadas;

  return { nodo, resultado: 'aplicado', aviso, stockAnterior: valor, stockNuevo: nuevo, estadoStock: estado };
}

/**
 * Reductor de REVERSIÓN: devuelve lo aplicado por la operación original.
 *
 * ⚠ COMPORTAMIENTO REAL DE RTDB (verificado contra el emulador): el reductor de
 * `runTransaction` se invoca la PRIMERA vez con el valor cacheado, que es `null`
 * aunque el nodo exista en el servidor. Un `get()` previo NO lo evita: `get()`
 * no puebla el árbol de sincronización que usa la transacción.
 *
 * Si en esa primera llamada se devuelve `undefined`, la transacción ABORTA y
 * nunca se reejecuta con el dato real. Eso hacía que la reversión no repusiera
 * nada y el stock quedara en 18 en vez de 20.
 *
 * Por eso, ante `null` se devuelve un nodo vacío en lugar de abortar: RTDB
 * reejecuta el reductor con los datos del servidor y esa segunda pasada es la
 * que decide. Si el nodo realmente no existiera, escribir `{}` equivale a null
 * en RTDB, así que no deja basura.
 *
 * El camino de aplicación no sufría esto porque `aplicarEnRecurso` sí devuelve
 * un nodo cuando recibe `null`, y por eso la reejecución ocurría sola.
 */
export function revertirEnRecurso(nodoActual, { referenceIdOriginal, referenceIdReversion, impactHash, tipo, ahora = Date.now() }) {
  if (nodoActual === null || nodoActual === undefined) {
    return { nodo: {}, resultado: 'esperando-datos-del-servidor', aviso: null };
  }
  const nodo = { ...nodoActual };
  const aplicadas = { ...(nodo.appliedOps || {}) };

  if (aplicadas[referenceIdReversion]) {
    return { nodo: undefined, resultado: 'ya-revertido', aviso: null };
  }
  const original = aplicadas[referenceIdOriginal];
  if (!original) {
    // No se puede devolver lo que nunca se descontó en este recurso.
    return { nodo: undefined, resultado: 'original-no-aplicada', aviso: null };
  }

  const { valor, estado } = leerStockActual(nodo, tipo);
  const nuevo = valor + Number(original.amount || 0);
  if (tipo === 'ARTICULO') nodo.propio = nuevo; else nodo.stock = nuevo;

  aplicadas[referenceIdReversion] = {
    amount: -Number(original.amount || 0),
    impactHash: impactHash || original.impactHash,
    revierteA: referenceIdOriginal,
    at: ahora,
  };
  nodo.appliedOps = aplicadas;

  return { nodo, resultado: 'revertido', aviso: null, stockAnterior: valor, stockNuevo: nuevo, estadoStock: estado };
}

// ---------------------------------------------------------------------------
// Reserva (optimización, NO mecanismo de corrección)
// ---------------------------------------------------------------------------

/**
 * Decide si conviene intentar la operación. Recuperar una reserva vencida ya no
 * puede causar doble descuento: la corrección la garantiza `appliedOps` en cada
 * recurso. Esto solo evita trabajo repetido.
 */
export function decidirIntento(marca, ahora = Date.now()) {
  if (!marca) return { intentar: true, motivo: 'sin-marca' };
  if (marca.status === 'completed') return { intentar: false, motivo: 'ya-procesado' };
  if (marca.status === 'processing') {
    const edad = ahora - (Number(marca.timestamp) || 0);
    return edad > RESERVA_VENCIDA_MS
      ? { intentar: true, motivo: 'reserva-huerfana' }
      : { intentar: false, motivo: 'en-curso' };
  }
  return { intentar: true, motivo: 'marca-desconocida' };
}

/** Marca final de la operación, con el ledger de lo realmente aplicado. */
export function construirMarcaFinal({ referenceId, impactHash, impacto, source, ownerId, intento = 1, timestamp = Date.now(), parcial = false }) {
  return {
    status: parcial ? 'partial' : 'completed',
    referenceId,
    impactHash,
    source,
    ownerId: ownerId || null,
    intento,
    timestamp,
    appliedAt: timestamp,
    movementId: movimientoIdDe(referenceId),
    impacto,
  };
}
