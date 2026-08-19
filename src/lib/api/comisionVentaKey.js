// ---------------------------------------------------------------------------
// IDENTIDAD CANÓNICA DE UNA VENTA PARA COMISIONES.
//
// MOSTRADOR y DELIVERY numeran con contadores SEPARADOS
// (CONTADORES/mostrador y CONTADORES/pedidos), los dos desde 1. Durante
// mucho tiempo eso no se notó porque los rangos iban desfasados, pero se
// cruzan: en Il Capo el contador de delivery alcanzó al de mostrador en el
// número 744 y, desde entonces, cada pedido de delivery encuentra la clave
// `COMISIONES/REGISTRO/{id}` ya ocupada por una venta de mostrador. La
// deduplicación de `registrarComision` lo interpreta como duplicado y
// DESCARTA la comisión en silencio: 182 pedidos hasta la fecha de esta
// auditoría. Burano está a ~39 pedidos de empezar a hacer lo mismo.
//
// La clave deja de ser el número pelado y pasa a ser el número CON su canal:
//
//     mostrador 123  ->  M123
//     delivery  123  ->  D123
//
// Son dos ventas distintas y ahora ocupan dos claves distintas.
//
// COEXISTENCIA: los registros anteriores siguen con su clave numérica y NO se
// renombran. Por eso las búsquedas miran primero la clave canónica y, si no
// está, la clave legada — pero SOLO si su canal coincide, que es justamente lo
// que evita cancelar la comisión del canal equivocado.
//
// Módulo PURO: sin Firebase, sin React. Se prueba sin navegador.
// ---------------------------------------------------------------------------

/** Prefijo de clave por canal. */
export const PREFIJO_CANAL = Object.freeze({ mostrador: 'M', delivery: 'D' });

/**
 * Canal normalizado. Se conserva EXACTAMENTE el criterio que ya usaba
 * `saveSaleToAccountSummary`: 'mostrador' es mostrador y cualquier otra cosa
 * es delivery. No se cambia la clasificación de ninguna venta existente.
 */
export const canalDeModoVenta = (modoVenta) =>
  String(modoVenta ?? '').trim().toLowerCase() === 'mostrador' ? 'mostrador' : 'delivery';

/** Clave canónica de una venta: `M{id}` o `D{id}`. */
export const claveDeVenta = (modoVenta, idVenta) =>
  `${PREFIJO_CANAL[canalDeModoVenta(modoVenta)]}${String(idVenta)}`;

/** ¿Es una clave del esquema nuevo? */
export const esClaveCanonica = (clave) => /^[MD]\d+$/.test(String(clave ?? ''));

/** Clave legada (esquema viejo): el número pelado. */
export const claveLegada = (idVenta) => String(idVenta);

/**
 * ¿Este registro pertenece al canal indicado?
 *
 * Se mira `canal` (registros nuevos) y, si no está, `modoVenta` (registros
 * viejos). Es la comprobación que impide que una anulación de delivery #744
 * cancele la comisión de la venta de mostrador #744, que es exactamente el
 * daño que produjo la colisión.
 */
export const registroEsDelCanal = (registro, modoVenta) => {
  if (!registro) return false;
  return canalDeModoVenta(registro.canal ?? registro.modoVenta) === canalDeModoVenta(modoVenta);
};

/**
 * Campos de identidad que se guardan EXPLÍCITAMENTE en cada registro nuevo.
 * La clave es la identidad técnica; estos campos existen para que ninguna
 * lógica futura tenga que deducir el canal de la primera letra de la clave.
 */
export const identidadDeVenta = (modoVenta, idVenta) => {
  const canal = canalDeModoVenta(modoVenta);
  return { idVenta: String(idVenta), canal, ventaKey: claveDeVenta(canal, idVenta) };
};
