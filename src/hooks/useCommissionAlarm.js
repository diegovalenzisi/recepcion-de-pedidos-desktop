import { useState, useEffect, useRef } from 'react';

/**
 * Monitorea el saldo de comisión PENDIENTE vs alarmaPago y decide si mostrar el aviso.
 *
 * IMPORTANTE: este hook YA NO calcula el saldo por su cuenta. Recibe `pendingCommission`
 * ya calculado por useCommissionTotal (COMISIONES/REGISTRO − COMISIONES/PAGOS), la MISMA
 * fuente que usa el indicador "Comisión a Pagar" del footer — así el aviso y el footer
 * muestran siempre exactamente el mismo número (ver App.jsx).
 *
 * Antes leía RESUMEN_CUENTA/TOTALES/TotalComisionAPagar, un campo que se reacumula en cada
 * venta y solo se descuenta si el pago pasa por processCommissionPayment (panel Admin); los
 * pagos registrados por otras vías (p. ej. aprobados desde dlvsistemas, que sí actualizan
 * COMISIONES/PAGOS) nunca lo decrementaban, dejando ese campo "atascado" en el acumulado
 * histórico — causa del aviso mostrando un monto muy superior al saldo real (ej. Centenario:
 * avisaba 51086 en vez de 3254).
 *
 * - Por sesión: si el usuario acepta, no vuelve a aparecer HASTA que la comisión baje del
 *   límite y luego vuelva a superarlo.
 * - Al reiniciar la app: los refs se resetean → modal aparece de nuevo si aplica.
 * No guarda nada en Firebase; el "aceptado" es solo en memoria.
 */
export const useCommissionAlarm = (alarmaPago, isActive, pendingCommission) => {
  const [showModal, setShowModal] = useState(false);
  const dismissedRef = useRef(false);
  const wasAboveRef  = useRef(false);

  useEffect(() => {
    const alarmLimit = Number(alarmaPago) || 0;

    if (!isActive || alarmLimit <= 0) {
      setShowModal(false);
      return;
    }

    // pendingCommission ya viene clampeado a >= 0 desde useCommissionTotal.
    const aPagar = Number(pendingCommission) || 0;

    if (aPagar >= alarmLimit) {
      wasAboveRef.current = true;
      if (!dismissedRef.current) setShowModal(true);
    } else {
      // Bajó del límite: resetear para que vuelva a avisar la próxima vez que lo supere.
      if (wasAboveRef.current) dismissedRef.current = false;
      wasAboveRef.current = false;
      setShowModal(false);
    }
  }, [alarmaPago, isActive, pendingCommission]);

  const dismiss = () => {
    dismissedRef.current = true;
    setShowModal(false);
  };

  return { showModal, dismiss };
};
