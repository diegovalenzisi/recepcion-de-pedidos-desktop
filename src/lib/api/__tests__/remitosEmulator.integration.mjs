// REMITOS (FCX) — INTEGRACIÓN CONTRA EL EMULADOR REAL de Realtime Database.
//
// Prueba el flujo completo con transacciones y dos clientes concurrentes, que
// es donde se juegan las garantías: numeración sin repetidos, idempotencia,
// aislamiento entre locales y que NO se toque nada fuera de /{localId}/Remitos.
//
// Correr con:
//   npm run test:remitos-emulator
//   (o) firebase emulators:exec --only database --project stock-test \
//         --config emulator/firebase.json \
//         "node src/lib/api/__tests__/remitosEmulator.integration.mjs"
import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, ref, get, set, connectDatabaseEmulator } from 'firebase/database';
import { emitirRemito, rutaMarcaDeVenta } from '../remitosFlujo.js';
import { filasDeRemitos, rutaRemitos, totalNoFacturado } from '../remitos.js';

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) {
  console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST: hay que correrlo con `firebase emulators:exec`.');
  process.exit(1);
}
const [host, port] = HOST.split(':');

function nuevoCliente(nombre) {
  const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, nombre);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, Number(port));
  return { app, db };
}

const A = nuevoCliente('remitosA');
const B = nuevoCliente('remitosB');

const ACHAVAL = '40508022';
const OTRO_LOCAL = '38827976';

const ventaMostrador = (id, total = 5700) => ({
  id,
  total,
  date: '25-07-2026',
  hora: '22:45:00',
  fechacaja: '25-07-2026',
  turno: 3,
  emiteFactura: false,
  status: 'COMPLETADO',
  client: { name: 'Consumidor Final' },
  payments: [{ method: 'Efectivo', amount: total }],
  items: [{ nombre: 'Milanesa', cantidad: 1, valor: total }],
});

const sembrarVenta = async (raiz, venta) => {
  await set(ref(A.db, `${raiz}/MOSTRADOR/${venta.id}`), venta);
};

const emitir = (db, raiz, venta, canal = 'mostrador', puntoVenta = '8') =>
  emitirRemito({ db, raiz, venta, canal, puntoVenta });

const leerRaiz = async (raiz) => (await get(ref(A.db, raiz))).val() || {};

async function limpiar() {
  await set(ref(A.db, ACHAVAL), null);
  await set(ref(A.db, OTRO_LOCAL), null);
}

console.log('\n1. Una venta sin facturar genera su remito FCX en /{localId}/Remitos:');
await limpiar();
await check('se emite y queda en la ruta canónica', async () => {
  const venta = ventaMostrador(27);
  await sembrarVenta(ACHAVAL, venta);
  const r = await emitir(A.db, ACHAVAL, venta);
  assert.strictEqual(r.estado, 'emitido');
  assert.strictEqual(r.numeroComprobante, 'FCX0008-00000001');

  const guardado = (await get(ref(A.db, `${ACHAVAL}/Remitos/FCX0008-00000001`))).val();
  assert.ok(guardado, 'el remito no está en /40508022/Remitos');
  assert.strictEqual(guardado.total, 5700);
  assert.strictEqual(guardado.facturado, false);
  assert.strictEqual(guardado.localId, ACHAVAL);
  assert.strictEqual(guardado.origen.id, '27');
});
await check('la venta de origen queda anotada con su remito y sin ningún otro cambio', async () => {
  const venta = (await get(ref(A.db, `${ACHAVAL}/MOSTRADOR/27`))).val();
  assert.strictEqual(venta.remito, 'FCX0008-00000001');
  assert.strictEqual(venta.total, 5700, 'se modificó el total de la venta');
  assert.strictEqual(venta.status, 'COMPLETADO', 'se modificó el estado de la venta');
});
await check('la pestaña la ve: contador 1 y datos para la tabla', async () => {
  const filas = filasDeRemitos((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val());
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].numeroFactura, 'FCX0008-00000001');
  assert.strictEqual(filas[0].fecha, '25-07-2026');
  assert.strictEqual(filas[0].hora, '22:45:00');
  assert.strictEqual(filas[0].importe, 5700);
  assert.strictEqual(filas[0].articulos.length, 1);
});

console.log('\n2. Reprocesar la misma venta NO duplica el remito:');
await check('la segunda emisión devuelve el mismo número y no escribe otro', async () => {
  const venta = ventaMostrador(27);
  const r = await emitir(A.db, ACHAVAL, venta);
  assert.strictEqual(r.estado, 'ya-emitido');
  assert.strictEqual(r.numeroComprobante, 'FCX0008-00000001');
  const todos = (await get(ref(A.db, rutaRemitos(ACHAVAL)))).val() || {};
  assert.strictEqual(Object.keys(todos).length, 1, 'se emitió un segundo remito');
});
await check('dos terminales emitiendo la misma venta a la vez emiten UNO solo', async () => {
  const venta = ventaMostrador(28, 3000);
  await sembrarVenta(ACHAVAL, venta);
  const [r1, r2] = await Promise.all([
    emitir(A.db, ACHAVAL, venta),
    emitir(B.db, ACHAVAL, venta),
  ]);
  const emitidos = [r1, r2].filter((r) => r.estado === 'emitido');
  assert.strictEqual(emitidos.length, 1, `emitieron ${emitidos.length} remitos para la misma venta`);
  const marca = (await get(ref(A.db, rutaMarcaDeVenta(ACHAVAL, 'mostrador', 28)))).val();
  assert.strictEqual(marca, emitidos[0].numeroComprobante);
});

console.log('\n3. Numeración:');
await check('la secuencia avanza de a uno y no repite', async () => {
  const numeros = new Set();
  for (const id of [31, 32, 33]) {
    const venta = ventaMostrador(id, 1000);
    await sembrarVenta(ACHAVAL, venta);
    const r = await emitir(A.db, ACHAVAL, venta);
    assert.strictEqual(r.estado, 'emitido');
    numeros.add(r.numeroComprobante);
  }
  assert.strictEqual(numeros.size, 3, 'hay números repetidos');
  assert.ok(numeros.has('FCX0008-00000003'), `esperaba llegar a FCX0008-00000003, salió ${[...numeros].join(', ')}`);
});
await check('el contador vive dentro del local', async () => {
  const contador = (await get(ref(A.db, `${ACHAVAL}/CONTADORES/remitos`))).val();
  assert.strictEqual(contador, 5);
});

console.log('\n4. Una venta que SÍ se factura no genera remito:');
await check('emiteFactura=true → omitido, sin escribir nada', async () => {
  const venta = { ...ventaMostrador(40, 8000), emiteFactura: true };
  await sembrarVenta(ACHAVAL, venta);
  const antes = Object.keys((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val() || {}).length;
  const r = await emitir(A.db, ACHAVAL, venta);
  assert.strictEqual(r.estado, 'omitido');
  assert.strictEqual(r.motivo, 'la-venta-se-factura');
  const despues = Object.keys((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val() || {}).length;
  assert.strictEqual(despues, antes);
  assert.strictEqual((await get(ref(A.db, `${ACHAVAL}/MOSTRADOR/40/remito`))).val(), null);
});
await check('comprobante=FACTURA (cuenta con "Imprime Factura") → omitido, sin FCX', async () => {
  const venta = { ...ventaMostrador(41, 8000), comprobante: 'FACTURA', motivoComprobante: 'cuenta-imprime-factura' };
  await sembrarVenta(ACHAVAL, venta);
  const antes = Object.keys((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val() || {}).length;
  const r = await emitir(A.db, ACHAVAL, venta);
  assert.strictEqual(r.estado, 'omitido');
  assert.strictEqual(r.motivo, 'la-venta-se-factura');
  const despues = Object.keys((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val() || {}).length;
  assert.strictEqual(despues, antes);
  assert.strictEqual((await get(ref(A.db, `${ACHAVAL}/MOSTRADOR/41/remito`))).val(), null);
});
await check('comprobante=REMITO manda sobre un emiteFactura viejo → sí emite FCX', async () => {
  const venta = { ...ventaMostrador(42, 8000), emiteFactura: true, comprobante: 'REMITO' };
  await sembrarVenta(ACHAVAL, venta);
  const r = await emitir(A.db, ACHAVAL, venta);
  assert.strictEqual(r.estado, 'emitido');
  assert.ok((await get(ref(A.db, `${ACHAVAL}/Remitos/${r.numeroComprobante}`))).exists());
});
await check('una factura FCB en VENTAS no aparece entre los remitos', async () => {
  await set(ref(A.db, `${ACHAVAL}/VENTAS/FCB0008-00010295`), {
    CLIENTE: 'Consumidor Final', FECHA: '25-07-2026', HORA: '22:50:00', IMPORTE: 8000, NumeroFactura: 'FCB0008-00010295',
  });
  const filas = filasDeRemitos((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val());
  assert.ok(filas.every((f) => !String(f.numeroFactura).startsWith('FCB')), 'se coló una factura en Remitos');
});
await check('un remito facturado a posteriori sigue listado, pero no suma dos veces', async () => {
  const antes = filasDeRemitos((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val());
  await set(ref(A.db, `${ACHAVAL}/Remitos/FCX0008-00000001/facturado`), true);
  const despues = filasDeRemitos((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val());

  assert.strictEqual(despues.length, antes.length, 'el remito facturado desapareció del listado');
  const fila = despues.find((f) => f.numeroFactura === 'FCX0008-00000001');
  assert.strictEqual(fila.facturado, true);
  assert.ok((await get(ref(A.db, `${ACHAVAL}/Remitos/FCX0008-00000001`))).exists(), 'se borró el remito en vez de marcarlo');
  // El importe ya está contado en Facturación: sale del total de Remitos.
  assert.strictEqual(totalNoFacturado(despues), totalNoFacturado(antes) - fila.importe);

  await set(ref(A.db, `${ACHAVAL}/Remitos/FCX0008-00000001/facturado`), false);
});

console.log('\n5. Aislamiento entre locales:');
await check('cada local escribe SOLO en su propia ruta', async () => {
  const venta = ventaMostrador(7, 4200);
  await set(ref(A.db, `${OTRO_LOCAL}/MOSTRADOR/7`), venta);
  const r = await emitir(A.db, OTRO_LOCAL, venta, 'mostrador', '1');
  assert.strictEqual(r.estado, 'emitido');
  assert.strictEqual(r.numeroComprobante, 'FCX0001-00000001');

  const deAchaval = Object.keys((await get(ref(A.db, rutaRemitos(ACHAVAL)))).val() || {});
  const delOtro = Object.keys((await get(ref(A.db, rutaRemitos(OTRO_LOCAL)))).val() || {});
  assert.ok(!deAchaval.includes('FCX0001-00000001'), 'un remito de otro local apareció en Achaval');
  assert.deepStrictEqual(delOtro, ['FCX0001-00000001']);
});
await check('no existe /Remitos global ni /Remitos/{localId}', async () => {
  const raizGlobal = (await get(ref(A.db, 'Remitos'))).val();
  assert.strictEqual(raizGlobal, null, 'se escribió un nodo /Remitos en la raíz');
});

console.log('\n6. No se toca nada más:');
await check('emitir un remito no crea ni modifica CAJAS, ESTADISTICAS ni VENTAS', async () => {
  await set(ref(A.db, `${ACHAVAL}/CAJAS`), { '25-07-2026': { turnos: { 3: { fondoInicial: 1000 } } } });
  await set(ref(A.db, `${ACHAVAL}/ESTADISTICAS`), { '25-07-2026': { '156A': 4 } });

  const venta = ventaMostrador(99, 6100);
  await sembrarVenta(ACHAVAL, venta);
  const antes = await leerRaiz(ACHAVAL);   // foto con la venta ya guardada, antes del remito

  await emitir(A.db, ACHAVAL, venta);
  const despues = await leerRaiz(ACHAVAL);

  assert.deepStrictEqual(despues.CAJAS, antes.CAJAS, 'cambió CAJAS');
  assert.deepStrictEqual(despues.ESTADISTICAS, antes.ESTADISTICAS, 'cambió ESTADISTICAS');
  assert.deepStrictEqual(despues.VENTAS, antes.VENTAS, 'cambió VENTAS (ruta fiscal)');

  // Lo único que cambia en la venta es la marca `remito`.
  const ventaAntes = { ...antes.MOSTRADOR['99'] };
  const ventaDespues = { ...despues.MOSTRADOR['99'] };
  assert.ok(ventaDespues.remito, 'la venta no quedó marcada');
  delete ventaDespues.remito;
  assert.deepStrictEqual(ventaDespues, ventaAntes, 'la venta cambió en algo más que la marca del remito');
});

console.log('\n7. Delivery:');
await check('un pedido entregado sin facturar genera su remito en PEDIDOS', async () => {
  const pedido = {
    id: 881, total: 9000, date: '25-07-2026', hora: '20:10:00', emiteFactura: false,
    client: { name: 'Ana', address: 'Achaval 3703' },
    payment: { total: 9000, method: 'Efectivo' },
    items: [{ nombre: 'Pizza', cantidad: 1, valor: 9000 }],
    status: { main: 'ENTREGADO' },
  };
  await set(ref(A.db, `${ACHAVAL}/PEDIDOS/881`), pedido);
  const r = await emitir(A.db, ACHAVAL, pedido, 'delivery');
  assert.strictEqual(r.estado, 'emitido');
  const guardado = (await get(ref(A.db, `${ACHAVAL}/Remitos/${r.numeroComprobante}`))).val();
  assert.strictEqual(guardado.canal, 'delivery');
  assert.strictEqual(guardado.cliente, 'Ana');
  assert.strictEqual((await get(ref(A.db, rutaMarcaDeVenta(ACHAVAL, 'delivery', 881)))).val(), r.numeroComprobante);
});

await limpiar();
await Promise.all([deleteApp(A.app), deleteApp(B.app)]);
console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
