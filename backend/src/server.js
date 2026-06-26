// _env.js DEBE ser el primer import: carga las variables antes de que
// firebase.js y otros módulos lean process.env en su inicialización.
import './_env.js';

import express from 'express';
import { fetchPaymentDetails, searchPayments } from './mercadopago.js';
import { savePaymentIfNew } from './paymentsRepo.js';
import { pollMercadoPagoMovements } from './poller.js';
import { pollMercadoPagoEmails, emailWatcherEnabled } from './emailWatcher.js';
import { db } from './firebase.js';
import { pollStats } from './pollStats.js';

const app = express();
app.use(express.json());

// Puerto 3001 por defecto para no colisionar con el dev server de Vite (3000)
const PORT = Number(process.env.PORT || 3001);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5 * 1000);
const EMAIL_POLL_INTERVAL_MS = Number(process.env.EMAIL_POLL_INTERVAL_MS || 20 * 1000);

const LOCAL_ID   = process.env.LOCAL_ID || '40508022';
const SYNC_PATH  = process.env.FIREBASE_SYNC_PATH || `${LOCAL_ID}/MERCADOPAGO_SYNC`;
const PAGOS_PATH = process.env.FIREBASE_PAGOS_PATH || `${LOCAL_ID}/PAGOS_CONFIRMADOS`;

const startTime = Date.now();

// Logs de inicio — visibles en logs de Electron
console.log(`[MP BACKEND] iniciado pid=${process.pid}`);
console.log(`[MP BACKEND] token presente=${!!process.env.MERCADOPAGO_ACCESS_TOKEN}`);
console.log(`[MP BACKEND] local id=${LOCAL_ID}`);
console.log(`[MP BACKEND] ruta Firebase=${PAGOS_PATH}`);
console.log(`[MP BACKEND] polling cada ${POLL_INTERVAL_MS / 1000}s`);

app.get('/', (req, res) => {
  res.send('Mercado Pago -> Firebase webhook activo');
});

// Endpoint de salud — permite verificar estado del backend y del poller desde la UI
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    pid: process.pid,
    uptimeS: Math.floor((Date.now() - startTime) / 1000),
    mp: {
      tokenPresente: !!process.env.MERCADOPAGO_ACCESS_TOKEN,
      localId: LOCAL_ID,
      rutaFirebase: PAGOS_PATH,
      pollingIntervalS: POLL_INTERVAL_MS / 1000,
      emailWatcherEnabled,
    },
    lastPoll: {
      time:     pollStats.lastPollTime,
      total:    pollStats.lastPollTotal,
      approved: pollStats.lastPollApproved,
      error:    pollStats.lastError,
    },
    lastWrite: {
      time: pollStats.lastWriteTime,
      id:   pollStats.lastWriteId,
    },
  });
});

// Diagnóstico: últimos pagos que devuelve la API de MP (últimas 6h)
app.get('/debug/mp-recent', async (req, res) => {
  try {
    const now = new Date();
    const horasAtras = Number(req.query.horas || 6);
    const beginDate = new Date(now.getTime() - horasAtras * 60 * 60 * 1000).toISOString();
    const endDate = now.toISOString();

    const result = await searchPayments({ beginDate, endDate, offset: 0, limit: 20 });

    const syncSnap = await db.ref(SYNC_PATH).once('value');

    res.json({
      consultado_en: now.toISOString(),
      ventana_horas: horasAtras,
      beginDate,
      endDate,
      total_mp: result.paging?.total ?? 0,
      sync_state: syncSnap.val(),
      pagos: (result.results || []).map((p) => ({
        id: p.id,
        status: p.status,
        payment_type_id: p.payment_type_id,
        transaction_amount: p.transaction_amount,
        date_created: p.date_created,
        date_approved: p.date_approved,
        payer_name: [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(' ') || null,
        payer_email: p.payer?.email || null,
        description: p.description || null,
      })),
    });
  } catch (err) {
    console.error('[MP DEBUG] error en /debug/mp-recent:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/mercadopago', async (req, res) => {
  try {
    const paymentId =
      req.body?.data?.id || req.body?.id || req.query?.id || req.query?.['data.id'];

    if (!paymentId) {
      console.warn('Webhook recibido sin paymentId:', JSON.stringify(req.body), req.query);
      return res.status(200).send('Sin paymentId, ignorado');
    }

    const payment = await fetchPaymentDetails(paymentId);

    if (payment.status !== 'approved') {
      console.log(`Pago ${paymentId} con status "${payment.status}", se ignora.`);
      return res.status(200).send('Pago no aprobado, ignorado');
    }

    const saved = await savePaymentIfNew(payment);
    if (!saved) {
      console.log(`Pago ${payment.id} ya estaba registrado, se ignora.`);
      return res.status(200).send('Pago ya registrado');
    }

    console.log(`Pago ${payment.id} guardado en PAGOS_CONFIRMADOS (vía webhook)`);
    return res.status(200).send('Pago registrado');
  } catch (error) {
    console.error('Error procesando webhook de Mercado Pago:', error);
    return res.status(500).send('Error interno');
  }
});

const server = app.listen(PORT, () => {
  console.log(`[backend] Servidor escuchando en el puerto ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[backend] ERROR: Puerto ${PORT} ya en uso.\n` +
        `Cerrá la instancia anterior o cambiá PORT en backend.env`
    );
    process.exit(1);
  } else {
    console.error('[backend] Error al iniciar el servidor:', err);
    process.exit(1);
  }
});

pollMercadoPagoMovements();
setInterval(pollMercadoPagoMovements, POLL_INTERVAL_MS);

pollMercadoPagoEmails();
setInterval(pollMercadoPagoEmails, EMAIL_POLL_INTERVAL_MS);

// Heartbeat cada 30s
setInterval(() => {
  const uptimeS = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[MP BACKEND] alive | pid=${process.pid} | uptime=${uptimeS}s`);
}, 30000);
