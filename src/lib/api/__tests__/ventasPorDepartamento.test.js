// Ventas de Mostrador clasificadas por DEPARTAMENTO (PedidosYa/Rappi/M.LIBRE),
// no por medio de pago. Módulo puro → corre sin Firebase:
//   node src/lib/api/__tests__/ventasPorDepartamento.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import {
  CATEGORIA_EFECTIVO,
  CATEGORIA_OTRO,
  CATEGORIA_PREPAGO,
  ETIQUETA_CLAVE,
  ETIQUETA_PREPAGO,
  calcularTotalesFormaPago,
  categorizarFormaDePago,
  filasDePagoParaClave,
  filasDeVentaPorDepartamento,
  filasParaExcel,
  filtrarPorClave,
  mapaClavePorDepartamento,
  pagosDeVenta,
  subtotalesPorDepartamento,
  unirSinDuplicarPorDepartamento,
  ventaAnulada,
} from '../ventasPorDepartamento.js';
import { calcularTotales, filtrarPorRango } from '../ventasApps.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const item = (departamento, valor, quantity = 1, extra = {}) => ({
  id: 'A1', nombre: 'Artículo', departamento, valor, quantity, ...extra,
});

const ventaMostrador = (id, items, extra = {}) => ({
  id, date: '12-05-2026', fechacaja: '12-05-2026', hora: '21:21:15',
  turno: 6, status: 'COMPLETADO', items, ...extra,
});

// Forma real en que se guarda el pago en una venta de Mostrador (auditado en
// producción): `payments: [{ amount, method }]`, duplicado en payment.payments
// y payment.details. Un solo pago por default; pasar varios simula un ticket
// con pago dividido.
const conPago = (...pagos) => ({
  payments: pagos,
  payment: { payments: pagos, details: pagos, total: pagos.reduce((a, p) => a + p.amount, 0) },
});
const pago = (amount, method) => ({ amount, method });

const DEPARTAMENTOS = {
  '9D': { nombre: 'PEDIDOS YA' },     // variante con espacio
  '10D': { nombre: 'RAPPI' },
  '11D': { nombre: 'M.LIBRE' },
  '1D': { nombre: 'TOPPING' },        // no es ninguno de los tres
};

console.log('\nMapa de clave por departamento:');
check('sólo mapea los ids cuyo nombre resuelve a los tres canónicos', () => {
  const mapa = mapaClavePorDepartamento(DEPARTAMENTOS);
  assert.deepStrictEqual(mapa, { '9D': 'PEDIDOSYA', '10D': 'RAPPI', '11D': 'MLIBRE' });
});
check('local sin esos departamentos da un mapa vacío', () => {
  assert.deepStrictEqual(mapaClavePorDepartamento({ '1D': { nombre: 'TOPPING' } }), {});
});

console.log('\nSubtotales por departamento de una venta:');
const mapa = mapaClavePorDepartamento(DEPARTAMENTOS);
check('un solo item de PEDIDOSYA aporta su subtotal completo', () => {
  const venta = ventaMostrador('1', [item('9D', 5000, 2)]);
  const sub = subtotalesPorDepartamento(venta, mapa);
  assert.deepStrictEqual(sub, { PEDIDOSYA: 10000, RAPPI: 0, MLIBRE: 0 });
});
check('un ticket mezclado (PedidosYa + Topping) sólo suma la parte de PedidosYa', () => {
  const venta = ventaMostrador('2', [item('9D', 5000, 1), item('1D', 3000, 1)]);
  const sub = subtotalesPorDepartamento(venta, mapa);
  assert.deepStrictEqual(sub, { PEDIDOSYA: 5000, RAPPI: 0, MLIBRE: 0 });
});
check('un ticket con PedidosYa Y Rappi aporta a las dos', () => {
  const venta = ventaMostrador('3', [item('9D', 5000, 1), item('10D', 2000, 1)]);
  const sub = subtotalesPorDepartamento(venta, mapa);
  assert.deepStrictEqual(sub, { PEDIDOSYA: 5000, RAPPI: 2000, MLIBRE: 0 });
});
check('una venta sin items de ninguno de los tres da todo en cero', () => {
  const venta = ventaMostrador('4', [item('1D', 3000, 1)]);
  assert.deepStrictEqual(subtotalesPorDepartamento(venta, mapa), { PEDIDOSYA: 0, RAPPI: 0, MLIBRE: 0 });
});
check('respeta opcionales del item (usa calcularSubtotalLinea, no valor*quantity a mano)', () => {
  const venta = ventaMostrador('5', [item('11D', 1000, 1, {
    selectedOptionals: { g1: [{ codigo: 'o1', precio: 500, quantity: 1 }] },
  })]);
  const sub = subtotalesPorDepartamento(venta, mapa);
  assert.strictEqual(sub.MLIBRE, 1500);
});

console.log('\nFilas del reporte:');
check('una venta anulada no genera ninguna fila', () => {
  const venta = ventaMostrador('6', [item('9D', 5000)], { status: 'ANULADO' });
  assert.deepStrictEqual(filasDeVentaPorDepartamento(venta, {}, mapa), []);
});
check('una venta sin ningún item de los tres departamentos no genera filas', () => {
  const venta = ventaMostrador('7', [item('1D', 5000)]);
  assert.deepStrictEqual(filasDeVentaPorDepartamento(venta, {}, mapa), []);
});
check('una venta mixta genera una fila por cada clave con importe', () => {
  const venta = ventaMostrador('8', [item('9D', 5000), item('10D', 2000)]);
  const filas = filasDeVentaPorDepartamento(venta, { localId: '40508022' }, mapa);
  assert.strictEqual(filas.length, 2);
  const py = filas.find((f) => f.clave === 'PEDIDOSYA');
  const rp = filas.find((f) => f.clave === 'RAPPI');
  assert.strictEqual(py.importe, 5000);
  assert.strictEqual(py.canal, 'Mostrador');
  assert.strictEqual(py.referencia, 'M8');
  assert.strictEqual(py.localId, '40508022');
  assert.strictEqual(rp.importe, 2000);
});
check('el id de la fila es estable: no depende de fecha/hora/importe', () => {
  const venta1 = ventaMostrador('9', [item('9D', 5000)], { hora: '10:00:00' });
  const venta2 = ventaMostrador('9', [item('9D', 5000)], { hora: '23:59:59' }); // "misma" venta, otra hora
  const f1 = filasDeVentaPorDepartamento(venta1, {}, mapa)[0];
  const f2 = filasDeVentaPorDepartamento(venta2, {}, mapa)[0];
  assert.strictEqual(f1.id, f2.id);
});

console.log('\nUnión sin duplicar (venta viva + su copia en BACKUP):');
check('la misma venta leída dos veces (vivo + respaldo) se cuenta una sola vez', () => {
  const venta = ventaMostrador('10', [item('9D', 5000)]);
  const deVivo = filasDeVentaPorDepartamento(venta, { origen: 'MOSTRADOR' }, mapa);
  const deBackup = filasDeVentaPorDepartamento(venta, { origen: 'BACKUP:MOSTRADOR' }, mapa);
  const unidas = unirSinDuplicarPorDepartamento([...deVivo, ...deBackup]);
  assert.strictEqual(unidas.length, 1);
});

console.log('\nFiltro por clave y reutilización de calcularTotales/filtrarPorRango de ventasApps.js:');
check('filtrarPorClave separa las pestañas', () => {
  const venta = ventaMostrador('11', [item('9D', 1000), item('10D', 2000), item('11D', 3000)]);
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(filtrarPorClave(filas, 'PEDIDOSYA').length, 1);
  assert.strictEqual(filtrarPorClave(filas, 'RAPPI')[0].importe, 2000);
  assert.strictEqual(filtrarPorClave(filas, 'MLIBRE')[0].importe, 3000);
});
check('calcularTotales (de ventasApps.js) funciona igual sobre estas filas', () => {
  const venta = ventaMostrador('12', [item('9D', 1000)]);
  const filas = filtrarPorClave(filasDeVentaPorDepartamento(venta, {}, mapa), 'PEDIDOSYA');
  const totales = calcularTotales(filas, new Date(2026, 4, 12));
  assert.strictEqual(totales.total, 1000);
  assert.strictEqual(totales.hoy, 1000);
  assert.strictEqual(totales.operaciones, 1);
});
check('filtrarPorRango (de ventasApps.js) funciona igual sobre estas filas', () => {
  const venta = ventaMostrador('13', [item('9D', 1000)]);
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(filtrarPorRango(filas, '2026-05-01', '2026-05-31').length, 1);
  assert.strictEqual(filtrarPorRango(filas, '2026-06-01', '2026-06-30').length, 0);
});

console.log('\nventaAnulada:');
check('reconoce los estados anulados de status.main y, en su ausencia, de estadoCarpeta', () => {
  assert.strictEqual(ventaAnulada({ status: { main: 'CANCELADO' } }), true);
  assert.strictEqual(ventaAnulada({}, 'CANCELADOS'), true); // sin status propio → cae a la carpeta
  assert.strictEqual(ventaAnulada({ status: 'COMPLETADO' }, 'CANCELADOS'), false); // status propio manda
  assert.strictEqual(ventaAnulada({ status: 'COMPLETADO' }), false);
});

console.log('\nExport a Excel:');
check('filasParaExcel usa la etiqueta visible, la forma de pago y las columnas esperadas', () => {
  const venta = ventaMostrador('14', [item('11D', 4000)], conPago(pago(4000, 'PREPAGO M.PAGO')));
  const filas = filasDeVentaPorDepartamento(venta, { localId: '40508022' }, mapa);
  const excel = filasParaExcel(filas, '40508022');
  assert.strictEqual(excel.length, 1);
  assert.strictEqual(excel[0].Plataforma, 'M.LIBRE');
  assert.strictEqual(excel[0]['Forma de pago'], 'PREPAGO M.LIBRE');
  assert.strictEqual(excel[0].Importe, 4000);
  assert.strictEqual(excel[0].Local, '40508022');
  assert.strictEqual(excel[0].Canal, 'Mostrador');
});
check('ETIQUETA_CLAVE tiene las tres claves con su nombre visible', () => {
  assert.deepStrictEqual(ETIQUETA_CLAVE, { PEDIDOSYA: 'PedidosYa', RAPPI: 'Rappi', MLIBRE: 'M.LIBRE' });
});

// ---------------------------------------------------------------------------
// FORMA DE PAGO — campo y valores reales auditados en producción antes de
// programar: `venta.payments: [{ amount, method }]`, "Efectivo" (no
// "EFECTIVO") para efectivo, "PREPAGO PEDIDOSYA"/"PREPAGO RAPPI"/
// "PREPAGO M.PAGO" para prepago de plataforma.
// ---------------------------------------------------------------------------

console.log('\npagosDeVenta: lee el campo real de la venta (payments / payment.payments / payment.details):');
check('lee venta.payments cuando existe', () => {
  assert.deepStrictEqual(pagosDeVenta({ payments: [{ amount: 100, method: 'Efectivo' }] }), [{ amount: 100, method: 'Efectivo' }]);
});
check('cae a payment.payments si no hay payments en la raíz', () => {
  assert.deepStrictEqual(pagosDeVenta({ payment: { payments: [{ amount: 200, method: 'PREPAGO RAPPI' }] } }), [{ amount: 200, method: 'PREPAGO RAPPI' }]);
});
check('sin ningún campo de pago reconocible, devuelve []', () => {
  assert.deepStrictEqual(pagosDeVenta({}), []);
});

console.log('\ncategorizarFormaDePago: EFECTIVO / PREPAGO esperado / OTRO (nunca se descarta):');
check('"Efectivo" (case real de producción) → EFECTIVO', () => {
  assert.deepStrictEqual(categorizarFormaDePago('Efectivo', 'PEDIDOSYA'), { categoria: CATEGORIA_EFECTIVO, etiqueta: 'EFECTIVO' });
  assert.deepStrictEqual(categorizarFormaDePago('EFECTIVO', 'RAPPI'), { categoria: CATEGORIA_EFECTIVO, etiqueta: 'EFECTIVO' });
});
check('"PREPAGO PEDIDOSYA" en el departamento PEDIDOSYA → PREPAGO', () => {
  assert.deepStrictEqual(categorizarFormaDePago('PREPAGO PEDIDOSYA', 'PEDIDOSYA'), { categoria: CATEGORIA_PREPAGO, etiqueta: 'PREPAGO PEDIDOSYA' });
});
check('"PREPAGO RAPPI" en el departamento RAPPI → PREPAGO', () => {
  assert.deepStrictEqual(categorizarFormaDePago('PREPAGO RAPPI', 'RAPPI'), { categoria: CATEGORIA_PREPAGO, etiqueta: 'PREPAGO RAPPI' });
});
check('"PREPAGO M.PAGO" (histórico) en el departamento M.LIBRE → PREPAGO M.LIBRE', () => {
  assert.deepStrictEqual(categorizarFormaDePago('PREPAGO M.PAGO', 'MLIBRE'), { categoria: CATEGORIA_PREPAGO, etiqueta: 'PREPAGO M.LIBRE' });
});
check('el prepago de OTRA plataforma no se confunde con el esperado: cae en OTRO con el valor real', () => {
  // Caso real encontrado en producción: item del depto PEDIDOSYA pagado con la
  // cuenta "PREPAGO M.PAGO". No se descarta ni se etiqueta como si fuera
  // PREPAGO PEDIDOSYA — se informa tal cual está guardado.
  assert.deepStrictEqual(categorizarFormaDePago('PREPAGO M.PAGO', 'PEDIDOSYA'), { categoria: CATEGORIA_OTRO, etiqueta: 'PREPAGO M.PAGO' });
});
check('un medio inesperado real ("Transferencia 2") cae en OTRO con su valor literal', () => {
  assert.deepStrictEqual(categorizarFormaDePago('Transferencia 2', 'RAPPI'), { categoria: CATEGORIA_OTRO, etiqueta: 'Transferencia 2' });
});
check('sin ningún medio (null/undefined) cae en OTRO, nunca se descarta', () => {
  assert.deepStrictEqual(categorizarFormaDePago(null, 'PEDIDOSYA'), { categoria: CATEGORIA_OTRO, etiqueta: '(sin forma de pago)' });
});

console.log('\nPEDIDOSYA efectivo / prepago / mezcla de ambas:');
check('PEDIDOSYA cobrado en efectivo', () => {
  const venta = ventaMostrador('20', [item('9D', 15000)], conPago(pago(15000, 'Efectivo')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].clave, 'PEDIDOSYA');
  assert.strictEqual(filas[0].categoriaPago, CATEGORIA_EFECTIVO);
  assert.strictEqual(filas[0].metodoPago, 'EFECTIVO');
  assert.strictEqual(filas[0].importe, 15000);
});
check('PEDIDOSYA cobrado con PREPAGO PEDIDOSYA', () => {
  const venta = ventaMostrador('21', [item('9D', 20000)], conPago(pago(20000, 'PREPAGO PEDIDOSYA')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].categoriaPago, CATEGORIA_PREPAGO);
  assert.strictEqual(filas[0].metodoPago, 'PREPAGO PEDIDOSYA');
  assert.strictEqual(filas[0].importe, 20000);
});
check('mezcla de efectivo y prepago en PEDIDOSYA (dos ventas distintas) da totales correctos', () => {
  const venta1 = ventaMostrador('22', [item('9D', 20000)], conPago(pago(20000, 'PREPAGO PEDIDOSYA')));
  const venta2 = ventaMostrador('23', [item('9D', 15000)], conPago(pago(15000, 'Efectivo')));
  const filas = [
    ...filasDeVentaPorDepartamento(venta1, {}, mapa),
    ...filasDeVentaPorDepartamento(venta2, {}, mapa),
  ];
  const totales = calcularTotalesFormaPago(filtrarPorClave(filas, 'PEDIDOSYA'));
  assert.strictEqual(totales.efectivo, 15000);
  assert.strictEqual(totales.prepago, 20000);
  assert.strictEqual(totales.total, 35000); // EFECTIVO + PREPAGO, ejemplo exacto del pedido
  assert.strictEqual(totales.operaciones, 2);
});

console.log('\nRAPPI y M.LIBRE efectivo/prepago (mismo comportamiento que PEDIDOSYA):');
check('RAPPI efectivo y RAPPI prepago', () => {
  const efvo = filasDeVentaPorDepartamento(ventaMostrador('24', [item('10D', 8000)], conPago(pago(8000, 'Efectivo'))), {}, mapa);
  const prep = filasDeVentaPorDepartamento(ventaMostrador('25', [item('10D', 9000)], conPago(pago(9000, 'PREPAGO RAPPI'))), {}, mapa);
  assert.strictEqual(efvo[0].categoriaPago, CATEGORIA_EFECTIVO);
  assert.strictEqual(prep[0].categoriaPago, CATEGORIA_PREPAGO);
  assert.strictEqual(prep[0].metodoPago, 'PREPAGO RAPPI');
  const totales = calcularTotalesFormaPago([...efvo, ...prep]);
  assert.strictEqual(totales.efectivo, 8000);
  assert.strictEqual(totales.prepago, 9000);
});
check('M.LIBRE efectivo y M.LIBRE prepago (con el valor histórico PREPAGO M.PAGO)', () => {
  const efvo = filasDeVentaPorDepartamento(ventaMostrador('26', [item('11D', 5000)], conPago(pago(5000, 'Efectivo'))), {}, mapa);
  const prep = filasDeVentaPorDepartamento(ventaMostrador('27', [item('11D', 7000)], conPago(pago(7000, 'PREPAGO M.PAGO'))), {}, mapa);
  assert.strictEqual(efvo[0].categoriaPago, CATEGORIA_EFECTIVO);
  assert.strictEqual(prep[0].categoriaPago, CATEGORIA_PREPAGO);
  assert.strictEqual(prep[0].metodoPago, 'PREPAGO M.LIBRE');
  const totales = calcularTotalesFormaPago([...efvo, ...prep]);
  assert.strictEqual(totales.efectivo, 5000);
  assert.strictEqual(totales.prepago, 7000);
  assert.strictEqual(totales.total, 12000);
});

console.log('\nTicket con artículos mezclados entre departamentos (cada uno con su propia forma de pago):');
check('un ticket pagado con un solo medio reparte ese medio a cada departamento por su propio subtotal', () => {
  // Ticket total $30.000: $20.000 de RAPPI + $10.000 de otro departamento,
  // pagado entero con PREPAGO RAPPI (caso real: todo el ticket es "de la app").
  const venta = ventaMostrador('28', [item('10D', 20000), item('1D', 10000)], conPago(pago(30000, 'PREPAGO RAPPI')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(filas.length, 1); // TOPPING (1D) no es canónico: no genera fila
  assert.strictEqual(filas[0].clave, 'RAPPI');
  assert.strictEqual(filas[0].importe, 20000); // NO 30000: sólo la parte de RAPPI
  assert.strictEqual(filas[0].categoriaPago, CATEGORIA_PREPAGO);
});
check('un ticket con PedidosYa + Rappi + pago dividido prorratea cada departamento sin perder un peso', () => {
  // Ticket $30.000: PedidosYa $20.000 + Rappi $10.000, pagado $18.000 Efectivo
  // + $12.000 PREPAGO PEDIDOSYA (pago dividido real, aunque mezclando depto).
  const venta = ventaMostrador('29', [item('9D', 20000), item('10D', 10000)],
    conPago(pago(18000, 'Efectivo'), pago(12000, 'PREPAGO PEDIDOSYA')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  const py = filtrarPorClave(filas, 'PEDIDOSYA');
  const rp = filtrarPorClave(filas, 'RAPPI');
  const sumaPY = py.reduce((a, f) => a + f.importe, 0);
  const sumaRP = rp.reduce((a, f) => a + f.importe, 0);
  assert.strictEqual(sumaPY, 20000); // el subtotal de PedidosYa se conserva exacto
  assert.strictEqual(sumaRP, 10000); // el de Rappi también
  assert.strictEqual(sumaPY + sumaRP, 30000); // nada se pierde ni se inventa
});

console.log('\nTurno abierto (MOSTRADOR vivo) vs turno cerrado (BACKUP) — mismo resultado, sin duplicar:');
check('una venta de PEDIDOSYA leída como turno abierto (MOSTRADOR) da la fila esperada', () => {
  const venta = ventaMostrador('30', [item('9D', 12000)], conPago(pago(12000, 'PREPAGO PEDIDOSYA')));
  const filas = filasDeVentaPorDepartamento(venta, { origen: 'MOSTRADOR' }, mapa);
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].origen, 'MOSTRADOR');
  assert.strictEqual(filas[0].metodoPago, 'PREPAGO PEDIDOSYA');
});
check('la MISMA venta leída desde BACKUP de un turno cerrado da la misma fila (mismo id) y no duplica', () => {
  const venta = ventaMostrador('30', [item('9D', 12000)], conPago(pago(12000, 'PREPAGO PEDIDOSYA')));
  const deVivo = filasDeVentaPorDepartamento(venta, { origen: 'MOSTRADOR' }, mapa);
  const deBackup = filasDeVentaPorDepartamento(venta, { origen: 'BACKUP:MOSTRADOR', turno: 6, estado: 'COMPLETADOS' }, mapa);
  const unidas = unirSinDuplicarPorDepartamento([...deVivo, ...deBackup]);
  assert.strictEqual(unidas.length, 1);
  assert.strictEqual(unidas[0].importe, 12000);
});

console.log('\nRango de fechas (reutiliza filtrarPorRango de ventasApps.js):');
check('filtrarPorRango sigue funcionando igual con las filas que ahora incluyen forma de pago', () => {
  const venta = ventaMostrador('31', [item('9D', 5000)], conPago(pago(5000, 'Efectivo')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa); // fecha 12-05-2026
  assert.strictEqual(filtrarPorRango(filas, '2026-05-01', '2026-05-31').length, 1);
  assert.strictEqual(filtrarPorRango(filas, '2026-06-01', '2026-06-30').length, 0);
});

console.log('\nListado: cada fila trae fecha, hora, forma de pago e importe listos para la tabla:');
check('una fila del listado trae todos los campos que pide la pantalla', () => {
  const venta = ventaMostrador('32', [item('9D', 20000)], { ...conPago(pago(20000, 'PREPAGO PEDIDOSYA')), hora: '14:32:00', turno: 63 });
  const [fila] = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(fila.fecha, '12-05-2026');
  assert.strictEqual(fila.hora, '14:32:00');
  assert.strictEqual(fila.clave, 'PEDIDOSYA');
  assert.strictEqual(fila.metodoPago, 'PREPAGO PEDIDOSYA');
  assert.strictEqual(fila.referencia, 'M32');
  assert.strictEqual(fila.turno, 63);
  assert.strictEqual(fila.importe, 20000);
});

console.log('\ncalcularTotalesFormaPago: TOTAL siempre reconcilia con las filas listadas, incluyendo OTRO:');
check('un medio inesperado (OTRO) suma al total y a otrosPorEtiqueta, nunca se pierde', () => {
  const venta = ventaMostrador('33', [item('10D', 6500)], conPago(pago(6500, 'Transferencia 2')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  const totales = calcularTotalesFormaPago(filas);
  assert.strictEqual(totales.efectivo, 0);
  assert.strictEqual(totales.prepago, 0);
  assert.strictEqual(totales.otros, 6500);
  assert.deepStrictEqual(totales.otrosPorEtiqueta, { 'Transferencia 2': 6500 });
  assert.strictEqual(totales.total, 6500); // reconcilia con la única fila listada
  assert.strictEqual(totales.operaciones, 1);
});
check('total = efectivo + prepago + otros, siempre, con cualquier combinación', () => {
  const filas = [
    ...filasDeVentaPorDepartamento(ventaMostrador('34', [item('9D', 1000)], conPago(pago(1000, 'Efectivo'))), {}, mapa),
    ...filasDeVentaPorDepartamento(ventaMostrador('35', [item('9D', 2000)], conPago(pago(2000, 'PREPAGO PEDIDOSYA'))), {}, mapa),
    ...filasDeVentaPorDepartamento(ventaMostrador('36', [item('9D', 3000)], conPago(pago(3000, 'PREPAGO M.PAGO'))), {}, mapa), // OTRO en PEDIDOSYA
  ];
  const totales = calcularTotalesFormaPago(filas);
  assert.strictEqual(totales.total, totales.efectivo + totales.prepago + totales.otros);
  assert.strictEqual(totales.total, 6000);
  assert.strictEqual(totales.operaciones, filas.length);
});

console.log('\nMarca de auditoría "prorrateado" (identifica porciones prorrateadas de un pago dividido):');
check('un pago único (el caso normal) NO queda marcado como prorrateado', () => {
  const venta = ventaMostrador('37', [item('9D', 15000)], conPago(pago(15000, 'Efectivo')));
  const [fila] = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(fila.prorrateado, false);
});
check('un ticket con pago dividido SÍ queda marcado como prorrateado, en cada porción', () => {
  const venta = ventaMostrador('38', [item('9D', 20000), item('10D', 10000)],
    conPago(pago(18000, 'Efectivo'), pago(12000, 'PREPAGO PEDIDOSYA')));
  const filas = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.ok(filas.length > 0);
  assert.ok(filas.every((f) => f.prorrateado === true), 'toda porción de un pago dividido debe quedar marcada para poder auditarla');
});

console.log('\nOTRO es una categoría propia, nunca se funde con PREPAGO de otra plataforma:');
check('PREPAGO M.PAGO sobre un item de PEDIDOSYA no contamina la categoría PREPAGO de esa pestaña', () => {
  const venta = ventaMostrador('39', [item('9D', 3000)], conPago(pago(3000, 'PREPAGO M.PAGO')));
  const [fila] = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(fila.categoriaPago, CATEGORIA_OTRO);
  assert.notStrictEqual(fila.categoriaPago, CATEGORIA_PREPAGO);
  assert.strictEqual(fila.metodoPago, 'PREPAGO M.PAGO'); // el valor real, no "PREPAGO PEDIDOSYA"
});
check('PREPAGO M.PAGO sobre un item de RAPPI tampoco se confunde con PREPAGO RAPPI', () => {
  const venta = ventaMostrador('40', [item('10D', 3000)], conPago(pago(3000, 'PREPAGO M.PAGO')));
  const [fila] = filasDeVentaPorDepartamento(venta, {}, mapa);
  assert.strictEqual(fila.categoriaPago, CATEGORIA_OTRO);
  assert.strictEqual(fila.metodoPago, 'PREPAGO M.PAGO');
});

console.log('\nSin duplicar con el ledger PREPAGO_* viejo:');
check('el pipeline por departamento (ventasPorDepartamentoFlujo.js) nunca LEE el ledger PREPAGO_* (fuera de comentarios explicativos)', () => {
  const src = fs.readFileSync(new URL('../ventasPorDepartamentoFlujo.js', import.meta.url), 'utf8');
  // Saca comentarios de línea y de bloque antes de buscar: el archivo SÍ
  // menciona "PREPAGO_*" en un comentario, para explicar en qué se diferencia
  // de ventasAppsFlujo.js — lo que no debe existir es código que LEA esa ruta.
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!sinComentarios.includes('PREPAGO'), 'el importe debe salir siempre de la venta real, nunca de un ledger derivado');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
