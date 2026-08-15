// PREPAGO M.PAGO — el tercer prepago, de punta a punta.
//
// Replica el patrón exacto de PREPAGO PEDIDOSYA y PREPAGO RAPPI: no tiene cola
// fiscal propia, factura por la cuenta que se le asocia
// (`cuentaFacturacionAsociadaId`), y participa de Reportes Prepago como una
// plataforma más.
//
// Estas pruebas recorren el circuito completo con las MISMAS funciones que usa
// producción, y verifican en cada paso que PedidosYa y Rappi no cambiaron.
//
// Correr con: node src/lib/api/__tests__/prepagoMPago.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  decidirComprobante,
  resolverEncolado,
  plataformaDeCuenta,
  colaFiscalDeCuenta,
  cuentasAsociablesParaFacturacion,
  validarAsociacionPlataforma,
  COMPROBANTE_FACTURA,
} from '../facturaORemito.js';
import { PLATAFORMAS, ETIQUETA_PLATAFORMA, normalizarPlataforma, esMedioDeApp } from '../ventasApps.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

/** Local con las tres transferencias y los TRES prepagos, cada uno con su cuenta. */
const CUENTAS = {
  'cta-1':  { nombre: 'Transferencia',     imprimeFactura: true },
  'cta-2':  { nombre: 'Transferencia 2',   imprimeFactura: true },
  'cta-3':  { nombre: 'Transferencia 3',   imprimeFactura: true },
  'cta-py': { nombre: 'PREPAGO PEDIDOSYA', cuentaFacturacionAsociadaId: 'cta-1' },
  'cta-ra': { nombre: 'PREPAGO RAPPI',     cuentaFacturacionAsociadaId: 'cta-2' },
  'cta-mp': { nombre: 'PREPAGO M.PAGO',    cuentaFacturacionAsociadaId: 'cta-3' },
};

/** Venta de MOSTRADOR: el total va en la raíz y los pagos en `payments`. */
const ventaMostrador = (metodo, importe = 10000) =>
  ({ total: importe, payments: [{ method: metodo, amount: importe }] });

/** Venta de DELIVERY: el importe vive SOLO en `payment.total`. */
const ventaDelivery = (metodo, importe = 10000) =>
  ({ status: { main: 'ENTREGADO' }, payment: { method: metodo, total: importe, amount: importe } });

const encolar = (venta, cuentas = CUENTAS) =>
  resolverEncolado(decidirComprobante({ venta, cuentas }), cuentas);

/**
 * Reproduce la derivación de la clave del nodo de prepago tal cual la hacen
 * `savePrepaymentForApp` (desde el appType) y `fetchPrepayments` (desde el
 * nombre visible de la pestaña). El punto NO es un carácter válido en una clave
 * de Realtime Database, así que "PREPAGO M.PAGO" tiene que quedar en
 * PREPAGO_MPAGO por los dos caminos.
 */
const claveDePrepago = (n) => String(n ?? '').replace(/[.$#[\]/]/g, '');
const claveAlGuardar = (appType) => claveDePrepago(`PREPAGO_${appType.toUpperCase()}`);
const claveAlLeer = (pestana) => claveDePrepago(pestana.replace(' ', '_'));

// ---------------------------------------------------------------------------
console.log('\n1. La cuenta aparece y se reconoce como plataforma:');

check('PREPAGO M.PAGO se reconoce como plataforma (muestra el desplegable)', () => {
  assert.strictEqual(plataformaDeCuenta('PREPAGO M.PAGO'), 'MPAGO_PREPAGO');
  // Y las otras dos siguen igual.
  assert.strictEqual(plataformaDeCuenta('PREPAGO PEDIDOSYA'), 'PEDIDOSYA_PREPAGO');
  assert.strictEqual(plataformaDeCuenta('PREPAGO RAPPI'), 'RAPPI_PREPAGO');
});

check('NO tiene cola fiscal propia: la saca de su cuenta asociada', () => {
  assert.strictEqual(colaFiscalDeCuenta('PREPAGO M.PAGO'), null);
  assert.strictEqual(colaFiscalDeCuenta('PREPAGO PEDIDOSYA'), null);
  assert.strictEqual(colaFiscalDeCuenta('PREPAGO RAPPI'), null);
});

check('la cuenta "Mercado Pago" NO se ve afectada: sigue con FACTURACION_6', () => {
  assert.strictEqual(colaFiscalDeCuenta('Mercado Pago'), 'FACTURACION_6');
  assert.strictEqual(plataformaDeCuenta('Mercado Pago'), null, 'no es un prepago de app');
});

// ---------------------------------------------------------------------------
console.log('\n2. La asociación se guarda y sobrevive a recargar:');

check('el desplegable ofrece SOLO transferencias, nunca otra plataforma', () => {
  const ids = cuentasAsociablesParaFacturacion(Object.entries(CUENTAS).map(([id, c]) => ({ id, ...c })))
    .map((o) => o.id);
  assert.deepStrictEqual(ids.sort(), ['cta-1', 'cta-2', 'cta-3']);
});

check('validarAsociacionPlataforma acepta una transferencia para M.PAGO', () => {
  const v = validarAsociacionPlataforma({ plataformaId: 'cta-mp', asociadaId: 'cta-3', cuentas: CUENTAS });
  assert.strictEqual(v.ok, true, v.motivo);
});

check('rechaza asociarla a sí misma, a otra plataforma o a algo inexistente', () => {
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-mp', asociadaId: 'cta-mp', cuentas: CUENTAS }).ok, false);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-mp', asociadaId: 'cta-py', cuentas: CUENTAS }).ok, false);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-mp', asociadaId: 'cta-999', cuentas: CUENTAS }).ok, false);
  assert.strictEqual(validarAsociacionPlataforma({ plataformaId: 'cta-mp', asociadaId: '', cuentas: CUENTAS }).ok, false);
});

check('la asociación persiste al releer: la resolución da lo mismo', () => {
  // `saveAccount` hace un PUT del objeto completo (solo saca `id`) y
  // `fetchAccounts` devuelve el nodo con `id: clave`. O sea, ida y vuelta sin
  // pérdida: se simula ese viaje y se comprueba que resuelve igual.
  const guardado = { ...CUENTAS['cta-mp'] };            // lo que se manda al PUT
  const releido = { 'cta-mp': { ...guardado } };         // lo que vuelve del GET
  const cuentas = { ...CUENTAS, ...releido };
  assert.strictEqual(cuentas['cta-mp'].cuentaFacturacionAsociadaId, 'cta-3');
  assert.strictEqual(encolar(ventaMostrador('PREPAGO M.PAGO'), cuentas).cola, 'FACTURACION_3');
});

// ---------------------------------------------------------------------------
console.log('\n3-4. Mostrador y Delivery usan SU cuenta asociada:');

for (const [canal, hacerVenta] of [['MOSTRADOR', ventaMostrador], ['DELIVERY', ventaDelivery]]) {
  check(`${canal}: PREPAGO M.PAGO → FACTURACION_3 (su asociada), por el total`, () => {
    const e = encolar(hacerVenta('PREPAGO M.PAGO', 12500));
    assert.strictEqual(e.estado, 'encolar');
    assert.strictEqual(e.cola, 'FACTURACION_3');
    assert.strictEqual(e.total, 12500);
    assert.strictEqual(e.cuentaAsociadaId, 'cta-3');
  });

  check(`${canal}: PEDIDOSYA y RAPPI NO cambian`, () => {
    assert.strictEqual(encolar(hacerVenta('PREPAGO PEDIDOSYA')).cola, 'FACTURACION_1');
    assert.strictEqual(encolar(hacerVenta('PREPAGO RAPPI')).cola, 'FACTURACION_2');
  });

  check(`${canal}: M.PAGO escribe en PREPAGO_MPAGO`, () => {
    // Es lo que pasan counterApi (mostrador) y NewOrderModal (delivery).
    assert.strictEqual(claveAlGuardar('MPAGO'), 'PREPAGO_MPAGO');
    // Y las otras dos siguen escribiendo donde siempre.
    assert.strictEqual(claveAlGuardar('PEDIDOSYA'), 'PREPAGO_PEDIDOSYA');
    assert.strictEqual(claveAlGuardar('RAPPI'), 'PREPAGO_RAPPI');
  });
}

check('M.PAGO sin cuenta asociada: se DETIENE, no cae a otra cola ni a remito', () => {
  const sin = { ...CUENTAS, 'cta-mp': { nombre: 'PREPAGO M.PAGO' } };
  const d = decidirComprobante({ venta: ventaMostrador('PREPAGO M.PAGO'), cuentas: sin });
  assert.strictEqual(d.comprobante, COMPROBANTE_FACTURA);
  const e = resolverEncolado(d, sin);
  assert.strictEqual(e.estado, 'sin-cola');
  assert.strictEqual(e.cola, undefined);
  assert.match(e.motivo, /M\.PAGO/);
  // Mismo comportamiento que ya tenían las otras dos.
  const sinPy = { ...CUENTAS, 'cta-py': { nombre: 'PREPAGO PEDIDOSYA' } };
  assert.strictEqual(resolverEncolado(decidirComprobante({ venta: ventaMostrador('PREPAGO PEDIDOSYA'), cuentas: sinPy }), sinPy).estado, 'sin-cola');
});

check('combinado Efectivo + PREPAGO M.PAGO: una entrada, por el TOTAL', () => {
  const venta = {
    status: { main: 'ENTREGADO' },
    payment: { method: 'Pago Dividido', total: 20000, payments: [
      { method: 'Efectivo', amount: 6000 }, { method: 'PREPAGO M.PAGO', amount: 14000 },
    ] },
  };
  const e = encolar(venta);
  assert.strictEqual(e.cola, 'FACTURACION_3');
  assert.strictEqual(e.total, 20000, 'el total completo, no solo la parte de la app');
});

// ---------------------------------------------------------------------------
console.log('\n5. Reportes Prepago lee exactamente PREPAGO_MPAGO:');

check('la pestaña "PREPAGO M.PAGO" resuelve al nodo PREPAGO_MPAGO', () => {
  assert.strictEqual(claveAlLeer('PREPAGO M.PAGO'), 'PREPAGO_MPAGO', 'el punto es ilegal en una clave RTDB');
  // Guardar y leer tienen que apuntar al MISMO nodo.
  assert.strictEqual(claveAlLeer('PREPAGO M.PAGO'), claveAlGuardar('MPAGO'));
});

check('las pestañas de PEDIDOSYA y RAPPI apuntan al mismo nodo de siempre', () => {
  assert.strictEqual(claveAlLeer('PREPAGO PEDIDOSYA'), 'PREPAGO_PEDIDOSYA');
  assert.strictEqual(claveAlLeer('PREPAGO RAPPI'), 'PREPAGO_RAPPI');
});

check('M.PAGO es una plataforma más del reporte, con su etiqueta', () => {
  assert.deepStrictEqual(PLATAFORMAS, ['PEDIDOSYA', 'RAPPI', 'MPAGO']);
  assert.strictEqual(ETIQUETA_PLATAFORMA.MPAGO, 'M.PAGO');
});

check('cada medio se contabiliza SOLO en su plataforma', () => {
  assert.strictEqual(normalizarPlataforma('PREPAGO M.PAGO'), 'MPAGO');
  assert.strictEqual(normalizarPlataforma('PREPAGO PEDIDOSYA'), 'PEDIDOSYA');
  assert.strictEqual(normalizarPlataforma('PREPAGO RAPPI'), 'RAPPI');
  // Y lo que no es app, sigue sin serlo.
  for (const m of ['Mercado Pago', 'Efectivo', 'Transferencia', 'Transferencia 3', 'Cuenta DNI']) {
    assert.strictEqual(normalizarPlataforma(m), null, `${m} no puede entrar al reporte`);
    assert.strictEqual(esMedioDeApp(m), false);
  }
});

check('compatibilidad: los registros históricos se siguen leyendo igual', () => {
  // Variantes viejas del nombre que ya existen en la base.
  assert.strictEqual(normalizarPlataforma('PedidosYa'), 'PEDIDOSYA');
  assert.strictEqual(normalizarPlataforma('PEDIDOS_YA'), 'PEDIDOSYA');
  assert.strictEqual(normalizarPlataforma('prepago-rappi'), 'RAPPI');
  assert.strictEqual(normalizarPlataforma('Rappi'), 'RAPPI');
});

// ---------------------------------------------------------------------------
// LA PANTALLA REAL.
//
// En 1.3.94 se agregó MPAGO a PLATAFORMAS —con lo cual el ledger YA se leía—
// pero la pantalla `PrepaymentReportPage.jsx` tiene las pestañas ESCRITAS A
// MANO y no recorre esa constante, así que M.PAGO no aparecía. Verificar la
// constante no alcanzaba: hay que atar la pantalla a la lista.
// ---------------------------------------------------------------------------
console.log('\n6. La pantalla de Reportes Prepago muestra las tres:');

const fuentePagina = readFileSync(
  new URL('../../../pages/PrepaymentReportPage.jsx', import.meta.url), 'utf8',
);

check('hay una pestaña por cada plataforma de PLATAFORMAS', () => {
  for (const p of PLATAFORMAS) {
    assert.match(fuentePagina, new RegExp(`TabsTrigger value="${p}"`), `falta la pestaña de ${p}`);
    assert.match(fuentePagina, new RegExp(`renderTab\\('${p}'`), `falta el contenido de ${p}`);
  }
});

check('la grilla de pestañas tiene tantas columnas como plataformas', () => {
  const m = fuentePagina.match(/TabsList className="grid w-full max-w-\[400px\] grid-cols-(\d)/);
  assert.ok(m, 'no se encontró la grilla de pestañas');
  assert.strictEqual(Number(m[1]), PLATAFORMAS.length, 'la grilla quedó desalineada con PLATAFORMAS');
});

check('cada plataforma tiene su propio conjunto de filas filtradas', () => {
  // Si faltara, la pestaña mostraría los datos de otra.
  for (const p of PLATAFORMAS) {
    assert.match(fuentePagina, new RegExp(`filtrarPorPlataforma\\(filasDelRango, '${p}'\\)`), `${p} no filtra sus filas`);
  }
});

check('el subtítulo nombra a las tres', () => {
  assert.match(fuentePagina, /Ventas cobradas con PedidosYa, Rappi y M\.PAGO/);
});

check('el ledger se lee por PLATAFORMAS, así que MPAGO llega solo', () => {
  const flujo = readFileSync(new URL('../ventasAppsFlujo.js', import.meta.url), 'utf8');
  assert.match(flujo, /for \(const plataforma of PLATAFORMAS\)/, 'el ledger dejó de recorrer PLATAFORMAS');
  assert.match(flujo, /PREPAGO_\$\{plataforma\}/, 'la ruta del ledger cambió');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
