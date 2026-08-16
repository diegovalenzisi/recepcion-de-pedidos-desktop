// ---------------------------------------------------------------------------
// CLAVES SEGURAS PARA EL CIERRE DE CAJA.
//
// El 16/08/2026 el turno 103 de Achaval quedó cerrado a la mitad: los 117
// pedidos ya se habían respaldado y borrado de MOSTRADOR/PEDIDOS, pero el
// backup de la CAJA nunca se escribió y el turno siguió figurando "abierto".
//
// La causa: `closeShift` usaba el NOMBRE DEL MEDIO DE PAGO como clave de
// `cierreTotalesPorPago`, y la cuenta se llamaba "PREPAGO M.PAGO". Realtime
// Database no admite `.` `$` `#` `[` `]` `/` en una clave, así que el `set()`
// lanzó de forma SÍNCRONA —antes de tocar la red— y el cierre murió justo
// después del único paso destructivo.
//
// El nombre de una cuenta lo escribe una persona en un campo libre. Mañana
// puede ser "TRANSF. 6" o "BANCO #2". Por eso acá hay DOS defensas y no una:
//
//   1. SANEAR  — la clave se construye sin caracteres prohibidos, siempre.
//   2. VALIDAR — antes de mover un solo pedido se recorre el payload entero
//                y, si quedara una clave imposible, se aborta ahí mismo.
//
// La segunda existe porque la primera podría dejar de cubrir algún camino
// nuevo: un cierre NUNCA debe volver a fallar después de haber borrado datos.
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Se puede probar sin navegador.
// ---------------------------------------------------------------------------

/** Caracteres que Realtime Database rechaza en una clave. */
const PROHIBIDOS = '.$#[]/';

// Dos regex distintas a propósito: una global para `replace` y otra sin flag
// para `test`. Una regex /g/ mantiene `lastIndex` entre llamadas a `.test()` y
// devolvería resultados alternados — un bug clásico y muy difícil de ver.
const PROHIBIDOS_REEMPLAZO = /[.$#[\]/]/g;
const PROHIBIDOS_PRUEBA = /[.$#[\]/]/;

/** Etiqueta de reemplazo cuando un nombre queda vacío después de sanear. */
export const CLAVE_SIN_NOMBRE = 'SIN MEDIO DE PAGO';

/** ¿Esta cadena sirve como clave de Realtime Database? */
export const esClaveValidaRTDB = (clave) =>
  typeof clave === 'string' && clave.length > 0 && !PROHIBIDOS_PRUEBA.test(clave);

/**
 * Nombre convertido en una clave que Realtime Database acepta.
 *
 * Se QUITAN los caracteres prohibidos, no se reemplazan por otro símbolo: es
 * el mismo criterio que `claveDePrepago` en prepaymentApi.js, así "PREPAGO
 * M.PAGO" y "PREPAGO MPAGO" producen exactamente la misma clave y el histórico
 * no se parte en dos.
 *
 * Para "Efectivo", "Transferencia" y compañía es un NO-OP: siguen dando el
 * mismo texto byte a byte que antes de este módulo.
 */
export const claveSeguraRTDB = (valor) => {
  const limpia = String(valor ?? '').replace(PROHIBIDOS_REEMPLAZO, '').trim();
  return limpia || CLAVE_SIN_NOMBRE;
};

/**
 * Totales por medio de pago, con las claves ya saneadas.
 *
 * Es exactamente el `reduce` que vivía dentro de `closeShift`, extraído para
 * poder probarlo: mismo resultado para los nombres de siempre, y ahora también
 * para los que traen caracteres prohibidos.
 */
export const totalesPorMedioDePago = (sales) =>
  (sales || []).reduce((acc, sale) => {
    (sale?.payments || []).forEach((payment) => {
      if (!payment) return;
      const clave = claveSeguraRTDB(payment.method);
      acc[clave] = (acc[clave] || 0) + (Number(payment.amount) || 0);
    });
    return acc;
  }, {});

/**
 * Recorre un valor entero y devuelve la RUTA de cada clave que Realtime
 * Database rechazaría. Devuelve [] si el payload es escribible.
 *
 * Recorre en profundidad, incluyendo arrays, porque una clave imposible a
 * cualquier nivel hace fallar el `set()` completo, no solo esa rama.
 */
export function clavesInvalidasDe(valor, ruta = '') {
  if (valor === null || typeof valor !== 'object') return [];

  if (Array.isArray(valor)) {
    return valor.flatMap((el, i) => clavesInvalidasDe(el, `${ruta}[${i}]`));
  }

  const malas = [];
  for (const [clave, hijo] of Object.entries(valor)) {
    const aqui = ruta ? `${ruta}.${clave}` : clave;
    if (!esClaveValidaRTDB(clave)) malas.push(aqui);
    malas.push(...clavesInvalidasDe(hijo, aqui));
  }
  return malas;
}

/**
 * Error del cierre que NO llegó a tocar nada. Lleva en `message` un texto
 * listo para mostrarle al operador, y en `claves` el detalle para el log.
 */
export class CierreInvalidoError extends Error {
  constructor(claves) {
    super(
      'Los datos del cierre no se pueden guardar: ' +
      `${claves.length === 1 ? 'la clave' : 'las claves'} ${claves.map((c) => `"${c}"`).join(', ')} ` +
      `${claves.length === 1 ? 'tiene' : 'tienen'} caracteres que la base no admite (${PROHIBIDOS.split('').join(' ')}). ` +
      'Revisá el nombre de las cuentas en Cuentas.'
    );
    this.name = 'CierreInvalidoError';
    this.claves = claves;
    // Lo lee CloseShiftModal para avisar que NO se movió ningún pedido.
    this.pedidosYaMovidos = false;
    this.faseCierre = 'validacion';
  }
}

/**
 * Valida el payload del cierre. Lanza `CierreInvalidoError` si algo no se
 * podría escribir.
 *
 * Se llama ANTES de respaldar y limpiar los pedidos. Ese orden es el punto
 * central de todo este módulo: el paso destructivo no puede volver a correr
 * antes que el que verifica.
 */
export function validarPayloadDeCierre(payload) {
  const invalidas = clavesInvalidasDe(payload);
  if (invalidas.length > 0) throw new CierreInvalidoError(invalidas);
  return true;
}
