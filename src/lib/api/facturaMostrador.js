// ---------------------------------------------------------------------------
// REFERENCIA Y ESPERA DEL CAE DE UNA VENTA DE MOSTRADOR — MÓDULO PURO
//
// La pregunta "¿Desea imprimir la factura?" fue ELIMINADA por completo: no hay
// modal, ni configuración, ni respuesta del cajero, ni resolución de la cuenta
// por el alias destacado. La cola sale SIEMPRE de la regla por medio de pago
// (facturaORemito.js) y, para PedidosYa, del alias favorito del local, resuelto
// allí mismo. El efectivo puro es remito y no se le pregunta nada a nadie.
//
// Lo que queda acá es la REFERENCIA de vuelta y la ESPERA del CAE:
//
// CÓMO VUELVE LA FACTURA: el motor AFIP copia el pedido entero al guardar en
// /{localId}/VENTAS/{FCB…|FCC…}, así que todo lo que se encola viaja hasta el
// comprobante emitido. Por eso alcanza con encolar una referencia para saber
// después cuál factura corresponde a esta venta, sin tocar el motor.
//
// Módulo PURO: sin Firebase, sin React, sin DOM.
// ---------------------------------------------------------------------------

/** Marca de origen que viaja encolada hasta la factura emitida. */
export const ORIGEN_MOSTRADOR = 'MOSTRADOR';

/** Cuánto se espera el CAE antes de avisar que sigue en proceso. */
export const ESPERA_CAE_MS = 60_000;

/** Clave con la que la venta de mostrador entra en la cola fiscal. */
export const claveEnCola = (saleId) => `M${saleId}`;

/**
 * Referencia que se encola y vuelve dentro de la factura emitida. Es lo que
 * permite reconocerla sin tocar el motor.
 */
export function referenciaDeVenta({ localId, saleId }) {
  return {
    origen: ORIGEN_MOSTRADOR,
    mostradorId: String(saleId),
    localId: String(localId),
    idempotencyKey: `${localId}:MOSTRADOR:${saleId}`,
  };
}

/**
 * Busca, entre los registros fiscales, la factura de ESTA venta de mostrador.
 * Compara por la referencia encolada, nunca por importe ni por hora.
 */
export function buscarFacturaDeVenta(ventas, saleId) {
  const id = String(saleId ?? '');
  if (!id) return null;
  for (const clave of Object.keys(ventas || {})) {
    const registro = ventas[clave];
    if (!registro || typeof registro !== 'object') continue;
    if (registro.origen !== ORIGEN_MOSTRADOR) continue;
    if (String(registro.mostradorId ?? '') !== id) continue;
    if (!registro.CAE) continue;              // sin CAE todavía no sirve para imprimir
    return { clave, registro };
  }
  return null;
}

/**
 * Qué hacer mientras se espera el CAE.
 *
 * @param {object} params
 *   factura      — resultado de buscarFacturaDeVenta (o null)
 *   lock         — SIEMPRE null. El sistema de locks en Firebase fue eliminado;
 *                  el parámetro se conserva sólo para no romper a quien la
 *                  llama, y la rama de rechazo quedó inalcanzable a propósito:
 *                  el error real de ARCA se ve en el log del facturador.
 *   sigueEnCola  — ¿la entrada sigue esperando en la cola?
 *   vencido      — ¿se agotó el tiempo de espera?
 * @returns {{ estado: 'emitida'|'error'|'esperando'|'demorada', ... }}
 */
export function evaluarEspera({ factura, lock, sigueEnCola, vencido } = {}) {
  // La factura mandada: si ya está con CAE, se imprime.
  if (factura) return { estado: 'emitida', clave: factura.clave, registro: factura.registro };

  if (lock && lock.status === 'error') {
    return { estado: 'error', mensaje: String(lock.error || 'El facturador rechazó la factura.') };
  }

  if (vencido) {
    return {
      estado: 'demorada',
      sigueEnCola: !!sigueEnCola,
      mensaje: 'La factura continúa en proceso. Cuando esté emitida podrá imprimirse desde Ventas.',
    };
  }

  return { estado: 'esperando' };
}
