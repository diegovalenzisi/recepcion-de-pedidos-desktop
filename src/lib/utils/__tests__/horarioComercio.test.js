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
  assert.deepStrictEqual(r, { abierto: true, cerradoTemporalmente: false, debeResetearSwich: false, motivo: null });
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

check('swich=true con swichDesde AUSENTE (undefined): NUNCA auto-reset, aunque ya haya una franja pasada', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true }, fecha(20, 0));
  assert.strictEqual(r.debeResetearSwich, false, 'no debe autocorregirse sin un swichDesde real');
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.cerradoTemporalmente, true);
});

check('swich=true con swichDesde AUSENTE, sin ningún inicio de franja pasado todavía: sigue cerrado', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true }, fecha(10, 0));
  assert.strictEqual(r.debeResetearSwich, false);
  assert.strictEqual(r.abierto, false);
});

console.log('\nBug real (local 40508022): carrera / dato incompleto en swichDesde — NUNCA debe reabrir:');

check('swichDesde = null (p.ej. llegó "swich:true" antes que el nuevo swichDesde en el mismo snapshot): sigue cerrado', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde: null }, fecha(20, 1));
  assert.strictEqual(r.debeResetearSwich, false);
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.cerradoTemporalmente, true);
});

check('swichDesde = 0: NO se trata como "cerrado desde el epoch" (eso reabriría con cualquier franja pasada)', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde: 0 }, fecha(20, 1));
  assert.strictEqual(r.debeResetearSwich, false);
  assert.strictEqual(r.abierto, false);
});

check('swichDesde = NaN / string no numérica / false: tratados igual que ausente, sigue cerrado', () => {
  for (const valorInvalido of [NaN, 'no-es-una-fecha', false, undefined]) {
    const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde: valorInvalido }, fecha(20, 1));
    assert.strictEqual(r.debeResetearSwich, false, `no debe resetear con swichDesde=${valorInvalido}`);
    assert.strictEqual(r.abierto, false, `debe seguir cerrado con swichDesde=${valorInvalido}`);
  }
});

check('en cuanto llega un swichDesde válido (mismo minuto, snapshot siguiente), se evalúa correctamente y sigue cerrado', () => {
  // Simula el snapshot "bueno" que llega inmediatamente después del incompleto:
  // mismo minuto, pero ya con swichDesde real — confirma que no quedó ningún
  // estado pegado del cálculo anterior (la función es pura, sin memoria).
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(20, 1).getTime() },
    fecha(20, 1),
  );
  assert.strictEqual(r.debeResetearSwich, false);
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.cerradoTemporalmente, true);
});

console.log('\nCaso exacto reportado (local 40508022): franja 20:00–23:50, cierre manual a las 21:30:');

check('21:31 (1 minuto después del cierre): sigue cerrado', () => {
  const swichDesde = fecha(21, 30).getTime();
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde }, fecha(21, 31));
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.debeResetearSwich, false);
});

check('22:00 (mitad de la franja): sigue cerrado', () => {
  const swichDesde = fecha(21, 30).getTime();
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde }, fecha(22, 0));
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.debeResetearSwich, false);
});

check('23:49 (1 minuto antes del fin de la franja): sigue cerrado', () => {
  const swichDesde = fecha(21, 30).getTime();
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde }, fecha(23, 49));
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.debeResetearSwich, false);
});

check('polling cada 60s durante toda la franja (20:01 a 23:49): nunca reabre', () => {
  const swichDesde = fecha(21, 30).getTime();
  for (const [hh, mm] of [[21, 31], [21, 45], [22, 30], [23, 0], [23, 49]]) {
    const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true, swichDesde }, fecha(hh, mm));
    assert.strictEqual(r.abierto, false, `no debería abrir a las ${hh}:${mm}`);
    assert.strictEqual(r.debeResetearSwich, false, `no debería resetear a las ${hh}:${mm}`);
  }
});

check('reinicio de Desktop dentro de la misma franja (sin memoria previa): sigue cerrado', () => {
  const input = { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(21, 30).getTime() };
  const r1 = calcularEstadoRecepcion(input, fecha(22, 15));
  const r2 = calcularEstadoRecepcion(input, fecha(22, 15)); // "reinicio": mismo input, sin estado en memoria
  assert.deepStrictEqual(r1, r2);
  assert.strictEqual(r1.abierto, false);
});

check('franja NUEVA y posterior al cierre (al otro día a las 13:00): ahí sí resetea y abre', () => {
  const swichDesde = fecha(21, 30).getTime(); // cierre miércoles 21:30
  const horariosConMañana = {
    miercoles: horariosDosFranjas.miercoles,
    jueves: [{ start: '13:00', end: '18:00' }],
  };
  const r = calcularEstadoRecepcion(
    { horarios: horariosConMañana, swich: true, swichDesde },
    new Date(2025, 0, 16, 13, 0), // jueves 13:00 > swichDesde (miércoles 21:30)
  );
  assert.strictEqual(r.debeResetearSwich, true);
  assert.strictEqual(r.abierto, true);
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

console.log('\nmotivo (distingue cierre manual de cierre por horario, sin romper abierto/cerradoTemporalmente/debeResetearSwich):');

check('swich=false, dentro de horario => motivo null (abierto)', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: false }, fecha(15, 0));
  assert.strictEqual(r.motivo, null);
});

check('swich=false, FUERA de horario => motivo "horario"', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: false }, fecha(19, 0));
  assert.strictEqual(r.motivo, 'horario');
});

check('swich=true, dentro de la misma franja de cierre => motivo "manual"', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() },
    fecha(15, 0),
  );
  assert.strictEqual(r.motivo, 'manual');
});

check('swich=true con swichDesde inválido/ausente => motivo "manual" igual (sigue cerrado por el switch)', () => {
  const r = calcularEstadoRecepcion({ horarios: horariosDosFranjas, swich: true }, fecha(15, 0));
  assert.strictEqual(r.motivo, 'manual');
});

check('empieza franja nueva estando DENTRO de horario => resetea y motivo vuelve a null (abierto)', () => {
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() },
    fecha(20, 0),
  );
  assert.strictEqual(r.debeResetearSwich, true);
  assert.strictEqual(r.motivo, null);
});

check('empieza franja nueva pero ya terminó y seguimos FUERA de horario en ese instante => motivo "horario", no "manual"', () => {
  // Cierre manual durante la 1ra franja (14:00). Para cuando se vuelve a
  // chequear (23:51) ya arrancó Y terminó la 2da franja (20:00–23:50): el
  // cierre manual quedó vencido (se resetea), pero a las 23:51 tampoco es
  // horario de atención — lo que queda es "todavía no abrió", no "manual".
  const r = calcularEstadoRecepcion(
    { horarios: horariosDosFranjas, swich: true, swichDesde: fecha(14, 0).getTime() },
    fecha(23, 51),
  );
  assert.strictEqual(r.debeResetearSwich, true);
  assert.strictEqual(r.abierto, false);
  assert.strictEqual(r.motivo, 'horario');
});

console.log(`\n${passed} pruebas OK`);
