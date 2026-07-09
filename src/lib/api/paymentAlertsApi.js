import { getDatabase, ref, onValue, update, set, get } from 'firebase/database';
import { format } from 'date-fns';
import { getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';

const PAGOS_CONFIRMADOS_SUFFIX = 'PAGOS_CONFIRMADOS';

const resolvePaymentsPath = (pathOverride) => {
  if (pathOverride) return pathOverride;
  checkLocalId();
  return `${getCurrentDatabasePath()}/${PAGOS_CONFIRMADOS_SUFFIX}`;
};

export const listenToPaymentConfirmations = (callback, errorCallback, pathOverride = null) => {
  try {
    const path = resolvePaymentsPath(pathOverride);
    const db = getDatabase();
    const paymentsRef = ref(db, path);

    console.log(`[voice-payments] ruta escuchada: ${path}`);

    const unsubscribe = onValue(
      paymentsRef,
      (snapshot) => {
        console.log('[voice-payments] snapshot recibido desde Firebase');
        const data = snapshot.val();
        if (!data) {
          console.log('[voice-payments] snapshot vacío (sin pagos en la ruta)');
          callback([]);
          return;
        }

        const paymentsArray = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));

        const noLeidos = paymentsArray.filter((p) => p.leido === false);
        console.log(
          `[voice-payments] snapshot: ${paymentsArray.length} pagos total, ${noLeidos.length} con leido:false`,
        );

        callback(paymentsArray);
      },
      (error) => {
        console.error('[voice-payments] error leyendo Firebase:', error);
        if (errorCallback) errorCallback(error);
      },
    );

    return unsubscribe;
  } catch (error) {
    console.error('[voice-payments] error configurando listener:', error);
    if (errorCallback) errorCallback(error);
    return () => {};
  }
};

export const markPaymentAsAnnounced = async (paymentId, pathOverride = null) => {
  const path = resolvePaymentsPath(pathOverride);
  const db = getDatabase();
  const paymentRef = ref(db, `${path}/${paymentId}`);
  await update(paymentRef, { leido: true });
};

export const createTestPaymentConfirmation = async (pathOverride = null) => {
  const path = resolvePaymentsPath(pathOverride);
  const db = getDatabase();
  const testId = `prueba_manual_${Date.now()}`;
  const paymentRef = ref(db, `${path}/${testId}`);
  const now = new Date();

  await set(paymentRef, {
    cliente: 'Juan Pérez',
    monto: 12500,
    pedidoId: 'PRUEBA',
    medio: 'Mercado Pago',
    fecha: format(now, 'yyyy-MM-dd'),
    hora: format(now, 'HH:mm'),
    leido: false,
  });
};

export const createTestMercadoPagoPayment = async (pathOverride = null) => {
  const path = resolvePaymentsPath(pathOverride);
  const db = getDatabase();
  const paymentRef = ref(db, `${path}/test_pago_mp_real`);
  const now = new Date();

  await set(paymentRef, {
    cliente: '',
    estadoCliente: 'pendiente',
    medio: 'Mercado Pago',
    monto: 6000,
    fecha: format(now, 'yyyy-MM-dd'),
    hora: format(now, 'HH:mm'),
    leido: false,
  });

  console.log(`[voice-payments] test_pago_mp_real creado en ${path}`);
};

export const readPaymentsDiagnostic = async (pathOverride = null) => {
  const path = resolvePaymentsPath(pathOverride);
  const db = getDatabase();
  const paymentsRef = ref(db, path);

  console.log(`[voice-payments] diagnóstico: leyendo ${path}`);
  const snapshot = await get(paymentsRef);
  const data = snapshot.val();

  if (!data) {
    console.log('[voice-payments] diagnóstico: ruta vacía (sin pagos)');
    return { total: 0, noLeidos: 0, leidos: 0, ruta: path };
  }

  const pagos = Object.keys(data).map((key) => ({ id: key, ...data[key] }));
  const noLeidos = pagos.filter((p) => p.leido === false);
  const leidos = pagos.filter((p) => p.leido === true);

  const resumen = {
    ruta: path,
    total: pagos.length,
    noLeidos: noLeidos.length,
    leidos: leidos.length,
    ultimoNoLeido: noLeidos.length > 0
      ? { id: noLeidos[0].id, monto: noLeidos[0].monto, medio: noLeidos[0].medio, fecha: noLeidos[0].fecha }
      : null,
  };

  console.log('[voice-payments] diagnóstico resultado:', resumen);
  return resumen;
};
