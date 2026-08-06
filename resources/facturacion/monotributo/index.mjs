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
// ANTI DOBLE-FACTURACIÓN — SIN LOCKS EN FIREBASE
//
// El facturador corre en UNA sola PC, con UNA sola instancia por cuenta fiscal
// y UN solo listener. Con esa garantía no hace falta un bloqueo distribuido, y
// el sistema de `{COLA}_LOCKS` quedó eliminado por completo: ya no se crea, ni
// se consulta, ni se renueva, ni se vence, ni se borra ninguna rama de locks.
//
// La protección contra duplicados queda apoyada en cuatro cosas simples:
//
//   1. UN SOLO LISTENER y una COLA SECUENCIAL (`queue` + `processing`): nunca se
//      procesan dos pedidos a la vez.
//   2. `pedidosEnProceso` / `pedidosYaFacturados` — memoria del proceso: si
//      Firebase repite un evento `child_added` (reconexión, resync), se ignora.
//   3. El pedido SIGUE EN LA COLA como condición para facturarlo: al emitir se
//      borra de `FACTURACION_N`, así que un reinicio no lo vuelve a ver.
//   4. Antes de emitir se revisa el HISTORIAL. Cubre el único hueco real que
//      queda: si el proceso muere entre "guardé la factura" y "borré el pedido
//      de la cola", al reiniciar el pedido sigue encolado y se re-emitiría.
// ---------------------------------------------------------------------------

const MACHINE_ID = process.env.MACHINE_ID || `unknown-${Date.now()}`;

/** Pedidos que este proceso está facturando ahora mismo. */
const pedidosEnProceso = new Set();
/** Pedidos que este proceso ya facturó (evita reprocesar un evento repetido). */
const pedidosYaFacturados = new Set();

// Cuántos comprobantes recientes se miran para detectar una re-emisión. Las
// claves son FCC{ptoVta}-{nroCmp}, que ordenan por número de comprobante, así
// que `limitToLast` devuelve los últimos emitidos. Un duplicado por reinicio
// siempre sería de los más recientes. Se usa una ventana acotada a propósito:
// no requiere índice en Firebase y no crece con el historial.
const VENTANA_HISTORIAL = 200;

/**
 * ¿Este pedido ya fue facturado? Se compara por `pedidoOrigenId` (la clave con
 * la que entró a la cola) y, si viene, por `idempotencyKey`. Nunca por importe
 * ni por hora.
 */
async function yaEstaEnHistorial(pedidoId, idempotencyKey) {
  const snap = await db.ref(process.env.FIREBASE_HISTORIAL)
    .orderByKey()
    .limitToLast(VENTANA_HISTORIAL)
    .once('value');
  const registros = snap.val() || {};
  for (const [facturaKey, reg] of Object.entries(registros)) {
    if (!reg || typeof reg !== 'object') continue;
    if (reg.pedidoOrigenId === pedidoId) return facturaKey;
    if (idempotencyKey && reg.idempotencyKey === idempotencyKey) return facturaKey;
  }
  return null;
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
const EMISOR_IIBB         = process.env.EMISOR_IIBB         || '';
const EMISOR_INICIO_ACTIVIDADES = process.env.EMISOR_INICIO_ACTIVIDADES || '';

/** CbteTipo de ARCA para Factura C (Régimen Simplificado). */
const CBTE_TIPO = 11;

// ESTA cola y ESTE local salen del propio FIREBASE_PATH ({localId}/FACTURACION_N),
// que es la convención de toda la app: el primer segmento es el local y el
// último es la cola. Se graban en la factura para que quede escrito con qué
// cuenta fiscal se emitió — dos cuentas del mismo local pueden compartir punto
// de venta, pero nunca la cola.
const RUTA_COLA = String(process.env.FIREBASE_PATH || '').trim().replace(/^\/+|\/+$/g, '');
const LOCAL_ID  = /^\d+$/.test(RUTA_COLA.split('/')[0]) ? RUTA_COLA.split('/')[0] : null;
const COLA      = /^FACTURACION(_[1-9])?$/.test(RUTA_COLA.split('/').pop()) ? RUTA_COLA.split('/').pop() : null;
console.log(`[Facturación] Cuenta fiscal: local=${LOCAL_ID} cola=${COLA} CUIT=${process.env.CUIT} ptoVta=${process.env.PTO_VTA}`);

const money = (v) => `$${Number(v || 0).toFixed(2)}`;

/**
 * Detalle del comprobante, normalizado desde el payload de la cola.
 *
 * La cola escribe `producto_N: { nombre, valor, cantidad, precioUnitario,
 * precioTotal }`. Las versiones viejas escribían sólo `nombre` y `valor`: en ese
 * caso la cantidad no se inventa, se asume 1 y el subtotal es el propio valor.
 */
function normalizarRenglones(pedido) {
  const raiz = pedido.PRODUCTO || pedido.producto || pedido.productos || pedido.items || null;
  if (!raiz) return [];
  const lista = Array.isArray(raiz) ? raiz : Object.keys(raiz)
    .sort((a, b) => (Number(String(a).replace(/\D/g, '')) || 0) - (Number(String(b).replace(/\D/g, '')) || 0))
    .map((k) => raiz[k]);

  return lista.filter(Boolean).map((it) => {
    const cantidad = toNumber(firstNonEmpty(it.cantidad, it.CANTIDAD)) ?? 1;
    const unitario = toNumber(firstNonEmpty(it.precioUnitario, it.valor, it.precio, it.PRECIO));
    const total = toNumber(firstNonEmpty(it.precioTotal, it.precio_total, it.subtotalLinea));
    return {
      nombre: String(firstNonEmpty(it.nombre, it.NOMBRE, it.name) || 'Sin nombre'),
      cantidad,
      precioUnitario: unitario ?? (total !== null && cantidad ? total / cantidad : 0),
      precioTotal: total ?? (unitario ?? 0) * cantidad,
    };
  });
}

async function generarPDFyGuardar(pedido, caeData, nroCbte, facturaKey, renglones) {
  const filename = `factura-${facturaKey}.pdf`;
  // El PDF se arma en memoria para poder guardarlo en Firebase (PDF_BASE64) y,
  // además, dejar la copia en disco que ya existía. Sin el base64 la app no
  // puede reimprimir el comprobante fiscal: el archivo local sólo está en la PC
  // que facturó.
  const buffers = [];
  const doc = new PDFDocument({ size: [230, 800], margin: 10 });
  doc.on('data', (c) => buffers.push(c));
  const listo = new Promise((resolve) => doc.on('end', resolve));

  const fechaISO   = new Date().toISOString().slice(0, 10);
  const fechaDDMM  = fechaISO.split('-').reverse().join('/');
  const nroCmpStr  = String(nroCbte).padStart(8, '0');
  const ptoVtaStr  = String(PTO_VTA).padStart(4, '0');

  if (EMISOR_RAZON_SOCIAL) doc.fontSize(14).text(EMISOR_RAZON_SOCIAL, { align: 'center' });
  if (EMISOR_FANTASIA) doc.fontSize(12).text(EMISOR_FANTASIA, { align: 'center' });
  doc.fontSize(16).text('C', { align: 'center' });
  const linea = [
    EMISOR_CUIT_FORMAT ? `CUIT: ${EMISOR_CUIT_FORMAT}` : null,
    EMISOR_COND_IVA || null,
  ].filter(Boolean).join(' - ');
  if (linea) doc.fontSize(10).text(linea, { align: 'center' });
  if (EMISOR_DOMICILIO) doc.text(`Domicilio: ${EMISOR_DOMICILIO}`, { align: 'center' });
  if (EMISOR_IIBB) doc.text(`Ingresos Brutos: ${EMISOR_IIBB}`, { align: 'center' });
  if (EMISOR_INICIO_ACTIVIDADES) doc.text(`Inicio de actividades: ${EMISOR_INICIO_ACTIVIDADES}`, { align: 'center' });
  doc.moveDown();

  doc.text(`Factura C - Pto. Vta. ${ptoVtaStr} - Nº: ${nroCmpStr}`, { align: 'center' });
  doc.text(`Fecha: ${fechaDDMM}`, { align: 'center' });
  doc.moveDown();

  doc.fontSize(10).text(`Cliente: ${pedido.CLIENTE}`);
  if (pedido.DIRECCION) doc.text(`Dirección: ${pedido.DIRECCION}`);
  doc.text('Cond. IVA receptor: Consumidor Final');
  doc.moveDown(0.5);

  // DETALLE — sin esto el comprobante mostraba un total sin decir de qué.
  doc.fontSize(9).text('Detalle:');
  if (renglones.length === 0) {
    doc.text('(el pedido no trajo detalle de productos)');
  } else {
    for (const r of renglones) {
      doc.text(`${r.cantidad} x ${r.nombre}`);
      doc.text(`     ${money(r.precioUnitario)} c/u        ${money(r.precioTotal)}`);
    }
  }
  doc.moveDown(0.5);

  doc.fontSize(10).text(`TOTAL: ${money(pedido.TOTAL)}`, { align: 'right' });
  doc.fontSize(8).text('Régimen Simplificado para Pequeños Contribuyentes (Monotributo). El IVA no se discrimina.');
  doc.moveDown(0.5);

  doc.fontSize(10).text(`CAE: ${caeData.CAE}`);
  doc.text(`Vto CAE: ${caeData.CAEFchVto}`);

  // JSON del QR según especificación oficial ARCA/AFIP (RG 4291).
  const qrData = {
    ver: 1,
    fecha: fechaISO,                                   // YYYY-MM-DD
    cuit: CUIT,                                        // CUIT emisor (número)
    ptoVta: PTO_VTA,                                   // solo punto de venta
    tipoCmp: CBTE_TIPO,                                // Factura C
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

  await listo;
  const pdf = Buffer.concat(buffers);
  try { fs.writeFileSync(filename, pdf); } catch (e) {
    console.warn('[PDF] No se pudo escribir la copia local:', e.message);
  }

  return { filename, pdfBase64: pdf.toString('base64'), qrUrl, qrData };
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
  const pedidoId = snapshot.key;
  console.log(`[FACTURACION] Pedido detectado por listener: ${pedidoId} (ruta ${process.env.FIREBASE_PATH}/${pedidoId})`);

  // Evento repetido de Firebase (reconexión / resync): se ignora en vez de
  // encolarlo dos veces. Reemplaza al lock, sin tocar la base.
  if (pedidosEnProceso.has(pedidoId)) {
    console.log(`[FACTURACION] Ignorado ${pedidoId}: ya se está procesando.`);
    return;
  }
  if (pedidosYaFacturados.has(pedidoId)) {
    console.log(`[FACTURACION] Ignorado ${pedidoId}: ya fue facturado por este proceso.`);
    return;
  }
  if (queue.some((s) => s.key === pedidoId)) {
    console.log(`[FACTURACION] Ignorado ${pedidoId}: ya estaba en la cola.`);
    return;
  }

  queue.push(snapshot);
  console.log(`[FACTURACION] Pedido agregado a cola secuencial: ${pedidoId}. En cola: ${queue.length}`);
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

  // Memoria del proceso: un evento repetido no vuelve a facturar.
  if (pedidosEnProceso.has(pedidoId) || pedidosYaFacturados.has(pedidoId)) {
    console.log(`[FACTURACION] Omitido ${pedidoId}: ya procesado o en proceso.`);
    return;
  }

  const datosCrudos = snapshot.val() || {};

  // HISTORIAL: cubre el reinicio tras una caída entre "guardé la factura" y
  // "borré el pedido de la cola". Si ya existe el comprobante, NO se re-emite:
  // se limpia la cola y listo.
  const yaFacturado = await yaEstaEnHistorial(pedidoId, datosCrudos.idempotencyKey);
  if (yaFacturado) {
    console.warn(`[FACTURACION] ${pedidoId} YA estaba en el historial como ${yaFacturado}. No se re-emite; se quita de la cola.`);
    pedidosYaFacturados.add(pedidoId);
    await snapshot.ref.remove();
    return;
  }

  const pedido = normalizarPedido(datosCrudos);
  if (!pedido.TOTAL) {
    // No se oculta ni se deja el pedido dando vueltas en silencio: queda el
    // detalle completo para poder corregirlo.
    console.error(`[FACTURACION] ERROR — pedido sin total, no se factura`, {
      pedidoId,
      rutaFirebase: `${process.env.FIREBASE_PATH}/${pedidoId}`,
      cola: COLA,
      cuentaFiscal: EMISOR_RAZON_SOCIAL || String(CUIT),
      datos: datosCrudos,
    });
    return;
  }

  pedidosEnProceso.add(pedidoId);
  try {
    console.log(`[FACTURACION] Iniciando emisión: ${pedidoId} — cola ${COLA} — CUIT ${CUIT} — PC ${MACHINE_ID}`);
    const { token, sign } = await getTA();
    const auth            = { Token: token, Sign: sign, Cuit: CUIT };
    const lastVoucher     = await getLastVoucher(auth);
    const nroCbte         = lastVoucher + 1;
    const det             = await emitirFacturaC(auth, pedido.TOTAL, nroCbte);
    console.log('✅ Factura C emitida. CAE:', det.CAE);

    const nroCmpStr  = String(nroCbte).padStart(8, '0');
    const ptoVtaStr  = String(PTO_VTA).padStart(4, '0');
    const facturaKey = `FCC${ptoVtaStr}-${nroCmpStr}`;

    const renglones = normalizarRenglones(pedido);
    const { filename: pdfPath, pdfBase64, qrUrl, qrData } =
      await generarPDFyGuardar(pedido, det, nroCbte, facturaKey, renglones);

    // ARTICULOS: detalle normalizado del comprobante. Es lo que lee la app para
    // mostrar y reimprimir la factura. `producto` se conserva tal como vino de la
    // cola: no se pisa ni se reinterpreta el dato de origen.
    const ARTICULOS = {};
    renglones.forEach((r, i) => { ARTICULOS[String(i + 1)] = r; });

    const total = Number(Number(pedido.TOTAL).toFixed(2));

    console.log(`[FACTURACION] CAE recibido: ${det.CAE} (vence ${det.CAEFchVto}) — comprobante ${facturaKey}`);

    await db.ref(`${process.env.FIREBASE_HISTORIAL}/${facturaKey}`).set({
      ...snapshot.val(),
      // Clave con la que el pedido entró a la cola. Es lo que permite detectar
      // una re-emisión sin necesidad de locks (ver yaEstaEnHistorial).
      pedidoOrigenId: pedidoId,
      NORMALIZADO: { CLIENTE: pedido.CLIENTE, DIRECCION: pedido.DIRECCION, TOTAL: total },

      // --- Identidad fiscal del comprobante ---------------------------------
      // Tipo fiscal REAL autorizado por ARCA. Sin esto, la letra del comprobante
      // sólo se puede inferir, y el prefijo de la clave no es confiable.
      CbteTipo: CBTE_TIPO,
      tipoFactura: 'Factura C',
      letra: 'C',
      numeroFactura: `${ptoVtaStr}-${nroCmpStr}`,
      puntoVenta: ptoVtaStr,
      PTO_VTA, NRO_CMP: nroCbte,

      // --- Emisor: SIEMPRE el de ESTA cola, nunca "el del local" ------------
      CUIT: String(CUIT),
      cuit: EMISOR_CUIT_FORMAT || String(CUIT),
      razonSocial: EMISOR_RAZON_SOCIAL || null,
      nombreFantasia: EMISOR_FANTASIA || null,
      condicionIVA: EMISOR_COND_IVA || null,
      domicilioComercial: EMISOR_DOMICILIO || null,
      ingresosBrutos: EMISOR_IIBB || null,
      inicioActividades: EMISOR_INICIO_ACTIVIDADES || null,
      colaFacturacion: COLA,
      localId: LOCAL_ID,

      // --- Receptor ----------------------------------------------------------
      cliente: pedido.CLIENTE,
      documentoCliente: { tipo: 99, numero: 0 },
      condicionIVACliente: 'Consumidor Final',

      // --- Importes y detalle -------------------------------------------------
      total,
      ImpNeto: total,
      ImpIVA: 0,
      ARTICULOS,

      // --- Autorización -------------------------------------------------------
      CAE: det.CAE, CAE_VTO: det.CAEFchVto, VtoCAE: det.CAEFchVto,
      qrData, qrUrl,
      PDF: pdfPath, PDF_BASE64: pdfBase64,
    });

    console.log(`[FACTURACION] Pedido movido a historial: ${process.env.FIREBASE_HISTORIAL}/${facturaKey}`);

    await snapshot.ref.remove();
    pedidosYaFacturados.add(pedidoId);

    console.log(`[FACTURACION] Pedido ${pedidoId} eliminado de ${COLA}. Factura ${facturaKey} emitida por ${MACHINE_ID}.`);

  } catch (err) {
    // ERROR REAL: se deja anotado SOBRE EL PROPIO PEDIDO, dentro de la cola.
    // No es una rama de locks —el pedido sigue donde estaba, se puede
    // reintentar— y es lo que permite que la app distinga un rechazo de ARCA
    // de una simple demora. Sin esto, una demora se veía igual que un error.
    try {
      await snapshot.ref.update({
        errorFacturacion: err?.message || String(err),
        errorAt: Date.now(),
        intentos: (datosCrudos.intentos || 0) + 1,
      });
    } catch (e2) {
      console.error('[FACTURACION] no se pudo anotar el error en el pedido:', e2?.message || e2);
    }

    // El error NO queda oculto: se informa con todo lo necesario para ubicarlo.
    console.error('[FACTURACION] ERROR al facturar', {
      pedidoId,
      mensaje: err?.message || String(err),
      rutaFirebase: `${process.env.FIREBASE_PATH}/${pedidoId}`,
      cola: COLA,
      cuentaFiscal: EMISOR_RAZON_SOCIAL || String(CUIT),
      localId: LOCAL_ID,
    });
    console.error(err?.stack || err);
    throw err;
  } finally {
    // Siempre se libera, haya salido bien o mal: si falló, el pedido sigue en
    // la cola y se puede reintentar sin reiniciar nada.
    pedidosEnProceso.delete(pedidoId);
  }
}

// ---------------------------------------------------------------------------
// Listener principal
// ---------------------------------------------------------------------------

console.log(`[Facturación] Listener iniciado: ${process.env.FIREBASE_PATH}`);
ref.on('child_added', (snapshot) => enqueue(snapshot));
