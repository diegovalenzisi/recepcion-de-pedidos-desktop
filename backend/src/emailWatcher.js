import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { db } from './firebase.js';
import { normalizeCliente } from './clienteUtils.js';
import { getFechaActual, getHoraActual } from './dateUtils.js';

const LOCAL_ID = process.env.LOCAL_ID || '40508022';
const PAGOS_CONFIRMADOS_PATH = `${LOCAL_ID}/PAGOS_CONFIRMADOS`;

const IMAP_HOST = process.env.EMAIL_IMAP_HOST || 'imap.gmail.com';
const IMAP_PORT = Number(process.env.EMAIL_IMAP_PORT || 993);
const IMAP_USER = process.env.EMAIL_IMAP_USER;
const IMAP_PASSWORD = process.env.EMAIL_IMAP_PASSWORD;
const IMAP_MAILBOX = process.env.EMAIL_IMAP_MAILBOX || 'INBOX';
const MP_SENDER = process.env.MERCADOPAGO_EMAIL_SENDER || 'mercadopago.com';

const DEBUG_LOG_EMAILS = process.env.DEBUG_LOG_EMAILS === 'true';

const EMAIL_START_DATE = process.env.EMAIL_START_DATE || null;
const EMAIL_START_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const getEmailStartDate = () => {
  if (!EMAIL_START_DATE) return null;

  if (!EMAIL_START_DATE_PATTERN.test(EMAIL_START_DATE)) {
    console.warn(`[email] EMAIL_START_DATE inválido (se espera YYYY-MM-DD): "${EMAIL_START_DATE}", se ignora.`);
    return null;
  }

  return new Date(`${EMAIL_START_DATE}T00:00:00`);
};

let warnedMissingConfig = false;

const sanitizeFirebaseKey = (value) => value.replace(/[<>]/g, '').replace(/[.#$[\]/]/g, '_');

// --- Directorio para persistencia de UIDs procesados ---
// En Electron usa la carpeta userData (siempre escribible).
// En desarrollo usa ../data relativo al archivo fuente.
const DATA_DIR = process.env.ELECTRON_USER_DATA_PATH
  ? join(process.env.ELECTRON_USER_DATA_PATH, 'backend-data')
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const PROCESSED_FILE = join(DATA_DIR, 'email-processed.json');

const loadProcessedState = () => {
  try {
    const raw = readFileSync(PROCESSED_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      baselineUid: typeof parsed.baselineUid === 'number' ? parsed.baselineUid : null,
      processedUids: new Set(Array.isArray(parsed.processedUids) ? parsed.processedUids : []),
    };
  } catch {
    return { baselineUid: null, processedUids: new Set() };
  }
};

const state = loadProcessedState();

const saveProcessedState = () => {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(
      PROCESSED_FILE,
      JSON.stringify({ baselineUid: state.baselineUid, processedUids: Array.from(state.processedUids) }, null, 2)
    );
  } catch (error) {
    console.error('[email] No se pudo guardar email-processed.json:', error);
  }
};

const markUidProcessed = (uid) => {
  state.processedUids.add(uid);
  saveProcessedState();
};

const NAME_PATTERNS = [
  /recibiste\s+(?:una\s+transferencia|un\s+pago)\s+de\s+([^.\n$]+?)(?:\s+por|\.|\n|$)/i,
  /transferencia\s+de\s+([^.\n$]+?)(?:\s+por|\.|\n|$)/i,
  /([^.\n$]+?)\s+te\s+(?:transfiri[oó]|envi[oó]|pag[oó])/i,
  /pago recibido de\s+([^.\n$]+)/i,
  /de:\s*([^\n]+)/i,
  /pagador:\s*([^\n]+)/i,
  /nombre:\s*([^\n]+)/i,
  /titular:\s*([^\n]+)/i,
  /cuenta\s+mercado\s+pago:\s*([^\n]+)/i,
];

const GENERIC_NAME_BLOCKLIST = ['mercado pago', 'transferencia recibida', 'tu cuenta', 'tu dinero'];

const isLikelyPersonName = (name) => {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (trimmed.includes('@')) return false;
  if (/^\$?\s*[\d.,]+$/.test(trimmed)) return false;
  if (GENERIC_NAME_BLOCKLIST.includes(trimmed.toLowerCase())) return false;
  return true;
};

export const extractPayerName = (text = '') => {
  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    const name = match?.[1]?.trim();
    if (name && isLikelyPersonName(name)) return name;
  }

  return null;
};

export const extractAmount = (text = '') => {
  const match = text.match(/\$\s?([\d.,]+)/);
  if (!match) return null;

  const normalized = match[1].replace(/\./g, '').replace(',', '.');
  const amount = parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
};

const isPaymentNotification = (subject = '', text = '') => {
  const haystack = `${subject} ${text}`.toLowerCase();
  return ['transferencia', 'recibiste', 'pago recibido', 'te transfirieron'].some((keyword) =>
    haystack.includes(keyword)
  );
};

const PENDING_MATCH_TOLERANCE_MINUTES = 15;

const timeToMinutes = (hora) => {
  const [h, m] = String(hora || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const isCloseTime = (horaA, horaB, toleranceMinutes = PENDING_MATCH_TOLERANCE_MINUTES) => {
  const a = timeToMinutes(horaA);
  const b = timeToMinutes(horaB);
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= toleranceMinutes;
};

const findPendingPaymentMatch = async (monto, fecha, hora) => {
  const snapshot = await db.ref(PAGOS_CONFIRMADOS_PATH).once('value');
  const pagos = snapshot.val() || {};

  for (const [key, pago] of Object.entries(pagos)) {
    if (pago?.medio !== 'Mercado Pago') continue;
    if (pago?.estadoCliente !== 'pendiente') continue;
    if (pago?.monto !== monto) continue;
    if (pago?.fecha !== fecha) continue;
    if (!isCloseTime(pago?.hora, hora)) continue;
    return key;
  }

  return null;
};

export const emailWatcherEnabled = !!(IMAP_USER && IMAP_PASSWORD);

export const pollMercadoPagoEmails = async () => {
  if (!IMAP_USER || !IMAP_PASSWORD) {
    if (!warnedMissingConfig) {
      // console.log (no console.warn) para no contaminar stderr y no aparecer como "Error MP"
      console.log('[MP EMAIL POLL] EMAIL_IMAP_USER/EMAIL_IMAP_PASSWORD no configurados — emails desactivados.');
      warnedMissingConfig = true;
    }
    return;
  }

  console.log(`[MP EMAIL POLL] iniciando | host=${IMAP_HOST} | user=${IMAP_USER} | mailbox=${IMAP_MAILBOX}`);

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
  });

  try {
    await client.connect();
    console.log(`[email] Conectado a ${IMAP_HOST}:${IMAP_PORT} (usuario: ${IMAP_USER}, mailbox: ${IMAP_MAILBOX})`);

    const lock = await client.getMailboxLock(IMAP_MAILBOX);

    try {
      const startDate = getEmailStartDate();
      let searchQuery;

      if (startDate) {
        console.log(`[email] Usando EMAIL_START_DATE: ${EMAIL_START_DATE}`);
        searchQuery = { all: true, from: MP_SENDER, since: startDate };
      } else {
        if (state.baselineUid === null) {
          // BUG FIX: antes se ignoraban todos los emails anteriores al arranque.
          // Ahora: primer arranque busca emails de la última hora (sin marcar como leídos)
          // para recuperar pagos que llegaron antes de que el backend iniciara.
          state.baselineUid = client.mailbox.uidNext;
          saveProcessedState();
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          console.log(`[email] Primer arranque: recuperando emails de última hora (desde ${oneHourAgo.toISOString()}) UID base=${state.baselineUid}`);
          searchQuery = { seen: false, from: MP_SENDER, since: oneHourAgo };
        } else {
          searchQuery = { seen: false, from: MP_SENDER, uid: `${state.baselineUid}:*` };
        }
      }

      const uids = await client.search(searchQuery, { uid: true });

      const filtroFecha = startDate ? `desde ${EMAIL_START_DATE}` : `UID >= ${state.baselineUid}`;
      console.log(`[email] Diagnóstico búsqueda -> mailbox: "${IMAP_MAILBOX}" | remitente: "${MP_SENDER}" | filtro: ${filtroFecha} | encontrados: ${uids?.length || 0}`);

      for (const uid of uids || []) {
        if (state.processedUids.has(uid)) {
          console.log(`[email] UID ${uid} ya procesado, se omite`);
          continue;
        }

        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message) {
          markUidProcessed(uid);
          continue;
        }

        const parsed = await simpleParser(message.source);
        const subject = parsed.subject || '';
        const text = parsed.text || '';
        const from = parsed.from?.text || '';

        console.log(`[email] --- UID ${uid} ---`);
        console.log(`[email] remitente: ${from}`);
        console.log(`[email] asunto: ${subject}`);

        if (DEBUG_LOG_EMAILS) {
          console.log(`[email][debug] texto (parcial): ${text.slice(0, 1000)}`);
        }

        if (!isPaymentNotification(subject, text)) {
          console.log(`[email] Mail viejo ignorado (UID ${uid}, no es notificación de pago/transferencia)`);
          markUidProcessed(uid);
          continue;
        }

        const messageId = parsed.messageId || `${LOCAL_ID}-uid-${uid}`;
        const rawName = extractPayerName(text);
        const monto = extractAmount(text);

        if (DEBUG_LOG_EMAILS) {
          console.log(`[email] extractPayerName -> ${rawName === null ? 'null' : `"${rawName}"`}`);
        }
        console.log(`[email] Nombre detectado desde Mercado Pago: ${rawName || '(no detectado)'}`);
        console.log(`[email] extractAmount -> ${monto === null ? 'null (sin match)' : monto}`);

        if (monto === null) {
          console.warn(`[email] No se pudo extraer el monto del mail "${subject}" (${messageId}), se omite.`);
          markUidProcessed(uid);
          continue;
        }

        const cliente = normalizeCliente(rawName);
        const estadoCliente = cliente ? 'detectado' : 'pendiente';
        const now = new Date();
        const fecha = getFechaActual(now);
        const hora = getHoraActual(now);

        if (cliente) {
          const pendingKey = await findPendingPaymentMatch(monto, fecha, hora);

          if (pendingKey) {
            await db.ref(`${PAGOS_CONFIRMADOS_PATH}/${pendingKey}`).update({
              cliente,
              estadoCliente: 'detectado',
            });
            console.log(`[email] Pago pendiente ${pendingKey} actualizado con cliente real: "${cliente}"`);

            try {
              await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            } catch (flagError) {
              console.error(`[email] No se pudo marcar como leído el mail UID ${uid}:`, flagError);
            }

            markUidProcessed(uid);
            continue;
          }
        }

        const key = sanitizeFirebaseKey(messageId);

        const ref = db.ref(`${PAGOS_CONFIRMADOS_PATH}/${key}`);
        const { committed } = await ref.transaction((current) => {
          if (current !== null) return;

          return {
            cliente: cliente || '',
            estadoCliente,
            monto,
            medio: 'Mercado Pago Mail',
            fecha,
            hora,
            leido: false,
          };
        });

        if (committed) {
          console.log(`[email] GUARDADO -> medio: "Mercado Pago Mail" | cliente: "${cliente || ''}" | estadoCliente: "${estadoCliente}" | monto: ${monto} | ruta: ${PAGOS_CONFIRMADOS_PATH}/${key}`);
        } else {
          console.log(`[email] Mail ${messageId} ya estaba registrado en ${PAGOS_CONFIRMADOS_PATH}/${key}, se omite.`);
        }

        try {
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        } catch (flagError) {
          console.error(`[email] No se pudo marcar como leído el mail UID ${uid}:`, flagError);
        }

        markUidProcessed(uid);
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error('[email] Error leyendo correos de Mercado Pago:', error);
  } finally {
    await client.logout().catch(() => {});
  }
};
