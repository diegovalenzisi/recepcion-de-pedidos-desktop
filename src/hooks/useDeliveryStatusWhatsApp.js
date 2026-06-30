import { useEffect, useRef } from 'react';
import { generateEnDeliveryWhatsAppMessage } from '@/lib/whatsapp/deliveryMessageFormatter';
import { useWhatsAppPreference } from '@/hooks/useWhatsAppPreference';
import { openWhatsApp } from '@/lib/whatsapp/whatsappHandler';
import { getLocalWhatsAppPreference } from '@/hooks/useLocalWhatsAppPreference';
import { wasWaRecentlySent } from '@/lib/whatsapp/waTracker';

export const useDeliveryStatusWhatsApp = (orders) => {
  const previousStatuses = useRef(new Map());
  const isInitialized = useRef(false);
  const { preference, loading } = useWhatsAppPreference();

  useEffect(() => {
    if (loading) return; 
    if (!orders || orders.length === 0) return;

    if (!isInitialized.current) {
      orders.forEach(order => {
        previousStatuses.current.set(order.id, order.status?.main);
      });
      isInitialized.current = true;
      return;
    }

    const checkStatuses = async () => {
      const isLocalWhatsAppEnabled = getLocalWhatsAppPreference();

      for (const order of orders) {
        const currentStatus = order.status?.main;
        const prevStatus = previousStatuses.current.get(order.id);
        
        if (currentStatus === 'EN DELIVERY' && prevStatus !== 'EN DELIVERY') {
          if (wasWaRecentlySent(order.id)) {
            // Manual send already happened (e.g., from AssignDelivererModal checkbox) — skip auto-open to avoid duplicate
          } else if (isLocalWhatsAppEnabled) {
            try {
              const message = await generateEnDeliveryWhatsAppMessage(order);
              const phoneStr = order.client?.phone || order.cliente?.telefono || '';

              if (phoneStr) {
                await openWhatsApp(phoneStr, message, preference);
              } else {
                console.warn(`No phone number found for order ${order.id}`);
              }
            } catch (error) {
              console.error("Error triggering WhatsApp for delivery status:", error);
            }
          } else {
            console.log("WhatsApp status handler: Auto-open is disabled locally for this PC. Status transitioned, but not opening WhatsApp.");
          }
        }

        previousStatuses.current.set(order.id, currentStatus);
      }
    };

    checkStatuses();
  }, [orders, preference, loading]);
};