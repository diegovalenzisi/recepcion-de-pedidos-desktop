import { useCallback } from 'react';
import { generateDeliveryWhatsAppMessage } from '@/lib/whatsapp/delivery';
import { openWhatsApp } from '@/lib/whatsapp/whatsappHandler';

export const useDeliveryWhatsApp = (accounts = [], autoOpenPreference = 'web', fetchedAlias = null) => {
  
  const sendWhatsApp = useCallback((order) => {
    if (!order) return;
    
    const client = order.client || order.cliente || {};
    const phone = client.phone || client.telefono || '';
    
    if (!phone) {
      console.warn("No phone number available to send WhatsApp");
      return;
    }

    // Se asegura de usar la función centralizada que no tiene textos hardcodeados
    const message = generateDeliveryWhatsAppMessage(order, accounts, null, fetchedAlias);
    
    openWhatsApp(phone, message, autoOpenPreference);
    
  }, [accounts, autoOpenPreference, fetchedAlias]);

  return { sendWhatsApp };
};