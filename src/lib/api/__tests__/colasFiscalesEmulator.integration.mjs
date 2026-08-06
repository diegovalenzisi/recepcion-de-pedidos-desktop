// CIRCUITO FISCAL POR COLA — INTEGRACIÓN CONTRA EL EMULADOR REAL de RTDB.
//
// Recorre el camino completo de una venta, con datos que NO son de ningún local
// real: un local inventado con TRES contribuyentes distintos, uno por cola.
//
//   /{localId}/CUENTAS/{cta}/imprimeFactura            el switch de cobro
//        → COLAS_POR_CUENTA (coincidencia exacta)      la cola
//        → /{localId}/CONFIGURACION/FACTURACION_AFIP   la CUENTA FISCAL de esa cola
//        → /{localId}/FACTURACION_N/{D|M}{id}          el encolado
//        → /{localId}/VENTAS/{factura}                 lo que guarda el motor
//        o  /{localId}/Remitos/{FCX}                   si no se factura
//
// Lo que se verifica es que cada cola factura con SU CUIT, SU punto de venta y
// SUS datos fiscales, y que una cola incompleta DETIENE la venta en vez de
// encolarla para siempre o degradarla a remito.
//
// No hay AFIP, no se pide ningún CAE, no se toca ninguna base real.
//
// Correr con:
//   npm run test:colas-fiscales-emulator
import assert from 'node:assert';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, connectDatabaseEmulator } from 'firebase/database';
import { decidirComprobante, resolverEncolado } from '../facturaORemito.js';
import {
  ETIQUETA_ESTADO,
  cuentaFiscalDeCola,
  detectarColasHuerfanas,
  emisorDeCuenta,
  radiografiaDeColas,
  switchesDeCuentasCobro,
  validarCuentaFiscal,
} from '../colasFiscales.js';
import { listarCuentasFiscales, normalizarComprobante } from '../comprobanteFiscal.js';
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
const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'colas-fiscales');
const db = getDatabase(app);
connectDatabaseEmulator(db, host, Number(port));

// LOCAL INVENTADO. Ninguno de estos números, CUIT ni razones sociales existe:
// justamente para probar que el sistema es genérico y no reconoce locales.
const LOCAL = '90000001';
const OTRO_LOCAL = '90000002';

const cuentaFiscal = (o) => ({
  id: o.id, cuit: o.cuit, cuitFormat: o.cuitFormat, ptoVta: o.ptoVta,
  razonSocial: o.razonSocial, fantasia: o.fantasia, domicilio: o.domicilio,
  condIVA: o.condIVA || 'Monotributista',
  inicioActividades: o.inicioActividades ?? '01/01/2025',
  iibb: o.iibb ?? '901-000000-0',
  certStoragePath: o.cert === null ? null : `facturacion/${LOCAL}/${o.id}/certificado.crt`,
  keyStoragePath: o.cert === null ? null : `facturacion/${LOCAL}/${o.id}/clave.key`,
  serviceAccountStoragePath: `facturacion/${LOCAL}/${o.id}/serviceAccount.json`,
  firebaseDb: `https://inventado-default-rtdb.firebaseio.com`,
  firebasePath: `${LOCAL}/${o.cola}`,
  firebaseHistorial: `${LOCAL}/VENTAS`,
  initialized: true,
});

const CONFIG_FISCAL = {
  tipo: 'monotributo',
  autoStart: false,
  monotributo: { cuentas: [
    cuentaFiscal({ id: 'f1', cola: 'FACTURACION_1', cuit: '20111111117', cuitFormat: '20-11111111-7', ptoVta: '1', razonSocial: 'ANA PRIMERA', fantasia: 'HELADOS UNO', domicilio: 'CALLE UNO 100' }),
    cuentaFiscal({ id: 'f2', cola: 'FACTURACION_2', cuit: '27222222224', cuitFormat: '27-22222222-4', ptoVta: '5', razonSocial: 'BETO SEGUNDO', fantasia: 'HELADOS DOS', domicilio: 'CALLE DOS 200' }),
    // Tercera cuenta a propósito INCOMPLETA: sin certificado ni clave.
    cuentaFiscal({ id: 'f3', cola: 'FACTURACION_3', cuit: '20333333336', cuitFormat: '20-33333333-6', ptoVta: '9', razonSocial: 'CARO TERCERA', fantasia: 'HELADOS TRES', domicilio: 'CALLE TRES 300', cert: null }),
  ] },
};

// Cuentas de COBRO del local. El switch es lo único que decide facturar.
const CUENTAS_COBRO = {
  'cta-1': { nombre: 'Transferencia', imprimeFactura: false, isFavorite: true },
  'cta-2': { nombre: 'Transferencia 2', imprimeFactura: true },
  'cta-3': { nombre: 'Transferencia 3', imprimeFactura: true },
  'cta-4': { nombre: 'Mercado Pago', imprimeFactura: false },
};

const listaCuentasCobro = () => Object.entries(CUENTAS_COBRO).map(([id, c]) => ({ id, ...c }));

const sembrar = async (localId = LOCAL) => {
  await set(ref(db, localId), null);
  await set(ref(db, `${localId}/CONFIGURACION/FACTURACION_AFIP`), CONFIG_FISCAL);
  await set(ref(db, `${localId}/CUENTAS`), CUENTAS_COBRO);
};

const limpiar = async (localId) => { await set(ref(db, localId), null); };

const ventaCon = (pagos, extra = {}) => ({
  id: extra.id ?? 501,
  total: pagos.reduce((s, p) => s + p.amount, 0),
  date: '26-07-2026', hora: '20:00:00', fechacaja: '26-07-2026', turno: 1,
  client: { name: 'Consumidor Final' },
  payments: pagos,
  items: [{ nombre: '1 KILO DE HELADO', cantidad: 1, valor: 15000, precioBaseUnitario: 15000, subtotalLinea: 15000, codigo: '5A' }],
  ...extra,
});

/**
 * El circuito real, tal como lo ejecuta la app: decidir → elegir cola →
 * VALIDAR la cuenta fiscal de esa cola → encolar. Si la validación falla, NO se
 * encola y NO se emite un FCX.
 */
const procesarVenta = async (venta, { localId = LOCAL, saleType = 'mostrador' } = {}) => {
  const cfgSnap = await get(ref(db, `${localId}/CONFIGURACION/FACTURACION_AFIP`));
  const cuentasSnap = await get(ref(db, `${localId}/CUENTAS`));
  const config = cfgSnap.val();
  const cuentas = Object.entries(cuentasSnap.val() || {}).map(([id, c]) => ({ id, ...c }));

  const decision = decidirComprobante({ venta, cuentas, emiteFacturaManual: venta.emiteFactura === true });
  const encolado = resolverEncolado(decision, cuentas);

  if (encolado.estado === 'sin-factura') {
    const r = await emitirRemito({ db, raiz: localId, venta, canal: saleType, puntoVenta: '1', revalidarDb: () => db });
    return { resultado: 'remito', decision, encolado, remito: r };
  }
  if (encolado.estado !== 'encolar') {
    return { resultado: 'bloqueado', decision, encolado, motivo: encolado.motivo };
  }

  const cuentaFisc = cuentaFiscalDeCola(config, encolado.cola);
  const validacion = validarCuentaFiscal(cuentaFisc, { localId });
  if (!validacion.listo) {
    return { resultado: 'bloqueado', decision, encolado, validacion, motivo: validacion.mensaje };
  }

  const emisor = emisorDeCuenta(cuentaFisc);
  const prefijo = saleType === 'delivery' ? 'D' : 'M';
  await set(ref(db, `${localId}/${encolado.cola}/${prefijo}${venta.id}`), {
    clientes: venta.client.name, direccion: 'Sin Datos',
    producto: { producto_1: { nombre: venta.items[0].nombre, valor: 15000, cantidad: 1, precioUnitario: 15000, precioTotal: 15000, codigo: '5A', opcionales: 0 } },
    fecha: venta.date, hora: venta.hora,
    total: encolado.total,
    colaFacturacion: encolado.cola,
    cuentaCobro: encolado.cuenta,
    localId, origen: { tipo: saleType, id: String(venta.id), ruta: saleType === 'delivery' ? 'PEDIDOS' : 'MOSTRADOR' },
  });

  return { resultado: 'encolado', decision, encolado, emisor, validacion };
};

console.log('\n== CADA COLA, SU PROPIA CUENTA FISCAL ==\n');

await check('la cuenta encendida factura en SU cola, con SU CUIT', async () => {
  await sembrar();
  const r = await procesarVenta(ventaCon([{ method: 'Transferencia 2', amount: 15000 }], { id: 601 }));
  assert.strictEqual(r.resultado, 'encolado');
  assert.strictEqual(r.encolado.cola, 'FACTURACION_2');
  assert.strictEqual(r.emisor.cuitFormat, '27-22222222-4');
  assert.strictEqual(r.emisor.razonSocial, 'BETO SEGUNDO');
  assert.strictEqual(r.emisor.puntoVenta, '0005');

  const enCola = (await get(ref(db, `${LOCAL}/FACTURACION_2/M601`))).val();
  assert.ok(enCola, 'la venta tiene que estar en FACTURACION_2');
  assert.strictEqual(enCola.colaFacturacion, 'FACTURACION_2');
  assert.strictEqual(enCola.total, 15000);
  assert.strictEqual(enCola.producto.producto_1.cantidad, 1);
  assert.strictEqual(enCola.producto.producto_1.codigo, '5A');

  // Y NO cayó en ninguna otra cola.
  for (const otra of ['FACTURACION_1', 'FACTURACION_3', 'FACTURACION_4']) {
    assert.ok(!(await get(ref(db, `${LOCAL}/${otra}`))).exists(), `no debe haber nada en ${otra}`);
  }
});

await check('otra cuenta encendida usa OTRO CUIT y OTRO punto de venta', async () => {
  await sembrar();
  const r2 = await procesarVenta(ventaCon([{ method: 'Transferencia 3', amount: 15000 }], { id: 602 }));
  // FACTURACION_3 está incompleta a propósito (sin certificado): debe bloquear.
  assert.strictEqual(r2.resultado, 'bloqueado');

  const r1 = await procesarVenta(ventaCon([{ method: 'Transferencia 2', amount: 15000 }], { id: 603 }));
  assert.strictEqual(r1.emisor.cuit, '27222222224');

  // Y la cuenta de FACTURACION_1, que es otra persona.
  const f1 = cuentaFiscalDeCola(CONFIG_FISCAL, 'FACTURACION_1');
  assert.strictEqual(f1.cuit, '20111111117');
  assert.strictEqual(f1.puntoVenta, '0001');
  assert.notStrictEqual(f1.cuit, r1.emisor.cuit);
  assert.notStrictEqual(f1.puntoVenta, r1.emisor.puntoVenta);
});

await check('cuenta con imprimeFactura:false genera FCX aunque tenga cola asociada', async () => {
  await sembrar();
  // "Transferencia" está mapeada a FACTURACION_1 y esa cola está COMPLETA,
  // pero su switch está apagado: corresponde remito.
  const r = await procesarVenta(ventaCon([{ method: 'Transferencia', amount: 15000 }], { id: 604 }));
  assert.strictEqual(r.resultado, 'remito');
  assert.strictEqual(r.remito.estado, 'emitido');

  assert.ok(!(await get(ref(db, `${LOCAL}/FACTURACION_1`))).exists(), 'no puede entrar a ninguna cola fiscal');
  const remitos = filasDeRemitos((await get(ref(db, rutaRemitos(LOCAL)))).val());
  assert.strictEqual(remitos.length, 1);
  assert.strictEqual(remitos[0].importe, 15000);
});

await check('cola con configuración incompleta BLOQUEA: ni encola ni degrada a remito', async () => {
  await sembrar();
  const r = await procesarVenta(ventaCon([{ method: 'Transferencia 3', amount: 15000 }], { id: 605 }));
  assert.strictEqual(r.resultado, 'bloqueado');
  assert.strictEqual(r.validacion.estado, 'certificado-invalido');
  assert.ok(r.motivo.includes('certificado'), r.motivo);

  assert.ok(!(await get(ref(db, `${LOCAL}/FACTURACION_3`))).exists(), 'no se encola en una cola inutilizable');
  assert.ok(!(await get(ref(db, rutaRemitos(LOCAL)))).exists(), 'NO se emite un FCX como reemplazo de una factura');
});

await check('tilde manual con dos cuentas fiscales y ninguna favorita: pide elegir', async () => {
  await sembrar();
  // La favorita de este local es "Transferencia", que tiene el switch APAGADO:
  // no puede facturar. Quedan dos habilitadas y ninguna favorita → no hay forma
  // determinista de saber con qué CUIT emitir, así que se detiene.
  const r = await procesarVenta(ventaCon([{ method: 'Mercado Pago', amount: 15000 }], { id: 606, emiteFactura: true }));
  assert.strictEqual(r.resultado, 'bloqueado');
  assert.strictEqual(r.encolado.estado, 'ambiguo');
  assert.strictEqual(r.encolado.cuentas.length, 2);
  assert.ok(!(await get(ref(db, rutaRemitos(LOCAL)))).exists(), 'con tilde manual NO hay FCX');
  for (const cola of ['FACTURACION_1', 'FACTURACION_2', 'FACTURACION_3']) {
    assert.ok(!(await get(ref(db, `${LOCAL}/${cola}`))).exists(), `no se elige ${cola} a dedo`);
  }
});

await check('tilde manual con UNA sola cuenta fiscal: usa esa, sin importar la favorita', async () => {
  await sembrar();
  // Se apaga "Transferencia 3": queda una sola habilitada, que sí es determinista.
  await set(ref(db, `${LOCAL}/CUENTAS/cta-3/imprimeFactura`), false);
  const r = await procesarVenta(ventaCon([{ method: 'Mercado Pago', amount: 15000 }], { id: 609, emiteFactura: true }));
  assert.strictEqual(r.resultado, 'encolado');
  assert.strictEqual(r.encolado.cuenta, 'Transferencia 2');
  assert.strictEqual(r.encolado.cola, 'FACTURACION_2');
  assert.strictEqual(r.emisor.razonSocial, 'BETO SEGUNDO');
  assert.ok(!(await get(ref(db, rutaRemitos(LOCAL)))).exists(), 'con tilde manual NO hay FCX');
});

await check('pago combinado: UNA factura por el total, en UNA sola cola', async () => {
  await sembrar();
  const r = await procesarVenta(ventaCon([
    { method: 'Transferencia', amount: 9000 },
    { method: 'Transferencia 2', amount: 6000 },
  ], { id: 607 }));
  assert.strictEqual(r.resultado, 'encolado');
  assert.strictEqual(r.encolado.cola, 'FACTURACION_2');

  const enCola = (await get(ref(db, `${LOCAL}/FACTURACION_2/M607`))).val();
  assert.strictEqual(enCola.total, 15000, 'se factura el TOTAL, no la parte de esa cuenta');
  assert.ok(!(await get(ref(db, `${LOCAL}/FACTURACION_1`))).exists(), 'no se abre una factura por medio de pago');
  assert.ok(!(await get(ref(db, rutaRemitos(LOCAL)))).exists(), 'nunca factura y FCX para la misma venta');
});

await check('todas las cuentas apagadas: UN solo FCX por el total', async () => {
  await sembrar();
  const r = await procesarVenta(ventaCon([
    { method: 'Transferencia', amount: 9000 },
    { method: 'Mercado Pago', amount: 6000 },
  ], { id: 608 }));
  assert.strictEqual(r.resultado, 'remito');
  const remitos = filasDeRemitos((await get(ref(db, rutaRemitos(LOCAL)))).val());
  assert.strictEqual(remitos.length, 1, 'un solo FCX, no uno por pago');
  assert.strictEqual(remitos[0].importe, 15000);
  for (const cola of ['FACTURACION_1', 'FACTURACION_2', 'FACTURACION_3', 'FACTURACION_4']) {
    assert.ok(!(await get(ref(db, `${LOCAL}/${cola}`))).exists());
  }
});

console.log('\n== LA FACTURA GUARDADA CONSERVA SU CUENTA FISCAL ==\n');

await check('el comprobante se atribuye por la COLA, aunque el punto de venta se repita', async () => {
  await sembrar();
  // Dos cuentas del mismo local con el MISMO punto de venta: sólo la cola las
  // distingue. Es el caso que el punto de venta solo no puede resolver.
  const config = {
    tipo: 'monotributo',
    monotributo: { cuentas: [
      cuentaFiscal({ id: 'g1', cola: 'FACTURACION_1', cuit: '20111111117', cuitFormat: '20-11111111-7', ptoVta: '3', razonSocial: 'ANA PRIMERA', fantasia: 'UNO', domicilio: 'A 1' }),
      cuentaFiscal({ id: 'g2', cola: 'FACTURACION_2', cuit: '27222222224', cuitFormat: '27-22222222-4', ptoVta: '3', razonSocial: 'BETO SEGUNDO', fantasia: 'DOS', domicilio: 'B 2' }),
    ] },
  };
  await set(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`), config);

  // Factura emitida por la cuenta de FACTURACION_2.
  await set(ref(db, `${LOCAL}/VENTAS/FCC0003-00000010`), {
    CbteTipo: 11, CUIT: '27222222224', colaFacturacion: 'FACTURACION_2',
    PTO_VTA: 3, NRO_CMP: 10, CAE: '86999999999999', CAE_VTO: '20261231',
    clientes: 'Consumidor Final', fecha: '26-07-2026', hora: '20:00:00', total: 15000,
    ARTICULOS: { 1: { nombre: '1 KILO DE HELADO', cantidad: 1, precioUnitario: 15000, precioTotal: 15000 } },
  });

  const snap = await get(ref(db, `${LOCAL}/VENTAS/FCC0003-00000010`));
  const c = normalizarComprobante('FCC0003-00000010', snap.val(), { config, cuentas: listarCuentasFiscales(config) });
  assert.strictEqual(c.emisor.razonSocial, 'BETO SEGUNDO', 'la cola desempata el punto de venta repetido');
  assert.strictEqual(c.emisor.cola, 'FACTURACION_2');
  assert.strictEqual(c.colaFacturacion, 'FACTURACION_2');
  assert.strictEqual(c.tipoNombre, 'Factura C');
  assert.strictEqual(c.tipoOrigen, 'registro');
});

console.log('\n== CUENTA DE COBRO NO FISCAL (el caso Centenario / Il Capo) ==\n');

// El local cobra por "Transferencia 2" —la plata va a esa persona— pero esas
// operaciones NO se facturan a propósito. La cuenta es incluso la FAVORITA y
// FACTURACION_2 no tiene ningún contribuyente, y así debe quedar.
const CUENTAS_NO_FISCAL = {
  'cta-1': { nombre: 'Transferencia', imprimeFactura: true },
  'cta-2': { nombre: 'Transferencia 2', imprimeFactura: false, isFavorite: true },
};
const sembrarNoFiscal = async () => {
  await set(ref(db, LOCAL), null);
  await set(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`), {
    tipo: 'monotributo',
    monotributo: { cuentas: [
      cuentaFiscal({ id: 'f1', cola: 'FACTURACION_1', cuit: '20111111117', cuitFormat: '20-11111111-7', ptoVta: '1', razonSocial: 'ANA PRIMERA', fantasia: 'HELADOS UNO', domicilio: 'CALLE UNO 100' }),
    ] },
  });
  await set(ref(db, `${LOCAL}/CUENTAS`), CUENTAS_NO_FISCAL);
};

await check('Transferencia 2 apagada genera FCX y NO escribe en FACTURACION_2', async () => {
  await sembrarNoFiscal();
  const r = await procesarVenta(ventaCon([{ method: 'Transferencia 2', amount: 12000 }], { id: 701 }));
  assert.strictEqual(r.resultado, 'remito');
  assert.strictEqual(r.remito.estado, 'emitido');

  assert.ok(!(await get(ref(db, `${LOCAL}/FACTURACION_2`))).exists(), 'NO puede entrar a FACTURACION_2');
  assert.ok(!(await get(ref(db, `${LOCAL}/FACTURACION_1`))).exists(), 'ni a ninguna otra cola');

  const remitos = filasDeRemitos((await get(ref(db, rutaRemitos(LOCAL)))).val());
  assert.strictEqual(remitos.length, 1);
  assert.strictEqual(remitos[0].importe, 12000, 'el FCX es por el total completo');
  assert.ok(remitos[0].numeroFactura.startsWith('FCX'));
});

await check('ser la FAVORITA no la obliga a facturar', async () => {
  const cuentas = Object.entries((await get(ref(db, `${LOCAL}/CUENTAS`))).val()).map(([id, c]) => ({ id, ...c }));
  assert.strictEqual(cuentas.find((c) => c.isFavorite).nombre, 'Transferencia 2');
  const d = decidirComprobante({ venta: ventaCon([{ method: 'Transferencia 2', amount: 500 }]), cuentas });
  assert.strictEqual(d.comprobante, 'REMITO');
});

await check('FACTURACION_2 no exige CUIT ni certificado, y no es un error', async () => {
  const config = (await get(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`))).val();
  const switches = switchesDeCuentasCobro((await get(ref(db, `${LOCAL}/CUENTAS`))).val());
  const r = radiografiaDeColas({ config, localId: LOCAL, switchesCuentaCobro: switches });
  const f2 = r.colas.find((c) => c.cola === 'FACTURACION_2');
  assert.strictEqual(f2.estado, 'cuenta-no-fiscal');
  assert.strictEqual(ETIQUETA_ESTADO[f2.estado], 'No factura — genera remito');
  assert.strictEqual(f2.esError, false);
  assert.deepStrictEqual(f2.faltantes, []);
  assert.strictEqual(r.conErrores.length, 0, 'el local no tiene ningún error de configuración');
});

await check('con pendientes históricos NO se reporta como cola huérfana', async () => {
  // Pedidos viejos, de cuando esas ventas sí se encolaban.
  await set(ref(db, `${LOCAL}/FACTURACION_2/M100`), { total: 5000, fecha: '01-05-2026' });
  await set(ref(db, `${LOCAL}/FACTURACION_2/M101`), { total: 7000, fecha: '02-05-2026' });

  const config = (await get(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`))).val();
  const switches = switchesDeCuentasCobro((await get(ref(db, `${LOCAL}/CUENTAS`))).val());
  const pend = { FACTURACION_2: { n: 2, masViejoMs: new Date(2026, 4, 1).getTime(), masNuevoMs: new Date(2026, 4, 2).getTime() } };

  assert.deepStrictEqual(detectarColasHuerfanas({ config, pendientesPorCola: pend, switchesCuentaCobro: switches }), []);
  const r = radiografiaDeColas({ config, localId: LOCAL, pendientesPorCola: pend, switchesCuentaCobro: switches });
  const f2 = r.colas.find((c) => c.cola === 'FACTURACION_2');
  assert.strictEqual(f2.huerfana, false);
  assert.strictEqual(f2.pendientesHistoricos, 2);
});

await check('los pendientes históricos quedan INTACTOS', async () => {
  const antes = (await get(ref(db, `${LOCAL}/FACTURACION_2`))).val();
  // Una venta nueva de la misma cuenta no los toca ni se suma a la cola.
  await procesarVenta(ventaCon([{ method: 'Transferencia 2', amount: 3000 }], { id: 702 }));
  const despues = (await get(ref(db, `${LOCAL}/FACTURACION_2`))).val();
  assert.deepStrictEqual(despues, antes, 'ni se procesan, ni se borran, ni se agregan');
  assert.strictEqual(Object.keys(despues).length, 2);
});

await check('el tilde manual NO usa la favorita no fiscal', async () => {
  await sembrarNoFiscal();
  const r = await procesarVenta(ventaCon([{ method: 'Transferencia 2', amount: 9000 }], { id: 703, emiteFactura: true }));
  assert.strictEqual(r.resultado, 'encolado');
  assert.strictEqual(r.encolado.cuenta, 'Transferencia', 'la única con el switch encendido');
  assert.strictEqual(r.encolado.cola, 'FACTURACION_1');
  assert.ok(!(await get(ref(db, `${LOCAL}/FACTURACION_2`))).exists(), 'nunca a la cola de la cuenta que no factura');
  assert.ok(!(await get(ref(db, rutaRemitos(LOCAL)))).exists(), 'el usuario pidió factura: no sale un remito');
});

await check('sin ninguna cuenta fiscal, el tilde manual bloquea y no emite nada', async () => {
  await set(ref(db, LOCAL), null);
  await set(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`), { tipo: 'monotributo', monotributo: { cuentas: [] } });
  await set(ref(db, `${LOCAL}/CUENTAS`), {
    'cta-1': { nombre: 'Transferencia 2', imprimeFactura: false, isFavorite: true },
    'cta-2': { nombre: 'Mercado Pago', imprimeFactura: false },
  });

  const r = await procesarVenta(ventaCon([{ method: 'Transferencia 2', amount: 4000 }], { id: 704, emiteFactura: true }));
  assert.strictEqual(r.resultado, 'bloqueado');
  assert.ok(r.motivo.includes('No hay una cuenta fiscal habilitada'), r.motivo);
  for (const cola of ['FACTURACION_1', 'FACTURACION_2', 'FACTURACION_4']) {
    assert.ok(!(await get(ref(db, `${LOCAL}/${cola}`))).exists());
  }
  assert.ok(!(await get(ref(db, rutaRemitos(LOCAL)))).exists(), 'no se degrada a remito');
});

console.log('\n== COLAS HUÉRFANAS, DE FORMA GENÉRICA ==\n');

await check('detecta cualquier cola con pendientes que nadie va a facturar', async () => {
  await sembrar();
  // Ventas que quedaron esperando en una cola sin cuenta fiscal.
  await set(ref(db, `${LOCAL}/FACTURACION_7/M900`), { total: 1000, fecha: '01-01-2026' });
  await set(ref(db, `${LOCAL}/FACTURACION_7/M901`), { total: 2000, fecha: '15-02-2026' });

  const snap = await get(ref(db, `${LOCAL}/FACTURACION_7`));
  const claves = Object.keys(snap.val());
  const masViejoMs = new Date(2026, 0, 1).getTime();

  const huerfanas = detectarColasHuerfanas({
    config: CONFIG_FISCAL,
    pendientesPorCola: { FACTURACION_7: { n: claves.length, masViejoMs } },
  });
  assert.strictEqual(huerfanas.length, 1);
  assert.strictEqual(huerfanas[0].cola, 'FACTURACION_7');
  assert.strictEqual(huerfanas[0].pendientes, 2);
  assert.strictEqual(huerfanas[0].cuentaCobro, 'BANCO 2');
  assert.ok(huerfanas[0].antiguedadDias > 100);

  // Informar NO es procesar: los pendientes siguen intactos.
  assert.strictEqual(Object.keys((await get(ref(db, `${LOCAL}/FACTURACION_7`))).val()).length, 2);
});

await check('una cola incompleta con pendientes también se reporta huérfana', async () => {
  const huerfanas = detectarColasHuerfanas({
    config: CONFIG_FISCAL,
    pendientesPorCola: { FACTURACION_3: { n: 7, masViejoMs: Date.now() } },
  });
  assert.strictEqual(huerfanas.length, 1);
  assert.strictEqual(huerfanas[0].estado, 'certificado-invalido');
  assert.strictEqual(huerfanas[0].razonSocial, 'CARO TERCERA');
});

console.log('\n== SEPARACIÓN ENTRE LOCALES ==\n');

await check('un local no ve ni usa las cuentas fiscales de otro', async () => {
  await sembrar(LOCAL);
  await set(ref(db, `${OTRO_LOCAL}/CONFIGURACION/FACTURACION_AFIP`), {
    tipo: 'monotributo',
    monotributo: { cuentas: [{
      id: 'z', cuit: '23999999990', cuitFormat: '23-99999999-0', ptoVta: '7',
      razonSocial: 'OTRO COMERCIO', fantasia: 'OTRO', domicilio: 'LEJOS 1',
      condIVA: 'Monotributista', initialized: true,
      certStoragePath: 'x/c.crt', keyStoragePath: 'x/k.key', serviceAccountStoragePath: 'x/s.json',
      firebaseDb: 'https://otro-default-rtdb.firebaseio.com',
      firebasePath: `${OTRO_LOCAL}/FACTURACION_1`, firebaseHistorial: `${OTRO_LOCAL}/VENTAS`,
    }] },
  });

  const a = (await get(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`))).val();
  const b = (await get(ref(db, `${OTRO_LOCAL}/CONFIGURACION/FACTURACION_AFIP`))).val();
  assert.strictEqual(cuentaFiscalDeCola(a, 'FACTURACION_1').cuit, '20111111117');
  assert.strictEqual(cuentaFiscalDeCola(b, 'FACTURACION_1').cuit, '23999999990');

  // La cuenta del otro local NO puede facturar en este.
  const v = validarCuentaFiscal(cuentaFiscalDeCola(b, 'FACTURACION_1'), { localId: LOCAL });
  assert.strictEqual(v.listo, false);
  assert.ok(v.faltantes.some((f) => f.includes(`pertenece al local ${OTRO_LOCAL}`)));

  await limpiar(OTRO_LOCAL);
});

await check('la radiografía del local informa las nueve colas y su estado', async () => {
  await sembrar();
  const config = (await get(ref(db, `${LOCAL}/CONFIGURACION/FACTURACION_AFIP`))).val();
  const r = radiografiaDeColas({ config, localId: LOCAL, pendientesPorCola: { FACTURACION_7: { n: 2 } } });
  assert.strictEqual(r.colas.length, 10);
  assert.strictEqual(r.configuradas, 3);
  assert.strictEqual(r.listas, 2, 'la tercera cuenta está incompleta');
  assert.deepStrictEqual(r.huerfanas.map((c) => c.cola), ['FACTURACION_7']);
  assert.strictEqual(r.conflictos.length, 0);
  assert.strictEqual(r.identidadesDuplicadas.length, 0);
});

// Limpieza: el emulador queda como estaba.
await limpiar(LOCAL);
await limpiar(OTRO_LOCAL);

console.log(`\n${passed} verificaciones OK`);
process.exit(process.exitCode || 0);
