// ---------------------------------------------------------------------------
// REPARTO DE UN PEDIDO ENTRE VARIAS PCs, Y RECONCILIACIÓN CONTRA ARCA
//
// Desde que toda PC arranca el motor por defecto, dos computadoras del mismo
// local pueden estar escuchando la misma cola. Todo lo que protegía antes
// (listener único, cola secuencial, Sets en memoria) vive DENTRO de un proceso y
// no sirve para eso. Esto sí.
//
// NO es una rama `{COLA}_LOCKS`: el claim viaja DENTRO del propio pedido y se va
// con él cuando se emite la factura. Sin árbol paralelo, sin renovación, sin
// barrido de vencidos.
//
// El caso peligroso, y el motivo de la mitad de este archivo:
//
//     PC A gana el claim
//     PC A le pide a ARCA el comprobante 125
//     ARCA AUTORIZA el 125
//     PC A se cierra antes de escribir el historial
//     vence el TTL
//     PC B gana el claim
//
// El historial local no sabe nada del 125, así que sin protección PC B emitiría
// un SEGUNDO comprobante para la misma venta — y un CAE no se puede anular. La
// única fuente de verdad ahí es ARCA. Por eso:
//
//   1. ANTES de pedir el CAE se anota la intención (`claim.intento`) con el
//      número que se va a usar. Sin esa marca, quien retome no sabe qué
//      preguntar.
//   2. Al retomar un pedido que trae `claim.intento`, se le pregunta a ARCA por
//      ESE número (FECompConsultar). Si ya está autorizado, no se emite nada: se
//      reconcilia con el comprobante que ya existe.
//
// Módulo puro: sin Firebase, sin SOAP, sin filesystem. Decide; no ejecuta. Lo
// usan por igual el motor de Monotributo (Factura C) y el de Responsable
// Inscripto (Factura B), que tienen numeración, tipo de comprobante y forma de
// hablar con WSFE distintas — por eso lo que se comparte es la DECISIÓN, no el
// código de emisión.
// ---------------------------------------------------------------------------

/**
 * Cuánto vale el claim de una PC sobre un pedido. Si la PC que lo tomó se apaga
 * a mitad, pasado este tiempo otra puede retomarlo. Cinco minutos: de sobra para
 * una emisión lenta contra ARCA, y poco para destrabar un pedido huérfano.
 */
export const CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Reductor de la transacción de claim. Se le pasa a `ref.transaction()` tal cual.
 *
 * Devuelve `undefined` para ABORTAR la transacción (que es como Firebase
 * entiende "no toques nada"), y el nodo modificado para tomarlo.
 *
 * @param {string} machineId  identidad de ESTA PC
 * @param {number} ahora      Date.now() inyectable, para poder probarlo
 * @returns {(pedido: object|null) => object|undefined}
 */
export function reductorDeClaim(machineId, ahora = Date.now()) {
  return (pedido) => {
    if (pedido === null || pedido === undefined) return pedido; // ya no está: otra PC lo facturó
    const c = pedido.claim;
    const vigenteDeOtro = c
      && c.machineId !== machineId
      && (ahora - (c.at || 0)) < CLAIM_TTL_MS;
    if (vigenteDeOtro) return undefined;                        // abortar: es de otra PC
    return { ...pedido, claim: { ...(c || {}), machineId, at: ahora } };
  };
}

/**
 * ¿Esta PC ganó el claim? Se mira el nodo QUE QUEDÓ, no si la transacción se
 * "commiteó": Firebase puede reportar commit sobre un aborto.
 */
export function gano(resultadoTransaccion, machineId) {
  if (!resultadoTransaccion || !resultadoTransaccion.committed) return false;
  const val = typeof resultadoTransaccion.snapshot?.val === 'function'
    ? resultadoTransaccion.snapshot.val()
    : resultadoTransaccion.snapshot;
  return !!val && val.claim && val.claim.machineId === machineId;
}

/** Marca de intención fiscal, para guardar en `claim.intento` ANTES del CAE. */
export function marcaDeIntento({ nroCbte, ptoVta, cbteTipo, machineId, ahora = Date.now() }) {
  return { nroCbte, ptoVta, cbteTipo, machineId, at: ahora };
}

/**
 * Qué hacer con un pedido recién reclamado, ANTES de pedir un CAE nuevo.
 *
 * El orden importa y es el mismo para los dos motores:
 *   1. ¿ya está en el historial?      → no emitir, limpiar la cola
 *   2. ¿hay un intento fiscal previo? → preguntarle a ARCA por ESE número
 *        · ARCA lo tiene autorizado   → reconciliar con el existente
 *        · ARCA no lo tiene           → se puede emitir
 *   3. si no hay intento previo       → se puede emitir
 *
 * @param {object} params
 * @param {string|null} params.claveEnHistorial  resultado de buscar el pedido en el historial
 * @param {object|null} params.intentoPrevio     `claim.intento` que dejó un intento anterior
 * @param {object|null} params.comprobanteEnArca respuesta de FECompConsultar para ese número
 * @returns {{ accion: 'ya-facturado'|'reconciliar'|'emitir', nroCbte?: number, cae?: object, motivo: string }}
 */
export function decidirEmision({ claveEnHistorial = null, intentoPrevio = null, comprobanteEnArca = null } = {}) {
  if (claveEnHistorial) {
    return {
      accion: 'ya-facturado',
      motivo: `ya figura en el historial como ${claveEnHistorial}: no se re-emite, se limpia la cola.`,
    };
  }

  if (intentoPrevio && intentoPrevio.nroCbte) {
    if (comprobanteEnArca && comprobanteEnArca.CodAutorizacion) {
      return {
        accion: 'reconciliar',
        nroCbte: intentoPrevio.nroCbte,
        cae: { CAE: comprobanteEnArca.CodAutorizacion, CAEFchVto: comprobanteEnArca.FchVto },
        motivo: `ARCA ya autorizó el comprobante ${intentoPrevio.nroCbte} (CAE ${comprobanteEnArca.CodAutorizacion}): se registra ese, no se emite otro.`,
      };
    }
    return {
      accion: 'emitir',
      motivo: `el intento previo (comprobante ${intentoPrevio.nroCbte}) no llegó a autorizarse en ARCA: se puede emitir.`,
    };
  }

  return { accion: 'emitir', motivo: 'sin intento previo: emisión normal.' };
}

/**
 * Saca del pedido lo que es puramente operativo, para que no termine dentro del
 * comprobante. `claim` es reparto de trabajo entre PCs, no un dato fiscal, y los
 * dos motores arman el historial haciendo spread del pedido.
 */
export function sinDatosOperativos(pedido) {
  const p = { ...(pedido || {}) };
  delete p.claim;
  return p;
}
