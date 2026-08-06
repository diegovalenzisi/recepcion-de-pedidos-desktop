import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, getCurrentDatabaseOrThrow, beginFirebaseOperation } from '@/lib/firebase/core';
import { getDatabase, ref, set, get, runTransaction, update, onValue, off } from 'firebase/database';
import { registrarPagoComision } from '@/lib/api/comisionesApi';

export const fetchSettings = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
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
    const LOCAL_ID = getCurrentDatabasePath();
    // getCurrentDatabaseOrThrow() en vez de getDatabase() a secas: nunca se
    // suscribe contra el local anterior ni contra una app a medio inicializar
    // (el caller en App.jsx ya espera a firebaseReadiness.ready, pero esto
    // protege también a cualquier otro caller futuro de este export).
    let db;
    try {
      db = getCurrentDatabaseOrThrow();
    } catch (e) {
      console.warn('[listenToChanges] Firebase todavía no está listo, no se suscribe:', e.message);
      return () => {};
    }
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
    const localId = getCurrentDatabasePath();
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
  const LOCAL_ID = getCurrentDatabasePath();
  // getCurrentDatabaseOrThrow() en vez de getDatabase() a secas: este export
  // es llamado por callers que hacen un await real ANTES (ej. AppInfoManager
  // sube un ícono/logo a Storage y recién después llama a saveSettings) —
  // si el local cambió en el medio, esto tira FirebaseNotReadyError en vez
  // de escribir en la database equivocada.
  const db = getCurrentDatabaseOrThrow();
  const configRef = ref(db, `${LOCAL_ID}/CONFIGURACION`);
  
  const updates = {};

  // La configuración de comisión (porcentaje y límite de aviso) se guarda EXCLUSIVAMENTE
  // desde SalesPercentageManager con sus propios botones (saveSalesPercentage / saveAlarmaPago),
  // que escriben directo a CONFIGURACION/porcentaje y CONFIGURACION/alarmaPago.
  // El guardado general recibía estos valores desde un estado viejo (cargado al montar la
  // pantalla) y los pisaba. Los excluimos para no sobreescribir lo recién guardado.
  const COMMISSION_KEYS = new Set(['porcentaje', 'alarmaPago', 'salesPercentage']);

  // gridViewSettings (preferencias de Vista Cuadrilla) se guarda EXCLUSIVAMENTE desde
  // GridViewSettingsManager con saveGridViewSettings (escribe CONFIGURACION/gridViewSettings).
  // El guardado general recibía un gridViewSettings VIEJO desde el estado del padre (cargado al
  // montar la pantalla) y lo pisaba. Se excluye, igual que las claves de comisión.
  const DEDICATED_KEYS = new Set(['gridViewSettings']);

  for (const key in settingsData) {
    if (COMMISSION_KEYS.has(key)) continue;
    if (DEDICATED_KEYS.has(key)) continue;
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
  const LOCAL_ID = getCurrentDatabasePath();
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
  const LOCAL_ID = getCurrentDatabasePath();
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
  const LOCAL_ID = getCurrentDatabasePath();
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
    const LOCAL_ID = getCurrentDatabasePath();
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
  const LOCAL_ID = getCurrentDatabasePath();
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
  const LOCAL_ID = getCurrentDatabasePath();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/porcentaje.json`;

  console.log('[porcentaje ventas] localId:', LOCAL_ID);
  console.log('[porcentaje ventas] valor input:', percentage);
  console.log('[porcentaje ventas] valor convertido:', Number(percentage));
  console.log('[porcentaje ventas] ruta firebase:', url);
  console.log('[porcentaje ventas] payload:', JSON.stringify(Number(percentage)));

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Number(percentage)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[porcentaje ventas] ERROR REAL: HTTP', response.status, errorText);
      console.error('[porcentaje ventas] ERROR CODE:', response.status);
      console.error('[porcentaje ventas] ERROR MESSAGE:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('[porcentaje ventas] guardado OK, respuesta firebase:', result);
  } catch (error) {
    console.error('[porcentaje ventas] ERROR REAL:', error);
    console.error('[porcentaje ventas] ERROR CODE:', error?.code);
    console.error('[porcentaje ventas] ERROR MESSAGE:', error?.message);
    throw error;
  }
};

export const fetchSalesPercentage = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
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

export const fetchCommissionTotals = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();

  const [totalsSnap, pagosSnap] = await Promise.all([
    get(ref(db, `${LOCAL_ID}/RESUMEN_CUENTA/TOTALES`)),
    get(ref(db, `${LOCAL_ID}/PAGOS_COMISIONES`)),
  ]);

  const totalsVal = totalsSnap.exists() ? totalsSnap.val() : {};
  // Usar TotalComisionAPagar si existe, sino caer en totalCommission (compatibilidad)
  const aPagar = totalsVal.TotalComisionAPagar ?? totalsVal.totalCommission ?? 0;

  let totalPagado = 0;
  if (pagosSnap.exists()) {
    pagosSnap.forEach(child => {
      totalPagado += child.val()?.paymentAmount || 0;
    });
  }

  return {
    generado: aPagar + totalPagado,
    pagado: totalPagado,
    aPagar, // = TotalComisionAPagar
  };
};

export const fetchAccountTotals = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
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

export const processCommissionPayment = async (paymentAmount, responsable = 'Sistema') => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    // Un solo "op" para todo el pago: hay varios await reales (lectura del
    // resumen, getNextPaymentId) antes de cada una de las tres escrituras
    // definitivas de abajo. Se revalida antes de cada una.
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

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
            const paymentRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/PAGOS_COMISIONES/${newPaymentId}`);

            await set(paymentRef, {
                id: newPaymentId,
                paymentDate: new Date().toISOString(),
                paymentAmount: paymentAmount,
                sales: salesToArchive
            });
        }

        const totalsRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/RESUMEN_CUENTA/TOTALES`);
        await runTransaction(totalsRef, (currentTotals) => {
            if (currentTotals) {
                const currentCommission = currentTotals.totalCommission || 0;
                const newCommission = paymentAmount >= currentCommission ? 0 : currentCommission - paymentAmount;
                currentTotals.totalCommission    = newCommission;
                currentTotals.TotalComisionAPagar = newCommission;
                currentTotals.totalSales = 0;
                currentTotals.lastPayment = {
                    amount: paymentAmount,
                    date: new Date().toISOString(),
                };
            } else {
                return {
                    totalCommission: 0,
                    TotalComisionAPagar: 0,
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
            const freshAccountSummaryRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/RESUMEN_CUENTA`);
            await update(freshAccountSummaryRef, updates);
        }

        // Marcar registros en COMISIONES/REGISTRO como pagados
        try {
            await registrarPagoComision(paymentAmount, responsable);
        } catch (err) {
            console.error('[COMISIONES] Error al registrar pago en COMISIONES/PAGOS:', err);
        }

        return { success: true };
    } catch (error) {
        console.error("Error processing commission payment:", error);
        throw error;
    }
};

export const saveWhatsAppPreference = async (preference) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  const prefRef = ref(db, `${LOCAL_ID}/CONFIGURACION/whatsappPreference`);
  try {
    await set(prefRef, preference);
  } catch (error) {
    console.error("Error saving WhatsApp preference:", error);
    throw error;
  }
};

export const fetchAlarmaPago = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/alarmaPago.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return 0;
      throw new Error('Network response was not ok');
    }
    const data = await response.json();
    return data !== null && data !== undefined ? Number(data) : 0;
  } catch (error) {
    console.error('Error fetching alarmaPago:', error);
    return 0;
  }
};

export const saveAlarmaPago = async (amount) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const FIREBASE_URL = getFirebaseUrl();
  const url = `${FIREBASE_URL}/${LOCAL_ID}/CONFIGURACION/alarmaPago.json`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Number(amount)),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
};

export const saveUpdateMetadata = async ({ version, url, nombreArchivo, fecha, obligatoria = true }) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  const updateRef = ref(db, `${LOCAL_ID}/actualizaciones`);
  await set(updateRef, {
    version: String(version).trim(),
    url,
    nombreArchivo,
    fecha: fecha || new Date().toISOString().split('T')[0],
    obligatoria,
  });
};

export const fetchWhatsAppPreference = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
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