// Remitos (FCX): numeración, ruta canónica y estructura del comprobante.
// Módulo puro → corre sin Firebase: node src/lib/api/__tests__/remitos.test.js
import assert from 'node:assert';
import {
  PREFIJO_REMITO,
  NODO_REMITOS,
  construirNumeroRemito,
  construirProductos,
  construirRemitoDesdeVenta,
  describirFormaPago,
  esFacturaFiscal,
  esNumeroRemitoValido,
  esRemito,
  filasDeRemitos,
  limpiarIndefinidos,
  listarPagos,
  normalizarPuntoVenta,
  normalizarRemitoParaTabla,
  normalizarSecuencia,
  ordenarRemitos,
  rutaContadorRemitos,
  rutaRemito,
  rutaRemitos,
} from '../remitos.js';
import { LOCAL_ID_REQUERIDO } from '../rutasLocales.js';

const ACHAVAL = '40508022';
let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const VENTA_MOSTRADOR = {
  id: 27,
  total: 5700,
  date: '25-07-2026',
  hora: '22:45:00',
  fechacaja: '25-07-2026',
  turno: 3,
  emiteFactura: false,
  status: 'COMPLETADO',
  client: { name: 'Consumidor Final' },
  payments: [{ method: 'Efectivo', amount: 3000 }, { method: 'Débito', amount: 2700 }],
  items: [
    { nombre: 'Milanesa', cantidad: 2, valor: 1500, precioBaseUnitario: 1500, subtotalLinea: 3200,
      totalOpcionales: 200, codigo: '156A',
      selectedOptionals: { g1: [{ nombre: 'Queso', total: 200, cantidad: 1 }] } },
    { nombre: 'Gaseosa', cantidad: 1, valor: 2500 },
  ],
};

console.log('\nNumeración FCX:');
check('punto de venta a 4 dígitos desde cualquier forma', () => {
  assert.strictEqual(normalizarPuntoVenta(8), '0008');
  assert.strictEqual(normalizarPuntoVenta('8'), '0008');
  assert.strictEqual(normalizarPuntoVenta('0008'), '0008');
  assert.strictEqual(normalizarPuntoVenta(1), '0001');
});
check('punto de venta inválido cae al de por defecto, nunca a NaN', () => {
  for (const v of [undefined, null, '', 'ocho', 0, -3, {}]) {
    assert.strictEqual(normalizarPuntoVenta(v), '0001', `falló con ${JSON.stringify(v)}`);
  }
});
check('secuencia a 8 dígitos', () => {
  assert.strictEqual(normalizarSecuencia(10294), '00010294');
  assert.strictEqual(normalizarSecuencia('1'), '00000001');
  assert.strictEqual(normalizarSecuencia(0), null);
  assert.strictEqual(normalizarSecuencia('x'), null);
});
check('número canónico FCX0008-00010294', () => {
  assert.strictEqual(construirNumeroRemito(8, 10294), 'FCX0008-00010294');
  assert.strictEqual(construirNumeroRemito('0001', 1), 'FCX0001-00000001');
});
check('sin secuencia válida no se inventa un número', () => {
  assert.strictEqual(construirNumeroRemito(8, 0), null);
  assert.strictEqual(construirNumeroRemito(8, undefined), null);
});
check('reconoce remitos y facturas sin confundirlos', () => {
  assert.strictEqual(esNumeroRemitoValido('FCX0008-00010294'), true);
  assert.strictEqual(esNumeroRemitoValido('FCB0008-00010295'), false);
  assert.strictEqual(esRemito('FCX0001-00000001'), true);
  assert.strictEqual(esRemito('FCB0008-00010295'), false);
  assert.strictEqual(esFacturaFiscal('FCB0008-00010295'), true);
  assert.strictEqual(esFacturaFiscal('FCC0001-00000790'), true);
  assert.strictEqual(esFacturaFiscal('FCX0008-00010294'), false);
});

console.log('\nRuta canónica /{localId}/Remitos:');
check('el número de local es el PRIMER segmento', () => {
  assert.strictEqual(rutaRemitos(ACHAVAL), '40508022/Remitos');
  assert.strictEqual(rutaRemito(ACHAVAL, 'FCX0008-00010294'), '40508022/Remitos/FCX0008-00010294');
  assert.strictEqual(rutaContadorRemitos(ACHAVAL), '40508022/CONTADORES/remitos');
});
check('nunca /Remitos global ni /Remitos/{localId}', () => {
  const r = rutaRemitos(ACHAVAL);
  assert.strictEqual(r.split('/')[0], ACHAVAL);
  assert.notStrictEqual(r, 'Remitos');
  assert.notStrictEqual(r, `${NODO_REMITOS}/${ACHAVAL}`);
});
check('sin local válido NO se construye ruta: se aborta', () => {
  for (const malo of [undefined, null, '', 'undefined', 'null', 0, 'default']) {
    assert.throws(() => rutaRemitos(malo), (e) => e.code === LOCAL_ID_REQUERIDO,
      `debería abortar con ${JSON.stringify(malo)}`);
  }
});
check('un remito sin número no tiene ruta', () => {
  assert.throws(() => rutaRemito(ACHAVAL, ''), /REMITO_SIN_NUMERO/);
});

console.log('\nEstructura del comprobante:');
const remito = construirRemitoDesdeVenta({
  venta: VENTA_MOSTRADOR, canal: 'mostrador',
  numeroComprobante: 'FCX0008-00010294', localId: ACHAVAL, emitidoEn: '2026-07-25T22:45:00.000Z',
});
check('guarda los datos mínimos pactados', () => {
  assert.strictEqual(remito.numeroComprobante, 'FCX0008-00010294');
  assert.strictEqual(remito.tipo, PREFIJO_REMITO);
  assert.strictEqual(remito.fecha, '25-07-2026');
  assert.strictEqual(remito.hora, '22:45:00');
  assert.strictEqual(remito.total, 5700);
  assert.strictEqual(remito.cliente, 'Consumidor Final');
  assert.strictEqual(remito.canal, 'mostrador');
  assert.strictEqual(remito.localId, ACHAVAL);
  assert.strictEqual(remito.facturado, false);
  assert.strictEqual(remito.formaPago, 'Efectivo + Débito');
});
check('referencia la venta de origen sin duplicarla', () => {
  assert.deepStrictEqual(remito.origen, { tipo: 'mostrador', id: '27', ruta: 'MOSTRADOR' });
});
check('conserva el detalle para poder reimprimirlo', () => {
  assert.strictEqual(Object.keys(remito.productos).length, 2);
  assert.strictEqual(remito.productos['1'].nombre, 'Milanesa');
  assert.strictEqual(remito.productos['1'].cantidad, 2);
  assert.strictEqual(remito.productos['1'].precioTotal, 3200);
  assert.ok(remito.productos['1'].selectedOptionals, 'perdió los opcionales');
  assert.strictEqual(remito.productos['2'].precioTotal, 2500);
});
check('no escribe undefined (Realtime Database los rechaza)', () => {
  const json = JSON.stringify(remito);
  assert.ok(!json.includes('undefined'), 'quedó un undefined serializado');
  const recorrer = (o) => {
    if (o && typeof o === 'object') for (const v of Object.values(o)) {
      assert.notStrictEqual(v, undefined);
      recorrer(v);
    }
  };
  recorrer(remito);
});
check('el remito nace SIEMPRE sin facturar', () => {
  assert.strictEqual(remito.facturado, false);
});
check('canal delivery apunta a PEDIDOS', () => {
  const r = construirRemitoDesdeVenta({
    venta: { id: 'D881', total: 9000, date: '25-07-2026', hora: '20:10:00',
      client: { name: 'Ana', address: 'Achaval 3703' }, payment: { total: 9000, method: 'Efectivo' }, items: [] },
    canal: 'delivery', numeroComprobante: 'FCX0008-00010295', localId: ACHAVAL,
  });
  assert.strictEqual(r.canal, 'delivery');
  assert.strictEqual(r.origen.ruta, 'PEDIDOS');
  assert.strictEqual(r.cliente, 'Ana');
  assert.strictEqual(r.direccion, 'Achaval 3703');
  assert.strictEqual(r.formaPago, 'Efectivo');
});
check('rechaza un remito sin local o con número que no es FCX', () => {
  assert.throws(() => construirRemitoDesdeVenta({
    venta: VENTA_MOSTRADOR, canal: 'mostrador', numeroComprobante: 'FCX0008-00010294', localId: null,
  }), /LOCAL_ID_REQUIRED/);
  assert.throws(() => construirRemitoDesdeVenta({
    venta: VENTA_MOSTRADOR, canal: 'mostrador', numeroComprobante: 'FCB0008-00010295', localId: ACHAVAL,
  }), /REMITO_NUMERO_INVALIDO/);
  assert.throws(() => construirRemitoDesdeVenta({
    venta: null, canal: 'mostrador', numeroComprobante: 'FCX0008-00010294', localId: ACHAVAL,
  }), /REMITO_SIN_VENTA/);
});

console.log('\nPagos e ítems:');
check('lee los pagos vengan como vengan', () => {
  assert.deepStrictEqual(listarPagos({ payments: [{ method: 'Efectivo', amount: 100 }] }),
    [{ metodo: 'Efectivo', importe: 100 }]);
  assert.deepStrictEqual(listarPagos({ payment: { payments: [{ method: 'MP', amount: 50 }] } }),
    [{ metodo: 'MP', importe: 50 }]);
  assert.deepStrictEqual(listarPagos({ payment: { method: 'Débito', total: 80 } }),
    [{ metodo: 'Débito', importe: 80 }]);
  assert.deepStrictEqual(listarPagos({}), []);
  assert.strictEqual(describirFormaPago([]), 'Sin especificar');
  assert.strictEqual(describirFormaPago([{ metodo: 'Efectivo' }, { metodo: 'Efectivo' }]), 'Efectivo');
});
check('los ítems quedan numerados 1..n aunque vengan como objeto', () => {
  const p = construirProductos({ a: { nombre: 'X', cantidad: 1, valor: 10 }, b: { nombre: 'Y', cantidad: 2, valor: 5 } });
  assert.deepStrictEqual(Object.keys(p), ['1', '2']);
  assert.strictEqual(p['2'].precioTotal, 10);
});
check('limpiarIndefinidos conserva 0, false, null y ""', () => {
  assert.deepStrictEqual(limpiarIndefinidos({ a: 0, b: false, c: null, d: '', e: undefined }),
    { a: 0, b: false, c: null, d: '' });
});

console.log('\nLectura para la pestaña Remitos:');
check('el registro canónico se muestra e imprime', () => {
  const fila = normalizarRemitoParaTabla('FCX0008-00010294', remito);
  assert.strictEqual(fila.numeroFactura, 'FCX0008-00010294');
  assert.strictEqual(fila.fecha, '25-07-2026');
  assert.strictEqual(fila.hora, '22:45:00');
  assert.strictEqual(fila.importe, 5700);
  assert.strictEqual(fila.modo, 'mostrador');
  assert.strictEqual(fila.articulos.length, 2);
  assert.strictEqual(fila.articulos[0].precioTotal, 3200);
  assert.strictEqual(fila.facturado, false);
});
check('un FCX histórico de VENTAS (claves en mayúscula) también se muestra', () => {
  const fila = normalizarRemitoParaTabla('FCX0001-00000053', {
    CLIENTE: 'Consumidor Final', FECHA: '15-08-2025', HORA: '13:09:08',
    IMPORTE: 1200, MODO: 'mostrador', NUMERO: 12, NumeroFactura: 'FCX0001-00000053', TURNO: 2,
  });
  assert.strictEqual(fila.numeroFactura, 'FCX0001-00000053');
  assert.strictEqual(fila.fecha, '15-08-2025');
  assert.strictEqual(fila.importe, 1200);
  assert.strictEqual(fila.modo, 'mostrador');
  assert.strictEqual(fila.articulos.length, 0);
});
check('un remito ya facturado no se lista (no se cuenta dos veces)', () => {
  const filas = filasDeRemitos({
    'FCX0008-00000001': { numeroComprobante: 'FCX0008-00000001', fecha: '25-07-2026', hora: '10:00:00', total: 100 },
    'FCX0008-00000002': { numeroComprobante: 'FCX0008-00000002', fecha: '25-07-2026', hora: '11:00:00', total: 200, facturado: true },
  });
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].numeroFactura, 'FCX0008-00000001');
  assert.deepStrictEqual(filasDeRemitos(null), []);
});
check('ordena del más nuevo al más viejo', () => {
  const filas = ordenarRemitos([
    { fecha: '14-08-2025', hora: '15:36:37' },
    { fecha: '16-08-2025', hora: '17:35:58' },
    { fecha: '15-08-2025', hora: '13:09:08' },
  ]);
  assert.deepStrictEqual(filas.map((f) => f.fecha), ['16-08-2025', '15-08-2025', '14-08-2025']);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
