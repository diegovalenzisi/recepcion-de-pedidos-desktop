// Estado de Recepción: horario + switch de cierre temporal (swich).
// Correr con: node src/lib/utils/__tests__/horarioComercio.test.js
import assert from 'node:assert';
import { estaDentroDeHorario, ultimoInicioDeFranjaMs, calcularEstadoRecepcion } from '../horarioComercio.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// Miércoles fijo (2025-01-15 es miércoles) para no depender del día real.
const fecha = (hh, mm, diaBase = 15) => new Date(2025, 0, diaBase, hh, mm, 0, 0);

const horariosDosFranjas = {
  miercoles: [{ start: '13:00', end: '18:00' }, { start: '20:00', end: '23:50' }],
};
const horariosNocturno = {
  miercoles: [{ start: '20:00', end: '02:00' }],
};

console.log('estaDentroDeHorario:');
check('dentro de la primera franja', () => {
  assert.strictEqual(estaDentroDeHorario(horariosDosFranjas, fecha(15, 0)), true);
});
check('entre las dos franjas del mismo día: cerrado', () => {
  assert.strictEqual(estaDentroDeHorario(horariosDosFranjas, fecha(18, 30)), false);
});
check('dentro de la segunda franja', () => {
  assert.strictEqual(estaDentroDeHorario(horariosDosFranjas, fecha(21, 0)), true);
});
check('turno que cruza medianoche: antes de la medianoche', () => {
  assert.strictEqual(estaDentroDeHorario(horariosNocturno, fecha(23, 0)), true);
});
check('turno que cruza medianoche: después (jueves 01:00 cae en el día "jueves")', () => {
  // El check de "jueves" usa el horario configurado para JUEVES, no el turno
  // nocturno de miércoles — así funciona hoy en toda la base de código
  // (dayMapping por getDay()); documentamos el comportamiento real, no lo
  // que "debería" ser un horario configurado distinto para jueves.
  assert.strictEqual(estaDentroDeHorario(horariosNocturno, new Date(2025, 0, 16, 1, 0)), false);
});
check('sin horarios configurados: cerrado', () => {
  assert.strictEqual(estaDentroDeHorario(null, fecha(15, 0)), false);
});

console.log('\nultimoInicioDeFranjaMs:');
check('antes de cualquier inicio de hoy: toma el de ayer si corresponde, si no null', () => {
  const r = ultimoInicioDeFranjaMs(horariosDosFranjas, fecha(10, 0));
  assert.strictEqual(r, null); // miércoles a las 10, sin turnos de martes configurados
});
check('justo después del inicio de la 2da franja: devuelve ESE inicio', () => {
  const r = ultimoInicioDeFranjaMs(horariosDosFranjas, fecha(20, 1));
  assert.strictEqual(r, fecha(20, 0).getTime());
});
check('entrada las 15:00 (dentro de la 1ra franja): devuelve el inicio de la 1ra, no un futuro', () => {
  const r = ultimoInicioDeFranjaMs(horariosDosFranjas, fecha(15, 0));
  assert.strictEqual(r, fecha(13, 0).getTime());
});

console.log('\ncalcularEstadoRecepcion — casos del enunciado:');

check('CASO base: swich false, dentro de horario => abierto', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: false }, fecha(15, 0));
  assert.deepStrictEqual(r, { abierto: true, cerradoTemporalmente: false, debeResetearSwich: false });
});

check('CASO 1: OFF dentro de la franja => cierra ya, sin resetear', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() },
    fecha(14, 0),
  );
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.cerradoTemporalmente, true);
  assert.strictEqual(r.debeResetearSwich, false);
});

check('no reabre por polling dentro de la MISMA franja (14:00 cierre, chequeo 14:01, 15:30, 17:59)', () => {
  const swichDesde = fecha(14, 0).getTime();
  for (const [hh, mm] of [[14, 1], [15, 30], [17, 59]]) {
    const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde }, fecha(hh, mm));
    assert.strictEqual(r.abierto, false, `debería seguir cerrado a las ${hh}:${mm}`);
    assert.strictEqual(r.debeResetearSwich, false, `no debería resetear a las ${hh}:${mm}`);
  }
});

check('18:00 (fin de franja, todavía sin franja NUEVA): sigue cerrado', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() },
    fecha(18, 0),
  );
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.debeResetearSwich, false);
});

check('CASO 5/reset: arranca la franja de las 20:00 => resetea swich y abre', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() },
    fecha(20, 0),
  );
  assert.strictEqual(r.abierto, true);
  assert.strictEqual(r.debeResetearSwich, true);
});

check('después del reset, más tarde en la misma franja nueva: ya no hace falta resetear de nuevo', () => {
  // El caller ya habrá persistido swich=false tras el check anterior; simulamos
  // el estado siguiente (swich=false) para confirmar que no vuelve a pedir reset.
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: false }, fecha(20, 30));
  assert.strictEqual(r.abierto, true);
  assert.strictEqual(r.debeResetearSwich, false);
});

check('CASO 3: reactivación manual (swich=false) DENTRO de horario => abre ahora', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: false }, fecha(21, 0));
  assert.strictEqual(r.abierto, true);
});

check('CASO 4: reactivación manual (swich=false) FUERA de horario => permanece cerrado, sin marca de cierre', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: false }, fecha(19, 0));
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.cerradoTemporalmente, false); // no es un cierre temporal, es "todavía no abrió"
  assert.strictEqual(r.debeResetearSwich, false);
});

check('cierre manual SIN swichDesde (dato legacy/ausente): se autocorrige en el próximo inicio de franja', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true }, fecha(20, 0));
  assert.strictEqual(r.debeResetearSwich, true);
  assert.strictEqual(r.abierto, true);
});

check('cierre manual SIN swichDesde, sin ningún inicio de franja pasado todavía: sigue cerrado', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true }, fecha(10, 0));
  assert.strictEqual(r.debeResetearSwich, false);
  assert.strictEqual(r.abierto, false);
});

check('reinicio de la app: el cálculo es puro y da el mismo resultado sin estado previo en memoria', () => {
  const input = { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() };
  const r1 = calcularEstadoRecepcion(input, fecha(15, 0));
  const r2 = calcularEstadoRecepcion(input, fecha(15, 0)); // "reinicio": mismo input, sin memoria previa
  assert.deepStrictEqual(r1, r2);
});

console.log('\nTurno nocturno (cruza medianoche):');
check('OFF a las 21:00 (dentro del turno 20:00–02:00): cierra', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosNocturno, swich: true, swichDesde: fecha(21, 0).getTime() },
    fecha(21, 0),
  );
  assert.strictEqual(r.abierto, false);
});
check('sigue cerrado más tarde esa misma noche (23:30), sin reabrir solo', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosNocturno, swich: true, swichDesde: fecha(21, 0).getTime() },
    fecha(23, 30),
  );
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.debeResetearSwich, false);
});
check('al otro día, arranca de nuevo el turno de las 20:00 (jueves): resetea', () => {
  const horariosNocturnoJueves = { jueves: [{ start: '20:00', end: '02:00' }] };
  const r = calcularEstadoRecepcion(
    { horarios: horariosNocturnoJueves, swich: true, swichDesde: fecha(21, 0).getTime() },
    new Date(2025, 0, 16, 20, 0),
  );
  assert.strictEqual(r.debeResetearSwich, true);
  assert.strictEqual(r.abierto, true);
});

console.log(`\n${passed} pruebas OK`);
