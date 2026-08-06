// COMPROBANTE FISCAL — tipo real, emisor, detalle, QR de ARCA y validación.
//
// Los fixtures reproducen la FORMA EXACTA de los registros que hay en producción
// (relevados en la auditoría de solo lectura del 26-07-2026), sin datos de
// ventas reales: claves de campo, tipos y ausencias son las de verdad.
//
// Módulo puro → corre sin Firebase: node src/lib/api/__tests__/comprobanteFiscal.test.js
import assert from 'node:assert';
import {
  CBTE_TIPO,
  construirQrArca,
  esClaveDeFactura,
  fechaISO,
  fechaLegible,
  leerCbteTipoDelRegistro,
  listarCuentasFiscales,
  normalizarArticulo,
  normalizarArticulos,
  normalizarComprobante,
  partesDeNumero,
  puntoVentaCanonico,
  resolverCuentaEmisora,
  resolverTipoComprobante,
  totalesImpositivos,
  validarComprobanteFiscal,
} from '../comprobanteFiscal.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Configuraciones fiscales — una por local, con SUS datos. Nunca compartidas.
// ---------------------------------------------------------------------------

const CFG_CENTENARIO = {
  tipo: 'monotributo',
  ri: { id: 'ri', initialized: false, cuit: '', ptoVta: '', condIVA: 'Responsable Inscripto' },
  monotributo: {
    cuentas: [{
      id: 'c1782516618677', cuit: '27255724792', cuitFormat: '27-25572479-2', ptoVta: '2',
      razonSocial: 'JESSICA MARIANA ALVARADO', fantasia: 'LANYULINA CENTENARIO',
      domicilio: 'CENTENARIO URUGUAYO 1199 LANUS', condIVA: 'Monotributista', inicioActividades: '',
    }],
  },
};

const CFG_TEMPERLEY = {
  tipo: 'monotributo',
  ri: { id: 'ri', initialized: false, cuit: '', ptoVta: '' },
  monotributo: {
    cuentas: [
      { id: 'a', cuit: '20456793577', cuitFormat: '20-45679357-7', ptoVta: '1', razonSocial: 'LAUTARO VERDERAME', fantasia: 'LANYULINA TEMPERLEY', domicilio: 'CERRITO 2557', condIVA: 'Monotributista' },
      { id: 'b', cuit: '27238537431', cuitFormat: '27-23853743-1', ptoVta: '4', razonSocial: 'MONICA RUTH PALOMO', fantasia: 'LANYULINA TEMPERLEY', domicilio: 'CERRITO 2557 TEMPERLEY', condIVA: 'Monotributista' },
      { id: 'c', cuit: '20226066404', cuitFormat: '20-22606640-4', ptoVta: '2', razonSocial: 'MARCELO GUSTAVO VERDERAME', fantasia: 'LANYULINA TEMPERLEY', domicilio: 'CERRITO 2557 TEMPERLEY', condIVA: 'Monotributista' },
      { id: 'vacia', cuit: '', ptoVta: '', razonSocial: '' },
    ],
  },
};

const CFG_ILCAPO = {
  tipo: 'monotributo',
  monotributo: {
    cuentas: [{
      id: 'c1782320443239', cuit: '27268441021', cuitFormat: '27-26844102-1', ptoVta: '1',
      razonSocial: 'CAROLINA NARDI', fantasia: 'IL CAPO GELATO',
      domicilio: 'DIAGONAL JOSE LEON SUAREZ 7163', condIVA: 'Monotributista',
    }],
  },
};

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

// ---------------------------------------------------------------------------
// Registros — forma real de producción
// ---------------------------------------------------------------------------

/** Monotributo, runtime viejo: clave FCB… pero es una Factura C. */
const REG_CENTENARIO_FCB = {
  CAE: '86073656030720', CAE_VTO: '20260222',
  NORMALIZADO: { CLIENTE: 'consumidor final', DIRECCION: null, TOTAL: 10200 },
  NRO_CMP: 1078, PDF: 'factura-FCB0002-00001078.pdf', PTO_VTA: 2,
  clientes: 'consumidor final', direccion: 'Sin Datos',
  fecha: '18-02-2026', hora: '20:11:03',
  producto: { producto_1: { nombre: '1/4 KILO DE HELADO', valor: 5100 } },
  total: 10200,
};

/** Monotributo, runtime actual (post-corrección): trae CbteTipo y ARTICULOS. */
const REG_ILCAPO_FCC_NUEVO = {
  CAE: '86294497038876', CAE_VTO: '20260728', CbteTipo: 11, CUIT: '27268441021',
  ImpNeto: 15000, ImpIVA: 0,
  ARTICULOS: { 1: { nombre: '1KILO +TACITAS GRATIS', cantidad: 1, precioUnitario: 15000, precioTotal: 15000 } },
  NRO_CMP: 469, PTO_VTA: 1, PDF: 'factura-FCC0001-00000469.pdf', PDF_BASE64: 'JVBERi0x',
  clientes: 'consumidor final', fecha: '24-07-2026', hora: '18:02:11',
  producto: { producto_1: { nombre: '1KILO +TACITAS GRATIS', valor: 15000 } },
  total: 15000,
};

/** Responsable inscripto, runtime RI: PRODUCTO en mayúscula y PDF_BASE64. */
const REG_ACHAVAL_FCB = {
  CAE: '86205873542583', VtoCAE: '20260526', CLIENTE: 'consumidor final', TOTAL: 10500,
  PRODUCTO: { producto_1: { nombre: 'GIO DOBLE CHOCOLATE', valor: 10500 } },
  PDF_BASE64: 'JVBERi0xLjQK', clientes: 'consumidor final', direccion: 'Sin Datos',
  fecha: '21-05-2026', hora: '19:33:02', producto: { producto_1: { nombre: 'GIO DOBLE CHOCOLATE', valor: 10500 } },
  total: 10500,
};

console.log('\nNúmero y punto de venta:');
check('puntoVentaCanonico acepta 8, "8" y "0008"', () => {
  assert.strictEqual(puntoVentaCanonico(8), '0008');
  assert.strictEqual(puntoVentaCanonico('8'), '0008');
  assert.strictEqual(puntoVentaCanonico('0008'), '0008');
});
check('puntoVentaCanonico rechaza basura sin devolver NaN', () => {
  assert.strictEqual(puntoVentaCanonico(''), null);
  assert.strictEqual(puntoVentaCanonico('x'), null);
  assert.strictEqual(puntoVentaCanonico(0), null);
});
check('partesDeNumero descompone FCC0001-00001345', () => {
  assert.deepStrictEqual(partesDeNumero('FCC0001-00001345'), {
    prefijo: 'FCC', puntoVenta: '0001', numero: 1345, completo: '0001-00001345',
  });
});
check('partesDeNumero acepta el número sin prefijo', () => {
  assert.strictEqual(partesDeNumero('0008-00009973').puntoVenta, '0008');
});
check('esClaveDeFactura distingue facturas de remitos', () => {
  assert.ok(esClaveDeFactura('FCB0008-00009973'));
  assert.ok(esClaveDeFactura('FCC0001-00001345'));
  assert.ok(!esClaveDeFactura('FCX0001-00000024'));
});

console.log('\nTipo fiscal — cascada acordada:');
check('1) gana el CbteTipo guardado en el comprobante', () => {
  const t = resolverTipoComprobante({ registro: REG_ILCAPO_FCC_NUEVO, id: 'FCC0001-00000469', config: CFG_ILCAPO });
  assert.strictEqual(t.cbteTipo, CBTE_TIPO.FACTURA_C);
  assert.strictEqual(t.letra, 'C');
  assert.strictEqual(t.origen, 'registro');
  assert.strictEqual(t.inferido, false);
});
check('2) sin CbteTipo, manda la cuenta emisora: FCB de Centenario es Factura C', () => {
  const t = resolverTipoComprobante({ registro: REG_CENTENARIO_FCB, id: 'FCB0002-00001078', config: CFG_CENTENARIO });
  assert.strictEqual(t.letra, 'C', 'el prefijo FCB no puede imponer la letra B');
  assert.strictEqual(t.origen, 'cuenta-emisora');
  assert.strictEqual(t.inferido, false);
  assert.strictEqual(t.cuenta.razonSocial, 'JESSICA MARIANA ALVARADO');
});
check('2) Achaval sigue siendo Factura B por su cuenta RI', () => {
  const t = resolverTipoComprobante({ registro: REG_ACHAVAL_FCB, id: 'FCB0008-00008865', config: CFG_ACHAVAL });
  assert.strictEqual(t.cbteTipo, CBTE_TIPO.FACTURA_B);
  assert.strictEqual(t.letra, 'B');
  assert.strictEqual(t.origen, 'cuenta-emisora');
});
check('3) último recurso: condición del local, marcado como inferido', () => {
  const t = resolverTipoComprobante({ registro: { total: 100 }, id: 'FCB9999-00000001', config: CFG_CENTENARIO });
  assert.strictEqual(t.letra, 'C');
  assert.strictEqual(t.origen, 'local-inferido');
  assert.strictEqual(t.inferido, true);
});
check('sin configuración no se inventa ninguna letra', () => {
  const t = resolverTipoComprobante({ registro: { total: 100 }, id: 'FCB0001-00000001', config: null });
  assert.strictEqual(t.cbteTipo, null);
  assert.strictEqual(t.letra, null);
  assert.strictEqual(t.origen, 'desconocido');
});
check('leerCbteTipoDelRegistro acepta las variantes históricas', () => {
  assert.strictEqual(leerCbteTipoDelRegistro({ CbteTipo: 11 }), 11);
  assert.strictEqual(leerCbteTipoDelRegistro({ tipoComprobante: '6' }), 6);
  assert.strictEqual(leerCbteTipoDelRegistro({ FACTURA_TIPO: 'C' }), 11);
  assert.strictEqual(leerCbteTipoDelRegistro({ TIPO_CBTE: 'Factura B' }), 6);
  assert.strictEqual(leerCbteTipoDelRegistro({ total: 1 }), null);
  assert.strictEqual(leerCbteTipoDelRegistro({ CbteTipo: 999 }), null);
});

console.log('\nCuenta emisora — cada local con SUS datos:');
check('Temperley: el punto de venta elige el CUIT correcto', () => {
  const porPv = (pv) => resolverCuentaEmisora({ registro: { PTO_VTA: pv }, id: `FCC${String(pv).padStart(4, '0')}-00000001`, config: CFG_TEMPERLEY });
  assert.strictEqual(porPv(1).cuit, '20456793577');
  assert.strictEqual(porPv(4).cuit, '27238537431');
  assert.strictEqual(porPv(2).cuit, '20226066404');
});
check('no se mezclan razón social, CUIT ni punto de venta entre locales', () => {
  const cen = normalizarComprobante('FCB0002-00001078', REG_CENTENARIO_FCB, { config: CFG_CENTENARIO });
  const ach = normalizarComprobante('FCB0008-00008865', REG_ACHAVAL_FCB, { config: CFG_ACHAVAL });
  assert.strictEqual(cen.emisor.razonSocial, 'JESSICA MARIANA ALVARADO');
  assert.strictEqual(cen.emisor.cuit, '27-25572479-2');
  assert.strictEqual(cen.puntoVenta, '0002');
  assert.strictEqual(ach.emisor.razonSocial, 'DIEGO LEONEL VALENZISI');
  assert.strictEqual(ach.emisor.cuit, '20-24791588-6');
  assert.strictEqual(ach.puntoVenta, '0008');
  assert.notStrictEqual(cen.emisor.cuit, ach.emisor.cuit);
});
check('el punto de venta ambiguo no se adivina', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [
    { id: 'x', cuit: '11111111111', ptoVta: '1' },
    { id: 'y', cuit: '22222222222', ptoVta: '1' },
  ] } };
  assert.strictEqual(resolverCuentaEmisora({ registro: { PTO_VTA: 1 }, id: 'FCC0001-00000001', config: cfg }), null);
});
check('el CUIT del registro manda sobre el punto de venta', () => {
  const c = resolverCuentaEmisora({ registro: { CUIT: '27238537431', PTO_VTA: 4 }, id: 'FCC0004-00000001', config: CFG_TEMPERLEY });
  assert.strictEqual(c.razonSocial, 'MONICA RUTH PALOMO');
});
check('listarCuentasFiscales ignora las cuentas sin CUIT ni punto de venta', () => {
  assert.strictEqual(listarCuentasFiscales(CFG_TEMPERLEY).length, 3);
  assert.strictEqual(listarCuentasFiscales(CFG_CENTENARIO).length, 1);
});

console.log('\nDetalle — el bug de la tabla vacía:');
check('lee `producto` (monotributo), que era la clave que nadie leía', () => {
  const { articulos, clave } = normalizarArticulos(REG_CENTENARIO_FCB);
  assert.strictEqual(clave, 'producto');
  assert.strictEqual(articulos.length, 1);
  assert.strictEqual(articulos[0].nombre, '1/4 KILO DE HELADO');
});
check('lee `PRODUCTO` (responsable inscripto)', () => {
  assert.strictEqual(normalizarArticulos(REG_ACHAVAL_FCB).clave, 'PRODUCTO');
});
check('`ARTICULOS` tiene prioridad cuando el runtime nuevo lo escribe', () => {
  const { articulos, clave } = normalizarArticulos(REG_ILCAPO_FCC_NUEVO);
  assert.strictEqual(clave, 'ARTICULOS');
  assert.strictEqual(articulos[0].cantidad, 1);
  assert.strictEqual(articulos[0].cantidadPresente, true);
});
check('lee producto_1, producto_2… sueltos en la raíz', () => {
  const { articulos, clave } = normalizarArticulos({
    total: 300, producto_2: { nombre: 'B', valor: 200 }, producto_1: { nombre: 'A', valor: 100 },
  });
  assert.strictEqual(clave, 'producto_N');
  assert.deepStrictEqual(articulos.map((a) => a.nombre), ['A', 'B']);
});
check('lee ARTICULOS en mayúscula de los remitos históricos', () => {
  const { articulos } = normalizarArticulos({ ARTICULOS: [{ NOMBRE: 'X', CANTIDAD: 2, PRECIO: 500 }] });
  assert.strictEqual(articulos[0].nombre, 'X');
  assert.strictEqual(articulos[0].cantidad, 2);
});
check('un registro sin ningún detalle devuelve lista vacía, no rompe', () => {
  assert.deepStrictEqual(normalizarArticulos({ total: 17500 }), { articulos: [], clave: null });
  assert.deepStrictEqual(normalizarArticulos(null), { articulos: [], clave: null });
});
check('la cantidad ausente se asume 1 y queda MARCADA como ausente', () => {
  const a = normalizarArticulo({ nombre: 'X', valor: 5100 });
  assert.strictEqual(a.cantidad, 1);
  assert.strictEqual(a.cantidadPresente, false);
  assert.strictEqual(a.precioUnitario, 5100);
  assert.strictEqual(a.precioTotal, 5100);
});
check('con cantidad y opcionales el subtotal sale completo', () => {
  const a = normalizarArticulo({ nombre: 'Milanesa', cantidad: 2, precioBaseUnitario: 1500, totalOpcionales: 200, selectedOptionals: { g1: [{ nombre: 'Queso' }] } });
  assert.strictEqual(a.precioTotal, 3200);
  assert.ok(a.selectedOptionals);
});
check('el subtotal guardado gana sobre el recalculado', () => {
  assert.strictEqual(normalizarArticulo({ nombre: 'X', cantidad: 3, valor: 100, precioTotal: 250 }).precioTotal, 250);
});

console.log('\nFechas y QR oficial de ARCA:');
check('fechaISO convierte dd-MM-yyyy, dd/MM/yyyy y YYYYMMDD', () => {
  assert.strictEqual(fechaISO('18-02-2026'), '2026-02-18');
  assert.strictEqual(fechaISO('18/02/2026'), '2026-02-18');
  assert.strictEqual(fechaISO('20260222'), '2026-02-22');
  assert.strictEqual(fechaISO('cualquier cosa'), null);
});
check('fechaLegible muestra el vencimiento del CAE', () => {
  assert.strictEqual(fechaLegible('20260222'), '22/02/2026');
});
check('el QR lleva los datos del comprobante, no el número de pedido', () => {
  const { url, datos } = construirQrArca({
    cuit: '27-25572479-2', ptoVta: '0002', cbteTipo: 11, nroCmp: 1078,
    fecha: '18-02-2026', importe: 10200, cae: '86073656030720',
  });
  assert.ok(url.startsWith('https://www.arca.gob.ar/fe/qr/?p='));
  assert.deepStrictEqual(datos, {
    ver: 1, fecha: '2026-02-18', cuit: 27255724792, ptoVta: 2, tipoCmp: 11, nroCmp: 1078,
    importe: 10200, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E',
    codAut: 86073656030720,
  });
  const decodificado = JSON.parse(Buffer.from(url.split('?p=')[1], 'base64').toString('utf8'));
  assert.deepStrictEqual(decodificado, datos, 'el base64 del QR debe decodificar a los mismos datos');
});
check('sin CAE o sin CUIT no se emite un QR inventado', () => {
  const base = { cuit: '27255724792', ptoVta: 2, cbteTipo: 11, nroCmp: 1, fecha: '18-02-2026', importe: 100, cae: '123' };
  assert.ok(construirQrArca(base));
  assert.strictEqual(construirQrArca({ ...base, cae: null }), null);
  assert.strictEqual(construirQrArca({ ...base, cuit: '' }), null);
  assert.strictEqual(construirQrArca({ ...base, fecha: 'nada' }), null);
});

console.log('\nTotales impositivos según el tipo real:');
check('Factura C: el IVA no se discrimina', () => {
  const t = totalesImpositivos({ cbteTipo: 11, importe: 15000 });
  assert.strictEqual(t.neto, 15000);
  assert.strictEqual(t.iva, 0);
  assert.strictEqual(t.discrimina, false);
});
check('Factura B: neto e IVA 21%, igual que lo declarado a ARCA', () => {
  const t = totalesImpositivos({ cbteTipo: 6, importe: 10500 });
  assert.strictEqual(t.neto, 8677.69);
  assert.strictEqual(t.iva, 1822.31);
  assert.strictEqual(t.alicuota, 21);
  assert.strictEqual(Number((t.neto + t.iva).toFixed(2)), 10500);
});
check('si el registro guarda ImpNeto/ImpIVA, se usan esos', () => {
  const t = totalesImpositivos({ cbteTipo: 6, importe: 100, impNeto: 80, impIVA: 20 });
  assert.strictEqual(t.origen, 'registro');
  assert.strictEqual(t.neto, 80);
});

console.log('\nComprobante completo:');
check('Centenario FCB0002-00001078 se normaliza como Factura C con detalle', () => {
  const c = normalizarComprobante('FCB0002-00001078', REG_CENTENARIO_FCB, { config: CFG_CENTENARIO });
  assert.strictEqual(c.id, 'FCB0002-00001078', 'la clave técnica no se reescribe');
  assert.strictEqual(c.tipoNombre, 'Factura C');
  assert.strictEqual(c.numeroCompleto, '0002-00001078');
  assert.strictEqual(c.importe, 10200);
  assert.strictEqual(c.articulos.length, 1);
  assert.strictEqual(c.cliente.nombre, 'consumidor final');
  assert.strictEqual(c.cae, '86073656030720');
  assert.strictEqual(c.caeVtoLegible, '22/02/2026');
  assert.ok(c.qrUrl, 'debe tener QR oficial reconstruido');
  assert.strictEqual(c.pdfArchivo, 'factura-FCB0002-00001078.pdf');
  assert.strictEqual(c.pdfBase64, null);
});
check('Achaval conserva su PDF original y su letra B', () => {
  const c = normalizarComprobante('FCB0008-00008865', REG_ACHAVAL_FCB, { config: CFG_ACHAVAL });
  assert.strictEqual(c.tipoNombre, 'Factura B');
  assert.strictEqual(c.pdfBase64, 'JVBERi0xLjQK');
  assert.strictEqual(c.emisor.inicioActividades, '01/01/2024');
});
check('el cliente cae en Consumidor Final sólo si no hay ninguno', () => {
  assert.strictEqual(normalizarComprobante('FCC0001-1', { total: 1 }, { config: CFG_ILCAPO }).cliente.nombre, 'Consumidor Final');
  assert.strictEqual(normalizarComprobante('FCC0001-1', { CLIENTE: 'Ana' }, { config: CFG_ILCAPO }).cliente.nombre, 'Ana');
  assert.strictEqual(normalizarComprobante('FCC0001-1', { clientes: 'Ana' }, { config: CFG_ILCAPO }).cliente.nombre, 'Ana');
});

console.log('\nValidación — una factura sin productos NO se imprime:');
check('el comprobante completo es válido', () => {
  const c = normalizarComprobante('FCC0001-00000469', REG_ILCAPO_FCC_NUEVO, { config: CFG_ILCAPO });
  const v = validarComprobanteFiscal(c);
  assert.strictEqual(v.valido, true, `problemas: ${v.problemas.join(' | ')}`);
});
check('total presente y tabla de productos vacía FALLA la validación', () => {
  const c = normalizarComprobante('FCC0001-00001345', {
    CAE: '86283528405868', CAE_VTO: '20260722', PTO_VTA: 1, NRO_CMP: 1345,
    clientes: 'Gisela', fecha: '19-07-2026', total: 17500,
  }, { config: CFG_ILCAPO });
  const v = validarComprobanteFiscal(c);
  assert.strictEqual(v.valido, false);
  assert.ok(v.problemas.some((p) => p.includes('detalle de productos')), v.problemas.join(' | '));
});
check('sin CAE tampoco se imprime como factura', () => {
  const c = normalizarComprobante('FCC0001-2', { total: 100, PTO_VTA: 1, NRO_CMP: 2, producto: { 1: { nombre: 'X', valor: 100 } } }, { config: CFG_ILCAPO });
  assert.strictEqual(validarComprobanteFiscal(c).valido, false);
});
check('se avisa cuando el detalle no suma el total', () => {
  const c = normalizarComprobante('FCC0002-00001782', {
    CAE: '86261354919206', CAE_VTO: '20260706', PTO_VTA: 2, NRO_CMP: 1782,
    clientes: 'Fabian', fecha: '01-07-2026', total: 6500,
    producto: { producto_1: { nombre: 'GRATIS 1/4 COMPRANDO 1 KILO', valor: 16500 } },
  }, { config: CFG_CENTENARIO });
  const v = validarComprobanteFiscal(c);
  assert.strictEqual(v.valido, true, 'no bloquea: el comprobante fiscal existe');
  assert.ok(v.avisos.some((a) => a.includes('16500.00') && a.includes('6500.00')), v.avisos.join(' | '));
});
check('se avisa cuando el detalle no trae cantidades', () => {
  const c = normalizarComprobante('FCB0002-00001078', REG_CENTENARIO_FCB, { config: CFG_CENTENARIO });
  assert.ok(validarComprobanteFiscal(c).avisos.some((a) => a.includes('no incluye cantidades')));
});
check('se avisa cuando el tipo tuvo que inferirse', () => {
  const c = normalizarComprobante('FCB9999-00000001', {
    CAE: '1', CAE_VTO: '20260101', total: 100, fecha: '01-01-2026',
    producto: { 1: { nombre: 'X', valor: 100 } },
  }, { config: CFG_CENTENARIO });
  assert.strictEqual(c.tipoInferido, true);
  assert.ok(validarComprobanteFiscal(c).avisos.some((a) => a.includes('se infirió')));
});

console.log(`\n${passed} verificaciones OK`);
