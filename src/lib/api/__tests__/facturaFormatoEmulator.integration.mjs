// FORMATO DE FACTURAS Y VISUALIZACIÓN DE REMITOS — INTEGRACIÓN CONTRA EL
// EMULADOR REAL de Realtime Database.
//
// Reproduce, con el emulador y datos de prueba, los tres problemas reales
// relevados el 26-07-2026 y verifica que quedaron corregidos:
//
//   1. facturas de locales MONOTRIBUTO que se reimprimían como "Comprobante de
//      Venta" con la tabla de productos vacía;
//   2. la letra del comprobante tomada del prefijo de la clave (FCB…) en vez
//      del tipo fiscal real;
//   3. remitos FCX que no aparecían en la pestaña Remitos.
//
// Cada local usa SUS PROPIOS datos fiscales: acá se comprueba explícitamente
// que no se mezclan razón social, CUIT ni punto de venta entre locales.
//
// NO se emite ningún comprobante real: no hay AFIP, no hay CAE nuevo, no se
// toca ninguna base de producción. Todo ocurre dentro del emulador.
//
// Correr con:
//   npm run test:factura-formato-emulator
import assert from 'node:assert';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, connectDatabaseEmulator } from 'firebase/database';
import {
  listarCuentasFiscales,
  normalizarComprobante,
  totalesImpositivos,
  validarComprobanteFiscal,
  esClaveDeFactura,
} from '../comprobanteFiscal.js';
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
const app = initializeApp({ databaseURL: `http://${HOST}?ns=stock-test` }, 'factura-formato');
const db = getDatabase(app);
connectDatabaseEmulator(db, host, Number(port));

// Locales reales, con SU configuración fiscal real (datos públicos del emisor).
const CENTENARIO = '51501748';
const TEMPERLEY  = '38827976';
const ILCAPO     = '31915636';
const ACHAVAL    = '40508022';

const CONFIGS = {
  [CENTENARIO]: {
    tipo: 'monotributo',
    monotributo: { cuentas: [{
      id: 'c1', cuit: '27255724792', cuitFormat: '27-25572479-2', ptoVta: '2',
      razonSocial: 'JESSICA MARIANA ALVARADO', fantasia: 'LANYULINA CENTENARIO',
      domicilio: 'CENTENARIO URUGUAYO 1199 LANUS', condIVA: 'Monotributista',
    }] },
  },
  [TEMPERLEY]: {
    tipo: 'monotributo',
    monotributo: { cuentas: [
      { id: 'a', cuit: '20456793577', cuitFormat: '20-45679357-7', ptoVta: '1', razonSocial: 'LAUTARO VERDERAME', fantasia: 'LANYULINA TEMPERLEY', domicilio: 'CERRITO 2557', condIVA: 'Monotributista' },
      { id: 'b', cuit: '27238537431', cuitFormat: '27-23853743-1', ptoVta: '4', razonSocial: 'MONICA RUTH PALOMO', fantasia: 'LANYULINA TEMPERLEY', domicilio: 'CERRITO 2557 TEMPERLEY', condIVA: 'Monotributista' },
      { id: 'c', cuit: '20226066404', cuitFormat: '20-22606640-4', ptoVta: '2', razonSocial: 'MARCELO GUSTAVO VERDERAME', fantasia: 'LANYULINA TEMPERLEY', domicilio: 'CERRITO 2557 TEMPERLEY', condIVA: 'Monotributista' },
    ] },
  },
  [ILCAPO]: {
    tipo: 'monotributo',
    monotributo: { cuentas: [{
      id: 'c1', cuit: '27268441021', cuitFormat: '27-26844102-1', ptoVta: '1',
      razonSocial: 'CAROLINA NARDI', fantasia: 'IL CAPO GELATO',
      domicilio: 'DIAGONAL JOSE LEON SUAREZ 7163', condIVA: 'Monotributista',
    }] },
  },
  [ACHAVAL]: {
    tipo: 'responsable_inscripto',
    ri: {
      id: 'ri', cuit: '20247915886', cuitFormat: '20-24791588-6', ptoVta: '8',
      razonSocial: 'DIEGO LEONEL VALENZISI', fantasia: 'LANYULINA ACHAVAL',
      domicilio: 'ACHAVAL 3703 MONTE CHINGOLO LANUS', condIVA: 'Responsable Inscripto',
      inicioActividades: '01/01/2024',
    },
    monotributo: { cuentas: [] },
  },
};

const limpiar = async (localId) => { await set(ref(db, localId), null); };

/** Deja la configuración fiscal del local en el emulador. */
const sembrarConfig = async (localId) => {
  await set(ref(db, `${localId}/CONFIGURACION/FACTURACION_AFIP`), CONFIGS[localId]);
};

/** Lee VENTAS + config y devuelve los comprobantes normalizados, como la app. */
const leerFacturas = async (localId) => {
  const [snapVentas, snapCfg] = await Promise.all([
    get(ref(db, `${localId}/VENTAS`)),
    get(ref(db, `${localId}/CONFIGURACION/FACTURACION_AFIP`)),
  ]);
  if (!snapVentas.exists()) return [];
  const config = snapCfg.exists() ? snapCfg.val() : null;
  const cuentas = listarCuentasFiscales(config);
  return Object.keys(snapVentas.val())
    .filter(esClaveDeFactura)
    .map((k) => normalizarComprobante(k, snapVentas.val()[k], { config, cuentas }));
};

// ---------------------------------------------------------------------------
// Registros de prueba — misma FORMA que los reales, importes inventados.
// ---------------------------------------------------------------------------

/** Factura C emitida por el runtime nuevo: trae CbteTipo, ARTICULOS y PDF. */
const facturaCCompleta = ({ ptoVta, nro, cuit, total, articulos }) => ({
  CAE: '86999999999999', CAE_VTO: '20261231', CbteTipo: 11, CUIT: cuit,
  ImpNeto: total, ImpIVA: 0,
  ARTICULOS: articulos,
  PTO_VTA: Number(ptoVta), NRO_CMP: nro,
  PDF: `factura-FCC000${ptoVta}-${String(nro).padStart(8, '0')}.pdf`,
  PDF_BASE64: 'JVBERi0xLjQK',
  clientes: 'Consumidor Final', direccion: 'Sin Datos',
  fecha: '26-07-2026', hora: '18:00:00',
  producto: { producto_1: { nombre: 'x', valor: total } },
  total,
});

/** Factura B del motor RI. */
const facturaBCompleta = ({ nro, total, articulos }) => ({
  CAE: '86888888888888', VtoCAE: '20261231', CbteTipo: 6, CUIT: '20247915886',
  ImpNeto: +(total / 1.21).toFixed(2), ImpIVA: +(total - +(total / 1.21).toFixed(2)).toFixed(2),
  CLIENTE: 'Consumidor Final', TOTAL: total,
  ARTICULOS: articulos, PRODUCTO: articulos,
  PDF_BASE64: 'JVBERi0xLjQK',
  fecha: '26-07-2026', hora: '18:00:00',
  NumeroFactura: `0008-${String(nro).padStart(8, '0')}`,
});

console.log('\n== FORMATO DE FACTURAS ==\n');

await check('FCC con productos completos: se reimprime como Factura C válida', async () => {
  await limpiar(ILCAPO);
  await sembrarConfig(ILCAPO);
  await set(ref(db, `${ILCAPO}/VENTAS/FCC0001-00000469`), facturaCCompleta({
    ptoVta: 1, nro: 469, cuit: '27268441021', total: 15000,
    articulos: { 1: { nombre: '1 KILO DE HELADO', cantidad: 1, precioUnitario: 15000, precioTotal: 15000 } },
  }));

  const [f] = await leerFacturas(ILCAPO);
  const v = validarComprobanteFiscal(f);
  assert.strictEqual(v.valido, true, `problemas: ${v.problemas.join(' | ')}`);
  assert.strictEqual(f.tipoNombre, 'Factura C');
  assert.strictEqual(f.tipoOrigen, 'registro');
  assert.strictEqual(f.articulos.length, 1);
  assert.strictEqual(f.numeroCompleto, '0001-00000469');
  assert.ok(f.qrUrl, 'debe tener QR oficial de ARCA');
  assert.ok(f.pdfBase64, 'el PDF original debe estar disponible para reimprimir');
});

await check('FCB con productos completos: Factura B con IVA discriminado', async () => {
  await limpiar(ACHAVAL);
  await sembrarConfig(ACHAVAL);
  await set(ref(db, `${ACHAVAL}/VENTAS/FCB0008-00009973`), facturaBCompleta({
    nro: 9973, total: 12100,
    articulos: { 1: { nombre: '1 KILO DE HELADO', cantidad: 1, precioUnitario: 12100, precioTotal: 12100 } },
  }));

  const [f] = await leerFacturas(ACHAVAL);
  assert.strictEqual(validarComprobanteFiscal(f).valido, true);
  assert.strictEqual(f.tipoNombre, 'Factura B');
  const imp = totalesImpositivos(f);
  assert.strictEqual(imp.discrimina, true);
  assert.strictEqual(imp.alicuota, 21);
  assert.strictEqual(Number((imp.neto + imp.iva).toFixed(2)), 12100);
});

await check('venta con opcionales: el desglose sobrevive a la reimpresión', async () => {
  await limpiar(ILCAPO);
  await sembrarConfig(ILCAPO);
  await set(ref(db, `${ILCAPO}/VENTAS/FCC0001-00000470`), facturaCCompleta({
    ptoVta: 1, nro: 470, cuit: '27268441021', total: 3200,
    articulos: { 1: {
      nombre: 'Milanesa', cantidad: 2, precioUnitario: 1500, precioTotal: 3200, totalOpcionales: 200,
      selectedOptionals: { g1: [{ nombre: 'Queso', total: 200, cantidad: 1 }] },
    } },
  }));

  const [f] = await leerFacturas(ILCAPO);
  assert.strictEqual(validarComprobanteFiscal(f).valido, true);
  assert.strictEqual(f.articulos[0].cantidad, 2);
  assert.strictEqual(f.articulos[0].precioTotal, 3200);
  assert.ok(f.articulos[0].selectedOptionals, 'los opcionales deben poder imprimirse');
});

await check('pago combinado: UN comprobante por el total, con su forma de pago', async () => {
  await limpiar(CENTENARIO);
  await sembrarConfig(CENTENARIO);
  await set(ref(db, `${CENTENARIO}/VENTAS/FCC0002-00001978`), {
    ...facturaCCompleta({ ptoVta: 2, nro: 1978, cuit: '27255724792', total: 5700,
      articulos: { 1: { nombre: '1/4 KILO DE HELADO', cantidad: 1, precioUnitario: 5700, precioTotal: 5700 } } }),
    formaPago: 'Efectivo + Transferencia',
  });

  const facturas = await leerFacturas(CENTENARIO);
  assert.strictEqual(facturas.length, 1, 'un pago combinado no puede generar dos facturas');
  assert.strictEqual(facturas[0].importe, 5700);
  assert.strictEqual(facturas[0].formaPago, 'Efectivo + Transferencia');
});

await check('cliente consumidor final: documento del receptor "no requiere"', async () => {
  const [f] = await leerFacturas(CENTENARIO);
  assert.strictEqual(f.cliente.nombre, 'Consumidor Final');
  assert.strictEqual(f.docTipoReceptor, 99);
  assert.strictEqual(f.docNroReceptor, 0);
  assert.strictEqual(f.condIVAReceptor, 'Consumidor Final');
});

await check('factura con CAE y QR: el QR contiene los datos de ESA factura', async () => {
  const [f] = await leerFacturas(CENTENARIO);
  assert.strictEqual(f.cae, '86999999999999');
  assert.strictEqual(f.caeVtoLegible, '31/12/2026');
  assert.deepStrictEqual(f.qrDatos, {
    ver: 1, fecha: '2026-07-26', cuit: 27255724792, ptoVta: 2, tipoCmp: 11, nroCmp: 1978,
    importe: 5700, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E',
    codAut: 86999999999999,
  });
  assert.ok(!f.qrUrl.includes('FCC0002'), 'el QR no puede ser el número interno del comprobante');
});

await check('PDF sin productos: FALLA la validación y no se imprime como factura', async () => {
  await limpiar(TEMPERLEY);
  await sembrarConfig(TEMPERLEY);
  // Exactamente la forma del registro defectuoso real: total presente, CAE
  // presente, y ninguna clave de detalle.
  await set(ref(db, `${TEMPERLEY}/VENTAS/FCC0001-00001345`), {
    CAE: '86283528405868', CAE_VTO: '20260722', PTO_VTA: 1, NRO_CMP: 1345,
    clientes: 'Consumidor Final', direccion: 'Sin Datos',
    fecha: '26-07-2026', hora: '18:00:00', total: 17500,
  });

  const [f] = await leerFacturas(TEMPERLEY);
  const v = validarComprobanteFiscal(f);
  assert.strictEqual(v.valido, false, 'una factura con total y sin detalle NO es válida');
  assert.ok(v.problemas.some((p) => p.includes('detalle de productos')), v.problemas.join(' | '));
  assert.strictEqual(f.importe, 17500, 'el total sigue informándose: el registro no se oculta');
});

console.log('\n== DATOS FISCALES PROPIOS DE CADA LOCAL ==\n');

await check(`${CENTENARIO} usa sus propios datos fiscales`, async () => {
  await limpiar(CENTENARIO);
  await sembrarConfig(CENTENARIO);
  await set(ref(db, `${CENTENARIO}/VENTAS/FCC0002-00001979`), facturaCCompleta({
    ptoVta: 2, nro: 1979, cuit: '27255724792', total: 8000,
    articulos: { 1: { nombre: '1/2 KILO', cantidad: 1, precioUnitario: 8000, precioTotal: 8000 } },
  }));
  const [f] = await leerFacturas(CENTENARIO);
  assert.strictEqual(f.emisor.razonSocial, 'JESSICA MARIANA ALVARADO');
  assert.strictEqual(f.emisor.cuit, '27-25572479-2');
  assert.strictEqual(f.emisor.fantasia, 'LANYULINA CENTENARIO');
  assert.strictEqual(f.puntoVenta, '0002');
  assert.strictEqual(f.tipoNombre, 'Factura C');
});

await check(`${TEMPERLEY} usa sus propios datos fiscales, por punto de venta`, async () => {
  await limpiar(TEMPERLEY);
  await sembrarConfig(TEMPERLEY);
  // Las TRES cuentas del local, cada una con su CUIT y su punto de venta.
  await set(ref(db, `${TEMPERLEY}/VENTAS/FCC0001-00001200`), facturaCCompleta({ ptoVta: 1, nro: 1200, cuit: '20456793577', total: 100, articulos: { 1: { nombre: 'a', cantidad: 1, precioUnitario: 100, precioTotal: 100 } } }));
  await set(ref(db, `${TEMPERLEY}/VENTAS/FCC0004-00002500`), facturaCCompleta({ ptoVta: 4, nro: 2500, cuit: '27238537431', total: 200, articulos: { 1: { nombre: 'b', cantidad: 1, precioUnitario: 200, precioTotal: 200 } } }));
  await set(ref(db, `${TEMPERLEY}/VENTAS/FCC0002-00002960`), facturaCCompleta({ ptoVta: 2, nro: 2960, cuit: '20226066404', total: 300, articulos: { 1: { nombre: 'c', cantidad: 1, precioUnitario: 300, precioTotal: 300 } } }));

  const porNumero = Object.fromEntries((await leerFacturas(TEMPERLEY)).map((f) => [f.id, f]));
  assert.strictEqual(porNumero['FCC0001-00001200'].emisor.razonSocial, 'LAUTARO VERDERAME');
  assert.strictEqual(porNumero['FCC0004-00002500'].emisor.razonSocial, 'MONICA RUTH PALOMO');
  assert.strictEqual(porNumero['FCC0002-00002960'].emisor.razonSocial, 'MARCELO GUSTAVO VERDERAME');
  const cuits = new Set(Object.values(porNumero).map((f) => f.emisor.cuit));
  assert.strictEqual(cuits.size, 3, 'las tres cuentas deben mantener CUITs distintos');
});

await check(`${ILCAPO} usa sus propios datos fiscales`, async () => {
  await limpiar(ILCAPO);
  await sembrarConfig(ILCAPO);
  await set(ref(db, `${ILCAPO}/VENTAS/FCC0001-00000471`), facturaCCompleta({
    ptoVta: 1, nro: 471, cuit: '27268441021', total: 9000,
    articulos: { 1: { nombre: 'FRANUI', cantidad: 1, precioUnitario: 9000, precioTotal: 9000 } },
  }));
  const [f] = await leerFacturas(ILCAPO);
  assert.strictEqual(f.emisor.razonSocial, 'CAROLINA NARDI');
  assert.strictEqual(f.emisor.cuit, '27-26844102-1');
  assert.strictEqual(f.puntoVenta, '0001');
});

await check('no se mezclan razón social, CUIT ni punto de venta entre locales', async () => {
  const [cen] = await leerFacturas(CENTENARIO);
  const [cap] = await leerFacturas(ILCAPO);
  const ach = (await leerFacturas(ACHAVAL))[0];

  // Il Capo y Temperley/Lautaro comparten punto de venta 0001 en locales
  // distintos: la configuración del local es lo que los separa.
  assert.strictEqual(cap.puntoVenta, '0001');
  assert.notStrictEqual(cap.emisor.cuit, cen.emisor.cuit);
  assert.notStrictEqual(cap.emisor.cuit, ach.emisor.cuit);
  assert.notStrictEqual(cen.emisor.razonSocial, cap.emisor.razonSocial);
  // Achaval NO puede imponer su condición fiscal a los monotributistas.
  assert.strictEqual(ach.tipoNombre, 'Factura B');
  assert.strictEqual(cen.tipoNombre, 'Factura C');
  assert.strictEqual(cap.tipoNombre, 'Factura C');
});

await check('un FCB de local monotributo se muestra como Factura C', async () => {
  await limpiar(CENTENARIO);
  await sembrarConfig(CENTENARIO);
  // Registro histórico exacto: clave FCB…, sin CbteTipo, punto de venta 2.
  await set(ref(db, `${CENTENARIO}/VENTAS/FCB0002-00001078`), {
    CAE: '86073656030720', CAE_VTO: '20260222', NRO_CMP: 1078, PTO_VTA: 2,
    PDF: 'factura-FCB0002-00001078.pdf',
    clientes: 'consumidor final', fecha: '18-02-2026', hora: '20:11:03',
    producto: { producto_1: { nombre: '1/4 KILO DE HELADO', valor: 5100 } },
    total: 5100,
  });

  const [f] = await leerFacturas(CENTENARIO);
  assert.strictEqual(f.id, 'FCB0002-00001078', 'la clave técnica NO se renombra');
  assert.strictEqual(f.tipoNombre, 'Factura C', 'el prefijo FCB no puede imponer la letra B');
  assert.strictEqual(f.tipoOrigen, 'cuenta-emisora');
  assert.strictEqual(f.articulos.length, 1, 'la tabla de productos ya no sale vacía');
  assert.strictEqual(f.articulos[0].nombre, '1/4 KILO DE HELADO');
  assert.strictEqual(validarComprobanteFiscal(f).valido, true);
});

console.log('\n== REMITOS ==\n');

const VENTA_EFECTIVO = {
  id: 4712, total: 5500, date: '26-07-2026', hora: '20:15:00', fechacaja: '26-07-2026', turno: 7,
  client: { name: 'Consumidor Final' },
  payments: [{ method: 'Efectivo', amount: 5500 }],
  items: [{ nombre: '1/4 KILO DE HELADO', cantidad: 1, valor: 5500, precioBaseUnitario: 5500, subtotalLinea: 5500, codigo: '81A' }],
};

await check(`los FCX de ${CENTENARIO} aparecen en Remitos`, async () => {
  await limpiar(CENTENARIO);
  await sembrarConfig(CENTENARIO);

  const r = await emitirRemito({
    db, raiz: CENTENARIO, venta: VENTA_EFECTIVO, canal: 'mostrador',
    puntoVenta: '2', revalidarDb: () => db,
  });
  assert.strictEqual(r.estado, 'emitido', `no se emitió: ${JSON.stringify(r)}`);

  // La pantalla lee EXACTAMENTE /{localId}/Remitos.
  const snap = await get(ref(db, rutaRemitos(CENTENARIO)));
  assert.ok(snap.exists(), `/${CENTENARIO}/Remitos debe existir`);
  const filas = filasDeRemitos(snap.val());
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].numeroFactura, r.numeroComprobante);
  assert.ok(filas[0].numeroFactura.startsWith('FCX0002-'), filas[0].numeroFactura);
  assert.strictEqual(filas[0].esRemito, true);
  assert.strictEqual(filas[0].importe, 5500);
  assert.strictEqual(filas[0].articulos.length, 1, 'el remito debe reimprimirse con su detalle');

  // El remito NO va a la ruta fiscal.
  const ventas = await get(ref(db, `${CENTENARIO}/VENTAS`));
  assert.ok(!ventas.exists(), 'un remito no se escribe en VENTAS');
});

await check('el contador de la pestaña sale de la MISMA colección filtrada', async () => {
  const snap = await get(ref(db, rutaRemitos(CENTENARIO)));
  const filas = filasDeRemitos(snap.val());
  // Es la misma lista que alimenta la tabla: el número del tab no puede salir
  // de otra consulta.
  assert.strictEqual(filas.length, Object.keys(snap.val()).length);
});

// El filtro de la pantalla, replicado tal cual: la fila trae la fecha en
// dd-MM-yyyy y el rango llega en yyyy-MM-dd. Las tres se construyen en hora
// LOCAL —como hacen parse/startOfDay/endOfDay de date-fns en SalesPage— porque
// mezclar una fecha local con una interpretada en UTC corre el límite del día.
const localDesde = (yyyyMMdd) => {
  const [a, m, d] = yyyyMMdd.split('-').map(Number);
  return new Date(a, m - 1, d, 0, 0, 0, 0).getTime();
};
const localHasta = (yyyyMMdd) => {
  const [a, m, d] = yyyyMMdd.split('-').map(Number);
  return new Date(a, m - 1, d, 23, 59, 59, 999).getTime();
};
const enRango = (filas, desde, hasta) => filas.filter((f) => {
  const [d, m, a] = String(f.fecha || '').split('-');
  if (!a) return false;
  const t = new Date(Number(a), Number(m) - 1, Number(d)).getTime();
  return t >= localDesde(desde) && t <= localHasta(hasta);
});

await check('filtro de hoy y rango inclusivo en los dos extremos', async () => {
  const snap = await get(ref(db, rutaRemitos(CENTENARIO)));
  const filas = filasDeRemitos(snap.val());
  assert.strictEqual(filas[0].fecha, '26-07-2026');

  assert.strictEqual(enRango(filas, '2026-07-26', '2026-07-26').length, 1, 'el filtro "Hoy" debe incluirlo');
  assert.strictEqual(enRango(filas, '2026-07-26', '2026-07-31').length, 1, 'inclusivo en el extremo inicial');
  assert.strictEqual(enRango(filas, '2026-07-20', '2026-07-26').length, 1, 'inclusivo en el extremo final');
  assert.strictEqual(enRango(filas, '2026-07-20', '2026-07-25').length, 0);
});

await check('reimpresión de remito: mismos renglones que el remito guardado', async () => {
  const snap = await get(ref(db, rutaRemitos(CENTENARIO)));
  const [fila] = filasDeRemitos(snap.val());
  assert.strictEqual(fila.esRemito, true, 'la reimpresión debe salir como Remito, no como factura');
  assert.strictEqual(fila.articulos[0].nombre, '1/4 KILO DE HELADO');
  assert.strictEqual(fila.articulos[0].cantidad, 1);
  assert.strictEqual(fila.articulos[0].precioTotal, 5500);
  assert.strictEqual(fila.facturado, false);
});

await check('reprocesar la misma venta NO emite un segundo remito', async () => {
  const antes = Object.keys((await get(ref(db, rutaRemitos(CENTENARIO)))).val()).length;
  const venta = { ...VENTA_EFECTIVO, remito: (await get(ref(db, `${CENTENARIO}/MOSTRADOR/4712/remito`))).val() };
  const r = await emitirRemito({ db, raiz: CENTENARIO, venta, canal: 'mostrador', puntoVenta: '2', revalidarDb: () => db });
  assert.notStrictEqual(r.estado, 'emitido', `se emitió un remito duplicado: ${JSON.stringify(r)}`);
  const despues = Object.keys((await get(ref(db, rutaRemitos(CENTENARIO)))).val()).length;
  assert.strictEqual(despues, antes);
});

await check('los remitos de un local no se ven desde otro', async () => {
  await limpiar(ILCAPO);
  const snap = await get(ref(db, rutaRemitos(ILCAPO)));
  assert.ok(!snap.exists(), 'Il Capo no puede ver los remitos de Centenario');
});

// Limpieza: el emulador queda como estaba.
for (const l of [CENTENARIO, TEMPERLEY, ILCAPO, ACHAVAL]) await limpiar(l);

console.log(`\n${passed} verificaciones OK`);
process.exit(process.exitCode || 0);
