// ---------------------------------------------------------------------------
// IMPRESIÓN AUTOMÁTICA DEL COMPROBANTE FISCAL — MÓDULO PURO
//
// Cuando el cajero pide la factura desde mostrador, la venta se encola con
// `imprimirAlEmitir: true` y la pantalla se libera enseguida. El motor AFIP
// emite cuando puede —minutos u horas después— y, como copia el payload dentro
// del comprobante que guarda en VENTAS, esa marca viaja sola hasta la factura.
// Este módulo decide QUIÉN imprime y CUÁNDO, sin bloquear a nadie.
//
// DÓNDE VIVE EL ESTADO:  /{localId}/IMPRESION/{claveFactura}
//
// Deliberadamente FUERA de VENTAS: ese es el registro fiscal del comprobante
// emitido y no se toca para llevar estado de impresora.
//
// QUIÉN IMPRIME:
//   · durante los primeros 30 s, SÓLO la terminal que hizo la venta — así el
//     ticket sale en la caja donde está el cliente;
//   · pasada la gracia, cualquier terminal puede tomarla (takeover), para que
//     una factura no quede sin imprimir si esa PC no volvió.
//
// UNA SOLA IMPRESIÓN: el estado se toma con `runTransaction`, así que la
// condición la evalúa el servidor. Dos terminales simultáneas producen UNA
// impresión: la segunda ve `IMPRIMIENDO` con lease vigente y no hace nada.
//
// RECUPERACIÓN: `IMPRIMIENDO` con lease vencido = la PC murió a mitad de
// imprimir; otra la retoma. Nada depende de una promesa ni de un estado de React
// abierto: la app puede cerrarse, la PC reiniciarse y ARCA tardar horas.
//
// Módulo PURO: sin Firebase, sin React, sin DOM.
// ---------------------------------------------------------------------------

/** Estados del ciclo de impresión. */
export const PENDIENTE = 'PENDIENTE';
export const IMPRIMIENDO = 'IMPRIMIENDO';
export const IMPRESA = 'IMPRESA';
export const ERROR = 'ERROR';

/** Cuánto tiempo la terminal que vendió tiene prioridad exclusiva. */
export const GRACIA_MS = 30_000;

/** Cuánto vale un `IMPRIMIENDO` antes de considerarse abandonado. */
export const LEASE_MS = 2 * 60_000;

/** Intentos automáticos antes de dejarla en ERROR para reimpresión manual. */
export const MAX_INTENTOS = 3;

/** Espera creciente entre reintentos (ms). */
export const backoffMs = (intentos) => Math.min(30_000, 2000 * Math.max(1, intentos) ** 2);

/** ¿Esta factura pidió impresión automática? Lo dice el propio comprobante. */
export function pidioImpresion(registro) {
  return !!(registro && typeof registro === 'object' && registro.imprimirAlEmitir === true);
}

/** ¿Ya tiene CAE? Sin CAE no se imprime NADA fiscal. */
export function tieneCae(registro) {
  return !!(registro && registro.CAE);
}

/**
 * ¿Qué hago con esta factura?
 *
 * @param {object} params
 *   nodo         — /{localId}/IMPRESION/{clave} actual (o null si no existe)
 *   registro     — el comprobante en VENTAS
 *   deviceId     — esta terminal
 *   ahora, graciaMs, leaseMs, maxIntentos
 * @returns {{ accion: 'imprimir'|'esperar'|'nada', motivo: string, nodo?: object }}
 *   `nodo` es lo que hay que escribir en la transacción para tomar la impresión.
 */
export function decidirImpresion({
  nodo, registro, deviceId,
  ahora = Date.now(), graciaMs = GRACIA_MS, leaseMs = LEASE_MS, maxIntentos = MAX_INTENTOS,
} = {}) {
  if (!pidioImpresion(registro)) return { accion: 'nada', motivo: 'no-pidio-impresion' };
  if (!tieneCae(registro)) return { accion: 'esperar', motivo: 'sin-cae-todavia' };
  if (!deviceId) return { accion: 'nada', motivo: 'sin-device-id' };

  const estado = nodo?.estado;
  if (estado === IMPRESA) return { accion: 'nada', motivo: 'ya-impresa' };

  if (estado === IMPRIMIENDO) {
    const vigente = (ahora - (Number(nodo.lockedAt) || 0)) < leaseMs;
    if (vigente) return { accion: 'nada', motivo: 'la-esta-imprimiendo-otra-terminal' };
    // Lease vencido: la terminal que la tenía murió a mitad. Se retoma.
    return { accion: 'imprimir', motivo: 'lease-vencido', nodo: tomar(nodo, deviceId, ahora) };
  }

  if (estado === ERROR) {
    const intentos = Number(nodo.intentos) || 0;
    if (intentos >= maxIntentos) return { accion: 'nada', motivo: 'agotados-los-intentos' };
    const esperado = (Number(nodo.ultimoIntentoAt) || 0) + backoffMs(intentos);
    if (ahora < esperado) return { accion: 'esperar', motivo: 'backoff' };
    return { accion: 'imprimir', motivo: 'reintento', nodo: tomar(nodo, deviceId, ahora) };
  }

  // Sin nodo o PENDIENTE: manda la ventana de gracia.
  const solicitante = registro.impresionSolicitadaPor || null;
  const emitidaAt = Number(nodo?.creadoAt) || Number(registro.emitidaAt) || null;
  const esElSolicitante = !solicitante || String(solicitante) === String(deviceId);

  if (!esElSolicitante) {
    // Otra terminal vendió: se le respeta la prioridad durante la gracia.
    const desde = emitidaAt ?? ahora;
    if ((ahora - desde) < graciaMs) return { accion: 'esperar', motivo: 'gracia-del-solicitante' };
    return { accion: 'imprimir', motivo: 'takeover-tras-gracia', nodo: tomar(nodo, deviceId, ahora) };
  }

  return { accion: 'imprimir', motivo: 'terminal-que-vendio', nodo: tomar(nodo, deviceId, ahora) };
}

/** Nodo con el que se TOMA la impresión (lo que escribe la transacción). */
function tomar(nodo, deviceId, ahora) {
  return {
    ...(nodo || {}),
    estado: IMPRIMIENDO,
    deviceId: String(deviceId),
    lockedAt: ahora,
    intentos: Number(nodo?.intentos) || 0,
    creadoAt: Number(nodo?.creadoAt) || ahora,
  };
}

/** Cierre exitoso. */
export function marcaImpresa(nodo, { deviceId, ahora = Date.now(), numero = null } = {}) {
  return {
    ...(nodo || {}),
    estado: IMPRESA,
    deviceId: String(deviceId),
    impresaAt: ahora,
    ...(numero ? { numero: String(numero) } : {}),
    ultimoError: null,
  };
}

/** Cierre con fallo: suma un intento y guarda el motivo real. */
export function marcaError(nodo, { deviceId, mensaje, ahora = Date.now() } = {}) {
  return {
    ...(nodo || {}),
    estado: ERROR,
    deviceId: String(deviceId),
    intentos: (Number(nodo?.intentos) || 0) + 1,
    ultimoIntentoAt: ahora,
    ultimoError: String(mensaje || 'Error de impresión'),
  };
}

/** ¿Quedó para reimprimir a mano? (se agotaron los reintentos) */
export function requiereAtencion(nodo, { maxIntentos = MAX_INTENTOS } = {}) {
  return nodo?.estado === ERROR && (Number(nodo.intentos) || 0) >= maxIntentos;
}
