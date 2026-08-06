// COLAS FISCALES — una cuenta fiscal distinta por cada FACTURACION_N.
//
// Todo lo que se prueba acá es GENÉRICO: los locales de los fixtures son sólo
// datos de entrada. Un local nuevo, con la misma estructura de configuración,
// se comporta igual sin tocar una línea de código — hay una prueba explícita
// para eso ("local nuevo, sin hardcode").
//
// Módulo puro → corre sin Firebase: node src/lib/api/__tests__/colasFiscales.test.js
import assert from 'node:assert';
import {
  COLAS_FISCALES,
  COLA_LEGADA,
  CUENTA_COBRO_POR_COLA,
  ESTADO,
  ETIQUETA_ESTADO,
  switchesDeCuentasCobro,
  claveOwnership,
  colaDeFirebasePath,
  cuentaCobroAlimentaCola,
  cuentaFiscalDeCola,
  detectarColasHuerfanas,
  emisorDeCuenta,
  esColaFiscal,
  identidadesFiscalesDuplicadas,
  indexarColasFiscales,
  listarCuentasFiscalesCrudas,
  localIdDeFirebasePath,
  radiografiaDeColas,
  validarCuentaFiscal,
} from '../colasFiscales.js';
import {
  COLAS_POR_CUENTA,
  cuentasFiscalesHabilitadas,
  decidirComprobante,
  elegirCuentaFiscalParaTildeManual,
  encoladoBloqueado,
  resolverEncolado,
} from '../facturaORemito.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

/** Cuenta fiscal COMPLETA. Los datos se pasan por parámetro: nada hardcodeado. */
const cuentaCompleta = (over = {}) => ({
  id: over.id || 'c1',
  nombre: over.nombre || 'Titular',
  cuit: over.cuit || '20111111111',
  cuitFormat: over.cuitFormat || '20-11111111-1',
  ptoVta: over.ptoVta || '1',
  razonSocial: over.razonSocial || 'TITULAR SA',
  fantasia: over.fantasia || 'EL COMERCIO',
  domicilio: over.domicilio || 'CALLE 123',
  condIVA: over.condIVA || 'Monotributista',
  inicioActividades: over.inicioActividades ?? '01/01/2025',
  iibb: over.iibb ?? '901-000000-0',
  certStoragePath: over.certStoragePath ?? 'facturacion/x/cert.crt',
  keyStoragePath: over.keyStoragePath ?? 'facturacion/x/clave.key',
  serviceAccountStoragePath: over.serviceAccountStoragePath ?? 'facturacion/x/sa.json',
  firebaseDb: over.firebaseDb ?? 'https://x-default-rtdb.firebaseio.com',
  firebasePath: over.firebasePath ?? '99999999/FACTURACION_1',
  firebaseHistorial: over.firebaseHistorial ?? '99999999/VENTAS',
  initialized: true,
  ...over,
});

console.log('\nVínculo cuenta de cobro → cola → cuenta fiscal:');

check('las nueve colas están declaradas', () => {
  assert.strictEqual(COLAS_FISCALES.length, 9);
  assert.strictEqual(COLAS_FISCALES[0], 'FACTURACION_1');
  assert.strictEqual(COLAS_FISCALES[8], 'FACTURACION_9');
});
check('la tabla cuenta de cobro ↔ cola es exactamente la acordada', () => {
  assert.deepStrictEqual(COLAS_POR_CUENTA, {
    'TRANSFERENCIA': 'FACTURACION_1',
    'TRANSFERENCIA 2': 'FACTURACION_2',
    'TRANSFERENCIA 3': 'FACTURACION_3',
    'MERCADO PAGO': 'FACTURACION_4',
    'CUENTA DNI': 'FACTURACION_5',
    'BANCO 1': 'FACTURACION_6',
    'BANCO 2': 'FACTURACION_7',
    'PREPAGO PEDIDOSYA': 'FACTURACION_1',
    'PREPAGO RAPPI': 'FACTURACION_9',
  });
  assert.strictEqual(CUENTA_COBRO_POR_COLA.FACTURACION_2, 'TRANSFERENCIA 2');
  assert.strictEqual(CUENTA_COBRO_POR_COLA.FACTURACION_9, 'PREPAGO RAPPI');
});
check('la coincidencia es EXACTA: "Transferencia 2" nunca cae en la de "Transferencia"', () => {
  assert.ok(cuentaCobroAlimentaCola('Transferencia', 'FACTURACION_1'));
  assert.ok(cuentaCobroAlimentaCola('  transferencia  2 ', 'FACTURACION_2'));
  assert.ok(!cuentaCobroAlimentaCola('Transferencia 2', 'FACTURACION_1'));
  assert.ok(!cuentaCobroAlimentaCola('Transferencia', 'FACTURACION_2'));
  // Nada de includes(): un nombre que CONTIENE otro no comparte cola.
  assert.ok(!cuentaCobroAlimentaCola('Transferencia Bancaria', 'FACTURACION_1'));
});
check('la cola sale del último segmento del firebasePath', () => {
  assert.strictEqual(colaDeFirebasePath('51501748/FACTURACION_1'), 'FACTURACION_1');
  assert.strictEqual(colaDeFirebasePath('/38827976/FACTURACION_3/'), 'FACTURACION_3');
  assert.strictEqual(colaDeFirebasePath('99999999/FACTURACION'), 'FACTURACION');
  assert.strictEqual(colaDeFirebasePath('51501748/VENTAS'), null);
  assert.strictEqual(colaDeFirebasePath(''), null);
  assert.strictEqual(colaDeFirebasePath('51501748/FACTURACION_10'), null);
});
check('el local sale del PRIMER segmento del firebasePath', () => {
  assert.strictEqual(localIdDeFirebasePath('51501748/FACTURACION_1'), '51501748');
  assert.strictEqual(localIdDeFirebasePath('FACTURACION_1'), null);
  assert.strictEqual(localIdDeFirebasePath(''), null);
});
check('esColaFiscal reconoce las nueve y la legada', () => {
  assert.ok(esColaFiscal('FACTURACION_5'));
  assert.ok(esColaFiscal(COLA_LEGADA));
  assert.ok(!esColaFiscal('FACTURACION_0'));
  assert.ok(!esColaFiscal('VENTAS'));
});

console.log('\nDos colas del mismo local con CUIT diferentes:');

// Local con TRES contribuyentes distintos, cada uno en su cola.
const LOCAL_TRES = {
  tipo: 'monotributo',
  monotributo: { cuentas: [
    cuentaCompleta({ id: 'a', cuit: '20111111111', cuitFormat: '20-11111111-1', ptoVta: '1', razonSocial: 'PRIMERO', firebasePath: '77777777/FACTURACION_1', firebaseHistorial: '77777777/VENTAS' }),
    cuentaCompleta({ id: 'b', cuit: '27222222222', cuitFormat: '27-22222222-2', ptoVta: '4', razonSocial: 'SEGUNDO', firebasePath: '77777777/FACTURACION_2', firebaseHistorial: '77777777/VENTAS' }),
    cuentaCompleta({ id: 'c', cuit: '20333333333', cuitFormat: '20-33333333-3', ptoVta: '2', razonSocial: 'TERCERO', firebasePath: '77777777/FACTURACION_3', firebaseHistorial: '77777777/VENTAS' }),
  ] },
};

check('cada cola resuelve SU propia cuenta fiscal', () => {
  const a = cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_1');
  const b = cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_2');
  const c = cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_3');
  assert.strictEqual(a.razonSocial, 'PRIMERO');
  assert.strictEqual(b.razonSocial, 'SEGUNDO');
  assert.strictEqual(c.razonSocial, 'TERCERO');
  assert.strictEqual(a.puntoVenta, '0001');
  assert.strictEqual(b.puntoVenta, '0004');
  assert.strictEqual(c.puntoVenta, '0002');
});
check('NUNCA se mezclan CUIT, punto de venta ni certificado entre colas', () => {
  const cuits = COLAS_FISCALES.slice(0, 3).map((k) => cuentaFiscalDeCola(LOCAL_TRES, k).cuit);
  assert.strictEqual(new Set(cuits).size, 3, 'las tres colas deben tener CUIT distintos');
  const pvs = COLAS_FISCALES.slice(0, 3).map((k) => cuentaFiscalDeCola(LOCAL_TRES, k).puntoVenta);
  assert.strictEqual(new Set(pvs).size, 3);
});
check('cada cola conoce la cuenta de COBRO que la alimenta', () => {
  assert.strictEqual(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_2').cuentaCobro, 'TRANSFERENCIA 2');
  assert.strictEqual(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_3').cuentaCobro, 'TRANSFERENCIA 3');
});
check('el emisor que se graba en la factura es el de SU cola', () => {
  const e = emisorDeCuenta(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_2'));
  assert.strictEqual(e.razonSocial, 'SEGUNDO');
  assert.strictEqual(e.cuitFormat, '27-22222222-2');
  assert.strictEqual(e.puntoVenta, '0004');
  assert.strictEqual(e.cbteTipo, 11);
  assert.strictEqual(e.letra, 'C');
  assert.strictEqual(e.cola, 'FACTURACION_2');
  assert.strictEqual(e.runtime, 'monotributo');
});
check('una cola sin cuenta fiscal no devuelve la de otra', () => {
  assert.strictEqual(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_7'), null);
});
check('responsable inscripto y monotributo conviven en el mismo local', () => {
  const mixto = {
    tipo: 'responsable_inscripto',
    ri: cuentaCompleta({ id: 'ri', cuit: '20999999999', ptoVta: '8', razonSocial: 'RI', condIVA: 'Responsable Inscripto', firebasePath: '88888888/FACTURACION_1' }),
    monotributo: { cuentas: [cuentaCompleta({ id: 'm', cuit: '27888888888', ptoVta: '3', razonSocial: 'MONO', firebasePath: '88888888/FACTURACION_2' })] },
  };
  assert.strictEqual(cuentaFiscalDeCola(mixto, 'FACTURACION_1').cbteTipo, 6);
  assert.strictEqual(cuentaFiscalDeCola(mixto, 'FACTURACION_1').letra, 'B');
  assert.strictEqual(cuentaFiscalDeCola(mixto, 'FACTURACION_1').runtime, 'responsable-inscripto');
  assert.strictEqual(cuentaFiscalDeCola(mixto, 'FACTURACION_2').cbteTipo, 11);
  assert.strictEqual(cuentaFiscalDeCola(mixto, 'FACTURACION_2').runtime, 'monotributo');
});
check('dos cuentas en la MISMA cola son un conflicto: no se elige ninguna', () => {
  const chocado = { tipo: 'monotributo', monotributo: { cuentas: [
    cuentaCompleta({ id: 'x', cuit: '20111111111', firebasePath: '77777777/FACTURACION_1' }),
    cuentaCompleta({ id: 'y', cuit: '27222222222', firebasePath: '77777777/FACTURACION_1' }),
  ] } };
  const { porCola, conflictos } = indexarColasFiscales(chocado);
  assert.strictEqual(porCola.get('FACTURACION_1'), undefined);
  assert.strictEqual(conflictos.length, 1);
  assert.strictEqual(conflictos[0].cola, 'FACTURACION_1');
});

console.log('\nValidación obligatoria antes de facturar:');

check('una cuenta completa está lista', () => {
  const v = validarCuentaFiscal(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_1'), { localId: '77777777' });
  assert.strictEqual(v.listo, true, v.faltantes.join(', '));
  assert.strictEqual(v.estado, ESTADO.LISTA);
});
check('sin certificado o sin clave: certificado-invalido y NO listo', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [cuentaCompleta({ certStoragePath: null, certDownloadUrl: null })] } };
  const v = validarCuentaFiscal(cuentaFiscalDeCola(cfg, 'FACTURACION_1'));
  assert.strictEqual(v.listo, false);
  assert.strictEqual(v.estado, ESTADO.CERTIFICADO_INVALIDO);
  assert.ok(v.mensaje.includes('certificado'));
});
check('sin punto de venta: punto-venta-no-configurado', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [cuentaCompleta({ ptoVta: '' })] } };
  const v = validarCuentaFiscal(cuentaFiscalDeCola(cfg, 'FACTURACION_1'));
  assert.strictEqual(v.listo, false);
  assert.strictEqual(v.estado, ESTADO.PUNTO_VENTA_FALTANTE);
});
check('faltan datos fiscales: configuracion-incompleta, y dice cuáles', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [cuentaCompleta({ cuit: '', razonSocial: '' })] } };
  const v = validarCuentaFiscal(cuentaFiscalDeCola(cfg, 'FACTURACION_1'));
  assert.strictEqual(v.estado, ESTADO.INCOMPLETA);
  assert.ok(v.faltantes.includes('CUIT'));
  assert.ok(v.faltantes.includes('Razón social'));
});
check('cola sin runtime activa BLOQUEA', () => {
  const v = validarCuentaFiscal(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_1'), { runtimeActiva: false });
  assert.strictEqual(v.listo, false);
  assert.strictEqual(v.estado, ESTADO.SIN_RUNTIME);
  assert.ok(v.mensaje.includes('motor de facturación'));
});
check('runtime desconocida (null) NO bloquea: es información de otra PC', () => {
  assert.strictEqual(validarCuentaFiscal(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_1'), { runtimeActiva: null }).listo, true);
});
check('una cola que apunta a OTRO local no puede facturar acá', () => {
  const v = validarCuentaFiscal(cuentaFiscalDeCola(LOCAL_TRES, 'FACTURACION_1'), { localId: '11111111' });
  assert.strictEqual(v.listo, false);
  assert.ok(v.faltantes.some((f) => f.includes('pertenece al local 77777777')));
});
check('inicio de actividades e Ingresos Brutos AVISAN pero no bloquean', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [cuentaCompleta({ inicioActividades: '', iibb: '' })] } };
  const v = validarCuentaFiscal(cuentaFiscalDeCola(cfg, 'FACTURACION_1'));
  assert.strictEqual(v.listo, true);
  assert.ok(v.avisos.some((a) => a.includes('Inicio de actividades')));
  assert.ok(v.avisos.some((a) => a.includes('Ingresos Brutos')));
});
check('una cola sin ninguna cuenta configurada no está lista', () => {
  const v = validarCuentaFiscal(null);
  assert.strictEqual(v.listo, false);
  assert.strictEqual(v.estado, ESTADO.NO_CONFIGURADA);
});

console.log('\nFactura o remito, con la cola correcta:');

// Cuentas SIN regla por medio de pago: acá se prueba el INTERRUPTOR.
// Transferencia 1/2/3, Efectivo y PedidosYa se rigen por la regla definitiva
// (ver facturaORemito.test.js) y por eso no se usan en este bloque.
const CUENTAS_COBRO = [
  { id: 'cta-1', nombre: 'Banco 1', imprimeFactura: false, isFavorite: true },
  { id: 'cta-2', nombre: 'Banco 2', imprimeFactura: true },
  { id: 'cta-3', nombre: 'Mercado Pago', imprimeFactura: false },
];
const venta = (pagos, extra = {}) => ({ total: pagos.reduce((s, p) => s + p.amount, 0), payments: pagos, ...extra });

check('imprimeFactura:false genera FCX AUNQUE la cuenta tenga cola asociada', () => {
  const d = decidirComprobante({ venta: venta([{ method: 'Banco 1', amount: 1000 }]), cuentas: CUENTAS_COBRO });
  assert.strictEqual(d.comprobante, 'REMITO');
  assert.strictEqual(resolverEncolado(d, CUENTAS_COBRO).estado, 'sin-factura');
});
check('imprimeFactura:true factura en SU cola', () => {
  const d = decidirComprobante({ venta: venta([{ method: 'Banco 2', amount: 1000 }]), cuentas: CUENTAS_COBRO });
  const e = resolverEncolado(d, CUENTAS_COBRO);
  assert.strictEqual(e.estado, 'encolar');
  assert.strictEqual(e.cola, 'FACTURACION_7');
  assert.strictEqual(e.total, 1000);
});
check('tilde manual usa una cuenta FISCAL, no la favorita de cobro', () => {
  // La favorita de este local es "Transferencia", pero tiene el switch APAGADO:
  // no puede facturar. La única habilitada es "Transferencia 2".
  const favorita = CUENTAS_COBRO.find((c) => c.isFavorite);
  assert.strictEqual(favorita.nombre, 'Banco 1');
  assert.strictEqual(favorita.imprimeFactura, false);

  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 800 }], { emiteFactura: true }), cuentas: CUENTAS_COBRO });
  const e = resolverEncolado(d, CUENTAS_COBRO);
  assert.strictEqual(d.comprobante, 'FACTURA');
  assert.strictEqual(e.cuenta, 'Banco 2');
  assert.strictEqual(e.cola, 'FACTURACION_7');
  assert.strictEqual(e.criterio, 'unica-cuenta-fiscal-habilitada');
});
check('pago combinado con una sola cuenta encendida: UNA factura por el TOTAL', () => {
  const d = decidirComprobante({
    venta: venta([{ method: 'Banco 1', amount: 600 }, { method: 'Banco 2', amount: 400 }]),
    cuentas: CUENTAS_COBRO,
  });
  const e = resolverEncolado(d, CUENTAS_COBRO);
  assert.strictEqual(d.comprobante, 'FACTURA');
  assert.strictEqual(e.cola, 'FACTURACION_7');
  assert.strictEqual(e.total, 1000, 'se factura el total completo, no la parte de esa cuenta');
});
check('todas las cuentas apagadas: UN solo FCX por el total', () => {
  const d = decidirComprobante({
    venta: venta([{ method: 'Banco 1', amount: 600 }, { method: 'Mercado Pago', amount: 400 }]),
    cuentas: CUENTAS_COBRO,
  });
  assert.strictEqual(d.comprobante, 'REMITO');
  assert.strictEqual(d.total, 1000);
});
check('varias encendidas sin favorita entre ellas: BLOQUEA, no elige a dedo', () => {
  const cuentas = [
    { nombre: 'Transferencia 2', imprimeFactura: true },
    { nombre: 'Transferencia 3', imprimeFactura: true },
    { nombre: 'Transferencia', imprimeFactura: false, isFavorite: true },
  ];
  const d = decidirComprobante({ venta: venta([{ method: 'Transferencia 2', amount: 500 }, { method: 'Transferencia 3', amount: 500 }]), cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(e.estado, 'ambiguo');
});
check('tilde manual sin cuenta favorita: BLOQUEA, no cae a remito', () => {
  const cuentas = [{ nombre: 'Mercado Pago', imprimeFactura: false }];
  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 500 }], { emiteFactura: true }), cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(d.comprobante, 'FACTURA', 'el tilde manual manda: NO es un remito');
  assert.strictEqual(e.estado, 'sin-cola');
});

console.log('\nCuenta de COBRO no fiscal vs cuenta FISCAL habilitada:');

// Caso real de Centenario / Il Capo: la plata se transfiere a esa persona pero
// esas ventas NO se facturan. "Transferencia 2" es incluso la FAVORITA.
const CUENTAS_NO_FISCAL = [
  { id: 'cta-1', nombre: 'Banco 1', imprimeFactura: true },
  { id: 'cta-2', nombre: 'Mercado Pago', imprimeFactura: false, isFavorite: true },
];
// El local NO tiene ningún contribuyente en FACTURACION_4 (Mercado Pago), y está bien así.
const CONFIG_SIN_F4 = {
  tipo: 'monotributo',
  monotributo: { cuentas: [cuentaCompleta({ id: 'unica', razonSocial: 'LA QUE FACTURA', firebasePath: '77777777/FACTURACION_6' })] },
};
const SWITCHES_NO_FISCAL = switchesDeCuentasCobro(CUENTAS_NO_FISCAL);

check('cuenta sin regla con imprimeFactura:false genera FCX', () => {
  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 12000 }]), cuentas: CUENTAS_NO_FISCAL });
  assert.strictEqual(d.comprobante, 'REMITO');
  assert.strictEqual(d.total, 12000);
  assert.strictEqual(resolverEncolado(d, CUENTAS_NO_FISCAL).estado, 'sin-factura', 'no se resuelve ninguna cola');
});
check('ser la cuenta FAVORITA no cambia el resultado con el switch apagado', () => {
  const favorita = CUENTAS_NO_FISCAL.find((c) => c.isFavorite);
  assert.strictEqual(favorita.nombre, 'Mercado Pago');
  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 500 }]), cuentas: CUENTAS_NO_FISCAL });
  assert.strictEqual(d.comprobante, 'REMITO');
});
check('sin regla por nombre, el switch sigue decidiendo en los dos sentidos', () => {
  // Mismo nombre, switch al revés: el resultado se invierte. Vale para las
  // cuentas SIN regla; las que tienen regla facturan siempre (a propósito).
  const encendida = [{ nombre: 'Mercado Pago', imprimeFactura: true }];
  const apagada = [{ nombre: 'Mercado Pago', imprimeFactura: false }];
  const v = venta([{ method: 'Mercado Pago', amount: 100 }]);
  assert.strictEqual(decidirComprobante({ venta: v, cuentas: encendida }).comprobante, 'FACTURA');
  assert.strictEqual(decidirComprobante({ venta: v, cuentas: apagada }).comprobante, 'REMITO');
});
check('una cuenta apagada NO exige CUIT, certificado ni runtime', () => {
  const v = validarCuentaFiscal(cuentaFiscalDeCola(CONFIG_SIN_F4, 'FACTURACION_4'), { imprimeFactura: false });
  assert.strictEqual(v.estado, ESTADO.NO_FACTURA);
  assert.strictEqual(v.esError, false, 'no es un error de configuración');
  assert.strictEqual(v.noFactura, true);
  assert.deepStrictEqual(v.faltantes, [], 'no puede reclamar ningún dato fiscal');
  assert.strictEqual(v.mensaje, null);
});
check('el panel la muestra como "No factura — genera remito"', () => {
  const r = radiografiaDeColas({ config: CONFIG_SIN_F4, localId: '77777777', switchesCuentaCobro: SWITCHES_NO_FISCAL });
  const f2 = r.colas.find((c) => c.cola === 'FACTURACION_4');
  assert.strictEqual(f2.estado, ESTADO.NO_FACTURA);
  assert.strictEqual(ETIQUETA_ESTADO[f2.estado], 'No factura — genera remito');
  assert.strictEqual(f2.esError, false);
  assert.strictEqual(r.conErrores.length, 0, 'no puede haber ningún error');
  assert.strictEqual(r.noFacturan.length, 1);
});
check('NO aparece como cola huérfana aunque tenga pendientes históricos', () => {
  const viejo = Date.now() - 78 * 86400000;
  const pend = { FACTURACION_4: { n: 584, masViejoMs: viejo, masNuevoMs: viejo } };
  assert.deepStrictEqual(
    detectarColasHuerfanas({ config: CONFIG_SIN_F4, pendientesPorCola: pend, switchesCuentaCobro: SWITCHES_NO_FISCAL }),
    []
  );
  const r = radiografiaDeColas({ config: CONFIG_SIN_F4, pendientesPorCola: pend, switchesCuentaCobro: SWITCHES_NO_FISCAL });
  const f2 = r.colas.find((c) => c.cola === 'FACTURACION_4');
  assert.strictEqual(f2.huerfana, false);
  assert.strictEqual(f2.pendientesHistoricos, 584, 'se informan, pero como históricos');
  assert.strictEqual(r.huerfanas.length, 0);
});
check('SÍ se reporta si una cola apagada sigue recibiendo ventas nuevas', () => {
  // Eso ya no es histórico: es un error real de código enviándolas ahí.
  const pend = { FACTURACION_4: { n: 585, masViejoMs: Date.now() - 78 * 86400000, masNuevoMs: Date.now() } };
  const h = detectarColasHuerfanas({ config: CONFIG_SIN_F4, pendientesPorCola: pend, switchesCuentaCobro: SWITCHES_NO_FISCAL });
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].recibiendoNuevas, true);
  assert.ok(h[0].motivo.includes('SIGUE recibiendo ventas nuevas'), h[0].motivo);
  assert.ok(h[0].motivo.includes('versión anterior'), 'debe explicar la causa más probable');
});
check('una cuenta con imprimeFactura:true SÍ exige configuración fiscal', () => {
  const switches = switchesDeCuentasCobro([{ nombre: 'Mercado Pago', imprimeFactura: true }]);
  const r = radiografiaDeColas({ config: CONFIG_SIN_F4, localId: '77777777', switchesCuentaCobro: switches });
  const f2 = r.colas.find((c) => c.cola === 'FACTURACION_4');
  assert.strictEqual(f2.estado, ESTADO.NO_CONFIGURADA);
  assert.strictEqual(f2.esError, true);
  assert.strictEqual(f2.listo, false);
});

console.log('\nTilde manual: la favorita de COBRO no sirve para facturar:');

check('con la favorita apagada, el tilde manual usa otra cuenta FISCAL', () => {
  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 900 }], { emiteFactura: true }), cuentas: CUENTAS_NO_FISCAL });
  const e = resolverEncolado(d, CUENTAS_NO_FISCAL);
  assert.strictEqual(d.comprobante, 'FACTURA', 'el usuario pidió factura: no puede salir un remito');
  assert.strictEqual(e.estado, 'encolar');
  assert.strictEqual(e.cuenta, 'Banco 1', 'la única con el switch encendido');
  assert.strictEqual(e.cola, 'FACTURACION_6');
  assert.notStrictEqual(e.cola, 'FACTURACION_4', 'jamás a la cola de la cuenta que no factura');
  assert.strictEqual(e.criterio, 'unica-cuenta-fiscal-habilitada');
});
check('la favorita se usa sólo si además es fiscal', () => {
  const cuentas = [
    { nombre: 'Transferencia', imprimeFactura: true },
    { nombre: 'Transferencia 3', imprimeFactura: true, isFavorite: true },
  ];
  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 300 }], { emiteFactura: true }), cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(e.cuenta, 'Transferencia 3');
  assert.strictEqual(e.criterio, 'cuenta-fiscal-favorita');
});
check('sin NINGUNA cuenta fiscal habilitada, el tilde manual BLOQUEA', () => {
  const cuentas = [
    { nombre: 'Banco 2', imprimeFactura: false, isFavorite: true },
    { nombre: 'Mercado Pago', imprimeFactura: false },
  ];
  const d = decidirComprobante({ venta: venta([{ method: 'Banco 2', amount: 700 }], { emiteFactura: true }), cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(d.comprobante, 'FACTURA');
  assert.strictEqual(e.estado, 'sin-cola');
  assert.ok(e.motivo.includes('No hay una cuenta fiscal habilitada'), e.motivo);
  assert.ok(encoladoBloqueado(e), 'tiene que bloquear, no generar remito');
});
check('varias fiscales y ninguna favorita: pide elegir, no adivina', () => {
  const cuentas = [
    { nombre: 'Transferencia', imprimeFactura: true },
    { nombre: 'Transferencia 3', imprimeFactura: true },
    { nombre: 'Transferencia 2', imprimeFactura: false, isFavorite: true },
  ];
  const d = decidirComprobante({ venta: venta([{ method: 'Mercado Pago', amount: 400 }], { emiteFactura: true }), cuentas });
  const e = resolverEncolado(d, cuentas);
  assert.strictEqual(e.estado, 'ambiguo');
  assert.strictEqual(e.cuentas.length, 2);
});
check('elegirCuentaFiscalParaTildeManual ignora la favorita no fiscal', () => {
  assert.strictEqual(elegirCuentaFiscalParaTildeManual(CUENTAS_NO_FISCAL).cuenta.nombre, 'Banco 1');
  assert.strictEqual(elegirCuentaFiscalParaTildeManual([{ nombre: 'X', imprimeFactura: false }]).estado, 'sin-cuenta-fiscal');
  assert.deepStrictEqual(cuentasFiscalesHabilitadas(CUENTAS_NO_FISCAL).map((c) => c.nombre), ['Banco 1']);
});

console.log('\nColas huérfanas (genérico, cualquier local):');

check('cola con pendientes y SIN cuenta fiscal es huérfana', () => {
  const h = detectarColasHuerfanas({
    config: LOCAL_TRES,
    pendientesPorCola: { FACTURACION_7: { n: 238, masViejoMs: Date.now() - 90 * 86400000 } },
  });
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].cola, 'FACTURACION_7');
  assert.strictEqual(h[0].pendientes, 238);
  assert.strictEqual(h[0].cuentaCobro, 'BANCO 2');
  assert.ok(h[0].antiguedadDias >= 89);
});
check('cola con pendientes y cuenta COMPLETA no es huérfana', () => {
  const h = detectarColasHuerfanas({ config: LOCAL_TRES, pendientesPorCola: { FACTURACION_1: { n: 5 } } });
  assert.strictEqual(h.length, 0);
});
check('cola con pendientes cuya runtime no corre SÍ es huérfana', () => {
  const h = detectarColasHuerfanas({
    config: LOCAL_TRES,
    pendientesPorCola: { FACTURACION_1: { n: 584 } },
    runtimesActivas: { FACTURACION_1: false },
  });
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].estado, ESTADO.SIN_RUNTIME);
  assert.strictEqual(h[0].razonSocial, 'PRIMERO');
  assert.strictEqual(h[0].runtimeEsperada, 'monotributo');
});
check('una cola vacía nunca es huérfana', () => {
  assert.strictEqual(detectarColasHuerfanas({ config: LOCAL_TRES, pendientesPorCola: { FACTURACION_9: { n: 0 } } }).length, 0);
});

console.log('\nRadiografía de las nueve colas:');

check('informa las nueve colas más la legada', () => {
  const r = radiografiaDeColas({ config: LOCAL_TRES, localId: '77777777' });
  assert.strictEqual(r.colas.length, 10);
  assert.strictEqual(r.configuradas, 3);
  assert.strictEqual(r.listas, 3);
});
check('marca huérfana sólo la cola con plata esperando', () => {
  const r = radiografiaDeColas({
    config: LOCAL_TRES, localId: '77777777',
    pendientesPorCola: { FACTURACION_5: { n: 12 }, FACTURACION_1: { n: 3 } },
  });
  assert.deepStrictEqual(r.huerfanas.map((c) => c.cola), ['FACTURACION_5']);
});
check('detecta dos cuentas con el MISMO CUIT y punto de venta', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [
    cuentaCompleta({ id: 'a', cuit: '20111111111', ptoVta: '1', firebasePath: '77777777/FACTURACION_1' }),
    cuentaCompleta({ id: 'b', cuit: '20111111111', ptoVta: '1', firebasePath: '77777777/FACTURACION_2' }),
  ] } };
  const dup = identidadesFiscalesDuplicadas(cfg);
  assert.strictEqual(dup.length, 1);
  assert.deepStrictEqual(dup[0].colas.sort(), ['FACTURACION_1', 'FACTURACION_2']);
  assert.strictEqual(radiografiaDeColas({ config: cfg }).identidadesDuplicadas.length, 1);
});
check('la clave de ownership es {cuit}_{ptoVta}', () => {
  assert.strictEqual(claveOwnership('20-11111111-1', '0001'), '20-11111111-1_0001');
  assert.strictEqual(claveOwnership('20111111111', 1), '20111111111_1');
});

console.log('\nLocal NUEVO, sin una línea de código:');

check('un local que nadie conoce funciona igual con sólo cargar su configuración', () => {
  const LOCAL_NUEVO = {
    tipo: 'monotributo',
    monotributo: { cuentas: [
      cuentaCompleta({
        id: 'nuevo-1', cuit: '23444444449', cuitFormat: '23-44444444-9', ptoVta: '6',
        razonSocial: 'HELADERIA NUEVA SRL', fantasia: 'NUEVA', domicilio: 'AV NUEVA 1',
        firebasePath: '12345678/FACTURACION_4', firebaseHistorial: '12345678/VENTAS',
      }),
    ] },
  };
  const c = cuentaFiscalDeCola(LOCAL_NUEVO, 'FACTURACION_4');
  assert.strictEqual(c.razonSocial, 'HELADERIA NUEVA SRL');
  assert.strictEqual(c.puntoVenta, '0006');
  assert.strictEqual(c.cuentaCobro, 'MERCADO PAGO', 'la cola 4 se alimenta de Mercado Pago');
  assert.strictEqual(c.localIdDeclarado, '12345678');
  const v = validarCuentaFiscal(c, { localId: '12345678' });
  assert.strictEqual(v.listo, true, v.faltantes.join(', '));
  // Y no se contamina con ningún otro local.
  assert.strictEqual(cuentaFiscalDeCola(LOCAL_NUEVO, 'FACTURACION_1'), null);
});
check('la configuración vacía no rompe ni inventa cuentas', () => {
  assert.deepStrictEqual(listarCuentasFiscalesCrudas(null), []);
  assert.deepStrictEqual(listarCuentasFiscalesCrudas({}), []);
  assert.strictEqual(radiografiaDeColas({ config: null }).configuradas, 0);
});
check('las filas en blanco del formulario no se cuentan como cuentas', () => {
  const cfg = { tipo: 'monotributo', monotributo: { cuentas: [
    { id: 'vacia', cuit: '', ptoVta: '', razonSocial: '', condIVA: 'Monotributista' },
    cuentaCompleta({ id: 'real', firebasePath: '77777777/FACTURACION_1' }),
  ] } };
  assert.strictEqual(listarCuentasFiscalesCrudas(cfg).length, 1);
});
check('la fila en blanco de RI con firebasePath precargado NO bloquea la cola real', () => {
  // Caso real: el formulario deja `ri` vacío pero con firebasePath apuntando a
  // FACTURACION_1. Si se lo contara como cuenta, chocaría con la cuenta de
  // monotributo que sí factura ahí y el local quedaría sin poder facturar.
  const cfg = {
    tipo: 'monotributo',
    ri: { id: 'ri', cuit: '', ptoVta: '', razonSocial: '', initialized: false,
          condIVA: 'Responsable Inscripto', firebasePath: '77777777/FACTURACION_1',
          firebaseHistorial: '77777777/VENTAS', firebaseDb: 'https://x-default-rtdb.firebaseio.com' },
    monotributo: { cuentas: [cuentaCompleta({ id: 'real', razonSocial: 'LA QUE FACTURA', firebasePath: '77777777/FACTURACION_1' })] },
  };
  const { porCola, conflictos } = indexarColasFiscales(cfg);
  assert.strictEqual(conflictos.length, 0, 'una fila en blanco no genera conflicto');
  assert.strictEqual(porCola.get('FACTURACION_1').razonSocial, 'LA QUE FACTURA');
  assert.strictEqual(validarCuentaFiscal(porCola.get('FACTURACION_1'), { localId: '77777777' }).listo, true);
});

console.log(`\n${passed} verificaciones OK`);
