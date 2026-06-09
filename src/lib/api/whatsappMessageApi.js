import { getDatabase, ref, set, get, onValue, remove, serverTimestamp } from 'firebase/database';
import { getFirebaseApp, getLocalId } from '@/lib/firebase/core';

const getMessageRef = (delivererId) => {
  const db = getDatabase(getFirebaseApp());
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
  const msgRef = getMessageRef(delivererId);
  const snapshot = await get(msgRef);
  const existingData = snapshot.exists() ? snapshot.val() : {};
  
  await set(msgRef, {
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
  const msgRef = getMessageRef(delivererId);
  return onValue(msgRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  }, (error) => {
    console.error("Error listening to deliverer message:", error);
  });
};