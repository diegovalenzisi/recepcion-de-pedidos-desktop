import { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';

/**
 * Saldo de comisión a pagar = suma de comisiones generadas válidas
 *                             − suma de pagos de comisión aprobados.
 *
 * Fuentes (NO se usa COMISIONES/TOTALES/totalAcumulado ni RESUMEN_CUENTA):
 *   - COMISIONES/REGISTRO  → cada venta con comisionGenerada y estado
 *   - COMISIONES/PAGOS     → cada pago con montoPago y estado
 *
 * Se escuchan ambos nodos en tiempo real:
 *   - entra una venta  → sube el saldo
 *   - se aprueba un pago (incluso desde dlvsistemas) → baja el saldo
 *   - pago parcial     → baja solo lo pagado, queda el resto
 *
 * Reglas:
 *   - REGISTRO: suma comisionGenerada salvo estado "cancelada".
 *   - PAGOS: descuenta montoPago salvo estados no aprobados
 *            (rechazado / pendiente / cancelado / etc.).
 *            Pagos locales sin estado se consideran aprobados.
 *   - El saldo nunca es negativo: si PAGOS supera REGISTRO, muestra 0.
 */

// Estados de PAGOS que NO se descuentan
const NON_APPROVED_PAYMENT = new Set([
  'rechazado', 'rechazada', 'rejected',
  'pendiente', 'pending', 'in_process', 'in_mediation',
  'cancelado', 'cancelada', 'cancelled', 'canceled',
  'refunded', 'charged_back',
]);

// Estados de REGISTRO que NO se suman
const CANCELLED_REGISTRO = new Set(['cancelada', 'cancelado', 'cancelled', 'canceled']);

const toNumber = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Un pago cuenta si no tiene estado (pagos locales antiguos) o si su estado
// no está en la lista de no aprobados.
const isPagoAprobado = (pago) => {
  const estado = String(pago?.estado ?? '').trim().toLowerCase();
  if (!estado) return true;
  return !NON_APPROVED_PAYMENT.has(estado);
};

// Un registro suma salvo que esté cancelado.
const isRegistroValido = (reg) => {
  const estado = String(reg?.estado ?? '').trim().toLowerCase();
  return !CANCELLED_REGISTRO.has(estado);
};

export const useCommissionTotal = (isActive) => {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const localId = getCurrentLocalId();
    if (!localId) return;

    const db = getDatabase();
    const registroRef = ref(db, `${localId}/COMISIONES/REGISTRO`);
    const pagosRef = ref(db, `${localId}/COMISIONES/PAGOS`);

    // Se guardan las dos sumas por separado y se recalcula el saldo cada vez
    // que cualquiera de los dos nodos cambia (tiempo real).
    let sumRegistro = 0;
    let sumPagos = 0;

    const recompute = () => {
      const saldo = sumRegistro - sumPagos;
      setPending(saldo > 0 ? saldo : 0); // nunca negativo
    };

    const regListener = onValue(
      registroRef,
      (snap) => {
        let total = 0;
        snap.forEach((child) => {
          const reg = child.val();
          if (reg && isRegistroValido(reg)) {
            total += toNumber(reg.comisionGenerada);
          }
        });
        sumRegistro = total;
        recompute();
      },
      () => {}
    );

    const pagosListener = onValue(
      pagosRef,
      (snap) => {
        let total = 0;
        snap.forEach((child) => {
          const pago = child.val();
          if (pago && isPagoAprobado(pago)) {
            total += toNumber(pago.montoPago);
          }
        });
        sumPagos = total;
        recompute();
      },
      () => {}
    );

    return () => {
      off(registroRef, 'value', regListener);
      off(pagosRef, 'value', pagosListener);
    };
  }, [isActive]);

  return pending;
};
