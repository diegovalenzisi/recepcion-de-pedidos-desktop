import { getDatabase, ref, get } from 'firebase/database';
import { findAccountByExactPaymentMethod } from '@/lib/api/accountsApi';

export const generatePaymentMethodMessage = async (orderId, clientName, localId) => {
  const db = getDatabase();
  let paymentMethod = 'Efectivo';

  // Read exact payment method from the order
  try {
    let methodRef = ref(db, `${localId}/PEDIDOS/${orderId}/payment/method`);
    let methodSnap = await get(methodRef);
    
    if (!methodSnap.exists() || !methodSnap.val()) {
      // Fallback just in case it's stored under paid/method
      methodRef = ref(db, `${localId}/PEDIDOS/${orderId}/paid/method`);
      methodSnap = await get(methodRef);
    }
    
    if (methodSnap.exists() && methodSnap.val()) {
      paymentMethod = methodSnap.val();
    }
  } catch (error) {
    console.error("Error fetching exact payment method for WhatsApp message:", error);
  }

  // Handle EFECTIVO specifically
  if (paymentMethod.toUpperCase() === 'EFECTIVO') {
    return `Hola ${clientName}, te hablamos desde la heladería por tu pedido #${orderId}.`;
  }

  let alias = 'No configurado';
  let aNombreDe = 'No configurado';

  // Search for the exact matching account
  try {
    const exactAccount = await findAccountByExactPaymentMethod(localId, paymentMethod);
    if (exactAccount) {
      alias = exactAccount.alias || alias;
      aNombreDe = exactAccount.aNombreDe || aNombreDe;
    }
  } catch (error) {
    console.error("Error fetching exact account for WhatsApp message:", error);
  }

  return `Hola *${clientName}*, te hablamos desde la heladería por tu pedido #${orderId}.\n\nPor favor envía el pago a: *${alias}*\nA nombre de: *${aNombreDe}*\n\nUna vez recibamos el comprobante, comenzaremos a armarlo.\n\n¡Gracias!`;
};