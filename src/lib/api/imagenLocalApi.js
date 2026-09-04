// ---------------------------------------------------------------------------
// IMAGEN COMPLETA DEL LOCAL — acceso a Firebase.
//
// La decisión vive en `imagenLocal.js`, que es puro. Acá está el ida y vuelta.
//
// DOS OPERACIONES, Y NADA MÁS:
//
//   crearImagen()      copia /{raiz} entero a BACKUP/{localId}/IMAGEN.
//                      Solo LEE del local: no modifica un solo dato del comercio.
//
//   restaurarImagen()  devuelve /{raiz} exactamente a esa copia, en UNA
//                      escritura atómica. Es destructivo para todo lo que pasó
//                      después de la imagen.
//
// EL BACKUP NUNCA SE TOCA AL RESTAURAR. Vive en BACKUP/{localId}, fuera del
// nodo del local, así que la escritura que reemplaza /{raiz} no lo alcanza. Tras
// restaurar, la imagen sigue ahí y se puede volver a restaurar las veces que
// haga falta.
// ---------------------------------------------------------------------------

import { ref, get, set, update } from 'firebase/database';
import { getCurrentDatabaseOrThrow, getCurrentLocalId, getCurrentDatabasePath } from '@/lib/firebase/core';
import { RUTA_MANTENIMIENTO } from './mantenimiento';
import {
  RUTA_IMAGEN, RUTA_METADATA,
  construirMetadata, validarImagen, validarTamanoParaCopiar,
  construirUpdateRestauracion, resumenDeRestauracion, compararConImagen,
  medirImagen, enMB,
} from './imagenLocal';

/** Ramas de primer nivel que hoy existen en el local (lectura shallow). */
const ramasActuales = async (db, raiz) => {
  const val = (await get(ref(db, raiz))).val();
  return val && typeof val === 'object' ? Object.keys(val) : [];
};

const contexto = () => {
  const localId = getCurrentLocalId();
  if (!localId) throw new Error('No hay un local activo.');
  return { localId, db: getCurrentDatabaseOrThrow(localId), raiz: getCurrentDatabasePath() };
};

/**
 * CREA (o reemplaza) la imagen completa del local.
 *
 * Lee /{raiz} entero y lo escribe en BACKUP/{localId}/IMAGEN con un `set`, no
 * con un `update`: reemplazo TOTAL. Si quedaran restos de una imagen anterior
 * —una rama que ya no existe en el local— la restauración la resucitaría.
 *
 * @returns {{metadata: object, reemplazo: boolean, bytes: number}}
 */
export const crearImagen = async ({ versionSistema = '', creadaPor = '' } = {}) => {
  const { localId, db, raiz } = contexto();

  const anterior = (await get(ref(db, RUTA_METADATA(localId)))).val();

  // Lectura del nodo COMPLETO del local. Sin filtrar, sin clasificar.
  const nodo = (await get(ref(db, raiz))).val();
  if (!nodo || typeof nodo !== 'object' || Object.keys(nodo).length === 0) {
    throw new Error('El local está vacío: no hay nada para copiar.');
  }

  // Se corta ANTES de escribir si no entra en una escritura de Firebase.
  const tam = validarTamanoParaCopiar(nodo);
  if (!tam.ok) throw new Error(tam.motivo);

  const metadata = construirMetadata({
    localId,
    databasePathOriginal: raiz,
    versionSistema,
    creadaPor,
    bytes: tam.bytes,
    ramas: Object.keys(nodo),
  });

  // La imagen primero; la metadata después, y solo si la imagen entró. Así una
  // metadata nunca describe una copia que no existe.
  await set(ref(db, RUTA_IMAGEN(localId)), nodo);
  await set(ref(db, RUTA_METADATA(localId)), metadata);

  return { metadata, reemplazo: !!anterior, bytes: tam.bytes };
};

/**
 * Lee la imagen y su metadata, y dice qué pasaría si se restaurara.
 * Es lo que consume la pantalla. No escribe nada.
 */
export const inspeccionarImagen = async () => {
  const localId = getCurrentLocalId();
  if (!localId) return { existe: false, metadata: null, validacion: null, resumen: null };

  const db = getCurrentDatabaseOrThrow(localId);
  const raiz = getCurrentDatabasePath();

  const metadata = (await get(ref(db, RUTA_METADATA(localId)))).val();
  if (!metadata) return { existe: false, metadata: null, validacion: null, resumen: null };

  // Para el resumen alcanza con las ramas: no hace falta traer la imagen entera.
  const ramasImagen = (await get(ref(db, RUTA_IMAGEN(localId)))).val();
  const validacion = validarImagen(ramasImagen, metadata, localId);
  const resumen = resumenDeRestauracion(ramasImagen, await ramasActuales(db, raiz));

  return { existe: true, metadata, validacion, resumen };
};

/**
 * RESTAURA el local completo desde la imagen.
 *
 * El orden importa y no es decorativo:
 *
 *   1. lock          — fuera del local, para que sobreviva a la escritura
 *   2. leer imagen   — y validarla ANTES de tocar nada
 *   3. update()      — una sola escritura atómica: entra entera o no entra
 *   4. verificar     — releyendo el local y comparándolo con la imagen
 *   5. liberar lock  — SIEMPRE, pase lo que pase
 *
 * Si algo falla antes del paso 3, el local queda intacto.
 */
export const restaurarImagen = async ({ onPaso = () => {}, ejecutadoPor = '' } = {}) => {
  const { localId, db, raiz } = contexto();

  // --- 1. Lock ------------------------------------------------------------
  onPaso('Activando el bloqueo de mantenimiento…');
  await set(ref(db, RUTA_MANTENIMIENTO(localId)), {
    activo: true, desde: new Date().toISOString(), por: ejecutadoPor, motivo: 'restauracion',
  });

  // Se confirma que quedó puesto: si el lock no está, las guardas no bloquean
  // y una venta podría entrar en el medio.
  const confirmado = (await get(ref(db, RUTA_MANTENIMIENTO(localId)))).val();
  if (!confirmado || confirmado.activo !== true) {
    throw new Error('No se pudo activar el bloqueo de mantenimiento. Se cancela la restauración.');
  }

  const liberarLock = async () => {
    try { await set(ref(db, RUTA_MANTENIMIENTO(localId)), null); }
    catch (e) { console.error('[RESTAURAR] No se pudo liberar el bloqueo:', e.message); }
  };

  try {
    // --- 2. Imagen, validada antes de tocar nada --------------------------
    onPaso('Leyendo la imagen de la base de datos…');
    const [imagen, metadata] = await Promise.all([
      get(ref(db, RUTA_IMAGEN(localId))).then((s) => s.val()),
      get(ref(db, RUTA_METADATA(localId))).then((s) => s.val()),
    ]);

    const v = validarImagen(imagen, metadata, localId);
    if (!v.ok) throw new Error(`No se puede restaurar: ${v.problemas.join(' ')}`);

    // --- 3. Una sola escritura atómica ------------------------------------
    onPaso('Restaurando la base de datos…');
    const presentes = await ramasActuales(db, raiz);
    const updates = construirUpdateRestauracion(raiz, imagen, presentes);
    const resumen = resumenDeRestauracion(imagen, presentes);

    await update(ref(db), updates);

    // --- 4. Verificación real, releyendo -----------------------------------
    onPaso('Verificando la restauración…');
    const restaurado = (await get(ref(db, raiz))).val();
    const comparacion = compararConImagen(imagen, restaurado);

    await liberarLock();

    return {
      ok: comparacion.ok,
      validacion: comparacion,
      resumen,
      metadata,
      bytes: medirImagen(imagen),
    };
  } catch (e) {
    // El lock se libera pase lo que pase: nunca se deja el local bloqueado.
    await liberarLock();
    throw e;
  }
};

/** Cuánto pesa hoy el local, para avisar antes de intentar copiarlo. */
export const medirLocal = async () => {
  const { db, raiz } = contexto();
  const nodo = (await get(ref(db, raiz))).val();
  const bytes = medirImagen(nodo);
  return { bytes, legible: enMB(bytes), ramas: nodo ? Object.keys(nodo).length : 0 };
};
