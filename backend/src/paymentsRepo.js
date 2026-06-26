import { db } from './firebase.js';
import { buildClienteName, redactSensitiveFields } from './mercadopago.js';
import { normalizeCliente } from './clienteUtils.js';
import { getFechaActual, getHoraActual } from './dateUtils.js';
import { pollStats } from './pollStats.js';

const LOCAL_ID = process.env.LOCAL_ID || '40508022';
const PAGOS_CONFIRMADOS_PATH = process.env.FIREBASE_PAGOS_PATH || `${LOCAL_ID}/PAGOS_CONFIRMADOS`;

console.log(`[backend] ruta pagos Firebase: ${PAGOS_CONFIRMADOS_PATH}`);

const DEBUG_LOG_PAYMENTS = process.env.DEBUG_LOG_PAYMENTS === 'true';

export const savePaymentIfNew = async (payment) => {
  const ref = db.ref(`${PAGOS_CONFIRMADOS_PATH}/${payment.id}`);
  const now = new Date();
  const cliente = normalizeCliente(buildClienteName(payment));
  const estadoCliente = cliente ? 'detectado' : 'pendiente';
  const monto = payment.transaction_amount;

  if (cliente) {
    console.log(`[paymentsRepo] Cliente real detectado: "${cliente}"`);
  } else {
    console.log('[poller] Mercado Pago no devolvió titular real');
    console.log('[paymentsRepo] Cliente pendiente, no se guarda texto genérico');
  }

  const { committed } = await ref.transaction((current) => {
    if (current !== null) return;

    return {
      cliente: cliente || '',
      estadoCliente,
      monto,
      medio: 'Mercado Pago',
      fecha: getFechaActual(now),
      hora: getHoraActual(now),
      leido: false,
    };
  });

  if (committed) {
    console.log(
      `[paymentsRepo] GUARDADO -> medio: "Mercado Pago" | cliente: "${cliente || ''}" | estadoCliente: "${estadoCliente}" | monto: ${monto} | ruta: ${PAGOS_CONFIRMADOS_PATH}/${payment.id}`
    );
    console.log(`[MP FIREBASE WRITE] success → ${PAGOS_CONFIRMADOS_PATH}/${payment.id}`);
    pollStats.lastWriteTime = new Date().toISOString();
    pollStats.lastWriteId   = String(payment.id);
  }

  if (committed && DEBUG_LOG_PAYMENTS) {
    console.log(`[debug] payment ${payment.id}`);
    console.log('=== PAYER ===');
    console.log(JSON.stringify(redactSensitiveFields(payment.payer), null, 2));
    console.log('=== POINT OF INTERACTION ===');
    console.log(JSON.stringify(redactSensitiveFields(payment.point_of_interaction), null, 2));
    console.log('=== ADDITIONAL INFO ===');
    console.log(JSON.stringify(redactSensitiveFields(payment.additional_info), null, 2));
  }

  return committed;
};
