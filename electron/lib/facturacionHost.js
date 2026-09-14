'use strict';

// ---------------------------------------------------------------------------
// HOST FISCAL ÚNICO POR LOCAL — decisión pura, sin Firebase ni fs.
//
// Máximo UNA PC por local ejecuta node-afip; mínimo una (mientras haya al
// menos una PC elegible viva), vía un lease con heartbeat sobre
//
//     /{localId}/FACTURACION_HOST = { machineId, hostname, heartbeatAt,
//                                      leaseUntil, claimedAt, appVersion }
//
// adquirido SIEMPRE con `runTransaction` (nunca `set()` ciego) — mismo
// mecanismo que ya prueba `claimPedido.mjs` para el claim por pedido: el
// reductor puede devolver `undefined` para abortar, y el nodo resultante
// decide quién ganó. `ahora` se pasa siempre por parámetro (nunca
// `Date.now()` adentro), calculado afuera con el offset del reloj del
// servidor de Firebase (`.info/serverTimeOffset`) — ver electron/main.js.
//
// SEGURIDAD DELIBERADA (dos correcciones sobre el diseño original):
//   1. NO existe ningún reductor que pueda pisar un lease vigente ajeno.
//      `reductorDeHost` es el ÚNICO que adquiere, y lo usan por igual el
//      ciclo automático, el botón manual "Iniciar" y la adquisición final
//      de un traslado ("Tomar control fiscal"). Un traslado deliberado NUNCA
//      roba: le pide a la PC dueña que suelte (FACTURACION_HOST_TRANSFER,
//      ver main.js) y sólo entonces esta misma función gana por la vía
//      normal, con el nodo ya libre.
//   2. NO se usa `onDisconnect()` sobre este nodo: no existe una variante
//      condicional ("borrá esto sólo si sigue siendo mío") en la API de
//      Firebase, así que un `onDisconnect` viejo podría borrar el host
//      vigente de otra PC que lo ganó después. El único mecanismo de
//      recuperación para cierre abrupto/pérdida de red es `leaseUntil`.
//
// Módulo puro: testeable con `node` plano, sin emulador.
// ---------------------------------------------------------------------------

/** Cada cuánto la PC dueña renueva su lease (y cada cuánto se reintenta ganar). */
const HEARTBEAT_INTERVALO_MS = 15000;

/** Cuánto dura un lease sin renovar antes de poder ser tomado por otra PC. */
const LEASE_MS = 60000;

/**
 * "Tomar control fiscal": cada cuánto reintenta B la adquisición normal
 * mientras espera que la PC dueña procese la solicitud de traslado, y cuánto
 * tiempo total espera antes de resignarse al ciclo normal de heartbeat (que
 * de cualquier forma va a ganar solo en cuanto el lease real venza).
 */
const TOMA_CONTROL_REINTENTO_MS = 2000;
const TOMA_CONTROL_TIMEOUT_MS = 20000;

/**
 * Reductor de ADQUISICIÓN — el único que existe. Se le pasa a
 * `runTransaction(hostRef, reductorDeHost({...}))`.
 *
 *   nodo ausente            → reclama;
 *   ya soy el dueño          → renueva (conserva `claimedAt` original);
 *   dueño vigente, no soy yo → aborta (`undefined`) — NUNCA lo pisa;
 *   dueño con lease vencido  → toma (nuevo `claimedAt`).
 *
 * @param {object} params
 * @param {string} params.machineId
 * @param {string} params.hostname
 * @param {number} params.ahora       Date.now() + offset de servidor, calculado AFUERA.
 * @param {string} [params.appVersion]
 * @returns {(actual: object|null) => object|undefined} reductor de transacción.
 */
function reductorDeHost({ machineId, hostname, ahora, appVersion = null }) {
  return function reducir(actual) {
    if (!actual || typeof actual !== 'object') {
      return { machineId, hostname, heartbeatAt: ahora, leaseUntil: ahora + LEASE_MS, claimedAt: ahora, appVersion };
    }
    if (actual.machineId === machineId) {
      return { ...actual, hostname, heartbeatAt: ahora, leaseUntil: ahora + LEASE_MS, appVersion };
    }
    if (typeof actual.leaseUntil === 'number' && actual.leaseUntil < ahora) {
      return { machineId, hostname, heartbeatAt: ahora, leaseUntil: ahora + LEASE_MS, claimedAt: ahora, appVersion };
    }
    return undefined; // dueño vigente y no soy yo: abortar, nunca pisar.
  };
}

/**
 * Reductor de LIBERACIÓN — lo usan por igual el cierre normal y el handoff
 * de "Tomar control fiscal". Sólo suelta si TODAVÍA soy el dueño; si para
 * ese momento ya no lo soy (lease vencido y otra PC lo tomó), aborta sin
 * tocar nada ajeno.
 *
 * @param {object} params
 * @param {string} params.machineId
 * @returns {(actual: object|null) => null|undefined}
 */
function reductorDeLiberacion({ machineId }) {
  return function reducir(actual) {
    if (actual && typeof actual === 'object' && actual.machineId === machineId) {
      return null; // libera de verdad: el nodo queda ausente.
    }
    return undefined; // no hay nada mío que soltar acá.
  };
}

/** ¿Este registro de host sigue vigente (lease no vencido) a esta hora? */
function heartbeatVigente(hostRecord, ahora) {
  return !!hostRecord && typeof hostRecord.leaseUntil === 'number' && hostRecord.leaseUntil >= ahora;
}

/** ¿Esta PC es la dueña actual del registro (independiente de si venció)? */
function esGanador(hostRecord, machineId) {
  return !!hostRecord && hostRecord.machineId === machineId;
}

module.exports = {
  HEARTBEAT_INTERVALO_MS,
  LEASE_MS,
  TOMA_CONTROL_REINTENTO_MS,
  TOMA_CONTROL_TIMEOUT_MS,
  reductorDeHost,
  reductorDeLiberacion,
  heartbeatVigente,
  esGanador,
};
