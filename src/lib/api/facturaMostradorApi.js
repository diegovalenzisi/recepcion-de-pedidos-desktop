// ---------------------------------------------------------------------------
// ESPERA DEL CAE DE UNA VENTA DE MOSTRADOR
//
// Capa delgada sobre facturaMostrador.js: espera a que la factura de una venta
// aparezca ya emitida en /{localId}/VENTAS. Las reglas viven en el módulo puro.
//
// La pregunta "¿Desea imprimir la factura?" y la resolución de la cuenta por el
// alias destacado fueron ELIMINADAS: ya no existe `resolverFacturacionFavorita`
// ni nada que consulte al cajero.
//
// SOLO LEE. No encola, no factura, no imprime, no marca nada.
// ---------------------------------------------------------------------------

import { getDatabase, ref, get, query, orderByKey, limitToLast } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { construirRutaLocal, normalizarLocalId } from '@/lib/api/rutasLocales';
import {
  buscarFacturaDeVenta, evaluarEspera, claveEnCola, ESPERA_CAE_MS,
} from '@/lib/api/facturaMostrador';


/** Cuántos registros fiscales recientes se revisan (la factura recién emitida está entre los últimos). */
const VENTAS_A_REVISAR = 60;

/** Cada cuánto se vuelve a mirar mientras se espera el CAE. */
const INTERVALO_MS = 1500;

/**
 * Espera a que la factura de una venta de mostrador quede EMITIDA CON CAE.
 *
 * @param {object} params
 *   saleId  — número de venta de mostrador
 *   cola    — FACTURACION_N en la que se encoló
 *   timeoutMs, onTick
 * @returns {Promise<{estado:'emitida'|'error'|'demorada', ...}>}
 *   Nunca lanza por vencimiento: `demorada` es un resultado válido.
 */
export const esperarCaeDeVenta = async ({ saleId, cola, timeoutMs = ESPERA_CAE_MS, onTick = null } = {}) => {
  const raiz = normalizarLocalId(getCurrentDatabasePath());
  if (!raiz) return { estado: 'error', mensaje: 'No hay un local activo.' };

  const db = getDatabase();
  const clave = claveEnCola(saleId);
  const inicio = Date.now();

  for (;;) {
    const transcurrido = Date.now() - inicio;
    const vencido = transcurrido >= timeoutMs;

    // Ya NO se consulta `{cola}_LOCKS`: ese sistema fue eliminado. La espera se
    // resuelve mirando si la factura apareció en VENTAS y si el pedido sigue en
    // la cola. Consecuencia: un rechazo de ARCA ya no corta la espera con el
    // mensaje exacto — se informa como "demorada" al vencer el tiempo, y el
    // error real, completo, queda en el log del facturador.
    const [ventasSnap, colaSnap] = await Promise.all([
      get(query(ref(db, construirRutaLocal(raiz, 'VENTAS')), orderByKey(), limitToLast(VENTAS_A_REVISAR))),
      cola ? get(ref(db, construirRutaLocal(raiz, `${cola}/${clave}`))) : Promise.resolve(null),
    ]);

    const resultado = evaluarEspera({
      factura: buscarFacturaDeVenta(ventasSnap.exists() ? ventasSnap.val() : {}, saleId),
      lock: null,
      sigueEnCola: !!(colaSnap && colaSnap.exists()),
      vencido,
    });

    if (resultado.estado !== 'esperando') return { ...resultado, esperoMs: transcurrido };

    if (onTick) {
      try { onTick({ transcurrido, restante: Math.max(0, timeoutMs - transcurrido) }); } catch { /* el aviso no puede romper la espera */ }
    }
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
};
