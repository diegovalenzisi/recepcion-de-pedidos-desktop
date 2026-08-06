/**
 * Test de riesgo cero del QR ARCA/AFIP — NO toca AFIP, Firebase ni pedidos.
 * Reproduce EXACTAMENTE el armado del QR corregido (mismo JSON, base64 estándar y URL)
 * y muestra los logs "QR ARCA JSON" / "QR ARCA URL".
 *
 * Uso (PowerShell), con datos de una factura YA emitida (para que ARCA la reconozca):
 *   node scripts/test-qr-arca.mjs --cuit 30712345678 --ptoVta 3 --tipoCmp 6 --nroCmp 94 --importe 10200.5 --fecha 2026-06-30 --cae 75123456789012
 *
 * tipoCmp: 6 = Factura B (Responsable Inscripto) | 11 = Factura C (Monotributo)
 * Luego copiá la "QR ARCA URL" en el navegador: si ARCA muestra CAE, fecha e importe,
 * el formato quedó correcto (antes decía "datos incompletos").
 */

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
};

// Valores de ejemplo (reemplazalos por los de una factura real con --flags)
const cuit    = Number(get('cuit', 30712345678));
const ptoVta  = Number(get('ptoVta', 3));
const tipoCmp = Number(get('tipoCmp', 6));            // 6 = Factura B, 11 = Factura C
const nroCmp  = Number(get('nroCmp', 94));
const importe = Number(get('importe', 10200.5));
const fecha   = String(get('fecha', new Date().toISOString().slice(0, 10))); // YYYY-MM-DD
const cae     = get('cae', '75123456789012');

// === Mismo armado que resources/facturacion/*/index.mjs ===
const qrData = {
  ver: 1,
  fecha,                              // YYYY-MM-DD
  cuit,
  ptoVta,
  tipoCmp,
  nroCmp,
  importe: Number(importe) || 0,      // número real (sin $ ni separadores)
  moneda: 'PES',
  ctz: 1,
  tipoDocRec: 99,                     // Consumidor Final
  nroDocRec: 0,
  tipoCodAut: 'E',                    // CAE
  codAut: Number(cae),               // CAE real como número
};
const base64 = Buffer.from(JSON.stringify(qrData)).toString('base64'); // base64 ESTÁNDAR
const qrUrl = `https://www.arca.gob.ar/fe/qr/?p=${base64}`;

console.log('QR ARCA JSON:', qrData);
console.log('QR ARCA URL:', qrUrl);

// Chequeos automáticos de la especificación
const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
console.log('\n--- Verificación spec ARCA ---');
console.log('base64 estándar (sin - _):     ', !/[-_]/.test(base64));
console.log('decodifica igual al original:  ', JSON.stringify(decoded) === JSON.stringify(qrData));
console.log('fecha YYYY-MM-DD:              ', /^\d{4}-\d{2}-\d{2}$/.test(qrData.fecha));
console.log('importe es número real:        ', typeof qrData.importe === 'number', '=', qrData.importe);
console.log('codAut (CAE) numérico:         ', typeof qrData.codAut === 'number', '=', qrData.codAut);
console.log('tipoCodAut "E":               ', qrData.tipoCodAut === 'E');
console.log('moneda "PES", ctz 1:          ', qrData.moneda === 'PES' && qrData.ctz === 1);
console.log('nroCmp sin ptoVta:            ', qrData.nroCmp === nroCmp, '| ptoVta:', qrData.ptoVta);
console.log('tipoCmp:', qrData.tipoCmp, tipoCmp === 6 ? '(Factura B)' : tipoCmp === 11 ? '(Factura C)' : '');
