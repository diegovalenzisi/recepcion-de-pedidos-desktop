// ---------------------------------------------------------------------------
// FACTURAR UN REMITO (FCX) A POSTERIORI — MÓDULO PURO
//
// Un remito FCX es el comprobante NO fiscal de una venta que no se facturó. Si
// después hace falta la factura, NO se emite una nota de crédito ni se anula
// nada: el remito se CONSERVA, sus productos e importes se mandan al motor de
// facturación que ya existe, y cuando la factura sale, el remito queda marcado
// como facturado y vinculado a ella.
//
// LO QUE ESTA OPERACIÓN NO HACE, nunca:
//   - no emite Nota de Crédito             → el FCX no es fiscal, no hay qué anular
//   - no descuenta stock                   → ya se descontó al vender
//   - no registra caja ni toca el turno    → la plata ya entró
//   - no crea otra venta ni otro remito    → es la MISMA operación, facturada
//   - no suma estadísticas ni comisiones   → ya se sumaron
//   - no cambia importes ni productos      → se factura exactamente lo vendido
//
// IDEMPOTENCIA: la clave es localId + número de FCX. El candado es el propio
// campo `estadoFacturacion` del remito, tomado por transacción: dos clics, dos
// PCs o una PC y una tablet a la vez producen UNA sola solicitud.
//
// CÓMO VUELVE LA FACTURA: el motor AFIP copia el payload encolado dentro del
// registro fiscal que crea (hace `{...pedido}` al guardar en VENTAS), así que
// los campos de referencia que se agregan acá viajan solos hasta la factura
// emitida. Por eso se puede reconocer cuál factura corresponde a cuál remito
// sin tocar el motor. Ver conciliarConFacturaEmitida().
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { PREFIJO_REMITO, esRemito, listarPagos } from './remitos.js';

/** Estados del ciclo de facturación de un remito. */
export const ESTADO_SIN_FACTURAR = 'SIN_FACTURAR';
export const ESTADO_PENDIENTE = 'PENDIENTE';
export const ESTADO_FACTURADO = 'FACTURADO';
export const ESTADO_ERROR = 'ERROR';

/** Marca de origen que viaja hasta la factura emitida. */
export const ORIGEN_REMITO = 'REMITO';

/** Prefijos de factura fiscal que puede devolver el motor. */
const PREFIJOS_FISCALES = ['FCB', 'FCC'];

/** Estado actual, tolerando remitos viejos que no tienen el campo. */
export function estadoFacturacion(remito) {
  if (!remito || typeof remito !== 'object') return ESTADO_SIN_FACTURAR;
  if (remito.facturado === true) return ESTADO_FACTURADO;
  const e = String(remito.estadoFacturacion || '').toUpperCase();
  if (e === ESTADO_PENDIENTE || e === ESTADO_FACTURADO || e === ESTADO_ERROR) return e;
  return ESTADO_SIN_FACTURAR;
}

/**
 * ¿Se puede pedir la factura de este remito?
 * Sólo si no está facturado y no hay una solicitud en curso. Un intento que
 * terminó en ERROR SÍ se puede reintentar: no se emitió nada.
 */
export function puedeFacturarse(remito) {
  const e = estadoFacturacion(remito);
  return e === ESTADO_SIN_FACTURAR || e === ESTADO_ERROR;
}

/**
 * Validación completa antes de encolar. Devuelve el motivo exacto para poder
 * mostrárselo al usuario en vez de fallar en silencio.
 * @returns {{ok: boolean, motivo?: string}}
 */
export function validarRemitoParaFacturar(remito, numeroComprobante) {
  if (!remito || typeof remito !== 'object') {
    return { ok: false, motivo: `El remito ${numeroComprobante || ''} no existe.`.trim() };
  }
  const numero = remito.numeroComprobante || numeroComprobante;
  if (!esRemito(numero)) {
    return { ok: false, motivo: `${JSON.stringify(numero)} no es un número de remito válido.` };
  }
  if (remito.tipo !== PREFIJO_REMITO) {
    return { ok: false, motivo: `El comprobante ${numero} no es un remito (tipo ${JSON.stringify(remito.tipo)}).` };
  }
  const estado = estadoFacturacion(remito);
  if (estado === ESTADO_FACTURADO) {
    return { ok: false, motivo: `El remito ${numero} ya fue facturado${remito.numeroFactura ? ` como ${remito.numeroFactura}` : ''}.` };
  }
  if (estado === ESTADO_PENDIENTE) {
    return { ok: false, motivo: `El remito ${numero} ya tiene una facturación en curso.` };
  }
  const total = Number(remito.total);
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, motivo: `El remito ${numero} no tiene un total válido (${JSON.stringify(remito.total)}).` };
  }
  const productos = remito.productos && typeof remito.productos === 'object' ? Object.keys(remito.productos) : [];
  if (productos.length === 0) {
    return { ok: false, motivo: `El remito ${numero} no tiene productos.` };
  }
  return { ok: true };
}

/** Clave de idempotencia: un remito de un local se factura UNA sola vez. */
export function claveIdempotencia(localId, numeroComprobante) {
  return `${String(localId ?? '').trim()}:${String(numeroComprobante ?? '').trim()}`;
}

/**
 * Clave del registro en la cola fiscal. Determinista y derivada del número de
 * remito: si por lo que sea se encolara dos veces, la segunda PISA la primera
 * en lugar de agregar una segunda factura.
 */
export function claveEnCola(numeroComprobante) {
  return `R${String(numeroComprobante ?? '').trim()}`;
}

/** Los productos del remito, en el formato que ya consume el motor. */
export function construirProductosParaFactura(productos) {
  const salida = {};
  const claves = Object.keys(productos || {}).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  let i = 0;
  for (const k of claves) {
    const p = productos[k];
    if (!p || typeof p !== 'object') continue;
    const cantidad = Number(p.cantidad) || 1;
    const total = Number(p.precioTotal);
    const unitario = Number(p.precioUnitario);
    const linea = {
      nombre: cantidad > 1 ? `${cantidad}x ${p.nombre || 'Sin nombre'}` : String(p.nombre || 'Sin nombre'),
      // `valor` es lo que lee el motor para el detalle: el importe de la línea.
      valor: Number.isFinite(total) ? total : (Number.isFinite(unitario) ? unitario * cantidad : 0),
      cantidad,
    };
    if (Number.isFinite(unitario)) linea.precioUnitario = unitario;
    if (p.selectedOptionals && Object.keys(p.selectedOptionals).length > 0) {
      linea.opcionales = p.selectedOptionals;
    }
    if (p.codigo) linea.codigo = String(p.codigo);
    salida[`producto_${++i}`] = linea;
  }
  return salida;
}

/**
 * PAYLOAD QUE SE ENCOLA. Mantiene la forma que el motor ya sabe leer
 * (`clientes`, `direccion`, `producto`, `fecha`, `hora`, `total`) y le agrega
 * la referencia al remito, que el motor copia tal cual dentro de la factura
 * emitida — de ahí sale el vínculo de vuelta.
 *
 * El total es el TOTAL COMPLETO del remito: nunca un importe parcial.
 */
export function construirPayloadFacturacion({ remito, localId, cola, solicitadoPor = null, ahora = null } = {}) {
  const numero = remito.numeroComprobante;
  const pagos = listarPagos({ payments: Object.values(remito.pagos || {}) });

  const payload = {
    clientes: remito.cliente || 'Consumidor Final',
    direccion: remito.direccion || 'Sin Datos',
    producto: construirProductosParaFactura(remito.productos),
    fecha: remito.fecha || null,
    hora: remito.hora || null,
    total: Number(remito.total),

    // Referencia inequívoca. Viaja con el payload hasta /{localId}/VENTAS/{FCB…}
    origen: ORIGEN_REMITO,
    remitoId: numero,
    forzarFactura: true,
    idempotencyKey: claveIdempotencia(localId, numero),
    localId: String(localId),
    colaFacturacion: cola || null,
    // Referencia informativa: cómo se había cobrado la venta.
    formaPagoOriginal: remito.formaPago || (pagos.length ? pagos.map((p) => p.metodo).join(' + ') : null),
    solicitadoEn: ahora || new Date().toISOString(),
  };
  if (solicitadoPor) payload.solicitadoPor = String(solicitadoPor);
  if (remito.canal) payload.canalOriginal = remito.canal;

  // RTDB rechaza undefined; null sí es dato.
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return payload;
}

/** Campos técnicos que se escriben en el remito al tomar el candado. */
export function marcaDePendiente({ cola, deviceId = null, ahora = null } = {}) {
  return {
    estadoFacturacion: ESTADO_PENDIENTE,
    facturacionSolicitadaEn: ahora || new Date().toISOString(),
    facturacionSolicitadaPor: deviceId ? String(deviceId) : null,
    colaFacturacion: cola || null,
    // Se arranca de cero: un error viejo no puede hacer que el intento nuevo
    // aparezca como fallado antes de empezar.
    errorFacturacion: null,
    errorAt: null,
    facturado: false,
    numeroFactura: null,
    cae: null,
  };
}

/** Campos que se escriben si la solicitud no se pudo encolar o falló la emisión. */
export function marcaDeError(mensaje) {
  return {
    facturado: false,
    estadoFacturacion: ESTADO_ERROR,
    errorFacturacion: String(mensaje || 'Error desconocido').slice(0, 500),
    errorAt: Date.now(),
  };
}

/** ¿Esta clave de VENTAS es una factura fiscal emitida por el motor? */
export function esClaveDeFactura(clave) {
  const s = String(clave ?? '');
  return PREFIJOS_FISCALES.some((p) => s.startsWith(p));
}

/**
 * Dado el registro fiscal que dejó el motor, arma la marca de FACTURADO para
 * el remito. El número de factura es la CLAVE del registro (FCB0008-00010300),
 * y el CAE viene en el propio registro.
 */
export function marcaDeFacturado(claveFactura, registroFiscal = {}, ahora = null) {
  const numeroFactura = String(claveFactura);
  const cae = registroFiscal.CAE ?? registroFiscal.cae ?? null;
  const vto = registroFiscal.VtoCAE ?? registroFiscal.CAE_VTO ?? registroFiscal.vtoCae ?? null;
  return {
    facturado: true,
    estadoFacturacion: ESTADO_FACTURADO,
    numeroFactura,
    tipoFactura: numeroFactura.slice(0, 3),
    cae: cae === undefined ? null : cae,
    vencimientoCae: vto === undefined ? null : vto,
    fechaFacturacion: ahora || new Date().toISOString(),
    facturadoAt: Date.now(),
    // Se BORRA cualquier rastro del error anterior: la factura existe.
    errorFacturacion: null,
    errorAt: null,
  };
}

/**
 * Busca, entre los registros fiscales, el que salió de ESTE remito. El motor
 * copia `remitoId` dentro de la factura, así que la búsqueda es exacta: no se
 * adivina por importe ni por fecha.
 *
 * @param {object} ventas  nodo (o porción reciente) de /{localId}/VENTAS
 * @param {string} numeroComprobante  el FCX
 * @returns {{clave: string, registro: object}|null}
 */
export function buscarFacturaDelRemito(ventas, numeroComprobante) {
  const numero = String(numeroComprobante ?? '');
  if (!numero) return null;
  for (const clave of Object.keys(ventas || {})) {
    if (!esClaveDeFactura(clave)) continue;
    const registro = ventas[clave];
    if (registro && typeof registro === 'object' && String(registro.remitoId ?? '') === numero) {
      return { clave, registro };
    }
  }
  return null;
}

/**
 * Reconciliación: qué hacer con un remito que quedó PENDIENTE.
 *
 * @param {object} opciones
 * @param {object} opciones.remito
 * @param {object} opciones.ventas          registros fiscales donde buscar
 * @param {boolean} opciones.sigueEnCola    ¿el pedido sigue esperando en la cola?
 * @returns {{accion: 'esperar'|'facturado'|'reabrir', marca?: object, motivo?: string}}
 */
export function conciliarConFacturaEmitida({ remito, ventas, sigueEnCola, errorDelMotor = null } = {}) {
  const estado = estadoFacturacion(remito);

  // Sólo se deja en paz lo que YA está facturado. Un remito en ERROR sí se
  // revisa: puede tener su factura emitida y el error puede ser viejo.
  if (estado === ESTADO_FACTURADO) return { accion: 'esperar', motivo: 'ya-facturado' };
  if (estado !== ESTADO_PENDIENTE && estado !== ESTADO_ERROR) {
    return { accion: 'esperar', motivo: 'no-esta-pendiente' };
  }

  // 1. CAE CONFIRMADO. Manda sobre TODO lo demás: sobre `estadoFacturacion:
  //    ERROR`, sobre `errorFacturacion`, `errorAt` e `intentos`, y sobre
  //    cualquier error de un intento anterior. Si la factura existe, el remito
  //    está facturado — no hay lectura del error que pueda contradecir un CAE.
  //    Ésta es la regla que repara sola los remitos que quedaron mal marcados.
  const encontrada = buscarFacturaDelRemito(ventas, remito?.numeroComprobante);
  if (encontrada) {
    return { accion: 'facturado', marca: marcaDeFacturado(encontrada.clave, encontrada.registro) };
  }

  // Sin factura y ya estaba en ERROR: se queda como está, esperando que el
  // usuario reintente. No se pisa el mensaje que ya tenía.
  if (estado === ESTADO_ERROR) return { accion: 'esperar', motivo: 'error-sin-factura' };

  // 2. ERROR REAL, informado por el motor sobre el propio pedido encolado
  //    (ARCA rechazó, faltó un dato). Es el ÚNICO camino que marca ERROR.
  if (errorDelMotor) {
    return { accion: 'reabrir', marca: marcaDeError(String(errorDelMotor)) };
  }

  // 3. TODO LO DEMÁS ES ESPERAR. Incluye el caso que antes marcaba ERROR: el
  //    pedido ya salió de la cola pero su factura todavía no aparece en la
  //    ventana de VENTAS que se consulta. Es una CARRERA, no una falla — el
  //    motor guarda la factura y recién después borra el pedido, así que la
  //    factura llega un instante más tarde. Marcarlo ERROR mostraba "Error al
  //    facturar" en una operación que terminaba bien segundos después.
  //
  //    DEMORA ≠ ERROR. Se sigue esperando; el listener en vivo y la
  //    conciliación periódica lo pasan a FACTURADO cuando la factura aparece.
  return { accion: 'esperar', motivo: sigueEnCola ? 'sigue-en-la-cola' : 'emitiendose' };
}

/** Texto de estado para el listado de Remitos. */
export function describirEstadoFacturacion(remito) {
  switch (estadoFacturacion(remito)) {
    case ESTADO_FACTURADO:
      return remito?.numeroFactura ? `Facturado como ${remito.numeroFactura}` : 'Facturado';
    case ESTADO_PENDIENTE:
      // El valor persistido sigue siendo PENDIENTE (no se toca, para no romper
      // los remitos que ya estén en vuelo), pero lo que se ve es que está en
      // proceso: una demora no es un problema.
      return 'Procesando factura…';
    case ESTADO_ERROR:
      return 'Error al facturar';
    default:
      return 'Sin facturar';
  }
}

/** Texto de la confirmación que se le muestra al usuario antes de facturar. */
export function textoConfirmacion(numeroComprobante) {
  return {
    // La palabra "remito" NO se le muestra al usuario: internamente el dato
    // sigue siendo un FCX en /{localId}/Remitos, pero en pantalla es
    // "Facturación 2".
    titulo: `¿Querés facturar el comprobante ${numeroComprobante}?`,
    descripcion:
      'Se emitirá una factura por el total completo utilizando los mismos productos e importes. ' +
      'Esta acción no volverá a descontar stock ni registrar la venta en caja.',
    confirmar: 'Facturar',
    cancelar: 'Cancelar',
  };
}
