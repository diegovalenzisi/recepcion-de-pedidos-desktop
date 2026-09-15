// RETIRO DE EFECTIVO — pruebas de la lógica pura (selección de tiradas, rango
// de fechas, gate por rol) y de la integridad de la implementación (que NO
// toca Caja Fuerte/gastos/ventas, que el punto de inicio se escribe una sola
// vez, que el nombre comercial ya no cae siempre en "LANYULINA").
//
// Correr con: node src/lib/api/__tests__/retiroEfectivo.test.js
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  fechasACubrir, seleccionarTiradasPendientes, claveDeTirada, conTurnoAbiertoIncluido,
} from '../cash/retiroEfectivoLogica.js';
import {
  normalizarRol, esRolAutorizadoRetiroEfectivo, ROLES_AUTORIZADOS_RETIRO_EFECTIVO,
} from '../../roleUtils.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const fuenteRetiro = readFileSync(new URL('../cash/retiroEfectivo.js', import.meta.url), 'utf8');
const fuenteSafe = readFileSync(new URL('../cash/safe.js', import.meta.url), 'utf8');
const fuenteHeader = readFileSync(new URL('../../../components/cash/CashRegisterHeader.jsx', import.meta.url), 'utf8');
const fuenteModal = readFileSync(new URL('../../../components/cash/RetiroEfectivoModal.jsx', import.meta.url), 'utf8');
const fuenteApp = readFileSync(new URL('../../../App.jsx', import.meta.url), 'utf8');
const fuenteBusinessName = readFileSync(new URL('../../businessNameUtils.js', import.meta.url), 'utf8');
const fuenteSettingsApi = readFileSync(new URL('../settingsApi.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
console.log('\n1. Gate por ROL (Dueño/Encargado) — puntos 1 y 26 (casos 1-4):');

check('Dueño y Encargado están autorizados', () => {
  assert.strictEqual(esRolAutorizadoRetiroEfectivo('dueño'), true);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo('encargado'), true);
});

check('Cajero/empleado/roles desconocidos NO están autorizados', () => {
  assert.strictEqual(esRolAutorizadoRetiroEfectivo('cajero'), false);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo('empleado'), false);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo(''), false);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo(null), false);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo(undefined), false);
});

check('normaliza tildes/mayúsculas/espacios — "DUEÑO", "Encargado ", "dueno" sin tilde', () => {
  assert.strictEqual(normalizarRol('DUEÑO'), 'dueno', 'normalizarRol le quita el acento, no lo conserva');
  assert.strictEqual(esRolAutorizadoRetiroEfectivo('DUEÑO'), true);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo(' Encargado '), true);
  assert.strictEqual(esRolAutorizadoRetiroEfectivo('dueno'), true, 'sin tilde tiene que seguir reconociéndose como dueño');
});

check('la lista de roles autorizados es exactamente Dueño y Encargado, nada más', () => {
  // Sin tilde: se comparan contra normalizarRol(), que le quita los acentos.
  assert.deepStrictEqual([...ROLES_AUTORIZADOS_RETIRO_EFECTIVO].sort(), ['dueno', 'encargado']);
});

check('la función que EJECUTA el retiro vuelve a validar el rol (no solo el botón)', () => {
  assert.match(fuenteRetiro, /esRolAutorizadoRetiroEfectivo\(rolReal \?\? user\?\.rol\)/,
    'confirmarRetiroEfectivo no revalida el rol antes de escribir');
  const i = fuenteRetiro.indexOf('export const confirmarRetiroEfectivo');
  assert.ok(i > 0, 'no existe confirmarRetiroEfectivo');
  const cuerpo = fuenteRetiro.slice(i, i + 400);
  assert.match(cuerpo, /throw new Error/, 'no rechaza cuando el rol no está autorizado');
});

check('el botón en pantalla se oculta por rol, no por el permiso granular "cajas"', () => {
  assert.match(fuenteHeader, /canRetiroEfectivo && \(/, 'el botón no está gateado');
  assert.ok(!/canRetiroEfectivo.*userPermissions\.cajas/.test(fuenteHeader), 'quedó atado al permiso granular');
});

// ---------------------------------------------------------------------------
console.log('\n2. PUNTO DE INICIO — se crea una sola vez (puntos 5, 6, 7, 26 casos 5-8):');

check('se escribe con una transacción que aborta si ya existe (no lo pisa)', () => {
  const i = fuenteRetiro.indexOf('export const ensureRetiroEfectivoHabilitadoDesde');
  assert.ok(i > 0);
  const cuerpo = fuenteRetiro.slice(i, i + 600);
  assert.match(cuerpo, /runTransaction/, 'no usa una transacción atómica');
  assert.match(cuerpo, /if \(actual\) return;/, 'no aborta cuando ya existe un valor');
  assert.ok(!/if \(actual\) return null/.test(cuerpo), 'devolver null en la transacción BORRARÍA el valor existente');
});

check('se llama UNA VEZ en el arranque de la app, no de forma perezosa al abrir Caja/Retiro', () => {
  assert.match(fuenteApp, /ensureRetiroEfectivoHabilitadoDesde\(\)/, 'App.jsx no la invoca en el arranque');
  assert.ok(!/ensureRetiroEfectivoHabilitadoDesde/.test(fuenteModal),
    'el modal la sigue llamando: una tirada podría crearse antes de que el corte exista');
});

check('el "Guardar" general de Configuración no puede pisarlo', () => {
  assert.match(fuenteSettingsApi, /SYSTEM_KEYS = new Set\(\['retiroEfectivoHabilitadoDesde'\]\)/);
  assert.match(fuenteSettingsApi, /if \(SYSTEM_KEYS\.has\(key\)\) continue;/);
});

check('guarda timestamp real (ISO), no una fecha arbitraria como 00:00 o "hoy"', () => {
  const i = fuenteRetiro.indexOf('export const ensureRetiroEfectivoHabilitadoDesde');
  const cuerpo = fuenteRetiro.slice(i, i + 400);
  assert.match(cuerpo, /new Date\(\)\.toISOString\(\)/);
});

// ---------------------------------------------------------------------------
console.log('\n3. RANGO DE FECHAS A CUBRIR (fechasACubrir):');

check('cubre desde el día de "desde" (con -1 día de tolerancia) hasta el día de "hasta"', () => {
  const fechas = fechasACubrir('2026-09-15T10:30:00.000Z', '2026-09-15T20:00:00.000Z');
  // 14, 15 (tolerancia -1 día + el propio día)
  assert.strictEqual(fechas.length, 2);
});

check('abarca varios días si el rango cruza fechas', () => {
  const fechas = fechasACubrir('2026-09-15T10:30:00.000Z', '2026-09-18T20:00:00.000Z');
  assert.strictEqual(fechas.length, 5); // 14,15,16,17,18
});

check('fechas inválidas no rompen: devuelve vacío', () => {
  assert.deepStrictEqual(fechasACubrir('no-es-fecha', 'tampoco'), []);
});

// ---------------------------------------------------------------------------
console.log('\n4. SELECCIÓN DE TIRADAS PENDIENTES (seleccionarTiradasPendientes) — puntos 4, 8-14, 21, 22, 26:');

const HABILITADO = '2026-09-15T10:30:42.000Z';

const turnoHistorico = { // ANTERIOR a la habilitación — tiradas legado, sin timestamp
  id: 49, date: '15-09-2026',
  CAJAFUERTE: {
    1: { valor: 5000, responsable: 'X', fecha: '14-09-2026', hora: '18:00:00' }, // sin timestamp
  },
};

const turno134 = {
  id: 134, date: '15-09-2026',
  CAJAFUERTE: {
    1: { valor: 20000, responsable: 'Diego L.', fecha: '15-09-2026', hora: '11:00:00', timestamp: '2026-09-15T11:00:00.000Z' },
    2: { valor: 30000, responsable: 'Diego L.', fecha: '15-09-2026', hora: '13:30:00', timestamp: '2026-09-15T13:30:00.000Z' },
  },
};

const turno135 = {
  id: 135, date: '15-09-2026',
  CAJAFUERTE: {
    1: { valor: 10000, responsable: 'Juan Pérez', fecha: '15-09-2026', hora: '16:00:00', timestamp: '2026-09-15T16:00:00.000Z' },
  },
};

check('el PRIMER retiro NUNCA incluye tiradas anteriores a la habilitación (sin timestamp)', () => {
  const { candidatas, cantidad } = seleccionarTiradasPendientes(
    [turnoHistorico, turno134, turno135],
    { desdeISO: HABILITADO, hastaISO: '2026-09-15T17:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 3, 'tiene que ignorar la tirada histórica sin timestamp');
  assert.ok(!candidatas.some((c) => c.turnoId === 49), 'se coló una tirada anterior a la habilitación');
});

check('el PRIMER retiro incluye exactamente #50/#51/#52 → total $60.000 (ejemplo del punto 21)', () => {
  const { candidatas, total, cantidad } = seleccionarTiradasPendientes(
    [turno134, turno135],
    { desdeISO: HABILITADO, hastaISO: '2026-09-15T17:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 3);
  assert.strictEqual(total, 60000);
  assert.deepStrictEqual(candidatas.map((c) => c.turnoId), [134, 134, 135], 'puede abarcar varios turnos (punto 12)');
});

check('las tiradas quedan ordenadas de la más antigua a la más nueva (punto 11)', () => {
  const { candidatas } = seleccionarTiradasPendientes(
    [turno135, turno134], // pasadas en orden inverso a propósito
    { desdeISO: HABILITADO, hastaISO: '2026-09-15T17:00:00.000Z', yaClaimadas: new Set() },
  );
  const horas = candidatas.map((c) => c.hora);
  assert.deepStrictEqual(horas, ['11:00:00', '13:30:00', '16:00:00']);
});

check('el SEGUNDO retiro solo incluye tiradas posteriores al primero, nunca #50/#51/#52 de nuevo', () => {
  const turno136 = {
    id: 136, date: '15-09-2026',
    CAJAFUERTE: {
      1: { valor: 15000, responsable: 'X', fecha: '15-09-2026', hora: '18:30:00', timestamp: '2026-09-15T18:30:00.000Z' },
      2: { valor: 20000, responsable: 'X', fecha: '15-09-2026', hora: '20:00:00', timestamp: '2026-09-15T20:00:00.000Z' },
    },
  };
  // desde = hastaTimestamp del primer retiro (17:00), NO el de habilitación.
  const { candidatas, total, cantidad } = seleccionarTiradasPendientes(
    [turno134, turno135, turno136],
    { desdeISO: '2026-09-15T17:00:00.000Z', hastaISO: '2026-09-15T21:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 2, 'no tiene que reaparecer #50/#51/#52');
  assert.strictEqual(total, 35000);
  assert.ok(!candidatas.some((c) => c.turnoId === 134 || c.turnoId === 135));
});

check('el límite "desde" es EXCLUSIVO: la tirada exacta del corte anterior no se repite', () => {
  const turnoBorde = {
    id: 200, date: '15-09-2026',
    CAJAFUERTE: { 1: { valor: 999, fecha: '15-09-2026', hora: '17:00:00', timestamp: '2026-09-15T17:00:00.000Z' } },
  };
  const { cantidad } = seleccionarTiradasPendientes(
    [turnoBorde],
    { desdeISO: '2026-09-15T17:00:00.000Z', hastaISO: '2026-09-15T18:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 0);
});

check('el límite "hasta" es INCLUSIVO', () => {
  const turnoBorde = {
    id: 201, date: '15-09-2026',
    CAJAFUERTE: { 1: { valor: 999, fecha: '15-09-2026', hora: '18:00:00', timestamp: '2026-09-15T18:00:00.000Z' } },
  };
  const { cantidad } = seleccionarTiradasPendientes(
    [turnoBorde],
    { desdeISO: '2026-09-15T17:00:00.000Z', hastaISO: '2026-09-15T18:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 1);
});

check('una tirada ya reclamada por otro retiro (yaClaimadas) nunca vuelve a aparecer — punto 10', () => {
  const key = claveDeTirada(134, '1');
  const { candidatas, cantidad } = seleccionarTiradasPendientes(
    [turno134],
    { desdeISO: HABILITADO, hastaISO: '2026-09-15T17:00:00.000Z', yaClaimadas: new Set([key]) },
  );
  assert.strictEqual(cantidad, 1, 'solo debería quedar la otra tirada del turno');
  assert.ok(!candidatas.some((c) => c.key === key));
});

check('sin tiradas pendientes: cantidad 0 y total 0, no arma nada — punto 22', () => {
  const { cantidad, total, candidatas } = seleccionarTiradasPendientes(
    [], { desdeISO: HABILITADO, hastaISO: '2026-09-15T17:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 0);
  assert.strictEqual(total, 0);
  assert.deepStrictEqual(candidatas, []);
});

check('entradas null (huecos de Firebase) no rompen la selección', () => {
  const turnoConHueco = { id: 300, date: '15-09-2026', CAJAFUERTE: { 1: null, 2: turno134.CAJAFUERTE[1] } };
  const { cantidad } = seleccionarTiradasPendientes(
    [turnoConHueco], { desdeISO: HABILITADO, hastaISO: '2026-09-15T17:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 1);
});

check('claveDeTirada es única por turno+entrada (el id de CAJAFUERTE solo es único DENTRO del turno)', () => {
  assert.strictEqual(claveDeTirada(134, '1'), '134_1');
  assert.notStrictEqual(claveDeTirada(134, '1'), claveDeTirada(135, '1'));
});

check('cada tirada nueva guarda su propio timestamp ISO (campo aditivo, no toca valor/responsable)', () => {
  const i = fuenteSafe.indexOf('const dataToSave');
  assert.ok(i > 0);
  const cuerpo = fuenteSafe.slice(i, i + 700);
  assert.match(cuerpo, /timestamp: now\.toISOString\(\)/, 'saveToSafe ya no guarda timestamp en cada tirada');
  assert.match(cuerpo, /\.\.\.safeData/, 'el campo se agrega SIN dejar de guardar valor/responsable como siempre');
});

// ---------------------------------------------------------------------------
console.log('\n5. calcularRetiroPendiente usa el ÚLTIMO RETIRO como cursor, no siempre la habilitación (punto 9):');

check('el orquestador usa hastaTimestamp del último retiro si existe, si no la habilitación', () => {
  assert.match(fuenteRetiro, /ultimoRetiro\?\.hastaTimestamp \|\| habilitadoDesde/);
});

// ---------------------------------------------------------------------------
console.log('\n6. RETIRO NO ES UN MOVIMIENTO FINANCIERO — no toca Caja Fuerte/gastos/ventas (puntos 14, 15, 25, 26 casos 22-28):');

check('retiroEfectivo.js nunca escribe en CAJAFUERTE, gastos, MOSTRADOR ni PEDIDOS', () => {
  const escrituras = fuenteRetiro.match(/updates\[`[^`]+`\]/g) || [];
  assert.ok(escrituras.length >= 2, 'no se encontraron las escrituras esperadas');
  for (const linea of escrituras) {
    assert.ok(!/CAJAFUERTE|gastos|MOSTRADOR|PEDIDOS/.test(linea), `una escritura toca datos financieros: ${linea}`);
  }
  assert.ok(!/set\(ref\([^,]+,\s*`[^`]*CAJAFUERTE/.test(fuenteRetiro), 'hay un set() directo a CAJAFUERTE');
});

check('el módulo documenta explícitamente que es auditoría, no contabilidad', () => {
  assert.match(fuenteRetiro, /NO un movimiento contable/i);
});

check('el ticket de retiro NO muestra saldo de Caja Fuerte antes/después (punto 18)', () => {
  const fuenteTicket = readFileSync(new URL('../../print/retiroTicket.js', import.meta.url), 'utf8');
  // Se revisa solo el HTML que se imprime (el template `content`), no los
  // comentarios del archivo que SÍ mencionan "Caja Fuerte" al explicar la regla.
  const iContent = fuenteTicket.indexOf('const content = `');
  assert.ok(iContent > 0, 'no se encontró el template del ticket');
  const html = fuenteTicket.slice(iContent);
  assert.ok(!/[Cc]aja [Ff]uerte (antes|despu[eé]s)/i.test(html));
  assert.ok(!/[Ss]aldo (anterior|posterior)/i.test(html));
});

// ---------------------------------------------------------------------------
console.log('\n7. PROTECCIÓN CONTRA DOBLE CLICK Y FALLA DE IMPRESIÓN (puntos 23, 24):');

check('el modal bloquea la acción con una ref antes de llamar a confirmarRetiroEfectivo', () => {
  const i = fuenteModal.indexOf('const handleConfirmar');
  const cuerpo = fuenteModal.slice(i, i + 300);
  assert.match(cuerpo, /if \(procesandoRef\.current\) return;/);
  assert.match(cuerpo, /procesandoRef\.current = true;/);
});

check('confirmarRetiroEfectivo vuelve a calcular las tiradas pendientes (no confía en la preview)', () => {
  const i = fuenteRetiro.indexOf('export const confirmarRetiroEfectivo');
  const cuerpo = fuenteRetiro.slice(i, i + 900);
  assert.match(cuerpo, /calcularRetiroPendiente\(\)/);
  assert.match(cuerpo, /sinTiradas: true/);
});

check('revalida el índice de reclamos justo antes de escribir (colisión → error, no duplica)', () => {
  const i = fuenteRetiro.indexOf('export const confirmarRetiroEfectivo');
  const cuerpo = fuenteRetiro.slice(i, i + 1600);
  assert.match(cuerpo, /yaClaimadas\[c\.key\]/);
  assert.match(cuerpo, /throw new Error/);
});

check('el retiro se persiste ANTES de imprimir, y un error de impresión no lo revierte', () => {
  const i = fuenteModal.indexOf('const { retiro } = resultado;');
  assert.ok(i > 0);
  const cuerpo = fuenteModal.slice(i, i + 900);
  assert.match(cuerpo, /try \{[\s\S]*printRetiroTicket/, 'la impresión no está aislada en su propio try/catch');
  assert.ok(!/await\s+.*delete|remove\(/.test(cuerpo), 'hay algo que borra el retiro tras imprimir');
});

// ---------------------------------------------------------------------------
console.log('\n8. NOMBRE COMERCIAL DINÁMICO — ya no cae siempre en LANYULINA (punto 19):');

check('getBusinessName lee primero la configuración real del local (nombreFantasia)', () => {
  assert.match(fuenteBusinessName, /window\.__appSettings\?\.nombreFantasia/);
  const i = fuenteBusinessName.indexOf('export const getBusinessName');
  const cuerpo = fuenteBusinessName.slice(i, i + 500);
  assert.match(cuerpo, /if \(nombreConfigurado\) return nombreConfigurado;/,
    'no prioriza el nombre configurado sobre el valor hardcodeado');
});

check('el ticket de Retiro de Efectivo usa el nombre dinámico, no un string fijo', () => {
  const fuenteTicket = readFileSync(new URL('../../print/retiroTicket.js', import.meta.url), 'utf8');
  assert.match(fuenteTicket, /getBusinessNameUppercase/);
  assert.ok(!/LANYULINA/.test(fuenteTicket), 'quedó un nombre hardcodeado en el ticket nuevo');
});

// ---------------------------------------------------------------------------
console.log('\n9. RETIROS QUE ATRAVIESAN CAMBIOS DE FECHA/TURNO/BACKUP (verificación pedida):');

check('el orquestador NUNCA consulta una sola fecha: usa fechasACubrir (rango), no una fecha fija', () => {
  const i = fuenteRetiro.indexOf('export const calcularRetiroPendiente');
  assert.ok(i > 0);
  const cuerpo = fuenteRetiro.slice(i, i + 900);
  assert.match(cuerpo, /fechasACubrir\(desdeISO, hastaISO\)/, 'no arma el rango de fechas a partir de desde/hasta');
  assert.match(cuerpo, /fetchTurnosEnRango\(fechas\)/, 'no recorre TODAS las fechas del rango');
  assert.ok(!/fetchShiftsForDate\(\s*(new Date\(\)|getLocalTodayDate\(\)|displayDate)/.test(fuenteRetiro),
    'quedó atado a "hoy" o a la fecha de la pantalla en vez de al rango real');
});

check('además del rango de fechas, SIEMPRE suma el turno abierto actual (sin importar su fecha)', () => {
  const i = fuenteRetiro.indexOf('export const calcularRetiroPendiente');
  const cuerpo = fuenteRetiro.slice(i, i + 1300);
  assert.match(cuerpo, /checkOpenShift\(\)/, 'no consulta el turno abierto de forma independiente del rango de fechas');
  assert.match(cuerpo, /conTurnoAbiertoIncluido\(turnosPorFecha, turnoAbierto\)/);
});

check('conTurnoAbiertoIncluido: suma el turno abierto si no estaba, y no lo duplica si ya estaba', () => {
  const turnoAbierto = { id: 999, date: '10-09-2026', CAJAFUERTE: {} };
  const sinEse = conTurnoAbiertoIncluido([turno134], turnoAbierto);
  assert.strictEqual(sinEse.length, 2);
  assert.ok(sinEse.some((t) => t.id === 999));

  const yaEstaba = conTurnoAbiertoIncluido([turno134, turnoAbierto], turnoAbierto);
  assert.strictEqual(yaEstaba.length, 2, 'no tiene que duplicar el turno si el rango de fechas ya lo había traído');

  assert.deepStrictEqual(conTurnoAbiertoIncluido([turno134], null), [turno134], 'sin turno abierto, no cambia nada');
});

// A) CAMBIO DE DÍA: último retiro lunes 20:00, tirada lunes 23:00 y otra martes 01:00, mismo turno vivo.
check('A) cambio de día — retiro martes 08:00 incluye la tirada de lunes 23:00 Y la de martes 01:00', () => {
  const turnoQueCruzaMedianoche = {
    id: 20, date: '14-09-2026', // abrió lunes
    CAJAFUERTE: {
      1: { valor: 20000, fecha: '14-09-2026', hora: '23:00:00', timestamp: '2026-09-14T23:00:00.000Z' }, // Tirada #20
      2: { valor: 30000, fecha: '15-09-2026', hora: '01:00:00', timestamp: '2026-09-15T01:00:00.000Z' }, // Tirada #21
    },
  };
  const desdeISO = '2026-09-14T20:00:00.000Z'; // último retiro lunes 20:00
  const hastaISO = '2026-09-15T08:00:00.000Z'; // retiro martes 08:00

  // Simula lo que devolvería fetchTurnosEnRango recorriendo TODAS las fechas del rango.
  const fechas = fechasACubrir(desdeISO, hastaISO).map((f) => f.toDateString());
  assert.ok(fechas.includes(new Date('2026-09-14T12:00:00').toDateString()), 'el rango de fechas no incluye el lunes');
  assert.ok(fechas.includes(new Date('2026-09-15T12:00:00').toDateString()), 'el rango de fechas no incluye el martes');

  const { candidatas, cantidad, total } = seleccionarTiradasPendientes(
    [turnoQueCruzaMedianoche], { desdeISO, hastaISO, yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 2, 'tienen que entrar #20 y #21');
  assert.strictEqual(total, 50000);
  assert.deepStrictEqual(candidatas.map((c) => c.entryId), ['1', '2']);
});

// B) TRES FECHAS DIFERENTES: lunes, martes, miércoles — retiro el miércoles.
check('B) tres fechas distintas (lunes/martes/miércoles) quedan todas incluidas en un solo retiro', () => {
  const turnoLunes = { id: 60, date: '14-09-2026', CAJAFUERTE: { 1: { valor: 1000, fecha: '14-09-2026', hora: '10:00:00', timestamp: '2026-09-14T10:00:00.000Z' } } };
  const turnoMartes = { id: 61, date: '15-09-2026', CAJAFUERTE: { 1: { valor: 2000, fecha: '15-09-2026', hora: '10:00:00', timestamp: '2026-09-15T10:00:00.000Z' } } };
  const turnoMiercoles = { id: 62, date: '16-09-2026', CAJAFUERTE: { 1: { valor: 3000, fecha: '16-09-2026', hora: '10:00:00', timestamp: '2026-09-16T10:00:00.000Z' } } };

  const desdeISO = '2026-09-14T00:00:00.000Z';
  const hastaISO = '2026-09-16T20:00:00.000Z';
  const fechas = fechasACubrir(desdeISO, hastaISO);
  assert.ok(fechas.length >= 3, 'el rango tiene que abarcar al menos los tres días');

  const { candidatas, cantidad, total } = seleccionarTiradasPendientes(
    [turnoLunes, turnoMartes, turnoMiercoles], { desdeISO, hastaISO, yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 3);
  assert.strictEqual(total, 6000);
  assert.deepStrictEqual(candidatas.map((c) => c.turnoId), [60, 61, 62], 'tienen que quedar las tres, en orden');
});

// C) BACKUP + TURNO ABIERTO: una tirada quedó en un turno ya migrado a BACKUP, otra en el turno vivo.
check('C) una tirada en turno cerrado (BACKUP) y otra en el turno abierto entran juntas', () => {
  // fetchShiftsForDate ya combina CAJAS (vivo) + BACKUP para una misma fecha —
  // desde la selección pura da igual de dónde vino cada turno, ambos llegan
  // con la misma forma ({id, date, CAJAFUERTE}).
  const turnoCerradoEnBackup = { id: 140, date: '14-09-2026', estado: 'cerrado', CAJAFUERTE: { 1: { valor: 5000, fecha: '14-09-2026', hora: '22:00:00', timestamp: '2026-09-14T22:00:00.000Z' } } };
  const turnoAbiertoVivo = { id: 141, date: '15-09-2026', estado: 'abierto', CAJAFUERTE: { 1: { valor: 7000, fecha: '15-09-2026', hora: '01:00:00', timestamp: '2026-09-15T01:00:00.000Z' } } };

  const { candidatas, cantidad } = seleccionarTiradasPendientes(
    [turnoCerradoEnBackup, turnoAbiertoVivo],
    { desdeISO: '2026-09-14T20:00:00.000Z', hastaISO: '2026-09-15T08:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 2);
  assert.ok(candidatas.some((c) => c.turnoId === 140), 'falta la tirada del turno ya migrado a BACKUP');
  assert.ok(candidatas.some((c) => c.turnoId === 141), 'falta la tirada del turno abierto');
});

// D) CAMBIO DE FECHA + CAMBIO DE TURNO: #40 en turno 150 (lunes, se cierra), #41 en turno 151 (martes, nuevo).
check('D) cambio de fecha Y de turno a la vez — entran #40 (turno cerrado) y #41 (turno nuevo)', () => {
  const turno150 = { id: 150, date: '14-09-2026', CAJAFUERTE: { 1: { valor: 4000, fecha: '14-09-2026', hora: '23:50:00', timestamp: '2026-09-14T23:50:00.000Z' } } }; // Tirada #40
  const turno151 = { id: 151, date: '15-09-2026', CAJAFUERTE: { 1: { valor: 4500, fecha: '15-09-2026', hora: '00:20:00', timestamp: '2026-09-15T00:20:00.000Z' } } }; // Tirada #41

  const { candidatas, cantidad } = seleccionarTiradasPendientes(
    [turno150, turno151],
    { desdeISO: '2026-09-14T18:00:00.000Z', hastaISO: '2026-09-15T08:00:00.000Z', yaClaimadas: new Set() },
  );
  assert.strictEqual(cantidad, 2);
  assert.deepStrictEqual(candidatas.map((c) => c.turnoId), [150, 151], 'orden cronológico: primero #40, después #41');
});

// E) VARIOS DÍAS SIN RETIRO: 10 al 14/09, tiradas válidas todos los días.
check('E) cinco días sin retiro (10 al 14/09) — todas las tiradas comprendidas entran', () => {
  const turnos = ['10', '11', '12', '13', '14'].map((dia, idx) => ({
    id: 70 + idx,
    date: `${dia}-09-2026`,
    CAJAFUERTE: { 1: { valor: (idx + 1) * 1000, fecha: `${dia}-09-2026`, hora: '12:00:00', timestamp: `2026-09-${dia}T12:00:00.000Z` } },
  }));

  const desdeISO = '2026-09-10T06:00:00.000Z'; // último retiro, ANTES de la tirada del propio día 10
  const hastaISO = '2026-09-14T20:00:00.000Z'; // nuevo retiro
  const fechas = fechasACubrir(desdeISO, hastaISO);
  assert.ok(fechas.length >= 5, 'el rango de días escaneados tiene que cubrir los 5 días');

  const { candidatas, cantidad, total } = seleccionarTiradasPendientes(turnos, { desdeISO, hastaISO, yaClaimadas: new Set() });
  assert.strictEqual(cantidad, 5, 'tienen que entrar las tiradas de los 5 días');
  assert.strictEqual(total, 1000 + 2000 + 3000 + 4000 + 5000);
});

// F) TURNO ABIERTO QUE LLEVA VARIOS DÍAS SIN CERRARSE — su fecha de apertura
// queda MUY afuera del rango [desde-1, hasta], pero checkOpenShift() lo trae
// igual (conTurnoAbiertoIncluido), así que sus tiradas nuevas no se pierden.
check('F) turno abierto hace varios días: sus tiradas entran igual gracias a conTurnoAbiertoIncluido', () => {
  const turnoViejoAunAbierto = {
    id: 80, date: '01-09-2026', // abrió hace 2 semanas y nunca se cerró
    CAJAFUERTE: {
      1: { valor: 9000, fecha: '15-09-2026', hora: '09:00:00', timestamp: '2026-09-15T09:00:00.000Z' },
    },
  };
  const desdeISO = '2026-09-14T20:00:00.000Z';
  const hastaISO = '2026-09-15T10:00:00.000Z';

  // Sin sumar el turno abierto, el rango de fechas (13,14,15/09) NUNCA hubiera
  // llegado hasta el 01/09 donde vive este turno en CAJAS/BACKUP.
  const fechas = fechasACubrir(desdeISO, hastaISO);
  assert.ok(!fechas.some((f) => f.toDateString() === new Date('2026-09-01T12:00:00').toDateString()),
    'este caso solo tiene sentido si el 01/09 efectivamente queda FUERA del rango escaneado');

  const turnos = conTurnoAbiertoIncluido([], turnoViejoAunAbierto);
  const { cantidad, total } = seleccionarTiradasPendientes(turnos, { desdeISO, hastaISO, yaClaimadas: new Set() });
  assert.strictEqual(cantidad, 1, 'la tirada del turno viejo-pero-abierto tiene que entrar igual');
  assert.strictEqual(total, 9000);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
