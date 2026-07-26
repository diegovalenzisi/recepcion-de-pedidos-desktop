// Último mensaje de WhatsApp por repartidor.
//
// RUTA CANÓNICA:  /{localId}/whatsappMessages/{delivererId}
//
// La ruta anterior estaba INVERTIDA (`/locales/{localId}/whatsappMessages/...`).
// Toda ESCRITURA nueva va exclusivamente a la canónica; la vieja se sigue
// LEYENDO como fallback temporal y se migra con el script de migración.
//
// El fallback `getLocalId() || 'default'` que había acá era exactamente el
// antipatrón prohibido: sin local, escribía en `/locales/default/...`. Ahora sin
// local válido se lanza LOCAL_ID_REQUIRED y la operación se cancela.
import { ref, set, get, onValue, remove, serverTimestamp } from 'firebase/database';
import { getLocalId, getCurrentLocalId, getCurrentDatabaseOrThrow, beginFirebaseOperation } from '@/lib/firebase/core';
import { construirRutaLocal, normalizarLocalId, LocalIdRequeridoError } from './rutasLocales';

const HIJO = 'whatsappMessages';

const localActual = () => normalizarLocalId(getCurrentLocalId() || getLocalId());

const rutaCanonica = (delivererId) =>
  construirRutaLocal(localActual(), `${HIJO}/${delivererId}`); // lanza si no hay local

const rutaLegado = (localId, delivererId) => `locales/${localId}/${HIJO}/${delivererId}`;

const getMessageRef = (delivererId) => {
  // getCurrentDatabaseOrThrow() en vez de getDatabase(getFirebaseApp()): antes,
  // si getFirebaseApp() devolvía null (Firebase no listo), se le pasaba null a
  // getDatabase() sin verificar — ahora lanza un error controlado y legible.
  const db = getCurrentDatabaseOrThrow();
  return ref(db, rutaCanonica(delivererId));
};

const getMessageRefFromDb = (db, delivererId) => ref(db, rutaCanonica(delivererId));

export const saveLastDelivererMessage = async (delivererId, messageText, userId = 'system') => {
  if (!delivererId) throw new Error("delivererId is required");
  const msgRef = getMessageRef(delivererId);
  await set(msgRef, {
    lastMessage: messageText,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    generatedBy: userId
  });
};

export const updateDelivererMessage = async (delivererId, messageText, userId = 'system') => {
  if (!delivererId) throw new Error("delivererId is required");
  const op = beginFirebaseOperation();
  const msgRef = getMessageRefFromDb(op.getDatabaseOrAbort(), delivererId);
  const snapshot = await get(msgRef);
  const existingData = snapshot.exists() ? snapshot.val() : {};

  // Revalida antes del set() definitivo: el get() de arriba fue un await real.
  const freshMsgRef = getMessageRefFromDb(op.getDatabaseOrAbort(), delivererId);
  await set(freshMsgRef, {
    ...existingData,
    lastMessage: messageText,
    updatedAt: serverTimestamp(),
    generatedBy: userId
  });
};

export const getLastDelivererMessage = async (delivererId) => {
  if (!delivererId) return null;
  const localId = localActual();
  if (!localId) throw new LocalIdRequeridoError('getLastDelivererMessage');
  const db = getCurrentDatabaseOrThrow();

  // 1) canónica; 2) solo si no existe, la vieja (fallback temporal de lectura).
  const snapshot = await get(ref(db, construirRutaLocal(localId, `${HIJO}/${delivererId}`)));
  if (snapshot.exists()) return snapshot.val();

  const legado = await get(ref(db, rutaLegado(localId, delivererId)));
  return legado.exists() ? { ...legado.val(), __origenLegado: true } : null;
};

export const deleteDelivererMessage = async (delivererId) => {
  if (!delivererId) return;
  const localId = localActual();
  if (!localId) throw new LocalIdRequeridoError('deleteDelivererMessage');
  const db = getCurrentDatabaseOrThrow();

  const refCanonica = ref(db, construirRutaLocal(localId, `${HIJO}/${delivererId}`));
  const snap = await get(refCanonica);
  if (snap.exists()) { await remove(refCanonica); return; }
  await remove(ref(db, rutaLegado(localId, delivererId)));
};

export const listenToDelivererMessage = (delivererId, callback) => {
  if (!delivererId) return () => {};
  let msgRef;
  try {
    msgRef = getMessageRef(delivererId);
  } catch (e) {
    console.warn('[listenToDelivererMessage] Firebase todavía no está listo, no se suscribe:', e.message);
    return () => {};
  }
  return onValue(msgRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  }, (error) => {
    console.error("Error listening to deliverer message:", error);
  });
};