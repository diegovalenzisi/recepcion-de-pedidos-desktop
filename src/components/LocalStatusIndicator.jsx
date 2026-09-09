import React, { useState, useEffect, useCallback } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { saveSettings } from '@/lib/api/settingsApi';
import { toast } from '@/components/ui/use-toast';
import { getCurrentDatabaseOrThrow } from '@/lib/firebase/core';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';
import { calcularEstadoRecepcion } from '@/lib/utils/horarioComercio';

const LocalStatusIndicator = ({ settings }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isManualClose, setIsManualClose] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  // Este componente solo se monta cuando App.jsx ya salió de la pantalla de
  // "Cambiando de local…"/carga (ver App.jsx), así que firebaseReady ya
  // debería ser true al montar — se lee igual, de forma defensiva, y en las
  // deps del efecto para re-suscribirse si de todos modos cambiara en vivo.
  const { ready: firebaseReady } = useFirebaseReadiness();

  useEffect(() => {
    if (!firebaseReady) return;
    // getCurrentDatabaseOrThrow() (nunca getDatabase() a secas): nunca
    // devuelve la database de otro local ni de una app a medio inicializar.
    let db;
    try {
      db = getCurrentDatabaseOrThrow();
    } catch (e) {
      console.warn('[LocalStatusIndicator] Firebase todavía no está listo:', e.message);
      return;
    }
    const connectedRef = ref(db, '.info/connected');

    const listener = onValue(connectedRef, (snap) => {
      const connected = snap.val() === true;
      setIsConnected(connected);
    });

    return () => off(connectedRef, 'value', listener);
  }, [firebaseReady]);

  const checkStatus = useCallback(async () => {
    if (!settings) {
      setIsOpen(false);
      setIsManualClose(false);
      return;
    }

    // Única fuente de verdad, compartida con DLV Consultas:
    //   CONFIGURACION/web/horarios (horario configurado, sin cambios)
    //   CONFIGURACION/swich        (true = cerrado TEMPORALMENTE)
    //   CONFIGURACION/swichDesde   (desde cuándo, para detectar si ya empezó
    //                               una franja nueva desde ese cierre)
    const horarios = settings.web?.horarios;
    const { abierto, cerradoTemporalmente, debeResetearSwich } = calcularEstadoRecepcion({
      horarios,
      swich: settings.swich === true,
      swichDesde: settings.swichDesde,
    });

    setIsManualClose(cerradoTemporalmente);
    setIsOpen(abierto);

    if (debeResetearSwich) {
      try {
        await saveSettings({ swich: false, swichDesde: null });
        toast({
          title: 'Recepción reabierta automáticamente',
          description: 'El cierre temporal se canceló al empezar un nuevo horario de apertura.',
        });
        // El estado visible ya se actualizó arriba (abierto/cerradoTemporalmente);
        // el listener de Firebase confirmará el mismo valor al llegar.
      } catch (error) {
        console.error('[LocalStatusIndicator] No se pudo cancelar el cierre temporal:', error);
      }
    }
  }, [settings]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [checkStatus]);

  if (!isConnected) {
    return (
      <div className="flex items-center space-x-2 px-2" title="Estado: Desconectado">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
          </div>
          <span className="text-xs font-semibold text-yellow-600 hidden sm:inline-block">
              Desconectado
          </span>
      </div>
    );
  }

  if (isManualClose) {
    return (
      <div className="flex items-center space-x-2 px-2" title="Estado: Cerrado Manualmente">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
          </div>
          <span className="text-xs font-semibold text-orange-600 hidden sm:inline-block">
              Cerrado Manual
          </span>
      </div>
    );
  }

  const pulseColor = isOpen ? 'bg-green-500' : 'bg-red-500';
  const statusText = isOpen ? 'Abierto' : 'Cerrado';

  return (
    <div className="flex items-center space-x-2 px-2" title={`Estado: ${statusText}`}>
        <div className="relative flex h-3 w-3">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pulseColor}`}></span>
          <span className={`relative inline-flex rounded-full h-3 w-3 ${pulseColor}`}></span>
        </div>
        <span className={`text-xs font-semibold ${isOpen ? 'text-green-600' : 'text-red-600'} hidden sm:inline-block`}>
            {statusText}
        </span>
    </div>
  );
};

export default LocalStatusIndicator;