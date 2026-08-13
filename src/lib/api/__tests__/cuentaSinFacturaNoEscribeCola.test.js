// Una cuenta con "Emite factura" APAGADO no puede escribir en NINGUNA cola
// fiscal — ni en Mostrador ni en Delivery.
//
// Caso real: Centenario (51501748), cuenta "Transferencia 2" con el switch en
// false. Antes la venta se detenía con un error fiscal ("factura en
// FACTURACION_2"); ahora tiene que salir como REMITO y seguir su curso normal.
//
// La simulación reproduce los DOS guards reales, tal como están en el código:
//
//   Mostrador → counterApi.js:260   if (decision.comprobante !== COMPROBANTE_FACTURA) → no escribe
//   Delivery  → ordersApi.js:424    if (encolado.estado !== 'encolar') return;        → no escribe
//
// y registra toda ruta que se intentaría escribir, para poder afirmar que
// ninguna cae bajo FACTURACION*.
//
// Correr con: node src/lib/api/__tests__/cuentaSinFacturaNoEscribeCola.test.js
import assert from 'node:assert';
import {
  decidirComprobante,
  resolverEncolado,
  puedeEntrarAFacturacion,
  COMPROBANTE_FACTURA,
  COMPROBANTE_REMITO,
} from '../facturaORemito.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const LOCAL = '51501748';

/** CUENTAS reales de Centenario al 13/08/2026. */
const CUENTAS_CENTENARIO = {
  'cta-1': { nombre: 'Transferencia',     imprimeFactura: true },
  'cta-2': { nombre: 'Transferencia 2',   imprimeFactura: false, isFavorite: true },
  'cta-4': { nombre: 'PREPAGO PEDIDOSYA', imprimeFactura: false, cuentaFacturacionAsociadaId: 'cta-1' },
  'cta-5': { nombre: 'PREPAGO RAPPI',     imprimeFactura: false, cuentaFacturacionAsociadaId: 'cta-1' },
};

/**
 * Simula el cobro completo de una venta y registra TODA ruta que el código
 * escribiría, siguiendo los guards reales de cada canal.
 */
function cobrar({ canal, venta, id, cuentas = CUENTAS_CENTENARIO }) {
  const escrituras = [];

  // Barrera central (cancelaciones / total invalido), igual que en producción.
  const permitido = puedeEntrarAFacturacion(venta);
  if (!permitido.ok) return { comprobante: COMPROBANTE_REMITO, escrituras, motivo: permitido.motivo };

  const decision = decidirComprobante({ venta, cuentas });
  const encolado = resolverEncolado(decision, cuentas);

  // La venta SIEMPRE se guarda, facture o no.
  escrituras.push(`${LOCAL}/${canal === 'mostrador' ? 'MOSTRADOR' : 'PEDIDOS'}/${id}`);

  if (canal === 'mostrador') {
    // counterApi.js:260
    if (decision.comprobante === COMPROBANTE_FACTURA) {
      escrituras.push(`${LOCAL}/${encolado.cola}/M${id}`);
    }
  } else {
    // ordersApi.js:424 — saveFacturacionForPayments
    if (encolado && encolado.estado === 'encolar') {
      escrituras.push(`${LOCAL}/${encolado.cola}/D${id}`);
    }
  }

  // El comprobante NO fiscal de una venta que no se factura.
  if (decision.comprobante === COMPROBANTE_REMITO) {
    escrituras.push(`${LOCAL}/Remitos/FCX0008-00000001`);
  }

  return { comprobante: decision.comprobante, encolado, escrituras };
}

const tocaCola = (escrituras) => escrituras.filter((r) => /\/FACTURACION/i.test(r));

// ---------------------------------------------------------------------------
console.log('\nCentenario — "Transferencia 2" con Emite factura APAGADO:');

check('DELIVERY: sale REMITO y no escribe en ninguna cola fiscal', () => {
  const r = cobrar({
    canal: 'delivery', id: '6300',
    venta: { status: { main: 'ENTREGADO' }, payment: { method: 'Transferencia 2', total: 15000, amount: 15000 } },
  });
  assert.strictEqual(r.comprobante, COMPROBANTE_REMITO);
  assert.strictEqual(r.encolado.estado, 'sin-factura');
  assert.strictEqual(r.encolado.cola, undefined);
  assert.deepStrictEqual(tocaCola(r.escrituras), [], `escribió en una cola: ${tocaCola(r.escrituras)}`);
  assert.ok(r.escrituras.includes(`${LOCAL}/PEDIDOS/6300`), 'la venta igual se guarda');
  assert.ok(r.escrituras.some((x) => x.includes('/Remitos/')), 'y se emite el remito normal');
});

check('MOSTRADOR: sale REMITO y no escribe en ninguna cola fiscal', () => {
  const r = cobrar({
    canal: 'mostrador', id: '2100',
    venta: { total: 15000, payments: [{ method: 'Transferencia 2', amount: 15000 }] },
  });
  assert.strictEqual(r.comprobante, COMPROBANTE_REMITO);
  assert.deepStrictEqual(tocaCola(r.escrituras), []);
  assert.ok(r.escrituras.includes(`${LOCAL}/MOSTRADOR/2100`), 'la venta igual se guarda');
  assert.ok(r.escrituras.some((x) => x.includes('/Remitos/')));
});

check('el REMITO va SOLO a /{localId}/Remitos, nunca a una cola', () => {
  const r = cobrar({
    canal: 'delivery', id: '6301',
    venta: { status: { main: 'ENTREGADO' }, payment: { method: 'Transferencia 2', total: 9000, amount: 9000 } },
  });
  const remitos = r.escrituras.filter((x) => x.includes('/Remitos/'));
  assert.strictEqual(remitos.length, 1);
  assert.match(remitos[0], new RegExp(`^${LOCAL}/Remitos/FCX`), 'ruta canónica del remito');
});

check('combinado Efectivo + Transferencia 2 apagada: tampoco factura', () => {
  const r = cobrar({
    canal: 'delivery', id: '6302',
    venta: {
      status: { main: 'ENTREGADO' },
      payment: { method: 'Pago Dividido', total: 20000, payments: [
        { method: 'Efectivo', amount: 8000 }, { method: 'Transferencia 2', amount: 12000 },
      ] },
    },
  });
  assert.strictEqual(r.comprobante, COMPROBANTE_REMITO);
  assert.deepStrictEqual(tocaCola(r.escrituras), []);
});

// ---------------------------------------------------------------------------
console.log('\nLa cuenta que SÍ factura sigue escribiendo su cola:');

check('DELIVERY con "Transferencia" (ON) → escribe en FACTURACION_1', () => {
  const r = cobrar({
    canal: 'delivery', id: '6303',
    venta: { status: { main: 'ENTREGADO' }, payment: { method: 'Transferencia', total: 11000, amount: 11000 } },
  });
  assert.strictEqual(r.comprobante, COMPROBANTE_FACTURA);
  assert.deepStrictEqual(tocaCola(r.escrituras), [`${LOCAL}/FACTURACION_1/D6303`]);
  assert.strictEqual(r.encolado.total, 11000, 'por el total completo');
  assert.ok(!r.escrituras.some((x) => x.includes('/Remitos/')), 'una factura NO emite además un remito');
});

check('MOSTRADOR con "Transferencia" (ON) → escribe en FACTURACION_1', () => {
  const r = cobrar({
    canal: 'mostrador', id: '2101',
    venta: { total: 10000, payments: [{ method: 'Transferencia', amount: 10000 }] },
  });
  assert.deepStrictEqual(tocaCola(r.escrituras), [`${LOCAL}/FACTURACION_1/M2101`]);
});

check('si se enciende "Transferencia 2", vuelve a escribir en FACTURACION_2', () => {
  const cuentas = { ...CUENTAS_CENTENARIO, 'cta-2': { nombre: 'Transferencia 2', imprimeFactura: true } };
  const r = cobrar({
    canal: 'delivery', id: '6304', cuentas,
    venta: { status: { main: 'ENTREGADO' }, payment: { method: 'Transferencia 2', total: 15000, amount: 15000 } },
  });
  assert.deepStrictEqual(tocaCola(r.escrituras), [`${LOCAL}/FACTURACION_2/D6304`]);
});

check('una cancelación no escribe en ninguna cola', () => {
  const r = cobrar({
    canal: 'delivery', id: '6305',
    venta: { status: { main: 'CANCELADO' }, payment: { method: 'Transferencia', total: 11000, amount: 11000 } },
  });
  assert.deepStrictEqual(tocaCola(r.escrituras), []);
  assert.strictEqual(r.motivo, 'cancelacion');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
