import { ref, get, update, runTransaction } from 'firebase/database';
import { format } from 'date-fns';
import {
  getFirebaseUrl, getCurrentDatabasePath, checkLocalId,
  beginFirebaseOperation, getCurrentDatabaseOrThrow,
} from '@/lib/firebase/core';
import { fetchShiftsForDate } from './data.js';
import { checkOpenShift } from './shift.js';
import { esRolAutorizadoRetiroEfectivo } from '@/lib/roleUtils';
import {
  fechasACubrir, seleccionarTiradasPendientes, claveDeTirada, conTurnoAbiertoIncluido,
} from './retiroEfectivoLogica.js';

export {
  fechasACubrir, seleccionarTiradasPendientes, claveDeTirada, conTurnoAbiertoIncluido,
} from './retiroEfectivoLogica.js';

// -----------------------------------------------------------------------
// RETIRO DE EFECTIVO — auditoría de tiradas, NO un movimiento contable.
//
// Esta función NUNCA escribe en CAJAFUERTE, gastos, ventas ni en ningún nodo
// que alimente los cálculos existentes de la pantalla CAJAS. Solo lee tiradas
// ya existentes (CAJAS/{fecha}/turnos/{id}/CAJAFUERTE y su equivalente en
// BACKUP) y anota, en nodos propios y separados, cuáles quedaron comprendidas
// en cada retiro. Caja Fuerte, Tiradas y Turnos se leen tal cual ya existen
// —no se inventa una estructura paralela para esos tres conceptos.
//
// Nodos propios (nuevos, no tocan nada existente):
//   {LOCAL_ID}/CONFIGURACION/retiroEfectivoHabilitadoDesde   (string ISO, se
//     escribe UNA SOLA VEZ — ver ensureRetiroEfectivoHabilitadoDesde)
//   {LOCAL_ID}/CONTADORES/retirosEfectivo                    (contador, mismo
//     patrón que CONTADORES/turnos y CONTADORES/pagosComisiones)
//   {LOCAL_ID}/RETIROS_EFECTIVO/{retiroId}                   (un documento por
//     retiro, con las tiradas que incluyó)
//   {LOCAL_ID}/RETIROS_EFECTIVO_TIRADAS/{turnoId}_{entryId}  (índice plano:
//     qué retiro ya se llevó esta tirada — es la garantía de que una tirada
//     jamás puede quedar en dos retiros, más allá del rango de fechas)
//
// La lógica pura (rango de fechas, selección de candidatas) vive en
// retiroEfectivoLogica.js, sin Firebase — se prueba directo con node:assert.
// -----------------------------------------------------------------------

const HABILITADO_PATH = 'CONFIGURACION/retiroEfectivoHabilitadoDesde';
const CONTADOR_PATH = 'CONTADORES/retirosEfectivo';
const RETIROS_PATH = 'RETIROS_EFECTIVO';
const TIRADAS_CLAIM_PATH = 'RETIROS_EFECTIVO_TIRADAS';

/**
 * Punto de inicio de la funcionalidad para este local. Se crea UNA SOLA VEZ:
 * si ya existe, la transacción no lo toca (Firebase aborta devolviendo
 * `undefined`, que deja el valor actual sin cambios — nunca `null`, que lo
 * borraría). Se debe llamar en el arranque de la app (una vez que Firebase del
 * local está listo), nunca de forma perezosa al abrir Caja o al confirmar un
 * retiro — si se llamara ahí, una tirada creada en el mismo instante antes de
 * la primera invocación podría quedar del lado equivocado del corte.
 */
export const ensureRetiroEfectivoHabilitadoDesde = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getCurrentDatabaseOrThrow();
  const habilitadoRef = ref(db, `${LOCAL_ID}/${HABILITADO_PATH}`);
  const nuevoValor = new Date().toISOString();

  const { snapshot } = await runTransaction(habilitadoRef, (actual) => {
    if (actual) return; // ya existe: no se toca, ni se reinicia en cada actualización.
    return nuevoValor;
  });

  return snapshot.val();
};

/** Solo lectura — no crea nada. `null` si la función todavía no fue habilitada. */
export const getRetiroEfectivoHabilitadoDesde = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const API_URL = getFirebaseUrl();
  const response = await fetch(`${API_URL}/${LOCAL_ID}/${HABILITADO_PATH}.json`);
  if (!response.ok) return null;
  return (await response.json()) || null;
};

/** Último retiro confirmado (mayor retiroId), o `null` si todavía no hubo ninguno. */
export const getUltimoRetiroEfectivo = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const API_URL = getFirebaseUrl();

  const shallowResponse = await fetch(`${API_URL}/${LOCAL_ID}/${RETIROS_PATH}.json?shallow=true`);
  if (!shallowResponse.ok) return null;
  const ids = await shallowResponse.json();
  if (!ids) return null;

  const maxId = Math.max(...Object.keys(ids).map((id) => Number(id)).filter((n) => Number.isFinite(n)));
  if (!Number.isFinite(maxId)) return null;

  const response = await fetch(`${API_URL}/${LOCAL_ID}/${RETIROS_PATH}/${maxId}.json`);
  if (!response.ok) return null;
  return (await response.json()) || null;
};

const getNextRetiroId = async (db, LOCAL_ID) => {
  const counterRef = ref(db, `${LOCAL_ID}/${CONTADOR_PATH}`);
  const { committed, snapshot } = await runTransaction(counterRef, (actual) => (actual || 0) + 1);
  if (!committed) throw new Error('No se pudo obtener el número de retiro.');
  return snapshot.val();
};

/** Trae y deduplica (por id de turno) los turnos de varias fechas, reusando fetchShiftsForDate. */
const fetchTurnosEnRango = async (fechas) => {
  const listas = await Promise.all(fechas.map((fecha) => fetchShiftsForDate(fecha)));
  const vistos = new Set();
  const turnos = [];
  for (const lista of listas) {
    for (const turno of lista) {
      const key = String(turno.id);
      if (vistos.has(key)) continue;
      vistos.add(key);
      turnos.push(turno);
    }
  }
  return turnos;
};

const fetchClavesYaReclamadas = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const API_URL = getFirebaseUrl();
  const response = await fetch(`${API_URL}/${LOCAL_ID}/${TIRADAS_CLAIM_PATH}.json`);
  if (!response.ok) return new Set();
  const data = await response.json();
  return new Set(Object.keys(data || {}));
};

/**
 * Calcula el retiro pendiente EN VIVO: desde dónde, hasta ahora, y qué tiradas
 * entran. Se llama tanto para la vista previa del modal como, de nuevo,
 * inmediatamente antes de persistir (protección contra doble click / lag del
 * punto 23 — nunca se persiste sobre una preview vieja).
 */
export const calcularRetiroPendiente = async () => {
  checkLocalId();
  const habilitadoDesde = await getRetiroEfectivoHabilitadoDesde();
  if (!habilitadoDesde) {
    throw new Error('El Retiro de Efectivo todavía no está habilitado para este local.');
  }

  const ultimoRetiro = await getUltimoRetiroEfectivo();
  const desdeISO = ultimoRetiro?.hastaTimestamp || habilitadoDesde;
  const hastaISO = new Date().toISOString();

  const fechas = fechasACubrir(desdeISO, hastaISO);
  const [turnosPorFecha, yaClaimadas, turnoAbierto] = await Promise.all([
    fetchTurnosEnRango(fechas),
    fetchClavesYaReclamadas(),
    checkOpenShift(),
  ]);

  // El turno ABIERTO se suma explícitamente, sin importar su fecha: si lleva
  // más de un día sin cerrarse, sus tiradas más nuevas pueden estar fuera de
  // la ventana [desde-1, hasta] que recorre fechasACubrir (que solo tolera un
  // cruce de medianoche, igual que el resto de Caja). Así nunca depende de
  // cuánto tiempo lleve abierto el turno actual ni de qué fecha esté
  // seleccionada en pantalla — ver conTurnoAbiertoIncluido().
  const turnos = conTurnoAbiertoIncluido(turnosPorFecha, turnoAbierto);

  const { candidatas, total, cantidad } = seleccionarTiradasPendientes(turnos, { desdeISO, hastaISO, yaClaimadas });
  return { desdeISO, hastaISO, candidatas, total, cantidad };
};

/**
 * Confirma un Retiro de Efectivo: re-valida el rol, vuelve a calcular las
 * tiradas pendientes (no confía en la preview que el modal mostró antes),
 * revalida contra el índice de reclamos justo antes de escribir, y persiste
 * TODO en una sola escritura multi-ruta atómica (el retiro + cada clave de
 * tirada reclamada). Nunca toca CAJAFUERTE, gastos, ventas ni ningún cálculo
 * existente de la pantalla CAJAS.
 *
 * @param {object} params
 * @param {object} params.user     usuario de sesión (useAuth)
 * @param {string} params.rolReal  rol re-leído (ver lib/rolReal.js) — el que
 *   realmente autoriza la acción, no el de sessionStorage.
 * @returns {Promise<{sinTiradas:true}|{retiro:object}>}
 */
export const confirmarRetiroEfectivo = async ({ user, rolReal }) => {
  checkLocalId();
  if (!esRolAutorizadoRetiroEfectivo(rolReal ?? user?.rol)) {
    throw new Error('No tenés permisos para realizar un Retiro de Efectivo.');
  }

  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();

  const pendiente = await calcularRetiroPendiente();
  if (pendiente.cantidad === 0) {
    return { sinTiradas: true };
  }

  // Revalida el índice de reclamos justo antes de escribir: si otra sesión
  // (u otro click) ya se llevó alguna de estas tiradas mientras se calculaba,
  // se aborta acá — no se generan retiros parciales ni duplicados.
  const freshDb = op.getDatabaseOrAbort();
  const claimSnap = await get(ref(freshDb, `${LOCAL_ID}/${TIRADAS_CLAIM_PATH}`));
  const yaClaimadas = claimSnap.exists() ? claimSnap.val() : {};
  const colision = pendiente.candidatas.find((c) => yaClaimadas[c.key]);
  if (colision) {
    throw new Error('Alguna de las tiradas ya fue incluida en otro retiro. Volvé a intentar.');
  }

  const retiroId = await getNextRetiroId(op.getDatabaseOrAbort(), LOCAL_ID);

  const now = new Date();
  const responsable = {
    userId: user?.id ?? user?.usuario ?? null,
    usuario: user?.usuario ?? null,
    nombre: String(user?.nombre || user?.usuario || '').trim(),
    rol: rolReal ?? user?.rol ?? null,
  };

  const tiradasMap = {};
  pendiente.candidatas.forEach((c) => {
    tiradasMap[c.key] = {
      turnoId: c.turnoId,
      entryId: c.entryId,
      valor: c.valor,
      responsableTirada: c.responsableTirada,
      fecha: c.fecha,
      hora: c.hora,
      timestamp: c.timestamp,
    };
  });

  const retiro = {
    retiroId,
    localId: LOCAL_ID,
    timestamp: now.toISOString(),
    fecha: format(now, 'dd-MM-yyyy'),
    hora: format(now, 'HH:mm:ss'),
    desdeTimestamp: pendiente.desdeISO,
    hastaTimestamp: pendiente.hastaISO,
    responsable,
    cantidadTiradas: pendiente.cantidad,
    totalTiradas: pendiente.total,
    tiradas: tiradasMap,
  };

  const updates = {};
  updates[`${LOCAL_ID}/${RETIROS_PATH}/${retiroId}`] = retiro;
  pendiente.candidatas.forEach((c) => {
    updates[`${LOCAL_ID}/${TIRADAS_CLAIM_PATH}/${c.key}`] = String(retiroId);
  });

  await update(ref(op.getDatabaseOrAbort()), updates);

  return { retiro };
};
