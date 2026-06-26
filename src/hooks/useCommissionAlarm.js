import { useState, useEffect, useRef } from 'react';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';

/**
 * Monitorea TotalComisionAPagar vs alarmaPago.
 * Muestra el modal cuando TotalComisionAPagar >= alarmaPago.
 * - Por sesión: si el usuario acepta, no vuelve a aparecer HASTA que
 *   la comisión baje del límite y luego vuelva a superarlo.
 * - Al reiniciar la app: los refs se resetean → modal aparece de nuevo si aplica.
 * No guarda nada en Firebase; el "aceptado" es solo en memoria.
 */
export const useCommissionAlarm = (alarmaPago, isActive) => {
  const [showModal, setShowModal]   = useState(false);
  const [pendingAmount, setPendingAmount] = useState(0);
  const dismissedRef  = useRef(false);
  const wasAboveRef   = useRef(false);

  useEffect(() => {
    const alarmLimit = Number(alarmaPago) || 0;

    if (!isActive || alarmLimit <= 0) {
      setShowModal(false);
      return;
    }

    const db = getDatabase();
    const localId = getCurrentLocalId();
    if (!localId) return;

    const totalsRef = ref(db, `${localId}/RESUMEN_CUENTA/TOTALES`);

    const listener = onValue(
      totalsRef,
      (snapshot) => {
        const val  = snapshot.val();
        // Usar TotalComisionAPagar; caer en totalCommission por compatibilidad
        const aPagar = val?.TotalComisionAPagar ?? val?.totalCommission ?? 0;
        setPendingAmount(aPagar);

        if (aPagar >= alarmLimit) {
          wasAboveRef.current = true;
          if (!dismissedRef.current) setShowModal(true);
        } else {
          // Bajó del límite: resetear para que vuelva a avisar la próxima vez
          if (wasAboveRef.current) dismissedRef.current = false;
          wasAboveRef.current = false;
          setShowModal(false);
        }
      },
      (error) => {
        console.error('[commission-alarm] Error al leer totales:', error);
      }
    );

    return () => off(totalsRef, 'value', listener);
  }, [alarmaPago, isActive]);

  const dismiss = () => {
    dismissedRef.current = true;
    setShowModal(false);
  };

  return { showModal, dismiss, pendingAmount };
};
