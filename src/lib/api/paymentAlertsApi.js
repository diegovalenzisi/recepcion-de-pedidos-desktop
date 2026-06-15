import { getDatabase, ref, onValue, update, set } from 'firebase/database';
import { format } from 'date-fns';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

const PAGOS_CONFIRMADOS_PATH = 'PAGOS_CONFIRMADOS';

export const listenToPaymentConfirmations = (callback, errorCallback) => {
  try {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const paymentsRef = ref(db, `${LOCAL_ID}/${PAGOS_CONFIRMADOS_PATH}`);

    const unsubscribe = onValue(paymentsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        callback([]);
        return;
      }

      const paymentsArray = Object.keys(data).map((key) => ({
        id: key,
        ...data[key],
      }));

      callback(paymentsArray);
    }, (error) => {
      console.error('🔥 [CRITICAL] Error listening to payment confirmations from Firebase:', error);
      if (errorCallback) {
        errorCallback(error);
      }
    });

    return unsubscribe;
  } catch (error) {
    console.error('Error setting up payment confirmations listener:', error);
    if (errorCallback) {
      errorCallback(error);
    }
    return () => {};
  }
};

export const markPaymentAsAnnounced = async (paymentId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const paymentRef = ref(db, `${LOCAL_ID}/${PAGOS_CONFIRMADOS_PATH}/${paymentId}`);
  await update(paymentRef, { leido: true });
};

export const createTestPaymentConfirmation = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const testId = `prueba_manual_${Date.now()}`;
  const paymentRef = ref(db, `${LOCAL_ID}/${PAGOS_CONFIRMADOS_PATH}/${testId}`);
  const now = new Date();

  await set(paymentRef, {
    cliente: 'Juan Pérez',
    monto: 12500,
    pedidoId: 'PRUEBA',
    fecha: format(now, 'yyyy-MM-dd'),
    hora: format(now, 'HH:mm'),
    leido: false,
  });
};
