// Acceso a Firebase del bloqueo de mantenimiento. La decisión vive en
// `mantenimiento.js`, que es puro.

import { ref, get } from 'firebase/database';
import { getCurrentDatabaseOrThrow, getCurrentLocalId } from '@/lib/firebase/core';
import { RUTA_MANTENIMIENTO, MantenimientoActivoError, bloquea } from './mantenimiento';

/**
 * Lee el flag. Devuelve `false` ante cualquier problema de lectura.
 *
 * SI NO SE PUEDE LEER, SE DEJA PASAR. Es deliberado: el mantenimiento dura
 * segundos y ocurre con el comercio cerrado. Bloquear una venta real porque
 * falló una lectura de red sería mucho peor que el riesgo que evita.
 */
export const hayMantenimiento = async () => {
  try {
    const localId = getCurrentLocalId();
    if (!localId) return false;
    const db = getCurrentDatabaseOrThrow(localId);
    // El flag es hermano del local, no hijo: se direcciona por localId.
    const flag = (await get(ref(db, RUTA_MANTENIMIENTO(localId)))).val();
    return bloquea(flag);
  } catch {
    return false;
  }
};

/**
 * GUARDA. Se llama al principio de una operación comercial: si hay
 * mantenimiento, lanza y la operación no llega a escribir nada.
 */
export const asegurarOperable = async (queSeIntentaba = 'la operación') => {
  if (await hayMantenimiento()) {
    console.warn(`[MANTENIMIENTO] Bloqueado: ${queSeIntentaba}`);
    throw new MantenimientoActivoError();
  }
};
