#!/usr/bin/env node
/**
 * AUDITORÍA FISCAL DE TODOS LOS LOCALES — SOLO LECTURA.
 *
 * ⚠️  NO ESCRIBE NADA. Ni en RTDB, ni en Storage, ni en las colas. No procesa
 *     pendientes, no emite comprobantes y no borra registros defectuosos: los
 *     informa.
 *
 * Es GENÉRICA: no conoce ningún local en particular. La lista de locales sale
 * del registro de rutas (`/rutas/{localId}` en el RTDB maestro) más, como
 * complemento, los locales que la app trae precargados. Un local nuevo aparece
 * acá automáticamente en cuanto se registra, sin tocar este archivo.
 *
 * Por cada local y por cada FACTURACION_1..9 informa:
 *   cuenta de cobro asociada, imprimeFactura, CUIT, razón social, punto de
 *   venta, tipo fiscal, runtime esperada, estado, pendientes y su antigüedad,
 *   ownership, y si el PDF de sus facturas usa los datos de esa misma cola.
 *
 * Y por cada local: facturas sin CAE, sin PDF y sin productos, remitos, y datos
 * fiscales faltantes (inicio de actividades / Ingresos Brutos).
 *
 * Uso:
 *   node scripts/auditar-colas-fiscales.mjs                 # todos los locales
 *   node scripts/auditar-colas-fiscales.mjs 51501748 38827976
 *   node scripts/auditar-colas-fiscales.mjs --json informe.json
 *   node scripts/auditar-colas-fiscales.mjs --muestra 300   # facturas a revisar por local
 */

import fs from 'node:fs';
import {
  COLAS_FISCALES,
  COLA_LEGADA,
  ETIQUETA_ESTADO,
  claveOwnership,
  radiografiaDeColas,
  switchesDeCuentasCobro,
} from '../src/lib/api/colasFiscales.js';
import {
  esClaveDeFactura,
  listarCuentasFiscales,
  normalizarComprobante,
  validarComprobanteFiscal,
} from '../src/lib/api/comprobanteFiscal.js';

// RTDB maestro donde vive el registro de rutas de los locales.
const REGISTRO_RUTAS = 'https://achava3703-default-rtdb.firebaseio.com';

// Locales que la app trae precargados (src/lib/firebase/core.js). Sirven de
// complemento: si un local ya está en /rutas, gana el registro.
const PRECARGADOS = {
  40508022: 'https://achava3703-default-rtdb.firebaseio.com',
  38827976: 'https://bdtemperley-default-rtdb.firebaseio.com',
  51501748: 'https://centenario1199-default-rtdb.firebaseio.com',
  25230974: 'https://buranoheladerias-default-rtdb.firebaseio.com',
  34734081: 'https://lanyulinacanada-default-rtdb.firebaseio.com',
  34516605: 'https://heladeriabynnonadrogue-default-rtdb.firebaseio.com',
  31915636: 'https://ilcapogelatojls2026-default-rtdb.firebaseio.com',
};

const argv = process.argv.slice(2);
// Índices que son VALOR de una opción (`--muestra 150`): no son números de
// local. Sin esto, "150" se tomaría como un local y la auditoría no correría
// sobre ninguno.
const consumidos = new Set();
const flagValor = (n, def = null) => {
  const i = argv.indexOf(`--${n}`);
  if (i === -1 || !argv[i + 1] || argv[i + 1].startsWith('--')) return def;
  consumidos.add(i + 1);
  return argv[i + 1];
};
const SALIDA_JSON = flagValor('json');
const MUESTRA = Number(flagValor('muestra', '250')) || 250;
const LOCALES_PEDIDOS = argv.filter((a, i) => !consumidos.has(i) && /^\d+$/.test(a));

const leer = async (base, ruta, qs = '') => {
  try {
    const r = await fetch(`${base}/${String(ruta).replace(/^\/+/, '')}.json${qs}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};
const claves = async (base, ruta) => {
  const v = await leer(base, ruta, '?shallow=true');
  return v && typeof v === 'object' ? Object.keys(v) : null;
};

/** Locales a auditar: registro de rutas + precargados. Sin hardcodear ninguno. */
async function descubrirLocales() {
  const salida = { ...PRECARGADOS };
  const rutas = await leer(REGISTRO_RUTAS, 'rutas');
  if (rutas && typeof rutas === 'object') {
    for (const [localId, cfg] of Object.entries(rutas)) {
      const url = String(cfg?.databaseURL || '').replace(/\/+$/, '');
      if (/^\d+$/.test(localId) && url) salida[localId] = url;
    }
  }
  if (LOCALES_PEDIDOS.length) {
    return Object.fromEntries(
      LOCALES_PEDIDOS.filter((l) => salida[l]).map((l) => [l, salida[l]])
    );
  }
  return salida;
}

const fechaAms = (f) => {
  const m = String(f ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : null;
};

async function auditarLocal(localId, base) {
  console.log(`\n${'='.repeat(78)}\nLOCAL ${localId}   ${base}\n${'='.repeat(78)}`);
  const rep = { localId, db: base };

  // --- Configuración fiscal y cuentas de cobro ------------------------------
  const config = await leer(base, `${localId}/CONFIGURACION/FACTURACION_AFIP`);
  const cuentasCobro = await leer(base, `${localId}/CUENTAS`);
  if (!config) console.log('\n  ⚠ El local no tiene configuración fiscal cargada.');

  const switchesCuentaCobro = switchesDeCuentasCobro(cuentasCobro || {});
  const favorita = Object.values(cuentasCobro || {}).find((c) => c?.isFavorite === true) || null;
  rep.cuentaFavorita = favorita?.nombre || null;
  rep.favoritaEsFiscal = favorita ? favorita.imprimeFactura === true : null;
  rep.cuentasFiscalesHabilitadas = Object.values(cuentasCobro || {})
    .filter((c) => c?.imprimeFactura === true).map((c) => c.nombre);

  // --- Pendientes por cola ---------------------------------------------------
  const pendientesPorCola = {};
  for (const cola of [...COLAS_FISCALES, COLA_LEGADA]) {
    const nodo = await leer(base, `${localId}/${cola}`);
    if (!nodo || typeof nodo !== 'object') continue;
    const ks = Object.keys(nodo);
    if (!ks.length) continue;
    let masViejoMs = null;
    let masNuevoMs = null;
    const fechas = {};
    for (const k of ks) {
      const f = nodo[k]?.fecha ?? '(sin fecha)';
      fechas[f] = (fechas[f] || 0) + 1;
      const t = fechaAms(nodo[k]?.fecha);
      if (!t) continue;
      if (masViejoMs === null || t < masViejoMs) masViejoMs = t;
      if (masNuevoMs === null || t > masNuevoMs) masNuevoMs = t;
    }
    // Estructura del primer pendiente: para poder decidir qué hacer con ellos.
    const ejemplo = nodo[ks[0]];
    pendientesPorCola[cola] = {
      n: ks.length, masViejoMs, masNuevoMs,
      claves: ks.slice(0, 5),
      campos: ejemplo && typeof ejemplo === 'object' ? Object.keys(ejemplo) : [],
      fechasDistintas: Object.keys(fechas).length,
      rangoFechas: [
        masViejoMs ? new Date(masViejoMs).toLocaleDateString('es-AR') : null,
        masNuevoMs ? new Date(masNuevoMs).toLocaleDateString('es-AR') : null,
      ],
    };
  }

  // --- Ownership -------------------------------------------------------------
  const owners = (await leer(base, `${localId}/FACTURACION_OWNERS`)) || {};

  // --- Radiografía (la MISMA función que usa la app) -------------------------
  const radiografia = radiografiaDeColas({ config, localId, pendientesPorCola, switchesCuentaCobro });
  rep.colas = [];

  console.log(`\n-- CUENTAS DE COBRO --`);
  console.log(`      favorita: ${rep.cuentaFavorita || '(ninguna)'}${favorita ? (rep.favoritaEsFiscal ? ' [fiscal]' : ' [NO fiscal: sus ventas son remitos]') : ''}`);
  console.log(`      cuentas fiscales habilitadas (imprimeFactura=true): ${rep.cuentasFiscalesHabilitadas.join(', ') || '(ninguna)'}`);

  console.log('\n-- COLAS FISCALES --');
  for (const fila of radiografia.colas) {
    if (!fila.configurada && fila.pendientes === 0 && fila.imprimeFactura !== true) continue;
    const c = fila.cuenta;
    const ownerKey = c?.cuit && c?.puntoVenta ? claveOwnership(c.cuit, c.puntoVenta) : null;
    const owner = ownerKey ? owners[ownerKey] || null : null;

    const info = {
      cola: fila.cola,
      cuentaCobro: fila.cuentaCobro,
      imprimeFactura: fila.imprimeFactura,
      cuit: c?.cuitFormat || c?.cuit || null,
      razonSocial: c?.razonSocial || null,
      puntoVenta: c?.puntoVenta || null,
      tipoFiscal: c?.letra ? `Factura ${c.letra}` : null,
      runtimeEsperada: c?.runtime || null,
      estado: fila.estado,
      etiqueta: ETIQUETA_ESTADO[fila.estado] || fila.estado,
      listo: fila.listo,
      esError: fila.esError,
      noFactura: fila.noFactura,
      faltantes: fila.faltantes,
      avisos: fila.avisos,
      pendientes: fila.pendientes,
      pendientesHistoricos: fila.pendientesHistoricos,
      recibiendoNuevas: fila.recibiendoNuevas,
      antiguedadDias: fila.masViejoMs ? Math.floor((Date.now() - fila.masViejoMs) / 86400000) : null,
      huerfana: fila.huerfana,
      detallePendientes: pendientesPorCola[fila.cola] || null,
      ownership: owner ? { equipo: owner.deviceName || owner.machineId || '(sin nombre)', desde: owner.updatedAt || null } : null,
      inicioActividades: c?.inicioActividades || null,
      ingresosBrutos: c?.ingresosBrutos || null,
    };
    rep.colas.push(info);

    // Una cuenta de cobro apagada NO es un error: se marca en gris (·).
    const marca = fila.huerfana ? '❗' : fila.noFactura ? '·' : fila.listo ? '✔' : '⚠';
    console.log(`  ${marca} ${fila.cola}  ${info.etiqueta}  ${info.razonSocial || (fila.noFactura ? '' : '(sin cuenta fiscal)')}`);
    console.log(`      cuenta de cobro: ${info.cuentaCobro || '—'}  imprimeFactura=${info.imprimeFactura === null ? 'no existe esa cuenta en el local' : info.imprimeFactura}`);
    if (fila.noFactura) {
      console.log(`      sus ventas generan REMITO a propósito: no necesita CUIT, punto de venta, certificado ni runtime.`);
    }
    if (c) console.log(`      ${info.tipoFiscal || '(sin tipo)'}  CUIT ${info.cuit}  Pto.Vta ${info.puntoVenta}  runtime=${info.runtimeEsperada}`);
    if (info.faltantes.length) console.log(`      falta: ${info.faltantes.join(', ')}`);
    if (info.avisos.length) console.log(`      avisos: ${info.avisos.join(' | ')}`);
    if (info.pendientes) {
      const d = info.detallePendientes;
      const tipo = info.pendientesHistoricos ? 'HISTÓRICOS (no se procesan)' : info.huerfana ? 'ATASCADOS' : 'en curso';
      console.log(`      pendientes: ${info.pendientes} ${tipo}` +
        (d?.rangoFechas?.[0] ? ` · del ${d.rangoFechas[0]} al ${d.rangoFechas[1]} (${d.fechasDistintas} fechas)` : ''));
      if (d?.campos?.length) console.log(`         estructura: { ${d.campos.join(', ')} }   ej: ${d.claves.join(', ')}`);
      if (info.recibiendoNuevas) console.log(`         ❗ sigue recibiendo ventas nuevas`);
    }
    if (c) console.log(`      ownership: ${info.ownership ? info.ownership.equipo : 'sin dueño registrado'}`);
  }

  if (radiografia.conflictos.length) {
    console.log('\n  ❗ DOS CUENTAS EN LA MISMA COLA:');
    for (const c of radiografia.conflictos) console.log(`      ${c.cola}: ${c.cuentas.join(' / ')}`);
  }
  if (radiografia.identidadesDuplicadas.length) {
    console.log('\n  ❗ MISMO CUIT + PUNTO DE VENTA EN VARIAS COLAS:');
    for (const d of radiografia.identidadesDuplicadas) console.log(`      ${d.clave} → ${d.colas.join(', ')}`);
  }
  if (radiografia.cuentasSinCola.length) {
    console.log(`\n  ⚠ ${radiografia.cuentasSinCola.length} cuenta(s) fiscal(es) sin cola asignada (firebasePath no termina en FACTURACION_N).`);
  }
  rep.conflictos = radiografia.conflictos;
  rep.identidadesDuplicadas = radiografia.identidadesDuplicadas;
  rep.cuentasSinCola = radiografia.cuentasSinCola.length;

  // --- Integridad de las facturas guardadas ---------------------------------
  const cuentasFiscales = listarCuentasFiscales(config);
  const ventasKeys = (await claves(base, `${localId}/VENTAS`)) || [];
  const facturas = ventasKeys.filter(esClaveDeFactura);
  const muestra = facturas.slice(-MUESTRA);

  const stats = {
    ventas: ventasKeys.length,
    facturas: facturas.length,
    fcx: ventasKeys.filter((k) => k.startsWith('FCX')).length,
    revisadas: 0, sinCAE: 0, sinPDF: 0, sinProductos: 0, sinQR: 0,
    tipoInferido: 0, sinEmisor: 0, pdfDeOtraCola: 0, porLetra: {},
  };

  for (let i = 0; i < muestra.length; i += 40) {
    const lote = muestra.slice(i, i + 40);
    const datos = await Promise.all(lote.map((k) => leer(base, `${localId}/VENTAS/${k}`)));
    datos.forEach((v, j) => {
      if (!v) return;
      stats.revisadas += 1;
      const c = normalizarComprobante(lote[j], v, { config, cuentas: cuentasFiscales });
      const val = validarComprobanteFiscal(c);
      if (!c.cae) stats.sinCAE += 1;
      if (!c.pdfBase64) stats.sinPDF += 1;
      if (!c.articulos.length) stats.sinProductos += 1;
      if (!c.qrUrl) stats.sinQR += 1;
      if (c.tipoInferido) stats.tipoInferido += 1;
      if (!c.emisor) stats.sinEmisor += 1;
      const letra = c.letra || '(desconocida)';
      stats.porLetra[letra] = (stats.porLetra[letra] || 0) + 1;

      // ¿El PDF/los datos fiscales del comprobante son los de SU cola?
      if (c.colaFacturacion && c.emisor?.cola && c.colaFacturacion !== c.emisor.cola) {
        stats.pdfDeOtraCola += 1;
      }
      void val;
    });
    process.stdout.write(`\r      revisando facturas ${Math.min(i + 40, muestra.length)}/${muestra.length}   `);
  }
  if (muestra.length) console.log('');

  rep.facturas = stats;
  console.log('\n-- FACTURAS GUARDADAS --');
  console.log(`      VENTAS=${stats.ventas}  facturas=${stats.facturas}  FCX en VENTAS=${stats.fcx}`);
  console.log(`      revisadas (últimas ${MUESTRA}): ${stats.revisadas}`);
  console.log(`      sin CAE=${stats.sinCAE}  sin PDF=${stats.sinPDF}  sin productos=${stats.sinProductos}  sin QR=${stats.sinQR}`);
  console.log(`      letra: ${JSON.stringify(stats.porLetra)}  (tipo inferido: ${stats.tipoInferido}, sin emisor identificable: ${stats.sinEmisor})`);
  if (stats.pdfDeOtraCola) console.log(`      ❗ ${stats.pdfDeOtraCola} comprobantes cuyos datos fiscales no son los de su cola`);

  // --- Remitos ---------------------------------------------------------------
  const remitos = (await claves(base, `${localId}/Remitos`)) || [];
  rep.remitos = remitos.length;
  console.log(`\n-- REMITOS --\n      /${localId}/Remitos: ${remitos.length}`);
  for (const mala of ['REMITOS', 'remitos']) {
    const k = await claves(base, `${localId}/${mala}`);
    if (k) console.log(`      ⚠ existe también /${localId}/${mala} con ${k.length} claves`);
  }
  const contadorRemitos = await leer(base, `${localId}/CONTADORES/remitos`);
  console.log(`      contador /${localId}/CONTADORES/remitos = ${contadorRemitos ?? '(no existe)'}`);

  // --- Datos fiscales faltantes ---------------------------------------------
  const faltanDatos = rep.colas.filter((c) => c.razonSocial && (!c.inicioActividades || !c.ingresosBrutos));
  if (faltanDatos.length) {
    console.log('\n-- DATOS FISCALES FALTANTES --');
    for (const c of faltanDatos) {
      const f = [!c.inicioActividades && 'inicio de actividades', !c.ingresosBrutos && 'Ingresos Brutos'].filter(Boolean);
      console.log(`      ${c.cola} (${c.razonSocial}): falta ${f.join(' y ')}`);
    }
  }
  rep.datosFiscalesFaltantes = faltanDatos.map((c) => ({ cola: c.cola, razonSocial: c.razonSocial, inicioActividades: !!c.inicioActividades, ingresosBrutos: !!c.ingresosBrutos }));

  return rep;
}

// ---------------------------------------------------------------------------

const locales = await descubrirLocales();
console.log(`AUDITORÍA FISCAL — SOLO LECTURA`);
console.log(`Locales a auditar: ${Object.keys(locales).join(', ') || '(ninguno)'}`);

const informe = {};
for (const [localId, base] of Object.entries(locales)) {
  informe[localId] = await auditarLocal(localId, base);
}

// --- Resumen transversal ------------------------------------------------------
console.log(`\n\n${'='.repeat(78)}\nRESUMEN\n${'='.repeat(78)}`);
const huerfanas = [];
for (const r of Object.values(informe)) {
  for (const c of r.colas || []) if (c.huerfana) huerfanas.push({ local: r.localId, ...c });
}
if (huerfanas.length === 0) console.log('\n  Sin colas huérfanas.');
else {
  console.log('\n  COLAS HUÉRFANAS (ventas esperando que nadie va a facturar):');
  for (const h of huerfanas) {
    console.log(`    local ${h.local}  ${h.cola}  ${h.pendientes} pendientes` +
      (h.antiguedadDias !== null ? ` (más viejo: ${h.antiguedadDias} días)` : '') +
      `  cuenta de cobro: ${h.cuentaCobro || '—'}  CUIT: ${h.cuit || '—'}  Pto.Vta: ${h.puntoVenta || '—'}` +
      `  runtime esperada: ${h.runtimeEsperada || '—'}  [${h.estado}]`);
  }
}

// Pendientes de cuentas que YA NO facturan: no son un error, son un resto
// histórico. Se informan para que el dueño decida qué hacer con ellos.
const historicos = [];
for (const r of Object.values(informe)) {
  for (const c of r.colas || []) if (c.pendientesHistoricos > 0) historicos.push({ local: r.localId, ...c });
}
if (historicos.length) {
  console.log('\n  PENDIENTES HISTÓRICOS (cuenta de cobro con "Imprime Factura" apagado):');
  console.log('  No se procesan, no se borran y no reciben ventas nuevas. Hay que decidir si se');
  console.log('  anulan, se archivan o se convierten en remitos históricos.');
  for (const h of historicos) {
    const d = h.detallePendientes;
    console.log(`    local ${h.local}  ${h.cola}  ${h.pendientesHistoricos} pedidos` +
      (d?.rangoFechas?.[0] ? `  del ${d.rangoFechas[0]} al ${d.rangoFechas[1]}` : '') +
      `  cuenta: ${h.cuentaCobro}`);
    if (d?.campos?.length) console.log(`        estructura: { ${d.campos.join(', ')} }`);
  }
}

const sinCuentaFiscal = Object.values(informe).filter((r) => (r.cuentasFiscalesHabilitadas || []).length === 0 && (r.colas || []).length > 0);
if (sinCuentaFiscal.length) {
  console.log('\n  LOCALES SIN NINGUNA CUENTA FISCAL HABILITADA (el tilde manual va a bloquear):');
  for (const r of sinCuentaFiscal) console.log(`    ${r.localId}  (favorita: ${r.cuentaFavorita || 'ninguna'})`);
}

const favoritaNoFiscal = Object.values(informe).filter((r) => r.favoritaEsFiscal === false);
if (favoritaNoFiscal.length) {
  console.log('\n  LOCALES CUYA CUENTA FAVORITA NO FACTURA (correcto si es deliberado):');
  for (const r of favoritaNoFiscal) {
    console.log(`    ${r.localId}  favorita "${r.cuentaFavorita}" → genera remito.` +
      `  Para el tilde manual se usará: ${r.cuentasFiscalesHabilitadas.join(', ') || '(ninguna → bloquea)'}`);
  }
}

console.log('\n  POR LOCAL:');
for (const r of Object.values(informe)) {
  const listas = (r.colas || []).filter((c) => c.listo).length;
  const conf = (r.colas || []).filter((c) => c.razonSocial).length;
  console.log(`    ${r.localId}: ${listas}/${conf} colas listas · facturas ${r.facturas?.facturas ?? 0} · remitos ${r.remitos ?? 0} · sin PDF ${r.facturas?.sinPDF ?? 0} · sin productos ${r.facturas?.sinProductos ?? 0}`);
}

if (SALIDA_JSON) {
  fs.writeFileSync(SALIDA_JSON, JSON.stringify(informe, null, 2), 'utf8');
  console.log(`\nInforme guardado en ${SALIDA_JSON}`);
}
console.log('\nNo se escribió NADA en Firebase.');
