// Ventas por app (PedidosYa / Rappi): normalización, unión sin duplicados,
// filtro de fechas y totales. Módulo puro → corre sin Firebase:
//   node src/lib/api/__tests__/ventasApps.test.js
import assert from 'node:assert';
import {
  ETIQUETA_PLATAFORMA,
  PLATAFORMAS,
  calcularTotales,
  claveCarpeta,
  claveOrdenable,
  diasDelRango,
  esMedioDeApp,
  filaDeLedger,
  filasDeVenta,
  filasParaExcel,
  filtrarPorPlataforma,
  filtrarPorRango,
  normalizarFecha,
  normalizarPlataforma,
  pagosDeAppEnVenta,
  unirSinDuplicar,
  ventaAnulada,
} from '../ventasApps.js';

const ACHAVAL = '40508022';
let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const ventaMostrador = (id, metodo, monto, fecha = '12-05-2026', hora = '21:21:15') => ({
  id,
  date: fecha,
  fechacaja: fecha,
  hora,
  turno: 6,
  status: 'COMPLETADO',
  total: monto,
  client: { name: 'Consumidor Final' },
  payments: [{ method: metodo, amount: monto }],
  payment: { total: monto, payments: [{ method: metodo, amount: monto }] },
});

console.log('\nNormalización de plataforma:');
check('todas las variantes históricas de PedidosYa caen en PEDIDOSYA', () => {
  for (const v of ['PREPAGO PEDIDOSYA', 'PedidosYa', 'Pedidos Ya', 'PEDIDOSYA', 'pedidosya',
    'PREPAGO_PEDIDOSYA', 'prepago-pedidos ya', 'Prepago Pedidos Ya']) {
    assert.strictEqual(normalizarPlataforma(v), 'PEDIDOSYA', `falló con ${JSON.stringify(v)}`);
  }
});
check('todas las variantes históricas de Rappi caen en RAPPI', () => {
  for (const v of ['PREPAGO RAPPI', 'Rappi', 'RAPPI', 'rappi', 'PREPAGO_RAPPI', 'prepago-rappi']) {
    assert.strictEqual(normalizarPlataforma(v), 'RAPPI', `falló con ${JSON.stringify(v)}`);
  }
});
check('los demás medios de pago NO son plataforma', () => {
  for (const v of ['Efectivo', 'Débito', 'Mercado Pago', 'Transferencia', 'Transferencia 2',
    'Tarjeta', '', null, undefined, 0]) {
    assert.strictEqual(normalizarPlataforma(v), null, `falló con ${JSON.stringify(v)}`);
  }
  assert.strictEqual(esMedioDeApp('Efectivo'), false);
  assert.strictEqual(esMedioDeApp('PREPAGO RAPPI'), true);
});
check('las tres plataformas tienen etiqueta para la UI', () => {
  assert.deepStrictEqual(PLATAFORMAS, ['PEDIDOSYA', 'RAPPI', 'MPAGO']);
  assert.strictEqual(ETIQUETA_PLATAFORMA.PEDIDOSYA, 'PedidosYa');
  assert.strictEqual(ETIQUETA_PLATAFORMA.RAPPI, 'Rappi');
  assert.strictEqual(ETIQUETA_PLATAFORMA.MPAGO, 'M.PAGO');
});

check('M.PAGO se reconoce y NO se confunde con la cuenta "Mercado Pago"', () => {
  // "PREPAGO M.PAGO" es un prepago de app; "Mercado Pago" es una cuenta de
  // cobro con cola fija (FACTURACION_6) y NO debe entrar a Reportes Prepago.
  assert.strictEqual(normalizarPlataforma('PREPAGO M.PAGO'), 'MPAGO');
  assert.strictEqual(normalizarPlataforma('PREPAGO_MPAGO'), 'MPAGO');
  assert.strictEqual(normalizarPlataforma('Mercado Pago'), null);
  assert.strictEqual(esMedioDeApp('PREPAGO M.PAGO'), true);
  assert.strictEqual(esMedioDeApp('Mercado Pago'), false);
  // Y las dos de siempre siguen resolviendo igual.
  assert.strictEqual(normalizarPlataforma('PREPAGO PEDIDOSYA'), 'PEDIDOSYA');
  assert.strictEqual(normalizarPlataforma('PREPAGO RAPPI'), 'RAPPI');
});

console.log('\nNormalización de fecha (formatos históricos):');
check('interpreta todos los formatos que existen en la base', () => {
  assert.strictEqual(normalizarFecha('12-05-2026'), '12-05-2026');   // DD-MM-AAAA
  assert.strictEqual(normalizarFecha('12/05/2026'), '12-05-2026');   // DD/MM/AAAA
  assert.strictEqual(normalizarFecha('2026-05-12'), '12-05-2026');   // AAAA-MM-DD
  assert.strictEqual(normalizarFecha('2026/05/12'), '12-05-2026');
  assert.strictEqual(normalizarFecha('12052026'), '12-05-2026');     // DDMMAAAA (carpeta)
  assert.strictEqual(normalizarFecha('2026-05-12T21:21:15.000Z'), '12-05-2026');
  assert.strictEqual(normalizarFecha(new Date(2026, 4, 12)), '12-05-2026');
  assert.strictEqual(normalizarFecha(new Date(2026, 4, 12).getTime()), '12-05-2026');
});
check('lo que no se puede interpretar devuelve null, no una fecha inventada', () => {
  for (const v of [null, undefined, '', '  ', 'ayer', '32-13-2026'.replace('x', ''), {}, NaN]) {
    const r = normalizarFecha(v);
    assert.ok(r === null || /^\d{2}-\d{2}-\d{4}$/.test(r), `devolvió ${JSON.stringify(r)}`);
  }
  assert.strictEqual(normalizarFecha('ayer'), null);
});
check('claves derivadas', () => {
  assert.strictEqual(claveOrdenable('12-05-2026'), '2026-05-12');
  assert.strictEqual(claveCarpeta('12-05-2026'), '12052026');
  assert.strictEqual(claveCarpeta('2026-05-12'), '12052026');
});

console.log('\nLectura de los pagos de una venta:');
check('toma el pago de app de payments[]', () => {
  const p = pagosDeAppEnVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500));
  assert.deepStrictEqual(p.map((x) => [x.plataforma, x.importe]), [['PEDIDOSYA', 18500]]);
});
check('en un pago dividido toma SOLO la parte de la app', () => {
  const venta = {
    id: 9, date: '12-05-2026', hora: '10:00:00', total: 10000,
    payments: [{ method: 'Efectivo', amount: 4000 }, { method: 'PREPAGO RAPPI', amount: 6000 }],
  };
  const p = pagosDeAppEnVenta(venta);
  assert.deepStrictEqual(p.map((x) => [x.plataforma, x.importe]), [['RAPPI', 6000]]);
});
check('soporta payment.method / paid.method / formaPago (formatos viejos)', () => {
  assert.strictEqual(pagosDeAppEnVenta({ total: 500, payment: { method: 'PedidosYa', total: 500 } })[0].plataforma, 'PEDIDOSYA');
  assert.strictEqual(pagosDeAppEnVenta({ total: 700, paid: { method: 'Rappi' } })[0].importe, 700);
  assert.strictEqual(pagosDeAppEnVenta({ total: 300, formaPago: 'PREPAGO PEDIDOSYA' })[0].plataforma, 'PEDIDOSYA');
});
check('una venta en efectivo no aporta ninguna fila', () => {
  assert.deepStrictEqual(pagosDeAppEnVenta(ventaMostrador(1, 'Efectivo', 5000)), []);
  assert.deepStrictEqual(filasDeVenta(ventaMostrador(1, 'Efectivo', 5000), { id: 1, canal: 'Mostrador' }), []);
});
check('una venta anulada no cuenta como ingreso de la app', () => {
  assert.strictEqual(ventaAnulada({ status: 'CANCELADO' }), true);
  assert.strictEqual(ventaAnulada({ status: { main: 'CANCELADO' } }), true);
  assert.strictEqual(ventaAnulada({ status: 'COMPLETADO' }, 'CANCELADOS'), false);
  assert.deepStrictEqual(
    filasDeVenta({ ...ventaMostrador(5, 'PREPAGO RAPPI', 1000), status: 'CANCELADO' }, { id: 5, canal: 'Mostrador' }),
    []
  );
});

console.log('\nFila de venta:');
const filaVenta = filasDeVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500), {
  id: 67, canal: 'Mostrador', origen: 'BACKUP:MOSTRADOR', fecha: '12-05-2026', turno: 6, localId: ACHAVAL,
})[0];
check('trae todo lo que la tabla necesita mostrar', () => {
  assert.strictEqual(filaVenta.plataforma, 'PEDIDOSYA');
  assert.strictEqual(filaVenta.fecha, '12-05-2026');
  assert.strictEqual(filaVenta.hora, '21:21:15');
  assert.strictEqual(filaVenta.importe, 18500);
  assert.strictEqual(filaVenta.referencia, 'M67');
  assert.strictEqual(filaVenta.numeroVenta, '67');
  assert.strictEqual(filaVenta.canal, 'Mostrador');
  assert.strictEqual(filaVenta.turno, 6);
  assert.strictEqual(filaVenta.localId, ACHAVAL);
});
check('la referencia de delivery lleva prefijo D', () => {
  const f = filasDeVenta({ ...ventaMostrador(881, 'PREPAGO RAPPI', 9000), id: 881 },
    { id: 881, canal: 'Delivery', localId: ACHAVAL })[0];
  assert.strictEqual(f.referencia, 'D881');
  assert.strictEqual(f.canal, 'Delivery');
});
check('una venta sin datos no rompe: devuelve [] o campos en null', () => {
  assert.deepStrictEqual(filasDeVenta(null, {}), []);
  assert.deepStrictEqual(filasDeVenta({}, {}), []);
  const f = filasDeVenta({ payments: [{ method: 'Rappi', amount: 100 }] }, { canal: 'Mostrador' })[0];
  assert.strictEqual(f.fecha, null);
  assert.strictEqual(f.referencia, null);
  assert.strictEqual(f.importe, 100);
});

console.log('\nFila del ledger de prepagos:');
check('la clave incluye la fecha: el contador arranca en 1 todos los días', () => {
  const a = filaDeLedger({ numero: 1, hora: '20:00:00', monto: 5000 }, { plataforma: 'PEDIDOSYA', fecha: '12-05-2026' });
  const b = filaDeLedger({ numero: 1, hora: '20:00:00', monto: 7000 }, { plataforma: 'PEDIDOSYA', fecha: '13-05-2026' });
  assert.notStrictEqual(a.id, b.id, 'dos días distintos con numero=1 comparten clave');
  assert.strictEqual(a.referencia, '#1');
  assert.strictEqual(a.canal, 'Prepago');
});

console.log('\nUnión sin duplicados:');
check('la misma venta viva y respaldada aparece UNA sola vez', () => {
  const viva = filasDeVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500), { id: 67, canal: 'Mostrador', origen: 'MOSTRADOR', localId: ACHAVAL });
  const respaldada = filasDeVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500), { id: 67, canal: 'Mostrador', origen: 'BACKUP:MOSTRADOR', fecha: '12-05-2026', localId: ACHAVAL });
  const filas = unirSinDuplicar([...viva, ...respaldada], []);
  assert.strictEqual(filas.length, 1);
});
check('dos ventas distintas con el MISMO importe, fecha y hora se conservan las dos', () => {
  const a = filasDeVenta(ventaMostrador(70, 'PREPAGO RAPPI', 6000), { id: 70, canal: 'Mostrador' });
  const b = filasDeVenta(ventaMostrador(71, 'PREPAGO RAPPI', 6000), { id: 71, canal: 'Mostrador' });
  assert.strictEqual(unirSinDuplicar([...a, ...b], []).length, 2);
});
check('el ledger NO duplica un día que ya tiene ventas', () => {
  const ventas = filasDeVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500), { id: 67, canal: 'Mostrador', fecha: '12-05-2026' });
  const ledger = [filaDeLedger({ numero: 1, hora: '21:21:15', monto: 18500 }, { plataforma: 'PEDIDOSYA', fecha: '12-05-2026' })];
  const filas = unirSinDuplicar(ventas, ledger);
  assert.strictEqual(filas.length, 1, 'se contó dos veces la misma venta');
  assert.strictEqual(filas[0].canal, 'Mostrador', 'debería mandar la venta, no el asiento derivado');
});
check('el ledger SÍ aporta los días en los que no hay ninguna venta alcanzable', () => {
  const ventas = filasDeVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500), { id: 67, canal: 'Mostrador', fecha: '12-05-2026' });
  const ledger = [filaDeLedger({ numero: 1, hora: '19:00:00', monto: 9000 }, { plataforma: 'PEDIDOSYA', fecha: '02-01-2025' })];
  const filas = unirSinDuplicar(ventas, ledger);
  assert.strictEqual(filas.length, 2);
});
check('el ledger de una plataforma no tapa el día de la otra', () => {
  const ventas = filasDeVenta(ventaMostrador(67, 'PREPAGO PEDIDOSYA', 18500), { id: 67, canal: 'Mostrador', fecha: '12-05-2026' });
  const ledger = [filaDeLedger({ numero: 1, hora: '22:00:00', monto: 4000 }, { plataforma: 'RAPPI', fecha: '12-05-2026' })];
  assert.strictEqual(unirSinDuplicar(ventas, ledger).length, 2);
});

console.log('\nPestañas, rango y totales:');
const universo = unirSinDuplicar([
  ...filasDeVenta(ventaMostrador(1, 'PREPAGO PEDIDOSYA', 1000, '01-07-2026'), { id: 1, canal: 'Mostrador' }),
  ...filasDeVenta(ventaMostrador(2, 'PREPAGO PEDIDOSYA', 2000, '15-07-2026'), { id: 2, canal: 'Mostrador' }),
  ...filasDeVenta(ventaMostrador(3, 'PREPAGO RAPPI', 3000, '15-07-2026'), { id: 3, canal: 'Mostrador' }),
  ...filasDeVenta(ventaMostrador(4, 'Efectivo', 9999, '15-07-2026'), { id: 4, canal: 'Mostrador' }),
], []);
check('una venta pertenece a UNA sola pestaña', () => {
  assert.strictEqual(filtrarPorPlataforma(universo, 'PEDIDOSYA').length, 2);
  assert.strictEqual(filtrarPorPlataforma(universo, 'RAPPI').length, 1);
  assert.strictEqual(universo.length, 3, 'se coló una venta que no es de app');
});
check('el rango Desde/Hasta es INCLUSIVO en los dos extremos', () => {
  assert.strictEqual(filtrarPorRango(universo, '2026-07-01', '2026-07-15').length, 3);
  assert.strictEqual(filtrarPorRango(universo, '2026-07-01', '2026-07-01').length, 1);
  assert.strictEqual(filtrarPorRango(universo, '2026-07-15', '2026-07-15').length, 2);
  assert.strictEqual(filtrarPorRango(universo, '2026-07-02', '2026-07-14').length, 0);
});
check('el rango acepta los mismos formatos históricos', () => {
  assert.strictEqual(filtrarPorRango(universo, '01-07-2026', '15-07-2026').length, 3);
  assert.strictEqual(filtrarPorRango(universo, '01/07/2026', '15/07/2026').length, 3);
});
check('hoy, semana y mes se calculan sobre lo que se está mostrando', () => {
  const hoy = new Date(2026, 6, 15); // miércoles 15-07-2026
  const t = calcularTotales(filtrarPorPlataforma(universo, 'PEDIDOSYA'), hoy);
  assert.strictEqual(t.hoy, 2000, 'HOY debe sumar sólo el 15-07');
  assert.strictEqual(t.semana, 2000, 'la semana arranca el domingo 12-07');
  assert.strictEqual(t.mes, 3000, 'el mes calendario incluye el 01-07 y el 15-07');
  assert.strictEqual(t.total, 3000);
  assert.strictEqual(t.operaciones, 2);
});
check('el contador de operaciones coincide con las filas mostradas', () => {
  const filas = filtrarPorPlataforma(universo, 'RAPPI');
  assert.strictEqual(calcularTotales(filas, new Date(2026, 6, 15)).operaciones, filas.length);
});
check('una fila sin fecha no rompe los totales', () => {
  const t = calcularTotales([{ importe: 500, fecha: null }, { importe: 100, fecha: '15-07-2026' }], new Date(2026, 6, 15));
  assert.strictEqual(t.total, 600);
  assert.strictEqual(t.operaciones, 2);
  assert.strictEqual(t.hoy, 100);
});

console.log('\nDías a leer del BACKUP:');
check('el rango define exactamente qué nodos se piden', () => {
  const dias = diasDelRango('2026-07-01', '2026-07-03');
  assert.deepStrictEqual(dias, [
    { anio: '2026', mes: '07', dia: '01' },
    { anio: '2026', mes: '07', dia: '02' },
    { anio: '2026', mes: '07', dia: '03' },
  ]);
  assert.strictEqual(diasDelRango('2026-07-01', '2026-07-31').length, 31);
  assert.strictEqual(diasDelRango('2026-07-31', '2026-07-01').length, 0);
});
check('un rango disparatado se corta para no hacer miles de lecturas', () => {
  assert.strictEqual(diasDelRango('2000-01-01', '2030-01-01').length, 400);
  assert.strictEqual(diasDelRango('2026-01-01', '2026-12-31', 10).length, 10);
});

console.log('\nExportación:');
check('el Excel lleva exactamente las filas visibles y sus columnas', () => {
  const visibles = filtrarPorPlataforma(universo, 'PEDIDOSYA');
  const excel = filasParaExcel(visibles, ACHAVAL);
  assert.strictEqual(excel.length, visibles.length);
  assert.deepStrictEqual(Object.keys(excel[0]),
    ['Fecha', 'Hora', 'Plataforma', 'Referencia', 'Importe', 'Local', 'Turno', 'Canal', 'N° de venta', 'Origen', 'ID']);
  assert.strictEqual(excel[0].Plataforma, 'PedidosYa');
  assert.strictEqual(excel[0].Local, ACHAVAL);
});
check('una fila sin referencia se exporta con un marcador, no vacía ni rota', () => {
  const excel = filasParaExcel([{ plataforma: 'RAPPI', importe: 10, id: 'x' }], ACHAVAL);
  assert.strictEqual(excel[0].Referencia, '—');
  assert.strictEqual(excel[0].Fecha, '');
  assert.strictEqual(excel[0].Importe, 10);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
