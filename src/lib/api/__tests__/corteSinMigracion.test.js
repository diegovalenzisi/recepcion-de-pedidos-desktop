// EL PARE POR COMISIÓN IMPAGA FUNCIONA HOY, SIN MIGRACIÓN.
//
// El mecanismo de corte existía completo y cableado, pero era INERTE: el gate
// se auto-autorizaba cuando `migracionVersion` estaba ausente, que es el estado
// de TODOS los locales. Quedaba atado a una migración que todavía no ocurrió.
//
// Ahora, mientras la contabilidad nueva esté dormida, la deuda sale del ledger
// que funciona hoy:
//
//     Σ COMISIONES/REGISTRO válidos − Σ COMISIONES/PAGOS aprobados   (piso 0)
//
// que es exactamente la misma cuenta del aviso y del footer. No se tocan
// acumuladores, no se migra nada y no se usa la contabilidad nueva.
//
// Correr con: node src/lib/api/__tests__/corteSinMigracion.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  ESTADO_INICIO, ESTADO_SESION, evaluarInicioConLecturas, estadoDeSesion,
  valorLeido, valorNoVerificable, liberaTrasPago, corteActivo, avisoActivo,
} from '../comisionCorte.js';
import { contabilidadActiva } from '../comisionMovimiento.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const fuenteGate = readFileSync(new URL('../../../hooks/useGateComision.js', import.meta.url), 'utf8');
const fuenteTotal = readFileSync(new URL('../../../hooks/useCommissionTotal.js', import.meta.url), 'utf8');

/**
 * Réplica de `calcularSaldoLegadoCentavos`, para poder armar escenarios sin
 * Firebase. La función real vive en useCommissionTotal.js y hay una prueba
 * estructural más abajo que verifica que el gate use ESA y no otra.
 */
const NO_APROBADO = new Set([
  'rechazado', 'rechazada', 'rejected', 'pendiente', 'pending', 'in_process',
  'in_mediation', 'cancelado', 'cancelada', 'cancelled', 'canceled', 'refunded', 'charged_back',
]);
const CANCELADO = new Set(['cancelada', 'cancelado', 'cancelled', 'canceled']);
const saldoLegadoCentavos = (registros, pagos) => {
  let gen = 0;
  for (const r of Object.values(registros || {})) {
    if (r && !CANCELADO.has(String(r.estado ?? '').trim().toLowerCase())) gen += Number(r.comisionGenerada) || 0;
  }
  let pag = 0;
  for (const p of Object.values(pagos || {})) {
    const e = String(p?.estado ?? '').trim().toLowerCase();
    if (p && (!e || !NO_APROBADO.has(e))) pag += Number(p.montoPago) || 0;
  }
  const pend = gen - pag;
  return Math.round((pend > 0 ? pend : 0) * 100);
};

/** Un arranque completo: deuda del ledger actual + alarma + límite. */
const arrancar = ({ registros, pagos, alarmaPagoPesos = 0, limiteCortePesos = 0 }) => {
  const ev = evaluarInicioConLecturas({
    saldo: valorLeido(saldoLegadoCentavos(registros, pagos)),
    alarma: valorLeido(alarmaPagoPesos),
    limite: valorLeido(limiteCortePesos),
  });
  return { ev, estado: estadoDeSesion(ev) };
};

// Un local con $100.000 de comisión generada y $40.000 pagados → debe $60.000.
const REGISTROS = {
  M1: { estado: 'pendiente', comisionGenerada: 60000 },
  D2: { estado: 'pendiente', comisionGenerada: 40000 },
  M3: { estado: 'cancelada', comisionGenerada: 99999 },   // no suma
};
const PAGOS = {
  p1: { estado: 'aprobado', montoPago: 40000 },
  p2: { estado: 'rechazado', montoPago: 77777 },          // no descuenta
};

// ---------------------------------------------------------------------------
console.log('\n1. La deuda sale del ledger que funciona HOY:');

check('Σ REGISTRO válidos − Σ PAGOS aprobados, con piso en 0', () => {
  assert.strictEqual(saldoLegadoCentavos(REGISTROS, PAGOS), 6000000); // $60.000
  assert.strictEqual(saldoLegadoCentavos({}, {}), 0);
  assert.strictEqual(saldoLegadoCentavos({ a: { estado: 'pendiente', comisionGenerada: 10 } },
    { p: { montoPago: 999 } }), 0, 'un saldo negativo tiene que quedar en 0');
});

check('el gate ya NO se auto-autoriza con la contabilidad dormida', () => {
  assert.strictEqual(contabilidadActiva(null), false, 'ese es el estado de todos los locales hoy');
  // La rama que devolvía AUTORIZADA sin mirar la deuda ya no existe.
  assert.ok(!/if \(!contabilidadActiva\(totales\)\) \{[\s\S]{0,200}?ESTADO_SESION\.AUTORIZADA/.test(fuenteGate),
    'volvió el atajo que autorizaba sin mirar la deuda');
  assert.match(fuenteGate, /contabilidadActiva\(totales\)\s*\?[\s\S]{0,160}leerSaldoLegado/,
    'el gate no cae al ledger actual cuando la contabilidad está dormida');
});

check('la cuenta NO se reimplementa en el gate: sale de la fuente compartida', () => {
  assert.match(fuenteGate, /import \{ calcularSaldoLegadoCentavos \}/);
  assert.match(fuenteTotal, /export const calcularSaldoLegadoCentavos/);
  // Si el gate tuviera sus propias listas de estados, el aviso y el bloqueo
  // podrían mostrar deudas distintas sobre el mismo local.
  assert.ok(!/NON_APPROVED|CANCELLED_REGISTRO|'rechazado'/.test(fuenteGate),
    'el gate volvió a tener su propia tabla de estados');
});

check('el gate lee REGISTRO y PAGOS, y NO toca acumuladores ni migración', () => {
  assert.match(fuenteGate, /COMISIONES\/REGISTRO/);
  assert.match(fuenteGate, /COMISIONES\/PAGOS/);
  assert.ok(!/migracionVersion\s*[:=]/.test(fuenteGate), 'el gate escribe migracionVersion');
  assert.ok(!/increment|update\(|set\(/.test(fuenteGate), 'el gate escribe en Firebase');
});

// ---------------------------------------------------------------------------
console.log('\n2. Los siete casos pedidos:');

check('1) limiteCorte desactivado (ausente, 0 o basura) → NUNCA bloquea', () => {
  for (const limite of [0, null, undefined, -5, 'x']) {
    const { estado } = arrancar({ registros: REGISTROS, pagos: PAGOS, limiteCortePesos: limite });
    assert.strictEqual(estado, ESTADO_SESION.AUTORIZADA, `bloqueó con limiteCorte=${limite}`);
    assert.strictEqual(corteActivo(limite), false);
  }
});

check('2) deuda MENOR al límite → AUTORIZADA', () => {
  const { ev, estado } = arrancar({ registros: REGISTROS, pagos: PAGOS, limiteCortePesos: 60001 });
  assert.strictEqual(estado, ESTADO_SESION.AUTORIZADA);
  assert.notStrictEqual(ev.estado, ESTADO_INICIO.BLOQUEADO);
});

check('3) deuda IGUAL al límite → BLOQUEADA', () => {
  const { ev, estado } = arrancar({ registros: REGISTROS, pagos: PAGOS, limiteCortePesos: 60000 });
  assert.strictEqual(estado, ESTADO_SESION.BLOQUEADA, 'el límite se alcanza, no se supera');
  assert.strictEqual(ev.estado, ESTADO_INICIO.BLOQUEADO);
});

check('4) deuda SUPERIOR al límite → BLOQUEADA', () => {
  const { estado } = arrancar({ registros: REGISTROS, pagos: PAGOS, limiteCortePesos: 50000 });
  assert.strictEqual(estado, ESTADO_SESION.BLOQUEADA);
});

check('5) un pago que deja la deuda por debajo del límite → LIBERA', () => {
  // Se paga $15.000: la deuda pasa de $60.000 a $45.000, con límite $50.000.
  const pagosDespues = { ...PAGOS, p3: { estado: 'aprobado', montoPago: 15000 } };
  const saldoDespues = saldoLegadoCentavos(REGISTROS, pagosDespues);
  assert.strictEqual(saldoDespues, 4500000);
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: saldoDespues, limiteCortePesos: 50000 }), true);
  // Y un pago que NO alcanza no libera.
  assert.strictEqual(liberaTrasPago({ saldoCentavosDespues: 5000000, limiteCortePesos: 50000 }), false);
});

check('6) un error de lectura NO se convierte en autorización', () => {
  const ev = evaluarInicioConLecturas({
    saldo: valorNoVerificable('timeout'),
    alarma: valorLeido(0),
    limite: valorLeido(50000),
  });
  assert.strictEqual(estadoDeSesion(ev), ESTADO_SESION.ERROR);
  assert.notStrictEqual(estadoDeSesion(ev), ESTADO_SESION.AUTORIZADA);

  // Tampoco si lo que falla es el propio límite: no se asume "desactivado".
  const ev2 = evaluarInicioConLecturas({
    saldo: valorLeido(6000000), alarma: valorLeido(0), limite: valorNoVerificable('HTTP 500'),
  });
  assert.strictEqual(estadoDeSesion(ev2), ESTADO_SESION.ERROR);

  // Y el gate marca la lectura como no verificable en vez de poner 0.
  assert.match(fuenteGate, /valorNoVerificable\(e\?\.message/);
});

check('7) el aviso por alarmaPago sigue funcionando, independiente del corte', () => {
  // Con aviso configurado y corte apagado: autoriza, pero avisa.
  const { ev, estado } = arrancar({
    registros: REGISTROS, pagos: PAGOS, alarmaPagoPesos: 50000, limiteCortePesos: 0,
  });
  assert.strictEqual(estado, ESTADO_SESION.AUTORIZADA, 'el aviso no puede bloquear');
  assert.strictEqual(ev.estado, ESTADO_INICIO.AVISO);
  assert.strictEqual(avisoActivo(50000), true);

  // Por debajo del aviso: ni aviso ni bloqueo.
  const b = arrancar({ registros: REGISTROS, pagos: PAGOS, alarmaPagoPesos: 70000, limiteCortePesos: 0 });
  assert.strictEqual(b.ev.estado, ESTADO_INICIO.NORMAL);
});

// ---------------------------------------------------------------------------
console.log('\n3. Todo esto ocurre SIN migracionVersion:');

check('el escenario completo funciona con la contabilidad dormida', () => {
  // Es el estado real de los 8 locales: COMISIONES/TOTALES sin migracionVersion.
  const totales = { totalAcumulado: 67530 };
  assert.strictEqual(contabilidadActiva(totales), false);

  const { estado } = arrancar({ registros: REGISTROS, pagos: PAGOS, limiteCortePesos: 50000 });
  assert.strictEqual(estado, ESTADO_SESION.BLOQUEADA,
    'con la contabilidad dormida el corte tiene que poder bloquear igual');
});

// ---------------------------------------------------------------------------
// CONFIGURACIÓN DEL LÍMITE — solapa Administrador (DiegoL).
//
// El límite se carga desde SalesPercentageManager, que vive dentro de
// AdminSettings.jsx (la solapa "Administrador"), a la que SettingsPage.jsx
// solo ofrece acceso si el usuario es DiegoL (ADMIN_USERNAME), y que además
// exige re-confirmar la clave de administrador (verifyAdminPassword) antes de
// mostrar cualquier contenido. Es el mismo alcance que ya tienen el
// porcentaje de comisión y el registro de pagos: quien puede cambiar cuánto
// se cobra también puede fijar el corte.
// ---------------------------------------------------------------------------
const settingsSrc = readFileSync(new URL('../settingsApi.js', import.meta.url), 'utf8');
const formSrc = readFileSync(new URL('../../../components/settings/local/admin/SalesPercentageManager.jsx', import.meta.url), 'utf8');
const settingsPageSrc = readFileSync(new URL('../../../pages/SettingsPage.jsx', import.meta.url), 'utf8');
const adminSettingsSrc = readFileSync(new URL('../../../components/settings/AdminSettings.jsx', import.meta.url), 'utf8');

check('1) DiegoL puede guardar el límite: existe el escritor y el formulario lo llama', () => {
  assert.match(settingsSrc, /export const saveLimiteCorte = async/, 'no existe el escritor');
  assert.match(formSrc, /saveLimiteCorte/, 'el formulario no graba el límite');
  assert.match(formSrc, /handleSaveLimite/, 'no hay handler de guardado');
  assert.match(formSrc, /Límite de corte por comisión/, 'el campo no se ve en pantalla');
});

check('2) se guarda en la RUTA CANÓNICA, la misma que lee el corte', () => {
  const rutas = settingsSrc.match(/CONFIGURACION\/limiteCorte\.json/g) || [];
  assert.strictEqual(rutas.length, 2, 'la lectura y la escritura no usan la misma ruta');
  assert.ok(!/limiteDeCorte|corteComision|CONFIGURACION\/corte/.test(settingsSrc), 'apareció una ruta nueva');
  const i = settingsSrc.indexOf('export const saveLimiteCorte');
  const cuerpo = settingsSrc.slice(i, i + 700);
  assert.match(cuerpo, /CONFIGURACION\/limiteCorte\.json/);
  assert.match(cuerpo, /method: 'PUT'/);
});

check('3) se guarda en PESOS, sin convertir a centavos', () => {
  const i = settingsSrc.indexOf('export const saveLimiteCorte');
  const cuerpo = settingsSrc.slice(i, i + 700);
  assert.match(cuerpo, /JSON\.stringify\(Number\(amount\) \|\| 0\)/, 'no guarda el número tal cual');
  assert.ok(!/aCentavos|\* 100/.test(cuerpo), 'está convirtiendo a centavos');
  assert.match(settingsSrc, /export const fetchLimiteCorte = async/);
});

check('4) al reabrir Configuración se relee el valor guardado', () => {
  assert.match(formSrc, /fetchLimiteCorte\(\)/, 'el formulario no relee el límite');
  assert.match(formSrc, /setLimiteCorte\(corte\.ok \? String\(corte\.pesos\) : '0'\)/, 'no precarga el valor leído');
  assert.match(settingsSrc, /COMMISSION_KEYS = new Set\(\[[^\]]*'limiteCorte'/,
    'el "Guardar" general puede revertir el límite');
});

check('el campo vive donde SOLO entra DiegoL', () => {
  assert.match(adminSettingsSrc, /<SalesPercentageManager/, 'el formulario salió de Administrador');
  assert.match(settingsPageSrc, /esDiegoL = user && user\.usuario === ADMIN_USERNAME/, 'la solapa Administrador perdió su candado por identidad');
  const iCandado = settingsPageSrc.indexOf('esDiegoL = user && user.usuario === ADMIN_USERNAME');
  const iTab = settingsPageSrc.indexOf('label="Administrador"');
  assert.ok(iCandado > 0 && iTab > iCandado, 'la solapa Administrador quedó fuera del candado de identidad');
  assert.match(adminSettingsSrc, /verifyAdminPassword/, 'Administrador perdió la re-confirmación de clave');
});

check('8) la pantalla de bloqueo NO tiene ningún mecanismo de pago', () => {
  const pantalla = readFileSync(new URL('../../../components/CommissionBlockScreen.jsx', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../../../hooks/useGateComision.js', import.meta.url), 'utf8');
  assert.ok(!/^import CommissionPaymentManager|<CommissionPaymentManager/m.test(pantalla), 'volvió el formulario de pago');
  assert.ok(!/processCommissionPayment|registrarPagoComision/.test(pantalla), 'la pantalla puede registrar un pago');
  assert.ok(!/<Input|<input/.test(pantalla), 'la pantalla tiene un campo de entrada');
  assert.ok(!/Ya pagu|ya pagu/.test(pantalla), 'volvió el "Ya pagué"');
  assert.ok(!/const reevaluarTrasPago/.test(gate), 'volvió el desbloqueo local');
  assert.ok(!/setInterval|setTimeout|onValue/.test(gate), 'apareció polling o un listener');
  // Muestra el saldo total adeudado, no la diferencia contra el límite.
  assert.match(pantalla, /t\.importe/);
  assert.ok(!/faltaPagarCentavos/.test(pantalla), 'muestra el mínimo para zafar, no la deuda');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
