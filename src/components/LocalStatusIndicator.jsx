import React, { useState, useEffect, useCallback } from 'react';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { saveSettings } from '@/lib/api/settingsApi';
import { toast } from '@/components/ui/use-toast';

const dayMapping = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const LocalStatusIndicator = ({ settings }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isManualClose, setIsManualClose] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const db = getDatabase();
    const connectedRef = ref(db, '.info/connected');

    const listener = onValue(connectedRef, (snap) => {
      const connected = snap.val() === true;
      setIsConnected(connected);
    });

    return () => off(connectedRef, 'value', listener);
  }, []);

  const checkStatus = useCallback(async () => {
    if (!settings) {
      setIsOpen(false);
      setIsManualClose(false);
      return;
    }

    const horarios = settings.web?.horarios;
    const manualCloseActive = settings.manualClose || false;
    setIsManualClose(manualCloseActive);

    const now = new Date();
    const dayName = dayMapping[now.getDay()];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const todayHours = horarios ? horarios[dayName] : null;
    
    let isCurrentlyInScheduledHours = false;
    if (todayHours && Array.isArray(todayHours)) {
      for (const shift of todayHours) {
        if (shift && shift.start && shift.end) {
          const [startH, startM] = shift.start.split(':').map(Number);
          const [endH, endM] = shift.end.split(':').map(Number);
          if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) continue;
          
          const startMinutes = startH * 60 + startM;
          const endMinutes = endH * 60 + endM;

          if (startMinutes < endMinutes) { // Same day shift
            if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
              isCurrentlyInScheduledHours = true;
              break;
            }
          } else { // Overnight shift
            if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
              isCurrentlyInScheduledHours = true;
              break;
            }
          }
        }
      }
    }
    
    // Auto re-open logic: if manual close is active but we just entered a valid opening time.
    // The `justOpened` logic was a bit problematic, let's check if `isCurrentlyInScheduledHours` becomes true while `manualCloseActive` is also true.
    if (manualCloseActive && isCurrentlyInScheduledHours) {
        // A simple check every minute is enough. If we are in hours and manually closed, let's re-open.
        // A more robust way is to detect the transition. Let's check for the exact start time.
        let justOpened = false;
        if (todayHours && Array.isArray(todayHours)) {
            for (const shift of todayHours) {
                if (shift && shift.start) {
                    const [startH, startM] = shift.start.split(':').map(Number);
                    if (isNaN(startH) || isNaN(startM)) continue;
                    const startMinutes = startH * 60 + startM;
                    if(currentMinutes === startMinutes) {
                        justOpened = true;
                        break;
                    }
                }
            }
        }

        if(justOpened) {
            try {
                await saveSettings({ manualClose: false });
                toast({
                    title: "Local Reabierto Automáticamente",
                    description: "El cierre manual se desactivó al iniciar un nuevo turno.",
                });
                // State will update via Firebase listener, no need to set manually.
            } catch (error) {
                console.error("Failed to auto re-open:", error);
            }
        }
    }
    
    // Final status check
    if (manualCloseActive) {
      setIsOpen(false);
    } else {
      setIsOpen(isCurrentlyInScheduledHours);
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