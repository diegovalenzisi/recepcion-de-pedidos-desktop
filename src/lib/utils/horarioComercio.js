// ---------------------------------------------------------------------------
// ESTADO DE RECEPCIÓN: horario configurado + switch de habilitación temporal.
//
// Fuente de verdad ÚNICA por local, compartida con DLV Consultas:
//   {localId}/CONFIGURACION/web/horarios   — horario configurado (sin cambios)
//   {localId}/CONFIGURACION/swich          — boolean. true = cerrado
//                                             TEMPORALMENTE. false/ausente =
//                                             modo automático (obedece horario).
//   {localId}/CONFIGURACION/swichDesde     — epoch ms del momento en que se
//                                             puso swich=true. Sirve para
//                                             distinguir "seguimos en la misma
//                                             franja de cuando cerré" de
//                                             "empezó una franja nueva desde
//                                             que cerré" sin depender de que
//                                             ninguna app haya estado corriendo
//                                             en el minuto exacto del cambio
//                                             (robusto a reinicios).
//
// El campo `swich` (nombre real en Firebase, con ese typo histórico) NO
// cambia de significado interno: true siempre significó "cerrado a mano".
// Lo que cambia es que ahora es TEMPORAL: se cancela solo apenas arranca la
// próxima franja de apertura configurada, sin que nadie tenga que tocar el
// switch de nuevo. La UI (DLV Consultas) muestra la polaridad invertida
// ("Recepción habilitada" ON == swich false) — ver CerradoManualSwitch.
//
// Módulo puro: sin Firebase, sin React. Import directo desde Node para tests.
// ---------------------------------------------------------------------------

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const turnosDelDia = (horarios, dayIndex) => {
  const dia = horarios ? horarios[DIAS_SEMANA[dayIndex]] : null;
  if (!dia) return [];
  // Firebase serializa objetos con claves numéricas como array (con huecos
  // `null` en los índices salteados) — igual de válido un array real que un
  // objeto {0: turno, 1: turno}. Cubrimos ambos, como ya hace Horarios.jsx.
  const lista = Array.isArray(dia) ? dia : Object.values(dia);
  return lista.filter((t) => t && typeof t.start === 'string' && typeof t.end === 'string');
};

const minutosDe = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

/** ¿El horario configurado indica "abierto" en el instante `ahora`? */
export function estaDentroDeHorario(horarios, ahora = new Date()) {
  if (!horarios) return false;
  const currentMinutes = ahora.getHours() * 60 + ahora.getMinutes();
  for (const turno of turnosDelDia(horarios, ahora.getDay())) {
    const startMinutes = minutosDe(turno.start);
    const endMinutes = minutosDe(turno.end);
    if (startMinutes === null || endMinutes === null) continue;
    if (startMinutes < endMinutes) {
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) return true;
    } else {
      // Turno que cruza medianoche (ej. 20:00–02:00).
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) return true;
    }
  }
  return false;
}

/**
 * Momento (epoch ms) del inicio de franja MÁS RECIENTE que ya pasó, mirando
 * hoy y ayer (alcanza para cubrir un turno nocturno que arrancó ayer). No mira
 * si esa franja sigue vigente o no: solo "¿cuándo fue la última vez que
 * arrancó una franja?" — es la pregunta correcta para detectar "empezó una
 * NUEVA franja desde que cerré", distinto de "¿estamos dentro de horario
 * ahora?". Devuelve `null` si no hay ningún horario configurado.
 */
export function ultimoInicioDeFranjaMs(horarios, ahora = new Date()) {
  if (!horarios) return null;
  let mejor = null;
  for (let back = 0; back <= 1; back += 1) {
    const dia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - back);
    for (const turno of turnosDelDia(horarios, dia.getDay())) {
      const startMinutes = minutosDe(turno.start);
      if (startMinutes === null) continue;
      const inicio = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 0, startMinutes, 0, 0).getTime();
      if (inicio <= ahora.getTime() && (mejor === null || inicio > mejor)) mejor = inicio;
    }
  }
  return mejor;
}

/**
 * Decisión única de "¿Recepción está abierta?", combinando horario + el
 * cierre temporal. Reemplaza cualquier cálculo propio que hiciera cada
 * pantalla: una sola función, un solo criterio.
 *
 *   swich !== true             → sigue el horario, sin más.
 *   swich === true:
 *     · si NO empezó una franja nueva desde `swichDesde` → cerrado, tal cual.
 *     · si SÍ empezó una franja nueva desde `swichDesde` → el cierre temporal
 *       ya venció: se recalcula como recién llegado (abierto según horario
 *       AHORA) y se devuelve `debeResetearSwich: true` para que el caller
 *       persista `{ swich: false, swichDesde: null }` en Firebase.
 *
 * `swichDesde` ausente/no numérico con `swich === true` se trata como 0
 * (cierre "de siempre"): se autocorrige apenas se detecte cualquier inicio de
 * franja pasado, en vez de quedar cerrado para siempre por falta del dato.
 *
 * @returns {{ abierto: boolean, cerradoTemporalmente: boolean, debeResetearSwich: boolean }}
 */
export function calcularEstadoRecepcion({ horarios, swich, swichDesde } = {}, ahora = new Date()) {
  const dentroDeHorario = estaDentroDeHorario(horarios, ahora);

  if (swich !== true) {
    return { abierto: dentroDeHorario, cerradoTemporalmente: false, debeResetearSwich: false };
  }

  const ultimoInicio = ultimoInicioDeFranjaMs(horarios, ahora);
  const desde = Number.isFinite(Number(swichDesde)) ? Number(swichDesde) : 0;
  const empezoFranjaNueva = ultimoInicio !== null && ultimoInicio > desde;

  if (empezoFranjaNueva) {
    return { abierto: dentroDeHorario, cerradoTemporalmente: false, debeResetearSwich: true };
  }

  return { abierto: false, cerradoTemporalmente: true, debeResetearSwich: false };
}
