import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { getDatabase, ref, set, get, runTransaction, update, onValue, off } from 'firebase/database';

export const fetchSettings = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  try {
    const response = await fetch(`${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION.json`);
    if (!response.ok) {
      if (response.status === 404 || response.status === 401 || response.status === 403) {
        console.warn("No settings found or access denied, returning null.");
        return null;
      }
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    const settings = {
        deliveryOrderColorMode: 'pastel',
        deliveryViewMode: 'table',
        gridViewSettings: {
          showAddress: false,
          showPhone: false,
          showAmount: false,
          showChange: false,
          showPaymentType: false,
          showDeliverer: false,
          gridColumns: 5,
          gridRows: 4
        },
        ...data
    };
    
    // Cache globally for synchronous access by helper functions (e.g., WhatsApp formatters)
    if (typeof window !== 'undefined') {
      window.__appSettings = settings;
    }
    
    return settings || {};
  } catch (error) {
    console.error("Error fetching settings:", error);
    throw error;
  }
};

export const listenToChanges = (path, callback) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const dataRef = ref(db, `${LOCAL_ID}/${path}`);

    const listener = onValue(dataRef, (snapshot) => {
        const data = snapshot.val();
        
        if (path === 'CONFIGURACION') {
            const settings = data || {};
            // Update global cache when settings change
            if (typeof window !== 'undefined') {
              window.__appSettings = settings;
            }
            callback(settings);
            return;
        }

        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const dataArray = Object.keys(data).map(key => ({
                id: key,
                codigo: key,
                ...data[key]
            }));
            callback(dataArray);
        } else {
            callback(data || (path.endsWith('S') ? [] : {}));
        }
    }, (error) => {
        console.error(`Error listening to changes at ${path}:`, error);
    });

    return () => off(dataRef, 'value', listener);
};

export const fetchPaymentMethods = async () => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const url = `${getFirebaseUrl()}/${localId}/CONFIGURACION/formasDePago.json`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return [];
            throw new Error('Error fetching payment methods');
        }
        const data = await response.json();
        if (!data) return [];
        
        if (typeof data === 'object' && data !== null) {
            return Object.values(data);
        }
        
        return [];
    } catch (error) {
        console.error("Error fetching payment methods:", error);
        return [];
    }
};

export const saveSettings = async (settingsData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const configRef = ref(db, `${LOCAL_ID}/CONFIGURACION`);
  
  const updates = {};

  for (const key in settingsData) {
    const value = settingsData[key];
    if (key === 'web') {
      if (value && value.horarios !== undefined) {
        updates['web/horarios'] = value.horarios;
      }
      const { horarios, ...otherWebSettings } = value || {};
      for (const webKey in otherWebSettings) {
        updates[`web/${webKey}`] = otherWebSettings[webKey];
      }
    } else if (key === 'destacar') {
      updates['DESTACAR'] = value;
    } else if (key === 'newOrderSound') {
       updates['newOrderSound'] = value;
    } else if (key === 'salesPercentage') {
       updates['porcentaje'] = value;
    } else if (key === 'gridViewSettings') {
       updates['gridViewSettings'] = value;
    } else {
      updates[key] = value;
    }
  }

  try {
    await update(configRef, updates);
    if (settingsData.newOrderSound !== undefined) {
        window.dispatchEvent(new CustomEvent('audioSettingsChanged'));
    }
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
};

export const fetchGridViewSettings = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/gridViewSettings.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if(response.status === 404) {
          console.log("No grid view settings found in database, returning defaults.");
          return { gridColumns: 5, gridRows: 4 };
      }
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    console.log("Fetched GridView settings from DB:", data);
    
    // Ensure retrieved data contains valid numbers before returning
    if (data) {
       data.gridColumns = data.gridColumns ? Number(data.gridColumns) : 5;
       data.gridRows = data.gridRows ? Number(data.gridRows) : 4;
    }
    
    return data || { gridColumns: 5, gridRows: 4 };
  } catch (error) {
    console.error("Error fetching grid view settings:", error);
    return { gridColumns: 5, gridRows: 4 }; // Fallback to sensible defaults
  }
};

export const saveGridViewSettings = async (settings) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const settingsRef = ref(db, `${LOCAL_ID}/CONFIGURACION/gridViewSettings`);
  
  try {
    // Explicitly parse string inputs to numbers before saving
    const dataToSave = {
        ...settings,
        gridColumns: Number(settings.gridColumns),
        gridRows: Number(settings.gridRows)
    };
    
    console.log("Saving GridView settings to DB:", dataToSave);
    await set(settingsRef, dataToSave);
    return { success: true, data: dataToSave };
  } catch (error) {
    console.error("Error saving grid view settings:", error);
    throw error;
  }
};

export const saveAudioSetting = async (audioData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const audioRef = ref(db, `${LOCAL_ID}/CONFIGURACION/newOrderSound`);
  
  try {
    await set(audioRef, audioData);
    window.dispatchEvent(new CustomEvent('audioSettingsChanged'));
  } catch(error) {
    console.error("Error saving audio setting:", error);
    throw error;
  }
};

export const fetchAudioSetting = async () => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const FIREBASE_URL = getFirebaseUrl();
    const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/newOrderSound.json`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error('Network response was not ok');
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching audio setting:", error);
        throw error;
    }
};

export const fetchOrderSoundVolume = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/orderSoundVolume.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return 100;
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    return typeof data === 'number' ? data : 100;
  } catch (error) {
    console.error("Error fetching order sound volume:", error);
    return 100;
  }
};

export const saveSalesPercentage = async (percentage) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const percentageRef = ref(db, `${LOCAL_ID}/CONFIGURACION/porcentaje`);
  
  try {
    await set(percentageRef, percentage);
  } catch (error) {
    console.error("Error saving sales percentage:", error);
    throw error;
  }
};

export const fetchSalesPercentage = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/porcentaje.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if(response.status === 404) return null;
      throw new Error('Network response was not ok');
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching sales percentage:", error);
    throw error;
  }
};

export const fetchAccountTotals = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const totalsRef = ref(db, `${LOCAL_ID}/RESUMEN_CUENTA/TOTALES`);
  try {
    const snapshot = await get(totalsRef);
    return snapshot.exists() ? snapshot.val() : { totalCommission: 0, totalSales: 0 };
  } catch (error) {
    console.error("Error fetching account totals:", error);
    throw error;
  }
};

const getNextPaymentId = async (db, localId) => {
  const counterRef = ref(db, `${localId}/CONTADORES/pagosComisiones`);
  const { committed, snapshot } = await runTransaction(counterRef, (currentValue) => {
    return (currentValue || 0) + 1;
  });

  if (!committed) {
    throw new Error("No se pudo obtener el siguiente ID de pago.");
  }
  return snapshot.val();
};

export const processCommissionPayment = async (paymentAmount) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();

    const totalsRef = ref(db, `${LOCAL_ID}/RESUMEN_CUENTA/TOTALES`);
    const accountSummaryRef = ref(db, `${LOCAL_ID}/RESUMEN_CUENTA`);

    try {
        const accountSummarySnapshot = await get(accountSummaryRef);
        const accountSummaryData = accountSummarySnapshot.exists() ? accountSummarySnapshot.val() : {};
        
        const salesToArchive = { ...accountSummaryData };
        if(salesToArchive.PAGO) delete salesToArchive.PAGO;
        if(salesToArchive.VENTAS_COMISION) delete salesToArchive.VENTAS_COMISION;
        if(salesToArchive.TOTALES) delete salesToArchive.TOTALES;


        if (Object.keys(salesToArchive).length > 0) {
            const newPaymentId = await getNextPaymentId(db, LOCAL_ID);
            const paymentRef = ref(db, `${LOCAL_ID}/PAGOS_COMISIONES/${newPaymentId}`);
            
            await set(paymentRef, {
                id: newPaymentId,
                paymentDate: new Date().toISOString(),
                paymentAmount: paymentAmount,
                sales: salesToArchive
            });
        }

        await runTransaction(totalsRef, (currentTotals) => {
            if (currentTotals) {
                const currentCommission = currentTotals.totalCommission || 0;
                
                if (paymentAmount >= currentCommission) {
                    currentTotals.totalCommission = 0;
                } else {
                    currentTotals.totalCommission = currentCommission - paymentAmount;
                }
                
                currentTotals.totalSales = 0;
                currentTotals.lastPayment = {
                    amount: paymentAmount,
                    date: new Date().toISOString(),
                };
            } else {
                return {
                    totalCommission: 0,
                    totalSales: 0,
                    lastPayment: {
                        amount: paymentAmount,
                        date: new Date().toISOString(),
                    }
                };
            }
            return currentTotals;
        });

        const updates = {};
        for (const key in salesToArchive) {
            if (key !== 'PAGO' && key !== 'VENTAS_COMISION' && key !== 'TOTALES') {
              updates[key] = null;
            }
        }
        if(Object.keys(updates).length > 0) {
            await update(accountSummaryRef, updates);
        }

        return { success: true };
    } catch (error) {
        console.error("Error processing commission payment:", error);
        throw error;
    }
};

export const saveWhatsAppPreference = async (preference) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const prefRef = ref(db, `${LOCAL_ID}/CONFIGURACION/whatsappPreference`);
  try {
    await set(prefRef, preference);
  } catch (error) {
    console.error("Error saving WhatsApp preference:", error);
    throw error;
  }
};

export const fetchWhatsAppPreference = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/whatsappPreference.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
        if(response.status === 404) return 'web';
        throw new Error('Network response was not ok');
    }
    const data = await response.json();
    return data || 'web';
  } catch (error) {
    console.error("Error fetching WhatsApp preference:", error);
    return 'web';
  }
};