import dotenv from 'dotenv';
import fs from 'fs';
import https from 'https';
import soap from 'soap';
import admin from 'firebase-admin';
import moment from 'moment';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { execSync } from 'child_process';

dotenv.config();

console.log(`[AFIP NODE] execPath: ${process.execPath}`);
console.log(`[AFIP NODE] version: ${process.version}`);
console.log(`[AFIP NODE] openssl: ${process.versions.openssl}`);

admin.initializeApp({
  credential: admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  databaseURL: process.env.FIREBASE_DB,
});

const db = admin.database();
const ref = db.ref(process.env.FIREBASE_PATH);

console.log(`🧾 Escuchando pedidos a facturar para ${process.env.LOG_ALIAS || 'RI'}...`);
console.log('✅ Firebase inicializado. DB:', admin.app().options.databaseURL);

const CUIT = process.env.CUIT;
const PTO_VTA = parseInt(process.env.PTO_VTA);
const CERT = fs.readFileSync(process.env.CERT);
const KEY = fs.readFileSync(process.env.KEY);

const EMISOR_RAZON_SOCIAL = process.env.EMISOR_RAZON_SOCIAL || '';
const EMISOR_FANTASIA = process.env.EMISOR_FANTASIA || '';
const EMISOR_CUIT_FORMAT = process.env.EMISOR_CUIT_FORMAT || '';
const EMISOR_COND_IVA = process.env.EMISOR_COND_IVA || 'Responsable Inscripto';
const EMISOR_INICIO_ACTIVIDADES = process.env.EMISOR_INICIO_ACTIVIDADES || '';
const EMISOR_DOMICILIO = process.env.EMISOR_DOMICILIO || '';

const httpsAgent = new https.Agent({
  cert: CERT,
  key: KEY,
  rejectUnauthorized: false,
});

async function getTA() {
  const taPath = './TA.xml';

  if (fs.existsSync(taPath)) {
    const xml = fs.readFileSync(taPath, 'utf8');
    const expirationMatch = xml.match(/<expirationTime>(.*?)<\/expirationTime>/);
    if (expirationMatch) {
      const expirationDate = new Date(expirationMatch[1]);
      if (expirationDate > new Date()) {
        const token = xml.match(/<token>(.*?)<\/token>/)[1];
        const sign = xml.match(/<sign>(.*?)<\/sign>/)[1];
        return { token, sign };
      }
    }
  }

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
  execSync(`openssl smime -sign -signer ${process.env.CERT} -inkey ${process.env.KEY} -outform DER -nodetach -in TRA.xml -out TRA.tmp`);

  const cms = fs.readFileSync('TRA.tmp').toString('base64');

  return new Promise((resolve, reject) => {
    soap.createClient(wsaaWsdl, { wsdl_options: { agent: httpsAgent } }, (err, client) => {
      if (err) return reject(err);
      client.loginCms({ in0: cms }, (err2, result) => {
        if (err2) return reject(err2);
        const token = result.loginCmsReturn.match(/<token>(.*)<\/token>/)[1];
        const sign = result.loginCmsReturn.match(/<sign>(.*)<\/sign>/)[1];
        fs.writeFileSync(taPath, result.loginCmsReturn);
        try { fs.unlinkSync('TRA.xml'); fs.unlinkSync('TRA.tmp'); } catch (e) {}
        resolve({ token, sign });
      });
    });
  });
}

async function getLastVoucher(auth) {
  const wsfeWsdl = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';
  const client = await soap.createClientAsync(wsfeWsdl, { wsdl_options: { agent: httpsAgent } });

  const [result] = await client.FECompUltimoAutorizadoAsync({
    Auth: auth,
    PtoVta: PTO_VTA,
    CbteTipo: 6,
  });

  return { client, lastVoucher: result.FECompUltimoAutorizadoResult.CbteNro };
}

async function solicitarCAE(auth, client, pedido, cbteNro) {
  const total = parseFloat(pedido.TOTAL || pedido.total);
  const neto = +(total / 1.21).toFixed(2);
  const iva = +(total - neto).toFixed(2);

  const [result] = await client.FECAESolicitarAsync({
    Auth: auth,
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: PTO_VTA, CbteTipo: 6 },
      FeDetReq: {
        FECAEDetRequest: [{
          Concepto: 1,
          DocTipo: 99,
          DocNro: 0,
          CbteDesde: cbteNro,
          CbteHasta: cbteNro,
          CbteFch: moment().format("YYYYMMDD"),
          ImpTotal: total,
          ImpTotConc: 0,
          ImpNeto: neto,
          ImpOpEx: 0,
          ImpIVA: iva,
          ImpTrib: 0,
          MonId: 'PES',
          MonCotiz: 1,
          Iva: {
            AlicIva: [{ Id: 5, BaseImp: neto, Importe: iva }]
          }
        }]
      }
    }
  });

  const detalle = result.FECAESolicitarResult?.FeDetResp?.FECAEDetResponse?.[0];
  if (!detalle) throw new Error("No se recibió FECAEDetResponse");
  return detalle;
}

async function generarQR({ cae, nroCbte, fecha, cuit, importe }) {
  // JSON del QR según especificación oficial ARCA/AFIP (RG 4291).
  const qrData = {
    ver: 1,
    fecha,                              // YYYY-MM-DD
    cuit,                              // CUIT emisor (número)
    ptoVta: PTO_VTA,                   // solo punto de venta
    tipoCmp: 6,                        // Factura B
    nroCmp: nroCbte,                   // solo número de comprobante (sin pto vta)
    importe: Number(importe) || 0,     // importe total real (número, sin $ ni separadores)
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 99,                    // Consumidor Final
    nroDocRec: 0,
    tipoCodAut: 'E',                   // E = CAE
    codAut: Number(cae),               // CAE real como número
  };
  const base64 = Buffer.from(JSON.stringify(qrData)).toString('base64'); // base64 estándar
  const qrUrl = `https://www.arca.gob.ar/fe/qr/?p=${base64}`;
  console.log("QR ARCA JSON:", qrData);
  console.log("QR ARCA URL:", qrUrl);
  return await QRCode.toDataURL(qrUrl);
}

/* =======================
   🔁 Cola con pausa
   ======================= */

const queue = [];
let processing = false;
let tlsPaused = false;
const PAUSA_MS = 3000;

function enqueue(snapshot) {
  console.log(`[Facturación] Pedido detectado: ${snapshot.key}`);
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
  console.log(`▶️ Procesando pedido: ${snapshot.key} (restan ${queue.length})`);
  try {
    await procesarSnapshot(snapshot);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`❌ Error al facturar: ${msg}`);
    if (msg.includes('dh key too small') || msg.includes('EPROTO') || msg.includes('SSL routines')) {
      tlsPaused = true;
      console.error('[AFIP TLS] ❌ Error TLS detectado. Cola pausada. Reiniciá el servicio.');
    }
  }
  if (!tlsPaused && queue.length > 0) {
    console.log(`⏳ Esperando ${PAUSA_MS / 1000}s antes de la próxima factura...`);
    setTimeout(processNext, PAUSA_MS);
  } else if (!tlsPaused) {
    processing = false;
  }
}

/* =======================
   🧠 Lógica de facturación
   ======================= */

async function procesarSnapshot(snapshot) {
  const pedido = snapshot.val();
  const pedidoId = snapshot.key;

  const cliente = pedido.CLIENTE || pedido.clientes || "Consumidor Final";
  const total = pedido.TOTAL || pedido.total || 0;
  const productos = pedido.PRODUCTO || pedido.producto || pedido.producto_1;

  if (!total || !productos) {
    console.log(`❌ Pedido ${pedidoId} incompleto, se omite.`);
    return;
  }

  try {
    const { token, sign } = await getTA();
    const auth = { Token: token, Sign: sign, Cuit: CUIT };
    const { client, lastVoucher } = await getLastVoucher(auth);
    const nroCbte = lastVoucher + 1;
    const nroFactura = `${PTO_VTA.toString().padStart(4, '0')}-${nroCbte.toString().padStart(8, '0')}`;
    const caeData = await solicitarCAE(auth, client, pedido, nroCbte);

    const fechaCbte = moment().format("DD/MM/YYYY");
    const qrData = await generarQR({
      cae: caeData.CAE,
      nroCbte,
      fecha: moment().format('YYYY-MM-DD'),
      cuit: parseInt(CUIT),
      importe: Number(total),
    });

    const buffers = [];
    const doc = new PDFDocument({ size: [230, 600], margin: 10 });
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
      const pdfBase64 = Buffer.concat(buffers).toString('base64');

      const historialRef = db.ref(`${process.env.FIREBASE_HISTORIAL}/FCB${nroFactura}`);
      await historialRef.set({
        ...pedido,
        CLIENTE: cliente,
        TOTAL: total,
        PRODUCTO: productos,
        CAE: caeData.CAE,
        VtoCAE: caeData.CAEFchVto,
        PDF_BASE64: pdfBase64,
      });
      await snapshot.ref.remove();
      console.log(`✅ Factura FCB${nroFactura} emitida. CAE: ${caeData.CAE}`);
    });

    if (EMISOR_FANTASIA) doc.fontSize(14).text(EMISOR_FANTASIA, { align: 'center' });
    doc.fontSize(10).text('Factura B', { align: 'center' });
    doc.text(`Factura Nº: ${nroFactura}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(9);
    if (EMISOR_RAZON_SOCIAL) doc.text(`Razón Social: ${EMISOR_RAZON_SOCIAL}`);
    if (EMISOR_FANTASIA) doc.text(`Nombre Fantasía: ${EMISOR_FANTASIA}`);
    if (EMISOR_CUIT_FORMAT) doc.text(`CUIT: ${EMISOR_CUIT_FORMAT}`);
    doc.text(`IVA: ${EMISOR_COND_IVA}`);
    if (EMISOR_INICIO_ACTIVIDADES) doc.text(`Inicio actividades: ${EMISOR_INICIO_ACTIVIDADES}`);
    if (EMISOR_DOMICILIO) doc.text(`Dirección: ${EMISOR_DOMICILIO}`);
    doc.text(`Fecha: ${fechaCbte}`);
    doc.moveDown();

    doc.text(`Cliente: ${cliente}`);
    if (pedido.DIRECCION) doc.text(`Dirección: ${pedido.DIRECCION}`);
    doc.moveDown();

    doc.text('Productos:');
    Object.entries(productos).forEach(([key, value], index) => {
      doc.text(`${index + 1}. ${value.nombre} x ${value.cantidad}`);
    });

    doc.moveDown();
    doc.text(`TOTAL: $${total}`, { align: 'right' });
    doc.text(`CAE: ${caeData.CAE}`);
    doc.text(`Vto CAE: ${caeData.CAEFchVto}`);
    doc.image(qrData, doc.x, doc.y + 10, { width: 100 });
    doc.end();

  } catch (err) {
    throw err;
  }
}

/* =======================
   📡 Listener principal
   ======================= */

console.log(`[Facturación] Listener iniciado: ${process.env.FIREBASE_PATH}`);
ref.on('child_added', (snapshot) => {
  enqueue(snapshot);
});
