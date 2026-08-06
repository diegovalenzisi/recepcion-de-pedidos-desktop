// REIMPRESIÓN DE LA FACTURA — RENDER REAL DEL DOCUMENTO.
//
// Renderiza <ReceiptDocument> de verdad (el mismo componente que usa la ventana
// de impresión) y verifica sobre el HTML resultante que el documento que sale
// impreso es una FACTURA FISCAL y no el "Comprobante de Venta" genérico que se
// estaba entregando.
//
// Es la prueba directa del PDF reportado: número FCC…, total presente y TABLA DE
// PRODUCTOS VACÍA.
//
// No toca Firebase ni AFIP: sólo renderiza a texto.
//
// Correr con: node src/lib/api/__tests__/reimpresionFactura.render.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '../../../..');

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

// El componente y sus dependencias usan el alias '@' y JSX: se empaquetan con
// esbuild —el mismo que usa Vite— para poder renderizarlos en Node.
const entrada = `
  import React from 'react';
  import { renderToStaticMarkup } from 'react-dom/server';
  import ReceiptDocument from '@/components/sales/ReceiptDocument';
  import { listarCuentasFiscales, normalizarComprobante } from '@/lib/api/comprobanteFiscal';
  import { normalizarRemitoParaTabla } from '@/lib/api/remitos';
  globalThis.__render = (registro, id, config) => {
    const c = normalizarComprobante(id, registro, { config, cuentas: listarCuentasFiscales(config) });
    return { html: renderToStaticMarkup(React.createElement(ReceiptDocument, { sale: c })), comprobante: c };
  };
  globalThis.__renderRemito = (id, data) =>
    renderToStaticMarkup(React.createElement(ReceiptDocument, { sale: normalizarRemitoParaTabla(id, data) }));
`;

// Se empaqueta a CommonJS: react-dom/server hace un require() dinámico de
// 'stream' que el shim ESM de esbuild no resuelve.
const salida = path.join(os.tmpdir(), `reimpresion-${process.pid}.cjs`);
esbuild.buildSync({
  stdin: { contents: entrada, resolveDir: raiz, loader: 'js' },
  bundle: true, format: 'cjs', platform: 'node', outfile: salida,
  alias: { '@': path.join(raiz, 'src') },
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  // El árbol de imports llega a módulos que leen `import.meta.env` de Vite.
  // Fuera del build no existe: se define vacío para que caigan en sus valores
  // por defecto. Nada de esto se conecta a Firebase: sólo se renderiza HTML.
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
});
// `getBusinessName()` lee el local activo del localStorage del navegador. Se
// simula uno que NO es ninguno de los locales reales, justamente para probar que
// el encabezado de la factura sale de la configuración fiscal del comprobante y
// no del nombre de negocio guardado en la PC.
globalThis.localStorage = {
  _d: { localId: '00000000' },
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

createRequire(import.meta.url)(salida);
fs.unlinkSync(salida);

const render = globalThis.__render;
const renderRemito = globalThis.__renderRemito;

const CFG_TEMPERLEY = {
  tipo: 'monotributo',
  monotributo: { cuentas: [{
    id: 'a', cuit: '20456793577', cuitFormat: '20-45679357-7', ptoVta: '1',
    razonSocial: 'LAUTARO VERDERAME', fantasia: 'LANYULINA TEMPERLEY',
    domicilio: 'CERRITO 2557', condIVA: 'Monotributista',
    inicioActividades: '01/03/2024', iibb: '901-111111-1',
  }] },
};

// El registro DEFECTUOSO tal cual está hoy en producción: sin detalle.
const REG_DEFECTUOSO = {
  CAE: '86283528405868', CAE_VTO: '20260722', PTO_VTA: 1, NRO_CMP: 1345,
  clientes: 'Gisela Mariana Savino', direccion: 'Sin Datos',
  fecha: '19-07-2026', hora: '20:05:00', total: 17500,
};

// El MISMO comprobante ya emitido por el runtime corregido.
const REG_CORREGIDO = {
  ...REG_DEFECTUOSO,
  CbteTipo: 11, CUIT: '20456793577', ImpNeto: 17500, ImpIVA: 0,
  ARTICULOS: {
    1: { nombre: '1 KILO DE HELADO', cantidad: 1, precioUnitario: 15000, precioTotal: 15000 },
    2: { nombre: 'PALETA DE ANANA', cantidad: 2, precioUnitario: 1250, precioTotal: 2500 },
  },
};

console.log('\nEl comprobante reportado (FCC0001-00001345):');

const defectuoso = render(REG_DEFECTUOSO, 'FCC0001-00001345', CFG_TEMPERLEY);

check('YA NO se imprime con el título genérico "Comprobante de Venta"', () => {
  assert.ok(!defectuoso.html.includes('Comprobante de Venta'), 'sigue apareciendo el título genérico');
});
check('YA NO se imprime un QR con el número interno del pedido', () => {
  assert.ok(!defectuoso.html.includes('Orden: #'), 'sigue el QR interno del pedido');
  assert.ok(!defectuoso.html.includes('<svg'), 'un comprobante incompleto no puede llevar ningún QR');
});
check('un comprobante sin detalle se rechaza y dice por qué', () => {
  assert.ok(defectuoso.html.includes('Comprobante incompleto'), defectuoso.html.slice(0, 200));
  assert.ok(defectuoso.html.includes('no tiene detalle de productos'));
  assert.ok(defectuoso.html.includes('NO es una factura'));
});
check('el registro defectuoso NO se oculta: informa su total y su CAE', () => {
  assert.ok(defectuoso.html.includes('17.500,00'), 'debe seguir mostrando el total registrado');
  assert.ok(defectuoso.html.includes('86283528405868'), 'debe seguir mostrando el CAE');
});
check('indica dónde quedó el PDF original cuando el registro lo referencia', () => {
  const conPdf = render({ ...REG_DEFECTUOSO, PDF: 'factura-FCC0001-00001345.pdf' }, 'FCC0001-00001345', CFG_TEMPERLEY);
  assert.ok(conPdf.html.includes('factura-FCC0001-00001345.pdf'));
});

console.log('\nEl mismo comprobante, emitido por el runtime corregido:');

const ok = render(REG_CORREGIDO, 'FCC0001-00001345', CFG_TEMPERLEY);
const html = ok.html;

check('encabezado del emisor completo', () => {
  for (const dato of [
    'LANYULINA TEMPERLEY',        // nombre de fantasía
    'LAUTARO VERDERAME',          // razón social
    '20-45679357-7',              // CUIT
    'CERRITO 2557',               // domicilio comercial
    'Monotributista',             // condición frente al IVA
    '901-111111-1',               // Ingresos Brutos
    '01/03/2024',                 // inicio de actividades
    '0001',                       // punto de venta
  ]) assert.ok(html.includes(dato), `falta en el encabezado: ${dato}`);
});
check('letra y tipo de comprobante correctos (Factura C, no B)', () => {
  assert.ok(html.includes('>C</div>'), 'falta la letra C destacada');
  assert.ok(html.includes('Factura C'));
  assert.ok(!html.includes('Factura B'));
});
check('número completo del comprobante', () => {
  assert.ok(html.includes('0001-00001345'), 'falta el número completo');
});
check('datos del comprobante y del receptor', () => {
  assert.ok(html.includes('19-07-2026'), 'falta la fecha de emisión');
  assert.ok(html.includes('Gisela Mariana Savino'), 'falta el cliente');
  assert.ok(html.includes('Documento receptor'));
  assert.ok(html.includes('Cond. IVA receptor'));
  assert.ok(html.includes('Consumidor Final'));
});
check('LA TABLA DE PRODUCTOS YA NO ESTÁ VACÍA', () => {
  const filas = (html.match(/class="item-row"/g) || []).length;
  assert.strictEqual(filas, 2, `se esperaban 2 renglones y hay ${filas}`);
  assert.ok(html.includes('1 KILO DE HELADO'));
  assert.ok(html.includes('PALETA DE ANANA'));
});
check('cada renglón lleva cantidad, precio unitario y subtotal', () => {
  assert.ok(html.includes('P. Unit.'), 'falta la columna de precio unitario');
  assert.ok(html.includes('Subtotal'), 'falta la columna de subtotal');
  assert.ok(html.includes('15.000,00'), 'falta el unitario/subtotal del primer renglón');
  assert.ok(html.includes('1.250,00'), 'falta el precio unitario del segundo renglón');
  assert.ok(html.includes('2.500,00'), 'falta el subtotal del segundo renglón');
});
check('total correcto', () => {
  assert.ok(html.includes('TOTAL:'));
  assert.ok(html.includes('17.500,00'));
});
check('Factura C: el IVA no se discrimina', () => {
  assert.ok(!html.includes('Neto gravado'), 'una Factura C no discrimina neto');
  assert.ok(!html.includes('IVA 21%'));
  assert.ok(html.includes('Monotributo'));
});
check('CAE, vencimiento y leyenda de autorización', () => {
  assert.ok(html.includes('86283528405868'), 'falta el CAE');
  assert.ok(html.includes('22/07/2026'), 'falta el vencimiento del CAE');
  assert.ok(html.includes('Comprobante autorizado por ARCA'));
});
check('el QR es el OFICIAL de ARCA y coincide con la factura', () => {
  // QRCodeSVG dibuja el código, así que la URL no queda como texto en el HTML:
  // se verifica que el QR exista, esté rotulado, y que el valor codificado sea
  // el de ARCA con los datos de ESTA factura.
  assert.ok(html.includes('<svg'), 'falta el QR');
  assert.ok(html.includes('QR oficial ARCA'), 'falta el rótulo del QR');
  assert.ok(ok.comprobante.qrUrl.startsWith('https://www.arca.gob.ar/fe/qr/?p='), ok.comprobante.qrUrl);
  const b64 = ok.comprobante.qrUrl.split('?p=')[1];
  const datos = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  assert.strictEqual(datos.cuit, 20456793577);
  assert.strictEqual(datos.ptoVta, 1);
  assert.strictEqual(datos.tipoCmp, 11);
  assert.strictEqual(datos.nroCmp, 1345);
  assert.strictEqual(datos.importe, 17500);
  assert.strictEqual(datos.codAut, 86283528405868);
  assert.strictEqual(datos.fecha, '2026-07-19');
});

console.log('\nFactura B (Achaval) — mismo diseño, otros datos fiscales:');

const CFG_ACHAVAL = {
  tipo: 'responsable_inscripto',
  ri: {
    id: 'ri', cuit: '20247915886', cuitFormat: '20-24791588-6', ptoVta: '8',
    razonSocial: 'DIEGO LEONEL VALENZISI', fantasia: 'LANYULINA ACHAVAL',
    domicilio: 'ACHAVAL 3703 MONTE CHINGOLO LANUS', condIVA: 'Responsable Inscripto',
    inicioActividades: '01/01/2024',
  },
  monotributo: { cuentas: [] },
};

const b = render({
  CAE: '86283183933356', VtoCAE: '20260719', CbteTipo: 6, CUIT: '20247915886',
  CLIENTE: 'Alicia', TOTAL: 12100, fecha: '19-07-2026', hora: '18:00:00',
  ARTICULOS: { 1: { nombre: '1 KILO DE HELADO', cantidad: 1, precioUnitario: 12100, precioTotal: 12100 } },
}, 'FCB0008-00009973', CFG_ACHAVAL);

check('Factura B discrimina neto e IVA 21%', () => {
  assert.ok(b.html.includes('Factura B'));
  assert.ok(b.html.includes('>B</div>'));
  assert.ok(b.html.includes('Neto gravado'));
  assert.ok(b.html.includes('IVA 21%'));
  // 12.100 = 10.000 neto + 2.100 de IVA al 21%, igual que lo declarado a ARCA.
  assert.ok(b.html.includes('10.000,00'), 'neto mal calculado');
  assert.ok(b.html.includes('2.100,00'), 'IVA mal calculado');
});
check('el diseño es común pero los datos fiscales son de SU cuenta', () => {
  assert.ok(b.html.includes('DIEGO LEONEL VALENZISI'));
  assert.ok(b.html.includes('20-24791588-6'));
  assert.ok(!b.html.includes('LAUTARO VERDERAME'), 'no puede aparecer el emisor de otro local');
  assert.ok(!b.html.includes('20-45679357-7'));
});

console.log('\nRemito — sigue siendo un documento NO fiscal:');

const remito = renderRemito('FCX0002-00000001', {
  numeroComprobante: 'FCX0002-00000001', tipo: 'FCX', fecha: '26-07-2026', hora: '20:15:00',
  total: 5500, cliente: 'Consumidor Final', formaPago: 'Efectivo', canal: 'mostrador', facturado: false,
  productos: { 1: { nombre: '1/4 KILO DE HELADO', cantidad: 1, precioUnitario: 5500, precioTotal: 5500 } },
});

check('el remito se imprime como Remito y avisa que no es factura', () => {
  assert.ok(remito.includes('<h2>Remito</h2>'));
  assert.ok(remito.includes('Documento no válido como factura'));
  assert.ok(remito.includes('FCX0002-00000001'));
  assert.ok(remito.includes('1/4 KILO DE HELADO'));
  assert.ok(remito.includes('5.500,00'));
});
check('el remito NO lleva CAE, ni QR de ARCA, ni letra fiscal', () => {
  assert.ok(!remito.includes('CAE'));
  assert.ok(!remito.includes('arca.gob.ar'));
  assert.ok(!remito.includes('Comprobante autorizado'));
});

console.log('\nDesktop y Tablet producen el MISMO documento:');

// Se empaqueta el ReceiptDocument del OTRO repo y se renderiza el mismo
// comprobante: si los dos proyectos no imprimen exactamente lo mismo, el cliente
// recibiría facturas distintas según desde qué equipo se reimprima.
const OTROS = ['recepcion-de-pedidos-desktop', 'recepcion-de-pedidos-tab']
  .map((n) => path.join(path.dirname(raiz), n))
  .filter((p) => path.resolve(p) !== path.resolve(raiz) && fs.existsSync(path.join(p, 'src/components/sales/ReceiptDocument.jsx')));

if (OTROS.length === 0) {
  console.log('      (el otro proyecto no está disponible en esta máquina)');
} else {
  for (const otro of OTROS) {
    check(`mismo HTML que ${path.basename(otro)}`, () => {
      const tmp = path.join(os.tmpdir(), `reimpresion-otro-${process.pid}.cjs`);
      esbuild.buildSync({
        stdin: { contents: entrada, resolveDir: otro, loader: 'js' },
        bundle: true, format: 'cjs', platform: 'node', outfile: tmp,
        alias: { '@': path.join(otro, 'src') },
        loader: { '.js': 'jsx', '.jsx': 'jsx' },
        define: { 'import.meta.env': '{}' },
        logLevel: 'silent',
      });
      createRequire(import.meta.url)(tmp);
      fs.unlinkSync(tmp);
      const otroHtml = globalThis.__render(REG_CORREGIDO, 'FCC0001-00001345', CFG_TEMPERLEY).html;
      assert.strictEqual(otroHtml, html, 'la reimpresión difiere entre Desktop y Tablet');
    });
  }
}

console.log(`\n${passed} verificaciones OK`);
