// ---------------------------------------------------------------------------
// LEDGER GLOBAL DE OPERACIONES DE STOCK
//
// `appliedOps` (dentro de cada recurso) garantiza exactly-once POR RECURSO y es
// una guarda de corto plazo, acotada a 300 entradas. Este ledger es el registro
// PERMANENTE y por operación: chico, independiente del recurso, y la única
// fuente para saber si una operación quedó a medias y hay que reconciliarla.
//
// Ruta:  {localId}/PROCESSED_STOCK_IDS/{operationKey}
//
// Estados posibles:
//   reserved         — plan fijado, todavía no se tocó ningún recurso
//   processing       — se están aplicando recursos
//   partial          — algunos recursos aplicados, faltan otros
//   completed        — TODOS los recursos aplicados y el movimiento escrito
//   conflict         — se intentó reusar el referenceId con otro impactHash
//   failed           — se agotaron los intentos
//   reversing        — se está revirtiendo
//   reversed         — reversión completa
//   reversal-partial — reversión incompleta
//
// Reglas duras:
//   · El plan canónico y su impactHash se FIJAN en la primera reserva válida.
//     A partir de ahí, el mismo referenceId con otro impacto es `conflict`.
//   · `completed` solo se escribe después de verificar que TODOS los recursos
//     esperados figuran como aplicados. Nunca se confunde partial con completed.
//   · El movimiento tiene ID determinístico y se escribe DESPUÉS de confirmar
//     los recursos, así que un reintento no crea un segundo movimiento.
//
// Módulo puro: no importa Firebase. Devuelve decisiones y payloads.
// ---------------------------------------------------------------------------

import {
  calcularImpactHash, construirImpactoCanonico, construirDocumentoImpacto,
  operationKey, movimientoIdDe, RESERVA_VENCIDA_MS,
} from './stockAtomico.js';

export const ESTADOS = Object.freeze({
  RESERVED: 'reserved',
  PROCESSING: 'processing',
  PARTIAL: 'partial',
  COMPLETED: 'completed',
  CONFLICT: 'conflict',
  FAILED: 'failed',
  REVERSING: 'reversing',
  REVERSED: 'reversed',
  REVERSAL_PARTIAL: 'reversal-partial',
});

/** Estados desde los que ya no corresponde volver a aplicar. */
const TERMINALES_APLICACION = [ESTADOS.COMPLETED, ESTADOS.REVERSING, ESTADOS.REVERSED, ESTADOS.REVERSAL_PARTIAL];

export const MAX_INTENTOS = 5;

/** Clave física del ledger para una operación. */
export const claveLedger = (referenceId) => operationKey('stock', referenceId);

/**
 * Entrada inicial del ledger. Fija el plan y el hash: son inmutables mientras
 * haya algún recurso aplicado.
 */
export function construirReserva({ localId, referenceId, impactMap, source, ownerId, operation = 'decrement', ahora = Date.now() }) {
  const plan = construirImpactoCanonico(impactMap);
  const doc = construirDocumentoImpacto({ localId, operation, impactMap });
  return {
    referenceId: String(referenceId),
    operationKey: claveLedger(referenceId),
    localId: String(localId),
    operation,
    status: ESTADOS.RESERVED,
    impactHash: calcularImpactHash(doc),
    plan,
    recursosEsperados: plan.map((d) => `${d.tipo}:${d.id}`),
    recursosAplicados: [],
    recursosFaltantes: plan.map((d) => `${d.tipo}:${d.id}`),
    movementId: movimientoIdDe(referenceId),
    movimientoEscrito: false,
    intentos: 0,
    ultimoError: null,
    source: source || null,
    ownerId: ownerId || null,
    createdAt: ahora,
    updatedAt: ahora,
    leaseUntil: ahora + RESERVA_VENCIDA_MS,
  };
}

/**
 * Decide qué hacer con una operación a partir del ledger existente.
 *
 * @returns {{ accion: string, motivo: string, ledger?: object }}
 *   accion: 'reservar' | 'continuar' | 'nada' | 'conflicto' | 'esperar' | 'fallida'
 */
export function decidirOperacion({ ledgerActual, localId, referenceId, impactMap, source, ownerId, operation = 'decrement', ahora = Date.now() }) {
  const nueva = construirReserva({ localId, referenceId, impactMap, source, ownerId, operation, ahora });

  if (!ledgerActual) return { accion: 'reservar', motivo: 'sin-ledger', ledger: nueva };

  // El plan quedó fijado en la primera reserva válida.
  if (ledgerActual.impactHash && ledgerActual.impactHash !== nueva.impactHash) {
    // Mientras NO se haya aplicado ningún recurso, un pedido editado puede
    // reemplazar la reserva de forma controlada.
    const sinAplicar = !Array.isArray(ledgerActual.recursosAplicados) || ledgerActual.recursosAplicados.length === 0;
    const puedeReemplazar = sinAplicar
      && [ESTADOS.RESERVED, ESTADOS.PROCESSING, ESTADOS.FAILED].includes(ledgerActual.status);
    if (puedeReemplazar) {
      return {
        accion: 'reservar',
        motivo: 'plan-reemplazado-sin-impacto-aplicado',
        ledger: { ...nueva, intentos: Number(ledgerActual.intentos) || 0, planAnterior: ledgerActual.impactHash },
      };
    }
    // Ya hay impacto aplicado: NO se puede cambiar el hash de esta operación.
    // Cualquier cambio posterior debe ser un ajuste con otro referenceId.
    return { accion: 'conflicto', motivo: 'hash-conflict', ledger: { ...ledgerActual, status: ESTADOS.CONFLICT, hashRecibido: nueva.impactHash, updatedAt: ahora } };
  }

  if (TERMINALES_APLICACION.includes(ledgerActual.status)) {
    return { accion: 'nada', motivo: `estado-${ledgerActual.status}` };
  }
  if (ledgerActual.status === ESTADOS.CONFLICT) {
    return { accion: 'conflicto', motivo: 'conflicto-previo' };
  }
  if ((Number(ledgerActual.intentos) || 0) >= MAX_INTENTOS) {
    return { accion: 'fallida', motivo: 'max-intentos' };
  }

  // reserved / processing / partial: se continúa. Si el lease sigue vigente y
  // el dueño es otro, se espera (evita trabajo repetido; la corrección ya la
  // garantiza appliedOps).
  const leaseVigente = (Number(ledgerActual.leaseUntil) || 0) > ahora;
  if (leaseVigente && ledgerActual.ownerId && ownerId && ledgerActual.ownerId !== ownerId) {
    return { accion: 'esperar', motivo: 'lease-de-otro-dueno' };
  }
  return {
    accion: 'continuar',
    motivo: `retomar-${ledgerActual.status}`,
    ledger: {
      ...ledgerActual,
      status: ESTADOS.PROCESSING,
      ownerId: ownerId || ledgerActual.ownerId,
      intentos: (Number(ledgerActual.intentos) || 0) + 1,
      updatedAt: ahora,
      leaseUntil: ahora + RESERVA_VENCIDA_MS,
    },
  };
}

/**
 * Cierra la operación a partir de lo que REALMENTE quedó aplicado en cada
 * recurso. `completed` solo si no falta ninguno.
 *
 * @param {object} ledger
 * @param {Array<{recurso:string, aplicado:boolean, error?:string}>} resultados
 */
export function cerrarOperacion(ledger, resultados, { movimientoEscrito = false, ahora = Date.now() } = {}) {
  const aplicados = resultados.filter((r) => r.aplicado).map((r) => r.recurso);
  const faltantes = (ledger.recursosEsperados || []).filter((r) => !aplicados.includes(r));
  const errores = resultados.filter((r) => !r.aplicado && r.error).map((r) => `${r.recurso}: ${r.error}`);

  const todosAplicados = faltantes.length === 0;
  // El movimiento se escribe DESPUÉS de confirmar los recursos: sin él, la
  // operación no está terminada y el reconciliador debe completarla.
  const status = (todosAplicados && movimientoEscrito) ? ESTADOS.COMPLETED : ESTADOS.PARTIAL;

  return {
    ...ledger,
    status,
    recursosAplicados: aplicados,
    recursosFaltantes: faltantes,
    movimientoEscrito: !!movimientoEscrito,
    ultimoError: errores.length > 0 ? errores.join(' | ') : null,
    updatedAt: ahora,
    ...(status === ESTADOS.COMPLETED ? { completedAt: ahora } : {}),
  };
}

/** ¿Esta operación necesita que el reconciliador la retome? */
export function necesitaReconciliacion(ledger, ahora = Date.now()) {
  if (!ledger) return false;
  if (ledger.status === ESTADOS.COMPLETED) return false;
  if (ledger.status === ESTADOS.CONFLICT) return false;
  if (ledger.status === ESTADOS.REVERSED) return false;
  if ((Number(ledger.intentos) || 0) >= MAX_INTENTOS) return false;   // ya es `failed`, se avisa al operador
  if (ledger.status === ESTADOS.PARTIAL) return true;
  // reserved/processing con lease vencido = alguien murió a mitad de camino.
  return (Number(ledger.leaseUntil) || 0) < ahora;
}

/**
 * Qué le falta a una operación para cerrarse. Distingue "faltan recursos" de
 * "solo falta el movimiento", porque el segundo caso NO debe volver a descontar.
 */
export function pendientesDe(ledger) {
  const faltantes = Array.isArray(ledger.recursosFaltantes) ? ledger.recursosFaltantes : [];
  return {
    recursos: faltantes,
    soloFaltaMovimiento: faltantes.length === 0 && !ledger.movimientoEscrito,
    nadaPendiente: faltantes.length === 0 && !!ledger.movimientoEscrito,
  };
}

/**
 * Selecciona las operaciones a reconciliar. Nunca toma operaciones de otro
 * local y limita el lote para no bloquear la interfaz.
 */
export function seleccionarParaReconciliar(ledgers, { localId, ahora = Date.now(), maximo = 20 } = {}) {
  const lista = Object.values(ledgers || {})
    .filter((l) => l && String(l.localId) === String(localId))
    .filter((l) => necesitaReconciliacion(l, ahora))
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  return lista.slice(0, maximo);
}

/** Operaciones que hay que mostrarle al operador porque no pudieron cerrarse. */
export function operacionesParaAvisar(ledgers, { localId, ahora = Date.now() } = {}) {
  return Object.values(ledgers || {})
    .filter((l) => l && String(l.localId) === String(localId))
    .filter((l) => l.status === ESTADOS.CONFLICT
      || l.status === ESTADOS.FAILED
      || (Number(l.intentos) || 0) >= MAX_INTENTOS
      || (l.status === ESTADOS.PARTIAL && (ahora - (Number(l.updatedAt) || 0)) > 10 * 60 * 1000)
      || l.status === ESTADOS.REVERSAL_PARTIAL)
    .map((l) => ({
      referenceId: l.referenceId,
      status: l.status,
      recursosFaltantes: l.recursosFaltantes || [],
      intentos: l.intentos || 0,
      ultimoError: l.ultimoError || null,
      motivo: l.status === ESTADOS.CONFLICT
        ? 'El pedido cambió después de haber descontado stock: requiere un ajuste explícito.'
        : 'El descuento de stock quedó incompleto y no pudo completarse automáticamente.',
    }));
}

/** Payload del movimiento determinístico (se escribe una sola vez). */
export function construirMovimiento(ledger, { ahora = Date.now() } = {}) {
  return {
    id: ledger.movementId,
    tipo: ledger.operation === 'increment' ? 'entrada' : 'salida',
    motivo: ledger.source || 'Movimiento de stock',
    referenceId: ledger.referenceId,
    operationKey: ledger.operationKey,
    impactHash: ledger.impactHash,
    detalles: ledger.plan,
    fecha: new Date(ahora).toISOString(),
    timestamp: ahora,
  };
}

/** Ledger de una REVERSIÓN, derivado del ledger original ya completado. */
export function construirLedgerReversion(ledgerOriginal, { referenceIdReversion, ownerId, ahora = Date.now() }) {
  if (!ledgerOriginal) return { error: 'sin-original' };
  // Solo se revierte lo que realmente se aplicó, no el plan completo.
  const aplicados = Array.isArray(ledgerOriginal.recursosAplicados) ? ledgerOriginal.recursosAplicados : [];
  if (aplicados.length === 0) return { error: 'original-sin-impacto-aplicado' };

  const planReversion = (ledgerOriginal.plan || []).filter((d) => aplicados.includes(`${d.tipo}:${d.id}`));
  return {
    referenceId: String(referenceIdReversion),
    operationKey: claveLedger(referenceIdReversion),
    localId: ledgerOriginal.localId,
    operation: 'increment',
    status: ESTADOS.REVERSING,
    revierteA: ledgerOriginal.referenceId,
    impactHashOriginal: ledgerOriginal.impactHash,
    impactHash: calcularImpactHash(
      Object.fromEntries(planReversion.map((d) => [d.id, { quantity: d.cantidad, type: d.tipo }])),
      { localId: ledgerOriginal.localId, operation: 'increment', referenceIdOriginal: ledgerOriginal.referenceId },
    ),
    plan: planReversion,
    recursosEsperados: planReversion.map((d) => `${d.tipo}:${d.id}`),
    recursosAplicados: [],
    recursosFaltantes: planReversion.map((d) => `${d.tipo}:${d.id}`),
    movementId: movimientoIdDe(referenceIdReversion),
    movimientoEscrito: false,
    intentos: 0,
    ultimoError: null,
    source: 'Reversión',
    ownerId: ownerId || null,
    createdAt: ahora,
    updatedAt: ahora,
    leaseUntil: ahora + RESERVA_VENCIDA_MS,
  };
}

/** Cierra una reversión: `reversed` solo si se repuso todo lo que se había aplicado. */
export function cerrarReversion(ledgerReversion, resultados, { movimientoEscrito = false, ahora = Date.now() } = {}) {
  const cerrado = cerrarOperacion(ledgerReversion, resultados, { movimientoEscrito, ahora });
  return {
    ...cerrado,
    status: cerrado.status === ESTADOS.COMPLETED ? ESTADOS.REVERSED : ESTADOS.REVERSAL_PARTIAL,
  };
}
