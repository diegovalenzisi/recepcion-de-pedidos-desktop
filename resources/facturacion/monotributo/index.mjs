import dotenv from 'dotenv';
import fs from 'fs';
import https from 'https';
import soap from 'soap';
import admin from 'firebase-admin';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { execSync } from 'child_process';

dotenv.config();

// Diagnóstico de entorno — confirma qué Node/OpenSSL ejecuta AFIP
console.log(`[AFIP NODE] execPath: ${process.execPath}`);
console.log(`[AFIP NODE] version: ${process.version}`);
console.log(`[AFIP NODE] openssl: ${process.versions.openssl}`);

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------

function readServiceAccount() {
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('No pude leer el Service Account JSON en:', p, e.message);
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(readServiceAccount()),
  databaseURL: process.env.FIREBASE_DB,
});

const db = admin.database();
const ref = db.ref(process.env.FIREBASE_PATH);

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

const LOG_ALIAS = process.env.LOG_ALIAS || 'Mono';
console.log(`🧾 Escuchando pedidos a facturar para ${LOG_ALIAS}...`);
console.log('✅ Firebase inicializado. DB:', admin.app().options.databaseURL);

// ---------------------------------------------------------------------------
// Anti double-billing — lock por pedido en Firebase
// ---------------------------------------------------------------------------

const MACHINE_ID  = process.env.MACHINE_ID || `unknown-${Date.now()}`;
const LOCKS_PATH  = `${process.env.FIREBASE_PATH}_LOCKS`;
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutos

async function tryAcquireLock(pedidoId) {
  const lockRef = db.ref(`${LOCKS_PATH}/${pedidoId}`);
  try {
    const { committed } = await lockRef.transaction((current) => {
      const now = Date.now();
      if (current?.status === 'done') return;
      if (current?.status === 'processing' && (now - (current.lockedAt || 0)) < LOCK_TTL_MS) return;
      return { lockedBy: MACHINE_ID, lockedAt: now, status: 'processing' };
    });
    return committed;
  } catch (e) {
    console.error('[lock] Error al adquirir lock:', e.message);
    return true;
  }
}

async function releaseLockDone(pedidoId) {
  try { await db.ref(`${LOCKS_PATH}/${pedidoId}`).update({ status: 'done', completedAt: Date.now() }); } catch {}
}

async function releaseLockError(pedidoId, errorMsg) {
  try { await db.ref(`${LOCKS_PATH}/${pedidoId}`).update({ status: 'error', error: errorMsg, errorAt: Date.now() }); } catch {}
}

// ---------------------------------------------------------------------------
// AFIP WSAA/WSFE — Monotributo (Factura C, CbteTipo 11)
// ---------------------------------------------------------------------------

const CUIT = parseInt(process.env.CUIT, 10);
const PTO_VTA = parseInt(process.env.PTO_VTA, 10);
const CERT_PATH = process.env.CERT;
const KEY_PATH  = process.env.KEY;
const OPENSSL   = process.env.OPENSSL_BIN ? `"${process.env.OPENSSL_BIN}"` : 'openssl';

const CERT = fs.readFileSync(CERT_PATH);
const KEY  = fs.readFileSync(KEY_PATH);

console.log('[AFIP TLS] Usando httpsAgent SECLEVEL=0 para compatibilidad AFIP');
const httpsAgent = new https.Agent({
  cert: CERT,
  key: KEY,
  rejectUnauthorized: false,
  minVersion: 'TLSv1',
  ciphers: 'DEFAULT@SECLEVEL=0',
});

// Cache/mutex para evitar "alreadyAuthenticated"
let taCache = null;
let taInFlight = null;

function readTAFromDisk() {
  const taPath = './TA.xml';
  if (!fs.existsSync(taPath)) return null;
  const xml   = fs.readFileSync(taPath, 'utf8');
  const token = xml.match(/<token>(.*?)<\/token>/)?.[1];
  const sign  = xml.match(/<sign>(.*?)<\/sign>/)?.[1];
  const exp   = xml.match(/<expirationTime>(.*?)<\/expirationTime>/)?.[1];
  if (token && sign && exp) return { token, sign, exp: new Date(exp) };
  return null;
}

async function getTA() {
  if (taCache && taCache.exp > new Date()) return taCache;
  const disk = readTAFromDisk();
  if (disk && disk.exp > new Date()) { taCache = disk; return taCache; }
  if (taInFlight) return taInFlight;

  taInFlight = (async () => {
    try {
      const wsaaWsdl = 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL';
      const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${new Date(Date.now() - 600000).toISOString()}</generationTime>
    <expirationTime>${new Date(Date.now() + 600000).toISOString()}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;

      fs.writeFileSync('TRA.xml', tra);
      execSync(
        `${OPENSSL} smime -sign -signer "${CERT_PATH}" -inkey "${KEY_PATH}" -outform DER -nodetach -in TRA.xml -out TRA.tmp`,
        { stdio: 'inherit' }
      );

      const cms = fs.readFileSync('TRA.tmp').toString('base64');

      const taXml = await new Promise((resolve, reject) => {
        soap.createClient(wsaaWsdl, { wsdl_options: { agent: httpsAgent } }, (err, client) => {
          if (err) return reject(err);
          client.loginCms({ in0: cms }, (err2, result) => {
            if (err2) return reject(err2);
            resolve(result.loginCmsReturn);
          });
        });
      });

      fs.writeFileSync('./TA.xml', taXml);
      try { fs.unlinkSync('TRA.xml'); fs.unlinkSync('TRA.tmp'); } catch {}

      const token = taXml.match(/<token>(.*?)<\/token>/)?.[1];
      const sign  = taXml.match(/<sign>(.*?)<\/sign>/)?.[1];
      const exp   = taXml.match(/<expirationTime>(.*?)<\/expirationTime>/)?.[1];
      taCache = { token, sign, exp: new Date(exp) };
      return taCache;

    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('alreadyAuthenticated')) {
        const disk2 = readTAFromDisk();
        if (disk2 && disk2.exp > new Date()) { taCache = disk2; return taCache; }
      }
      throw e;
    } finally {
      taInFlight = null;
    }
  })();

  return taInFlight;
}

async function getLastVoucher(auth) {
  const wsfeWsdl = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';
  return new Promise((resolve, reject) => {
    soap.createClient(wsfeWsdl, { wsdl_options: { agent: httpsAgent } }, (err, client) => {
      if (err) return reject(err);
      client.FECompUltimoAutorizado(
        { Auth: auth, PtoVta: PTO_VTA, CbteTipo: 11 },
        (err2, result) => {
          if (err2) return reject(err2);
          resolve(result.FECompUltimoAutorizadoResult.CbteNro);
        }
      );
    });
  });
}

async function emitirFacturaC(auth, total, nroCbte) {
  const wsfeWsdl = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';
  return new Promise((resolve, reject) => {
    soap.createClient(wsfeWsdl, { wsdl_options: { agent: httpsAgent } }, (err, client) => {
      if (err) return reject(err);
      const data = {
        Auth: auth,
        FeCAEReq: {
          FeCabReq: { CantReg: 1, PtoVta: PTO_VTA, CbteTipo: 11 },
          FeDetReq: {
            FECAEDetRequest: [{
              Concepto: 1, DocTipo: 99, DocNro: 0,
              CbteDesde: nroCbte, CbteHasta: nroCbte,
              CbteFch: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
              ImpTotal: total, ImpTotConc: 0, ImpNeto: total,
              ImpOpEx: 0, ImpIVA: 0, ImpTrib: 0,
              MonId: 'PES', MonCotiz: 1,
            }],
          },
        },
      };
      client.FECAESolicitar(data, (err2, result) => {
        if (err2) return reject(err2);
        const root = result?.FECAESolicitarResult;
        const det  = root?.FeDetResp?.FECAEDetResponse?.[0];
        const errs = root?.Errors?.Err;
        if (errs) {
          const msg = (Array.isArray(errs) ? errs : [errs]).map(e => `${e.Code}: ${e.Msg}`).join(' | ');
          return reject(new Error(`WSFE Errors -> ${msg}`));
        }
        if (!det?.CAE) return reject(new Error('AFIP no devolvió CAE'));
        resolve(det);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Datos del emisor (configurables desde .env)
// ---------------------------------------------------------------------------

const EMISOR_RAZON_SOCIAL = process.env.EMISOR_RAZON_SOCIAL || '';
const EMISOR_FANTASIA     = process.env.EMISOR_FANTASIA     || '';
const EMISOR_CUIT_FORMAT  = process.env.EMISOR_CUIT_FORMAT  || '';
const EMISOR_DOMICILIO    = process.env.EMISOR_DOMICILIO    || '';
const EMISOR_COND_IVA     = process.env.EMISOR_COND_IVA    || 'Monotributista';

async function generarPDFyGuardar(pedido, caeData, nroCbte, facturaKey) {
  const filename = `factura-${facturaKey}.pdf`;
  const doc = new PDFDocument({ size: [230, 800], margin: 10 });
  doc.pipe(fs.createWriteStream(filename));

  const fechaISO   = new Date().toISOString().slice(0, 10);
  const fechaDDMM  = fechaISO.split('-').reverse().join('/');
  const nroCmpStr  = String(nroCbte).padStart(8, '0');
  const ptoVtaStr  = String(PTO_VTA).padStart(4, '0');

  if (EMISOR_RAZON_SOCIAL) doc.fontSize(14).text(EMISOR_RAZON_SOCIAL, { align: 'center' });
  if (EMISOR_FANTASIA) doc.fontSize(12).text(EMISOR_FANTASIA, { align: 'center' });
  const linea = [
    EMISOR_CUIT_FORMAT ? `CUIT: ${EMISOR_CUIT_FORMAT}` : null,
    EMISOR_COND_IVA || null,
  ].filter(Boolean).join(' - ');
  if (linea) doc.fontSize(10).text(linea, { align: 'center' });
  if (EMISOR_DOMICILIO) doc.text(`Domicilio: ${EMISOR_DOMICILIO}`, { align: 'center' });
  doc.moveDown();

  doc.text(`Factura C - Pto. Vta. ${ptoVtaStr} - Nº: ${nroCmpStr}`, { align: 'center' });
  doc.text(`Fecha: ${fechaDDMM}`, { align: 'center' });
  doc.moveDown();

  doc.fontSize(10).text(`Cliente: ${pedido.CLIENTE}`);
  if (pedido.DIRECCION) doc.text(`Dirección: ${pedido.DIRECCION}`);
  doc.text(`Total: $${Number(pedido.TOTAL).toFixed(2)}`);
  doc.moveDown();

  doc.text(`CAE: ${caeData.CAE}`);
  doc.text(`Vto CAE: ${caeData.CAEFchVto}`);

  // JSON del QR según especificación oficial ARCA/AFIP (RG 4291).
  const qrData = {
    ver: 1,
    fecha: fechaISO,                                   // YYYY-MM-DD
    cuit: CUIT,                                        // CUIT emisor (número)
    ptoVta: PTO_VTA,                                   // solo punto de venta
    tipoCmp: 11,                                       // Factura C
    nroCmp: nroCbte,                                   // solo número de comprobante (sin pto vta)
    importe: Number(Number(pedido.TOTAL).toFixed(2)),  // importe total real (número)
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 99,                                    // Consumidor Final
    nroDocRec: 0,
    tipoCodAut: 'E',                                   // E = CAE
    codAut: Number(caeData.CAE),                       // CAE real como número
  };
  // base64 ESTÁNDAR (ARCA no decodifica base64 url-safe con - _ )
  const base64   = Buffer.from(JSON.stringify(qrData)).toString('base64');
  const qrUrl    = `https://www.arca.gob.ar/fe/qr/?p=${base64}`;
  console.log("QR ARCA JSON:", qrData);
  console.log("QR ARCA URL:", qrUrl);
  const qrImage  = await QRCode.toDataURL(qrUrl);
  const qrBuffer = Buffer.from(qrImage.split(',')[1], 'base64');
  doc.image(qrBuffer, { fit: [120, 120], align: 'center' });
  doc.end();

  return filename;
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const firstNonEmpty = (...vals) =>
  vals.find(v => v !== undefined && v !== null && String(v).trim() !== '');

const toNumber = (v) => {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function normalizarPedido(raw) {
  const p = { ...raw };
  p.CLIENTE   = firstNonEmpty(p.CLIENTE, p.cliente, p.Clientes, p.clientes) || 'Consumidor Final';
  p.DIRECCION = firstNonEmpty(p.DIRECCION, p.direccion) || null;

  let total = toNumber(firstNonEmpty(p.TOTAL, p.total, p.importe, p.monto));
  if ((total === null || total === 0)) {
    const prodRoot = p.producto || p.productos || p.items || null;
    if (prodRoot) {
      let acc = 0;
      const entries = Array.isArray(prodRoot) ? prodRoot.entries() : Object.entries(prodRoot);
      for (const [, item] of entries) {
        const val  = toNumber(firstNonEmpty(item?.valor, item?.precio_total, item?.precio, item?.total));
        const cant = toNumber(firstNonEmpty(item?.cantidad, 1)) || 1;
        const esPU = item?.precio && !item?.precio_total && !item?.valor;
        if (val !== null) acc += esPU ? val * cant : val;
      }
      if (acc > 0) total = acc;
    }
  }
  p.TOTAL = total;
  return p;
}

// ---------------------------------------------------------------------------
// Cola
// ---------------------------------------------------------------------------

const queue = [];
let processing = false;
let tlsPaused = false;
const PAUSA_MS = 2000;

function enqueue(snapshot) {
  queue.push(snapshot);
  console.log(`🧃 Pedido encolado: ${snapshot.key}. En cola: ${queue.length}`);
  if (!processing && !tlsPaused) processNext();
}

async function processNext() {
  if (tlsPaused) {
    console.error('[AFIP TLS] ❌ Facturación pausada por error TLS. Reiniciá el servicio desde la app.');
    return;
  }
  if (queue.length === 0) { processing = false; return; }
  processing = true;
  const snapshot = queue.shift();
  try {
    await procesarSnapshot(snapshot);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[ERR] ❌ Error al facturar: ${msg}`);
    if (msg.includes('dh key too small') || msg.includes('EPROTO') || msg.includes('SSL routines')) {
      tlsPaused = true;
      console.error('[AFIP TLS] ❌ Error TLS con AFIP detectado. Facturación pausada.');
      console.error('[AFIP TLS] Verificar: OPENSSL_CONF apunta a openssl.cnf con SECLEVEL=0');
      processing = false;
      return;
    }
  }
  if (queue.length > 0) {
    console.log(`⏳ Esperando ${PAUSA_MS / 1000}s...`);
    setTimeout(processNext, PAUSA_MS);
  } else {
    processing = false;
  }
}

async function procesarSnapshot(snapshot) {
  const pedidoId = snapshot.key;

  // Idempotencia: verificar que el pedido siga en cola
  const still = await snapshot.ref.once('value');
  if (!still.exists()) {
    console.log(`⏭️ Pedido ${pedidoId} ya no existe (procesado por otra PC).`);
    return;
  }

  // Anti doble-facturación: adquirir lock
  const acquired = await tryAcquireLock(pedidoId);
  if (!acquired) {
    console.log(`🔒 Pedido ${pedidoId} tomado por otra PC — se omite.`);
    return;
  }

  const pedido = normalizarPedido(snapshot.val());
  if (!pedido.TOTAL) {
    console.warn(`❌ Pedido ${pedidoId} sin total.`);
    await releaseLockError(pedidoId, 'Pedido sin total');
    return;
  }

  try {
    console.log('🧾 Facturando pedido:', pedidoId, '— PC:', MACHINE_ID);
    const { token, sign } = await getTA();
    const auth            = { Token: token, Sign: sign, Cuit: CUIT };
    const lastVoucher     = await getLastVoucher(auth);
    const nroCbte         = lastVoucher + 1;
    const det             = await emitirFacturaC(auth, pedido.TOTAL, nroCbte);
    console.log('✅ Factura C emitida. CAE:', det.CAE);

    const nroCmpStr  = String(nroCbte).padStart(8, '0');
    const ptoVtaStr  = String(PTO_VTA).padStart(4, '0');
    const facturaKey = `FCC${ptoVtaStr}-${nroCmpStr}`;

    const pdfPath = await generarPDFyGuardar(pedido, det, nroCbte, facturaKey);

    await db.ref(`${process.env.FIREBASE_HISTORIAL}/${facturaKey}`).set({
      ...snapshot.val(),
      NORMALIZADO: { CLIENTE: pedido.CLIENTE, DIRECCION: pedido.DIRECCION, TOTAL: Number(pedido.TOTAL) },
      CAE: det.CAE, CAE_VTO: det.CAEFchVto,
      PTO_VTA, NRO_CMP: nroCbte, PDF: pdfPath,
    });

    await snapshot.ref.remove();
    await releaseLockDone(pedidoId);

    console.log('🧾 Factura', facturaKey, `emitida por ${MACHINE_ID}. Guardada en VENTAS.`);

  } catch (err) {
    await releaseLockError(pedidoId, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Listener principal
// ---------------------------------------------------------------------------

ref.on('child_added', (snapshot) => enqueue(snapshot));
