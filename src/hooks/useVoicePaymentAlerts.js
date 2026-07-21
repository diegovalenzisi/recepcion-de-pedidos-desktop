import { useState, useEffect, useRef, useCallback } from 'react';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';
import {
  listenToPaymentConfirmations,
  markPaymentAsAnnounced,
  createTestPaymentConfirmation,
  createTestMercadoPagoPayment,
  readPaymentsDiagnostic,
} from '@/lib/api/paymentAlertsApi';

const ENABLED_STORAGE_KEY   = 'voicePaymentAlertsEnabled';
const VOICE_STORAGE_KEY     = 'voicePaymentAlertsVoiceURI';
const VOLUME_STORAGE_KEY    = 'voicePaymentVolume';
const UNLOCKED_STORAGE_KEY  = 'voicePaymentSoundUnlocked';
const SPEECH_LANG          = 'es-AR';
const SPEAK_TIMEOUT_MS     = 20000; // máx 20s para onend; si no dispara, avanzamos
const WATCHDOG_INTERVAL_MS = 15000; // cada 15s revisamos si la cola está atascada
const HEARTBEAT_INTERVAL_MS = 60000; // log cada 1 min

export const AUTO_VOICE_VALUE = 'auto';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

const getStoredEnabledPreference = () => {
  const stored = localStorage.getItem(ENABLED_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
};

const getStoredUnlocked = () => {
  // En Electron empieza como desbloqueado, y se persiste para sesiones siguientes
  if (isElectron) return true;
  return localStorage.getItem(UNLOCKED_STORAGE_KEY) === 'true';
};

export const getVoicePaymentVolume = () => {
  const stored = Number(localStorage.getItem(VOLUME_STORAGE_KEY));
  if (!Number.isFinite(stored)) return 100;
  return Math.min(100, Math.max(0, stored));
};

export const setVoicePaymentVolume = (value) => {
  const clamped = Math.min(100, Math.max(0, Number(value)));
  localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
};

const buildAnnouncementText = (payment) => {
  const monto = payment.monto ?? 0;
  const clienteReal = payment.cliente?.trim();
  const isPending = payment.estadoCliente === 'pendiente';

  if (clienteReal && !isPending) {
    return `Pago recibido de ${clienteReal} por ${monto} pesos.`;
  }
  const medio = payment.medio?.trim() || 'Mercado Pago';
  return `Pago recibido de ${medio} por ${monto} pesos.`;
};

const FEMALE_VOICE_NAME_HINTS = [
  'female', 'mujer', 'femenina',
  'helena', 'sabina', 'dalia', 'paulina', 'monica', 'mónica', 'lucia', 'lucía',
  'valeria', 'camila', 'esperanza', 'laura', 'elena', 'isabela', 'isabella',
  'sofia', 'sofía', 'paloma', 'conchita', 'marisol', 'victoria', 'catalina',
  'pilar', 'angelica', 'angélica', 'rosa',
];

const isFemaleVoice = (v) => {
  const name = v.name?.toLowerCase() ?? '';
  return FEMALE_VOICE_NAME_HINTS.some((h) => name.includes(h));
};

const matchesLang = (v, prefix) => v.lang?.toLowerCase().startsWith(prefix.toLowerCase());

const selectBestSpanishVoice = () => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices?.length) return null;
  return (
    voices.find((v) => matchesLang(v, 'es-AR') && isFemaleVoice(v)) ||
    voices.find((v) => (matchesLang(v, 'es-419') || v.name?.toLowerCase().includes('latin')) && isFemaleVoice(v)) ||
    voices.find((v) => matchesLang(v, 'es-MX') && isFemaleVoice(v)) ||
    voices.find((v) => matchesLang(v, 'es') && isFemaleVoice(v)) ||
    null
  );
};

export const useVoicePaymentAlerts = (isUserLoggedIn, activePaymentPath = null) => {
  const { ready: firebaseReady } = useFirebaseReadiness();
  const [isEnabled, setIsEnabled]             = useState(getStoredEnabledPreference);
  const [isSoundUnlocked, setIsSoundUnlocked] = useState(getStoredUnlocked);
  const [lastAnnouncedPayment, setLastAnnouncedPayment] = useState(null);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(
    () => localStorage.getItem(VOICE_STORAGE_KEY) || AUTO_VOICE_VALUE,
  );
  const [diagnosisResult, setDiagnosisResult] = useState(null);

  // Estado visible del watcher
  const [watcherStatus, setWatcherStatus]             = useState('inactivo');
  const [lastPaymentDetectedAt, setLastPaymentDetectedAt] = useState(null);
  const [lastWatcherError, setLastWatcherError]       = useState(null);
  const [lastCheckAt, setLastCheckAt]                 = useState(null);

  const queueRef      = useRef([]);
  const seenIdsRef    = useRef(new Set());
  const isSpeakingRef = useRef(false);

  // processQueueRef desacopla la cola del listener Firebase.
  // El listener solo llama a processQueueRef.current() → nunca es dependency de useEffect.
  const processQueueRef = useRef(null);

  // ── Voces disponibles ──────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0) {
        console.log(`[VOICE LISTENER] voces cargadas: ${voices.length} | reactivando cola`);
        processQueueRef.current?.();
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // ── Pre-unlock automático en Electron (o cuando ya estaba desbloqueado) ────
  // Dispara un utterance silencioso para que speechSynthesis esté listo antes
  // de que el listener Firebase detecte pagos pendientes al arranque.

  useEffect(() => {
    if (!isSoundUnlocked) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    console.log('[VOICE LISTENER] pre-unlock automático: utterance silencioso emitido');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar

  // ── speak() con timeout de seguridad (fix Chromium onend bug) ─────────────

  const speak = useCallback((text, onEnd) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[MP AUDIO] speechSynthesis no disponible');
      onEnd?.();
      return;
    }

    // Chromium puede quedar en pausa interna — forzar resume
    if (window.speechSynthesis.paused) {
      console.log('[MP AUDIO] speechSynthesis estaba pausado — forzando resume');
      window.speechSynthesis.resume();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang   = SPEECH_LANG;
    utterance.volume = getVoicePaymentVolume() / 100;

    const voices = window.speechSynthesis.getVoices();
    const chosen =
      (selectedVoiceURI !== AUTO_VOICE_VALUE
        ? voices.find((v) => v.voiceURI === selectedVoiceURI)
        : null) || selectBestSpanishVoice();
    if (chosen) utterance.voice = chosen;

    // Garantiza que onEnd se llame exactamente 1 vez, incluso si onend no dispara
    let settled = false;
    const settle = (wasSpoken) => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      if (wasSpoken) {
        console.log('[MP AUDIO] Aviso OK:', text);
      } else {
        console.warn('[MP AUDIO] Error o timeout en aviso:', text);
      }
      onEnd?.(wasSpoken);
    };

    // Si onend no dispara en SPEAK_TIMEOUT_MS → avanzamos igual (no bloqueamos la cola)
    const fallbackTimer = setTimeout(() => {
      console.warn(`[MP AUDIO] timeout después de ${SPEAK_TIMEOUT_MS}ms — onend no disparó, avanzando`);
      window.speechSynthesis.cancel();
      settle(false);
    }, SPEAK_TIMEOUT_MS);

    utterance.onend  = () => settle(true);
    utterance.onerror = (e) => {
      console.warn('[MP AUDIO] Error speechSynthesis:', e?.error ?? e);
      settle(false);
    };

    console.log('[MP AUDIO] Reproduciendo aviso:', text);
    window.speechSynthesis.speak(utterance);
  }, [selectedVoiceURI]);

  // ── processQueue ──────────────────────────────────────────────────────────

  const processQueue = useCallback(() => {
    if (isSpeakingRef.current) return;
    if (!isEnabled) {
      console.log('[VOICE LISTENER] cola pausada: avisos desactivados');
      return;
    }
    if (!isSoundUnlocked) {
      console.log('[VOICE LISTENER] cola pausada: sonido bloqueado');
      return;
    }
    if (queueRef.current.length === 0) return;

    const nextPayment = queueRef.current.shift();
    isSpeakingRef.current = true;
    console.log(`[VOICE LISTENER] procesando pago id=${nextPayment.id} monto=${nextPayment.monto}`);
    console.log(`[VOICE LISTENER] marcando como leído=${nextPayment.id} (al completar)`);

    speak(buildAnnouncementText(nextPayment), (wasSpoken) => {
      isSpeakingRef.current = false;

      if (wasSpoken) {
        console.log(`[VOICE LISTENER] marcando como leído=${nextPayment.id} ok`);
        markPaymentAsAnnounced(nextPayment.id)
          .then(() => console.log('[VOICE LISTENER] Firebase leído=true →', nextPayment.id))
          .catch((e) => console.error('[VOICE LISTENER] error marcando leído:', e));
        setLastAnnouncedPayment(nextPayment);
      } else {
        console.warn(`[VOICE LISTENER] error=aviso no reproducido para ${nextPayment.id}, no se marca leído — reintentará`);
        seenIdsRef.current.delete(nextPayment.id);
      }

      processQueueRef.current?.();
    });
  }, [isEnabled, isSoundUnlocked, speak]);

  // Mantener ref siempre actualizada (sin re-crear el listener Firebase)
  useEffect(() => {
    processQueueRef.current = processQueue;
  });

  // ── Listener Firebase (deps: solo isUserLoggedIn + activePaymentPath) ─────
  // BUG FIX: processQueue ya NO es dependency → el listener no se destruye
  // cuando cambia isEnabled/isSoundUnlocked/selectedVoiceURI.

  useEffect(() => {
    if (!isUserLoggedIn || !firebaseReady) {
      setWatcherStatus('inactivo');
      return;
    }

    seenIdsRef.current = new Set();
    queueRef.current   = [];
    setWatcherStatus('conectando');
    setLastWatcherError(null);

    const logPath = activePaymentPath || '(ruta por localId)';
    console.log(`[MP WATCHER] iniciando listener → ${logPath}`);

    const unsubscribe = listenToPaymentConfirmations(
      (payments) => {
        const now = new Date();
        setLastCheckAt(now);
        setWatcherStatus('activo');

        const noLeidos = payments.filter((p) => p.leido === false);
        console.log(`[VOICE LISTENER] pagos total=${payments.length}`);
        console.log(`[VOICE LISTENER] pagos no leidos=${noLeidos.length}`);
        console.log(`[VOICE LISTENER] sonido habilitado=${isSoundUnlocked}`);
        console.log(`[VOICE LISTENER] voz seleccionada=${selectedVoiceURI}`);
        console.log(`[VOICE LISTENER] speech permitido=${typeof window !== 'undefined' && !!window.speechSynthesis}`);

        const nuevos = payments.filter(
          (p) => p.leido === false && !seenIdsRef.current.has(p.id),
        );

        nuevos.forEach((payment) => {
          const monto = payment.monto ?? 0;
          console.log(`[VOICE LISTENER] procesando pago id=${payment.id} monto=${monto}`);
          if (monto <= 0) {
            console.log(`[VOICE LISTENER] pago ${payment.id} ignorado: monto inválido (${monto})`);
            return;
          }
          const debeCantar = isEnabled && isSoundUnlocked;
          console.log(`[VOICE LISTENER] debe cantar=${debeCantar}`);
          setLastPaymentDetectedAt(now);
          seenIdsRef.current.add(payment.id);
          queueRef.current.push(payment);
        });

        if (nuevos.length > 0) processQueueRef.current?.();
      },
      (error) => {
        console.error('[VOICE LISTENER] error listener Firebase:', error);
        console.error(`[VOICE LISTENER] error=${error?.message ?? String(error)}`);
        setWatcherStatus('error');
        setLastWatcherError(error?.message ?? String(error));
      },
      activePaymentPath,
    );

    return () => {
      console.log('[MP WATCHER] listener detenido');
      unsubscribe();
      setWatcherStatus('inactivo');
    };
  }, [isUserLoggedIn, activePaymentPath, firebaseReady]); // ← processQueue FUERA de deps

  // ── Watchdog: detecta cola atascada cada 15s ───────────────────────────────

  useEffect(() => {
    if (!isUserLoggedIn) return;

    const watchdog = setInterval(() => {
      // Si isSpeakingRef es true pero speechSynthesis no está hablando → atascado
      if (isSpeakingRef.current && window.speechSynthesis && !window.speechSynthesis.speaking) {
        console.warn('[MP WATCHER] detectado isSpeakingRef stuck (Chromium bug) — reseteando');
        isSpeakingRef.current = false;
        processQueueRef.current?.();
      }

      // Si hay items en cola pero nadie los procesa
      if (!isSpeakingRef.current && queueRef.current.length > 0) {
        console.log(`[MP WATCHER] ${queueRef.current.length} pagos en cola sin procesar — reactivando`);
        processQueueRef.current?.();
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => clearInterval(watchdog);
  }, [isUserLoggedIn]);

  // ── Heartbeat: log cada 1 min ─────────────────────────────────────────────

  useEffect(() => {
    if (!isUserLoggedIn) return;

    const hb = setInterval(() => {
      console.log(
        `[MP WATCHER] activo | estado:${watcherStatus} | cola:${queueRef.current.length}` +
        ` | hablando:${isSpeakingRef.current} | ${new Date().toLocaleTimeString('es-AR')}`,
      );
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(hb);
  }, [isUserLoggedIn, watcherStatus]);

  // ── Reactivar cola cuando cambia isEnabled o isSoundUnlocked ─────────────

  useEffect(() => {
    processQueueRef.current?.();
  }, [isEnabled, isSoundUnlocked]);

  // ── API pública ───────────────────────────────────────────────────────────

  const enableSound = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    localStorage.setItem(UNLOCKED_STORAGE_KEY, 'true');
    setIsSoundUnlocked(true);
    console.log('[VOICE LISTENER] sonido desbloqueado (persistido en localStorage)');
  }, []);

  const testVoice = useCallback(async () => {
    try {
      await createTestPaymentConfirmation(activePaymentPath);
      console.log('[voice-payments] pago de prueba creado');
    } catch (e) {
      console.error('[voice-payments] error creando prueba:', e);
    }
  }, [activePaymentPath]);

  const testMercadoPago = useCallback(async () => {
    try {
      await createTestMercadoPagoPayment(activePaymentPath);
    } catch (e) {
      console.error('[voice-payments] error creando prueba MP:', e);
    }
  }, [activePaymentPath]);

  const runDiagnosis = useCallback(async () => {
    try {
      const result = await readPaymentsDiagnostic(activePaymentPath);
      setDiagnosisResult(result);
    } catch (e) {
      setDiagnosisResult({ error: e.message });
    }
  }, [activePaymentPath]);

  const toggleEnabled = useCallback((value) => {
    localStorage.setItem(ENABLED_STORAGE_KEY, String(value));
    setIsEnabled(value);
    console.log('[MP WATCHER] avisos', value ? 'activados' : 'desactivados');
  }, []);

  const selectVoice = useCallback((voiceURI) => {
    localStorage.setItem(VOICE_STORAGE_KEY, voiceURI);
    setSelectedVoiceURI(voiceURI);
  }, []);

  return {
    isEnabled,
    isSoundUnlocked,
    lastAnnouncedPayment,
    availableVoices,
    selectedVoiceURI,
    diagnosisResult,
    watcherStatus,
    lastPaymentDetectedAt,
    lastWatcherError,
    lastCheckAt,
    enableSound,
    testVoice,
    testMercadoPago,
    runDiagnosis,
    toggleEnabled,
    selectVoice,
  };
};
