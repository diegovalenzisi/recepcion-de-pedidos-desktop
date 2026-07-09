import { getDatabase, ref, set } from 'firebase/database';
import { getLocationSpecificDatabasePath } from '@/lib/firebase/core';

/**
 * Saves invoice data specifically for cash payments
 * @param {string} localId - The local business ID
 * @param {object} invoiceData - The complete invoice data
 * @returns {Promise<{success: boolean, id: string}>}
 */
export const saveInvoiceForCashPayment = async (localId, invoiceData) => {
  if (!localId || !invoiceData) {
    throw new Error('Faltan parámetros requeridos para guardar la factura.');
  }

  const db = getDatabase();
  // Raíz oficial del local: databasePath (fallback a localId). El caller pasa el
  // localId real; el mapeo interno evita que tenga que saber sobre databasePath.
  const rootPath = getLocationSpecificDatabasePath(localId);
  // Generate a unique ID using timestamp and a random string
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  const invoiceId = invoiceData.invoiceNumber || `INV-${timestamp}-${randomStr}`;

  try {
    const invoiceRef = ref(db, `${rootPath}/FACTURACION_EFECTIVO/${invoiceId}`);
    
    const finalData = {
      ...invoiceData,
      id: invoiceId,
      createdAt: new Date().toISOString()
    };

    await set(invoiceRef, finalData);
    
    return { success: true, id: invoiceId };
  } catch (error) {
    console.error("Error saving cash invoice:", error);
    throw error;
  }
};