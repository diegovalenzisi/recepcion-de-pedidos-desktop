// ---------------------------------------------------------------------------
// APLICACIÓN ATÓMICA DEL IMPACTO DE STOCK
//
// PROBLEMA QUE RESUELVE
// --------------------
// El motor anterior hacía: tomar lock → N runTransaction() independientes (una
// por artículo) → N push() de movimiento → marcar `completed`. Eso deja una
// ventana real: si el proceso muere después de descontar el kilo base pero
// antes de descontar Rocklets, el referenceId queda en `processing` con el
// pedido A MEDIO APLICAR. Reintentar "porque el lock venció" descontaría el
// kilo base por segunda vez.
//
// DISEÑO ELEGIDO
// --------------
// Realtime Database soporta `increment(delta)` (ServerValue.increment) DENTRO de
// un `update()` multi-ruta, y un update multi-ruta es ATÓMICO: se aplica entero
// o no se aplica nada. Entonces TODO el efecto del pedido va en UNA sola
// escritura:
//
//   update(ref(db), {
//     'LOCAL/ARTICULOS/A-0007/stock/propio':      increment(-1),
//     'LOCAL/ARTICULOS/A-ROCKLETS/stock/propio':  increment(-2),
//     'LOCAL/MATERIA_PRIMA/M-3/stock':            increment(-0.5),
//     'LOCAL/TRANSACCIONES_STOCK/<pushId>':       { ...movimiento },
//     'LOCAL/PROCESSED_STOCK_IDS/<refId>':        { status: 'completed', ... },
//   })
//
// La marca `completed` viaja EN LA MISMA escritura que los descuentos. Eso
// produce el invariante que hace seguro el reintento:
//
//   status === 'completed'   ⟺  TODOS los descuentos se aplicaron
//   status !== 'completed'   ⟺  NINGÚN descuento se aplicó
//
// No existe un estado intermedio "algunos aplicados".
//
// RESPUESTAS EXIGIDAS (punto 1 del checkpoint)
// --------------------------------------------
// · ¿Qué operación es atómica?
//     La aplicación completa: todos los incrementos de stock + los movimientos
//     + la marca `completed`, en un único `update()` multi-ruta.
//
// · ¿Qué pasa si el proceso muere ANTES de escribir?
//     La reserva (`runTransaction` sobre PROCESSED_STOCK_IDS) puede haber
//     quedado en `processing`. Nada de stock se movió. Un reintento posterior
//     ve `processing`, comprueba que no hay `appliedAt` y vuelve a intentar la
//     aplicación completa. No hay doble descuento porque no hubo descuento.
//
// · ¿Qué pasa si muere DURANTE la escritura?
//     RTDB aplica el update entero o nada. Si se aplicó, quedó `completed` y el
//     reintento se rechaza. Si no se aplicó, quedó `processing` y el reintento
//     lo completa. En los dos casos el resultado final es un solo descuento.
//
// · ¿Cómo se reintenta sin descontar dos veces?
//     El reintento solo procede si `status !== 'completed'`. Como `completed` se
//     escribe junto con los descuentos, "no completed" garantiza "no aplicado".
//
// · ¿Cómo se detecta una operación parcial?
//     No puede haberla. Lo que sí se detecta es una RESERVA HUÉRFANA:
//     `status === 'processing'` con antigüedad mayor a RESERVA_VENCIDA_MS. Eso
//     significa "alguien reservó y nunca aplicó", y es seguro reintentar.
//
// LÍMITE CONOCIDO
// ---------------
// `increment` no puede leer el valor previo, así que esta operación NO valida
// stock disponible al aplicar. Eso NO es un cambio de política: el motor actual
// tampoco lo hacía (permitía negativo). El bloqueo por falta de stock sigue
// ocurriendo antes, en la selección.
//
// Módulo puro: construye el payload y decide si se puede aplicar. No importa
// Firebase ni escribe nada; quien lo usa le pasa la función `increment`.
// ---------------------------------------------------------------------------

/** Una reserva en `processing` más vieja que esto se considera huérfana. */
export const RESERVA_VENCIDA_MS = 2 * 60 * 1000;

/**
 * Decide si corresponde aplicar el impacto, a partir de la marca ya existente.
 *
 * @param {object|null} marca  valor actual de PROCESSED_STOCK_IDS/{referenceId}
 * @param {number} ahora
 * @returns {{ aplicar: boolean, motivo: string }}
 */
export function decidirAplicacion(marca, ahora = Date.now()) {
  if (!marca) return { aplicar: true, motivo: 'sin-marca' };

  if (marca.status === 'completed') {
    // Invariante: completed ⇒ todo aplicado. Nunca se reaplica.
    return { aplicar: false, motivo: 'ya-procesado' };
  }

  if (marca.status === 'processing') {
    const edad = ahora - (Number(marca.timestamp) || 0);
    if (edad > RESERVA_VENCIDA_MS) {
      // Reserva huérfana. Es SEGURO reintentar porque `processing` implica que
      // la escritura atómica no llegó a aplicarse.
      return { aplicar: true, motivo: 'reserva-huerfana' };
    }
    return { aplicar: false, motivo: 'en-curso' };
  }

  return { aplicar: true, motivo: 'marca-desconocida' };
}

/**
 * Construye el payload del `update()` multi-ruta que aplica TODO el impacto.
 *
 * @param {object} params
 *   localId        — local sobre el que se aplica (aislamiento)
 *   referenceId    — identificador idempotente de la operación
 *   impactMap      — { [itemId]: { quantity, type: 'ARTICULO'|'MATERIA_PRIMA' } }
 *                    `quantity` es lo que se RESTA (positivo = descuento)
 *   movimientoId   — clave ya generada para el movimiento (push key)
 *   increment      — función de incremento atómico del backend
 *   source, fecha, timestamp, intento
 * @returns {{ payload: object, rutas: string[], totalItems: number }}
 */
export function construirPayloadAtomico({
  localId,
  referenceId,
  impactMap,
  movimientoId,
  increment,
  source = 'Venta',
  fecha = new Date().toISOString(),
  timestamp = Date.now(),
  intento = 1,
}) {
  if (!localId) throw new Error('localId requerido');
  if (!referenceId) throw new Error('referenceId requerido: sin él no hay idempotencia');
  if (typeof increment !== 'function') throw new Error('increment requerido');

  const payload = {};
  const detalles = [];

  for (const [itemId, data] of Object.entries(impactMap || {})) {
    const cantidad = Number(data && data.quantity);
    if (!Number.isFinite(cantidad) || cantidad === 0) continue;

    const ruta = data.type === 'ARTICULO'
      ? `${localId}/ARTICULOS/${itemId}/stock/propio`
      : `${localId}/MATERIA_PRIMA/${itemId}/stock`;

    // Si el mismo itemId apareciera dos veces ya vendría agregado en impactMap;
    // esta guarda evita pisar una ruta en silencio si algo cambia más adelante.
    if (payload[ruta] !== undefined) {
      throw new Error(`ruta de stock duplicada: ${ruta} (el impacto debe venir agregado por artículo)`);
    }

    payload[ruta] = increment(-cantidad);
    detalles.push({ itemId, cantidad, tipo: data.type });
  }

  // El movimiento y la marca viajan en la MISMA escritura que los descuentos.
  if (detalles.length > 0 && movimientoId) {
    payload[`${localId}/TRANSACCIONES_STOCK/${movimientoId}`] = {
      tipo: 'salida',
      motivo: source,
      referenceId,
      fecha,
      timestamp,
      detalles,
    };
  }

  payload[`${localId}/PROCESSED_STOCK_IDS/${referenceId}`] = {
    status: 'completed',
    timestamp,
    appliedAt: timestamp,
    source,
    intento,
    // Ledger del impacto exacto que se aplicó: permite calcular deltas de una
    // edición posterior y revertir con precisión, sin recomponer el pedido.
    impacto: detalles,
  };

  return { payload, rutas: Object.keys(payload), totalItems: detalles.length };
}

/**
 * Payload de REVERSIÓN. Devuelve el stock exactamente según el ledger de la
 * operación original, bajo su propio referenceId (`REVERSAL_...`), sin borrar
 * ni reutilizar la marca original.
 */
export function construirPayloadReversion({
  localId,
  referenceIdOriginal,
  marcaOriginal,
  referenceIdReversion,
  movimientoId,
  increment,
  source = 'Reversión',
  fecha = new Date().toISOString(),
  timestamp = Date.now(),
}) {
  if (!localId) throw new Error('localId requerido');
  if (!referenceIdReversion) throw new Error('referenceIdReversion requerido');
  if (typeof increment !== 'function') throw new Error('increment requerido');

  // Solo se puede revertir lo que realmente se aplicó.
  if (!marcaOriginal || marcaOriginal.status !== 'completed') {
    return { payload: null, motivo: 'original-no-completada', totalItems: 0 };
  }
  const impacto = Array.isArray(marcaOriginal.impacto) ? marcaOriginal.impacto : [];
  if (impacto.length === 0) {
    return { payload: null, motivo: 'sin-impacto-registrado', totalItems: 0 };
  }

  const payload = {};
  const detalles = [];
  for (const d of impacto) {
    const cantidad = Number(d && d.cantidad);
    if (!Number.isFinite(cantidad) || cantidad === 0) continue;
    const ruta = d.tipo === 'ARTICULO'
      ? `${localId}/ARTICULOS/${d.itemId}/stock/propio`
      : `${localId}/MATERIA_PRIMA/${d.itemId}/stock`;
    if (payload[ruta] !== undefined) {
      throw new Error(`ruta de stock duplicada en la reversión: ${ruta}`);
    }
    payload[ruta] = increment(cantidad); // devuelve lo descontado
    detalles.push({ itemId: d.itemId, cantidad, tipo: d.tipo });
  }

  if (detalles.length > 0 && movimientoId) {
    payload[`${localId}/TRANSACCIONES_STOCK/${movimientoId}`] = {
      tipo: 'entrada',
      motivo: source,
      referenceId: referenceIdReversion,
      revierteA: referenceIdOriginal,
      fecha,
      timestamp,
      detalles,
    };
  }

  payload[`${localId}/PROCESSED_STOCK_IDS/${referenceIdReversion}`] = {
    status: 'completed',
    timestamp,
    appliedAt: timestamp,
    source,
    revierteA: referenceIdOriginal,
    impacto: detalles,
  };

  return { payload, motivo: 'ok', totalItems: detalles.length };
}

/** Identificadores determinísticos: la misma venta produce siempre el mismo id. */
export const refDelivery = (orderId) => `DELIVERY_${orderId}`;
export const refMostrador = (saleId) => `MOSTRADOR_${saleId}`;
export const refReversionMostrador = (saleId) => `REVERSAL_MOSTRADOR_${saleId}`;
export const refReversionDelivery = (orderId) => `REVERSAL_DELIVERY_${orderId}`;
/** Ajuste por edición posterior: determinístico por pedido y versión de edición. */
export const refAjuste = (referenceIdOriginal, version) => `ADJUST_${referenceIdOriginal}_v${version}`;
