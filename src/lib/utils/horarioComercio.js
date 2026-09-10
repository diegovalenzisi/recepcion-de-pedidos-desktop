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
 * `swichDesde` válido = un epoch ms real (no `null`/`undefined`/`NaN`/`0`/
 * booleano). Es la guarda contra el bug de local 40508022: si `swich` llega
 * en `true` pero `swichDesde` todavía no es un timestamp real —ya sea porque
 * el snapshot de Firebase que trajo el cierre no incluyó (todavía) el campo
 * compañero, o porque el dato es legacy/incompleto— NUNCA hay que tratarlo
 * como "cerrado desde el epoch" (0): eso hace que CUALQUIER inicio de franja
 * ya pasado (por ejemplo la franja del propio cierre) se vea como "franja
 * nueva" y dispare una reapertura automática inmediata, sin haber pasado ni
 * un minuto del cierre manual.
 */
const swichDesdeEsValido = (valor) => {
  if (valor === null || valor === undefined || typeof valor === 'boolean') return false;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0;
};

/**
 * Decisión única de "¿Recepción está abierta?", combinando horario + el
 * cierre temporal. Reemplaza cualquier cálculo propio que hiciera cada
 * pantalla: una sola función, un solo criterio.
 *
 *   swich !== true             → sigue el horario, sin más.
 *   swich === true:
 *     · si `swichDesde` NO es un timestamp válido → cerrado, tal cual, SIN
 *       resetear (ver `swichDesdeEsValido` arriba). Se espera al próximo
 *       snapshot/chequeo, que puede traer el `swichDesde` real.
 *     · si `swichDesde` es válido y NO empezó una franja nueva desde ahí →
 *       cerrado, tal cual.
 *     · si `swichDesde` es válido y SÍ empezó una franja nueva desde ahí →
 *       el cierre temporal ya venció: se recalcula como recién llegado
 *       (abierto según horario AHORA) y se devuelve `debeResetearSwich: true`
 *       para que el caller persista `{ swich: false, swichDesde: null }` en
 *       Firebase.
 *
 * Es intencional que un `swichDesde` inválido NUNCA se autocorrija solo (no
 * hay ningún inicio de franja, pasado o futuro, que lo resetee): sin la
 * fecha real de cierre no hay forma segura de saber si ya pasó una franja
 * nueva desde entonces, así que la única salida es que llegue el dato bueno.
 *
 * `motivo` distingue POR QUÉ está cerrado, para que la UI no diga "Cerrado" a
 * secas cuando en realidad es un cierre manual temporal (swich=true): 'manual'
 * cuando el cierre viene del switch de Recepción, 'horario' cuando es sólo que
 * estamos fuera de la franja configurada, `null` cuando está abierto. Campo
 * agregado sin tocar `abierto`/`cerradoTemporalmente`/`debeResetearSwich`
 * (ya existentes): ningún caller viejo se rompe por no leerlo.
 *
 * @returns {{ abierto: boolean, cerradoTemporalmente: boolean, debeResetearSwich: boolean, motivo: 'manual'|'horario'|null }}
 */
export function calcularEstadoRecepcion({ horarios, swich, swichDesde } = {}, ahora = new Date()) {
  const dentroDeHorario = estaDentroDeHorario(horarios, ahora);

  if (swich !== true) {
    return { abierto: dentroDeHorario, cerradoTemporalmente: false, debeResetearSwich: false, motivo: dentroDeHorario ? null : 'horario' };
  }

  if (!swichDesdeEsValido(swichDesde)) {
    return { abierto: false, cerradoTemporalmente: true, debeResetearSwich: false, motivo: 'manual' };
  }

  const ultimoInicio = ultimoInicioDeFranjaMs(horarios, ahora);
  const empezoFranjaNueva = ultimoInicio !== null && ultimoInicio > Number(swichDesde);

  if (empezoFranjaNueva) {
    return { abierto: dentroDeHorario, cerradoTemporalmente: false, debeResetearSwich: true, motivo: dentroDeHorario ? null : 'horario' };
  }

  return { abierto: false, cerradoTemporalmente: true, debeResetearSwich: false, motivo: 'manual' };
}
