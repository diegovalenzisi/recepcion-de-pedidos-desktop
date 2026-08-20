// ---------------------------------------------------------------------------
// DIAGNÓSTICO DE SALDO INICIAL — 100% SOLO LECTURA.
//
// Este script NO ESCRIBE NADA, en ningún lado. Solo hace GET. No hay una sola
// llamada con method distinto de GET en todo el archivo, y hay una prueba que
// lo verifica (diagnosticoSoloLectura.test.js).
//
// PARA QUÉ
// --------
// La migración calcula el saldo inicial como Σ COMISIONES/REGISTRO −
// Σ COMISIONES/PAGOS. Esa cuenta ve las operaciones de Desktop, de DLV
// Consultas y de la Cloud Function, pero NO ve las de Tablet:
//
//     Tablet venta  →  RESUMEN_CUENTA        (no entra en REGISTRO)
//     Tablet pago   →  PAGOS_COMISIONES      (no entra en COMISIONES/PAGOS)
//
// Las dos asimetrías NO son igual de graves:
//
//   · Una venta de Tablet que no está en REGISTRO hace que la deuda quede
//     SUBESTIMADA. Es pasado no reconocido y no se reconstruye: esa es la
//     regla. No se toca.
//
//   · Un pago de Tablet que no está en COMISIONES/PAGOS hace que la deuda
//     quede SOBREESTIMADA: el local terminaría debiendo algo que YA PAGÓ.
//     Eso es cobrar dos veces y es lo que este diagnóstico viene a encontrar.
//
// QUÉ NO HACE
// -----------
// No mira MOSTRADOR, ni PEDIDOS, ni BACKUP, ni historiales de venta. No
// reconstruye ninguna comisión perdida. Solo lee los ledgers de comisión.
//
// EMPAREJAMIENTO, SIN ADIVINAR
// ----------------------------
// Un pago de PAGOS_COMISIONES y uno de COMISIONES/PAGOS pueden ser el MISMO
// pago cargado en los dos ledgers, o dos pagos distintos. No hay ninguna
// identidad compartida entre los dos esquemas, así que se comparan importe y
// fecha:
//
//     REFLEJADO   hay exactamente un pago del ledger nuevo con el mismo
//                 importe y dentro de la ventana de días  →  ya está contado
//     NO REFLEJADO  no hay ninguno  →  candidato a descontar del saldo inicial
//     AMBIGUO     hay más de uno, o el importe coincide con varios  →  NO se
//                 decide: queda para revisar a mano
//
// Nada de esto se aplica solo. El script imprime una tabla y nada más.
//
// Uso:
//   node scripts/diagnostico-saldo-inicial.mjs
//   node scripts/diagnostico-saldo-inicial.mjs --local 31915636
//   node scripts/diagnostico-saldo-inicial.mjs --detalle
// ---------------------------------------------------------------------------

const LOCALES = [
  { nombre: 'Achaval',    db: 'https://achava3703-default-rtdb.firebaseio.com',             id: '40508022' },
  { nombre: 'Temperley',  db: 'https://bdtemperley-default-rtdb.firebaseio.com',            id: '38827976' },
  { nombre: 'Centenario', db: 'https://centenario1199-default-rtdb.firebaseio.com',         id: '51501748' },
  { nombre: 'Burano',     db: 'https://buranoheladerias-default-rtdb.firebaseio.com',       id: '25230974' },
  { nombre: 'Canada',     db: 'https://lanyulinacanada-default-rtdb.firebaseio.com',        id: '34734081' },
  { nombre: 'IlCapo',     db: 'https://ilcapogelatojls2026-default-rtdb.firebaseio.com',    id: '31915636' },
  { nombre: 'Joao',       db: 'https://achava3703-default-rtdb.firebaseio.com',             id: '58290322' },
  { nombre: 'Viticos',    db: 'https://achava3703-default-rtdb.firebaseio.com',             id: '57641732' },
];

// Las MISMAS reglas de useCommissionTotal.js — el estado oficial de hoy.
const PAGO_NO_APROBADO = new Set([
  'rechazado', 'rechazada', 'rejected', 'pendiente', 'pending', 'in_process',
  'in_mediation', 'cancelado', 'cancelada', 'cancelled', 'canceled', 'refunded', 'charged_back',
]);
const REGISTRO_CANCELADO = new Set(['cancelada', 'cancelado', 'cancelled', 'canceled']);

/** Ventana de días para considerar que dos pagos podrían ser el mismo. */
const VENTANA_DIAS = 2;

const args = process.argv.slice(2);
const soloLocal = args.includes('--local') ? args[args.indexOf('--local') + 1] : null;
const DETALLE = args.includes('--detalle');

const aCentavos = (pesos) => {
  const n = Number(pesos);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const money = (c) => (c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ÚNICA función que toca la red. Solo GET. */
const leer = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const leerRuta = (base, id, ruta, query = '') =>
  leer(`${base}/${id}/${ruta}.json${query}`);

// --- Fechas ---------------------------------------------------------------
/** "dd-mm-aaaa" (ledger nuevo) → ms, o null. */
const msDesdeFechaAR = (fecha) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(fecha || ''));
  if (!m) return null;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
  return Number.isNaN(t) ? null : t;
};
/** ISO (PAGOS_COMISIONES) → ms, o null. */
const msDesdeISO = (iso) => {
  const t = Date.parse(String(iso || ''));
  return Number.isNaN(t) ? null : t;
};
const dia = (ms) => (ms === null ? '(sin fecha)' : new Date(ms).toISOString().slice(0, 10));

// --- Cálculo del estado oficial de hoy ------------------------------------
function calcularLedgerNuevo(registro, pagos) {
  const entries = Array.isArray(registro)
    ? registro.map((v, i) => [String(i), v])
    : Object.entries(registro || {});

  let historico = 0, nValidos = 0, nCancelados = 0, sinCentavos = 0;
  for (const [, r] of entries) {
    if (!r) continue;
    const estado = String(r.estado ?? '').trim().toLowerCase();
    if (REGISTRO_CANCELADO.has(estado)) { nCancelados++; continue; }
    historico += aCentavos(r.comisionGenerada);
    if (!Number.isInteger(r.comisionGeneradaCentavos)) sinCentavos++;
    nValidos++;
  }

  const lista = [];
  let pagado = 0;
  for (const [key, p] of Object.entries(pagos || {})) {
    if (!p) continue;
    const estado = String(p.estado ?? '').trim().toLowerCase();
    if (estado && PAGO_NO_APROBADO.has(estado)) continue;
    const centavos = aCentavos(p.montoPago);
    pagado += centavos;
    lista.push({ key, centavos, ms: msDesdeFechaAR(p.fechaPago), estado: p.estado ?? '(sin estado)' });
  }

  return {
    historico, pagado, saldo: Math.max(0, historico - pagado),
    nValidos, nCancelados, sinCentavos, pagos: lista,
  };
}

/**
 * Pagos del ledger LEGACY de Tablet. Se leen los ids con ?shallow=true y
 * después solo los dos campos que hacen falta: el nodo completo incluye
 * `sales`, que archiva RESUMEN_CUENTA entero y puede pesar megabytes.
 */
async function leerPagosComisiones(base, id) {
  let ids = null;
  try { ids = await leerRuta(base, id, 'PAGOS_COMISIONES', '?shallow=true'); }
  catch { return { existe: false, lista: [] }; }
  if (!ids || typeof ids !== 'object') return { existe: false, lista: [] };

  const lista = [];
  for (const key of Object.keys(ids)) {
    const [monto, fecha] = await Promise.all([
      leerRuta(base, id, `PAGOS_COMISIONES/${key}/paymentAmount`).catch(() => null),
      leerRuta(base, id, `PAGOS_COMISIONES/${key}/paymentDate`).catch(() => null),
    ]);
    lista.push({ key, centavos: aCentavos(monto), ms: msDesdeISO(fecha), fechaCruda: fecha });
  }
  lista.sort((a, b) => (a.ms || 0) - (b.ms || 0));
  return { existe: true, lista };
}

/**
 * ¿Este pago de Tablet ya está contado en el ledger nuevo?
 *
 * No hay identidad compartida entre los dos esquemas, así que lo único
 * comparable es importe + fecha. Cuando la respuesta no es única, NO se decide.
 */
function emparejar(pagoLegacy, pagosNuevos, usados) {
  const ventanaMs = VENTANA_DIAS * 24 * 60 * 60 * 1000;
  const candidatos = pagosNuevos.filter((p, i) => {
    if (usados.has(i)) return false;
    if (p.centavos !== pagoLegacy.centavos) return false;
    if (pagoLegacy.ms === null || p.ms === null) return true; // sin fecha: no discrimina
    return Math.abs(p.ms - pagoLegacy.ms) <= ventanaMs;
  });

  if (candidatos.length === 1) {
    const i = pagosNuevos.indexOf(candidatos[0]);
    usados.add(i);
    return { estado: 'REFLEJADO', con: candidatos[0].key };
  }
  if (candidatos.length === 0) {
    // Sin ningún pago del mismo importe: es un pago que el ledger nuevo no vio.
    // Igual se marca ambiguo si el importe coincide con ALGUNO ya usado, porque
    // entonces no se puede afirmar que sean operaciones distintas.
    const mismoImporteYaUsado = pagosNuevos.some((p, i) => usados.has(i) && p.centavos === pagoLegacy.centavos);
    return mismoImporteYaUsado
      ? { estado: 'AMBIGUO', motivo: 'hay otro pago del mismo importe ya emparejado' }
      : { estado: 'NO_REFLEJADO' };
  }
  return { estado: 'AMBIGUO', motivo: `${candidatos.length} pagos del ledger nuevo podrían ser el mismo` };
}

// ---------------------------------------------------------------------------
console.log('DIAGNOSTICO DE SALDO INICIAL — SOLO LECTURA (no escribe nada)');
console.log('='.repeat(110));

const objetivo = soloLocal ? LOCALES.filter((l) => l.id === soloLocal) : LOCALES;
if (objetivo.length === 0) { console.error(`No existe el local ${soloLocal}`); process.exit(1); }

const filas = [];

for (const loc of objetivo) {
  const fila = { loc, acceso: true };
  try {
    const [registro, pagos, totales, pendientes] = await Promise.all([
      leerRuta(loc.db, loc.id, 'COMISIONES/REGISTRO'),
      leerRuta(loc.db, loc.id, 'COMISIONES/PAGOS'),
      leerRuta(loc.db, loc.id, 'COMISIONES/TOTALES'),
      leerRuta(loc.db, loc.id, 'COMISIONES/PAGOS_PENDIENTES').catch(() => null),
    ]);
    const nuevo = calcularLedgerNuevo(registro, pagos);
    const legacy = await leerPagosComisiones(loc.db, loc.id);
    const resumen = await leerRuta(loc.db, loc.id, 'RESUMEN_CUENTA/TOTALES').catch(() => null);

    // Emparejamiento
    const usados = new Set();
    const ordenNuevos = [...nuevo.pagos].sort((a, b) => (a.ms || 0) - (b.ms || 0));
    const clasificados = legacy.lista.map((p) => ({ ...p, ...emparejar(p, ordenNuevos, usados) }));

    const noReflejados = clasificados.filter((c) => c.estado === 'NO_REFLEJADO');
    const ambiguos = clasificados.filter((c) => c.estado === 'AMBIGUO');
    const reflejados = clasificados.filter((c) => c.estado === 'REFLEJADO');

    const sumaNoReflejados = noReflejados.reduce((a, c) => a + c.centavos, 0);
    const sumaAmbiguos = ambiguos.reduce((a, c) => a + c.centavos, 0);

    // Propuesta: se descuenta SOLO lo que se pudo emparejar con certeza como
    // "no reflejado". Los ambiguos NO se tocan: se deciden a mano.
    const saldoPropuesto = Math.max(0, nuevo.saldo - sumaNoReflejados);

    const ultimo = (l) => (l.length ? dia(l.map((x) => x.ms).filter((x) => x !== null).sort().pop() ?? null) : '(ninguno)');

    Object.assign(fila, {
      nuevo, legacy, resumen, totales, pendientes,
      clasificados, noReflejados, ambiguos, reflejados,
      sumaNoReflejados, sumaAmbiguos, saldoPropuesto,
      ultimoPagoNuevo: ultimo(nuevo.pagos),
      ultimoPagoLegacy: ultimo(legacy.lista),
    });
  } catch (e) {
    fila.acceso = false;
    fila.error = e.message;
  }
  filas.push(fila);
}

// --- Salida ---------------------------------------------------------------
for (const f of filas) {
  console.log(`\n${'─'.repeat(110)}`);
  if (!f.acceso) {
    console.log(`${f.loc.nombre} (${f.loc.id})   *** SIN ACCESO: ${f.error} ***`);
    continue;
  }
  const { nuevo, legacy } = f;
  console.log(`${f.loc.nombre}  (${f.loc.id})`);
  console.log(`  REGISTRO          validos ${String(nuevo.nValidos).padStart(5)}  cancelados ${String(nuevo.nCancelados).padStart(4)}  sin centavos ${nuevo.sinCentavos}`);
  console.log(`  Σ comision reconocida (REGISTRO) .... ${String(nuevo.historico).padStart(12)}  = $${money(nuevo.historico)}`);
  console.log(`  Σ pagos reconocidos (COMISIONES/PAGOS) ${String(nuevo.pagado).padStart(12)}  = $${money(nuevo.pagado)}  (${nuevo.pagos.length} pagos)`);
  console.log(`  saldo segun ledger actual ........... ${String(nuevo.saldo).padStart(12)}  = $${money(nuevo.saldo)}`);
  console.log(`  ultimo COMISIONES/PAGOS ............. ${f.ultimoPagoNuevo}`);
  console.log(`  PAGOS_COMISIONES (Tablet) ........... ${legacy.existe ? `${legacy.lista.length} pagos` : '(el nodo no existe)'}`);
  console.log(`  ultimo PAGOS_COMISIONES ............. ${f.ultimoPagoLegacy}`);
  console.log(`  emparejados: reflejados ${f.reflejados.length}  NO reflejados ${f.noReflejados.length}  AMBIGUOS ${f.ambiguos.length}`);
  console.log(`  Σ NO reflejados ..................... ${String(f.sumaNoReflejados).padStart(12)}  = $${money(f.sumaNoReflejados)}`);
  console.log(`  Σ ambiguos (NO se descuentan) ....... ${String(f.sumaAmbiguos).padStart(12)}  = $${money(f.sumaAmbiguos)}`);
  console.log(`  >> saldo inicial PROPUESTO .......... ${String(f.saldoPropuesto).padStart(12)}  = $${money(f.saldoPropuesto)}`);
  console.log(`  RESUMEN_CUENTA/TOTALES (ledger viejo): totalCommission=${f.resumen?.totalCommission ?? '(ausente)'} TotalComisionAPagar=${f.resumen?.TotalComisionAPagar ?? '(ausente)'}`);
  console.log(`  COMISIONES/TOTALES actual: ${JSON.stringify(f.totales)}`);
  const pend = f.pendientes ? Object.entries(f.pendientes).filter(([, v]) => v && v.estado === 'pendiente') : [];
  console.log(`  PAGOS_PENDIENTES (preferencias MP) .. ${f.pendientes ? `${Object.keys(f.pendientes).length} total, ${pend.length} en estado pendiente` : '(el nodo no existe)'}`);

  if (DETALLE && f.clasificados.length) {
    console.log('\n    detalle de PAGOS_COMISIONES:');
    for (const c of f.clasificados) {
      console.log(`      ${String(c.key).padEnd(10)} ${dia(c.ms).padEnd(12)} $${money(c.centavos).padStart(12)}  ${c.estado}${c.con ? ` (con ${c.con})` : ''}${c.motivo ? ` — ${c.motivo}` : ''}`);
    }
  }
}

// --- Tabla resumen --------------------------------------------------------
console.log(`\n${'='.repeat(110)}`);
console.log('RESUMEN');
console.log('='.repeat(110));
console.log('local'.padEnd(12) + 'saldo actual'.padStart(16) + 'no reflej.'.padStart(14) + 'ambiguos'.padStart(14) + 'saldo propuesto'.padStart(18) + '  revisar');
for (const f of filas) {
  if (!f.acceso) { console.log(f.loc.nombre.padEnd(12) + '   *** SIN ACCESO ***'); continue; }
  const revisar = f.ambiguos.length > 0 ? `SI (${f.ambiguos.length} ambiguos)` : (f.noReflejados.length > 0 ? 'SI (hay no reflejados)' : 'no');
  console.log(
    f.loc.nombre.padEnd(12)
    + `$${money(f.nuevo.saldo)}`.padStart(16)
    + `$${money(f.sumaNoReflejados)}`.padStart(14)
    + `$${money(f.sumaAmbiguos)}`.padStart(14)
    + `$${money(f.saldoPropuesto)}`.padStart(18)
    + '  ' + revisar,
  );
}
console.log('\nNo se escribio nada. Ningun ajuste se aplico: los numeros de arriba son una PROPUESTA.');
