// ---------------------------------------------------------------------------
// Normalización de pedidos LEÍDOS (creados por Desktop, por la Tablet o por DLV
// Pedidos, que escriben todos en el mismo nodo PEDIDOS).
//
// Función pura: no consulta Firebase, no consulta el catálogo, no escribe nada.
// Solo decide qué total mostrar/usar y deja constancia si el total recibido no
// coincide con el que se reconstruye desde los snapshots.
//
// ⚠ LÍMITE DE SEGURIDAD CONOCIDO (F1.7, punto 6) — LEER ANTES DE CONFIAR EN ESTO.
//
// Lo que hace esta verificación: detecta que el TOTAL declarado no coincida con
// la suma de los renglones del propio pedido. Sirve contra inconsistencias y
// contra manipular únicamente el campo `total`.
//
// Lo que NO puede hacer: DLV Pedidos corre en el navegador del cliente. Alguien
// con DevTools puede alterar el snapshot ENTERO de forma coherente —
// `precioUnitario`, `total` del opcional, `subtotalLinea` y `payment.total` a la
// vez. En ese caso el pedido queda internamente consistente y esta función lo
// aprueba, aunque sea económicamente falso: Rocklets a $1 con todo cuadrado.
//
// Es decir: recalcular desde el snapshot recibido garantiza COHERENCIA, no
// AUTENTICIDAD. La autenticidad exige contrastar contra una fuente que el
// cliente no controle.
//
// Solución (Fase 2, punto 20): validar los pedidos NUEVOS de origen externo
// contra el catálogo/configuración vigente del local antes de aceptarlos, y
// registrar toda discrepancia de forma visible para el operador. Preferentemente
// en backend/Cloud Function; si no, en el receptor. Esa validación NO debe
// aplicarse a pedidos históricos ni a reimpresiones.
//
// Regla (F1.5, punto 6):
//   · Snapshot COMPLETO  → se reconstruye el total canónico, se compara con el
//     recibido y MANDA el canónico. Un navegador manipulado no puede imponer un
//     total menor.
//   · Pedido HISTÓRICO / incompleto → se respeta el total guardado tal cual. No
//     se buscan precios actuales ni se inventan importes; el pedido abre igual.
// En ningún caso se vuelve a sumar un adicional ya incluido.
// ---------------------------------------------------------------------------

import { verificarTotalRecibido } from './optionalsPricing.js';

/** ¿La línea trae el snapshot económico completo que dejó construirLineaPersistible? */
export function tieneSnapshotCompleto(item) {
  return !!item
    && typeof item === 'object'
    && item.subtotalLinea !== undefined
    && item.precioBaseUnitario !== undefined;
}

/**
 * Un pedido se considera reconstruible solo si TODAS sus líneas traen snapshot.
 * Con una sola línea histórica, se respeta el total guardado del pedido entero
 * (mezclar reconstruido e histórico daría un total que nunca se cobró).
 */
export function pedidoEsReconstruible(order) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  return items.length > 0 && items.every(tieneSnapshotCompleto);
}

/** Total guardado del pedido, mirando los campos históricos conocidos. */
function totalGuardado(order) {
  if (!order) return null;
  const p = order.payment || {};
  const candidatos = [p.total, p.amount, order.total, order.importe];
  for (const c of candidatos) {
    if (c !== undefined && c !== null && c !== '') return c;
  }
  return null;
}

/**
 * Devuelve el pedido con `totalCanonico` y `totalDiscrepante` resueltos.
 * NO muta el pedido original ni escribe en Firebase.
 *
 * @returns {object} copia del pedido con:
 *   totalCanonico     — el total que debe usarse (canónico o el guardado)
 *   totalGuardado     — lo que venía en el pedido
 *   totalDiscrepante  — true si difieren y el snapshot permitía reconstruir
 *   snapshotCompleto  — si se pudo reconstruir
 */
export function normalizarPedidoRecibido(order, { onWarn = null } = {}) {
  if (!order || typeof order !== 'object') return order;

  const guardado = totalGuardado(order);
  const reconstruible = pedidoEsReconstruible(order);

  if (!reconstruible) {
    // Histórico/incompleto: se respeta lo guardado, sin tocar nada.
    return {
      ...order,
      totalCanonico: guardado === null ? null : Number(guardado),
      totalGuardado: guardado === null ? null : Number(guardado),
      totalDiscrepante: false,
      snapshotCompleto: false,
    };
  }

  const r = verificarTotalRecibido(order.items, guardado, { onWarn });
  if (r.difiere && typeof onWarn === 'function') {
    onWarn({
      motivo: 'total-recibido-no-coincide',
      pedido: order.id ?? null,
      totalRecibido: r.totalRecibido,
      totalCanonico: r.totalCanonico,
    });
  }

  return {
    ...order,
    totalCanonico: r.total,          // canónico cuando difiere; si no, el recibido
    totalGuardado: r.totalRecibido,
    totalDiscrepante: !!r.difiere,
    snapshotCompleto: true,
  };
}

/** Aplica la normalización a una lista de pedidos leídos. */
export function normalizarPedidosRecibidos(orders, opts = {}) {
  if (!Array.isArray(orders)) return [];
  return orders.map((o) => normalizarPedidoRecibido(o, opts));
}
