// ---------------------------------------------------------------------------
// MEDIOS DE PAGO DE MOSTRADOR — según la PLATAFORMA de los artículos del carrito
//
// Regla de negocio: una venta de Mostrador NUNCA mezcla plataformas. Es
// PEDIDOSYA, RAPPI, M.LIBRE o una venta común — nunca una combinación entre
// ellas. La plataforma se determina por el DEPARTAMENTO real de los artículos
// del carrito (reutilizando la normalización de `departamentosCanonicos.js`:
// tolera "PEDIDOS YA"/"PedidosYa", "M LIBRE"/"Mercado Libre", etc.) — NUNCA
// por el medio de pago. El medio de pago es la CONSECUENCIA de la plataforma,
// no la causa.
//
// Las etiquetas de prepago ("PREPAGO PEDIDOSYA", "PREPAGO RAPPI",
// "PREPAGO M.LIBRE") son exactamente las que ya usan Reportes Prepago y DLV
// Consultas (`ETIQUETA_PREPAGO` de `ventasPorDepartamento.js`) — se reutilizan
// tal cual para no cambiar el formato guardado en `venta.payments`.
//
// Módulo puro: sin Firebase, sin React, sin DOM.
// ---------------------------------------------------------------------------

import { normalizarNombreDepartamento, CLAVES_CANONICAS } from './departamentosCanonicos.js';
import { ETIQUETA_PREPAGO } from './ventasPorDepartamento.js';
import { normalizarPlataforma } from './ventasApps.js';

export { ETIQUETA_PREPAGO };

const MEDIO_EFECTIVO = 'Efectivo';

// BUG REAL encontrado en producción (no hipotético): "PREPAGO PEDIDOSYA",
// "PREPAGO RAPPI" y "PREPAGO MPAGO" NO son etiquetas inventadas por esta
// feature — son CUENTAS reales ya configuradas en /{localId}/CUENTAS desde
// antes (así funcionaba el sistema viejo de Reportes Prepago, que clasificaba
// por medio de pago). `fetchAccounts()` las trae siempre, para CUALQUIER
// venta, junto con Transferencia/Débito/etc. Si no se las excluye a propósito
// de la lista "normal" del local, una venta COMÚN las sigue mostrando aunque
// esta feature nunca las haya agregado — se reutiliza `normalizarPlataforma()`
// (ya tolera "PREPAGO MPAGO"/"PREPAGO M.PAGO"/"PREPAGO M.LIBRE" como la misma
// plataforma) para sacarlas del listado de una venta común, sea cual sea su
// ortografía real en cada local.
export const filtrarPrepagosDePlataforma = (medios) => (medios || []).filter((m) => !normalizarPlataforma(m));

/**
 * Claves de plataforma (única cada una) presentes en el carrito, a partir del
 * departamento real de cada línea — nunca del medio de pago.
 *
 * @param {Array<{departamentoNombre?: string|null}>} items  líneas del carrito,
 *        cada una con el NOMBRE del departamento de su artículo (lo resuelve
 *        el caller, que ya tiene el catálogo en memoria).
 * @returns {string[]} 0, 1, o más de 1 clave (más de 1 = estado inconsistente).
 */
export function detectarClavesDePlataforma(items) {
  const claves = new Set();
  for (const item of (items || [])) {
    const clave = normalizarNombreDepartamento(item?.departamentoNombre);
    if (clave && CLAVES_CANONICAS.includes(clave)) claves.add(clave);
  }
  return [...claves];
}

/**
 * Evalúa la plataforma del carrito y decide:
 *   - qué medios de pago corresponde ofrecer al cobrar, y
 *   - si el carrito está en un estado inválido que debe BLOQUEAR la
 *     confirmación de la venta (artículos de dos plataformas distintas en el
 *     mismo carrito — no puede pasar por diseño comercial, pero se protege
 *     igual ante un error de datos).
 *
 * Venta común (ningún artículo de plataforma): se ofrecen los medios
 * normales del local (`mediosBase`), sin ningún PREPAGO de plataforma.
 * Venta de plataforma (todos los artículos con plataforma resuelven a la
 * MISMA clave): se ofrece únicamente Efectivo + el prepago de ESA plataforma
 * — nunca los de las otras dos, nunca los medios electrónicos normales.
 *
 * @param {Array} items          líneas del carrito con `departamentoNombre`
 * @param {string[]} mediosBase  medios de pago normales del local (venta común)
 */
export function evaluarPlataformaDeCarrito(items, mediosBase = []) {
  const claves = detectarClavesDePlataforma(items);

  if (claves.length > 1) {
    const nombres = claves.map((c) => ETIQUETA_PREPAGO[c].replace('PREPAGO ', '')).join(' y ');
    return {
      clave: null,
      medios: [],
      bloquear: true,
      titulo: 'Venta con plataformas mezcladas',
      mensaje: `Este carrito tiene artículos de más de una plataforma (${nombres}). Una venta no puede pertenecer a dos plataformas a la vez: separá los artículos en carritos distintos antes de cobrar.`,
    };
  }

  const [clave = null] = claves;
  if (!clave) {
    // Venta común: fuera cualquier PREPAGO de plataforma que ya viniera
    // mezclado en los medios normales del local (ver nota de la constante).
    return { clave: null, medios: filtrarPrepagosDePlataforma(mediosBase), bloquear: false, titulo: null, mensaje: null };
  }

  return {
    clave,
    medios: [MEDIO_EFECTIVO, ETIQUETA_PREPAGO[clave]],
    bloquear: false,
    titulo: null,
    mensaje: null,
  };
}

/**
 * Para una venta COMÚN (sin plataforma), restringe los medios ya sin PREPAGO
 * de plataforma (`mediosComunes`) a lo que los departamentos REALES del
 * carrito permiten — reglas `permiteVentaEfectivo`/`permiteVentaElectronica`
 * ya configuradas por departamento en Firebase:
 *   - TODOS los departamentos aceptan efectivo y NINGUNO electrónico → sólo Efectivo.
 *   - NINGUNO acepta efectivo y TODOS electrónico → todo menos Efectivo.
 *   - cualquier otra combinación (aceptan ambos, o mezcla entre departamentos
 *     distintos del carrito) → `mediosComunes` tal cual, sin restringir más.
 *
 * `departamentos` deben ser los objetos REALES (con esos dos flags), no sólo
 * el nombre — a diferencia de `evaluarPlataformaDeCarrito`, que sólo necesita
 * el nombre para detectar la plataforma.
 */
export function restringirMediosPorDepartamentosComunes(departamentos, mediosComunes) {
  if (!departamentos || !departamentos.length) return mediosComunes;
  const todosEfectivo = departamentos.every((d) => d?.permiteVentaEfectivo === true);
  const todosElectronico = departamentos.every((d) => d?.permiteVentaElectronica === true);
  if (todosEfectivo && !todosElectronico) return [MEDIO_EFECTIVO];
  if (!todosEfectivo && todosElectronico) return (mediosComunes || []).filter((m) => m !== MEDIO_EFECTIVO);
  return mediosComunes;
}

const SALDO_PENDIENTE_EPSILON = 0.009; // misma tolerancia que ya usaba CounterPaymentModal.jsx

/**
 * ¿Ya hay un pago en Efectivo registrado (algo se cobró) Y todavía queda
 * saldo pendiente? Es la condición que, en una venta COMÚN, habilita el
 * resto de las cuentas normales del local para completar la diferencia —
 * sin esto, un departamento efectivo-only (ej. PROMO EFECTIVO) dejaría al
 * cajero sin forma de cobrar el saldo restante con otro medio.
 *
 * @param {{payments?: Array<{method?: string, amount?: number}>, remainingBalance?: number}} estadoPago
 */
export function hayPagoParcialEnEfectivoConSaldoPendiente(estadoPago) {
  if (!estadoPago) return false;
  const { payments, remainingBalance } = estadoPago;
  const hayEfectivo = (payments || []).some((p) => p?.method === MEDIO_EFECTIVO && Number(p?.amount) > 0);
  return hayEfectivo && Number(remainingBalance) > SALDO_PENDIENTE_EPSILON;
}

/**
 * ÚNICA función que hace falta llamar desde una pantalla de cobro (Mostrador
 * o Delivery) para saber qué medios de pago ofrecer. Combina, en este orden:
 *   1. `evaluarPlataformaDeCarrito` — plataforma (PEDIDOSYA/RAPPI/M.LIBRE) o
 *      común, y el bloqueo por plataformas mezcladas. Esto NUNCA cambia por
 *      un pago parcial: un pago dividido de PEDIDOSYA/RAPPI/M.LIBRE sigue
 *      limitado a sus 2 opciones (Efectivo + su propio prepago).
 *   2. Si es común SIN pago parcial en efectivo: `restringirMediosPorDepartamentosComunes`
 *      — respeta los flags reales del departamento (ej. efectivo-only).
 *   3. Si es común Y ya hay un pago en Efectivo con saldo pendiente
 *      (`estadoPago`): se habilitan TODAS las cuentas normales del local
 *      para completar la diferencia — sin la restricción del paso 2, pero
 *      siempre sin ningún PREPAGO de plataforma (reutiliza
 *      `filtrarPrepagosDePlataforma`, ninguna comparación nueva).
 *
 * Existe para que DOS pantallas distintas (NewOrderModal/ConfirmOrderModal
 * para Delivery, CounterPaymentModal para Mostrador) nunca puedan terminar
 * mostrando algo distinto: las dos llaman a ESTA función con los mismos
 * departamentos del carrito, nunca arman su propia lista.
 *
 * @param {Array<{nombre?: string, permiteVentaEfectivo?: boolean, permiteVentaElectronica?: boolean}>} departamentosDelCarrito
 *        el departamento REAL (objeto completo, uno por línea del carrito —
 *        pueden repetirse) — nunca sólo el id ni sólo el nombre.
 * @param {string[]} mediosBase  medios de pago normales configurados en el
 *        local (incluye 'Efectivo' + cuentas electrónicas; puede traer
 *        también cuentas de prepago histórico — se excluyen solas).
 * @param {{payments?: Array, remainingBalance?: number}|null} [estadoPago]
 *        estado del pago en curso (sólo importa para ventas comunes con pago
 *        dividido — ej. CounterPaymentModal.jsx). Omitir en pantallas sin
 *        pago dividido (ej. NewOrderModal.jsx) preserva el comportamiento
 *        anterior tal cual.
 */
export function resolverMediosDePago(departamentosDelCarrito, mediosBase = [], estadoPago = null) {
  const items = (departamentosDelCarrito || []).map((d) => ({ departamentoNombre: d?.nombre }));
  const evaluacion = evaluarPlataformaDeCarrito(items, mediosBase);
  if (evaluacion.clave || evaluacion.bloquear) return evaluacion;

  if (hayPagoParcialEnEfectivoConSaldoPendiente(estadoPago)) {
    return { ...evaluacion, medios: filtrarPrepagosDePlataforma(mediosBase) };
  }

  return { ...evaluacion, medios: restringirMediosPorDepartamentosComunes(departamentosDelCarrito, evaluacion.medios) };
}
