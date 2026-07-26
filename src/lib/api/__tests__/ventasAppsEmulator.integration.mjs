// VENTAS POR APP (PedidosYa / Rappi) — INTEGRACIÓN CONTRA EL EMULADOR REAL.
//
// Prueba la lectura completa: ventas vivas + BACKUP por día + ledger, la unión
// sin duplicados, el aislamiento entre locales y que la consulta NO ESCRIBA nada.
//
// Correr con:
//   npm run test:ventas-apps-emulator
import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, ref, get, set, connectDatabaseEmulator } from 'firebase/database';
import { leerVentasDeApps } from '../ventasAppsFlujo.js';
import { calcularTotales, filtrarPorPlataforma, filtrarPorRango } from '../ventasApps.js';

let passed = 0;
async function check(nombre, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) {
  console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST: hay que correrlo con `firebase emulators:exec`.');
  process.exit(1);
}
const [host, port] = HOST.split(':');
const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'ventasApps');
const db = getDatabase(app);
connectDatabaseEmulator(db, host, Number(port));

const ACHAVAL = '40508022';
const OTRO = '38827976';
const RANGO = { desde: '2026-05-01', hasta: '2026-07-31' };

const venta = (id, metodo, monto, fecha, hora = '21:00:00', extra = {}) => ({
  id, date: fecha, fechacaja: fecha, hora, turno: 6, status: 'COMPLETADO', total: monto,
  client: { name: 'Consumidor Final' },
  payments: [{ method: metodo, amount: monto }],
  payment: { total: monto, payments: [{ method: metodo, amount: monto }] },
  ...extra,
});

async function sembrar() {
  await set(ref(db, ACHAVAL), null);
  await set(ref(db, OTRO), null);

  // Ventas VIVAS del turno abierto.
  await set(ref(db, `${ACHAVAL}/MOSTRADOR/101`), venta(101, 'PREPAGO PEDIDOSYA', 10000, '20-07-2026'));
  await set(ref(db, `${ACHAVAL}/MOSTRADOR/102`), venta(102, 'Efectivo', 99999, '20-07-2026'));
  await set(ref(db, `${ACHAVAL}/PEDIDOS/501`), {
    ...venta(501, 'PREPAGO RAPPI', 7000, '20-07-2026', '20:10:00'),
    status: { main: 'ENTREGADO' },
  });

  // Ventas de TURNOS CERRADOS (BACKUP por día).
  await set(ref(db, `${ACHAVAL}/BACKUP/2026/05/12/TURNO/6/MOSTRADOR/COMPLETADOS/67`),
    venta(67, 'PREPAGO PEDIDOSYA', 18500, '12-05-2026'));
  await set(ref(db, `${ACHAVAL}/BACKUP/2026/05/12/TURNO/6/MOSTRADOR/COMPLETADOS/68`),
    venta(68, 'Efectivo', 5000, '12-05-2026'));
  await set(ref(db, `${ACHAVAL}/BACKUP/2026/06/15/TURNO/9/DELIVERY/ENTREGADOS/880`),
    { ...venta(880, 'PREPAGO RAPPI', 9000, '15-06-2026'), status: { main: 'ENTREGADO' } });
  await set(ref(db, `${ACHAVAL}/BACKUP/2026/06/15/TURNO/9/MOSTRADOR/CANCELADOS/881`),
    { ...venta(881, 'PREPAGO PEDIDOSYA', 4000, '15-06-2026'), status: 'CANCELADO' });

  // Ledger derivado: un día que YA tiene venta (12-05) y otro sin venta alcanzable (03-05).
  await set(ref(db, `${ACHAVAL}/PREPAGO_PEDIDOSYA/12052026/1`), { numero: 1, hora: '21:00:00', monto: 18500, timestamp: Date.now() });
  await set(ref(db, `${ACHAVAL}/PREPAGO_PEDIDOSYA/03052026/1`), { numero: 1, hora: '19:00:00', monto: 3000, timestamp: Date.now() });
  await set(ref(db, `${ACHAVAL}/PREPAGO_RAPPI/04-05-2026/1`), { numero: 1, hora: '18:00:00', monto: 2500, timestamp: Date.now() });

  // Otro local: NO debe aparecer nunca en las consultas de Achaval.
  await set(ref(db, `${OTRO}/MOSTRADOR/900`), venta(900, 'PREPAGO PEDIDOSYA', 55555, '20-07-2026'));
}

const leer = (raiz = ACHAVAL, opciones = RANGO) => leerVentasDeApps(db, raiz, opciones);

console.log('\n1. Ventas vivas:');
await sembrar();
let res = await leer();
await check('una venta de mostrador PedidosYa del turno abierto aparece', async () => {
  const f = res.filas.find((x) => x.referencia === 'M101');
  assert.ok(f, 'no apareció la venta viva de PedidosYa');
  assert.strictEqual(f.plataforma, 'PEDIDOSYA');
  assert.strictEqual(f.importe, 10000);
  assert.strictEqual(f.canal, 'Mostrador');
});
await check('un pedido de delivery Rappi del turno abierto aparece', async () => {
  const f = res.filas.find((x) => x.referencia === 'D501');
  assert.ok(f, 'no apareció el pedido vivo de Rappi');
  assert.strictEqual(f.plataforma, 'RAPPI');
  assert.strictEqual(f.canal, 'Delivery');
});

console.log('\n2. Ventas de turnos cerrados (BACKUP):');
await check('una venta PedidosYa de turno cerrado aparece desde el histórico', async () => {
  const f = res.filas.find((x) => x.referencia === 'M67');
  assert.ok(f, 'no apareció la venta respaldada de PedidosYa');
  assert.strictEqual(f.importe, 18500);
  assert.strictEqual(f.fecha, '12-05-2026');
  assert.strictEqual(f.origen, 'BACKUP:MOSTRADOR');
  assert.strictEqual(String(f.turno), '6');
});
await check('un pedido Rappi de turno cerrado aparece desde el histórico', async () => {
  const f = res.filas.find((x) => x.referencia === 'D880');
  assert.ok(f, 'no apareció el pedido respaldado de Rappi');
  assert.strictEqual(f.origen, 'BACKUP:DELIVERY');
});
await check('sólo se leyeron los días del rango, no toda la base', async () => {
  assert.strictEqual(res.diagnostico.diasLeidos, 92, `leyó ${res.diagnostico.diasLeidos} días para un rango de 92`);
});

console.log('\n3. Lo que NO debe aparecer:');
await check('las ventas en efectivo quedan afuera', async () => {
  assert.ok(!res.filas.some((x) => x.referencia === 'M102'), 'se colό una venta en efectivo');
  assert.ok(!res.filas.some((x) => x.referencia === 'M68'), 'se coló una venta en efectivo del BACKUP');
  assert.ok(res.filas.every((x) => ['PEDIDOSYA', 'RAPPI'].includes(x.plataforma)));
});
await check('una venta anulada no cuenta como ingreso', async () => {
  assert.ok(!res.filas.some((x) => x.referencia === 'M881'), 'se coló una venta cancelada');
});

console.log('\n4. Unión sin duplicados:');
await check('el ledger no duplica el día que ya tiene su venta', async () => {
  const del12 = res.filas.filter((x) => x.fecha === '12-05-2026' && x.plataforma === 'PEDIDOSYA');
  assert.strictEqual(del12.length, 1, `el 12-05 quedó con ${del12.length} filas`);
  assert.strictEqual(del12[0].canal, 'Mostrador', 'debería mandar la venta, no el asiento del ledger');
});
await check('el ledger aporta los días sin venta alcanzable', async () => {
  const py = res.filas.find((x) => x.fecha === '03-05-2026');
  const rp = res.filas.find((x) => x.fecha === '04-05-2026');
  assert.ok(py && py.canal === 'Prepago' && py.importe === 3000, 'falta el asiento del 03-05');
  assert.ok(rp && rp.plataforma === 'RAPPI' && rp.importe === 2500, 'falta el asiento del 04-05 (carpeta DD-MM-AAAA)');
});
await check('la misma venta viva y respaldada no se cuenta dos veces', async () => {
  // Se respalda la venta viva SIN borrarla del nodo vivo (caso de respaldo a medias).
  await set(ref(db, `${ACHAVAL}/BACKUP/2026/07/20/TURNO/6/MOSTRADOR/COMPLETADOS/101`),
    venta(101, 'PREPAGO PEDIDOSYA', 10000, '20-07-2026'));
  const r = await leer();
  const iguales = r.filas.filter((x) => x.referencia === 'M101');
  assert.strictEqual(iguales.length, 1, `la venta 101 aparece ${iguales.length} veces`);
  await set(ref(db, `${ACHAVAL}/BACKUP/2026/07/20`), null);
});

console.log('\n5. Pestañas, rango y totales:');
res = await leer();
await check('cada plataforma en su pestaña, sin mezclarse', async () => {
  const py = filtrarPorPlataforma(res.filas, 'PEDIDOSYA');
  const rp = filtrarPorPlataforma(res.filas, 'RAPPI');
  assert.deepStrictEqual(py.map((x) => x.referencia).sort(), ['#1', 'M101', 'M67']);
  assert.deepStrictEqual(rp.map((x) => x.referencia).sort(), ['#1', 'D501', 'D880']);
});
await check('el filtro de fechas es inclusivo sobre la fecha real de la venta', async () => {
  const soloMayo = filtrarPorRango(res.filas, '2026-05-01', '2026-05-12');
  assert.deepStrictEqual(soloMayo.map((x) => x.fecha).sort(), ['03-05-2026', '04-05-2026', '12-05-2026']);
  const unDia = filtrarPorRango(res.filas, '2026-05-12', '2026-05-12');
  assert.strictEqual(unDia.length, 1);
});
await check('los totales y el contador salen del conjunto mostrado', async () => {
  const py = filtrarPorPlataforma(res.filas, 'PEDIDOSYA');
  const t = calcularTotales(py, new Date(2026, 6, 20));
  assert.strictEqual(t.operaciones, py.length);
  assert.strictEqual(t.total, 10000 + 18500 + 3000);
  assert.strictEqual(t.hoy, 10000, 'HOY (20-07) debe ser sólo la venta viva');
  assert.strictEqual(t.mes, 10000, 'el mes de julio sólo tiene la venta viva');
});

console.log('\n6. Aislamiento entre locales:');
await check('la consulta de un local no trae ventas del otro', async () => {
  assert.ok(!res.filas.some((x) => x.importe === 55555), 'se coló una venta de otro local');
  assert.ok(res.filas.every((x) => x.localId === ACHAVAL));
  const otro = await leer(OTRO);
  assert.strictEqual(otro.filas.length, 1);
  assert.strictEqual(otro.filas[0].importe, 55555);
});
await check('si el local cambia en medio de la consulta, se aborta', async () => {
  let n = 0;
  await assert.rejects(
    () => leerVentasDeApps(db, ACHAVAL, { ...RANGO, seguirVigente: () => (++n <= 1) }),
    (e) => e.code === 'LOCAL_CHANGED'
  );
});

console.log('\n7. La consulta no escribe nada:');
await check('la base queda idéntica antes y después de consultar', async () => {
  const antes = JSON.stringify((await get(ref(db, ACHAVAL))).val());
  await leer();
  await leer(ACHAVAL, { ...RANGO, historialCompleto: true });
  const despues = JSON.stringify((await get(ref(db, ACHAVAL))).val());
  assert.strictEqual(despues, antes, 'la consulta modificó datos');
});

console.log('\n8. Respaldo antiguo (nodos planos):');
await check('en modo historial completo también entran BACKUP/MOSTRADOR y BACKUP/PEDIDOS', async () => {
  await set(ref(db, `${ACHAVAL}/BACKUP/MOSTRADOR/7`), venta(7, 'PREPAGO PEDIDOSYA', 1234, '10-05-2026'));
  const acotado = await leer();
  assert.ok(!acotado.filas.some((x) => x.importe === 1234), 'el nodo plano no debería leerse en el modo acotado');
  const completo = await leer(ACHAVAL, { ...RANGO, historialCompleto: true });
  const f = completo.filas.find((x) => x.importe === 1234);
  assert.ok(f, 'no apareció la venta del respaldo antiguo');
  assert.strictEqual(f.fecha, '10-05-2026');
});

await set(ref(db, ACHAVAL), null);
await set(ref(db, OTRO), null);
await deleteApp(app);
console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
