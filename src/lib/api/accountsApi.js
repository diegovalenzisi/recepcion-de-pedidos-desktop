import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { getDatabase, ref, runTransaction, get, set, onValue, off, update } from 'firebase/database';

export const fetchAccounts = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CUENTAS.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    if (!data) return [];
    
    return Object.keys(data).map(key => ({
      id: key,
      ...data[key]
    }));
  } catch (error) {
    console.error("Error fetching accounts:", error);
    throw error;
  }
};

export const fetchFavoriteAccount = async () => {
  const localId = getCurrentLocalId();
  if (!localId) return null;

  const db = getDatabase();
  const accountsRef = ref(db, `${localId}/CUENTAS`);

  try {
    // Fetch all accounts and filter in memory to avoid Firebase "Index not defined" errors
    const snapshot = await get(accountsRef);
    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const accountId in data) {
        if (data[accountId].isFavorite === true) {
          return { id: accountId, ...data[accountId] };
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Error fetching favorite account:", error);
    throw error;
  }
};

export const fetchFavoriteAccountAlias = async () => {
  try {
    const favoriteAccount = await fetchFavoriteAccount();
    return favoriteAccount ? favoriteAccount.alias : null;
  } catch (error) {
    console.error("Error fetching favorite account alias:", error);
    return null;
  }
};

// Devuelve alias + titular de la cuenta favorita. El titular es el campo `aNombreDe`
// del formulario de Cuentas ("A nombre de"). No rompe fetchFavoriteAccountAlias().
export const fetchFavoriteAccountInfo = async () => {
  try {
    const favoriteAccount = await fetchFavoriteAccount();
    return {
      alias:   favoriteAccount?.alias || null,
      titular: favoriteAccount?.aNombreDe || null,
    };
  } catch (error) {
    console.error("Error fetching favorite account info:", error);
    return { alias: null, titular: null };
  }
};

export const listenToAccounts = (localId, callback, errorCallback) => {
    if (!localId) {
        callback([]);
        if(errorCallback) errorCallback();
        return () => {};
    }
    const db = getDatabase();
    const accountsRef = ref(db, `${localId}/CUENTAS`);

    const listener = onValue(accountsRef, (snapshot) => {
        const data = snapshot.val();
        const accountsList = data ? Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        })) : [];
        callback(accountsList);
    }, (error) => {
        console.error("Error listening to accounts:", error);
        callback([]);
        if(errorCallback) errorCallback(error);
    });

    return () => off(accountsRef, 'value', listener);
};

const getNextAccountId = async (db, localId) => {
    const counterRef = ref(db, `${localId}/CONTADORES/cuentas`);
    const { committed, snapshot } = await runTransaction(counterRef, (currentValue) => {
        return (currentValue || 0) + 1;
    });

    if (!committed) {
        throw new Error("No se pudo obtener el siguiente ID de cuenta.");
    }
    return `cta-${snapshot.val()}`;
};

export const saveAccount = async (accountData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const db = getDatabase();
  
  const accountId = accountData.id || await getNextAccountId(db, LOCAL_ID);
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CUENTAS/${accountId}.json`;
  
  const dataToSave = { ...accountData };
  delete dataToSave.id;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSave),
    });
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return { ...await response.json(), id: accountId };
  } catch (error) {
    console.error("Error saving account:", error);
    throw error;
  }
};

export const deleteAccount = async (accountId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CUENTAS/${accountId}.json`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return { success: true };
  } catch (error) {
    console.error("Error deleting account:", error);
    throw error;
  }
};

export const setFavoriteAccount = async (accountIdToSet, allAccounts) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const updates = {};
  
  const newFavoriteAccount = allAccounts.find(account => account.id === accountIdToSet);

  allAccounts.forEach(account => {
    const isFavorite = account.id === accountIdToSet;
    updates[`/${LOCAL_ID}/CUENTAS/${account.id}/isFavorite`] = isFavorite;
  });

  if (newFavoriteAccount) {
    updates[`/${LOCAL_ID}/CUENTA`] = newFavoriteAccount.nombre || "";
  }

  try {
    await update(ref(db), updates);
  } catch (error) {
    console.error("Error setting favorite account:", error);
    throw error;
  }
};

export const findAccountByPaymentMethod = async (localId, paymentMethod) => {
  if (!localId || !paymentMethod) return null;
  try {
    const db = getDatabase();
    const accountsRef = ref(db, `${localId}/CUENTAS`);
    const snapshot = await get(accountsRef);
    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const key in data) {
        if (data[key].nombre && data[key].nombre.toUpperCase() === paymentMethod.toUpperCase()) {
          return {
             id: key,
             alias: data[key].alias,
             aNombreDe: data[key].aNombreDe,
             ...data[key]
          };
        }
      }
    }
    return null;
  } catch (error) {
     console.error("Error finding account by payment method:", error);
     return null;
  }
};

export const findAccountByExactPaymentMethod = async (localId, exactPaymentMethod) => {
  if (!localId || !exactPaymentMethod) return null;
  try {
    const db = getDatabase();
    const accountsRef = ref(db, `${localId}/CUENTAS`);
    const snapshot = await get(accountsRef);
    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const key in data) {
        // Exact match, case-sensitive lookup only in CUENTAS
        if (data[key].nombre === exactPaymentMethod) {
          return {
             id: key,
             alias: data[key].alias,
             aNombreDe: data[key].aNombreDe,
             ...data[key]
          };
        }
      }
    }
    return null;
  } catch (error) {
     console.error("Error finding account by exact payment method:", error);
     return null;
  }
};