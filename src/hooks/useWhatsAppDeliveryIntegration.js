import { useState, useCallback } from 'react';
import { extractOrderDataForWhatsApp } from '@/lib/api/ordersApi';
import { generateDeliveryWhatsAppMessage } from '@/lib/whatsapp/deliveryMessageFormatter';
import { openWhatsAppWithMessage } from '@/lib/whatsapp/whatsappHandler';

export const useWhatsAppDeliveryIntegration = () => {
  const [isSending, setIsSending] = useState(false);

  const sendWhatsAppMessage = useCallback(async (order, settings = null) => {
    if (!order) return false;
    setIsSending(true);
    try {
      const waData = extractOrderDataForWhatsApp(order);
      if (waData && waData.clientPhone) {
        // Generates the final message, inherently incorporating the custom web configuration setting
        const msg = generateDeliveryWhatsAppMessage(waData, settings);
        openWhatsAppWithMessage(waData.clientPhone, msg, settings?.whatsappPreference);
        return true;
      }
      return false;
    } catch (error) {
      console.error("WhatsApp integration error:", error);
      return false;
    } finally {
      setIsSending(false);
    }
  }, []);

  return { sendWhatsAppMessage, isSending };
};