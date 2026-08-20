// ---------------------------------------------------------------------------
// MIGRACIÓN A LA CONTABILIDAD EN CENTAVOS — HERRAMIENTA MANUAL.
//
// Desktop, Tablet, DLV Consultas y la Cloud Function NUNCA ejecutan esto. Es un
// script que se corre a mano, con los locales cerrados y con la tabla a la vista.
//
// Uso:
//   node scripts/migrar-comisiones-centavos.mjs                 (dry-run, todos)
//   node scripts/migrar-comisiones-centavos.mjs --local 31915636
//   node scripts/migrar-comisiones-centavos.mjs --escribir      (PASO 1)
//   node scripts/migrar-comisiones-centavos.mjs --activar       (PASO 2)
//
// EL SALDO INICIAL NO SE CALCULA ACÁ: SE APRUEBA
// ----------------------------------------------
// Antes, el script decidía solo el saldo con `Σ REGISTRO − Σ PAGOS`. Esa cuenta
// ve las operaciones de Desktop, de DLV Consultas y de la Function, pero NO ve
// las de Tablet, que escribe en RESUMEN_CUENTA y PAGOS_COMISIONES. Un pago
// hecho desde Tablet no aparece, y migrar con esa cuenta dejaría al local
// debiendo algo que YA PAGÓ.
//
// Ahora el saldo sale de `scripts/migracion-saldos.json`, revisado y aprobado
// local por local. El script NO lo recalcula ni lo corrige: lo compara con lo
// que hay en la base y, si algo no cierra, ABORTA ese local.
//
// LOS TRES ACUMULADORES
// ---------------------
//     totalAcumuladoCentavos  = Σ comisiones RECONOCIDAS en COMISIONES/REGISTRO
//     saldoPendienteCentavos  = saldoInicialCentavos (el aprobado)
//     totalPagadoCentavos     = totalAcumuladoCentavos − saldoInicialCentavos
//
// `totalPagado` así derivado NO afirma ser la suma literal de todos los
// comprobantes históricos: es "lo reconocido como ya pagado o ajustado a la
// fecha de apertura". `historicoDesde` lo deja escrito en la base.
//
// EL PASADO QUEDA COMO ESTÁ
// -------------------------
// No se recorre MOSTRADOR, ni PEDIDOS, ni BACKUP. No se reconstruye ninguna
// comisión perdida, no se buscan ventas antiguas y no se genera deuda
// retroactiva. `totalAcumulado` (pesos, legado) NO se toca: lo lee
// dlvsistemas-v2. `limiteCorte` NO se toca: hoy está ausente en los siete.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const LOCALES = [
  { nombre: 'Achaval',    db: 'https://achava3703-default-rtdb.firebaseio.com',             id: '40508022' },
  { nombre: 'Temperley',  db: 'https://bdtemperley-default-rtdb.firebaseio.com',            id: '38827976' },
  { nombre: 'Centenario', db: 'https://centenario1199-default-rtdb.firebaseio.com',         id: '51501748' },
  { nombre: 'Burano',     db: 'https://buranoheladerias-default-rtdb.firebaseio.com',       id: '25230974' },
  { nombre: 'Canada',     db: 'https://lanyulinacanada-default-rtdb.firebaseio.com',        id: '34734081' },
  { nombre: 'Bynnon',     db: 'https://heladeriabynnonadrogue-default-rtdb.firebaseio.com', id: '34516605' },
  { nombre: 'IlCapo',     db: 'https://ilcapogelatojls2026-default-rtdb.firebaseio.com',    id: '31915636' },
];

// Las MISMAS reglas de useCommissionTotal.js — el estado oficial de hoy.
const REGISTRO_CANCELADO = new Set(['cancelada', 'cancelado', 'cancelled', 'canceled']);

const aCentavos = (pesos) => {
  const n = Number(pesos);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const money = (c) => (c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const args = process.argv.slice(2);
const ESCRIBIR = args.includes('--escribir');
const ACTIVAR = args.includes('--activar');
const soloLocal = args.includes('--local') ? args[args.indexOf('--local') + 1] : null;
const SECO = !ESCRIBIR && !ACTIVAR;

const APROBADOS = JSON.parse(readFileSync(new URL('./migracion-saldos.json', import.meta.url), 'utf8'));

const leer = async (base, id, ruta) => {
  const r = await fetch(`${base}/${id}/${ruta}.json`);
  if (!r.ok) throw new Error(`GET ${ruta} -> HTTP ${r.status}`);
  return r.json();
};
const escribir = async (base, id, ruta, valor) => {
  const r = await fetch(`${base}/${id}/${ruta}.json`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valor),
  });
  if (!r.ok) throw new Error(`PATCH ${ruta} -> HTTP ${r.status} ${await r.text()}`);
  return r.json();
};

/** Σ comisiones RECONOCIDAS en REGISTRO. No busca nada fuera de ahí. */
function acumuladoReconocido(registro) {
  const entries = Array.isArray(registro)
    ? registro.map((v, i) => [String(i), v])
    : Object.entries(registro || {});

  let historico = 0, nValidos = 0, nCancelados = 0;
  for (const [, r] of entries) {
    if (!r) continue;
    const estado = String(r.estado ?? '').trim().toLowerCase();
    if (REGISTRO_CANCELADO.has(estado)) { nCancelados++; continue; }
    historico += aCentavos(r.comisionGenerada);
    nValidos++;
  }
  return { historico, nValidos, nCancelados };
}

/**
 * TODAS las razones para no tocar un local. Ninguna se "arregla sola": si algo
 * no cierra, el local queda BLOQUEADO y se muestra qué se encontró.
 */
function evaluar({ aprobado, acumulado, totales }) {
  const motivos = [];

  if (!aprobado) {
    motivos.push('no hay saldo inicial aprobado para este local en migracion-saldos.json');
  } else if (aprobado.aprobado !== true) {
    motivos.push('el saldo inicial existe pero todavía no está marcado como aprobado: true');
  }

  const saldo = aprobado ? aprobado.saldoInicialCentavos : null;
  if (aprobado && !Number.isInteger(saldo)) {
    motivos.push(`saldoInicialCentavos no es un entero: ${JSON.stringify(saldo)}`);
  }
  if (Number.isInteger(saldo) && saldo < 0) motivos.push(`saldoInicialCentavos es negativo: ${saldo}`);
  if (!Number.isInteger(acumulado)) motivos.push(`el acumulado calculado no es entero: ${acumulado}`);
  if (acumulado < 0) motivos.push(`el acumulado calculado es negativo: ${acumulado}`);

  const pagado = (Number.isInteger(saldo) && Number.isInteger(acumulado)) ? acumulado - saldo : null;
  if (pagado !== null && pagado < 0) {
    motivos.push(`totalPagado derivado quedaría NEGATIVO (${pagado}): el saldo aprobado (${saldo}) `
      + `supera la comisión reconocida (${acumulado}). Revisar el saldo aprobado.`);
  }
  if (pagado !== null && Number.isInteger(saldo) && acumulado - pagado !== saldo) {
    motivos.push('la invariante acumulado − pagado = saldo no se cumple');
  }

  // Estado actual de la base: nada puede estar a medio inicializar.
  const version = totales?.migracionVersion;
  const yaTiene = version !== undefined && version !== null;
  if (yaTiene && !ACTIVAR) {
    motivos.push(`la base YA tiene migracionVersion=${version}: no se sobrescribe`);
  }
  const acumuladores = ['totalAcumuladoCentavos', 'totalPagadoCentavos', 'saldoPendienteCentavos'];
  const presentes = acumuladores.filter((k) => totales?.[k] !== undefined && totales?.[k] !== null);
  if (!yaTiene && presentes.length > 0 && presentes.length < acumuladores.length) {
    motivos.push(`TOTALES está PARCIALMENTE inicializado (${presentes.join(', ')}): no se completa a mano`);
  }
  for (const k of presentes) {
    const v = totales[k];
    if (!Number.isInteger(v)) motivos.push(`${k} existente no es entero: ${JSON.stringify(v)}`);
    else if (v < 0) motivos.push(`${k} existente es negativo: ${v}`);
  }
  if (totales?.migracionActivadaEn !== undefined && totales?.migracionActivadaEn !== null && !ACTIVAR) {
    motivos.push('ya existe migracionActivadaEn: este local pudo haberse activado antes');
  }

  return { motivos, saldo, pagado, apto: motivos.length === 0 };
}

// ---------------------------------------------------------------------------
console.log('MIGRACION A CENTAVOS — ' + (ACTIVAR ? 'PASO 2 (ACTIVAR)' : ESCRIBIR ? 'PASO 1 (ESCRIBIR, queda DORMIDO)' : 'DRY-RUN (no escribe nada)'));
console.log(`saldos aprobados: scripts/migracion-saldos.json  (diagnóstico ${APROBADOS.fechaDiagnostico})`);
console.log('='.repeat(118));

const objetivo = soloLocal ? LOCALES.filter((l) => l.id === soloLocal) : LOCALES;
if (objetivo.length === 0) { console.error(`No existe el local ${soloLocal}`); process.exit(1); }

const filas = [];
let huboProblema = false;

for (const loc of objetivo) {
  try {
    const [registro, totales, pendientes, dispositivos, limiteCorte] = await Promise.all([
      leer(loc.db, loc.id, 'COMISIONES/REGISTRO'),
      leer(loc.db, loc.id, 'COMISIONES/TOTALES'),
      leer(loc.db, loc.id, 'COMISIONES/PAGOS_PENDIENTES').catch(() => null),
      leer(loc.db, loc.id, 'DISPOSITIVOS').catch(() => null),
      leer(loc.db, loc.id, 'CONFIGURACION/limiteCorte').catch(() => null),
    ]);

    const { historico, nValidos, nCancelados } = acumuladoReconocido(registro);
    const aprobado = APROBADOS.locales?.[loc.id] || null;
    const ev = evaluar({ aprobado, acumulado: historico, totales });

    const prefsPendientes = pendientes
      ? Object.values(pendientes).filter((p) => p && String(p.estado) === 'pendiente').length
      : 0;
    const versiones = dispositivos
      ? [...new Set(Object.values(dispositivos).map((d) => d?.clientVersion || '?'))].join(', ')
      : '(sin nodo DISPOSITIVOS)';

    const fila = { loc, historico, nValidos, nCancelados, totales, ev, prefsPendientes, versiones, limiteCorte };
    filas.push(fila);

    console.log(`\n${'─'.repeat(118)}`);
    console.log(`LOCAL .......................... ${loc.nombre}  (${loc.id})`);
    console.log(`REGISTRO ....................... ${nValidos} validos, ${nCancelados} cancelados`);
    console.log(`totalAcumulado RECONOCIDO ...... ${String(historico).padStart(12)}  = $${money(historico)}`);
    console.log(`saldoInicial APROBADO .......... ${ev.saldo === null ? '(ninguno)'.padStart(12) : String(ev.saldo).padStart(12)}`
      + (ev.saldo === null ? '' : `  = $${money(ev.saldo)}`)
      + (aprobado ? `   aprobado=${aprobado.aprobado === true}` : ''));
    console.log(`totalPagado DERIVADO ........... ${ev.pagado === null ? '(n/d)'.padStart(12) : String(ev.pagado).padStart(12)}`
      + (ev.pagado === null ? '' : `  = $${money(ev.pagado)}`));
    console.log(`invariante ..................... ${ev.pagado === null ? 'n/d'
      : (historico - ev.pagado === ev.saldo ? `OK  ${historico} − ${ev.pagado} = ${ev.saldo}` : '*** NO CIERRA ***')}`);
    console.log(`migracionVersion actual ........ ${totales?.migracionVersion ?? '(ausente)'}`);
    console.log(`limiteCorte actual ............. ${JSON.stringify(limiteCorte)}   (no se toca)`);
    console.log(`preferencias legacy pendientes . ${prefsPendientes}`);
    console.log(`versiones observadas ........... ${versiones}`);
    console.log(`ESTADO ......................... ${ev.apto ? 'APTO' : '*** BLOQUEADO ***'}`);
    if (!ev.apto) {
      for (const m of ev.motivos) console.log(`   motivo: ${m}`);
      huboProblema = true;
    }
    if (aprobado?.observacion) console.log(`observacion .................... ${aprobado.observacion}`);

    // ---- Qué se escribiría (o se escribe) ----
    const aEscribir = {
      totalAcumuladoCentavos: historico,
      totalPagadoCentavos: ev.pagado,
      saldoPendienteCentavos: ev.saldo,
      saldoInicialCentavos: ev.saldo,
      migracionVersion: 0,
      migracionIniciadaEn: '(Date.now al escribir)',
      historicoDesde: 'apertura',
    };

    if (SECO) {
      console.log('\nESCRIBIRIA en COMISIONES/TOTALES:');
      console.log(ev.apto ? JSON.stringify(aEscribir, null, 2).split('\n').map((l) => `   ${l}`).join('\n')
        : '   (nada: el local está BLOQUEADO)');
      continue;
    }

    if (!ev.apto) {
      console.log('   *** NO SE ESCRIBE NADA en este local ***');
      continue;
    }

    if (ESCRIBIR) {
      // ---- PASO 1: inicializar, DORMIDO (migracionVersion 0) ----
      //
      // `historicoDesde: 'apertura'` deja escrito en la propia base que estos
      // acumuladores son el estado RECONOCIDO al abrir, no una reconstrucción
      // de toda la historia comercial del local.
      await escribir(loc.db, loc.id, 'COMISIONES/TOTALES', {
        totalAcumuladoCentavos: historico,
        totalPagadoCentavos: ev.pagado,
        saldoPendienteCentavos: ev.saldo,
        saldoInicialCentavos: ev.saldo,
        migracionIniciadaEn: Date.now(),
        migracionVersion: 0,
        historicoDesde: 'apertura',
      });

      // ---- Releer y verificar ----
      const rel = await leer(loc.db, loc.id, 'COMISIONES/TOTALES');
      const coincide = rel.totalAcumuladoCentavos === historico
        && rel.totalPagadoCentavos === ev.pagado
        && rel.saldoPendienteCentavos === ev.saldo
        && rel.saldoInicialCentavos === ev.saldo
        && rel.migracionVersion === 0
        && rel.historicoDesde === 'apertura';
      console.log(`\nPASO 1: ${coincide ? 'OK — escrito y verificado (DORMIDO, migracionVersion=0)' : '*** FALLA: lo releido NO coincide ***'}`);
      if (!coincide) huboProblema = true;
    }

    if (ACTIVAR) {
      const version = Number(totales?.migracionVersion ?? -1);
      if (version !== 0) {
        console.log(`   *** NO SE ACTIVA: migracionVersion=${totales?.migracionVersion ?? '(ausente)'}, se esperaba 0.`);
        huboProblema = true;
        continue;
      }
      // Lo guardado tiene que seguir siendo EXACTAMENTE lo aprobado.
      const desvios = [];
      if (totales.totalAcumuladoCentavos !== historico) desvios.push(`acumulado ${totales.totalAcumuladoCentavos} != ${historico}`);
      if (totales.totalPagadoCentavos !== ev.pagado) desvios.push(`pagado ${totales.totalPagadoCentavos} != ${ev.pagado}`);
      if (totales.saldoPendienteCentavos !== ev.saldo) desvios.push(`saldo ${totales.saldoPendienteCentavos} != ${ev.saldo}`);
      if (desvios.length) {
        console.log(`   *** NO SE ACTIVA: los valores guardados ya no coinciden con lo aprobado: ${desvios.join('; ')}`);
        huboProblema = true;
        continue;
      }

      // UN SOLO update: la versión y la frontera nunca pueden observarse
      // separadas. `.sv timestamp` es la marca DEL SERVIDOR.
      await escribir(loc.db, loc.id, 'COMISIONES/TOTALES', {
        migracionVersion: 1,
        migracionActivadaEn: { '.sv': 'timestamp' },
      });
      const rel = await leer(loc.db, loc.id, 'COMISIONES/TOTALES');
      const ok = rel.migracionVersion === 1 && Number(rel.migracionActivadaEn) > 0;
      console.log(`\nPASO 2: ${ok ? `OK — ACTIVA (migracionActivadaEn=${rel.migracionActivadaEn})` : '*** FALLA: no quedó activada correctamente ***'}`);
      if (!ok) huboProblema = true;
    }
  } catch (e) {
    console.log(`\n${loc.nombre} (${loc.id}): *** ERROR: ${e.message} ***`);
    huboProblema = true;
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(118)}`);
console.log('RESUMEN');
console.log('='.repeat(118));
console.log('LOCAL'.padEnd(12) + 'ACUMULADO'.padStart(14) + 'SALDO INIC.'.padStart(14) + 'PAGADO DER.'.padStart(14)
  + 'INV'.padStart(5) + 'VER'.padStart(5) + 'PREF'.padStart(6) + '  ESTADO');
for (const f of filas) {
  const inv = f.ev.pagado === null ? '—' : (f.historico - f.ev.pagado === f.ev.saldo ? 'OK' : 'NO');
  console.log(
    f.loc.nombre.padEnd(12)
    + `$${money(f.historico)}`.padStart(14)
    + (f.ev.saldo === null ? '—' : `$${money(f.ev.saldo)}`).padStart(14)
    + (f.ev.pagado === null ? '—' : `$${money(f.ev.pagado)}`).padStart(14)
    + inv.padStart(5)
    + String(f.totales?.migracionVersion ?? '—').padStart(5)
    + String(f.prefsPendientes).padStart(6)
    + '  ' + (f.ev.apto ? 'APTO' : 'BLOQUEADO'),
  );
}

if (SECO) console.log('\nDRY-RUN: no se escribió absolutamente nada.');
if (huboProblema) {
  console.log('\n*** HAY LOCALES BLOQUEADOS O PROBLEMAS: revisar arriba antes de continuar. ***');
  process.exit(1);
}
