import { db } from './firebase.js';
import { searchPayments } from './mercadopago.js';
import { savePaymentIfNew } from './paymentsRepo.js';
import { pollStats } from './pollStats.js';

const LOCAL_ID = process.env.LOCAL_ID || '40508022';
const SYNC_PATH = process.env.FIREBASE_SYNC_PATH || `${LOCAL_ID}/MERCADOPAGO_SYNC`;
const PAGE_LIMIT = 50;

// 2h por defecto (antes era 5min): cubre reinicios del backend sin perder pagos.
// La deduplicación en Firebase (transaction) evita dobles registros.
const OVERLAP_MS = Number(process.env.POLL_OVERLAP_MS || 2 * 60 * 60 * 1000);

const getLastSyncDate = async () => {
  const snapshot = await db.ref(`${SYNC_PATH}/lastDateCreated`).once('value');
  return snapshot.val();
};

const setLastSyncInfo = async (lastDateCreated, lastPaymentId) => {
  await db.ref(SYNC_PATH).update({
    lastDateCreated,
    lastPaymentId: lastPaymentId ?? null,
    updatedAt: new Date().toISOString(),
  });
};

export const pollMercadoPagoMovements = async () => {
  try {
    const now = new Date();
    const storedLastDateCreated = await getLastSyncDate();

    const beginDate = storedLastDateCreated
      ? new Date(new Date(storedLastDateCreated).getTime() - OVERLAP_MS).toISOString()
      : new Date(now.getTime() - OVERLAP_MS).toISOString();
    const endDate = now.toISOString();

    console.log(`[MP POLL] consultando MP | desde: ${beginDate} | hasta: ${endDate}`);

    let offset = 0;
    let total = 0;
    let lastPaymentId = null;
    let totalApproved = 0;

    do {
      const { results = [], paging } = await searchPayments({ beginDate, endDate, offset, limit: PAGE_LIMIT });
      total = paging?.total ?? results.length;

      if (offset === 0) {
        console.log(`[MP POLL] respuesta MP: total=${total} resultados en ventana`);
      }

      for (const payment of results) {
        console.log(
          `[MP POLL] pago: id=${payment.id} | status=${payment.status}` +
          ` | type=${payment.payment_type_id} | amount=${payment.transaction_amount}` +
          ` | date_created=${payment.date_created}`,
        );

        if (payment.status !== 'approved') {
          console.log(`[MP POLL] ignorado (status=${payment.status}): ${payment.id}`);
          continue;
        }
        totalApproved++;

        console.log(`[MP FIREBASE WRITE] intentando guardar id=${payment.id} | amount=${payment.transaction_amount}`);
        const saved = await savePaymentIfNew(payment);
        if (saved) {
          console.log(`[MP FIREBASE WRITE] GUARDADO: ${payment.id}`);
          lastPaymentId = payment.id;
        } else {
          console.log(`[MP FIREBASE WRITE] ya existía (dedup): ${payment.id}`);
        }
      }

      offset += PAGE_LIMIT;
    } while (offset < total);

    if (total === 0) {
      console.log(`[MP POLL] sin pagos en la ventana`);
    } else {
      console.log(`[MP POLL] resumen: ${total} total | ${totalApproved} approved | ${lastPaymentId ? `último guardado: ${lastPaymentId}` : 'ninguno nuevo'}`);
    }

    pollStats.lastPollTime     = new Date().toISOString();
    pollStats.lastPollTotal    = total;
    pollStats.lastPollApproved = totalApproved;
    pollStats.lastError        = null;

    await setLastSyncInfo(endDate, lastPaymentId);
  } catch (error) {
    console.error('[MP POLL] error consultando MP:', error);
    pollStats.lastPollTime  = new Date().toISOString();
    pollStats.lastErrorTime = new Date().toISOString();
    pollStats.lastError     = error.message;
  }
};
