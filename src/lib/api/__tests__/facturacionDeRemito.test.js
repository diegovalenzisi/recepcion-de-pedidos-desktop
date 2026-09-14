// Facturar un remito FCX a posteriori: validaciones, payload, estados y el
// vínculo de vuelta con la factura emitida.
// Módulo puro → corre sin Firebase: node src/lib/api/__tests__/facturacionDeRemito.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolverCuentaDeAliasFavorito } from '../facturaORemito.js';
import {
  ESTADO_ERROR,
  ESTADO_FACTURADO,
  ESTADO_PENDIENTE,
  ESTADO_SIN_FACTURAR,
  ORIGEN_REMITO,
  buscarFacturaDelRemito,
  buscarFacturasDelRemito,
  claveEnCola,
  claveIdempotencia,
  conciliarConFacturaEmitida,
  construirPayloadFacturacion,
  construirProductosParaFactura,
  describirEstadoFacturacion,
  esClaveDeFactura,
  estadoFacturacion,
  marcaDeAlerta,
  marcaDeError,
  marcaDeFacturado,
  marcaDePendiente,
  puedeFacturarse,
  textoConfirmacion,
  tieneCaeValido,
  validarRemitoParaFacturar,
} from '../facturacionDeRemito.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const ACHAVAL = '40508022';
const NUMERO = 'FCX0008-00000048';

/** Un remito tal cual lo guarda construirRemitoDesdeVenta(). */
const remito = (extra = {}) => ({
  numeroComprobante: NUMERO,
  tipo: 'FCX',
  fecha: '25-07-2026',
  hora: '22:45:00',
  turno: 3,
  total: 16200,
  cliente: 'Ana Gómez',
  direccion: 'Achaval 3703',
  canal: 'delivery',
  localId: ACHAVAL,
  facturado: false,
  formaPago: 'Efectivo + Transferencia',
  pagos: { 0: { metodo: 'Efectivo', importe: 10000 }, 1: { metodo: 'Transferencia', importe: 6200 } },
  productos: {
    1: {
      nombre: 'Milanesa', cantidad: 2, precioUnitario: 1500, precioTotal: 3200,
      totalOpcionales: 200, codigo: '156A',
      selectedOptionals: { g1: [{ nombre: 'Queso', total: 200, cantidad: 1 }] },
    },
    2: { nombre: 'Gaseosa', cantidad: 1, precioUnitario: 13000, precioTotal: 13000 },
  },
  origen: { tipo: 'delivery', id: '881', ruta: 'PEDIDOS' },
  ...extra,
});

console.log('\nEstado del remito:');
check('un remito recién emitido está SIN_FACTURAR y se puede facturar', () => {
  assert.strictEqual(estadoFacturacion(remito()), ESTADO_SIN_FACTURAR);
  assert.strictEqual(puedeFacturarse(remito()), true);
});
check('remitos viejos sin el campo también se pueden facturar', () => {
  const viejo = remito();
  delete viejo.estadoFacturacion;
  assert.strictEqual(estadoFacturacion(viejo), ESTADO_SIN_FACTURAR);
  assert.strictEqual(puedeFacturarse(viejo), true);
});
check('PENDIENTE bloquea el botón', () => {
  const r = remito({ estadoFacturacion: ESTADO_PENDIENTE });
  assert.strictEqual(estadoFacturacion(r), ESTADO_PENDIENTE);
  assert.strictEqual(puedeFacturarse(r), false);
});
check('FACTURADO bloquea el botón, por el estado o por facturado:true', () => {
  assert.strictEqual(puedeFacturarse(remito({ estadoFacturacion: ESTADO_FACTURADO })), false);
  assert.strictEqual(puedeFacturarse(remito({ facturado: true })), false);
  assert.strictEqual(estadoFacturacion(remito({ facturado: true })), ESTADO_FACTURADO);
});
check('ERROR se puede reintentar: no se emitió nada', () => {
  const r = remito({ estadoFacturacion: ESTADO_ERROR, errorFacturacion: 'AFIP no respondió' });
  assert.strictEqual(puedeFacturarse(r), true);
});
check('los textos del listado', () => {
  assert.strictEqual(describirEstadoFacturacion(remito()), 'Sin facturar');
  assert.strictEqual(describirEstadoFacturacion(remito({ estadoFacturacion: ESTADO_PENDIENTE })), 'Procesando factura…');
  assert.strictEqual(describirEstadoFacturacion(remito({ estadoFacturacion: ESTADO_ERROR })), 'Error al facturar');
  assert.strictEqual(
    describirEstadoFacturacion(remito({ facturado: true, numeroFactura: 'FCB0008-00010300' })),
    'Facturado como FCB0008-00010300'
  );
});
check('la confirmación dice que no descuenta stock ni registra caja', () => {
  const t = textoConfirmacion(NUMERO);
  assert.ok(t.titulo.includes(NUMERO));
  assert.ok(/total completo/i.test(t.descripcion));
  assert.ok(/no volverá a descontar stock ni registrar la venta en caja/i.test(t.descripcion));
  assert.strictEqual(t.confirmar, 'Facturar');
  assert.strictEqual(t.cancelar, 'Cancelar');
});

console.log('\nValidación antes de encolar:');
check('acepta un remito sano', () => {
  assert.strictEqual(validarRemitoParaFacturar(remito(), NUMERO).ok, true);
});
check('rechaza uno inexistente', () => {
  const v = validarRemitoParaFacturar(null, NUMERO);
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivo.includes('no existe'));
});
check('rechaza lo que no sea tipo FCX', () => {
  const v = validarRemitoParaFacturar(remito({ tipo: 'FCB' }), NUMERO);
  assert.strictEqual(v.ok, false);
  assert.ok(/no es un remito/.test(v.motivo));
});
check('rechaza un número que no es de remito', () => {
  const v = validarRemitoParaFacturar(remito({ numeroComprobante: 'FCB0008-00000001' }), 'FCB0008-00000001');
  assert.strictEqual(v.ok, false);
});
check('rechaza uno ya facturado, diciendo con qué factura', () => {
  const v = validarRemitoParaFacturar(remito({ facturado: true, numeroFactura: 'FCB0008-00010300' }), NUMERO);
  assert.strictEqual(v.ok, false);
  assert.ok(v.motivo.includes('FCB0008-00010300'));
});
check('rechaza uno con facturación en curso', () => {
  const v = validarRemitoParaFacturar(remito({ estadoFacturacion: ESTADO_PENDIENTE }), NUMERO);
  assert.strictEqual(v.ok, false);
  assert.ok(/en curso/.test(v.motivo));
});
check('rechaza totales inválidos', () => {
  for (const total of [0, -100, null, undefined, 'abc']) {
    assert.strictEqual(validarRemitoParaFacturar(remito({ total }), NUMERO).ok, false, `aceptó total=${total}`);
  }
});
check('rechaza uno sin productos', () => {
  assert.strictEqual(validarRemitoParaFacturar(remito({ productos: {} }), NUMERO).ok, false);
  assert.strictEqual(validarRemitoParaFacturar(remito({ productos: null }), NUMERO).ok, false);
});

console.log('\nIdempotencia:');
check('la clave es localId + número de FCX', () => {
  assert.strictEqual(claveIdempotencia(ACHAVAL, NUMERO), '40508022:FCX0008-00000048');
});
check('dos locales distintos con el mismo número no colisionan', () => {
  assert.notStrictEqual(claveIdempotencia(ACHAVAL, NUMERO), claveIdempotencia('38827976', NUMERO));
});
check('la clave en la cola es determinista: reencolar PISA, no duplica', () => {
  assert.strictEqual(claveEnCola(NUMERO), 'RFCX0008-00000048');
  assert.strictEqual(claveEnCola(NUMERO), claveEnCola(NUMERO));
  assert.ok(!/[.#$[\]/]/.test(claveEnCola(NUMERO)), 'la clave tiene caracteres prohibidos por RTDB');
});

console.log('\nProductos: exactamente los del remito:');
check('mismos nombres, cantidades, precios y opcionales', () => {
  const p = construirProductosParaFactura(remito().productos);
  assert.deepStrictEqual(Object.keys(p), ['producto_1', 'producto_2']);
  assert.strictEqual(p.producto_1.nombre, '2x Milanesa');
  assert.strictEqual(p.producto_1.valor, 3200, 'no usó el importe de la línea');
  assert.strictEqual(p.producto_1.cantidad, 2);
  assert.strictEqual(p.producto_1.precioUnitario, 1500);
  assert.deepStrictEqual(p.producto_1.opcionales, { g1: [{ nombre: 'Queso', total: 200, cantidad: 1 }] });
  assert.strictEqual(p.producto_1.codigo, '156A');
  assert.strictEqual(p.producto_2.nombre, 'Gaseosa', 'una unidad no lleva prefijo de cantidad');
  assert.strictEqual(p.producto_2.valor, 13000);
});
check('la suma de las líneas es el total del remito', () => {
  const p = construirProductosParaFactura(remito().productos);
  assert.strictEqual(Object.values(p).reduce((s, l) => s + l.valor, 0), remito().total);
});
check('respeta el orden de las líneas', () => {
  const p = construirProductosParaFactura({ 10: { nombre: 'C' }, 2: { nombre: 'B' }, 1: { nombre: 'A' } });
  assert.deepStrictEqual(Object.values(p).map((l) => l.nombre), ['A', 'B', 'C']);
});
check('una línea corrupta no rompe el resto', () => {
  const p = construirProductosParaFactura({ 1: null, 2: { nombre: 'Ok', precioTotal: 500 } });
  assert.deepStrictEqual(Object.keys(p), ['producto_1']);
  assert.strictEqual(p.producto_1.nombre, 'Ok');
});

console.log('\nPayload que se encola:');
const payload = construirPayloadFacturacion({
  remito: remito(), localId: ACHAVAL, cola: 'FACTURACION_1', solicitadoPor: 'pc-1', ahora: '2026-07-26T20:00:00.000Z',
});
check('conserva la forma que el motor ya sabe leer', () => {
  for (const k of ['clientes', 'direccion', 'producto', 'fecha', 'hora', 'total']) {
    assert.ok(k in payload, `falta ${k}`);
  }
  assert.strictEqual(payload.clientes, 'Ana Gómez');
  assert.strictEqual(payload.direccion, 'Achaval 3703');
  assert.strictEqual(payload.fecha, '25-07-2026');
});
check('el importe es el TOTAL COMPLETO del remito', () => {
  assert.strictEqual(payload.total, 16200);
});
check('lleva la referencia inequívoca al remito', () => {
  assert.strictEqual(payload.origen, ORIGEN_REMITO);
  assert.strictEqual(payload.remitoId, NUMERO);
  assert.strictEqual(payload.forzarFactura, true);
  assert.strictEqual(payload.idempotencyKey, '40508022:FCX0008-00000048');
  assert.strictEqual(payload.localId, ACHAVAL);
  assert.strictEqual(payload.colaFacturacion, 'FACTURACION_1');
});
check('la forma de pago viaja como referencia, no como instrucción', () => {
  assert.strictEqual(payload.formaPagoOriginal, 'Efectivo + Transferencia');
});
check('cliente por defecto cuando el remito no lo tiene', () => {
  const p = construirPayloadFacturacion({ remito: remito({ cliente: null, direccion: null }), localId: ACHAVAL, cola: 'FACTURACION_1' });
  assert.strictEqual(p.clientes, 'Consumidor Final');
  assert.strictEqual(p.direccion, 'Sin Datos');
});
check('no lleva ningún undefined (RTDB los rechaza)', () => {
  assert.ok(Object.values(payload).every((v) => v !== undefined));
});
check('NO pide anular nada: no hay nota de crédito en el payload', () => {
  const texto = JSON.stringify(payload).toLowerCase();
  for (const prohibido of ['notacredito', 'nota_credito', 'nota de credito', '"nc"', 'anular', 'anulacion']) {
    assert.ok(!texto.includes(prohibido), `el payload menciona "${prohibido}"`);
  }
});

console.log('\nCampos técnicos del remito:');
check('la marca de pendiente deja el candado y la cola', () => {
  const m = marcaDePendiente({ cola: 'FACTURACION_1', deviceId: 'pc-1', ahora: '2026-07-26T20:00:00.000Z' });
  assert.strictEqual(m.estadoFacturacion, ESTADO_PENDIENTE);
  assert.strictEqual(m.facturacionSolicitadaEn, '2026-07-26T20:00:00.000Z');
  assert.strictEqual(m.facturacionSolicitadaPor, 'pc-1');
  assert.strictEqual(m.colaFacturacion, 'FACTURACION_1');
  assert.strictEqual(m.errorFacturacion, null, 'un reintento debe limpiar el error anterior');
});
check('la marca de error deja el remito reintentable y sin facturar', () => {
  const m = marcaDeError('AFIP rechazó el comprobante');
  assert.strictEqual(m.facturado, false);
  assert.strictEqual(m.estadoFacturacion, ESTADO_ERROR);
  assert.strictEqual(m.errorFacturacion, 'AFIP rechazó el comprobante');
  assert.strictEqual(puedeFacturarse({ ...remito(), ...m }), true);
});
check('la marca de facturado trae número, tipo, CAE y fecha', () => {
  const m = marcaDeFacturado('FCB0008-00010300', { CAE: '75123456789012', VtoCAE: '20260805' }, '2026-07-26T20:05:00.000Z');
  assert.strictEqual(m.facturado, true);
  assert.strictEqual(m.estadoFacturacion, ESTADO_FACTURADO);
  assert.strictEqual(m.numeroFactura, 'FCB0008-00010300');
  assert.strictEqual(m.tipoFactura, 'FCB');
  assert.strictEqual(m.cae, '75123456789012');
  assert.strictEqual(m.vencimientoCae, '20260805');
  assert.strictEqual(m.fechaFacturacion, '2026-07-26T20:05:00.000Z');
  assert.strictEqual(m.errorFacturacion, null);
});
check('monotributo: el tipo sale FCC y el CAE viene en CAE_VTO', () => {
  const m = marcaDeFacturado('FCC0001-00000123', { CAE: '99', CAE_VTO: '20260810' });
  assert.strictEqual(m.tipoFactura, 'FCC');
  assert.strictEqual(m.vencimientoCae, '20260810');
});
check('la marca de facturado no borra ni modifica el remito original', () => {
  const m = marcaDeFacturado('FCB0008-00010300', {});
  for (const campo of ['total', 'productos', 'pagos', 'turno', 'fecha', 'origen', 'numeroComprobante', 'tipo']) {
    assert.ok(!(campo in m), `la marca pisaría ${campo}`);
  }
});

console.log('\nVínculo de vuelta con la factura emitida:');
const VENTAS = {
  'FCB0008-00010299': { CLIENTE: 'Otro', TOTAL: 5000, CAE: '111' },
  'FCB0008-00010300': { CLIENTE: 'Ana Gómez', TOTAL: 16200, CAE: '75123456789012', VtoCAE: '20260805', remitoId: NUMERO, origen: 'REMITO' },
  'FCX0008-00000049': { total: 1 },
};
check('reconoce las claves fiscales y descarta las que no lo son', () => {
  assert.strictEqual(esClaveDeFactura('FCB0008-00010300'), true);
  assert.strictEqual(esClaveDeFactura('FCC0001-00000123'), true);
  assert.strictEqual(esClaveDeFactura('FCX0008-00000049'), false);
});
check('encuentra la factura por remitoId, no por importe ni fecha', () => {
  const hallada = buscarFacturaDelRemito(VENTAS, NUMERO);
  assert.strictEqual(hallada.clave, 'FCB0008-00010300');
  assert.strictEqual(hallada.registro.CAE, '75123456789012');
});
check('no confunde con otro remito', () => {
  assert.strictEqual(buscarFacturaDelRemito(VENTAS, 'FCX0008-00000099'), null);
  assert.strictEqual(buscarFacturaDelRemito({}, NUMERO), null);
});
check('pendiente + factura encontrada → FACTURADO con su número', () => {
  const r = conciliarConFacturaEmitida({
    remito: remito({ estadoFacturacion: ESTADO_PENDIENTE }), ventas: VENTAS, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'facturado');
  assert.strictEqual(r.marca.numeroFactura, 'FCB0008-00010300');
  assert.strictEqual(r.marca.cae, '75123456789012');
});
check('pendiente y todavía en la cola → esperar, sin tocar nada', () => {
  const r = conciliarConFacturaEmitida({
    remito: remito({ estadoFacturacion: ESTADO_PENDIENTE }), ventas: {}, sigueEnCola: true,
  });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.marca, undefined);
});
check('salió de la cola sin factura todavía → SIGUE ESPERANDO (no es error)', () => {
  // Antes esto marcaba ERROR y se veía "Error al facturar" en una operación que
  // terminaba bien segundos después. El motor guarda la factura y recién
  // después borra el pedido: hay un instante sin pedido y sin factura visible.
  const r = conciliarConFacturaEmitida({
    remito: remito({ estadoFacturacion: ESTADO_PENDIENTE }), ventas: {}, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.motivo, 'emitiendose');
});
check('un rechazo REAL del motor sí reabre para reintentar', () => {
  const r = conciliarConFacturaEmitida({
    remito: remito({ estadoFacturacion: ESTADO_PENDIENTE }), ventas: {}, sigueEnCola: true,
    errorDelMotor: 'AFIP rechazó: CUIT inválido',
  });
  assert.strictEqual(r.accion, 'reabrir');
  assert.strictEqual(r.marca.estadoFacturacion, ESTADO_ERROR);
  assert.strictEqual(r.marca.facturado, false);
  assert.strictEqual(r.marca.errorFacturacion, 'AFIP rechazó: CUIT inválido');
  assert.strictEqual(puedeFacturarse({ ...remito(), ...r.marca }), true);
});
check('sin facturar o ya facturado no se reconcilia', () => {
  for (const estado of [undefined, ESTADO_FACTURADO]) {
    const r = conciliarConFacturaEmitida({ remito: remito({ estadoFacturacion: estado }), ventas: VENTAS, sigueEnCola: false });
    assert.strictEqual(r.accion, 'esperar', `reconcilió estando en ${estado}`);
  }
});
check('un remito en ERROR SÍ se revisa: puede tener su factura emitida', () => {
  const r = conciliarConFacturaEmitida({
    remito: remito({ estadoFacturacion: ESTADO_ERROR }), ventas: VENTAS, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'facturado', 'un CAE confirmado tiene que reparar el estado');
});

console.log('\nEl módulo no anula ni emite notas de crédito:');
check('no hay ninguna referencia a NC en el código', () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const fuente = fs.readFileSync(path.join(aqui, '../facturacionDeRemito.js'), 'utf8');
  const codigo = fuente.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
  for (const prohibido of ['notacredito', 'nota_credito', 'notadecredito', 'anular', 'fcnc', "'nc'"]) {
    assert.ok(!codigo.includes(prohibido), `el código menciona "${prohibido}"`);
  }
});
check('no puede tocar stock, caja ni nada más: no habla con Firebase', () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const fuente = fs.readFileSync(path.join(aqui, '../facturacionDeRemito.js'), 'utf8');
  const codigo = fuente.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/from ['"]firebase/.test(codigo), 'importa Firebase');
  for (const escritura of ['set(', 'update(', 'push(', 'remove(', 'runTransaction(']) {
    assert.ok(!codigo.includes(escritura), `el módulo escribe: ${escritura}`);
  }
  // Y no nombra ningún nodo operativo: no hay por dónde tocarlos.
  for (const nodo of ['CAJAS', 'ESTADISTICAS', 'MATERIAPRIMA', 'RESUMEN_CUENTA', 'MOSTRADOR', 'PEDIDOS']) {
    assert.ok(!codigo.includes(nodo), `el código nombra el nodo ${nodo}`);
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));

// ---------------------------------------------------------------------------
// COLA DEL REMITO: sale de la cuenta asociada al ALIAS DESTACADO del local.
// La resolución es la MISMA función pura que usa PedidosYa prepago, así que las
// dos rutas no pueden divergir. Acá se prueba la resolución; la lectura de
// /{localId}/ALIAS la hace facturacionDeRemitoApi.
// ---------------------------------------------------------------------------
console.log('\nRemito → cola por el alias destacado:');

const CUENTAS_ALIAS = {
  'cta-1': { nombre: 'Transferencia', alias: 'HELADERIA.ACHAVAL' },
  'cta-2': { nombre: 'Transferencia 2', alias: 'HELA.LANYULINA.LANUS' },
  'cta-3': { nombre: 'Transferencia 3', alias: 'MONICA.MP' },
  'cta-4': { nombre: 'PREPAGO RAPPI', alias: 'RAPPI' },
};

check('alias de Transferencia → FACTURACION_1', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'HELADERIA.ACHAVAL', cuentas: CUENTAS_ALIAS });
  assert.strictEqual(r.estado, 'ok');
  assert.strictEqual(r.cola, 'FACTURACION_1');
});
check('alias de Transferencia 2 → FACTURACION_2', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'HELA.LANYULINA.LANUS', cuentas: CUENTAS_ALIAS });
  assert.strictEqual(r.cola, 'FACTURACION_2');
});
check('alias de Transferencia 3 → FACTURACION_3', () => {
  const r = resolverCuentaDeAliasFavorito({ alias: 'MONICA.MP', cuentas: CUENTAS_ALIAS });
  assert.strictEqual(r.cola, 'FACTURACION_3');
});
check('alias inválido → NO resuelve, y el remito no se toca', () => {
  for (const [alias, esperado] of [
    [null, 'sin-alias'], ['', 'sin-alias'],
    ['NO.EXISTE', 'sin-cuenta'], ['RAPPI', 'cuenta-sin-cola'],
  ]) {
    const r = resolverCuentaDeAliasFavorito({ alias, cuentas: CUENTAS_ALIAS });
    assert.strictEqual(r.estado, esperado, `alias ${JSON.stringify(alias)}`);
    // Nunca "ok": la API lanza y el remito queda intacto. En `cuenta-sin-cola`
    // el campo `cola` viaja sólo como diagnóstico (la cola rechazada), y jamás
    // es una de las válidas.
    assert.notStrictEqual(r.estado, 'ok');
    assert.ok(!['FACTURACION_1', 'FACTURACION_2', 'FACTURACION_3'].includes(r.cola),
      `no puede resolver a una cola válida (dio ${r.cola})`);
  }
});
check('dos cuentas con el mismo alias → ambiguo, no elige', () => {
  const dup = { ...CUENTAS_ALIAS, 'cta-9': { nombre: 'Transferencia 2', alias: 'HELADERIA.ACHAVAL' } };
  const r = resolverCuentaDeAliasFavorito({ alias: 'HELADERIA.ACHAVAL', cuentas: dup });
  assert.strictEqual(r.estado, 'alias-ambiguo');
});

// ---------------------------------------------------------------------------
// DEMORA ≠ ERROR.  Sólo un rechazo REAL del motor marca ERROR.
// ---------------------------------------------------------------------------
console.log('\nConciliación: la demora nunca es un error:');

const remitoPendiente = () => ({
  numeroComprobante: 'FCX0008-00000745',
  estadoFacturacion: 'PENDIENTE',
  colaFacturacion: 'FACTURACION_1',
});

check('CAE confirmado → FACTURADO', () => {
  const ventas = {
    'FCC0008-00010334': { remitoId: 'FCX0008-00000745', CAE: '75123456789012', numeroFactura: '0008-00010334' },
  };
  const r = conciliarConFacturaEmitida({ remito: remitoPendiente(), ventas, sigueEnCola: false });
  assert.strictEqual(r.accion, 'facturado');
  assert.strictEqual(r.marca.estadoFacturacion, 'FACTURADO');
});

check('sigue en la cola y sin factura → ESPERAR (no error)', () => {
  const r = conciliarConFacturaEmitida({ remito: remitoPendiente(), ventas: {}, sigueEnCola: true });
  assert.strictEqual(r.accion, 'esperar');
});

check('YA NO está en la cola pero la factura todavía no aparece → ESPERAR', () => {
  // Éste es el caso que antes marcaba "Error al facturar": el motor guarda la
  // factura y recién después borra el pedido, así que hay un instante en que no
  // está en ninguno de los dos lados. Es una carrera, no una falla.
  const r = conciliarConFacturaEmitida({ remito: remitoPendiente(), ventas: {}, sigueEnCola: false });
  assert.strictEqual(r.accion, 'esperar', 'una demora no puede marcar ERROR');
  assert.strictEqual(r.motivo, 'emitiendose');
});

check('rechazo REAL del motor → ERROR con el mensaje exacto', () => {
  const r = conciliarConFacturaEmitida({
    remito: remitoPendiente(), ventas: {}, sigueEnCola: true,
    errorDelMotor: 'CUIT del receptor inválido (10015)',
  });
  assert.strictEqual(r.accion, 'reabrir');
  assert.strictEqual(r.marca.estadoFacturacion, 'ERROR');
  assert.strictEqual(r.marca.errorFacturacion, 'CUIT del receptor inválido (10015)');
});

check('el CAE manda incluso si el motor había dejado un error de un intento previo', () => {
  const ventas = {
    'FCC0008-00010335': { remitoId: 'FCX0008-00000745', CAE: '75999999999999', numeroFactura: '0008-00010335' },
  };
  const r = conciliarConFacturaEmitida({
    remito: remitoPendiente(), ventas, sigueEnCola: true, errorDelMotor: 'error viejo',
  });
  assert.strictEqual(r.accion, 'facturado');
});

check('sin factura, cada estado espera por su propio motivo', () => {
  const motivos = { SIN_FACTURAR: 'no-esta-pendiente', FACTURADO: 'ya-facturado', ERROR: 'error-sin-factura' };
  for (const [estado, motivo] of Object.entries(motivos)) {
    const r = conciliarConFacturaEmitida({
      remito: { ...remitoPendiente(), estadoFacturacion: estado },
      ventas: {}, sigueEnCola: false, errorDelMotor: 'lo que sea',
    });
    assert.strictEqual(r.accion, 'esperar', estado);
    assert.strictEqual(r.motivo, motivo, estado);
  }
});

check('el texto visible mientras espera dice que está procesando, no pendiente', () => {
  assert.strictEqual(describirEstadoFacturacion(remitoPendiente()), 'Procesando factura…');
});

check('mientras PROCESANDO o FACTURADO el botón queda deshabilitado', () => {
  assert.strictEqual(puedeFacturarse(remitoPendiente()), false);
  assert.strictEqual(puedeFacturarse({ estadoFacturacion: 'FACTURADO' }), false);
  assert.strictEqual(puedeFacturarse({ estadoFacturacion: 'ERROR' }), true, 'un error real sí se puede reintentar');
  assert.strictEqual(puedeFacturarse({ estadoFacturacion: 'SIN_FACTURAR' }), true);
});

// ---------------------------------------------------------------------------
// UN CAE CONFIRMADO GANA SOBRE CUALQUIER ERROR ANTERIOR.
// Es lo que repara solos los remitos que quedaron mal marcados en ERROR.
// ---------------------------------------------------------------------------
console.log('\nAuto-reparación de remitos marcados en ERROR por error:');

// Caso REAL de Achaval: el remito quedó en ERROR con el mensaje de la versión
// anterior, pero su factura existe y tiene CAE.
const remitoRoto = () => remito({
  numeroComprobante: 'FCX0008-00000749',
  estadoFacturacion: ESTADO_ERROR,
  errorFacturacion: 'La solicitud salió de la cola sin generar factura. Se puede reintentar.',
  errorAt: 1785000000000,
  facturado: false,
  total: 5500,
});
const ventasConFactura = {
  'FCB0008-00010337': { remitoId: 'FCX0008-00000749', origen: 'REMITO', CAE: '86317021234567', total: 5500 },
};

check('remito en ERROR con factura emitida → se corrige a FACTURADO', () => {
  const r = conciliarConFacturaEmitida({ remito: remitoRoto(), ventas: ventasConFactura, sigueEnCola: false });
  assert.strictEqual(r.accion, 'facturado');
  assert.strictEqual(r.marca.estadoFacturacion, ESTADO_FACTURADO);
  assert.strictEqual(r.marca.facturado, true);
  assert.strictEqual(r.marca.numeroFactura, 'FCB0008-00010337');
  assert.strictEqual(r.marca.cae, '86317021234567');
});

check('al corregirlo se BORRA el error anterior', () => {
  const r = conciliarConFacturaEmitida({ remito: remitoRoto(), ventas: ventasConFactura, sigueEnCola: false });
  assert.strictEqual(r.marca.errorFacturacion, null);
  assert.strictEqual(r.marca.errorAt, null);
  assert.ok(r.marca.facturadoAt > 0, 'debe registrar cuándo quedó facturado');
  // El remito resultante ya no se puede volver a facturar.
  assert.strictEqual(puedeFacturarse({ ...remitoRoto(), ...r.marca }), false);
});

check('el CAE gana aunque el motor haya dejado un error actual', () => {
  const r = conciliarConFacturaEmitida({
    remito: remitoRoto(), ventas: ventasConFactura, sigueEnCola: true, errorDelMotor: 'ARCA rechazó',
  });
  assert.strictEqual(r.accion, 'facturado', 'una factura confirmada manda sobre cualquier error');
});

check('remito en ERROR SIN factura se queda como está, para reintentar', () => {
  const r = conciliarConFacturaEmitida({ remito: remitoRoto(), ventas: {}, sigueEnCola: false });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.motivo, 'error-sin-factura');
});

check('un remito YA facturado no se vuelve a tocar', () => {
  const r = conciliarConFacturaEmitida({
    remito: remito({ facturado: true, estadoFacturacion: ESTADO_FACTURADO }),
    ventas: ventasConFactura, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.motivo, 'ya-facturado');
});

check('reintentar limpia el intento anterior antes de encolar', () => {
  const m = marcaDePendiente({ cola: 'FACTURACION_1', deviceId: 'pc-1' });
  assert.strictEqual(m.estadoFacturacion, ESTADO_PENDIENTE);
  assert.strictEqual(m.errorFacturacion, null, 'un error viejo no puede sobrevivir al reintento');
  assert.strictEqual(m.errorAt, null);
  assert.strictEqual(m.facturado, false);
  assert.strictEqual(m.numeroFactura, null);
  assert.strictEqual(m.cae, null);
});

check('marcaDeError deja constancia de cuándo falló', () => {
  const m = marcaDeError('ARCA rechazó: CUIT inválido');
  assert.strictEqual(m.estadoFacturacion, ESTADO_ERROR);
  assert.strictEqual(m.errorFacturacion, 'ARCA rechazó: CUIT inválido');
  assert.ok(m.errorAt > 0, 'debe registrar el momento del error');
});

check('el vínculo es por remitoId exacto, nunca por importe ni hora', () => {
  // Dos facturas del mismo importe: sólo puede ganar la del remitoId correcto.
  const ventas = {
    'FCB0008-00010336': { remitoId: 'FCX0008-00000752', CAE: 'aaa', total: 5500 },
    'FCB0008-00010337': { remitoId: 'FCX0008-00000749', CAE: 'bbb', total: 5500 },
  };
  const f = buscarFacturaDelRemito(ventas, 'FCX0008-00000749');
  assert.strictEqual(f.clave, 'FCB0008-00010337');
  assert.strictEqual(f.registro.CAE, 'bbb');
});

// ---------------------------------------------------------------------------
// RECONCILIACIÓN DETERMINÍSTICA POR remitoId — sin heurística de ventana.
//
// `ventas` acá representa lo que ya trae RECORTADO el rango de claves de la
// cuenta fiscal (ver rangoDeClavesDeCuenta en comprobanteFiscal.js): estas
// pruebas verifican que, dado ESE conjunto, la búsqueda y el desempate de
// ambigüedad no dependen de cuántas entradas haya, de en qué posición esté la
// coincidencia, ni de cuántas cuentas compartan prefijo — porque el filtrado
// por rango ya lo hizo la capa de Firebase antes de llegar acá.
// ---------------------------------------------------------------------------
console.log('\nbuscarFacturasDelRemito / conciliarConFacturaEmitida — ambigüedad por remitoId:');

check('encuentra la coincidencia sin importar la posición entre más de 100 entradas', () => {
  const ventas = {};
  for (let i = 1; i <= 150; i += 1) {
    ventas[`FCC0001-${String(i).padStart(8, '0')}`] = { CAE: `x${i}`, total: 1000 };
  }
  // La coincidencia real va temprano en el objeto, "enterrada" bajo 149 más.
  ventas['FCC0001-00000003'] = { CAE: 'real', total: 4000, remitoId: 'FCX0009-00000001' };
  const encontradas = buscarFacturasDelRemito(ventas, 'FCX0009-00000001');
  assert.strictEqual(encontradas.length, 1);
  assert.strictEqual(encontradas[0].clave, 'FCC0001-00000003');
});

check('no depende de cuántas cuentas compartan el mismo prefijo de clave', () => {
  // Dos remitos distintos, dos cuentas distintas, MISMO prefijo FCC0001- (caso
  // real de IL CAPO: cuatro cuentas fiscales con el mismo punto de venta).
  const ventas = {
    'FCC0001-00000010': { CAE: 'a', total: 1000, remitoId: 'FCX0009-00000010' },
    'FCC0001-00000011': { CAE: 'b', total: 2000, remitoId: 'FCX0009-00000011' },
  };
  assert.strictEqual(buscarFacturasDelRemito(ventas, 'FCX0009-00000010')[0].clave, 'FCC0001-00000010');
  assert.strictEqual(buscarFacturasDelRemito(ventas, 'FCX0009-00000011')[0].clave, 'FCC0001-00000011');
});

check('las claves heredadas FCX nunca matchean (no son factura)', () => {
  const ventas = {
    'FCX0001-00000001': { CLIENTE: 'Viejo', IMPORTE: 500, remitoId: 'FCX0009-00000099' }, // dato corrupto hipotético
    'FCC0002-00000050': { CAE: 'real', total: 500, remitoId: 'FCX0009-00000099' },
  };
  const encontradas = buscarFacturasDelRemito(ventas, 'FCX0009-00000099');
  assert.strictEqual(encontradas.length, 1, 'la clave FCX no debe contarse como factura aunque tenga el remitoId');
  assert.strictEqual(encontradas[0].clave, 'FCC0002-00000050');
});

check('tieneCaeValido distingue un CAE real de uno vacío', () => {
  assert.strictEqual(tieneCaeValido({ CAE: '86372882161169' }), true);
  assert.strictEqual(tieneCaeValido({ cae: '1' }), true);
  assert.strictEqual(tieneCaeValido({ CAE: '' }), false);
  assert.strictEqual(tieneCaeValido({ CAE: null }), false);
  assert.strictEqual(tieneCaeValido({}), false);
});

check('UNA coincidencia con CAE válido → FACTURADO', () => {
  const ventas = { 'FCC0001-00000005': { CAE: '123', total: 4000, remitoId: 'FCX0009-00000002' } };
  const r = conciliarConFacturaEmitida({
    remito: { numeroComprobante: 'FCX0009-00000002', estadoFacturacion: ESTADO_PENDIENTE },
    ventas, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'facturado');
  assert.strictEqual(r.marca.numeroFactura, 'FCC0001-00000005');
});

check('CERO coincidencias en el rango → esperar, sin marcar nada', () => {
  const r = conciliarConFacturaEmitida({
    remito: { numeroComprobante: 'FCX0009-00000003', estadoFacturacion: ESTADO_PENDIENTE },
    ventas: {}, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual(r.marca, undefined);
});

check('una coincidencia SIN CAE (factura a medio escribir) cuenta como demora, no como hallazgo', () => {
  const ventas = { 'FCC0001-00000006': { total: 4000, remitoId: 'FCX0009-00000004' } }; // sin CAE
  const r = conciliarConFacturaEmitida({
    remito: { numeroComprobante: 'FCX0009-00000004', estadoFacturacion: ESTADO_PENDIENTE },
    ventas, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'esperar', 'sin CAE no se puede dar por facturado');
});

check('DOS coincidencias con CAE para el mismo remitoId → alerta, no elige ninguna', () => {
  const ventas = {
    'FCC0001-00000301': { CAE: 'dup-1', total: 7000, remitoId: 'FCX0009-00000005' },
    'FCC0001-00000302': { CAE: 'dup-2', total: 7000, remitoId: 'FCX0009-00000005' },
  };
  const r = conciliarConFacturaEmitida({
    remito: { numeroComprobante: 'FCX0009-00000005', estadoFacturacion: ESTADO_PENDIENTE },
    ventas, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'alerta');
  assert.deepStrictEqual(r.marca.conciliacionAlertaClaves.sort(), ['FCC0001-00000301', 'FCC0001-00000302']);
  // NO toca estadoFacturacion: el remito sigue PENDIENTE (botón bloqueado),
  // nunca ERROR (que permitiría reintentar y generar una TERCERA factura).
  assert.strictEqual('estadoFacturacion' in r.marca, false);
});

check('marcaDeAlerta no incluye ninguna de las claves si no hay coincidencias', () => {
  assert.deepStrictEqual(marcaDeAlerta([]).conciliacionAlertaClaves, []);
});

check('un CAE de una NO gana sobre la ambigüedad de la otra: dos con CAE siguen siendo alerta', () => {
  // Caso más realista: de dos coincidencias por remitoId, ambas terminaron
  // con CAE (dos facturas realmente emitidas). No hay forma de saber cuál es
  // la "buena": las dos cuentan para la alerta.
  const ventas = {
    'FCC0001-00000401': { CAE: 'real-1', total: 9000, remitoId: 'FCX0009-00000006' },
    'FCC0002-00000401': { CAE: 'real-2', total: 9000, remitoId: 'FCX0009-00000006' },
  };
  const r = conciliarConFacturaEmitida({
    remito: { numeroComprobante: 'FCX0009-00000006', estadoFacturacion: ESTADO_PENDIENTE },
    ventas, sigueEnCola: false,
  });
  assert.strictEqual(r.accion, 'alerta');
  assert.strictEqual(r.marca.conciliacionAlertaClaves.length, 2);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
