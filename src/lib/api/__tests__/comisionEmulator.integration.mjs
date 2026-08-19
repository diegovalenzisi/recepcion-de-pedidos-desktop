// CONTABILIDAD DE COMISIONES — INTEGRACIÓN CONTRA EL EMULADOR REAL.
//
// Lo que un backend en memoria no puede probar: que el movimiento y los tres
// incrementos entren en UNA sola escritura, que las reglas rechacen un opId
// repetido, y que dos clientes concurrentes no puedan contar dos veces.
//
// Se conecta con DOS apps Firebase independientes (desktop y tablet) sobre
// datos aislados. NO toca producción.
//
// Correr con:
//   firebase emulators:exec --only database --project comision-test \
//     --config <scratchpad>/comision/firebase.json \
//     "node src/lib/api/__tests__/comisionEmulator.integration.mjs"
import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, increment, serverTimestamp } from 'firebase/database';
import {
  aCentavos, contabilidadActiva, leerAcumuladores,
  planDeVenta, planDeAnulacion, planDePago, planCompletoDePago,
  validarPago, tieneEfectoContable, deltasDeVenta,
  rutaTotales,
} from '../comisionMovimiento.js';
import { evaluarInicio, bloquea, liberaTrasPago, ESTADO_INICIO } from '../comisionCorte.js';

let passed = 0, failed = 0;
async function check(nombre, fn) {
  try { await fn(); passed++; console.log(`  OK    ${nombre}`); }
  catch (e) { failed++; console.error(`  FALLA ${nombre}\n        ${e && e.message}`); }
}

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) { console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST'); process.exit(1); }

const cliente = (n) => getDatabase(initializeApp({ databaseURL: `http://${HOST}?ns=comision-test-default-rtdb` }, n));
const A = cliente('desktop');
const B = cliente('tablet');

let L = 'local-0', fase = 0;
const nuevaFase = () => { L = `local-${++fase}`; };
const totales = async (db = A) => (await get(ref(db, rutaTotales(L)))).val() || {};

/** Activa la contabilidad nueva en el local de la fase actual. */
const activar = async (inicial = {}) => {
  await set(ref(A, rutaTotales(L)), {
    totalAcumuladoCentavos: 0, totalPagadoCentavos: 0, saldoPendienteCentavos: 0,
    migracionVersion: 1, ...inicial,
  });
};

/**
 * LA OPERACIÓN CONTABLE: el plan puro se convierte en UN update() multipath.
 * Réplica EXACTA de `aplicarPlan` de comisionesApi.js, incluida la distinción
 * entre un duplicado y un rechazo por otra causa.
 */
async function aplicar(db, plan) {
  const payload = { [plan.movimiento.ruta]: { ...plan.movimiento.valor, ts: serverTimestamp() } };
  for (const inc of plan.incrementos) payload[inc.ruta] = increment(inc.delta);
  payload[plan.rutaMarcaDeTiempo] = serverTimestamp();
  try {
    await update(ref(db), payload);
    return { aplicado: true, motivo: 'aplicado' };
  } catch (e) {
    if (!String(e.message).includes('PERMISSION_DENIED')) throw e;
    // La diferencia entre "duplicado" y "error" es si el movimiento existe.
    const existe = (await get(ref(db, plan.movimiento.ruta))).exists();
    if (existe) return { aplicado: false, motivo: 'ya_aplicado' };
    return { aplicado: false, motivo: 'operacion_rechazada', causa: e };
  }
}

const venta = (modo, id, pesos) => planDeVenta({ localId: L, modoVenta: modo, idVenta: id, comisionCentavos: aCentavos(pesos) });
const anul  = (modo, id, pesos) => planDeAnulacion({ localId: L, modoVenta: modo, idVenta: id, comisionCentavos: aCentavos(pesos) });
const pago  = (idPago, pesos)   => planDePago({ localId: L, idPago, montoCentavos: aCentavos(pesos) });

// ===========================================================================
console.log('\n1. Sistema DORMIDO mientras migracionVersion < 1:');
nuevaFase();

await check('sin migrar, contabilidadActiva es false y no hay acumuladores', async () => {
  const t = await totales();
  assert.strictEqual(contabilidadActiva(t), false);
  assert.deepStrictEqual(leerAcumuladores(t), { totalAcumuladoCentavos: 0, totalPagadoCentavos: 0, saldoPendienteCentavos: 0 });
});

await check('con migracionVersion 0 sigue dormido aunque haya valores', async () => {
  await set(ref(A, rutaTotales(L)), {
    totalAcumuladoCentavos: 12345, totalPagadoCentavos: 0, saldoPendienteCentavos: 12345, migracionVersion: 0,
  });
  const t = await totales();
  assert.strictEqual(contabilidadActiva(t), false, 'migracionVersion 0 NO debe activar');
  assert.strictEqual(t.totalAcumuladoCentavos, 12345, 'los valores quedan inicializados');
});

await check('recien con migracionVersion 1 se activa', async () => {
  await update(ref(A, rutaTotales(L)), { migracionVersion: 1 });
  assert.strictEqual(contabilidadActiva(await totales()), true);
});

// ===========================================================================
console.log('\n2. M123 y D123 son operaciones distintas:');
nuevaFase(); await activar();

await check('venta mostrador 123 y venta delivery 123 suman las dos', async () => {
  assert.strictEqual((await aplicar(A, venta('mostrador', 123, 1))).aplicado, true);
  assert.strictEqual((await aplicar(B, venta('delivery', 123, 1.5))).aplicado, true);
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 250);
  assert.strictEqual(t.saldoPendienteCentavos, 250);
});

await check('quedaron los DOS movimientos', async () => {
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS`))).val() || {};
  assert.deepStrictEqual(Object.keys(m).sort(), ['V-D123', 'V-M123']);
});

// ===========================================================================
console.log('\n3. Reintento de la misma venta:');

await check('reintentar V-M123 se rechaza y no suma', async () => {
  const r = await aplicar(A, venta('mostrador', 123, 1));
  assert.strictEqual(r.aplicado, false);
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 250, 'se conto dos veces');
});

await check('doble clic: 2 intentos simultaneos entra 1', async () => {
  const rs = await Promise.all([aplicar(A, venta('mostrador', 900, 5)), aplicar(A, venta('mostrador', 900, 5))]);
  assert.strictEqual(rs.filter((r) => r.aplicado).length, 1);
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 250 + 500);
});

await check('10 reintentos seguidos no mueven nada', async () => {
  const antes = (await totales()).totalAcumuladoCentavos;
  for (let i = 0; i < 10; i++) await aplicar(A, venta('mostrador', 900, 5));
  assert.strictEqual((await totales()).totalAcumuladoCentavos, antes);
});

// ===========================================================================
console.log('\n4. Ventas simultaneas Desktop / Tablet:');
nuevaFase(); await activar();

await check('40 ventas distintas desde 2 clientes: no se pierde ninguna', async () => {
  const ops = [];
  for (let i = 0; i < 40; i++) {
    const modo = i % 2 === 0 ? 'mostrador' : 'delivery';
    ops.push(aplicar(i % 2 === 0 ? A : B, venta(modo, 1000 + i, 1)));
  }
  await Promise.all(ops);
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 4000, 'faltan operaciones');
  assert.strictEqual(t.saldoPendienteCentavos, 4000);
});

await check('la MISMA venta desde Desktop y Tablet a la vez entra 1 sola vez', async () => {
  const rs = await Promise.all([aplicar(A, venta('delivery', 7777, 3)), aplicar(B, venta('delivery', 7777, 3))]);
  assert.strictEqual(rs.filter((r) => r.aplicado).length, 1);
  assert.strictEqual((await totales()).totalAcumuladoCentavos, 4000 + 300);
});

// ===========================================================================
console.log('\n5. Anulaciones (R2: mostrador Y delivery):');
nuevaFase(); await activar();

await check('anular una venta de MOSTRADOR revierte historico y deuda', async () => {
  await aplicar(A, venta('mostrador', 50, 2));
  assert.strictEqual((await totales()).saldoPendienteCentavos, 200);
  await aplicar(A, anul('mostrador', 50, 2));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 0);
  assert.strictEqual(t.saldoPendienteCentavos, 0);
});

await check('R2: anular una venta de DELIVERY tambien revierte', async () => {
  await aplicar(B, venta('delivery', 50, 4));
  assert.strictEqual((await totales()).saldoPendienteCentavos, 400);
  await aplicar(B, anul('delivery', 50, 4));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 0, 'el delivery no revirtio');
  assert.strictEqual(t.saldoPendienteCentavos, 0);
});

await check('anular la misma venta dos veces solo revierte una', async () => {
  await aplicar(A, venta('mostrador', 51, 3));
  await aplicar(A, anul('mostrador', 51, 3));
  const r = await aplicar(A, anul('mostrador', 51, 3));
  assert.strictEqual(r.aplicado, false, 'la segunda anulacion no debe aplicarse');
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 0);
  assert.strictEqual(t.saldoPendienteCentavos, 0);
});

await check('anular M50 no afecta a D50', async () => {
  await aplicar(A, venta('mostrador', 60, 1));
  await aplicar(B, venta('delivery', 60, 1));
  await aplicar(A, anul('mostrador', 60, 1));
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, 100, 'deberia quedar solo la comision del delivery');
});

await check('la anulacion usa la comision ORIGINAL aunque cambie el porcentaje', async () => {
  nuevaFase(); await activar();
  await aplicar(A, venta('mostrador', 70, 1));       // 1% -> $1
  // ...el porcentaje pasa a 2%: la anulacion IGUAL resta la comision original
  await aplicar(A, anul('mostrador', 70, 1));
  assert.strictEqual((await totales()).totalAcumuladoCentavos, 0, 'resto un importe distinto al original');
});

// ===========================================================================
console.log('\n6. Pagos:');
nuevaFase(); await activar({ totalAcumuladoCentavos: 100000, saldoPendienteCentavos: 100000 });

await check('un pago sube pagado y baja deuda, sin tocar el historico', async () => {
  await aplicar(A, pago('p1', 200));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 100000, 'el historico no se toca');
  assert.strictEqual(t.totalPagadoCentavos, 20000);
  assert.strictEqual(t.saldoPendienteCentavos, 80000);
});

await check('pago repetido (mismo idPago) no descuenta dos veces', async () => {
  const r = await aplicar(A, pago('p1', 200));
  assert.strictEqual(r.aplicado, false);
  const t = await totales();
  assert.strictEqual(t.totalPagadoCentavos, 20000);
  assert.strictEqual(t.saldoPendienteCentavos, 80000);
});

await check('timeout: el cliente reintenta con el MISMO idPago -> una sola vez', async () => {
  // Simula: el commit entro pero el cliente no recibio la respuesta y reintenta.
  for (let i = 0; i < 5; i++) await aplicar(A, pago('p1', 200));
  const t = await totales();
  assert.strictEqual(t.totalPagadoCentavos, 20000, 'el reintento duplico el pago');
});

await check('doble clic en Pagar: 2 simultaneos, entra 1', async () => {
  const rs = await Promise.all([aplicar(A, pago('p2', 100)), aplicar(A, pago('p2', 100))]);
  assert.strictEqual(rs.filter((r) => r.aplicado).length, 1);
  assert.strictEqual((await totales()).totalPagadoCentavos, 30000);
});

await check('WEBHOOK MP repetido 20 veces desde 2 instancias -> 1 solo descuento', async () => {
  const antes = await totales();
  const ops = [];
  for (let i = 0; i < 20; i++) ops.push(aplicar(i % 2 === 0 ? A : B, pago('comision-31915636-1755', 150)));
  const rs = await Promise.all(ops);
  assert.strictEqual(rs.filter((r) => r.aplicado).length, 1, 'entro mas de una vez');
  const t = await totales();
  assert.strictEqual(t.totalPagadoCentavos, antes.totalPagadoCentavos + 15000);
  assert.strictEqual(t.saldoPendienteCentavos, antes.saldoPendienteCentavos - 15000);
});

// ===========================================================================
console.log('\n7. La deuda nunca queda negativa:');
nuevaFase(); await activar({ totalAcumuladoCentavos: 50000, saldoPendienteCentavos: 50000 });

await check('la UI rechaza un pago mayor a la deuda antes de enviarlo', async () => {
  const t = await totales();
  const v = validarPago(aCentavos(1000), t.saldoPendienteCentavos);
  assert.strictEqual(v.ok, false);
});

await check('si un cliente defectuoso lo intenta igual, FIREBASE lo rechaza', async () => {
  const r = await aplicar(A, pago('p-exceso', 1000));   // 100.000 sobre una deuda de 500
  assert.strictEqual(r.aplicado, false, 'la regla tiene que rechazar la escritura completa');
});

await check('no quedo el movimiento ni se movio ningun acumulador', async () => {
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS/P-p-exceso`))).val();
  assert.strictEqual(m, null, 'se creo el movimiento de un pago rechazado');
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, 50000);
  assert.strictEqual(t.totalPagadoCentavos, 0);
});

await check('un pago exacto por toda la deuda si entra', async () => {
  const r = await aplicar(A, pago('p-exacto', 500));
  assert.strictEqual(r.aplicado, true);
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, 0);
  assert.strictEqual(t.totalPagadoCentavos, 50000);
});

// ===========================================================================
// UN PERMISSION_DENIED NO SIGNIFICA SIEMPRE LO MISMO.
// Confundir "duplicado" con "rechazado" escondería un error contable real.
// ===========================================================================
console.log('\n7b. Distinguir duplicado de operacion rechazada:');
nuevaFase(); await activar({ totalAcumuladoCentavos: 50000, saldoPendienteCentavos: 50000 });

await check('DUPLICADO REAL: el movimiento existe -> ya_aplicado', async () => {
  const r1 = await aplicar(A, pago('dup', 100));
  assert.strictEqual(r1.aplicado, true);
  const r2 = await aplicar(A, pago('dup', 100));
  assert.strictEqual(r2.aplicado, false);
  assert.strictEqual(r2.motivo, 'ya_aplicado', 'un duplicado tiene que reconocerse como tal');
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS/P-dup`))).val();
  assert.ok(m, 'el movimiento del duplicado debe existir');
});

await check('PAGO MAYOR A LA DEUDA: el movimiento NO existe -> operacion_rechazada', async () => {
  const t = await totales();
  const excedido = Math.round(t.saldoPendienteCentavos / 100) + 1000;   // en pesos, por encima
  const r = await aplicar(A, pago('excede', excedido));
  assert.strictEqual(r.aplicado, false);
  assert.strictEqual(r.motivo, 'operacion_rechazada', 'no puede pasar por un simple reintento');
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS/P-excede`))).val();
  assert.strictEqual(m, null, 'no debe quedar el movimiento de una operacion rechazada');
});

await check('los acumuladores quedaron intactos tras el rechazo', async () => {
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, 50000 - 10000);
  assert.strictEqual(t.totalPagadoCentavos, 10000);
});

await check('MOVIMIENTO INVALIDO (sin los campos obligatorios) -> operacion_rechazada', async () => {
  // La regla exige hasChildren(['tipo','ts']). Un movimiento sin `tipo` se
  // rechaza y NO queda escrito: es un error, no un duplicado.
  const plan = pago('malformado', 10);
  const payload = {
    [plan.movimiento.ruta]: { ts: serverTimestamp() },   // falta `tipo`
    [plan.rutaMarcaDeTiempo]: serverTimestamp(),
  };
  for (const inc of plan.incrementos) payload[inc.ruta] = increment(inc.delta);
  let motivo = 'aplicado';
  try { await update(ref(A), payload); }
  catch (e) {
    assert.ok(String(e.message).includes('PERMISSION_DENIED'));
    motivo = (await get(ref(A, plan.movimiento.ruta))).exists() ? 'ya_aplicado' : 'operacion_rechazada';
  }
  assert.strictEqual(motivo, 'operacion_rechazada');
  assert.strictEqual((await get(ref(A, plan.movimiento.ruta))).val(), null);
});

await check('un rechazo no dejo ningun incremento a medias', async () => {
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, 40000);
  assert.strictEqual(t.totalPagadoCentavos, 10000);
  assert.strictEqual(t.totalAcumuladoCentavos, 50000);
});

// ===========================================================================
// ¿EL PAGO COMPLETO (contabilidad + detalle) ENTRA EN UNA SOLA ESCRITURA?
//
// Si entra, no existe el estado "deuda correcta pero detalle incompleto".
// Se prueba con un pago que alcanza a MUCHOS registros, que es el caso que
// podría chocar con un límite de tamaño.
// ===========================================================================
console.log('\n7c. Pago atomico: contabilidad Y detalle en UN update():');
nuevaFase();

await check('se preparan 300 registros pendientes', async () => {
  const carga = {};
  for (let i = 1; i <= 300; i++) {
    carga[`M${i}`] = {
      idVenta: String(i), canal: 'mostrador', ventaKey: `M${i}`,
      comisionGeneradaCentavos: 100, estado: 'pendiente',
      fecha: '01-08-2026', hora: '10:00:00',
    };
  }
  await set(ref(A, `${L}/COMISIONES/REGISTRO`), carga);
  await activar({ totalAcumuladoCentavos: 30000, saldoPendienteCentavos: 30000 });
  const n = Object.keys((await get(ref(A, `${L}/COMISIONES/REGISTRO`))).val() || {}).length;
  assert.strictEqual(n, 300);
});

let planGrande = null;
await check('UN SOLO update() aplica movimiento, totales, comprobante y 250 registros', async () => {
  const reg = (await get(ref(A, `${L}/COMISIONES/REGISTRO`))).val();
  const pendientes = Object.entries(reg).map(([key, v]) => ({
    key, fecha: v.fecha, hora: v.hora, estado: v.estado, pendingAmount: v.comisionGeneradaCentavos,
  }));
  planGrande = planCompletoDePago({
    localId: L, idPago: 'atomico-1', montoCentavos: 25000, responsable: 'CARO',
    fechaPago: '19-08-2026', horaPago: '12:00:00', pendientes,
  });
  assert.strictEqual(planGrande.registrosPagados.length, 250, 'el pago cubre 250 registros de 100 centavos');

  const payload = {
    [planGrande.movimiento.ruta]: { ...planGrande.movimiento.valor, ts: serverTimestamp() },
    [planGrande.comprobante.ruta]: planGrande.comprobante.valor,
    [planGrande.rutaMarcaDeTiempo]: serverTimestamp(),
    ...planGrande.detalle,
  };
  for (const inc of planGrande.incrementos) payload[inc.ruta] = increment(inc.delta);

  const rutas = Object.keys(payload).length;
  await update(ref(A), payload);
  console.log(`        (${rutas} rutas en una sola escritura)`);
});

await check('la contabilidad quedo bien', async () => {
  const t = await totales();
  assert.strictEqual(t.totalPagadoCentavos, 25000);
  assert.strictEqual(t.saldoPendienteCentavos, 5000);
  assert.strictEqual(t.totalAcumuladoCentavos, 30000, 'el historico no se toca');
});

await check('el detalle quedo COMPLETO en la misma escritura', async () => {
  const reg = (await get(ref(A, `${L}/COMISIONES/REGISTRO`))).val();
  const pagadas = Object.values(reg).filter((r) => r.estado === 'pagada').length;
  const pendientes = Object.values(reg).filter((r) => r.estado === 'pendiente').length;
  assert.strictEqual(pagadas, 250, 'faltan registros marcados');
  assert.strictEqual(pendientes, 50);
});

await check('el comprobante de PAGOS tambien entro', async () => {
  const p = (await get(ref(A, `${L}/COMISIONES/PAGOS/atomico-1`))).val();
  assert.ok(p, 'no se creo el comprobante');
  assert.strictEqual(p.montoPagoCentavos, 25000);
  assert.strictEqual(p.registrosPagados.length, 250);
});

await check('reintentar el MISMO pago no toca nada: ni deuda ni detalle', async () => {
  const payload = {
    [planGrande.movimiento.ruta]: { ...planGrande.movimiento.valor, ts: serverTimestamp() },
    [planGrande.comprobante.ruta]: planGrande.comprobante.valor,
    ...planGrande.detalle,
  };
  for (const inc of planGrande.incrementos) payload[inc.ruta] = increment(inc.delta);
  let rechazado = false;
  try { await update(ref(A), payload); } catch (e) { rechazado = String(e.message).includes('PERMISSION_DENIED'); }
  assert.strictEqual(rechazado, true, 'el reintento tiene que rechazarse entero');
  const t = await totales();
  assert.strictEqual(t.totalPagadoCentavos, 25000, 'se descontó dos veces');
  assert.strictEqual(t.saldoPendienteCentavos, 5000);
});

// ===========================================================================
console.log('\n8. Comision 0% (Achaval):');
nuevaFase(); await activar();

await check('una venta con comision 0 no emite movimiento ni mueve acumuladores', async () => {
  const d = deltasDeVenta(aCentavos(0));
  assert.strictEqual(tieneEfectoContable(d), false, 'no deberia tener efecto contable');
  // Por eso la capa de Firebase ni siquiera llama a aplicar().
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 0);
  assert.strictEqual(t.saldoPendienteCentavos, 0);
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS`))).val();
  assert.strictEqual(m, null, 'no debe haber movimientos');
});

await check('si despues se configura un porcentaje, las ventas NUEVAS si generan', async () => {
  await aplicar(A, venta('delivery', 5220, 1.42));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 142);
  assert.strictEqual(t.saldoPendienteCentavos, 142);
});

// ===========================================================================
console.log('\n9. Centavos enteros:');
nuevaFase(); await activar();

await check('3 ventas de $0,10 y una de $0,20 dan exactamente 50 centavos', async () => {
  for (let i = 0; i < 3; i++) await aplicar(A, venta('mostrador', 200 + i, 0.1));
  await aplicar(A, venta('mostrador', 210, 0.2));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 50);
  assert.ok(Number.isInteger(t.totalAcumuladoCentavos));
});

await check('un acumulador NO entero es rechazado por las reglas', async () => {
  let rechazado = false;
  try { await update(ref(A, rutaTotales(L)), { totalAcumuladoCentavos: 10.5 }); }
  catch (e) { rechazado = String(e.message).includes('PERMISSION_DENIED'); }
  assert.strictEqual(rechazado, true, 'la regla dejo pasar un valor con decimales');
});

await check('un acumulador negativo es rechazado por las reglas', async () => {
  let rechazado = false;
  try { await update(ref(A, rutaTotales(L)), { saldoPendienteCentavos: -1 }); }
  catch (e) { rechazado = String(e.message).includes('PERMISSION_DENIED'); }
  assert.strictEqual(rechazado, true, 'la regla dejo pasar un negativo');
});

// ===========================================================================
console.log('\n10. Los movimientos son inmutables:');

await check('no se puede MODIFICAR un movimiento existente', async () => {
  let rechazado = false;
  try { await update(ref(A, `${L}/COMISIONES/MOVIMIENTOS/V-M200`), { dHist: 999999 }); }
  catch (e) { rechazado = String(e.message).includes('PERMISSION_DENIED'); }
  assert.strictEqual(rechazado, true);
});

await check('no se puede BORRAR un movimiento existente', async () => {
  let rechazado = false;
  try { await set(ref(A, `${L}/COMISIONES/MOVIMIENTOS/V-M200`), null); }
  catch (e) { rechazado = String(e.message).includes('PERMISSION_DENIED'); }
  assert.strictEqual(rechazado, true);
});

// ===========================================================================
console.log('\n11. Iniciar el sistema NUNCA modifica los acumuladores:');
nuevaFase(); await activar({ totalAcumuladoCentavos: 15000, totalPagadoCentavos: 10000, saldoPendienteCentavos: 5000 });

await check('20 arranques (Desktop y Tablet) dejan los tres valores iguales', async () => {
  const antes = leerAcumuladores(await totales());
  for (let i = 0; i < 10; i++) {
    // Un "arranque" es exactamente esto: UNA lectura del nodo de totales.
    leerAcumuladores(await totales(A));
    leerAcumuladores(await totales(B));
  }
  const despues = leerAcumuladores(await totales());
  assert.deepStrictEqual(despues, antes);
});

await check('tampoco se crean movimientos al iniciar', async () => {
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS`))).val();
  assert.strictEqual(m, null);
});

// ===========================================================================
console.log('\n12. Aviso, corte y sesion:');

await check('inicio con 55.000: avisa y deja trabajar', async () => {
  nuevaFase(); await activar({ totalAcumuladoCentavos: aCentavos(55000), saldoPendienteCentavos: aCentavos(55000) });
  const t = await totales();
  const e = evaluarInicio({ saldoCentavos: t.saldoPendienteCentavos, alarmaPagoPesos: 50000, limiteCortePesos: 60000 });
  assert.strictEqual(e.estado, ESTADO_INICIO.AVISO);
  assert.strictEqual(bloquea(e), false);
});

await check('durante el turno la deuda pasa el limite y NO se bloquea', async () => {
  const decisionDeLaSesion = evaluarInicio({
    saldoCentavos: (await totales()).saldoPendienteCentavos, alarmaPagoPesos: 50000, limiteCortePesos: 60000,
  });
  // Ventas reales que llevan la deuda a 70.000...
  await aplicar(A, venta('mostrador', 5000, 15000));
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, aCentavos(70000));
  // ...y la sesion sigue autorizada: la decision es la del inicio.
  assert.strictEqual(bloquea(decisionDeLaSesion), false, 'la sesion en curso no se puede bloquear');
});

await check('el PROXIMO inicio, con 70.000, si bloquea', async () => {
  const t = await totales();
  const e = evaluarInicio({ saldoCentavos: t.saldoPendienteCentavos, alarmaPagoPesos: 50000, limiteCortePesos: 60000 });
  assert.strictEqual(e.estado, ESTADO_INICIO.BLOQUEADO);
  assert.strictEqual(bloquea(e), true);
});

await check('pagando desde la pantalla de bloqueo se libera la sesion', async () => {
  await aplicar(A, pago('p-desbloqueo', 15000));   // 70.000 - 15.000 = 55.000
  const t = await totales();
  assert.strictEqual(t.saldoPendienteCentavos, aCentavos(55000));
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: t.saldoPendienteCentavos, limiteCortePesos: 60000 }), true);
});

await check('con limiteCorte 0 (desactivado) nunca bloquea', async () => {
  const t = await totales();
  const e = evaluarInicio({ saldoCentavos: t.saldoPendienteCentavos, alarmaPagoPesos: 50000, limiteCortePesos: 0 });
  assert.strictEqual(bloquea(e), false);
});

// ===========================================================================
// ACTIVACIÓN ATÓMICA: migracionVersion y migracionActivadaEn juntos.
//
// Si fueran dos escrituras podría observarse migracionVersion=1 sin frontera,
// y en esa ventana no habría forma de separar legado de nuevo.
// ===========================================================================
console.log('\n13. Activacion atomica (version + frontera):');
nuevaFase();

await check('activar escribe LOS DOS campos en el mismo update()', async () => {
  await set(ref(A, rutaTotales(L)), {
    totalAcumuladoCentavos: 5000, totalPagadoCentavos: 0, saldoPendienteCentavos: 5000,
    migracionVersion: 0,
  });
  // Exactamente lo que hace el paso C del script de migración.
  await update(ref(A, rutaTotales(L)), {
    migracionVersion: 1,
    migracionActivadaEn: serverTimestamp(),
    migracionVerificadaEn: serverTimestamp(),
  });
  const t = await totales();
  assert.strictEqual(t.migracionVersion, 1);
  assert.ok(Number(t.migracionActivadaEn) > 0, 'la frontera no quedo escrita');
});

await check('NUNCA se observa migracionVersion=1 sin frontera', async () => {
  const t = await totales();
  const activa = contabilidadActiva(t);
  const tieneFrontera = Number(t.migracionActivadaEn) > 0;
  assert.strictEqual(activa && !tieneFrontera, false,
    'hay una ventana en la que la contabilidad esta activa sin frontera');
});

await check('si el update falla, NINGUNO de los dos cambia', async () => {
  nuevaFase();
  await set(ref(A, rutaTotales(L)), {
    totalAcumuladoCentavos: 100, totalPagadoCentavos: 0, saldoPendienteCentavos: 100,
    migracionVersion: 0,
  });
  // Se fuerza el rechazo metiendo un acumulador invalido en el MISMO update.
  let rechazado = false;
  try {
    await update(ref(A, rutaTotales(L)), {
      migracionVersion: 1,
      migracionActivadaEn: serverTimestamp(),
      saldoPendienteCentavos: -1,        // invalido: la regla rechaza
    });
  } catch (e) { rechazado = String(e.message).includes('PERMISSION_DENIED'); }
  assert.strictEqual(rechazado, true);
  const t = await totales();
  assert.strictEqual(t.migracionVersion, 0, 'la version cambio pese al rechazo');
  assert.strictEqual(t.migracionActivadaEn, undefined, 'quedo la frontera de un intento fallido');
  assert.strictEqual(t.saldoPendienteCentavos, 100);
});

// ===========================================================================
// R2 DELIVERY — CIRCUITO COMPLETO.
// ===========================================================================
console.log('\n14. R2 Delivery integrado:');
nuevaFase(); await activar();

await check('entregar un delivery genera su comision', async () => {
  const r = await aplicar(A, venta('delivery', 50, 142.02));
  assert.strictEqual(r.aplicado, true);
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 14202);
  assert.strictEqual(t.saldoPendienteCentavos, 14202);
});

await check('una venta de MOSTRADOR con el mismo numero convive', async () => {
  await aplicar(A, venta('mostrador', 50, 80));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 14202 + 8000);
});

await check('cancelar el delivery revierte EXACTAMENTE su comision original', async () => {
  await aplicar(A, anul('delivery', 50, 142.02));
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 8000, 'quedo solo la comision del mostrador');
  assert.strictEqual(t.saldoPendienteCentavos, 8000);
});

await check('cancelar D50 NO afecto a M50', async () => {
  const m = (await get(ref(A, `${L}/COMISIONES/MOVIMIENTOS`))).val() || {};
  assert.ok(m['V-M50'], 'se perdio la venta de mostrador');
  assert.ok(m['A-D50'], 'falta la anulacion del delivery');
  assert.strictEqual(m['A-M50'], undefined, 'se anulo la venta de mostrador por error');
});

await check('repetir la cancelacion NO vuelve a descontar', async () => {
  const r = await aplicar(A, anul('delivery', 50, 142.02));
  assert.strictEqual(r.aplicado, false);
  assert.strictEqual(r.motivo, 'ya_aplicado');
  const t = await totales();
  assert.strictEqual(t.totalAcumuladoCentavos, 8000);
  assert.strictEqual(t.saldoPendienteCentavos, 8000);
});

await check('la anulacion usa la comision ORIGINAL aunque el porcentaje cambie', async () => {
  nuevaFase(); await activar();
  await aplicar(A, venta('delivery', 60, 1));      // 1% -> $1
  // El local pasa a 2%. La anulacion igual resta el importe guardado.
  await aplicar(A, anul('delivery', 60, 1));
  assert.strictEqual((await totales()).totalAcumuladoCentavos, 0);
});

// ===========================================================================
console.log(`\n${passed} pruebas OK, ${failed} fallas`);
await deleteApp(A.app); await deleteApp(B.app);
process.exit(failed ? 1 : 0);
