// ---------------------------------------------------------------------------
// MIGRACIÓN A LA CONTABILIDAD EN CENTAVOS — HERRAMIENTA MANUAL.
//
// Desktop y Tablet NUNCA ejecutan esto. Es un script que se corre a mano, una
// sola vez por local, con los locales cerrados y con la tabla a la vista.
//
// Uso:
//   node scripts/migrar-comisiones-centavos.mjs                 (seco, todos)
//   node scripts/migrar-comisiones-centavos.mjs --local 31915636
//   node scripts/migrar-comisiones-centavos.mjs --escribir      (PASO A)
//   node scripts/migrar-comisiones-centavos.mjs --activar       (PASO C)
//
// TRES PASOS, SIN AMBIGÜEDAD
// --------------------------
//   PASO A  --escribir   inicializa los tres acumuladores + migracionVersion: 0
//                        (0 = inicializada pero el sistema nuevo sigue DORMIDO)
//   PASO B               relee y verifica contra lo calculado
//   PASO C  --activar    migracionVersion: 1  (verificada y ACTIVA)
//
// Si la verificación del paso B falla, migracionVersion queda en 0: los valores
// existen pero NADIE los usa y nada se corrompe.
//
// EL PASADO QUEDA COMO ESTÁ
// -------------------------
// El punto de partida es lo que el sistema reconoce oficialmente HOY:
// COMISIONES/REGISTRO y COMISIONES/PAGOS, con las MISMAS reglas que usa
// useCommissionBalance. No se reconstruye ninguna comisión perdida, no se
// buscan ventas antiguas y no se genera deuda retroactiva.
//
// `totalAcumulado` (pesos, legado) NO se toca: lo lee dlvsistemas-v2.
// `limiteCorte` se deja en 0 en todos los locales: nadie queda bloqueado.
// ---------------------------------------------------------------------------

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
const PAGO_NO_APROBADO = new Set([
  'rechazado', 'rechazada', 'rejected', 'pendiente', 'pending', 'in_process',
  'in_mediation', 'cancelado', 'cancelada', 'cancelled', 'canceled', 'refunded', 'charged_back',
]);
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

/** Calcula los tres acumuladores desde el estado oficial de hoy. */
function calcular(registro, pagos) {
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

  let pagado = 0, nPagos = 0;
  for (const p of Object.values(pagos || {})) {
    if (!p) continue;
    const estado = String(p.estado ?? '').trim().toLowerCase();
    if (estado && PAGO_NO_APROBADO.has(estado)) continue;
    pagado += aCentavos(p.montoPago);
    nPagos++;
  }

  // El saldo NUNCA es negativo: es la misma regla que ya aplica la pantalla.
  const saldo = Math.max(0, historico - pagado);
  return { historico, pagado, saldo, nValidos, nCancelados, nPagos };
}

console.log('MIGRACION A CENTAVOS — ' + (ACTIVAR ? 'PASO C (ACTIVAR)' : ESCRIBIR ? 'PASO A+B (ESCRIBIR Y VERIFICAR)' : 'SECO (no escribe nada)'));
console.log('='.repeat(100));

const objetivo = soloLocal ? LOCALES.filter((l) => l.id === soloLocal) : LOCALES;
if (objetivo.length === 0) { console.error(`No existe el local ${soloLocal}`); process.exit(1); }

const filas = [];
let huboProblema = false;

for (const loc of objetivo) {
  try {
    const [registro, pagos, totales] = await Promise.all([
      leer(loc.db, loc.id, 'COMISIONES/REGISTRO'),
      leer(loc.db, loc.id, 'COMISIONES/PAGOS'),
      leer(loc.db, loc.id, 'COMISIONES/TOTALES'),
    ]);
    const c = calcular(registro, pagos);
    const versionActual = Number(totales?.migracionVersion ?? -1);
    const yaInicializado = versionActual >= 0;
    const yaActivo = versionActual >= 1;

    filas.push({ loc, c, totales, versionActual, yaInicializado, yaActivo });

    console.log(`\n${loc.nombre}  (${loc.id})`);
    console.log(`  registros validos ${String(c.nValidos).padStart(5)}   cancelados ${String(c.nCancelados).padStart(4)}   pagos ${c.nPagos}`);
    console.log(`  totalAcumuladoCentavos   ${String(c.historico).padStart(12)}   = $${money(c.historico)}`);
    console.log(`  totalPagadoCentavos      ${String(c.pagado).padStart(12)}   = $${money(c.pagado)}`);
    console.log(`  saldoPendienteCentavos   ${String(c.saldo).padStart(12)}   = $${money(c.saldo)}`);
    console.log(`  totalAcumulado LEGADO (pesos, no se toca): ${totales?.totalAcumulado ?? '(ausente)'}`);
    console.log(`  migracionVersion actual: ${yaInicializado ? versionActual : '(ausente)'}`);

    // FAIL-SAFE: no se sobrescribe una inicializacion previa sin mostrarla.
    if (ESCRIBIR && yaInicializado) {
      console.log(`  *** NO SE ESCRIBE: este local YA tiene migracionVersion=${versionActual}.`);
      console.log('      Si la verificacion habia fallado, revisar los valores de arriba y decidir a mano.');
      huboProblema = true;
      continue;
    }

    if (ESCRIBIR) {
      // ---- PASO A: inicializar, DORMIDO (migracionVersion 0) ----
      await escribir(loc.db, loc.id, 'COMISIONES/TOTALES', {
        totalAcumuladoCentavos: c.historico,
        totalPagadoCentavos: c.pagado,
        saldoPendienteCentavos: c.saldo,
        migracionIniciadaEn: Date.now(),
        migracionVersion: 0,
      });
      // limiteCorte en 0 = corte desactivado: nadie queda bloqueado al actualizar.
      await escribir(loc.db, loc.id, 'CONFIGURACION', { limiteCorte: 0 });

      // ---- PASO B: releer y verificar ----
      const rel = await leer(loc.db, loc.id, 'COMISIONES/TOTALES');
      const coincide = rel.totalAcumuladoCentavos === c.historico
        && rel.totalPagadoCentavos === c.pagado
        && rel.saldoPendienteCentavos === c.saldo
        && rel.migracionVersion === 0;
      console.log(`  PASO A+B: ${coincide ? 'OK — valores escritos y verificados (DORMIDO, migracionVersion=0)' : '*** FALLA: lo releido NO coincide, queda en 0 ***'}`);
      if (!coincide) huboProblema = true;
    }

    if (ACTIVAR) {
      if (versionActual !== 0) {
        console.log(`  *** NO SE ACTIVA: migracionVersion=${yaInicializado ? versionActual : '(ausente)'}, se esperaba 0.`);
        huboProblema = true;
        continue;
      }
      const a = leerNum(totales, 'totalAcumuladoCentavos');
      const p = leerNum(totales, 'totalPagadoCentavos');
      const s = leerNum(totales, 'saldoPendienteCentavos');
      if (a !== c.historico || p !== c.pagado || s !== c.saldo) {
        console.log('  *** NO SE ACTIVA: los valores guardados ya no coinciden con lo calculado.');
        console.log(`      guardado  hist=${a} pag=${p} saldo=${s}`);
        console.log(`      calculado hist=${c.historico} pag=${c.pagado} saldo=${c.saldo}`);
        huboProblema = true;
        continue;
      }
      // LA FRONTERA CONTABLE.
      //
      // `migracionActivadaEn` se escribe en el MISMO momento que
      // migracionVersion: 1, con el timestamp DEL SERVIDOR ({".sv":"timestamp"}
      // es la forma REST de serverTimestamp()). Todo lo anterior a esa marca es
      // legado; todo lo posterior es del sistema nuevo.
      //
      // No puede ser la forma de la clave: las claves M{id}/D{id} existen desde
      // el hotfix de identidad, publicado ANTES de activar, así que hay
      // registros M/D que son legado. Y no puede ser `fecha`+`hora`, que son
      // strings del reloj del cliente.
      await escribir(loc.db, loc.id, 'COMISIONES/TOTALES', {
        migracionVersion: 1,
        migracionVerificadaEn: { '.sv': 'timestamp' },
        migracionActivadaEn: { '.sv': 'timestamp' },
      });
      const fin = await leer(loc.db, loc.id, 'COMISIONES/TOTALES');
      const okActivo = fin.migracionVersion === 1 && Number(fin.migracionActivadaEn) > 0;
      console.log(`  PASO C: ${okActivo ? `ACTIVADO — frontera contable: ${new Date(fin.migracionActivadaEn).toISOString()}` : '*** FALLA al activar ***'}`);
      if (!okActivo) huboProblema = true;
    }
  } catch (e) {
    console.error(`\n${loc.nombre}: ERROR — ${e.message}`);
    huboProblema = true;
  }
}

function leerNum(o, k) { const n = Number(o?.[k]); return Number.isFinite(n) ? n : null; }

console.log('\n' + '='.repeat(100));
console.log('RESUMEN'.padEnd(14) + 'HISTORICO'.padStart(16) + 'PAGADO'.padStart(16) + 'SALDO'.padStart(16) + '   LEGADO (pesos)');
for (const f of filas) {
  console.log(
    f.loc.nombre.padEnd(14)
    + `$${money(f.c.historico)}`.padStart(16)
    + `$${money(f.c.pagado)}`.padStart(16)
    + `$${money(f.c.saldo)}`.padStart(16)
    + `   ${f.totales?.totalAcumulado ?? '-'}`,
  );
}

if (!ESCRIBIR && !ACTIVAR) {
  console.log('\nCorrida en SECO: no se escribio nada.');
  console.log('  --escribir  ejecuta el PASO A+B (deja migracionVersion=0, sistema DORMIDO)');
  console.log('  --activar   ejecuta el PASO C  (migracionVersion=1, contabilidad nueva ACTIVA)');
}
if (huboProblema) { console.log('\nHUBO PROBLEMAS: revisar arriba antes de continuar.'); process.exit(1); }
