import { useState, useEffect } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { getCurrentLocalId, getCurrentDatabaseOrThrow } from '@/lib/firebase/core';
import { contabilidadActiva, leerAcumuladores, aPesos, aCentavos, rutaTotales } from '@/lib/api/comisionMovimiento';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

/**
 * Saldo de comisión a pagar = suma de comisiones generadas válidas
 *                             − suma de pagos de comisión aprobados.
 *
 * Fuentes (NO se usa COMISIONES/TOTALES/totalAcumulado, RESUMEN_CUENTA ni
 * PAGOS_COMISIONES — ese último es un ledger viejo, independiente, que puede
 * quedar desincronizado de COMISIONES/PAGOS; ver diagnóstico de Centenario):
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
 *
 * Dos exports, misma fuente y mismo cálculo (sin duplicar la fórmula):
 *   - useCommissionTotal(isActive)   → número simple (saldo pendiente). Usado
 *     por el footer y el aviso al entrar (App.jsx).
 *   - useCommissionBalance(isActive) → { totalGenerated, totalPaid, pending,
 *     loading }. Usado donde además del pendiente hace falta mostrar el
 *     acumulado y lo pagado por separado (panel Configuración → Pago de
 *     Comisiones).
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

/**
 * Fuente ÚNICA y compartida del balance de comisión. Devuelve las tres cifras
 * (generado, pagado, pendiente) en tiempo real, para que cualquier pantalla que
 * necesite mostrar más de un número (ej. el panel de Configuración → Pago de
 * Comisiones, que muestra "Total Comisión Acumulada" y "Total pagos realizados"
 * por separado, además del pendiente) no tenga que reimplementar la suma.
 *
 * NO usa RESUMEN_CUENTA/TOTALES ni PAGOS_COMISIONES (ledger viejo, desconectado
 * de COMISIONES/REGISTRO — ver diagnóstico de Centenario). Única fuente:
 *   - COMISIONES/REGISTRO → totalGenerated
 *   - COMISIONES/PAGOS    → totalPaid
 */
export const useCommissionBalance = (isActive = true) => {
  const [state, setState] = useState({
    totalGenerated: 0, totalPaid: 0, pending: 0,
    totalGeneratedCentavos: 0, totalPaidCentavos: 0, pendingCentavos: 0,
    contabilidadNueva: false, loading: true,
  });
  // firebaseReady en las deps del efecto de abajo: antes este hook solo
  // reaccionaba a `isActive` (típicamente !!user && !!localId), que NO
  // cambia de valor al cambiar de local A a B (ambos son localId truthy) —
  // los listeners de COMISIONES/REGISTRO y COMISIONES/PAGOS del local
  // ANTERIOR quedaban activos para siempre. Con firebaseReady, el efecto se
  // desmonta apenas empieza el cambio (ready pasa a false) y se vuelve a
  // montar recién cuando el nuevo local está confirmado.
  const { ready: firebaseReady } = useFirebaseReadiness();

  useEffect(() => {
    if (!isActive || !firebaseReady) {
      setState({
        totalGenerated: 0, totalPaid: 0, pending: 0,
        totalGeneratedCentavos: 0, totalPaidCentavos: 0, pendingCentavos: 0,
        contabilidadNueva: false, loading: !isActive ? false : true,
      });
      return;
    }
    const localId = getCurrentLocalId();
    if (!localId) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    let db;
    try {
      db = getCurrentDatabaseOrThrow(localId);
    } catch (e) {
      console.warn('[useCommissionBalance] Firebase todavía no está listo:', e.message);
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    // -----------------------------------------------------------------------
    // CAMINO NUEVO: leer los tres acumuladores y nada más.
    //
    // Con la contabilidad activa NO se recorre REGISTRO ni PAGOS. Se escucha
    // COMISIONES/TOTALES, que son cuatro números: iniciar la aplicación, abrir
    // Configuración o montar este hook deja de descargar y sumar el historial
    // entero (en Achaval eran 834 KB en cada arranque).
    //
    // Mientras migracionVersion < 1 se usa el camino de siempre, sin cambios.
    // -----------------------------------------------------------------------
    const totalesRef = ref(db, rutaTotales(localId));
    let desuscribirTotales = null;
    let modoNuevo = null;   // null = todavía no se sabe

    const escucharTotales = () => onValue(totalesRef, (snap) => {
      const totales = snap.val();
      const activa = contabilidadActiva(totales);

      if (activa) {
        // TRANSICIÓN 0 → 1. Si los listeners legados ya estaban montados hay
        // que DESMONTARLOS: si no, seguirían descargando REGISTRO y PAGOS en
        // segundo plano para siempre, que es justamente lo que veníamos a
        // eliminar. Y sus callbacks pisarían el estado con los valores viejos.
        if (modoNuevo === false) desmontarModoLegado();
        modoNuevo = true;
        const a = leerAcumuladores(totales);
        setState({
          // CENTAVOS: la fuente para cualquier validacion contable.
          totalGeneratedCentavos: a.totalAcumuladoCentavos,
          totalPaidCentavos: a.totalPagadoCentavos,
          pendingCentavos: a.saldoPendienteCentavos,
          // PESOS: derivados SOLO para las pantallas que ya los consumen.
          totalGenerated: aPesos(a.totalAcumuladoCentavos),
          totalPaid: aPesos(a.totalPagadoCentavos),
          pending: aPesos(a.saldoPendienteCentavos),
          contabilidadNueva: true,
          loading: false,
        });
        return;
      }

      // Dormido: se activan los listeners de siempre, una sola vez.
      if (modoNuevo === null) {
        modoNuevo = false;
        activarModoLegado();
      }
    }, () => { if (modoNuevo === null) { modoNuevo = false; activarModoLegado(); } });

    const registroRef = ref(db, `${localId}/COMISIONES/REGISTRO`);
    const pagosRef = ref(db, `${localId}/COMISIONES/PAGOS`);

    // Se guardan las dos sumas por separado y se recalcula el balance cada vez
    // que cualquiera de los dos nodos cambia (tiempo real).
    let sumRegistro = 0;
    let sumPagos = 0;
    let registroLoaded = false;
    let pagosLoaded = false;

    const recompute = () => {
      const pending = sumRegistro - sumPagos;
      const pendienteFinal = pending > 0 ? pending : 0;
      setState({
        totalGenerated: sumRegistro,
        totalPaid: sumPagos,
        pending: pendienteFinal,
        // Dormido la fuente son pesos; se ofrecen igual en centavos para que la
        // logica nueva no tenga que convertir en cada llamador.
        totalGeneratedCentavos: aCentavos(sumRegistro),
        totalPaidCentavos: aCentavos(sumPagos),
        pendingCentavos: aCentavos(pendienteFinal),
        contabilidadNueva: false,
        loading: !(registroLoaded && pagosLoaded),
      });
    };

    let regListener = null, pagosListener = null;

    /** Desmonta los listeners legados. Idempotente. */
    const desmontarModoLegado = () => {
      if (regListener) { off(registroRef, 'value', regListener); regListener = null; }
      if (pagosListener) { off(pagosRef, 'value', pagosListener); pagosListener = null; }
    };

    const activarModoLegado = () => {
      // Nunca dos veces: si ya estan montados no se duplican.
      if (regListener || pagosListener) return;
    regListener = onValue(
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
        registroLoaded = true;
        recompute();
      },
      () => { registroLoaded = true; recompute(); }
    );

    pagosListener = onValue(
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
        pagosLoaded = true;
        recompute();
      },
      () => { pagosLoaded = true; recompute(); }
    );
    };   // fin de activarModoLegado

    // Se escucha SIEMPRE el nodo de totales; él decide qué camino se usa.
    desuscribirTotales = escucharTotales();

    return () => {
      if (desuscribirTotales) off(totalesRef, 'value', desuscribirTotales);
      if (regListener) off(registroRef, 'value', regListener);
      if (pagosListener) off(pagosRef, 'value', pagosListener);
    };
  }, [isActive, firebaseReady]);

  return state;
};

// Compatibilidad: el footer y el aviso al entrar (App.jsx) solo necesitan el saldo
// pendiente como número simple. Envoltorio fino sobre useCommissionBalance — misma
// fuente, mismo cálculo, sin duplicar la fórmula.
export const useCommissionTotal = (isActive) => useCommissionBalance(isActive).pending;
