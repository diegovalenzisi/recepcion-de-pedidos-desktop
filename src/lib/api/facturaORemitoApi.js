// ---------------------------------------------------------------------------
// FACTURA o REMITO — LECTURA DE LAS CUENTAS DEL LOCAL
//
// Capa delgada: resuelve el local activo, lee sus cuentas y le pasa el dato al
// módulo puro facturaORemito.js, que es quien decide y quien elige la cola.
// Acá no hay ninguna regla de negocio.
//
// Ruta que se lee:  /{localId}/CUENTAS   (el local es SIEMPRE el primer segmento)
//
// SI LAS CUENTAS NO SE PUEDEN LEER la venta se DETIENE con un error claro: no se
// asume que ninguna factura (saldría un FCX por una venta que debía facturarse)
// ni se factura a ciegas. Es la misma regla que para una cola indeterminable.
//
// Archivo IDÉNTICO en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import {
  COMPROBANTE_FACTURA,
  COMPROBANTE_REMITO,
  decidirComprobante,
  encoladoBloqueado,
  mensajeDeBloqueo,
  resolverEncolado,
  REGLA,
} from '@/lib/api/facturaORemito';
import { construirRutaLocal, normalizarLocalId } from '@/lib/api/rutasLocales';
import { leerConfigFiscal, validarColaAntesDeFacturar } from '@/lib/api/colasFiscalesApi';
import { emisorDeCuenta } from '@/lib/api/colasFiscales';

/** Error de configuración fiscal: la venta no se puede emitir hasta arreglarlo. */
export class FacturacionNoResuelta extends Error {
  constructor(mensaje, encolado, validacion = null) {
    super(mensaje);
    this.name = 'FacturacionNoResuelta';
    this.encolado = encolado;
    // Qué falta exactamente, para que la pantalla lo muestre sin adivinar.
    this.validacion = validacion;
    this.estado = validacion?.estado ?? null;
    this.faltantes = validacion?.faltantes ?? [];
  }
}

/** Cuentas del local activo. Lanza si no hay local o si la lectura falla. */
export const leerCuentasDelLocal = async () => {
  const raiz = normalizarLocalId(getCurrentDatabasePath());
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado, no se pueden leer las cuentas.');
  const snap = await get(ref(getDatabase(), construirRutaLocal(raiz, 'CUENTAS')));
  if (!snap.exists()) return [];
  const data = snap.val() || {};
  return Object.keys(data).map((id) => ({ id, ...data[id] }));
};

/**
 * Decide el comprobante de una venta y, si es factura, a qué cola va.
 *
 * @param {object} venta                          la venta / pedido con sus pagos
 * @param {object} [opciones]
 * @param {boolean} [opciones.emiteFacturaManual] el tilde "Emite Factura" de la pantalla
 * @returns {Promise<object>} la decisión + `encolado`
 * @throws {FacturacionNoResuelta} si la venta debe facturarse y no se puede
 *         determinar una cola válida. NUNCA cae a un FCX como fallback.
 */
export const resolverComprobanteDeVenta = async (venta, { emiteFacturaManual = false } = {}) => {
  const cuentas = await leerCuentasDelLocal();
  const decision = decidirComprobante({ venta, cuentas, emiteFacturaManual });
  let encolado = resolverEncolado(decision, cuentas);

  if (decision.metodosSinCampo.length > 0) {
    console.warn(
      `[COMPROBANTE] Sin "imprimeFactura" guardado para: ${decision.metodosSinCampo.join(', ')} ` +
      '— se asume APAGADO (comportamiento histórico).'
    );
  }

  // CONTRADICCIÓN entre la regla por medio de pago y el interruptor de la
  // cuenta. NO se oculta: es la señal de que la configuración quedó mal y hay
  // que corregirla. La venta sigue su curso según la REGLA, que es la que manda.
  for (const c of decision.contradicciones || []) {
    console.error(
      `[FACTURACION] CONTRADICCIÓN de configuración — medio "${c.metodo}" ` +
      `(regla ${c.regla}, cuenta ${c.cuenta ?? 'sin cuenta'}): ${c.detalle}`
    );
  }

  // PLATAFORMAS (PedidosYa / Rappi): la cola ya viene resuelta desde el módulo
  // puro, a partir de `cuentaFacturacionAsociadaId` de la propia cuenta. Acá
  // sólo se deja constancia en el log. El ALIAS del local NO se consulta.
  if (encolado.regla === REGLA.PEDIDOSYA_PREPAGO || encolado.regla === REGLA.RAPPI_PREPAGO) {
    console.log(`[FACTURACION] Medio de pago: ${encolado.medioDePago}`);
    console.log(`[FACTURACION] Regla aplicada: ${encolado.regla}`);
    if (encolado.estado === 'encolar') {
      console.log(`[FACTURACION] Cuenta asociada: ${encolado.cuentaAsociadaId} (${encolado.cuenta})`);
      console.log(`[FACTURACION] Cola resuelta: ${encolado.cola}`);
    }
  }

  if (encoladoBloqueado(encolado)) {
    const mensaje = mensajeDeBloqueo(encolado);
    console.error(`[COMPROBANTE] ${mensaje}`);
    throw new FacturacionNoResuelta(mensaje, encolado);
  }

  // VALIDACIÓN OBLIGATORIA DE LA COLA ELEGIDA.
  //
  // Cada FACTURACION_N es una CUENTA FISCAL distinta: antes de dar la venta por
  // facturada hay que confirmar que ESA cuenta —no "la del local"— tiene CUIT,
  // punto de venta, certificado, clave, runtime y rutas.
  //
  // Si no los tiene, la venta se DETIENE. No se encola en una cola huérfana
  // (quedaría esperando para siempre) y no se emite un FCX como premio consuelo
  // (el comprobante que corresponde es una factura).
  let emisor = null;
  if (encolado.estado === 'encolar') {
    const config = await leerConfigFiscal();
    const validacion = await validarColaAntesDeFacturar(encolado.cola, { config });
    if (!validacion.listo) {
      const mensaje =
        `No se puede facturar esta venta: ${validacion.mensaje} ` +
        `La venta se cobró con "${encolado.cuenta}", que factura en ${encolado.cola}. ` +
        'La venta NO se emitió como remito: el comprobante que corresponde es una factura.';
      console.error(`[COMPROBANTE] ${mensaje}`);
      throw new FacturacionNoResuelta(mensaje, encolado, validacion);
    }
    if (validacion.avisos.length > 0) {
      console.warn(`[COMPROBANTE] ${encolado.cola}: ${validacion.avisos.join(' | ')}`);
    }
    // El emisor viaja con la decisión para que la factura quede grabada con los
    // datos fiscales de SU cola y no haya que volver a resolverlos después.
    emisor = emisorDeCuenta(validacion.cuenta);
  }

  console.log(
    `[COMPROBANTE] ${decision.comprobante} por el total ${decision.total} (${decision.motivo})` +
    (encolado.estado === 'encolar'
      ? ` → ${encolado.cola} vía "${encolado.cuenta}" (${encolado.criterio})` +
        (emisor ? ` — emisor ${emisor.razonSocial} CUIT ${emisor.cuitFormat} pto vta ${emisor.puntoVenta} (Factura ${emisor.letra})` : '')
      : '') +
    ' — pagos: ' + decision.metodos.map((m) => `${m.metodo}=${m.imprimeFactura ? 'factura' : 'remito'}`).join(', ')
  );

  return { ...decision, encolado, emisor };
};

/** Atajo legible: ¿esta venta NO se factura y por lo tanto lleva FCX? */
export const ventaVaARemito = (decision) => decision?.comprobante === COMPROBANTE_REMITO;

/** Atajo legible: ¿esta venta se factura? */
export const ventaVaAFactura = (decision) => decision?.comprobante === COMPROBANTE_FACTURA;
