// FACTURA o REMITO — INTEGRACIÓN CONTRA EL EMULADOR REAL de Realtime Database.
//
// Recorre el circuito entero de una venta con las CUENTAS reales del local
// guardadas en /{localId}/CUENTAS: se lee el interruptor "Imprime Factura", se
// decide, y según la decisión la venta se encola en UNA cola FACTURACION_N por
// el TOTAL COMPLETO, o se le emite UN FCX por el TOTAL COMPLETO.
//
// Lo que se verifica es lo que le importa al negocio:
//   - cuenta apagada → FCX por el total, y NADA en ninguna cola fiscal;
//   - cuenta encendida → factura por el TOTAL en SU cola exacta, y ningún FCX;
//   - jamás factura y FCX por la misma venta, ni importes parciales;
//   - todo cae dentro de /{localId}, con el local como primer segmento.
//
// Correr con:
//   npm run test:comprobante-emulator
import assert from 'node:assert';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, connectDatabaseEmulator } from 'firebase/database';
import {
  COLAS_POR_CUENTA,
  COMPROBANTE_FACTURA,
  COMPROBANTE_REMITO,
  decidirComprobante,
  encoladoBloqueado,
  resolverEncolado,
} from '../facturaORemito.js';
import { emitirRemito } from '../remitosFlujo.js';
import { filasDeRemitos, rutaRemitos } from '../remitos.js';

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
const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'comprobante');
const db = getDatabase(app);
connectDatabaseEmulator(db, host, Number(port));

const ACHAVAL = '40508022';
const OTRO_LOCAL = '38827976';
const PUNTO_VENTA = '8';
const TODAS_LAS_COLAS = [...new Set(Object.values(COLAS_POR_CUENTA)), 'FACTURACION_EFECTIVO'];

/** Las 9 cuentas del local, todas apagadas salvo las que cada prueba encienda. */
const cuentasBase = (encendidas = [], favorita = 'Transferencia') => {
  const nombres = Object.keys(COLAS_POR_CUENTA).map((k) =>
    ({ 'TRANSFERENCIA': 'Transferencia', 'TRANSFERENCIA 2': 'Transferencia 2',
       'TRANSFERENCIA 3': 'Transferencia 3', 'MERCADO PAGO': 'Mercado Pago',
       'CUENTA DNI': 'Cuenta DNI', 'BANCO 1': 'Banco 1', 'BANCO 2': 'Banco 2',
       'PREPAGO PEDIDOSYA': 'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI': 'PREPAGO RAPPI' })[k]);
  const cuentas = {};
  nombres.forEach((nombre, i) => {
    cuentas[`cta-${i + 1}`] = {
      nombre,
      imprimeFactura: encendidas.includes(nombre),
      isFavorite: nombre === favorita,
    };
  });
  return cuentas;
};

const venta = (id, pagos, extra = {}) => ({
  id,
  total: pagos.reduce((s, [, monto]) => s + monto, 0),
  date: '25-07-2026',
  hora: '22:45:00',
  fechacaja: '25-07-2026',
  turno: 3,
  status: 'COMPLETADO',
  client: { name: 'Consumidor Final' },
  payments: pagos.map(([method, amount]) => ({ method, amount })),
  items: [{ nombre: 'Milanesa', cantidad: 1, valor: pagos[0]?.[1] ?? 0 }],
  ...extra,
});

/**
 * El circuito real de una venta, con el mismo orden que counterApi/ordersApi:
 * leer las cuentas del local → decidir → encolar UNA factura por el total, o
 * emitir UN FCX por el total.
 */
async function procesarVenta(raiz, v, { emiteFacturaManual = false, sembrar = true } = {}) {
  // `sembrar: false` = reproceso de una venta YA guardada. No se reescribe la
  // venta (eso borraría la marca `remito` y falsearía la idempotencia).
  if (sembrar) await set(ref(db, `${raiz}/MOSTRADOR/${v.id}`), v);

  const cuentas = (await get(ref(db, `${raiz}/CUENTAS`))).val();
  const decision = decidirComprobante({ venta: v, cuentas, emiteFacturaManual });
  const encolado = resolverEncolado(decision, cuentas);
  if (encoladoBloqueado(encolado)) return { decision, encolado, bloqueado: true, remito: null };

  const ventaGuardada = { ...v, comprobante: decision.comprobante, motivoComprobante: decision.motivo };
  await set(ref(db, `${raiz}/MOSTRADOR/${v.id}/comprobante`), decision.comprobante);

  if (encolado.estado === 'encolar') {
    await set(ref(db, `${raiz}/${encolado.cola}/M${v.id}`),
      { total: encolado.total, fecha: v.date, hora: v.hora, clientes: 'consumidor final' });
  }

  const remito = await emitirRemito({ db, raiz, venta: ventaGuardada, canal: 'mostrador', puntoVenta: PUNTO_VENTA });
  return { decision, encolado, bloqueado: false, remito };
}

/** Todo lo que quedó en cualquier cola fiscal del local para esta venta. */
const enFacturacion = async (raiz, ventaId) => {
  const encontrado = [];
  for (const cola of TODAS_LAS_COLAS) {
    const snap = await get(ref(db, `${raiz}/${cola}/M${ventaId}`));
    if (snap.exists()) encontrado.push({ cola, total: snap.val().total });
  }
  return encontrado;
};

const remitosDe = async (raiz) => (await get(ref(db, rutaRemitos(raiz)))).val() || {};

/** El invariante central: por una venta sale UN comprobante, nunca dos. */
async function afirmarUnSoloComprobante(raiz, v, resultado, esperado) {
  const colas = await enFacturacion(raiz, v.id);
  const marca = (await get(ref(db, `${raiz}/MOSTRADOR/${v.id}/remito`))).val();

  if (esperado === COMPROBANTE_FACTURA) {
    assert.strictEqual(colas.length, 1, `esperaba 1 cola, hubo ${colas.length}: ${colas.map((c) => c.cola)}`);
    assert.strictEqual(colas[0].total, v.total, 'facturó un importe parcial');
    assert.strictEqual(resultado.remito.estado, 'omitido', 'emitió FCX además de la factura');
    assert.strictEqual(marca, null, 'la venta quedó marcada con un remito');
  } else {
    assert.deepStrictEqual(colas, [], 'una venta a remito entró en una cola fiscal');
    assert.strictEqual(resultado.remito.estado, 'emitido');
    const guardado = (await get(ref(db, `${raiz}/Remitos/${resultado.remito.numeroComprobante}`))).val();
    assert.ok(guardado, 'el FCX no quedó en /{localId}/Remitos');
    assert.strictEqual(guardado.total, v.total, 'el FCX no cubre el total de la venta');
    assert.strictEqual(guardado.tipo, 'FCX');
    assert.strictEqual(guardado.localId, raiz);
    assert.strictEqual(guardado.facturado, false);
    assert.strictEqual(marca, resultado.remito.numeroComprobante);
  }
  return colas;
}

async function limpiar(cuentas = cuentasBase()) {
  await set(ref(db, ACHAVAL), null);
  await set(ref(db, OTRO_LOCAL), null);
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentas);
}

let id = 100;

console.log('\n1. Tilde OFF y todas las cuentas apagadas → UN FCX por el total:');
await limpiar();
for (const nombreCuenta of ['Efectivo', 'Transferencia', 'Transferencia 2', 'Transferencia 3',
                            'Mercado Pago', 'Cuenta DNI', 'Banco 1', 'Banco 2',
                            'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI']) {
  await check(`"${nombreCuenta}" apagada → FCX en /${ACHAVAL}/Remitos, nada en facturación`, async () => {
    const v = venta(++id, [[nombreCuenta, 8000]]);
    const r = await procesarVenta(ACHAVAL, v);
    assert.strictEqual(r.decision.comprobante, COMPROBANTE_REMITO);
    await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_REMITO);
  });
}
await check('una cuenta nueva, con cualquier nombre, se comporta igual', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS/cta-99`), { nombre: 'Billetera Futura', imprimeFactura: false });
  const v = venta(++id, [['Billetera Futura', 4500]]);
  const r = await procesarVenta(ACHAVAL, v);
  await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_REMITO);
  await set(ref(db, `${ACHAVAL}/CUENTAS/cta-99`), null);
});

console.log('\n2. Cuenta encendida → UNA factura por el TOTAL, en SU cola exacta:');
for (const [nombreCuenta, colaEsperada] of [
  ['Transferencia', 'FACTURACION_1'],
  ['Transferencia 2', 'FACTURACION_2'],
  ['Transferencia 3', 'FACTURACION_3'],
  ['Mercado Pago', 'FACTURACION_4'],
  ['Cuenta DNI', 'FACTURACION_5'],
  ['Banco 1', 'FACTURACION_6'],
  ['Banco 2', 'FACTURACION_7'],
  ['PREPAGO PEDIDOSYA', 'FACTURACION_8'],
  ['PREPAGO RAPPI', 'FACTURACION_9'],
]) {
  await check(`"${nombreCuenta}" encendida → ${colaEsperada} por el total, ningún FCX`, async () => {
    await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase([nombreCuenta], nombreCuenta));
    const v = venta(++id, [[nombreCuenta, 12000]]);
    const r = await procesarVenta(ACHAVAL, v);
    assert.strictEqual(r.decision.comprobante, COMPROBANTE_FACTURA);
    const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
    assert.strictEqual(colas[0].cola, colaEsperada);
  });
}
await check('"Transferencia 2" encendida NUNCA escribe en FACTURACION_1', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase(['Transferencia 2'], 'Transferencia 2'));
  const v = venta(++id, [['Transferencia 2', 5000]]);
  const r = await procesarVenta(ACHAVAL, v);
  const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
  assert.strictEqual(colas[0].cola, 'FACTURACION_2');
  assert.strictEqual((await get(ref(db, `${ACHAVAL}/FACTURACION_1/M${v.id}`))).exists(), false);
});

console.log('\n3. Pagos combinados (Opción A):');
await check('Efectivo false + Transferencia true → factura TOTAL por FACTURACION_1', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase(['Transferencia'], 'Transferencia'));
  const v = venta(++id, [['Efectivo', 3000], ['Transferencia', 2000]]);
  const r = await procesarVenta(ACHAVAL, v);
  const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
  assert.deepStrictEqual(colas, [{ cola: 'FACTURACION_1', total: 5000 }]);
});
await check('Efectivo false + Mercado Pago true → factura TOTAL por FACTURACION_4', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase(['Mercado Pago'], 'Mercado Pago'));
  const v = venta(++id, [['Efectivo', 3000], ['Mercado Pago', 1500]]);
  const r = await procesarVenta(ACHAVAL, v);
  const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
  assert.deepStrictEqual(colas, [{ cola: 'FACTURACION_4', total: 4500 }]);
});
await check('Transferencia true + Mercado Pago true → UNA sola factura total, ningún FCX', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase(['Transferencia', 'Mercado Pago'], 'Transferencia'));
  const v = venta(++id, [['Transferencia', 2000], ['Mercado Pago', 4000]]);
  const r = await procesarVenta(ACHAVAL, v);
  const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
  assert.deepStrictEqual(colas, [{ cola: 'FACTURACION_1', total: 6000 }]);
});
await check('todas las cuentas usadas en true → UNA sola factura total', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`),
    cuentasBase(['Transferencia 2', 'Banco 1', 'Cuenta DNI'], 'Banco 1'));
  const v = venta(++id, [['Transferencia 2', 1000], ['Banco 1', 2000], ['Cuenta DNI', 3000]]);
  const r = await procesarVenta(ACHAVAL, v);
  const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
  assert.deepStrictEqual(colas, [{ cola: 'FACTURACION_6', total: 6000 }]);
});
await check('todas apagadas en un pago combinado → UN FCX por el total', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase([], 'Transferencia'));
  const v = venta(++id, [['Efectivo', 3000], ['Transferencia', 2000], ['Mercado Pago', 1000]]);
  const r = await procesarVenta(ACHAVAL, v);
  await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_REMITO);
  const guardado = (await get(ref(db, `${ACHAVAL}/Remitos/${r.remito.numeroComprobante}`))).val();
  assert.strictEqual(guardado.formaPago, 'Efectivo + Transferencia + Mercado Pago');
  assert.strictEqual(Object.keys(guardado.pagos).length, 3);
});

console.log('\n4. Tilde manual "Emite Factura" (override):');
await check('todas apagadas + tilde ON → BLOQUEA: la favorita de cobro no factura', async () => {
  // "Banco 2" es la favorita pero tiene "Imprime Factura" apagado, igual que
  // todas. Una cuenta de COBRO no fiscal no puede emitir: se detiene con un
  // mensaje claro y NO se degrada a remito, porque el usuario pidió factura.
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase([], 'Banco 2'));
  const v = venta(++id, [['Efectivo', 3000], ['Transferencia', 4000]], { emiteFactura: true });
  const r = await procesarVenta(ACHAVAL, v, { emiteFacturaManual: true });
  assert.strictEqual(r.decision.motivo, 'tilde-manual');
  assert.strictEqual(r.decision.comprobante, COMPROBANTE_FACTURA);
  assert.strictEqual(r.bloqueado, true);
  assert.strictEqual(r.encolado.estado, 'sin-cola');
  assert.deepStrictEqual(await enFacturacion(ACHAVAL, v.id), [], 'no entra en ninguna cola');
  assert.strictEqual((await get(ref(db, `${ACHAVAL}/MOSTRADOR/${v.id}/remito`))).val(), null,
    'no se emite un FCX como reemplazo de una factura');
});

await check('todas apagadas + tilde ON + UNA cuenta fiscal → usa esa, no la favorita', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase(['Cuenta DNI'], 'Banco 2'));
  const v = venta(++id, [['Efectivo', 3000], ['Transferencia', 4000]], { emiteFactura: true });
  const r = await procesarVenta(ACHAVAL, v, { emiteFacturaManual: true });
  const colas = await afirmarUnSoloComprobante(ACHAVAL, v, r, COMPROBANTE_FACTURA);
  assert.deepStrictEqual(colas, [{ cola: 'FACTURACION_5', total: 7000 }],
    'la única con "Imprime Factura" encendido es Cuenta DNI → FACTURACION_5');
});

console.log('\n5. Configuración que NO permite decidir: se detiene, no cae a FCX:');
await check('cuenta encendida sin cola asignada → bloqueo, sin factura y sin FCX', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), { 'cta-1': { nombre: 'Billetera Futura', imprimeFactura: true, isFavorite: true } });
  const v = venta(++id, [['Billetera Futura', 3000]]);
  const r = await procesarVenta(ACHAVAL, v);
  assert.strictEqual(r.bloqueado, true);
  assert.strictEqual(r.encolado.estado, 'sin-cola');
  assert.deepStrictEqual(await enFacturacion(ACHAVAL, v.id), []);
  assert.strictEqual((await get(ref(db, `${ACHAVAL}/MOSTRADOR/${v.id}/remito`))).val(), null,
    'se emitió un FCX como fallback de una venta que debía facturarse');
});
await check('varias encendidas y la favorita no es una de ellas → bloqueo, sin factura y sin FCX', async () => {
  await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase(['Transferencia', 'Mercado Pago'], 'Banco 2'));
  const v = venta(++id, [['Transferencia', 2000], ['Mercado Pago', 4000]]);
  const r = await procesarVenta(ACHAVAL, v);
  assert.strictEqual(r.bloqueado, true);
  assert.strictEqual(r.encolado.estado, 'ambiguo');
  assert.deepStrictEqual(await enFacturacion(ACHAVAL, v.id), []);
  assert.strictEqual((await get(ref(db, `${ACHAVAL}/MOSTRADOR/${v.id}/remito`))).val(), null);
});

console.log('\n6. Idempotencia, contador y pestaña Remitos:');
await set(ref(db, `${ACHAVAL}/CUENTAS`), cuentasBase([], 'Transferencia'));
await check('reprocesar la venta NO genera un segundo comprobante', async () => {
  const v = venta(++id, [['Efectivo', 5000]]);
  const primera = await procesarVenta(ACHAVAL, v);
  assert.strictEqual(primera.remito.estado, 'emitido');
  const segunda = await procesarVenta(ACHAVAL, v, { sembrar: false });
  assert.strictEqual(segunda.remito.estado, 'ya-emitido');
  assert.strictEqual(segunda.remito.numeroComprobante, primera.remito.numeroComprobante);
  assert.deepStrictEqual(await enFacturacion(ACHAVAL, v.id), []);
});
await check('el contador vive en /{localId}/CONTADORES/remitos y avanza de a uno', async () => {
  const contador = (await get(ref(db, `${ACHAVAL}/CONTADORES/remitos`))).val();
  const emitidos = Object.keys(await remitosDe(ACHAVAL)).length;
  assert.strictEqual(contador, emitidos, `contador ${contador} vs ${emitidos} remitos`);
});
await check('todos los FCX se ven en la pestaña Remitos y se pueden reimprimir', async () => {
  const filas = filasDeRemitos(await remitosDe(ACHAVAL));
  assert.ok(filas.length > 0);
  assert.ok(filas.every((f) => f.esRemito && !f.facturado));
  assert.ok(filas.every((f) => String(f.numeroFactura).startsWith('FCX')));
  assert.ok(filas.every((f) => f.articulos.length > 0 && f.importe > 0), 'faltan datos para reimprimir');
});

console.log('\n7. Aislamiento entre locales:');
await check(`Achaval escribe SOLO dentro de /${ACHAVAL}`, async () => {
  assert.strictEqual((await get(ref(db, 'Remitos'))).val(), null, 'hay un /Remitos global');
  const raiz = (await get(ref(db, '/'))).val() || {};
  const fuera = Object.keys(raiz).filter((k) => k !== ACHAVAL && k !== OTRO_LOCAL);
  assert.deepStrictEqual(fuera, [], `se escribió fuera del local: ${fuera.join(', ')}`);
});
await check('otro local usa SU propia ruta y sus propias cuentas', async () => {
  // Mismo nombre de cuenta, interruptor al revés: cada local decide con lo suyo.
  await set(ref(db, `${OTRO_LOCAL}/CUENTAS`),
    { 'cta-1': { nombre: 'Transferencia', imprimeFactura: true, isFavorite: true } });
  const primera = venta(1, [['Transferencia', 6000]]);
  const r1 = await procesarVenta(OTRO_LOCAL, primera);
  assert.strictEqual(r1.decision.comprobante, COMPROBANTE_FACTURA, 'usó las cuentas del otro local');
  await afirmarUnSoloComprobante(OTRO_LOCAL, primera, r1, COMPROBANTE_FACTURA);

  await set(ref(db, `${OTRO_LOCAL}/CUENTAS/cta-1/imprimeFactura`), false);
  const segunda = venta(2, [['Transferencia', 6000]]);
  const r2 = await procesarVenta(OTRO_LOCAL, segunda);
  await afirmarUnSoloComprobante(OTRO_LOCAL, segunda, r2, COMPROBANTE_REMITO);
  assert.strictEqual(r2.remito.numeroComprobante, 'FCX0008-00000001', 'no arrancó su propia secuencia');
  assert.ok(!Object.keys(await remitosDe(ACHAVAL)).includes('FCX0008-00000001') ||
    (await remitosDe(OTRO_LOCAL))['FCX0008-00000001'].localId === OTRO_LOCAL);
});

console.log('\n8. Emitir el comprobante no duplica nada más:');
await check('no se toca stock, caja, estadísticas, comisiones ni la venta', async () => {
  await set(ref(db, `${ACHAVAL}/CAJAS`), { '25-07-2026': { turnos: { 3: { fondoInicial: 1000 } } } });
  await set(ref(db, `${ACHAVAL}/ESTADISTICAS`), { '25-07-2026': { '156A': 4 } });
  await set(ref(db, `${ACHAVAL}/MATERIAPRIMA`), { harina: { stock: 50 } });
  await set(ref(db, `${ACHAVAL}/RESUMEN_CUENTA`), { '2026-07-25': { total: 99000 } });

  const v = venta(++id, [['Efectivo', 2500]]);
  await set(ref(db, `${ACHAVAL}/MOSTRADOR/${v.id}`), v);
  const antes = (await get(ref(db, ACHAVAL))).val();

  const cuentas = (await get(ref(db, `${ACHAVAL}/CUENTAS`))).val();
  const decision = decidirComprobante({ venta: v, cuentas });
  const r = await emitirRemito({
    db, raiz: ACHAVAL, venta: { ...v, comprobante: decision.comprobante },
    canal: 'mostrador', puntoVenta: PUNTO_VENTA,
  });
  assert.strictEqual(r.estado, 'emitido');
  const despues = (await get(ref(db, ACHAVAL))).val();

  for (const nodo of ['CAJAS', 'ESTADISTICAS', 'MATERIAPRIMA', 'RESUMEN_CUENTA', 'VENTAS', 'CUENTAS']) {
    assert.deepStrictEqual(despues[nodo], antes[nodo], `cambió ${nodo}`);
  }
  assert.strictEqual(Object.keys(despues.MOSTRADOR).length, Object.keys(antes.MOSTRADOR).length,
    'se creó otra venta');

  const ventaDespues = { ...despues.MOSTRADOR[String(v.id)] };
  assert.strictEqual(ventaDespues.remito, r.numeroComprobante);
  delete ventaDespues.remito;
  assert.deepStrictEqual(ventaDespues, antes.MOSTRADOR[String(v.id)],
    'la venta cambió en algo más que la marca del remito');
});

console.log('\n9. Invariante final sobre TODO lo escrito:');
await check('ninguna venta quedó con factura Y FCX a la vez', async () => {
  const raiz = (await get(ref(db, ACHAVAL))).val() || {};
  const facturadas = new Set();
  for (const cola of TODAS_LAS_COLAS) {
    for (const clave of Object.keys(raiz[cola] || {})) facturadas.add(clave.replace(/^[MD]/, ''));
  }
  const conRemito = Object.entries(raiz.MOSTRADOR || {})
    .filter(([, v]) => v && v.remito)
    .map(([k]) => k);
  const duplicadas = conRemito.filter((id) => facturadas.has(id));
  assert.deepStrictEqual(duplicadas, [], `ventas con factura Y FCX: ${duplicadas.join(', ')}`);
  assert.ok(facturadas.size > 0 && conRemito.length > 0, 'la prueba no ejercitó los dos caminos');
});
await check('ninguna factura se emitió por un importe parcial', async () => {
  const raiz = (await get(ref(db, ACHAVAL))).val() || {};
  for (const cola of TODAS_LAS_COLAS) {
    for (const [clave, factura] of Object.entries(raiz[cola] || {})) {
      const ventaOriginal = (raiz.MOSTRADOR || {})[clave.replace(/^[MD]/, '')];
      if (!ventaOriginal) continue;
      assert.strictEqual(factura.total, ventaOriginal.total,
        `${cola}/${clave} facturó ${factura.total} de una venta de ${ventaOriginal.total}`);
    }
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
process.exit(process.exitCode || 0);
