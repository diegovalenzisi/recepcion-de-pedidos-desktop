import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { listenToOrders, updateOrder } from '@/lib/api/ordersApi';
import { fetchAudioSetting, fetchOrderSoundVolume } from '@/lib/api/settingsApi';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

export const useOrderAlarm = (isUserLoggedIn) => {
  const { ready: firebaseReady } = useFirebaseReadiness();
  const [alarmingOrderIds, setAlarmingOrderIds] = useState([]);
  const audioRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const { toast } = useToast();

  const loadAudio = useCallback(async () => {
    let audioSrc = '/new-order-sound.mp3';
    try {
      const audioSettings = await fetchAudioSetting();
      audioSrc = audioSettings?.dataUrl || audioSrc;
    } catch (error) {
      console.error("Failed to load custom audio, using default.", error);
    }

    let volume = 1;
    try {
      const storedVolume = await fetchOrderSoundVolume();
      volume = Math.min(1, Math.max(0, storedVolume / 100));
    } catch (error) {
      console.error("Failed to load order sound volume, using default.", error);
    }

    if (typeof Audio !== 'undefined') {
      audioRef.current = new Audio(audioSrc);
      // We will manage looping manually, so loop is false.
      audioRef.current.loop = false;
      audioRef.current.volume = volume;
    }
  }, []);

  useEffect(() => {
    if (isUserLoggedIn) {
      loadAudio();
      const handleAudioUpdate = () => loadAudio();
      window.addEventListener('audioSettingsChanged', handleAudioUpdate);
      return () => {
        window.removeEventListener('audioSettingsChanged', handleAudioUpdate);
      };
    }
  }, [isUserLoggedIn, loadAudio]);

  const stopAlarm = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  const playAlarm = useCallback(() => {
    stopAlarm(); // Ensure no multiple alarms are running

    if (audioRef.current) {
      const playSound = () => {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(e => {
          if (e.name === 'NotAllowedError') {
            toast({
              title: "Permiso de audio requerido",
              description: "Por favor, haz clic en cualquier lugar de la página para activar las notificaciones de sonido.",
            });
            stopAlarm(); // Stop trying if not allowed.
          }
        });

        // Set a timeout to pause the sound after 1 second
        setTimeout(() => {
          if (audioRef.current && !audioRef.current.paused) {
            audioRef.current.pause();
          }
        }, 1000);
      };

      playSound(); // Play immediately
      alarmIntervalRef.current = setInterval(playSound, 3000); // Repeat every 3 seconds (1s play + 2s pause)
    }
  }, [stopAlarm, toast]);

  useEffect(() => {
    if (!isUserLoggedIn || !firebaseReady) return;

    const unsubscribe = listenToOrders((fetchedOrders) => {
      // FIX: Added optional chaining and existence checks to prevent "Cannot read properties of undefined"
      if (!fetchedOrders || !Array.isArray(fetchedOrders)) {
        setAlarmingOrderIds([]);
        return;
      }

      const newAlarmingOrders = fetchedOrders
        // Solo suenan los pedidos que llegan desde la web/app de clientes.
        // Los pedidos cargados manualmente en el desktop se marcan con origen:'manual'
        // (ver saveOrder en ordersApi.js) y NO deben hacer sonar la alarma.
        .filter(order => order?.status?.main === 'ACEPTADO' && !order?.status?.acknowledged && order?.origen !== 'manual')
        .map(order => order.id);
      
      setAlarmingOrderIds(newAlarmingOrders);
    }, (error) => {
      toast({ 
        variant: "destructive", 
        title: "Error de Conexión", 
        description: "No se pudo conectar a la base de datos en tiempo real." 
      });
    });

    return () => unsubscribe();
  }, [isUserLoggedIn, toast, firebaseReady]);

  useEffect(() => {
    if (alarmingOrderIds.length > 0) {
      playAlarm();
    } else {
      stopAlarm();
    }
    
    return () => stopAlarm();
  }, [alarmingOrderIds.length, playAlarm, stopAlarm]);
  
  const acknowledgeOrder = async (orderId) => {
    try {
      await updateOrder(orderId, { 'status/acknowledged': true });
      // The state will update automatically via the listener, no need to manually set it.
    } catch (error) {
      console.error("Failed to acknowledge order:", error);
      toast({ variant: "destructive", title: "Error", description: "No se pudo marcar el pedido como visto." });
    }
  };
  
  // This component doesn't render anything, it's just for the hook to use.
  const AlarmAudio = () => null;

  return { alarmingOrderIds, acknowledgeOrder, AlarmAudio };
};