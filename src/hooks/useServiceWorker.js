import { useState, useEffect, useCallback } from 'react';
import { Workbox } from 'workbox-window';

export const useServiceWorker = () => {
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState(null);

  const onUpdate = useCallback((wb) => {
    setShowUpdateNotification(true);
    setWaitingWorker(wb.waiting);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.workbox !== undefined) {
      const wb = new Workbox('/sw.js');
      
      wb.addEventListener('waiting', () => onUpdate(wb));
      wb.addEventListener('externalwaiting', () => onUpdate(wb));

      wb.register();
    }
  }, [onUpdate]);

  const reloadPage = useCallback(() => {
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    setShowUpdateNotification(false);
    window.location.reload(true);
  }, [waitingWorker]);

  return { showUpdateNotification, waitingWorker, reloadPage };
};