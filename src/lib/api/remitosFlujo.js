// ---------------------------------------------------------------------------
// REMITOS (FCX) — FLUJO DE EMISIÓN
//
// Toda la mecánica de emitir un remito, con Firebase pero SIN depender de la
// configuración de la app (localId, alias '@/', React). Recibe la base y la
// raíz del local ya resueltas, así que se puede ejecutar tal cual contra el
// emulador y probar de verdad transacciones, concurrencia y aislamiento entre
// locales. remitosApi.js es la capa delgada que resuelve el local y llama acá.
//
// Reglas que este módulo garantiza:
//   - se escribe SOLO dentro de /{raiz}: el comprobante y la marca en la venta;
//   - la secuencia sale de una transacción → no hay dos remitos con el mismo número;
//   - la venta de origen queda marcada → reprocesarla NO emite un segundo remito;
//   - no se toca stock, caja, comisiones, estadísticas ni facturación.
//
// Idéntico en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { ref, set, runTransaction } from 'firebase/database';
import {
  construirNumeroRemito,
  construirRemitoDesdeVenta,
  rutaContadorRemitos,
  rutaRemito,
} from './remitos.js';

/** Valor transitorio de la marca mientras se emite. */
export const MARCA_EN_CURSO = 'EN_CURSO';

/** Dónde queda anotado el número de remito de una venta ya emitida. */
export const rutaMarcaDeVenta = (raiz, canal, ventaId) =>
  `${raiz}/${canal === 'delivery' ? 'PEDIDOS' : 'MOSTRADOR'}/${ventaId}/remito`;

/**
 * Emite el remito de una venta NO facturada.
 *
 * @param {object}   opciones
 * @param {object}   opciones.db          base de datos ya resuelta
 * @param {string}   opciones.raiz        raíz del local (primer segmento de toda ruta)
 * @param {object}   opciones.venta       la venta tal cual quedó guardada
 * @param {string}   opciones.canal       'mostrador' | 'delivery'
 * @param {string}   opciones.puntoVenta  punto de venta para numerar
 * @param {Function} [opciones.revalidarDb] se llama antes de cada escritura
 *        definitiva; debe devolver la base o lanzar si cambió el local.
 *
 * @returns {Promise<{estado: string, numeroComprobante?: string, motivo?: string}>}
 *   estado ∈ 'emitido' | 'ya-emitido' | 'omitido'
 * @throws si la escritura falla (el caller decide qué hacer; la venta ya está guardada).
 */
export const emitirRemito = async ({ db, raiz, venta, canal = 'mostrador', puntoVenta, revalidarDb = null }) => {
  if (!venta || typeof venta !== 'object') return { estado: 'omitido', motivo: 'sin-venta' };
  if (venta.emiteFactura) return { estado: 'omitido', motivo: 'la-venta-se-factura' };

  const ventaId = venta.id ?? venta.orderId;
  if (ventaId === null || ventaId === undefined || ventaId === '') {
    return { estado: 'omitido', motivo: 'venta-sin-id' };
  }

  const revalidar = () => (revalidarDb ? revalidarDb() : db);
  const rutaMarca = rutaMarcaDeVenta(raiz, canal, ventaId);

  // 1) Tomar la marca de la venta. Si ya tenía una, la transacción no commitea
  //    y no se emite un segundo comprobante (dos terminales a la vez incluidas).
  const marca = await runTransaction(ref(db, rutaMarca), (actual) => (actual ? undefined : MARCA_EN_CURSO));
  if (!marca.committed) {
    const yaTenia = marca.snapshot.val();
    return { estado: 'ya-emitido', numeroComprobante: yaTenia === MARCA_EN_CURSO ? undefined : yaTenia };
  }

  try {
    // 2) Secuencia propia del local. NUNCA consume la numeración de AFIP.
    const contador = await runTransaction(
      ref(revalidar(), rutaContadorRemitos(raiz)),
      (actual) => (Number(actual) || 0) + 1
    );
    if (!contador.committed) throw new Error('No se pudo obtener el número de remito.');

    const numeroComprobante = construirNumeroRemito(puntoVenta, contador.snapshot.val());
    if (!numeroComprobante) throw new Error('Número de remito inválido.');

    // 3) El comprobante, en la única ruta canónica.
    const remito = construirRemitoDesdeVenta({ venta, canal, numeroComprobante, localId: raiz });
    await set(ref(revalidar(), rutaRemito(raiz, numeroComprobante)), remito);

    // 4) Marca definitiva en la venta de origen: referencia cruzada y candado.
    await set(ref(revalidar(), rutaMarca), numeroComprobante);

    return { estado: 'emitido', numeroComprobante };
  } catch (e) {
    // Libera la marca para que un reintento pueda emitirlo. La venta en sí no
    // se toca en ningún caso.
    try {
      await set(ref(db, rutaMarca), null);
    } catch { /* si tampoco se puede liberar queda EN_CURSO y se revisa a mano */ }
    throw e;
  }
};
