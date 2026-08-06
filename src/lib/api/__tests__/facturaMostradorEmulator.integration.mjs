// ---------------------------------------------------------------------------
// RECORRIDO COMPLETO de "¿Desea imprimir la factura?" contra el emulador REAL.
//
// Cubre la cadena entera de una venta de mostrador facturada a pedido:
//
//   decidir si se pregunta → encolar en FACTURACION_N → el motor emite y
//   escribe en VENTAS con CAE → se detecta la factura de ESA venta → se
//   normaliza el comprobante → queda listo para imprimir con todos sus datos
//   fiscales.
//
// El motor AFIP no se puede correr acá (necesita certificados y ARCA), así que
// se SIMULA exactamente lo que hace: toma la entrada de la cola, la borra y
// escribe el registro fiscal con `{...pedido}` — que es la razón por la que la
// referencia encolada vuelve dentro de la factura.
//
// Correr con:
//   firebase emulators:exec --only database --project stock-test
//     --config emulator/firebase.json
//     "node src/lib/api/__tests__/facturaMostradorEmulator.integration.mjs"
// ---------------------------------------------------------------------------
import assert from 'node:assert';
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, ref, get, set, remove, connectDatabaseEmulator } from 'firebase/database';
import {
  decidirSiPreguntar, aplicarRespuestaImpresion, referenciaDeVenta,
  buscarFacturaDeVenta, evaluarEspera, claveEnCola,
  MOTIVO_APP, MOTIVO_APAGADO,
  resolverCuentaFavorita, mensajeFavorita,
  FAVORITA_SIN_ALIAS, FAVORITA_NO_ENCONTRADA, FAVORITA_SIN_COLA,
} from '../facturaMostrador.js';
import { normalizarComprobante, validarComprobanteFiscal } from '../comprobanteFiscal.js';

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!HOST) { console.error('Falta FIREBASE_DATABASE_EMULATOR_HOST.'); process.exit(1); }
const [host, port] = HOST.split(':');
const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'facturaMostrador');
const db = getDatabase(app); connectDatabaseEmulator(db, host, Number(port));

const LOCAL = '40508022';
const COLA = 'FACTURACION_1';
const CUIT = '20304050607';

// Config fiscal del local, con la MISMA forma que lee colasFiscalesApi:
// `monotributo.cuentas[]`, cada una con su `firebasePath` (de ahí sale la cola).
const CONFIG = {
  monotributo: {
    cuentas: [{
      id: 'cuenta-1', cuit: CUIT, cuitFormat: '20-30405060-7', ptoVta: 2,
      razonSocial: 'HELADERIA DEMO SRL', fantasia: 'DLV Heladería',
      condIVA: 'Monotributo', domicilio: 'Av. Siempreviva 742',
      inicioActividades: '2020-01-01', firebasePath: `${LOCAL}/${COLA}`,
    }],
  },
};

const venta = (...metodos) => ({ payments: metodos.map((m) => ({ method: m, amount: 1700 })) });

console.log(`Emulador RTDB en ${HOST}\n`);
console.log('Decisión: con la configuración en ON se pregunta SIEMPRE, salvo PedidosYa:');

for (const [nombre, medios] of [
  ['efectivo', ['Efectivo']],
  ['transferencia', ['Transferencia']],
  ['electrónico', ['Mercado Pago']],
  ['pago dividido', ['Efectivo', 'Transferencia']],
]) {
  await check(`${nombre} → pregunta`, () => {
    const r = decidirSiPreguntar({ preguntarActivo: true, venta: venta(...medios) });
    assert.strictEqual(r.preguntar, true);
  });
}
await check('el tilde "Emite Factura" NO saltea (marcado o no)', () => {
  // La decisión ni siquiera mira `emiteFactura`: la pregunta es su confirmación.
  const conTilde = { ...venta('Transferencia'), emiteFactura: true };
  const sinTilde = { ...venta('Transferencia'), emiteFactura: false };
  assert.strictEqual(decidirSiPreguntar({ preguntarActivo: true, venta: conTilde }).preguntar, true);
  assert.strictEqual(decidirSiPreguntar({ preguntarActivo: true, venta: sinTilde }).preguntar, true);
});
await check('una cuenta con imprimeFactura TAMPOCO saltea', () => {
  // La decisión ya no recibe ningún dato de comprobante ni de cuenta: por
  // diseño no hay forma de que la configuración fiscal saltee la pregunta.
  const fuente = decidirSiPreguntar.toString();
  assert.ok(!/comprobante/i.test(fuente), 'la decisión no puede mirar el comprobante');
  assert.ok(!/imprimeFactura/i.test(fuente), 'la decisión no puede mirar imprimeFactura');
  assert.strictEqual(decidirSiPreguntar({ preguntarActivo: true, venta: venta('Transferencia') }).preguntar, true);
});
for (const p of ['PREPAGO PEDIDOSYA', 'PedidosYa', 'Pedidos Ya', 'PEDIDOS_YA', 'peya']) {
  await check(`PedidosYa "${p}" → NO pregunta`, () => {
    assert.strictEqual(decidirSiPreguntar({ preguntarActivo: true, venta: venta(p) }).motivo, MOTIVO_APP);
  });
}
await check('PedidosYa en pago dividido → NO pregunta', () => {
  assert.strictEqual(decidirSiPreguntar({ preguntarActivo: true, venta: venta('Efectivo', 'PREPAGO PEDIDOSYA') }).motivo, MOTIVO_APP);
});
await check('configuración OFF → NO pregunta', () => {
  assert.strictEqual(decidirSiPreguntar({ preguntarActivo: false, venta: venta('Efectivo') }).motivo, MOTIVO_APAGADO);
});
await check('el estado del motor de facturación NO influye', () => {
  // Arquitectura real: una PC procesa la cola, varias terminales venden.
  // Cualquier terminal debe poder preguntar, encolar y esperar el CAE.
  const fuente = decidirSiPreguntar.toString();
  assert.ok(!/servicio/i.test(fuente), 'la decisión no puede mirar el estado del servicio');
  assert.strictEqual(decidirSiPreguntar({ preguntarActivo: true, venta: venta('Efectivo') }).preguntar, true);
});

// ---------------------------------------------------------------------------
// LA CUENTA CON LA QUE SE FACTURA ES LA FAVORITA, POR ALIAS.
// Datos reales de Achaval: /ALIAS = "HELADERIA.ACHAVAL" y CUENTAS donde la
// favorita (cta-1 "Transferencia" → FACTURACION_1) tiene imprimeFactura FALSE,
// mientras que cta-2 ("Transferencia 2" → FACTURACION_2) lo tiene TRUE.
// Elegir por `imprimeFactura` mandaba a FACTURACION_2, que no está configurada.
console.log('\nCuenta favorita por /ALIAS (no por imprimeFactura):');

const ALIAS_REAL = 'HELADERIA.ACHAVAL';
const CUENTAS_REALES = {
  'cta-1': { nombre: 'Transferencia', alias: 'HELADERIA.ACHAVAL', imprimeFactura: false, isFavorite: true },
  'cta-2': { nombre: 'Transferencia 2', alias: 'HELA.LANYULINA.LANUS', imprimeFactura: true, isFavorite: false },
  'cta-3': { nombre: 'PREPAGO PEDIDOSYA', alias: 'PEDIDOSYA', imprimeFactura: false, isFavorite: false },
  'cta-4': { nombre: 'PREPAGO RAPPI', alias: 'RAPPI', imprimeFactura: false, isFavorite: false },
};

await check('el alias resuelve la favorita y su cola, ignorando imprimeFactura', () => {
  const r = resolverCuentaFavorita({ alias: ALIAS_REAL, cuentas: CUENTAS_REALES });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cuenta.nombre, 'Transferencia');
  assert.strictEqual(r.cola, 'FACTURACION_1', 'la cola de la favorita, no la de la que imprime factura');
  assert.strictEqual(r.cuenta.imprimeFactura, false, 'la favorita ni siquiera tiene el interruptor');
});
await check('NO elige la cuenta con imprimeFactura:true', () => {
  const r = resolverCuentaFavorita({ alias: ALIAS_REAL, cuentas: CUENTAS_REALES });
  assert.notStrictEqual(r.cola, 'FACTURACION_2');
  assert.notStrictEqual(r.cuenta.nombre, 'Transferencia 2');
});
await check('el medio de pago cobrado no cambia la cuenta elegida', () => {
  // El alias es lo único que decide: efectivo, transferencia o dividido dan igual.
  const r = resolverCuentaFavorita({ alias: ALIAS_REAL, cuentas: CUENTAS_REALES });
  assert.strictEqual(r.cola, 'FACTURACION_1');
  const fuente = resolverCuentaFavorita.toString();
  assert.ok(!/imprimeFactura/.test(fuente), 'no puede mirar imprimeFactura');
  assert.ok(!/payments|metodo/i.test(fuente), 'no puede mirar el medio de pago');
});
await check('alias con espacios o distinta caja igual resuelve', () => {
  assert.strictEqual(resolverCuentaFavorita({ alias: '  heladeria.achaval ', cuentas: CUENTAS_REALES }).cola, 'FACTURACION_1');
});
await check('sin alias → avisa, no elige otra', () => {
  const r = resolverCuentaFavorita({ alias: '', cuentas: CUENTAS_REALES });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, FAVORITA_SIN_ALIAS);
  assert.match(mensajeFavorita(r.motivo), /No se pudo identificar la cuenta favorita/);
});
await check('alias que no coincide con ninguna cuenta → avisa, no elige otra', () => {
  const r = resolverCuentaFavorita({ alias: 'NO.EXISTE', cuentas: CUENTAS_REALES });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, FAVORITA_NO_ENCONTRADA);
  assert.ok(!r.cuenta, 'no devuelve ninguna cuenta de consuelo');
});
await check('favorita sin cola fiscal conocida → avisa', () => {
  const r = resolverCuentaFavorita({
    alias: 'X', cuentas: { c: { nombre: 'Cuenta Rara', alias: 'X' } },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, FAVORITA_SIN_COLA);
  assert.match(mensajeFavorita(r.motivo), /no tiene una configuración fiscal válida/);
});

// ---------------------------------------------------------------------------
// EMITIR ≠ IMPRIMIR. El cartel pregunta sólo por imprimir: un "No" no puede
// apagar una facturación que igual correspondía.
console.log('\nEfecto de la respuesta (emitir vs. imprimir):');

const efecto = (tilde, respuesta) =>
  aplicarRespuestaImpresion({ emiteFacturaOriginal: tilde, respuesta });

await check('tilde ON + NO → factura, pero NO imprime', () => {
  const r = efecto(true, false);
  assert.strictEqual(r.emiteFactura, true, 'la emisión NO se cancela');
  assert.strictEqual(r.esperarCaeEImprimir, false, 'no espera CAE ni imprime');
});
await check('pago que factura solo + NO → factura, pero NO imprime', () => {
  // El tilde está apagado; la factura la dispara la cuenta/medio de pago más
  // adelante, en saveCounterSale. La respuesta NO no la toca.
  const r = efecto(false, false);
  assert.strictEqual(r.emiteFactura, false, 'no se fuerza nada desde el cartel');
  assert.strictEqual(r.esperarCaeEImprimir, false);
  // Lo que decide la facturación automática es facturaORemito, no este módulo:
  // el cartel no puede intervenir en esa decisión.
  const fuente = aplicarRespuestaImpresion.toString();
  assert.ok(!/false/.test(fuente.split('return')[1] || ''), 'nunca fuerza emiteFactura a false');
});
await check('tilde OFF + efectivo + NO → no factura ni imprime', () => {
  const r = efecto(false, false);
  assert.deepStrictEqual(r, { emiteFactura: false, esperarCaeEImprimir: false });
});
await check('tilde OFF + efectivo + SÍ → factura, espera CAE e imprime', () => {
  const r = efecto(false, true);
  assert.deepStrictEqual(r, { emiteFactura: true, esperarCaeEImprimir: true });
});
await check('tilde ON + SÍ → factura UNA sola vez, espera CAE e imprime', () => {
  const r = efecto(true, true);
  assert.deepStrictEqual(r, { emiteFactura: true, esperarCaeEImprimir: true });
});
await check('nunca se hace emiteFactura = respuesta', () => {
  // La regresión que hay que impedir: con esa asignación, tilde ON + NO daría
  // emiteFactura false y se perdería una factura que correspondía.
  assert.notStrictEqual(efecto(true, false).emiteFactura, false);
});

// ---------------------------------------------------------------------------
console.log('\nRecorrido completo contra el emulador (encolar → CAE → comprobante):');

const SALE_ID = 1712;
const CLAVE = claveEnCola(SALE_ID);

/** Encola la venta tal cual lo hace saveCounterSaleToFacturacion. */
async function encolar(saleId) {
  const payload = {
    clientes: 'Consumidor Final', direccion: 'Sin Datos',
    producto: { producto_1: { nombre: '1/2 KILO DE HELADO', valor: 1700, cantidad: 1, precioTotal: 1700 } },
    fecha: '01-08-2026', hora: '18:30:00', total: 1700,
    ...referenciaDeVenta({ localId: LOCAL, saleId }),
    colaFacturacion: COLA, cuentaCobro: 'Transferencia',
  };
  await set(ref(db, `${LOCAL}/${COLA}/${claveEnCola(saleId)}`), payload);
  return payload;
}

/** Simula al motor AFIP: consume la cola y escribe el comprobante con `{...pedido}`. */
async function motorEmite(saleId, { numero = '00000042', cae = '75123456789012' } = {}) {
  const clave = claveEnCola(saleId);
  const pedido = (await get(ref(db, `${LOCAL}/${COLA}/${clave}`))).val();
  const claveFactura = `FCC0002-${numero}`;
  await set(ref(db, `${LOCAL}/VENTAS/${claveFactura}`), {
    ...pedido,                       // ← así vuelve la referencia encolada
    CAE: cae, CAE_VTO: '2026-08-11',
    NumeroFactura: `0002-${numero}`, PTO_VTA: 2, NRO_CMP: Number(numero),
    CbteTipo: 11, CUIT: CUIT, FECHA: '01-08-2026',
  });
  await remove(ref(db, `${LOCAL}/${COLA}/${clave}`));
  return claveFactura;
}

await check('la venta encolada llega a FACTURACION_1 con su referencia', async () => {
  await encolar(SALE_ID);
  const enCola = (await get(ref(db, `${LOCAL}/${COLA}/${CLAVE}`))).val();
  assert.ok(enCola, 'la entrada existe en la cola');
  assert.strictEqual(enCola.origen, 'MOSTRADOR');
  assert.strictEqual(enCola.mostradorId, String(SALE_ID));
  assert.strictEqual(enCola.idempotencyKey, `${LOCAL}:MOSTRADOR:${SALE_ID}`);
});

await check('mientras no hay CAE, la espera NO imprime nada', async () => {
  const ventas = (await get(ref(db, `${LOCAL}/VENTAS`))).val() || {};
  const r = evaluarEspera({
    factura: buscarFacturaDeVenta(ventas, SALE_ID),
    lock: { status: 'processing' }, sigueEnCola: true, vencido: false,
  });
  assert.strictEqual(r.estado, 'esperando');
});

let claveFactura;
await check('cuando el motor emite, se encuentra la factura de ESA venta', async () => {
  claveFactura = await motorEmite(SALE_ID);
  const ventas = (await get(ref(db, `${LOCAL}/VENTAS`))).val() || {};
  const f = buscarFacturaDeVenta(ventas, SALE_ID);
  assert.ok(f, 'se encontró la factura');
  assert.strictEqual(f.clave, claveFactura);
  assert.strictEqual(f.registro.CAE, '75123456789012');
  assert.strictEqual(evaluarEspera({ factura: f, lock: null, sigueEnCola: false, vencido: false }).estado, 'emitida');
});

await check('la cola quedó vacía: no se encola dos veces', async () => {
  assert.strictEqual((await get(ref(db, `${LOCAL}/${COLA}/${CLAVE}`))).val(), null);
});

await check('el comprobante trae TODOS los datos fiscales obligatorios', async () => {
  const registro = (await get(ref(db, `${LOCAL}/VENTAS/${claveFactura}`))).val();
  const c = normalizarComprobante(claveFactura, registro, { config: CONFIG });

  assert.strictEqual(c.emisor.razonSocial, 'HELADERIA DEMO SRL', 'razón social');
  assert.strictEqual(c.emisor.fantasia, 'DLV Heladería', 'nombre de fantasía');
  assert.strictEqual(String(c.emisor.cuit).replace(/\D/g, ''), CUIT, 'CUIT');
  assert.ok(c.emisor.condIVA, 'condición frente al IVA');
  assert.ok(c.emisor.domicilio, 'domicilio comercial');
  assert.strictEqual(c.letra, 'C', 'letra del comprobante');
  assert.ok(c.tipoNombre, 'tipo de comprobante');
  assert.strictEqual(String(c.puntoVenta).padStart(4, '0'), '0002', 'punto de venta');
  assert.strictEqual(Number(c.nroComprobante), 42, 'número de factura');
  assert.ok(c.numeroCompleto, 'número completo para el encabezado');
  assert.ok(c.fecha, 'fecha');
  assert.ok(c.articulos.length > 0, 'productos');
  assert.strictEqual(c.importe, 1700, 'total');
  assert.strictEqual(c.cae, '75123456789012', 'CAE');
  assert.ok(c.caeVto, 'vencimiento del CAE');
  assert.ok(c.qrUrl && /arca\.gob\.ar\/fe\/qr/.test(c.qrUrl), 'QR fiscal oficial de ARCA');
  assert.ok(c.formaPago !== undefined, 'forma de pago disponible para el ticket');

  const v = validarComprobanteFiscal(c);
  assert.strictEqual(v.valido, true, `comprobante incompleto: ${v.problemas.join(' | ')}`);
});

await check('una segunda venta no se confunde con la primera', async () => {
  const OTRA = 1713;
  await encolar(OTRA);
  await motorEmite(OTRA, { numero: '00000043', cae: '75999999999999' });
  const ventas = (await get(ref(db, `${LOCAL}/VENTAS`))).val() || {};
  assert.strictEqual(buscarFacturaDeVenta(ventas, SALE_ID).registro.CAE, '75123456789012');
  assert.strictEqual(buscarFacturaDeVenta(ventas, OTRA).registro.CAE, '75999999999999');
});

await check('rechazo de ARCA: SIN locks queda "demorada" y NO se imprime', async () => {
  // El sistema de `{COLA}_LOCKS` fue eliminado: la app ya no tiene de dónde
  // leer el mensaje exacto del rechazo. El pedido sigue en la cola, la espera
  // vence y se avisa que continúa en proceso — nunca se imprime ni se da por
  // facturada. El error real, completo, queda en el log del facturador.
  const RECHAZADA = 1714;
  await encolar(RECHAZADA);
  const ventas = (await get(ref(db, `${LOCAL}/VENTAS`))).val() || {};

  // Antes de vencer el tiempo: sigue esperando.
  const enEspera = evaluarEspera({
    factura: buscarFacturaDeVenta(ventas, RECHAZADA),
    lock: null, sigueEnCola: true, vencido: false,
  });
  assert.strictEqual(enEspera.estado, 'esperando');

  // Al vencer: demorada, con el pedido todavía en la cola.
  const r = evaluarEspera({
    factura: buscarFacturaDeVenta(ventas, RECHAZADA),
    lock: null, sigueEnCola: true, vencido: true,
  });
  assert.strictEqual(r.estado, 'demorada');
  assert.strictEqual(r.sigueEnCola, true);

  // Y no se creó ninguna rama de locks.
  assert.strictEqual((await get(ref(db, `${LOCAL}/${COLA}_LOCKS`))).exists(), false);
});

await check('timeout: avisa y NO imprime, la factura puede salir después', async () => {
  const LENTA = 1715;
  await encolar(LENTA);
  let ventas = (await get(ref(db, `${LOCAL}/VENTAS`))).val() || {};
  const r = evaluarEspera({ factura: buscarFacturaDeVenta(ventas, LENTA), lock: null, sigueEnCola: true, vencido: true });
  assert.strictEqual(r.estado, 'demorada');
  assert.match(r.mensaje, /podrá imprimirse desde Ventas/);

  // El motor termina más tarde: la factura queda disponible en Ventas y NO se
  // genera una segunda (la cola ya se consumió).
  const claveTardia = await motorEmite(LENTA, { numero: '00000044', cae: '75888888888888' });
  ventas = (await get(ref(db, `${LOCAL}/VENTAS`))).val() || {};
  const f = buscarFacturaDeVenta(ventas, LENTA);
  assert.strictEqual(f.clave, claveTardia);
  const c = normalizarComprobante(f.clave, f.registro, { config: CONFIG });
  assert.strictEqual(validarComprobanteFiscal(c).valido, true, 'la factura tardía es imprimible');
  assert.strictEqual((await get(ref(db, `${LOCAL}/${COLA}/${claveEnCola(LENTA)}`))).val(), null, 'no quedó encolada de nuevo');
});

console.log(`\n${passed} pruebas de integración OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
await deleteApp(app);
process.exit(process.exitCode || 0);
