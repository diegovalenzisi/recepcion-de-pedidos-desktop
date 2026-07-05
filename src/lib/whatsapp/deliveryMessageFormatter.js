import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { findAccountByExactPaymentMethod } from '@/lib/api/accountsApi';
import { extractDelivererName } from '@/lib/firebase/fieldMapping';
import { buildDelivererAssignedMessage } from '@/lib/whatsapp/paymentMessage';

/**
 * Generates a WhatsApp message for payment confirmation
 * @param {Object} orderData - Order information
 * @param {Object} deliverer - Optional deliverer object with nombre property
 * @returns {Promise<string>} Formatted WhatsApp message
 */
export const generateDeliveryWhatsAppMessage = async (orderData, deliverer = null) => {
  if (!orderData) {
    console.error("[WhatsApp] No order data provided");
    return '';
  }

  const localId = getCurrentLocalId();
  if (!localId) {
    console.error("[WhatsApp] Local ID is missing for message generation");
    return '';
  }

  const db = getDatabase();
  const orderNumber = orderData.orderNumber || orderData.id || orderData.numero;
  const clientName = orderData.clientName || orderData.client?.name || orderData.cliente?.nombre || 'Cliente';
  
  console.log(`[WhatsApp] Generating payment message for order #${orderNumber}, client: ${clientName}`);

  let paymentMethod = orderData.payment?.method || orderData.paid?.method || orderData.metodoPago;
  
  if (!paymentMethod && orderData.pagos && orderData.pagos.length > 0) {
      paymentMethod = orderData.pagos[0].method;
  }

  if (!paymentMethod) {
      try {
        const paymentMethodPath = `${localId}/PEDIDOS/${orderNumber}/payment/method`;
        const paidMethodPath = `${localId}/PEDIDOS/${orderNumber}/paid/method`;
        
        let methodSnap = await get(ref(db, paymentMethodPath));
        if (methodSnap.exists()) {
          paymentMethod = methodSnap.val();
        } else {
          methodSnap = await get(ref(db, paidMethodPath));
          if (methodSnap.exists()) {
            paymentMethod = methodSnap.val();
          }
        }
        
        if (!paymentMethod) {
          paymentMethod = 'EFECTIVO';
        }
      } catch (error) {
        console.error("[WhatsApp] Error fetching payment method from Firebase:", error);
        paymentMethod = 'EFECTIVO';
      }
  }

  const isCashPayment = paymentMethod && paymentMethod.toUpperCase() === 'EFECTIVO';

  if (isCashPayment) {
    return `Hola *${clientName}*, te hablamos desde la heladería por tu pedido #${orderNumber}.`;
  }
  
  try {
    const account = await findAccountByExactPaymentMethod(localId, paymentMethod);
    
    if (!account) {
      return `Hola *${clientName}*, te hablamos desde la heladería por tu pedido #${orderNumber}.\n\nPor favor envía el pago por *${paymentMethod}*.\n\nUna vez recibamos el comprobante, comenzaremos a armarlo.\n\n¡Gracias!`;
    }

    const alias = account.alias || 'No configurado';
    const aNombreDe = account.aNombreDe || 'No configurado';
    
    return `Hola *${clientName}*, te hablamos desde la heladería por tu pedido #${orderNumber}.\n\nPor favor envía el pago a: *${alias}*\nA nombre de: *${aNombreDe}*\n\nUna vez recibamos el comprobante, comenzaremos a armarlo.\n\n¡Gracias!`;
    
  } catch (error) {
    console.error("[WhatsApp] Error fetching account details:", error);
    return `Hola *${clientName}*, te hablamos desde la heladería por tu pedido #${orderNumber}.\n\nPor favor envía el pago por *${paymentMethod}*.\n\nUna vez recibamos el comprobante, comenzaremos a armarlo.\n\n¡Gracias!`;
  }
};

/**
 * Generates a WhatsApp message for EN DELIVERY status with deliverer information
 * @param {Object} orderData - Order information
 * @param {Object} deliverer - Optional deliverer object with nombre and apellido properties
 * @returns {Promise<string>} Formatted WhatsApp message with deliverer name
 */
export const generateEnDeliveryWhatsAppMessage = async (orderData, deliverer = null) => {
  if (!orderData) {
    console.error("[WhatsApp] No order data provided for EN DELIVERY status message");
    return '';
  }

  const localId = getCurrentLocalId();
  const db = getDatabase();
  const orderNumber = orderData.orderNumber || orderData.id || orderData.numero || '';
  const clientName = orderData.clientName || orderData.client?.name || orderData.cliente?.nombre || 'Cliente';
  
  let delivererName = null;

  // Priority 1: Use deliverer parameter passed directly to the function
  if (deliverer && deliverer.nombre) {
    delivererName = `${deliverer.nombre} ${deliverer.apellido || ''}`.trim();
    console.log(`[WhatsApp] Using deliverer from parameter: ${delivererName}`);
  }

  // Priority 2: Extract from order data structure using the centralized utility that checks 'deliverer' and 'repartidor' keys
  if (!delivererName) {
    const extractedName = extractDelivererName(orderData);
    if (extractedName && extractedName !== 'Sin asignar') {
      delivererName = extractedName;
      console.log(`[WhatsApp] Using deliverer extracted from orderData: ${delivererName}`);
    }
  }

  // Priority 3: Fetch from Firebase as fallback
  if (!delivererName && localId && orderNumber) {
    try {
      console.log(`[WhatsApp] Attempting to fetch deliverer name from Firebase for order #${orderNumber}`);
      
      // First try the 'repartidor' path
      const repartidorRef = ref(db, `${localId}/PEDIDOS/${orderNumber}/repartidor`);
      const repSnap = await get(repartidorRef);
      if (repSnap.exists()) {
        const repVal = repSnap.val();
        if (typeof repVal === 'object' && repVal !== null && repVal.nombre) {
          delivererName = repVal.nombre;
        } else if (typeof repVal === 'string' && repVal.trim() !== '') {
          delivererName = repVal;
        }
        
        if (delivererName) {
          console.log(`[WhatsApp] Fetched deliverer from Firebase 'repartidor' path: ${delivererName}`);
        }
      }
      
      // Try deliverer/nombre path if still not found
      if (!delivererName) {
        const delivererNombreRef = ref(db, `${localId}/PEDIDOS/${orderNumber}/deliverer/nombre`);
        const nombreSnapshot = await get(delivererNombreRef);
        
        if (nombreSnapshot.exists()) {
          const nombre = nombreSnapshot.val();
          
          // Try to get apellido as well
          const delivererApellidoRef = ref(db, `${localId}/PEDIDOS/${orderNumber}/deliverer/apellido`);
          const apellidoSnapshot = await get(delivererApellidoRef);
          const apellido = apellidoSnapshot.exists() ? apellidoSnapshot.val() : '';
          
          delivererName = `${nombre} ${apellido}`.trim();
          console.log(`[WhatsApp] Fetched deliverer from Firebase deliverer path: ${delivererName}`);
        }
      }
      
      // Fallback to delivery/name path
      if (!delivererName) {
        const deliveryNameRef = ref(db, `${localId}/PEDIDOS/${orderNumber}/delivery/name`);
        const nameSnapshot = await get(deliveryNameRef);
        
        if (nameSnapshot.exists()) {
          delivererName = nameSnapshot.val();
          console.log(`[WhatsApp] Fetched deliverer from Firebase delivery path: ${delivererName}`);
        }
      }
    } catch (error) {
      console.error("[WhatsApp] Error fetching deliverer name from Firebase:", error);
    }
  }

  // Final fallback if no deliverer information is available
  if (!delivererName) {
    delivererName = 'nuestro repartidor';
    console.warn(`[WhatsApp] No deliverer information found for order #${orderNumber}, using fallback: "${delivererName}"`);
  }

  console.log(`[WhatsApp] Generating EN DELIVERY message for order #${orderNumber}, client: ${clientName}, deliverer: ${delivererName}`);

  // Plantilla editable desde Configuración web → Mensaje al Asignar Repartidor
  // (LOCAL_ID/CONFIGURACION/web/assignDelivererMessage). Si está vacía, el helper
  // usa DEFAULT_ASSIGN_DELIVERER_MESSAGE. Reemplaza {cliente} {numero} {total}
  // {repartidor} {direccion}. Usada por los 5 flujos de asignación/EN DELIVERY.
  let template = '';
  try {
    if (localId) {
      const tplSnap = await get(ref(db, `${localId}/CONFIGURACION/web/assignDelivererMessage`));
      if (tplSnap.exists()) template = tplSnap.val() || '';
    }
  } catch (error) {
    console.error('[WhatsApp] Error leyendo assignDelivererMessage:', error);
  }

  return buildDelivererAssignedMessage({
    order: orderData,
    template,
    deliverer: delivererName,
  });
};