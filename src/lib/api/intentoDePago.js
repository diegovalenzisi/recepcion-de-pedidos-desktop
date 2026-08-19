// ---------------------------------------------------------------------------
// INTENTO DE PAGO DE COMISIÓN — IDENTIDAD PERSISTENTE.
//
// Un pago tiene que descontar de la deuda EXACTAMENTE UNA VEZ. La idempotencia
// del lado del servidor la da el `opId` determinístico `P-{idPago}` y la regla
// create-only sobre MOVIMIENTOS. Pero eso solo sirve si el cliente REUTILIZA el
// mismo `idPago` al reintentar: si generara uno nuevo, sería otra operación y
// descontaría de nuevo.
//
// Por eso el id no se genera dentro de la llamada: se genera UNA vez al apretar
// Pagar y se PERSISTE. Sobrevive a:
//
//     doble clic          el segundo reintento reusa el mismo id
//     timeout             el commit pudo haber entrado; el reintento lo detecta
//     pérdida de conexión ídem
//     cierre y reapertura al volver, la marca sigue ahí
//
// Al reabrir con una marca pendiente se consulta `MOVIMIENTOS/P-{idPago}`:
//   existe    → el pago ya entró: no se descuenta de nuevo, se limpia la marca
//   no existe → se puede reintentar con el MISMO id y el MISMO monto
//
// El monto viaja con la marca a propósito: un reintento no puede aplicar un
// importe distinto bajo la misma identidad.
//
// Mismo patrón que `orderAttempt.js` de DLV Pedidos, que ya está en producción.
//
// Módulo PURO salvo por el acceso a localStorage, que se inyecta para poder
// probarlo sin navegador.
// ---------------------------------------------------------------------------

/** Prefijo de la marca. Una por local: dos locales no comparten intento. */
export const PREFIJO_MARCA = 'pagoComisionPendiente_';

/** Clave de la marca de este local. */
export const claveDeMarca = (localId) => `${PREFIJO_MARCA}${localId}`;

/** UUID del intento. `randomUUID` donde exista; si no, un fallback suficiente. */
export function nuevoIdPago() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* sigue al fallback */ }
  return `pag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Marca de un intento de pago.
 *
 * Lleva el local y el responsable además del importe: así una marca no puede
 * reutilizarse por error en otro local ni atribuirse a otra sesión.
 */
export function nuevaMarca({ localId, montoCentavos, responsable, origen = 'desktop', ahora = Date.now() }) {
  return {
    idPago: nuevoIdPago(),
    localId: String(localId),
    montoCentavos,
    responsable: String(responsable ?? ''),
    origen,
    creadoEn: ahora,
  };
}

/** ¿Esta marca sirve para este local? */
export const marcaEsDelLocal = (marca, localId) =>
  !!marca && String(marca.localId) === String(localId) && !!marca.idPago;

/**
 * Qué hacer al encontrar una marca pendiente, sabiendo si su movimiento existe.
 *
 * @param {object|null} marca
 * @param {boolean} movimientoExiste  resultado de leer MOVIMIENTOS/P-{idPago}
 * @returns {{ accion:'ninguna'|'ya-aplicado'|'reintentar', idPago?, montoCentavos?, motivo }}
 */
export function decidirDesdeMarca(marca, movimientoExiste) {
  if (!marca || !marca.idPago) {
    return { accion: 'ninguna', motivo: 'no hay ningún pago pendiente.' };
  }
  if (movimientoExiste) {
    return {
      accion: 'ya-aplicado',
      idPago: marca.idPago,
      montoCentavos: marca.montoCentavos,
      motivo: 'el pago ya se había registrado: no se vuelve a descontar.',
    };
  }
  return {
    accion: 'reintentar',
    idPago: marca.idPago,
    montoCentavos: marca.montoCentavos,
    motivo: 'el pago no llegó a registrarse: se reintenta con el mismo id y el mismo importe.',
  };
}

// ---------------------------------------------------------------------------
// Persistencia. El almacenamiento se inyecta para poder probar sin navegador.
// ---------------------------------------------------------------------------

const almacenPorDefecto = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function guardarMarca(marca, almacen = almacenPorDefecto()) {
  if (!almacen || !marca?.localId) return false;
  try {
    almacen.setItem(claveDeMarca(marca.localId), JSON.stringify(marca));
    return true;
  } catch (e) {
    console.warn('[PAGO COMISION] no se pudo persistir el intento:', e?.message || e);
    return false;
  }
}

export function leerMarca(localId, almacen = almacenPorDefecto()) {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(claveDeMarca(localId));
    if (!crudo) return null;
    const marca = JSON.parse(crudo);
    // Una marca de otro local no se usa jamás.
    return marcaEsDelLocal(marca, localId) ? marca : null;
  } catch {
    return null;
  }
}

export function limpiarMarca(localId, almacen = almacenPorDefecto()) {
  if (!almacen) return;
  try { almacen.removeItem(claveDeMarca(localId)); } catch { /* nada que hacer */ }
}
