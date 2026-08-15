import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { getDatabase, ref, push, set, get, runTransaction } from 'firebase/database';
import { formatDateForFirebase, getOperationalDate } from '@/lib/utils';
import { openWhatsApp } from '@/lib/whatsapp/whatsappHandler';
import { findAccountByExactPaymentMethod } from '@/lib/api/accountsApi';

export const savePrepayment = async (type, amount) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  if (!LOCAL_ID) throw new Error("Local ID no configurado");

  const db = getDatabase();
  const dbType = claveDePrepago(type.replace(' ', '_')); 
  const prepaymentsRef = ref(db, `${LOCAL_ID}/${dbType}`);
  const newRef = push(prepaymentsRef);
  
  const now = new Date();
  const record = {
    id: newRef.key,
    type,
    fecha: formatDateForFirebase(getOperationalDate(now)),
    hora: now.toLocaleTimeString('es-AR', { hour12: false }),
    monto: Number(amount),
    timestamp: now.getTime()
  };

  await set(newRef, record);
  return record;
};

/**
 * Nombre del nodo de un prepago, apto para Firebase.
 *
 * Realtime Database NO admite `.` `$` `#` `[` `]` `/` en una clave, y el tercer
 * prepago se llama "PREPAGO M.PAGO": derivar la clave de su nombre visible daría
 * `PREPAGO_M.PAGO`, una ruta inválida. Se saca el punto y queda `PREPAGO_MPAGO`,
 * que es exactamente lo que escriben mostrador y delivery.
 *
 * Para PEDIDOSYA y RAPPI es un NO-OP: sus nombres no tienen puntos, así que
 * siguen produciendo `PREPAGO_PEDIDOSYA` y `PREPAGO_RAPPI` byte a byte.
 */
const claveDePrepago = (nombre) => String(nombre ?? '').replace(/[.$#[\]/]/g, '');

export const savePrepaymentForApp = async (appType, amount, currentShiftDate) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  if (!LOCAL_ID) throw new Error("Local ID no configurado");

  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();
  const dbType = claveDePrepago(`PREPAGO_${appType.toUpperCase()}`);

  if (!currentShiftDate) throw new Error("currentShiftDate (DDMMAAAA) es requerido");

  const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/${dbType}_${currentShiftDate}`);
  const { committed, snapshot } = await runTransaction(counterRef, (currentValue) => {
    return (currentValue || 0) + 1;
  });

  if (!committed) {
    throw new Error("No se pudo generar el número de prepago.");
  }

  const numero = snapshot.val();
  // Revalida antes del set() definitivo: la transacción de arriba fue un await real.
  const prepaymentsRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/${dbType}/${currentShiftDate}/${numero}`);
  
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const record = {
    numero,
    hora: `${hours}:${minutes}:${seconds}`,
    monto: Number(amount),
    timestamp: now.getTime()
  };

  await set(prepaymentsRef, record);
  return record;
};

export const fetchPrepayments = async (type) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  if (!LOCAL_ID) return [];

  const db = getDatabase();
  const dbType = claveDePrepago(type.replace(' ', '_'));
  const prepaymentsRef = ref(db, `${LOCAL_ID}/${dbType}`);
  
  const snapshot = await get(prepaymentsRef);
  if (!snapshot.exists()) return [];

  const data = snapshot.val();
  const allRecords = [];
  
  Object.entries(data).forEach(([key, dateNodeOrRecord]) => {
    if (typeof dateNodeOrRecord === 'object' && !dateNodeOrRecord.monto) {
      const formattedDate = key.length === 8 
        ? `${key.slice(0,2)}-${key.slice(2,4)}-${key.slice(4,8)}` 
        : key;

      Object.entries(dateNodeOrRecord).forEach(([recordKey, record]) => {
        allRecords.push({
          ...record,
          id: recordKey,
          numero: record.numero || (isNaN(recordKey) ? null : Number(recordKey)),
          fecha: record.fecha || formattedDate,
          type: type
        });
      });
    } else {
      allRecords.push({
        ...dateNodeOrRecord,
        id: dateNodeOrRecord.id || key,
        numero: dateNodeOrRecord.numero || null
      });
    }
  });
  
  return allRecords.sort((a, b) => {
    if (a.timestamp && b.timestamp) return b.timestamp - a.timestamp;
    if (a.numero && b.numero) return b.numero - a.numero;
    return 0;
  });
};

export const fetchPrepaymentsByDateRange = async (type, startDate, endDate) => {
  const allRecords = await fetchPrepayments(type);
  if (!startDate || !endDate) return allRecords;
  
  const startTimestamp = startDate.setHours(0,0,0,0);
  const endTimestamp = endDate.setHours(23,59,59,999);
  
  return allRecords.filter(record => {
    if (record.timestamp) {
      return record.timestamp >= startTimestamp && record.timestamp <= endTimestamp;
    }
    return true; 
  });
};

export const sendPrepaymentWhatsApp = async (order, phoneNumber, preference = 'web') => {
  try {
    const clientName = order?.client?.name || order?.cliente?.nombre || order?.nombreCliente || 'Cliente';
    const orderId = order?.id || order?.numero || order?.orderNumber || '';
    
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();
    
    // Read the payment method strictly from paid/method
    const methodRef = ref(db, `${LOCAL_ID}/PEDIDOS/${orderId}/paid/method`);
    const methodSnap = await get(methodRef);
    const paymentMethod = methodSnap.exists() ? methodSnap.val() : null;
    
    let alias = 'No configurado';
    let aNombreDe = 'No configurado';
    
    if (paymentMethod) {
      const account = await findAccountByExactPaymentMethod(LOCAL_ID, paymentMethod);
      if (account) {
        alias = account.alias || alias;
        aNombreDe = account.aNombreDe || aNombreDe;
      }
    }
    
    const message = `Hola *${clientName}*, te hablamos desde la heladería por tu pedido #${orderId}.\n\nPor favor envía el pago a: *${alias}*\nA nombre de: *${aNombreDe}*\n\nUna vez recibamos el comprobante, comenzaremos a armarlo.\n\n¡Gracias!`;
    
    const phone = phoneNumber || order?.client?.phone || order?.cliente?.telefono || '';
    
    if (!phone) {
      console.warn("No phone number provided for WhatsApp message.");
      throw new Error("No phone number provided");
    }
    
    openWhatsApp(phone, message, preference);
    return { success: true, message };
  } catch (error) {
    console.error("Error sending prepayment WhatsApp:", error);
    throw error;
  }
};