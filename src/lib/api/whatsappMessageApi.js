import { ref, set, get, onValue, remove, serverTimestamp } from 'firebase/database';
import { getLocalId, getCurrentDatabaseOrThrow, beginFirebaseOperation } from '@/lib/firebase/core';

const getMessageRef = (delivererId) => {
  // getCurrentDatabaseOrThrow() en vez de getDatabase(getFirebaseApp()): antes,
  // si getFirebaseApp() devolvía null (Firebase no listo), se le pasaba null a
  // getDatabase() sin verificar — ahora lanza un error controlado y legible.
  const db = getCurrentDatabaseOrThrow();
  const localId = getLocalId() || 'default';
  return ref(db, `locales/${localId}/whatsappMessages/${delivererId}`);
};

const getMessageRefFromDb = (db, delivererId) => {
  const localId = getLocalId() || 'default';
  return ref(db, `locales/${localId}/whatsappMessages/${delivererId}`);
};

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
  const msgRef = getMessageRef(delivererId);
  const snapshot = await get(msgRef);
  return snapshot.exists() ? snapshot.val() : null;
};

export const deleteDelivererMessage = async (delivererId) => {
  if (!delivererId) return;
  const msgRef = getMessageRef(delivererId);
  await remove(msgRef);
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