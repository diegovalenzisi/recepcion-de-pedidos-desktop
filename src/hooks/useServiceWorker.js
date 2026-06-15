import { useState, useEffect, useCallback, useRef } from 'react';
import { Workbox } from 'workbox-window';

// Cada cuánto se chequea si hay un Service Worker nuevo en el servidor.
const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;

export const useServiceWorker = () => {
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState(null);
  // Evita recargar más de una vez si "controllerchange" se dispara varias veces.
  const refreshingRef = useRef(false);

  const onUpdate = useCallback((wb) => {
    setShowUpdateNotification(true);
    setWaitingWorker(wb.waiting);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const wb = new Workbox('/sw.js');

    wb.addEventListener('waiting', () => onUpdate(wb));
    wb.addEventListener('externalwaiting', () => onUpdate(wb));

    const handleControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    wb.register();

    // Revisa periódicamente si hay una versión nueva publicada. Si la hay,
    // dispara el evento "waiting" y se muestra el aviso de actualización;
    // no recarga nada por sí sola.
    const intervalId = setInterval(() => {
      wb.update();
    }, UPDATE_CHECK_INTERVAL);

    return () => {
      clearInterval(intervalId);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, [onUpdate]);

  // El usuario decide cuándo actualizar: esto le pide al Service Worker en
  // espera que tome control. El reload real ocurre en "controllerchange".
  const reloadPage = useCallback(() => {
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    setShowUpdateNotification(false);
  }, [waitingWorker]);

  return { showUpdateNotification, waitingWorker, reloadPage };
};