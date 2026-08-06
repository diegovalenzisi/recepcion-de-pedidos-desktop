// ---------------------------------------------------------------------------
// Lectura del snapshot FRESCO para revalidar el stock de una venta.
//
// La regla vive en validacionStockVenta.js (módulo puro). Acá solo se leen
// ARTICULOS y MATERIA_PRIMA del local actual, del mismo instante, y se le pasan.
// ---------------------------------------------------------------------------

import { ref, get } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { evaluarStockDeCarrito, mensajeDeBloqueo } from './validacionStockVenta';

/**
 * Texto EXACTO que ve el operador cuando no se pudo leer el stock. No se vende
 * sin poder validar: un error de lectura bloquea igual que un faltante.
 */
export const MENSAJE_STOCK_NO_VERIFICABLE =
  'No se pudo verificar el stock. Revisá la conexión e intentá nuevamente.';

/**
 * Error de "no se pudo verificar", distinguible de un faltante real. Quien lo
 * recibe ya tiene el texto listo para mostrar en `message`.
 */
export class StockNoVerificableError extends Error {
  constructor(causa) {
    super(MENSAJE_STOCK_NO_VERIFICABLE);
    this.name = 'StockNoVerificableError';
    this.causa = causa;
  }
}

/**
 * Revalida el stock de un carrito/venta contra Firebase, con las cantidades
 * reales de cada línea.
 *
 * Si la lectura falla (sin conexión, permisos, cambio de local a mitad de
 * camino), LANZA `StockNoVerificableError`: la venta NO continúa. Vender sin
 * poder validar es exactamente lo que hay que evitar.
 *
 * @param {Array} items líneas del carrito (o `sale.items`)
 * @returns {Promise<{ suficiente, faltantes, ciclos, inexistentes, avisos, mensaje }>}
 * @throws {StockNoVerificableError} si no se pudo leer el stock
 */
export const validarStockDeCarrito = async (items) => {
  let articulos;
  let materiaPrima;

  try {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

    const [artSnap, mpSnap] = await Promise.all([
      get(ref(db, `${LOCAL_ID}/ARTICULOS`)),
      get(ref(db, `${LOCAL_ID}/MATERIA_PRIMA`)),
    ]);

    // Un catálogo vacío no es un dato válido para autorizar una venta: o el
    // local no es el que se cree, o la lectura volvió a medias.
    articulos = artSnap.val();
    materiaPrima = mpSnap.val() || {};
    if (!articulos || Object.keys(articulos).length === 0) {
      throw new Error('ARTICULOS vino vacío');
    }
  } catch (e) {
    console.error('[STOCK VENTA] no se pudo leer el stock para validar la venta:', e);
    throw new StockNoVerificableError(e);
  }

  const resultado = evaluarStockDeCarrito({ items, articulos, materiaPrima });

  if (!resultado.suficiente) {
    console.warn('[STOCK VENTA] venta bloqueada:', {
      faltantes: resultado.faltantes,
      ciclos: resultado.ciclos,
    });
  }

  return { ...resultado, mensaje: mensajeDeBloqueo(resultado) };
};
