import { toast } from '@/components/ui/use-toast';
import { generatePaymentMethodMessage } from './paymentMethodMessageFormatter';
import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';

// En Electron se usa shell.openExternal vía IPC.
// En el navegador se usa window.open como fallback.
const openUrl = (url) => {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
};

export const openWhatsApp = async (phoneNumber, messagePromiseOrString = '', preference = 'web') => {
  try {
    const resolvedMessage = await Promise.resolve(messagePromiseOrString);
    const phone = phoneNumber ? String(phoneNumber).replace(/\D/g, '') : '';
    const processedMessage = typeof resolvedMessage === 'string' ? resolvedMessage.trim() : '';
    const text = processedMessage ? `&text=${encodeURIComponent(processedMessage)}` : '';

    if (preference === 'app') {
      const appUrl = phone
        ? `whatsapp://send?phone=${phone}${text}`
        : `whatsapp://send?${text.substring(1)}`;
      openUrl(appUrl);
    } else {
      const webUrl = phone
        ? `https://web.whatsapp.com/send?phone=${phone}${text}`
        : `https://web.whatsapp.com/send?${text.substring(1)}`;
      openUrl(webUrl);
    }
  } catch (error) {
    console.error("Error formatting WhatsApp message:", error);
  }
};

export const openWhatsAppWithMessage = async (phoneNumber, messagePromiseOrString, preference = 'web') => {
  try {
    const resolvedMessage = await Promise.resolve(messagePromiseOrString);
    const phone = phoneNumber ? String(phoneNumber).replace(/\D/g, '') : '';
    const processedMessage = typeof resolvedMessage === 'string' ? resolvedMessage.trim() : '';
    const text = processedMessage ? `&text=${encodeURIComponent(processedMessage)}` : '';

    if (preference === 'app') {
      const appUrl = phone
        ? `whatsapp://send?phone=${phone}${text}`
        : `whatsapp://send?${text.substring(1)}`;
      openUrl(appUrl);
    } else {
      const webUrl = phone
        ? `https://web.whatsapp.com/send?phone=${phone}${text}`
        : `https://web.whatsapp.com/send?${text.substring(1)}`;
      openUrl(webUrl);
    }
  } catch (error) {
    console.error("Error formatting WhatsApp message:", error);
  }
};

export const openWhatsAppWithPaymentMessage = async (orderId, clientName, clientPhone, localId, preference = 'web') => {
  try {
    if (!clientPhone) {
      toast({
        variant: "destructive",
        title: "Sin teléfono",
        description: "El cliente no tiene un teléfono registrado."
      });
      return;
    }

    const currentLocalId = localId || getCurrentLocalId();
    const db = getDatabase();

    let exactPaymentMethod = null;
    try {
      const methodRef = ref(db, `${currentLocalId}/PEDIDOS/${orderId}/paid/method`);
      const methodSnap = await get(methodRef);
      if (methodSnap.exists()) {
        exactPaymentMethod = methodSnap.val();
      }
    } catch (e) {
      console.error("Could not fetch exact payment method:", e);
    }

    const message = await generatePaymentMethodMessage(orderId, clientName, currentLocalId, exactPaymentMethod);
    await openWhatsAppWithMessage(clientPhone, message, preference);
  } catch (error) {
    console.error("Error generating payment message:", error);
    toast({
      variant: "destructive",
      title: "Error",
      description: "No se pudo generar el mensaje de WhatsApp."
    });
  }
};
