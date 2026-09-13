// FACTURAR UN REMITO A POSTERIORI — INTEGRACIÓN CONTRA EL EMULADOR REAL.
//
// Recorre el circuito completo con transacciones y dos clientes concurrentes,
// que es donde se juegan las garantías: un solo encolado por remito aunque se
// haga doble clic o lo pidan Desktop y TAB a la vez, ninguna Nota de Crédito,
// nada de stock/caja/estadísticas/comisiones tocado, y el vínculo de vuelta con
// la factura que deja el motor en la ruta fiscal.
//
// LA CUENTA FISCAL con la que se factura NUNCA sale de un alias ni de la
// cuenta favorita: sale de las cuentas fiscales del local que están REALMENTE
// habilitadas para emitir por ARCA (`cuentasFiscalesHabilitadasParaFacturar`,
// la misma fuente que usa el motor de facturación para cualquier cola). Según
// cuántas haya: 0 bloquea, 1 se usa directo, 2+ exige que se haya elegido una.
//
// El motor AFIP se simula con lo que hace el real: copia el payload encolado
// dentro de /{localId}/VENTAS/{FCB…} y borra el pedido de la cola.
//
// Correr con:
//   npm run test:facturacion-remito-emulator
import assert from 'node:assert';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction, connectDatabaseEmulator } from 'firebase/database';
import {
  ESTADO_ERROR,
  ESTADO_FACTURADO,
  ESTADO_PENDIENTE,
  claveEnCola,
  conciliarConFacturaEmitida,
  construirPayloadFacturacion,
  estadoFacturacion,
  marcaDeError,
  marcaDePendiente,
  puedeFacturarse,
  validarRemitoParaFacturar,
} from '../facturacionDeRemito.js';
import { cuentasFiscalesHabilitadasParaFacturar } from '../colasFiscales.js';
import { filasDeRemitos, totalNoFacturado } from '../remitos.js';

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
const cliente = (nombre) => {
  const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, nombre);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, host, Number(port));
  return db;
};
// Dos clientes distintos = Desktop y TAB, de verdad.
const DESKTOP = cliente('remFactDesktop');
const TAB = cliente('remFactTab');

const ACHAVAL = '40508022';
const OTRO_LOCAL = '38827976';

/** Cuenta fiscal COMPLETA para /{localId}/CONFIGURACION/FACTURACION_AFIP. */
const cuentaFiscal = (localId, cola, over = {}) => ({
  id: over.id || `c-${cola}`,
  nombre: over.nombre || `Titular ${cola}`,
  cuit: over.cuit || '20111111111',
  cuitFormat: over.cuitFormat || '20-11111111-1',
  ptoVta: over.ptoVta || '1',
  razonSocial: over.razonSocial || `TITULAR ${cola}`,
  fantasia: over.fantasia || 'EL COMERCIO',
  domicilio: over.domicilio || 'CALLE 123',
  condIVA: over.condIVA || 'Monotributista',
  inicioActividades: over.inicioActividades ?? '01/01/2025',
  iibb: over.iibb ?? '901-000000-0',
  certStoragePath: over.certStoragePath ?? 'facturacion/x/cert.crt',
  keyStoragePath: over.keyStoragePath ?? 'facturacion/x/clave.key',
  serviceAccountStoragePath: over.serviceAccountStoragePath ?? 'facturacion/x/sa.json',
  firebaseDb: over.firebaseDb ?? 'https://x-default-rtdb.firebaseio.com',
  firebasePath: `${localId}/${cola}`,
  firebaseHistorial: `${localId}/VENTAS`,
  initialized: true,
  ...over,
});

/** /{localId}/CONFIGURACION/FACTURACION_AFIP con las cuentas que se pasen. */
const configFiscal = (cuentas) => ({ tipo: 'monotributo', monotributo: { cuentas } });

const CONFIG_ACHAVAL_UNA_CUENTA = configFiscal([
  cuentaFiscal(ACHAVAL, 'FACTURACION_1', { id: 'ach-1', razonSocial: 'ACHAVAL SRL' }),
]);

const remitoDe = (numero, total = 16200) => ({
  numeroComprobante: numero,
  tipo: 'FCX',
  fecha: '25-07-2026',
  hora: '22:45:00',
  fechacaja: '25-07-2026',
  turno: 3,
  total,
  cliente: 'Ana Gómez',
  direccion: 'Achaval 3703',
  canal: 'delivery',
  localId: ACHAVAL,
  facturado: false,
  formaPago: 'Efectivo',
  pagos: { 0: { metodo: 'Efectivo', importe: total } },
  productos: {
    1: { nombre: 'Milanesa', cantidad: 2, precioUnitario: 1500, precioTotal: 3200,
         selectedOptionals: { g1: [{ nombre: 'Queso', total: 200, cantidad: 1 }] } },
    2: { nombre: 'Gaseosa', cantidad: 1, precioUnitario: total - 3200, precioTotal: total - 3200 },
  },
  origen: { tipo: 'delivery', id: '881', ruta: 'PEDIDOS' },
  emitidoEn: '2026-07-25T22:45:00.000Z',
});

const rutaRem = (raiz, n) => `${raiz}/Remitos/${n}`;
const rutaConfigFiscal = (raiz) => `${raiz}/CONFIGURACION/FACTURACION_AFIP`;

/**
 * Copia exacta del flujo de facturacionDeRemitoApi.facturarRemito(): resuelve
 * la cuenta fiscal (0/1/2+ habilitadas) y sólo entonces toma el candado.
 *
 * @param {string|null} colaElegida  la que eligió el usuario en el selector,
 *        cuando hace falta elegir entre 2+ cuentas habilitadas.
 */
async function pedirFactura(db, raiz, numero, deviceId, colaElegida = null) {
  const remito = (await get(ref(db, rutaRem(raiz, numero)))).val();
  const v = validarRemitoParaFacturar(remito, numero);
  if (!v.ok) return { estado: 'rechazado', motivo: v.motivo };

  const config = (await get(ref(db, rutaConfigFiscal(raiz)))).val();
  const habilitadas = cuentasFiscalesHabilitadasParaFacturar(config, { localId: raiz });

  let cuenta;
  if (habilitadas.length === 0) {
    return { estado: 'sin-cuenta-habilitada' };
  } else if (habilitadas.length === 1) {
    cuenta = habilitadas[0];
  } else {
    cuenta = colaElegida ? habilitadas.find((c) => c.cola === colaElegida) : null;
    if (!cuenta) return { estado: 'requiere-eleccion', cuentas: habilitadas };
  }
  const cola = cuenta.cola;

  const candado = await runTransaction(ref(db, `${rutaRem(raiz, numero)}/estadoFacturacion`), (actual) => {
    if (actual === ESTADO_PENDIENTE || actual === ESTADO_FACTURADO) return undefined;
    return ESTADO_PENDIENTE;
  });
  if (!candado.committed) return { estado: 'ya-en-curso' };

  await update(ref(db, rutaRem(raiz, numero)), marcaDePendiente({ cola, deviceId }));
  const payload = construirPayloadFacturacion({ remito, localId: raiz, cola, solicitadoPor: deviceId });
  await set(ref(db, `${raiz}/${cola}/${claveEnCola(numero)}`), payload);
  return { estado: 'encolado', cola, cuenta: cuenta.razonSocial || cuenta.nombre, payload };
}

/** El motor AFIP real: copia el payload dentro de VENTAS y borra el pedido. */
async function motorEmiteFactura(db, raiz, cola, claveCola, numeroFactura, cae = '75123456789012') {
  const pedido = (await get(ref(db, `${raiz}/${cola}/${claveCola}`))).val();
  if (!pedido) throw new Error('no hay pedido en la cola');
  await set(ref(db, `${raiz}/VENTAS/${numeroFactura}`), {
    ...pedido, CLIENTE: pedido.clientes, TOTAL: pedido.total, PRODUCTO: pedido.producto,
    CAE: cae, VtoCAE: '20260805', PDF_BASE64: 'JVBERi0=',
  });
  await set(ref(db, `${raiz}/${cola}/${claveCola}`), null);
  return numeroFactura;
}

/** Copia del flujo de conciliarRemito(). */
async function conciliar(db, raiz, numero) {
  const remito = (await get(ref(db, rutaRem(raiz, numero)))).val();
  const cola = remito?.colaFacturacion;
  // El pedido encolado trae, si hubo un rechazo, el mensaje EXACTO que dejó el
  // motor (`errorFacturacion`): es lo único que puede marcar ERROR. Que ya no
  // esté en la cola (se emitió o está en camino) NO es un error por sí solo.
  const pedidoSnap = cola ? await get(ref(db, `${raiz}/${cola}/${claveEnCola(numero)}`)) : null;
  const sigueEnCola = !!(pedidoSnap && pedidoSnap.exists());
  const errorDelMotor = sigueEnCola ? (pedidoSnap.val()?.errorFacturacion || null) : null;
  const ventas = (await get(ref(db, `${raiz}/VENTAS`))).val() || {};
  const r = conciliarConFacturaEmitida({ remito, ventas, sigueEnCola, errorDelMotor });
  if (r.accion !== 'esperar') await update(ref(db, rutaRem(raiz, numero)), r.marca);
  return r;
}

const leerRemito = async (raiz, n) => (await get(ref(DESKTOP, rutaRem(raiz, n)))).val();
const fotoLocal = async (raiz) => (await get(ref(DESKTOP, raiz))).val() || {};

async function sembrar() {
  await set(ref(DESKTOP, ACHAVAL), null);
  await set(ref(DESKTOP, OTRO_LOCAL), null);
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), CONFIG_ACHAVAL_UNA_CUENTA);
  // Estado operativo que NO se debe tocar. CUENTAS ya no decide con qué cola
  // se factura un remito (eso sale de CONFIGURACION/FACTURACION_AFIP), pero se
  // sigue sembrando para probar que la conversión no la toca.
  await set(ref(DESKTOP, `${ACHAVAL}/CUENTAS`), { 'cta-1': { nombre: 'Efectivo' } });
  await set(ref(DESKTOP, `${ACHAVAL}/CAJAS`), { '25-07-2026': { turnos: { 3: { fondoInicial: 1000, ventas: 16200 } } } });
  await set(ref(DESKTOP, `${ACHAVAL}/ESTADISTICAS`), { '25-07-2026': { '156A': 4 } });
  await set(ref(DESKTOP, `${ACHAVAL}/MATERIAPRIMA`), { harina: { stock: 50 } });
  await set(ref(DESKTOP, `${ACHAVAL}/RESUMEN_CUENTA`), { '2026-07-25': { total: 99000 } });
  await set(ref(DESKTOP, `${ACHAVAL}/COMISIONES`), { 881: { valor: 500 } });
  await set(ref(DESKTOP, `${ACHAVAL}/CONTADORES/remitos`), 48);
  await set(ref(DESKTOP, `${ACHAVAL}/PEDIDOS/881`), { id: 881, total: 16200, remito: 'FCX0008-00000048' });
}

await sembrar();

console.log('\n1. Un FCX sin facturar se puede facturar:');
const N1 = 'FCX0008-00000048';
await check('el remito arranca sin facturar y con el botón habilitado', async () => {
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N1)), remitoDe(N1));
  const r = await leerRemito(ACHAVAL, N1);
  assert.strictEqual(puedeFacturarse(r), true);
  assert.strictEqual(estadoFacturacion(r), 'SIN_FACTURAR');
});
await check('con UNA sola cuenta fiscal habilitada se encola directo, por el TOTAL COMPLETO', async () => {
  const r = await pedirFactura(DESKTOP, ACHAVAL, N1, 'pc-1');
  assert.strictEqual(r.estado, 'encolado');
  assert.strictEqual(r.cuenta, 'ACHAVAL SRL', 'no usó la cuenta fiscal habilitada');
  assert.strictEqual(r.cola, 'FACTURACION_1');

  const encolado = (await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1/${claveEnCola(N1)}`))).val();
  assert.ok(encolado, 'no quedó nada en la cola');
  assert.strictEqual(encolado.total, 16200, 'no encoló el total completo');
  assert.strictEqual(encolado.remitoId, N1);
  assert.strictEqual(encolado.origen, 'REMITO');
  assert.strictEqual(encolado.forzarFactura, true);
  assert.strictEqual(encolado.idempotencyKey, `${ACHAVAL}:${N1}`);
});
await check('encola los mismos productos, cantidades, precios y opcionales', async () => {
  const encolado = (await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1/${claveEnCola(N1)}`))).val();
  assert.strictEqual(encolado.producto.producto_1.nombre, '2x Milanesa');
  assert.strictEqual(encolado.producto.producto_1.valor, 3200);
  assert.strictEqual(encolado.producto.producto_1.cantidad, 2);
  assert.strictEqual(encolado.producto.producto_1.precioUnitario, 1500);
  assert.ok(encolado.producto.producto_1.opcionales, 'perdió los opcionales');
  assert.strictEqual(encolado.producto.producto_2.valor, 13000);
  const suma = Object.values(encolado.producto).reduce((s, l) => s + l.valor, 0);
  assert.strictEqual(suma, 16200);
  assert.strictEqual(encolado.clientes, 'Ana Gómez');
  assert.strictEqual(encolado.direccion, 'Achaval 3703');
});
await check('el remito queda PENDIENTE, con quién y a qué cola', async () => {
  const r = await leerRemito(ACHAVAL, N1);
  assert.strictEqual(r.estadoFacturacion, ESTADO_PENDIENTE);
  assert.strictEqual(r.colaFacturacion, 'FACTURACION_1');
  assert.strictEqual(r.facturacionSolicitadaPor, 'pc-1');
  assert.ok(r.facturacionSolicitadaEn);
  assert.strictEqual(puedeFacturarse(r), false, 'el botón sigue habilitado estando pendiente');
});
await check('no se generó otro FCX ni se movió el contador', async () => {
  const remitos = (await get(ref(DESKTOP, `${ACHAVAL}/Remitos`))).val();
  assert.deepStrictEqual(Object.keys(remitos), [N1]);
  assert.strictEqual((await get(ref(DESKTOP, `${ACHAVAL}/CONTADORES/remitos`))).val(), 48);
});

console.log('\n2. Doble clic y dos dispositivos: UNA sola solicitud:');
await check('el segundo clic no vuelve a encolar', async () => {
  // La validación ve el PENDIENTE antes del candado y corta ahí, con un mensaje
  // entendible. El candado es la red de atrás, para el empate real (test de abajo).
  const r = await pedirFactura(DESKTOP, ACHAVAL, N1, 'pc-1');
  assert.strictEqual(r.estado, 'rechazado');
  assert.ok(/en curso/.test(r.motivo), r.motivo);
  const cola = (await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1`))).val() || {};
  assert.strictEqual(Object.keys(cola).length, 1, 'se encoló una segunda solicitud');
});
await check('Desktop y TAB simultáneos generan UNA sola solicitud', async () => {
  const N = 'FCX0008-00000050';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 9000));
  const [a, b] = await Promise.all([
    pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1'),
    pedirFactura(TAB, ACHAVAL, N, 'tab-1'),
  ]);
  const encolados = [a, b].filter((x) => x.estado === 'encolado');
  assert.strictEqual(encolados.length, 1, `encolaron ${encolados.length} solicitudes`);
  const cola = (await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1`))).val() || {};
  assert.strictEqual(Object.keys(cola).filter((k) => k === claveEnCola(N)).length, 1);
});

console.log('\n3. El motor emite y el remito queda vinculado:');
const FACTURA1 = 'FCB0008-00010300';
await check('mientras sigue en la cola, la reconciliación espera', async () => {
  const r = await conciliar(DESKTOP, ACHAVAL, N1);
  assert.strictEqual(r.accion, 'esperar');
  assert.strictEqual((await leerRemito(ACHAVAL, N1)).estadoFacturacion, ESTADO_PENDIENTE);
});
await check('emitida la factura, el remito queda FACTURADO con número y CAE', async () => {
  await motorEmiteFactura(DESKTOP, ACHAVAL, 'FACTURACION_1', claveEnCola(N1), FACTURA1);
  const r = await conciliar(DESKTOP, ACHAVAL, N1);
  assert.strictEqual(r.accion, 'facturado');

  const rem = await leerRemito(ACHAVAL, N1);
  assert.strictEqual(rem.facturado, true);
  assert.strictEqual(rem.estadoFacturacion, ESTADO_FACTURADO);
  assert.strictEqual(rem.numeroFactura, FACTURA1);
  assert.strictEqual(rem.tipoFactura, 'FCB');
  assert.strictEqual(rem.cae, '75123456789012');
  assert.ok(rem.fechaFacturacion);
  assert.strictEqual(rem.colaFacturacion, 'FACTURACION_1');
});
await check('en Achaval salió una FCB (el tipo fiscal del local)', async () => {
  assert.strictEqual((await leerRemito(ACHAVAL, N1)).tipoFactura, 'FCB');
});
await check('la factura vive en la ruta fiscal, NO en Remitos', async () => {
  const factura = (await get(ref(DESKTOP, `${ACHAVAL}/VENTAS/${FACTURA1}`))).val();
  assert.ok(factura, 'la factura no quedó en VENTAS');
  assert.strictEqual(factura.remitoId, N1, 'la factura perdió el vínculo con el remito');
  assert.strictEqual(factura.TOTAL, 16200);
  const remitos = (await get(ref(DESKTOP, `${ACHAVAL}/Remitos`))).val();
  assert.ok(!Object.keys(remitos).some((k) => k.startsWith('FCB')), 'se coló una factura dentro de Remitos');
});
await check('el remito original se conservó entero, sin cambiarle importes', async () => {
  const rem = await leerRemito(ACHAVAL, N1);
  const original = remitoDe(N1);
  assert.strictEqual(rem.total, original.total);
  assert.strictEqual(rem.turno, original.turno);
  // RTDB devuelve los mapas de claves numéricas como arrays ralos: se comparan
  // por valor, que es lo que importa (los renglones y los importes intactos).
  const porValor = (m) => Object.keys(m || {}).sort().map((k) => m[k]).filter(Boolean);
  assert.deepStrictEqual(porValor(rem.productos), porValor(original.productos));
  assert.deepStrictEqual(porValor(rem.pagos), porValor(original.pagos));
  assert.strictEqual(rem.numeroComprobante, original.numeroComprobante);
  assert.strictEqual(rem.tipo, 'FCX');
});
await check('un remito ya facturado NO se puede volver a facturar', async () => {
  const r = await pedirFactura(DESKTOP, ACHAVAL, N1, 'pc-1');
  assert.strictEqual(r.estado, 'rechazado');
  assert.ok(r.motivo.includes(FACTURA1));
  const ventas = (await get(ref(DESKTOP, `${ACHAVAL}/VENTAS`))).val();
  assert.strictEqual(Object.keys(ventas).length, 1, 'se emitió una segunda factura');
});
await check('el FCX sigue visible en la pestaña, con su estado', async () => {
  const filas = filasDeRemitos((await get(ref(DESKTOP, `${ACHAVAL}/Remitos`))).val());
  const fila = filas.find((f) => f.numeroFactura === N1);
  assert.ok(fila, 'el remito facturado desapareció del listado');
  assert.strictEqual(fila.facturado, true);
  assert.strictEqual(fila.numeroFacturaFiscal, FACTURA1);
  assert.strictEqual(fila.tipoFactura, 'FCB');
  assert.strictEqual(fila.importe, 16200);
});
await check('su importe ya no suma en el total de Remitos (no se cuenta dos veces)', async () => {
  const filas = filasDeRemitos((await get(ref(DESKTOP, `${ACHAVAL}/Remitos`))).val());
  const facturados = filas.filter((f) => f.facturado).reduce((s, f) => s + f.importe, 0);
  const total = filas.reduce((s, f) => s + f.importe, 0);
  assert.strictEqual(totalNoFacturado(filas), total - facturados);
});

console.log('\n4. No se duplica NADA de la operación original:');
await check('no se tocó stock, caja, estadísticas, comisiones, turno ni la venta', async () => {
  const N = 'FCX0008-00000051';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 7000));
  const antes = await fotoLocal(ACHAVAL);

  const enc = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1');
  assert.strictEqual(enc.estado, 'encolado');
  await motorEmiteFactura(DESKTOP, ACHAVAL, 'FACTURACION_1', claveEnCola(N), 'FCB0008-00010301');
  await conciliar(DESKTOP, ACHAVAL, N);

  const despues = await fotoLocal(ACHAVAL);
  for (const nodo of ['CAJAS', 'ESTADISTICAS', 'MATERIAPRIMA', 'RESUMEN_CUENTA', 'COMISIONES', 'PEDIDOS', 'CUENTAS', 'CONTADORES']) {
    assert.deepStrictEqual(despues[nodo], antes[nodo], `cambió ${nodo}`);
  }
  assert.strictEqual(Object.keys(despues.Remitos).length, Object.keys(antes.Remitos).length, 'se creó otro remito');
});
await check('no se emitió ninguna Nota de Crédito', async () => {
  const raiz = await fotoLocal(ACHAVAL);
  const claves = Object.keys(raiz.VENTAS || {});
  assert.ok(claves.every((k) => k.startsWith('FCB') || k.startsWith('FCC')), `claves inesperadas: ${claves}`);
  const texto = JSON.stringify(raiz).toLowerCase();
  for (const p of ['notacredito', 'nota_credito', 'nota de credito', 'notadecredito']) {
    assert.ok(!texto.includes(p), `apareció "${p}" en el local`);
  }
  assert.ok(!Object.keys(raiz).some((k) => k.toUpperCase() === 'NC'), 'se creó un nodo NC');
});

console.log('\n5. Errores y reintentos:');
await check('si el motor falla, el remito queda reintentable y sin factura', async () => {
  const N = 'FCX0008-00000052';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 5000));
  await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1');

  // El motor deja el pedido EN LA COLA con el rechazo de ARCA (no lo borra):
  // así se distingue un rechazo real de una demora (el motor SÍ borra el
  // pedido cuando la factura se emite, ver motorEmiteFactura()).
  await update(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1/${claveEnCola(N)}`), { errorFacturacion: 'AFIP rechazó el comprobante' });
  const r = await conciliar(DESKTOP, ACHAVAL, N);
  assert.strictEqual(r.accion, 'reabrir');

  const rem = await leerRemito(ACHAVAL, N);
  assert.strictEqual(rem.facturado, false);
  assert.strictEqual(rem.estadoFacturacion, ESTADO_ERROR);
  assert.ok(rem.errorFacturacion);
  assert.strictEqual(puedeFacturarse(rem), true);
});
await check('el reintento vuelve a encolar y limpia el error', async () => {
  const N = 'FCX0008-00000052';
  const r = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1');
  assert.strictEqual(r.estado, 'encolado');
  const rem = await leerRemito(ACHAVAL, N);
  assert.strictEqual(rem.estadoFacturacion, ESTADO_PENDIENTE);
  // RTDB borra las claves puestas en null: el error anterior desaparece, que es
  // justo lo que se busca al reintentar.
  assert.ok(rem.errorFacturacion === null || rem.errorFacturacion === undefined,
    `quedó el error viejo: ${rem.errorFacturacion}`);
});
await check('el reintento no genera una segunda factura', async () => {
  const N = 'FCX0008-00000052';
  await motorEmiteFactura(DESKTOP, ACHAVAL, 'FACTURACION_1', claveEnCola(N), 'FCB0008-00010302');
  await conciliar(DESKTOP, ACHAVAL, N);
  const ventas = (await get(ref(DESKTOP, `${ACHAVAL}/VENTAS`))).val();
  const deEsteRemito = Object.values(ventas).filter((v) => v.remitoId === N);
  assert.strictEqual(deEsteRemito.length, 1, `hay ${deEsteRemito.length} facturas del mismo remito`);
});
await check('SIN ninguna cuenta fiscal habilitada NO se encola y el remito queda intacto', async () => {
  const N = 'FCX0008-00000053';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 4000));
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), null);

  const r = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1');
  assert.strictEqual(r.estado, 'sin-cuenta-habilitada');
  const rem = await leerRemito(ACHAVAL, N);
  assert.strictEqual(rem.estadoFacturacion, undefined, 'marcó el remito igual');
  assert.strictEqual(rem.facturado, false);
  assert.strictEqual((await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1/${claveEnCola(N)}`))).exists(), false);

  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), CONFIG_ACHAVAL_UNA_CUENTA);
});
await check('una cuenta fiscal INCOMPLETA no cuenta como habilitada: tampoco encola', async () => {
  const N = 'FCX0008-00000054';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 4000));
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), configFiscal([
    cuentaFiscal(ACHAVAL, 'FACTURACION_1', { id: 'incompleta', certStoragePath: null, keyStoragePath: null }),
  ]));

  const r = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1');
  assert.strictEqual(r.estado, 'sin-cuenta-habilitada');
  assert.strictEqual((await leerRemito(ACHAVAL, N)).estadoFacturacion, undefined);

  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), CONFIG_ACHAVAL_UNA_CUENTA);
});
await check('CON 2+ cuentas fiscales habilitadas, sin elegir ninguna, NO encola', async () => {
  const N = 'FCX0008-00000055';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 6000));
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), configFiscal([
    cuentaFiscal(ACHAVAL, 'FACTURACION_1', { id: 'dos-a', razonSocial: 'CUENTA A' }),
    cuentaFiscal(ACHAVAL, 'FACTURACION_2', { id: 'dos-b', razonSocial: 'CUENTA B' }),
  ]));

  const r = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1');
  assert.strictEqual(r.estado, 'requiere-eleccion');
  assert.strictEqual(r.cuentas.length, 2);
  assert.strictEqual((await leerRemito(ACHAVAL, N)).estadoFacturacion, undefined, 'no se marcó nada sin elegir');
  assert.strictEqual((await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1/${claveEnCola(N)}`))).exists(), false);
  assert.strictEqual((await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_2/${claveEnCola(N)}`))).exists(), false);

  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), CONFIG_ACHAVAL_UNA_CUENTA);
});
await check('CON 2+ cuentas, eligiendo una que ya no existe, tampoco encola', async () => {
  const N = 'FCX0008-00000056';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 6000));
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), configFiscal([
    cuentaFiscal(ACHAVAL, 'FACTURACION_1', { id: 'dos-a', razonSocial: 'CUENTA A' }),
    cuentaFiscal(ACHAVAL, 'FACTURACION_2', { id: 'dos-b', razonSocial: 'CUENTA B' }),
  ]));

  const r = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1', 'FACTURACION_9');
  assert.strictEqual(r.estado, 'requiere-eleccion', 'una cola inválida no puede colarse como elección');

  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), CONFIG_ACHAVAL_UNA_CUENTA);
});
await check('CON 2+ cuentas, eligiendo una VÁLIDA, encola con ESA y no con la otra', async () => {
  const N = 'FCX0008-00000057';
  await set(ref(DESKTOP, rutaRem(ACHAVAL, N)), remitoDe(N, 8000));
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), configFiscal([
    cuentaFiscal(ACHAVAL, 'FACTURACION_1', { id: 'dos-a', razonSocial: 'CUENTA A' }),
    cuentaFiscal(ACHAVAL, 'FACTURACION_2', { id: 'dos-b', razonSocial: 'CUENTA B' }),
  ]));

  const r = await pedirFactura(DESKTOP, ACHAVAL, N, 'pc-1', 'FACTURACION_2');
  assert.strictEqual(r.estado, 'encolado');
  assert.strictEqual(r.cola, 'FACTURACION_2');
  assert.strictEqual(r.cuenta, 'CUENTA B');
  assert.strictEqual((await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_1/${claveEnCola(N)}`))).exists(), false, 'se coló en la otra cuenta');
  assert.ok((await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_2/${claveEnCola(N)}`))).exists());
  const rem = await leerRemito(ACHAVAL, N);
  assert.strictEqual(rem.colaFacturacion, 'FACTURACION_2');

  await motorEmiteFactura(DESKTOP, ACHAVAL, 'FACTURACION_2', claveEnCola(N), 'FCB0008-00010303');
  await conciliar(DESKTOP, ACHAVAL, N);
  await set(ref(DESKTOP, rutaConfigFiscal(ACHAVAL)), CONFIG_ACHAVAL_UNA_CUENTA);
});

console.log('\n6. Aislamiento entre locales:');
await check('otro local factura sus remitos con SU PROPIA cuenta fiscal, sin mezclarse', async () => {
  const N = 'FCX0001-00000001';
  await set(ref(TAB, rutaConfigFiscal(OTRO_LOCAL)), configFiscal([
    cuentaFiscal(OTRO_LOCAL, 'FACTURACION_9', { id: 'otro-1', razonSocial: 'OTRO LOCAL SA' }),
  ]));
  await set(ref(TAB, rutaRem(OTRO_LOCAL, N)), { ...remitoDe(N, 3000), numeroComprobante: N, localId: OTRO_LOCAL });

  const r = await pedirFactura(TAB, OTRO_LOCAL, N, 'tab-1');
  assert.strictEqual(r.estado, 'encolado');
  assert.strictEqual(r.cola, 'FACTURACION_9', 'no usó la cuenta fiscal de SU local');
  assert.strictEqual(r.cuenta, 'OTRO LOCAL SA');

  assert.strictEqual((await get(ref(DESKTOP, `${ACHAVAL}/FACTURACION_9/${claveEnCola(N)}`))).exists(), false);
  assert.strictEqual((await get(ref(DESKTOP, rutaRem(ACHAVAL, N)))).exists(), false);
  assert.ok((await get(ref(TAB, rutaRem(OTRO_LOCAL, N)))).exists());
});
await check(`Achaval escribió exclusivamente dentro de /${ACHAVAL}`, async () => {
  assert.strictEqual((await get(ref(DESKTOP, 'Remitos'))).val(), null, 'hay un /Remitos global');
  const raiz = (await get(ref(DESKTOP, '/'))).val() || {};
  const fuera = Object.keys(raiz).filter((k) => k !== ACHAVAL && k !== OTRO_LOCAL);
  assert.deepStrictEqual(fuera, [], `se escribió fuera del local: ${fuera.join(', ')}`);
  const deAchaval = Object.keys((await get(ref(DESKTOP, `${ACHAVAL}/Remitos`))).val() || {});
  assert.ok(deAchaval.every((k) => k.startsWith('FCX0008-')), `remitos de otro local en Achaval: ${deAchaval}`);
});

console.log('\n7. Invariante final:');
await check('ningún remito quedó facturado sin su factura, ni al revés', async () => {
  const raiz = await fotoLocal(ACHAVAL);
  const ventas = raiz.VENTAS || {};
  for (const [numero, rem] of Object.entries(raiz.Remitos || {})) {
    if (rem.facturado === true) {
      assert.ok(rem.numeroFactura, `${numero} está facturado sin número de factura`);
      assert.ok(ventas[rem.numeroFactura], `${numero} apunta a ${rem.numeroFactura}, que no existe en VENTAS`);
      assert.strictEqual(ventas[rem.numeroFactura].remitoId, numero, 'el vínculo no es recíproco');
      assert.strictEqual(ventas[rem.numeroFactura].total, rem.total, 'la factura no coincide con el total del remito');
    }
  }
  for (const [clave, venta] of Object.entries(ventas)) {
    if (!venta.remitoId) continue;
    const rem = (raiz.Remitos || {})[venta.remitoId];
    assert.ok(rem, `la factura ${clave} apunta a un remito inexistente`);
    assert.strictEqual(rem.facturado, true, `la factura ${clave} existe pero su remito no está marcado`);
  }
});
await check('cada remito tiene como máximo UNA factura', async () => {
  const raiz = await fotoLocal(ACHAVAL);
  const porRemito = {};
  for (const [clave, venta] of Object.entries(raiz.VENTAS || {})) {
    if (!venta.remitoId) continue;
    (porRemito[venta.remitoId] ||= []).push(clave);
  }
  for (const [remito, facturas] of Object.entries(porRemito)) {
    assert.strictEqual(facturas.length, 1, `${remito} tiene ${facturas.length} facturas: ${facturas}`);
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
process.exit(process.exitCode || 0);
