// Historial de cambios de precio.
//
// RUTA CANÓNICA:  /{localId}/priceHistory/{recordId}
//
// La ruta anterior estaba INVERTIDA (`/priceHistory/{localId}`), que viola la
// regla de almacenamiento por local. Toda ESCRITURA nueva va exclusivamente a la
// ruta canónica; la vieja se sigue LEYENDO como fallback temporal para no
// esconder el historial que ya existe, y se migra con el script de migración.
// No hay doble escritura: la fuente de verdad es la ruta nueva.
import { getDatabase, ref, get, push, remove } from 'firebase/database';
import { getCurrentLocalId, getLocalId, checkLocalId } from '@/lib/firebase/core';
import { construirRutaLocal, normalizarLocalId, LocalIdRequeridoError } from './rutasLocales';

const HIJO = 'priceHistory';

/** Local actual normalizado, o null. */
const localActual = () => {
  checkLocalId();
  return normalizarLocalId(getCurrentLocalId() || getLocalId());
};

/** Ruta canónica. Lanza LOCAL_ID_REQUIRED si no hay local válido. */
const rutaCanonica = (sufijo = '') =>
  construirRutaLocal(localActual(), sufijo ? `${HIJO}/${sufijo}` : HIJO);

/** Ruta DEPRECADA (solo lectura, para el fallback). */
const rutaLegado = (localId, sufijo = '') =>
  `${HIJO}/${localId}${sufijo ? `/${sufijo}` : ''}`;

export const savePriceHistory = async (changes) => {
  const historyRef = ref(getDatabase(), rutaCanonica()); // lanza si no hay local

  const promises = changes.map(change => {
    if (!change.departamento) {
      console.warn(`Artículo ${change.codigo} no tiene departamento asociado. Se guardará como "Sin Departamento".`);
    }

    const record = {
      codigo: change.codigo || '',
      nombre: change.nombre || '',
      departamento: change.departamento || 'Sin Departamento',
      precio_anterior: Number(change.precio_anterior) || 0,
      precio_nuevo: Number(change.precio_nuevo) || 0,
      fecha: change.fecha || new Date().toISOString().split('T')[0],
      hora: change.hora || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      usuario: change.usuario || 'Sistema',
      tipo: change.tipo || 'inmediato',
      timestamp: Date.now()
    };
    return push(historyRef, record);
  });

  await Promise.all(promises);
};

export const fetchPriceHistoryByDateRange = async (startDate, endDate) => {
  const localId = localActual();
  if (!localId) throw new LocalIdRequeridoError('fetchPriceHistoryByDateRange');
  const db = getDatabase();

  // 1) Ruta canónica. 2) Solo si está vacía, la vieja (fallback temporal).
  let snapshot = await get(ref(db, construirRutaLocal(localId, HIJO)));
  let desdeLegado = false;
  if (!snapshot.exists()) {
    snapshot = await get(ref(db, rutaLegado(localId)));
    desdeLegado = snapshot.exists();
  }
  if (!snapshot.exists()) return [];

  const data = snapshot.val();
  let history = Object.keys(data).map(key => ({ id: key, ...data[key], __origenLegado: desdeLegado || undefined }));

  if (startDate && endDate) {
    history = history.filter(item => {
      const itemDate = new Date(item.timestamp);
      return itemDate >= startDate && itemDate <= endDate;
    });
  }

  return history.sort((a, b) => b.timestamp - a.timestamp);
};

export const deletePriceHistoryRecord = async (recordId) => {
  const localId = localActual();
  if (!localId) throw new LocalIdRequeridoError('deletePriceHistoryRecord');
  const db = getDatabase();

  // Borra donde exista: primero la canónica; si el registro venía del nodo viejo
  // (todavía sin migrar), se borra ahí. Nunca se escribe en el nodo viejo.
  const refCanonica = ref(db, construirRutaLocal(localId, `${HIJO}/${recordId}`));
  const snap = await get(refCanonica);
  if (snap.exists()) {
    await remove(refCanonica);
    return;
  }
  await remove(ref(db, rutaLegado(localId, recordId)));
};
