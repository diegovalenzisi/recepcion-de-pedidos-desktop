import { useState, useEffect, useCallback } from 'react';
import { 
  getLastDelivererMessage, 
  listenToDelivererMessage, 
  saveLastDelivererMessage, 
  updateDelivererMessage, 
  deleteDelivererMessage 
} from '@/lib/api/whatsappMessageApi';

export function useWhatsAppMessageStorage(delivererId) {
  const [messageData, setMessageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!delivererId) {
      setMessageData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = listenToDelivererMessage(delivererId, (data) => {
      setMessageData(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [delivererId]);

  const saveMessage = useCallback(async (text) => {
    if (!delivererId) return;
    try {
      setLoading(true);
      await saveLastDelivererMessage(delivererId, text);
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [delivererId]);

  const updateMessage = useCallback(async (text) => {
    if (!delivererId) return;
    try {
      setLoading(true);
      await updateDelivererMessage(delivererId, text);
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [delivererId]);

  const clearMessage = useCallback(async () => {
    if (!delivererId) return;
    try {
      setLoading(true);
      await deleteDelivererMessage(delivererId);
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [delivererId]);

  return {
    messageData,
    lastMessage: messageData?.lastMessage || '',
    loading,
    error,
    saveMessage,
    updateMessage,
    clearMessage
  };
}