// ---------------------------------------------------------------------------
// FACTURA o REMITO — LA DECISIÓN
//
// Una venta genera UN SOLO comprobante POR EL TOTAL COMPLETO: o una factura, o
// un remito FCX. Nunca las dos cosas, nunca uno por cada medio de pago, nunca
// por un importe parcial.
//
// LA FÓRMULA (única, para Mostrador y Delivery, en Desktop y Tablet):
//
//     tildeManualActivo  = venta.emiteFactura === true
//     algunaCuentaFactura = pagos.some(p => cuentaUsada(p)?.imprimeFactura === true)
//     debeFacturarse      = tildeManualActivo || algunaCuentaFactura
//
//   debeFacturarse === true   → UNA factura por el total. Ningún FCX.
//   debeFacturarse === false  → UN FCX por el total. Nada a facturación.
//
// El interruptor real, el que ya guarda el formulario de Cuentas, se llama
//
//     imprimeFactura            en  /{localId}/CUENTAS/{cta-N}/imprimeFactura
//
// La DECISIÓN no mira NUNCA el nombre del medio de pago: "Transferencia",
// "Transferencia 2", "Mercado Pago", "DNI", "PedidosYa" o cualquier cuenta
// futura se comportan igual, según SU interruptor.
//
// CUENTA DE COBRO ≠ CUENTA FISCAL
// -------------------------------
// Una cuenta de cobro sólo dice a dónde entra la plata. Con `imprimeFactura` en
// false NO factura, y por lo tanto NO necesita CUIT, punto de venta,
// certificado, runtime ni cola: sus ventas son remitos y eso es correcto, no un
// error de configuración. Es el caso de "Transferencia 2" en varios locales: el
// dinero se transfiere a esa persona y esas operaciones no se facturan.
//
// Ser la cuenta FAVORITA tampoco obliga a facturar. La favorita es la preferida
// para COBRAR; sólo se usa para emitir si además tiene el interruptor encendido
// (ver elegirCuentaFiscalParaTildeManual).
//
// (El nombre sí se usa, más abajo, para saber a qué COLA del motor AFIP entra
// una venta que YA se decidió facturar. Eso es enrutamiento a un CUIT/punto de
// venta, no la decisión, y va por coincidencia EXACTA — ver COLAS_POR_CUENTA.)
//
// CAMPO AUSENTE: si una cuenta no tiene `imprimeFactura` guardado —o el medio de
// pago no es una cuenta, como "Efectivo"— se toma FALSE. Es el comportamiento
// histórico exacto: hasta hoy la única forma de facturar era el tilde manual, y
// sin tilde la venta terminaba en remito. Ver IMPRIME_FACTURA_POR_DEFECTO.
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// La lectura de /{localId}/CUENTAS vive en facturaORemitoApi.js.
// ---------------------------------------------------------------------------

import { listarPagos, totalDeVenta } from './remitos.js';

/** Nombre EXACTO del interruptor tal como lo guarda el formulario de Cuentas. */
export const CAMPO_IMPRIME_FACTURA = 'imprimeFactura';

/**
 * Qué se asume cuando la cuenta no tiene el campo guardado (o no hay cuenta,
 * como pasa con "Efectivo"). FALSE = comportamiento histórico: sin tilde manual
 * la venta no se facturaba. No se cambia sin decirlo.
 */
export const IMPRIME_FACTURA_POR_DEFECTO = false;

export const COMPROBANTE_FACTURA = 'FACTURA';
export const COMPROBANTE_REMITO = 'REMITO';

/**
 * A QUÉ COLA del motor AFIP entra una venta YA decidida como factura. Cada
 * FACTURACION_N es un CUIT / punto de venta distinto configurado en el manager
 * de facturación. Esto NO decide si se factura.
 *
 * Coincidencia EXACTA sobre el nombre normalizado: "Transferencia 2" jamás cae
 * en la cola de "Transferencia".
 */
export const COLAS_POR_CUENTA = Object.freeze({
  // Las transferencias ocupan 1–5…
  'TRANSFERENCIA': 'FACTURACION_1',
  'TRANSFERENCIA 2': 'FACTURACION_2',
  'TRANSFERENCIA 3': 'FACTURACION_3',
  'TRANSFERENCIA 4': 'FACTURACION_4',
  'TRANSFERENCIA 5': 'FACTURACION_5',
  // …y los medios bancarios/digitales 6–9.
  'MERCADO PAGO': 'FACTURACION_6',
  'CUENTA DNI': 'FACTURACION_7',
  'BANCO 1': 'FACTURACION_8',
  'BANCO 2': 'FACTURACION_9',
  // PEDIDOSYA y RAPPI NO figuran acá a propósito: no tienen cola propia. Su
  // cola sale de la Transferencia que se les configura como cuenta asociada
  // (`cuentaFacturacionAsociadaId`). Los mapeos viejos —PedidosYa a
  // FACTURACION_1 y Rappi a FACTURACION_9— quedaron eliminados: mandaban a una
  // cola fija sin mirar la asociación, que es justo lo que no debe pasar.
});

/** Tope deliberado: nueve colas fiscales por local, ni una más. */
export const COLA_FISCAL_VALIDA = /^FACTURACION_[1-9]$/;

/** ¿Es un nombre de cola fiscal válido en este esquema (1..9)? */
export const esColaFiscalValida = (cola) => COLA_FISCAL_VALIDA.test(String(cola ?? ''));

// ---------------------------------------------------------------------------
// REGLA DEFINITIVA POR MEDIO DE PAGO — FUENTE ÚNICA
//
// La cola sale del MEDIO DE PAGO, no de que alguien se acuerde de dejar
// `imprimeFactura` encendido. Un interruptor mal configurado ya cortó la
// facturación de Achaval en silencio; esta regla es la que lo impide.
//
//   Transferencia      → FACTURACION_1
//   Transferencia 2    → FACTURACION_2
//   Transferencia 3    → FACTURACION_3
//   Transferencia 4    → FACTURACION_4
//   Transferencia 5    → FACTURACION_5
//   Mercado Pago       → FACTURACION_6
//   Cuenta DNI         → FACTURACION_7
//   Banco 1            → FACTURACION_8
//   Banco 2            → FACTURACION_9
//   Efectivo           → sin cola (REMITO / Facturación 2)
//   Prepago PedidosYa  → la cola de su CUENTA ASOCIADA (una Transferencia)
//   Prepago Rappi      → la cola de su CUENTA ASOCIADA (una Transferencia)
//
// Nueve colas por local y punto: no existe FACTURACION_10 ni superior.
//
// El ORDEN importa: "Transferencia 5" y "Transferencia 4" se evalúan ANTES que
// la genérica, para que no terminen todas en FACTURACION_1. Además los patrones
// están ANCLADOS (^...$): se compara el nombre COMPLETO ya normalizado, nunca
// por "contiene". Así "Transferencia Mercado Pago" no cae por accidente en la
// cola de "Transferencia".
// ---------------------------------------------------------------------------

/** Estados que identifican una operación anulada. Comparación en minúsculas. */
const ESTADOS_CANCELADA = Object.freeze([
  'cancelada', 'cancelado', 'cancelled', 'canceled', 'anulada', 'anulado',
]);

/**
 * ¿Esta operación puede entrar al flujo fiscal?
 *
 * Barrera CENTRAL, delante de cualquier encolado. Cubre dos casos que nunca
 * deben llegar al motor:
 *
 *   1. CANCELACIÓN. Anular una venta no emite nada: ni nota de crédito, ni una
 *      factura nueva, ni un comprobante por $0. La factura original queda como
 *      fue emitida. (La nota de crédito se hará más adelante.)
 *   2. TOTAL <= 0 o no numérico. Defensa secundaria: una venta sin importe no
 *      se factura. Es lo que dejó registros de $0 trabados en la cola, porque
 *      el motor los rechaza pero no los borra.
 *
 * @returns {{ok: true} | {ok: false, motivo: string, detalle: string}}
 */
export function puedeEntrarAFacturacion(venta, contexto = {}) {
  const estado = String(venta?.estado ?? venta?.status?.main ?? venta?.status ?? '').toLowerCase().trim();

  if (contexto.esCancelacion === true || ESTADOS_CANCELADA.includes(estado)) {
    return {
      ok: false,
      motivo: 'cancelacion',
      detalle: 'Facturación omitida: la operación corresponde a una cancelación.',
    };
  }

  // DÓNDE VIVE EL IMPORTE SEGÚN EL ORIGEN DE LA VENTA.
  //
  // Mostrador y los registros fiscales guardan `total` / `TOTAL` en la raíz,
  // pero un PEDIDO DE DELIVERY no: su importe está SÓLO en `payment.total`.
  // Leer únicamente la raíz daba `undefined` para todo delivery, esta barrera lo
  // tomaba como "total inválido" y la venta se degradaba a remito — con lo cual
  // NINGUNA venta de delivery llegaba a la cola fiscal, cobrada por
  // transferencia o no. Verificado en producción: de 613 pedidos de delivery con
  // transferencia (agosto 2026, los 6 locales con delivery), el 100% no tiene
  // `total` en la raíz.
  //
  // `totalDeVenta` ya resuelve esa cascada (total → payment.total →
  // payment.amount → importe) y es la MISMA que usa el resto del circuito para
  // decidir el importe del comprobante, así que la barrera no puede volver a
  // discrepar con lo que después se factura. `TOTAL` en mayúsculas se consulta
  // aparte porque es la forma de los registros fiscales ya emitidos.
  //
  // Un cero REAL sigue bloqueando: `??` sólo cae cuando el campo es null o
  // undefined, no cuando vale 0.
  const total = Number(venta?.TOTAL ?? totalDeVenta(venta));
  if (!Number.isFinite(total) || total <= 0) {
    return {
      ok: false,
      motivo: 'total-invalido',
      detalle: `Facturación omitida: total inválido o menor/igual a cero (${JSON.stringify(venta?.TOTAL ?? venta?.total ?? venta?.payment?.total)}).`,
    };
  }

  return { ok: true };
}

/** Etiquetas de regla, para el log y para las pruebas. */
export const REGLA = Object.freeze({
  TRANSFERENCIA_5: 'TRANSFERENCIA_5',
  TRANSFERENCIA_4: 'TRANSFERENCIA_4',
  TRANSFERENCIA_3: 'TRANSFERENCIA_3',
  TRANSFERENCIA_2: 'TRANSFERENCIA_2',
  TRANSFERENCIA_1: 'TRANSFERENCIA_1',
  PEDIDOSYA_PREPAGO: 'PEDIDOSYA_PREPAGO',
  RAPPI_PREPAGO: 'RAPPI_PREPAGO',
  EFECTIVO_REMITO: 'EFECTIVO_REMITO',
  SIN_REGLA: 'SIN_REGLA',
});

/** Campo donde la cuenta de plataforma guarda con qué cuenta fiscal factura. */
export const CAMPO_CUENTA_ASOCIADA = 'cuentaFacturacionAsociadaId';

/**
 * Colas que puede resolver la cuenta asociada de una plataforma.
 *
 * SOLO las cinco transferencias. PedidosYa y Rappi se asocian exclusivamente a
 * una Transferencia: no se ofrecen Mercado Pago, Cuenta DNI ni los bancos, que
 * son cuentas de cobro propias y viven en las colas 6–9.
 */
export const COLAS_ASOCIABLES = Object.freeze([
  'FACTURACION_1', 'FACTURACION_2', 'FACTURACION_3', 'FACTURACION_4', 'FACTURACION_5',
]);

/**
 * Clave compacta de un medio de pago: mayúsculas, sin acentos, sin espacios ni
 * signos. "Prepago PedidosYa" y "PREPAGO  PEDIDOS-YA" dan la misma clave.
 * Sirve SÓLO para comparar contra una lista cerrada; nunca para adivinar.
 */
export const normalizarClaveMedioPago = (valor) =>
  String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // saca acentos
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');                        // saca espacios y signos

/**
 * Nombres aceptados para PedidosYa prepago. Lista CERRADA: incluye el error de
 * tipeo "PREDIDOSYA" que quedó guardado en alguna cuenta, con y sin el prefijo
 * "PREPAGO". Nada de coincidencias parciales — "PREPAGO RAPPI" no entra acá.
 */
const CLAVES_PEDIDOSYA = Object.freeze([
  'PREPAGOPEDIDOSYA', 'PREPAGOPREDIDOSYA',
  'PEDIDOSYA', 'PREDIDOSYA',
]);

/** Nombres aceptados para Rappi prepago. Lista CERRADA, igual que PedidosYa. */
const CLAVES_RAPPI = Object.freeze([
  'PREPAGORAPPI', 'RAPPI',
]);

/**
 * Reglas EN ORDEN. La primera que coincide gana.
 *
 * PedidosYa y Rappi prepago NO tienen cola fija ni la sacan del alias del local:
 * cada una guarda en SU PROPIA cuenta con qué cuenta fiscal factura
 * (`cuentaFacturacionAsociadaId`). Quedan marcadas con `requiereCuentaAsociada`
 * y las resuelve `resolverCuentaAsociadaDePlataforma`, acá mismo, sin Firebase.
 */
const REGLAS_MEDIO_PAGO = Object.freeze([
  // De la más específica a la genérica: "Transferencia 5" tiene que resolverse
  // ANTES que "Transferencia", o caerían todas en FACTURACION_1. Los patrones
  // además están anclados (^…$), así que la comparación es contra el nombre
  // completo y no por "contiene".
  { regla: REGLA.TRANSFERENCIA_5, cola: 'FACTURACION_5', prueba: (k) => /^TRANSFERENCIA5$/.test(k) },
  { regla: REGLA.TRANSFERENCIA_4, cola: 'FACTURACION_4', prueba: (k) => /^TRANSFERENCIA4$/.test(k) },
  { regla: REGLA.TRANSFERENCIA_3, cola: 'FACTURACION_3', prueba: (k) => /^TRANSFERENCIA3$/.test(k) },
  { regla: REGLA.TRANSFERENCIA_2, cola: 'FACTURACION_2', prueba: (k) => /^TRANSFERENCIA2$/.test(k) },
  { regla: REGLA.TRANSFERENCIA_1, cola: 'FACTURACION_1', prueba: (k) => /^TRANSFERENCIA1?$/.test(k) },
  { regla: REGLA.PEDIDOSYA_PREPAGO, cola: null, requiereCuentaAsociada: true, prueba: (k) => CLAVES_PEDIDOSYA.includes(k) },
  { regla: REGLA.RAPPI_PREPAGO, cola: null, requiereCuentaAsociada: true, prueba: (k) => CLAVES_RAPPI.includes(k) },
  { regla: REGLA.EFECTIVO_REMITO, cola: null, prueba: (k) => /^EFECTIVO$/.test(k) },
]);

/**
 * ¿Esta cuenta es una plataforma (PedidosYa / Rappi) que factura por una cuenta
 * asociada? Devuelve la regla, o null si no lo es.
 */
export function plataformaDeCuenta(nombre) {
  const clave = normalizarClaveMedioPago(nombre);
  if (CLAVES_PEDIDOSYA.includes(clave)) return REGLA.PEDIDOSYA_PREPAGO;
  if (CLAVES_RAPPI.includes(clave)) return REGLA.RAPPI_PREPAGO;
  return null;
}

/** Nombre legible de la plataforma, para los mensajes de error. */
export function nombreDePlataforma(regla) {
  if (regla === REGLA.PEDIDOSYA_PREPAGO) return 'PedidosYa';
  if (regla === REGLA.RAPPI_PREPAGO) return 'Rappi';
  return 'la plataforma';
}

/**
 * Cola que corresponde a un medio de pago POR SU NOMBRE. Función PURA: nunca
 * consulta Firebase.
 *
 * @param {string} nombreMedioPago
 * @returns {{ cola: string|null, regla: string, requiereCuentaAsociada: boolean }}
 *   cola con valor                     → cola fija, resuelta acá mismo.
 *   requiereCuentaAsociada true        → la define la cuenta asociada de ESA cuenta.
 *   cola null + EFECTIVO_REMITO        → efectivo, no factura NUNCA.
 *   cola null + SIN_REGLA              → sin regla; decide `imprimeFactura`.
 */
export function resolverReglaMedioPago(nombreMedioPago) {
  const clave = normalizarClaveMedioPago(nombreMedioPago);
  const vacia = { cola: null, regla: REGLA.SIN_REGLA, requiereCuentaAsociada: false };
  if (!clave) return vacia;
  for (const r of REGLAS_MEDIO_PAGO) {
    if (r.prueba(clave)) {
      return { cola: r.cola, regla: r.regla, requiereCuentaAsociada: r.requiereCuentaAsociada === true };
    }
  }
  return vacia;
}

/**
 * ¿Es una venta 100% EFECTIVO? Regla fija: siempre REMITO. No pregunta nada, no
 * busca alias, no resuelve cuenta fiscal y no escribe en ninguna FACTURACION_N.
 * Ni `imprimeFactura` ni el tilde manual pueden convertirla en factura.
 */
export function esVentaSoloEfectivo(venta) {
  const pagos = listarPagos(venta);
  if (pagos.length === 0) return false;
  return pagos.every(({ metodo }) => resolverReglaMedioPago(metodo).regla === REGLA.EFECTIVO_REMITO);
}

// ---------------------------------------------------------------------------
// CUENTA DE PLATAFORMA → CUENTA ASOCIADA → COLA
//
// PedidosYa y Rappi no tienen cola propia: cada una guarda en su nodo de
// /{localId}/CUENTAS con qué cuenta fiscal factura, POR ID:
//
//   { nombre: "PREPAGO PEDIDOSYA", cuentaFacturacionAsociadaId: "cta-2" }
//        → cta-2 = "Transferencia 2" → FACTURACION_2
//
// Se guarda el ID y no el nombre para que renombrar la cuenta no rompa el
// vínculo, y no la cola directa para que mover la cuenta a otro CUIT se refleje
// solo. El ALIAS del local NO interviene: eso quedó únicamente para el botón
// manual "Convertir remito en factura".
// ---------------------------------------------------------------------------

/** Entradas [id, cuenta] tanto si viene como mapa de Firebase o como array. */
const entradasDeCuentas = (cuentas) => (
  Array.isArray(cuentas)
    ? cuentas.map((c, i) => [c?.id ?? String(i), c])
    : Object.entries(cuentas || {})
);

/**
 * Cuentas que pueden ELEGIRSE en el desplegable "Cuenta asociada para
 * facturación": las Transferencias (FACTURACION_1 a 5). Se excluyen las cuentas
 * de plataforma (no pueden apuntarse entre ellas ni a sí mismas) y cualquier
 * cuenta que genere remito o no tenga cola.
 *
 * La cantidad de opciones depende de lo que tenga cargado cada local.
 *
 * @returns {Array<{id, nombre, cola}>}
 */
export function cuentasAsociablesParaFacturacion(cuentas) {
  return entradasDeCuentas(cuentas)
    .filter(([, c]) => c && c.nombre && !plataformaDeCuenta(c.nombre))
    .map(([id, c]) => ({ id, nombre: c.nombre, cola: colaFiscalDeCuenta(c.nombre) }))
    .filter((c) => c.cola && COLAS_ASOCIABLES.includes(c.cola));
}

/**
 * ¿La asociación elegida es válida? Se usa en el formulario ANTES de guardar y
 * también al facturar, porque la cuenta puede haber cambiado después.
 *
 * @returns {{ok: true, cuentaId, cuenta, cola} | {ok: false, motivo}}
 */
export function validarAsociacionPlataforma({ plataformaId, asociadaId, cuentas } = {}) {
  const id = String(asociadaId ?? '').trim();
  if (!id) return { ok: false, motivo: 'Seleccioná una cuenta asociada para facturación.' };
  if (plataformaId && id === String(plataformaId)) {
    return { ok: false, motivo: 'Una cuenta de plataforma no puede facturarse a sí misma.' };
  }

  const entrada = entradasDeCuentas(cuentas).find(([k]) => k === id);
  if (!entrada) return { ok: false, motivo: `La cuenta asociada (${id}) no existe o fue eliminada.` };

  const [cuentaId, cuenta] = entrada;
  if (plataformaDeCuenta(cuenta.nombre)) {
    return { ok: false, motivo: `"${cuenta.nombre}" es una cuenta de plataforma: no puede facturar a otra plataforma.` };
  }

  const cola = colaFiscalDeCuenta(cuenta.nombre);
  if (!cola || !COLAS_ASOCIABLES.includes(cola)) {
    return { ok: false, motivo: `"${cuenta.nombre}" no es una Transferencia: las plataformas solo se asocian a Transferencia 1 a 5.` };
  }
  return { ok: true, cuentaId, cuenta: cuenta.nombre, cola };
}

/**
 * Cola con la que factura una venta cobrada por PedidosYa o Rappi.
 *
 * @param {object} params
 * @param {string} params.plataformaId  id de la cuenta de plataforma cobrada
 * @param {object} params.cuentas       /{localId}/CUENTAS
 * @returns {{estado:'ok', cuentaId, cuenta, cola} | {estado:'invalida', motivo}}
 */
export function resolverCuentaAsociadaDePlataforma({ plataformaId, cuentas } = {}) {
  const entrada = entradasDeCuentas(cuentas).find(([k]) => k === String(plataformaId));
  if (!entrada) return { estado: 'invalida', motivo: `La cuenta de plataforma (${plataformaId}) no existe.` };

  const [, plataforma] = entrada;
  const asociadaId = plataforma?.[CAMPO_CUENTA_ASOCIADA];
  const v = validarAsociacionPlataforma({ plataformaId, asociadaId, cuentas });
  return v.ok
    ? { estado: 'ok', cuentaId: v.cuentaId, cuenta: v.cuenta, cola: v.cola }
    : { estado: 'invalida', motivo: v.motivo };
}

// ---------------------------------------------------------------------------
// ALIAS FAVORITO → CUENTA → COLA   (resolución PURA; el dato lo trae la API)
//
// En Firebase, /{localId}/ALIAS es UN SOLO string (el alias que se le dicta al
// cliente para transferir), y cada cuenta de /{localId}/CUENTAS guarda su
// propio campo `alias`. La cuenta asociada es la que tiene ESE alias.
//
// La cola NO sale del TEXTO del alias: sale de la CUENTA a la que pertenece.
// En Bynnon el alias es "MONICA.MP" y resuelve a FACTURACION_2 porque su cuenta
// es "Transferencia 2" — el texto no dice nada de eso, y está bien así.
// ---------------------------------------------------------------------------

// El alias destacado puede apuntar a CUALQUIER cuenta fiscal del esquema (1..9),
// no solo a una Transferencia: es la cuenta con la que el local factura una
// conversión manual desde Facturación 2. Distinto de COLAS_ASOCIABLES, que es
// más restrictivo a propósito porque las plataformas solo se asocian a una
// Transferencia.

/**
 * @param {object} params
 * @param {string} params.alias    contenido de /{localId}/ALIAS
 * @param {object|Array} params.cuentas  /{localId}/CUENTAS
 * @returns {{estado:'ok', alias, cuentaId, cuenta, cola}
 *         | {estado:'sin-alias'|'sin-cuenta'|'alias-ambiguo'|'cuenta-sin-cola', motivo, ...}}
 */
export function resolverCuentaDeAliasFavorito({ alias, cuentas } = {}) {
  const buscado = normalizarNombreCuenta(alias);
  if (!buscado) {
    return { estado: 'sin-alias', motivo: 'El local no tiene un alias favorito cargado en /ALIAS.' };
  }

  const lista = Array.isArray(cuentas)
    ? cuentas.map((c, i) => [c?.id ?? String(i), c])
    : Object.entries(cuentas || {});

  const coinciden = lista.filter(([, c]) => c && normalizarNombreCuenta(c.alias) === buscado);

  if (coinciden.length === 0) {
    return { estado: 'sin-cuenta', alias, motivo: `Ninguna cuenta del local tiene el alias "${alias}".` };
  }
  if (coinciden.length > 1) {
    return {
      estado: 'alias-ambiguo', alias,
      cuentas: coinciden.map(([id, c]) => `${id} (${c.nombre})`),
      motivo: `Hay ${coinciden.length} cuentas con el alias "${alias}": no se puede saber con cuál facturar.`,
    };
  }

  const [cuentaId, cuenta] = coinciden[0];
  const cola = colaFiscalDeCuenta(cuenta.nombre);
  if (!esColaFiscalValida(cola)) {
    return {
      estado: 'cuenta-sin-cola', alias, cuentaId, cuenta: cuenta.nombre, cola: cola || null,
      motivo: `El alias "${alias}" corresponde a la cuenta "${cuenta.nombre}", que no resuelve ninguna cola fiscal (FACTURACION_1 a 9).`,
    };
  }

  return { estado: 'ok', alias, cuentaId, cuenta: cuenta.nombre, cola };
}

/**
 * Normalización de nombres de cuenta: SÓLO mayúsculas/minúsculas, espacios de
 * los extremos y espacios duplicados. Nada de recortes ni de coincidencias
 * parciales.
 */
export const normalizarNombreCuenta = (valor) =>
  String(valor ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/** Cola fiscal de una cuenta, por coincidencia exacta. null si no tiene. */
export function colaFiscalDeCuenta(nombre) {
  const clave = normalizarNombreCuenta(nombre);
  return clave && Object.prototype.hasOwnProperty.call(COLAS_POR_CUENTA, clave)
    ? COLAS_POR_CUENTA[clave]
    : null;
}

/**
 * Valor CRUDO del interruptor de una cuenta.
 * @returns {true|false|null} null = el campo no está guardado (≠ estar en false).
 */
export function leerImprimeFactura(cuenta) {
  if (!cuenta || typeof cuenta !== 'object') return null;
  const v = cuenta[CAMPO_IMPRIME_FACTURA];
  if (v === true || v === 'true' || v === 1) return true;
  if (v === false || v === 'false' || v === 0) return false;
  return null;
}

/**
 * Valor RESUELTO del interruptor: el que se usa para decidir. El campo ausente
 * cae en IMPRIME_FACTURA_POR_DEFECTO en vez de romper la venta.
 */
export function imprimeFacturaResuelto(cuenta) {
  const crudo = leerImprimeFactura(cuenta);
  return crudo === null ? IMPRIME_FACTURA_POR_DEFECTO : crudo;
}

/** Cuentas del local (array o mapa de Firebase) → Map por nombre normalizado. */
export function indexarCuentas(cuentas) {
  const mapa = new Map();
  // Se conserva el ID (la clave de Firebase) junto a la cuenta: es lo que
  // permite resolver `cuentaFacturacionAsociadaId` sin depender del nombre.
  for (const [id, cuenta] of entradasDeCuentas(cuentas)) {
    const nombre = normalizarNombreCuenta(cuenta?.nombre);
    if (nombre) mapa.set(nombre, { ...cuenta, id: cuenta?.id ?? id });
  }
  return mapa;
}

/** La cuenta marcada como favorita del local, si hay alguna. */
export function cuentaFavorita(cuentas) {
  const lista = Array.isArray(cuentas) ? cuentas : Object.values(cuentas || {});
  return lista.find((c) => c && c.isFavorite === true) || null;
}

/**
 * CUENTA DE COBRO ≠ CUENTA FISCAL.
 *
 * Una cuenta de cobro sólo dice a dónde entra la plata. Que sea la FAVORITA no
 * la convierte en una cuenta fiscal: "Transferencia 2" puede ser la favorita del
 * local, recibir el dinero, y tener `imprimeFactura: false` porque esas ventas
 * deliberadamente NO se facturan.
 *
 * CUENTA FISCAL HABILITADA = cuenta de cobro con `imprimeFactura === true`. Sólo
 * ésas pueden emitir una factura, y sólo ésas necesitan CUIT, punto de venta,
 * certificado, runtime y cola.
 */
export function cuentasFiscalesHabilitadas(cuentas) {
  const lista = Array.isArray(cuentas) ? cuentas : Object.values(cuentas || {});
  return lista.filter((c) => leerImprimeFactura(c) === true);
}

/**
 * Qué cuenta FISCAL usar cuando la factura la pide el tilde manual (no hay
 * ninguna cuenta cobrada que facture por sí sola).
 *
 * Se elige SÓLO entre las habilitadas. La favorita del local se usa únicamente
 * si además es fiscal; si no lo es, se ignora —no se factura con una cuenta que
 * el dueño marcó como "no factura"— y se sigue buscando.
 *
 * @returns {{estado:'ok', cuenta: object, criterio: string}
 *         | {estado:'sin-cuenta-fiscal'}
 *         | {estado:'ambiguo', cuentas: string[]}}
 */
export function elegirCuentaFiscalParaTildeManual(cuentas) {
  const habilitadas = cuentasFiscalesHabilitadas(cuentas);
  if (habilitadas.length === 0) return { estado: 'sin-cuenta-fiscal' };

  const favoritaFiscal = habilitadas.find((c) => c.isFavorite === true);
  if (favoritaFiscal) return { estado: 'ok', cuenta: favoritaFiscal, criterio: 'cuenta-fiscal-favorita' };

  // Sin favorita fiscal, una sola habilitada sigue siendo determinista.
  if (habilitadas.length === 1) return { estado: 'ok', cuenta: habilitadas[0], criterio: 'unica-cuenta-fiscal-habilitada' };

  return { estado: 'ambiguo', cuentas: habilitadas.map((c) => c.nombre).filter(Boolean) };
}

/**
 * Decide el comprobante de UNA venta, mire donde mire el formato de los pagos.
 *
 * @param {object}   opciones
 * @param {object}   opciones.venta                la venta / pedido (se leen sus pagos)
 * @param {object|Array} opciones.cuentas          /{localId}/CUENTAS tal cual viene
 * @param {boolean}  [opciones.emiteFacturaManual] el tilde "Emite Factura" de la pantalla
 *
 * @returns {{
 *   comprobante: 'FACTURA'|'REMITO',
 *   debeFacturarse: boolean,
 *   total: number,
 *   motivo: string,
 *   tildeManualActivo: boolean,
 *   algunaCuentaFactura: boolean,
 *   metodos: Array<{metodo: string, importe: number, imprimeFactura: boolean, campoPresente: boolean, cuenta: string|null}>,
 *   cuentasQueFacturan: string[],
 *   metodosSinCampo: string[],
 * }}
 */
export function decidirComprobante({ venta, cuentas, emiteFacturaManual = false } = {}) {
  const indice = indexarCuentas(cuentas);
  const pagos = listarPagos(venta);

  const metodos = pagos.map(({ metodo, importe }) => {
    const cuenta = indice.get(normalizarNombreCuenta(metodo)) || null;
    const crudo = leerImprimeFactura(cuenta);
    const interruptor = crudo === null ? IMPRIME_FACTURA_POR_DEFECTO : crudo;

    // REGLA POR NOMBRE: manda sobre el interruptor. Un `imprimeFactura` apagado
    // por error ya no puede dejar de facturar una Transferencia.
    const { cola: colaPorNombre, regla, requiereCuentaAsociada } = resolverReglaMedioPago(metodo);

    // Contradicción entre la regla y la configuración. No se silencia: viaja en
    // la decisión para que la capa que escribe la registre en el log.
    let contradiccion = null;
    if (colaPorNombre && interruptor === false) {
      contradiccion = {
        metodo, regla, cuenta: cuenta?.nombre ?? null,
        detalle: `El medio "${metodo}" corresponde a ${colaPorNombre} por su nombre, pero su cuenta tiene "Emite factura" apagado. Manda el switch: la venta va a remito.`,
      };
    } else if (regla === REGLA.EFECTIVO_REMITO && interruptor === true) {
      contradiccion = {
        metodo, regla, cuenta: cuenta?.nombre ?? null,
        detalle: `El medio "${metodo}" es efectivo (no factura por regla) pero su cuenta tiene imprimeFactura=true. Revisar la configuración.`,
      };
    }

    return {
      metodo,
      importe,
      cuenta: cuenta?.nombre ?? null,
      campoPresente: crudo !== null,
      // ¿ESTE MEDIO FACTURA? MANDA EL INTERRUPTOR DE LA CUENTA.
      //
      // Antes la regla por NOMBRE forzaba `true`: una cuenta llamada
      // "Transferencia 2" facturaba en FACTURACION_2 aunque su switch estuviera
      // apagado. Se hizo así para que apagarlo por accidente no cortara la
      // facturación en silencio, pero convierte el switch en decorativo: el
      // dueño no podía decidir que una cuenta NO facture, y la venta se
      // detenía con un error fiscal en vez de emitirse como remito.
      //
      // Ahora el nombre sólo dice A QUÉ COLA va una venta que YA se decidió
      // facturar (ver `colaPorNombre` y `resolverEncolado`); no decide SI se
      // factura. La contradicción se sigue registrando abajo para que apagar el
      // switch de una cuenta que corresponde a una cola quede en el log.
      //
      // Dos excepciones que no cambian:
      //  · EFECTIVO nunca factura, aunque el switch esté encendido;
      //  · PedidosYa/Rappi facturan por su CUENTA ASOCIADA — su switch ni se
      //    muestra en el formulario, así que no puede decidir por ellas.
      imprimeFactura: requiereCuentaAsociada
        ? true
        : (regla === REGLA.EFECTIVO_REMITO ? false : interruptor),
      interruptor,
      colaPorNombre,
      requiereCuentaAsociada,
      cuentaId: cuenta?.id ?? null,
      regla,
      contradiccion,
    };
  });

  const contradicciones = metodos.map((m) => m.contradiccion).filter(Boolean);

  // EFECTIVO PURO → REMITO, SIEMPRE. Regla fija que gana sobre todo: sobre
  // `imprimeFactura` mal configurado y también sobre el tilde manual. Antes acá
  // se abría la pregunta "¿Desea imprimir factura?" y se salía a buscar el alias
  // destacado; nada de eso ocurre ya.
  const soloEfectivo = metodos.length > 0
    && metodos.every((m) => m.regla === REGLA.EFECTIVO_REMITO);

  const tildeManualActivo = !soloEfectivo
    && (emiteFacturaManual === true || venta?.emiteFactura === true);
  const facturan = metodos.filter((m) => m.imprimeFactura);
  const algunaCuentaFactura = facturan.length > 0;
  const debeFacturarse = !soloEfectivo && (tildeManualActivo || algunaCuentaFactura);

  const motivo = soloEfectivo
    ? 'efectivo-siempre-remito'
    : algunaCuentaFactura
    ? 'cuenta-imprime-factura'
    : tildeManualActivo
      ? 'tilde-manual'
      : metodos.length === 0
        ? 'sin-pagos'
        : 'ninguna-cuenta-imprime-factura';

  return {
    comprobante: debeFacturarse ? COMPROBANTE_FACTURA : COMPROBANTE_REMITO,
    debeFacturarse,
    total: totalDeVenta(venta),
    motivo,
    tildeManualActivo,
    algunaCuentaFactura,
    metodos,
    contradicciones,
    // Colas resueltas POR NOMBRE entre los medios cobrados, sin repetir. En una
    // venta combinada el efectivo no aporta ninguna, así que queda la del medio
    // no efectivo — que es exactamente la que hay que usar.
    //
    // SÓLO de los medios que efectivamente FACTURAN: el nombre dice a qué cola
    // va una venta que ya se decidió facturar, no si se factura. Una cuenta con
    // el switch apagado no aporta cola, aunque su nombre corresponda a una.
    colasPorNombre: [...new Set(metodos.filter((m) => m.imprimeFactura).map((m) => m.colaPorNombre).filter(Boolean))],
    cuentasQueFacturan: [...new Set(facturan.map((m) => m.cuenta || m.metodo))],
    metodosSinCampo: [...new Set(metodos.filter((m) => !m.campoPresente).map((m) => m.metodo))],
  };
}

/**
 * A qué cola va la ÚNICA factura de esta venta, y por qué importe.
 *
 * Criterio, determinista y sin invenciones:
 *   - una sola cuenta usada con el interruptor encendido → SU cola;
 *   - varias encendidas → la cuenta FAVORITA del local, pero SÓLO si es una de
 *     las que se usaron y facturan (es el único criterio determinista que ya
 *     existía en el sistema). Si no, la combinación se DETIENE: no se elige una
 *     cola a dedo ni se manda a la cola equivocada;
 *   - facturación por tilde manual solamente → una cuenta FISCAL HABILITADA
 *     (`imprimeFactura === true`): la favorita si además es fiscal, o la única
 *     habilitada. Si el local no tiene ninguna, se DETIENE. La favorita NO se
 *     usa por ser favorita: una cuenta de cobro con el interruptor apagado no
 *     factura nunca, ni siquiera con el tilde manual.
 *
 * El importe es SIEMPRE el total completo de la venta.
 *
 * @returns {{estado: 'sin-factura'}
 *         | {estado: 'encolar', cola: string, total: number, cuenta: string, criterio: string}
 *         | {estado: 'sin-cola'|'ambiguo', motivo: string, cuenta?: string, cuentas?: string[]}}
 */
export function resolverEncolado(decision, cuentas) {
  if (!decision || decision.comprobante !== COMPROBANTE_FACTURA) return { estado: 'sin-factura' };

  // 1) REGLA POR MEDIO DE PAGO — tiene prioridad. Si los medios cobrados
  //    resuelven a UNA sola cola por nombre, esa es la cola, sin depender de
  //    `imprimeFactura` ni de cuál sea la cuenta favorita. Cubre las ventas
  //    combinadas: el efectivo no aporta cola, así que queda la del otro medio,
  //    y la entrada se emite por el TOTAL COMPLETO de la venta.
  const colasPorNombre = decision.colasPorNombre || [];

  // ...pero SÓLO si no hay además otra cuenta SIN regla que también facture: en
  // ese caso hay dos CUIT candidatos y la elección vuelve al desempate de
  // siempre (favorita entre las que facturan), que puede DETENERSE. La regla
  // resuelve los casos del negocio, no pisa la protección contra ambigüedad.
  const otraCuentaFactura = (decision.metodos || [])
    .some((m) => !m.colaPorNombre && m.imprimeFactura);

  if (colasPorNombre.length === 1 && !otraCuentaFactura) {
    const cola = colasPorNombre[0];
    const metodoRegla = (decision.metodos || []).find((m) => m.colaPorNombre === cola) || {};
    return {
      estado: 'encolar',
      cola,
      total: decision.total,
      cuenta: metodoRegla.cuenta || metodoRegla.metodo || cola,
      criterio: `regla-medio-de-pago:${metodoRegla.regla || ''}`,
      regla: metodoRegla.regla || null,
      medioDePago: metodoRegla.metodo || null,
    };
  }

  // PLATAFORMAS (PedidosYa / Rappi): la cola sale de la CUENTA ASOCIADA que se
  // configuró en la propia cuenta de la plataforma. Se resuelve acá mismo —
  // `cuentas` ya está a mano, no hace falta leer nada más. El ALIAS del local no
  // interviene: eso quedó sólo para el botón manual de convertir un remito.
  const plataforma = (decision.metodos || []).find((m) => m.requiereCuentaAsociada);
  if (plataforma && colasPorNombre.length === 0) {
    const r = resolverCuentaAsociadaDePlataforma({ plataformaId: plataforma.cuentaId, cuentas });
    if (r.estado !== 'ok') {
      // NO se manda a FACTURACION_1 por defecto, no se cae al alias y no se
      // degrada a remito: la venta se DETIENE con el error a la vista.
      return {
        estado: 'sin-cola',
        cuenta: plataforma.cuenta || plataforma.metodo,
        regla: plataforma.regla,
        medioDePago: plataforma.metodo,
        motivo:
          `No se pudo facturar la venta de ${nombreDePlataforma(plataforma.regla)} porque la cuenta ` +
          `fiscal asociada no es válida. ${r.motivo}`,
      };
    }
    return {
      estado: 'encolar',
      cola: r.cola,
      total: decision.total,
      cuenta: r.cuenta,
      criterio: `cuenta-asociada:${r.cuentaId}`,
      regla: plataforma.regla,
      medioDePago: plataforma.metodo,
      cuentaAsociadaId: r.cuentaId,
    };
  }
  // Con DOS colas distintas por nombre (p. ej. Transferencia 2 + Transferencia 3
  // en la misma venta) no se elige a dedo: sigue el desempate de siempre.

  const facturan = decision.cuentasQueFacturan;
  const favorita = cuentaFavorita(cuentas);
  const nombreFavorita = favorita?.nombre ?? null;

  let cuenta = null;
  let criterio = null;

  if (facturan.length === 1) {
    cuenta = facturan[0];
    criterio = 'unica-cuenta-que-factura';
  } else if (facturan.length > 1) {
    const favoritaEntreEllas = facturan.find(
      (n) => normalizarNombreCuenta(n) === normalizarNombreCuenta(nombreFavorita)
    );
    if (!favoritaEntreEllas) {
      return {
        estado: 'ambiguo',
        cuentas: facturan,
        motivo:
          `Se cobró con ${facturan.length} cuentas que imprimen factura (${facturan.join(', ')}) y ` +
          `la cuenta favorita del local ${nombreFavorita ? `("${nombreFavorita}")` : '(no configurada)'} ` +
          'no es ninguna de ellas: no hay forma determinista de saber con qué CUIT facturar.',
      };
    }
    cuenta = favoritaEntreEllas;
    criterio = 'cuenta-favorita-entre-las-que-facturan';
  } else {
    // SÓLO EL TILDE MANUAL. Ninguna de las cuentas cobradas factura por sí sola,
    // así que hay que elegir una cuenta FISCAL. La favorita del local sirve sólo
    // si además tiene el interruptor encendido: facturar con una cuenta marcada
    // como "no factura" sería usar el CUIT equivocado.
    const fiscal = elegirCuentaFiscalParaTildeManual(cuentas);

    if (fiscal.estado === 'sin-cuenta-fiscal') {
      return {
        estado: 'sin-cola',
        motivo:
          'No hay una cuenta fiscal habilitada para emitir esta factura: ninguna cuenta del local tiene ' +
          '"Emite factura" encendido' +
          (nombreFavorita ? ` (la favorita, "${nombreFavorita}", tampoco).` : '.'),
      };
    }
    if (fiscal.estado === 'ambiguo') {
      return {
        estado: 'ambiguo',
        cuentas: fiscal.cuentas,
        motivo:
          `El local tiene ${fiscal.cuentas.length} cuentas fiscales habilitadas (${fiscal.cuentas.join(', ')}) ` +
          'y ninguna está marcada como favorita: hay que elegir con cuál se emite esta factura.',
      };
    }

    cuenta = fiscal.cuenta.nombre;
    criterio = fiscal.criterio;
  }

  const cola = colaFiscalDeCuenta(cuenta);
  if (!cola) {
    return {
      estado: 'sin-cola',
      cuenta,
      motivo: `La cuenta "${cuenta}" tiene que facturar pero no tiene cola de facturación asignada.`,
    };
  }

  return { estado: 'encolar', cola, total: decision.total, cuenta, criterio };
}

/** ¿Este encolado impide emitir el comprobante? (config incompleta o ambigua) */
export const encoladoBloqueado = (encolado) =>
  encolado?.estado === 'sin-cola' || encolado?.estado === 'ambiguo';

/**
 * Mensaje para mostrarle al usuario cuando la venta NO se puede facturar por
 * configuración. Nunca se cae a un FCX: eso sería emitir el comprobante
 * equivocado en silencio.
 */
export function mensajeDeBloqueo(encolado) {
  if (!encoladoBloqueado(encolado)) return null;
  return (
    `No se puede facturar esta venta: ${encolado.motivo} ` +
    'Revisá el interruptor "Emite factura" y la cuenta favorita en Gestión de Cuentas. ' +
    'La venta NO se emitió como remito: el comprobante que corresponde es una factura.'
  );
}

/**
 * ¿Esta venta ya guardada va al circuito fiscal? Es la ÚNICA pregunta que hace
 * la emisión del remito, y por eso vive acá y no duplicada en cada flujo.
 *
 * Prioridad:
 *   1. `comprobante`, la decisión materializada al guardar la venta;
 *   2. `emiteFactura`, para las ventas guardadas ANTES de que existiera este
 *      módulo (ahí ese campo era la decisión completa).
 */
export function ventaSeFactura(venta) {
  if (!venta || typeof venta !== 'object') return false;
  if (venta.comprobante === COMPROBANTE_FACTURA) return true;
  if (venta.comprobante === COMPROBANTE_REMITO) return false;
  return venta.emiteFactura === true;
}
