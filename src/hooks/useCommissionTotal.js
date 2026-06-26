import { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';

export const useCommissionTotal = (isActive) => {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const localId = getCurrentLocalId();
    if (!localId) return;

    const db = getDatabase();
    const totalsRef = ref(db, `${localId}/RESUMEN_CUENTA/TOTALES`);
    const listener = onValue(
      totalsRef,
      (snap) => {
        const val = snap.val();
        // Usar TotalComisionAPagar; caer en totalCommission por compatibilidad
        setPending(val?.TotalComisionAPagar ?? val?.totalCommission ?? 0);
      },
      () => {}
    );
    return () => off(totalsRef, 'value', listener);
  }, [isActive]);

  return pending;
};
