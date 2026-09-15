// Módulo PURO: sin Firebase, sin imports. Se prueba directo con node:assert
// (mismo criterio que lib/print/paper.js y lib/roleUtils.js). La parte que sí
// habla con Firebase (leer turnos, persistir el retiro) vive en
// retiroEfectivo.js, que importa estas funciones.

/** Clave canónica de una tirada, única en todo el local (el id de CAJAFUERTE es solo por turno). */
export const claveDeTirada = (turnoId, entryId) => `${turnoId}_${entryId}`;

/**
 * Fechas (calendario) a revisar para cubrir el rango [desdeISO, hastaISO].
 * Se agrega un día de tolerancia hacia atrás porque un turno guarda su fecha
 * de apertura ("fechaCaja") como bucket del día en que arrancó, y una tirada
 * real puede haber ocurrido ya entrada la madrugada del día siguiente bajo ESE
 * mismo turno — el mismo criterio de tolerancia ±1 día que ya usan
 * fetchHistoricalCashData/fetchSalesForShift para el cruce de medianoche.
 */
export const fechasACubrir = (desdeISO, hastaISO) => {
  const desde = new Date(desdeISO);
  const hasta = new Date(hastaISO);
  if (isNaN(desde) || isNaN(hasta)) return [];

  const inicio = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  inicio.setDate(inicio.getDate() - 1);
  const fin = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());

  const fechas = [];
  const cursor = new Date(inicio);
  // Tope de seguridad: nunca recorrer más de un año de fechas por un bug de
  // timestamps invertidos o corruptos.
  let guard = 0;
  while (cursor <= fin && guard < 370) {
    fechas.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return fechas;
};

/**
 * Agrega el turno actualmente ABIERTO a la lista de turnos ya leídos por
 * fecha, si todavía no estaba (evita duplicarlo cuando su fecha SÍ cayó
 * dentro del rango escaneado).
 *
 * Por qué hace falta: un turno abierto guarda sus tiradas bajo la fecha en la
 * que ABRIÓ (turno.date), no bajo "hoy". Si ese turno lleva más de un día
 * abierto (nunca se cerró), esa fecha puede quedar afuera de la ventana que
 * recorre `fechasACubrir` (que solo tolera 1 día de margen, el mismo criterio
 * que ya usa el resto de Caja para el cruce de medianoche). Sumar el turno
 * abierto de forma explícita —sin importar su fecha— es la única forma de
 * garantizar que NINGUNA tirada pendiente en el turno vivo quede afuera del
 * retiro, sin depender de cuánto tiempo lleve abierto.
 */
export const conTurnoAbiertoIncluido = (turnos, turnoAbierto) => {
  if (!turnoAbierto) return turnos || [];
  const lista = turnos || [];
  const yaEsta = lista.some((t) => String(t?.id) === String(turnoAbierto.id));
  return yaEsta ? lista : [...lista, turnoAbierto];
};

/**
 * Selección PURA de tiradas candidatas a partir de una lista de turnos ya
 * leídos (cada uno con su `id` y su `CAJAFUERTE`), un rango [desdeISO, hastaISO]
 * y el set de claves ya reclamadas por retiros anteriores.
 *
 * Reglas (ver auditoría / especificación del Retiro de Efectivo):
 *   - Una tirada SIN campo `timestamp` es, por construcción, anterior a la
 *     habilitación de esta funcionalidad (el campo se agrega recién con esta
 *     versión) → se excluye SIEMPRE, nunca se intenta reconstruir desde
 *     fecha+hora. Mejor excluir de más que arrastrar una tirada histórica.
 *   - `desdeISO` es EXCLUSIVO (una tirada ya usada como límite superior de un
 *     retiro anterior no vuelve a aparecer) y `hastaISO` es INCLUSIVO.
 *   - Cualquier clave ya presente en `yaClaimadas` se excluye, más allá de la
 *     fecha — es la garantía adicional contra duplicados del punto 10.
 *   - El resultado queda ordenado de la más antigua a la más nueva.
 */
export const seleccionarTiradasPendientes = (turnos, { desdeISO, hastaISO, yaClaimadas }) => {
  const desdeMs = new Date(desdeISO).getTime();
  const hastaMs = new Date(hastaISO).getTime();
  const claimadas = yaClaimadas instanceof Set ? yaClaimadas : new Set(yaClaimadas || []);

  const candidatas = [];
  for (const turno of turnos || []) {
    const entries = turno?.CAJAFUERTE;
    if (!entries) continue;
    for (const [entryId, entry] of Object.entries(entries)) {
      if (!entry || !entry.timestamp) continue;
      const ts = new Date(entry.timestamp).getTime();
      if (isNaN(ts) || ts <= desdeMs || ts > hastaMs) continue;

      const key = claveDeTirada(turno.id, entryId);
      if (claimadas.has(key)) continue;

      candidatas.push({
        key,
        turnoId: turno.id,
        entryId,
        turnoNumero: turno.id,
        valor: Number(entry.valor) || 0,
        responsableTirada: entry.responsable || '',
        fecha: entry.fecha || turno.date || '',
        hora: entry.hora || '',
        timestamp: entry.timestamp,
      });
    }
  }

  candidatas.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const total = candidatas.reduce((sum, c) => sum + c.valor, 0);
  return { candidatas, total, cantidad: candidatas.length };
};
