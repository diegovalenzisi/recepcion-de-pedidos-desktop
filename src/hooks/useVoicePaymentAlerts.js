import { useState, useEffect, useRef, useCallback } from 'react';
import { listenToPaymentConfirmations, markPaymentAsAnnounced, createTestPaymentConfirmation } from '@/lib/api/paymentAlertsApi';

const ENABLED_STORAGE_KEY = 'voicePaymentAlertsEnabled';
const VOICE_STORAGE_KEY = 'voicePaymentAlertsVoiceURI';
const SPEECH_LANG = 'es-AR';
export const AUTO_VOICE_VALUE = 'auto';

const getStoredEnabledPreference = () => {
  const stored = localStorage.getItem(ENABLED_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
};

// Valores de "cliente" que no son un nombre real (placeholders que el
// backend ya no debería guardar, pero se filtran por las dudas).
const PLACEHOLDER_CLIENTE_VALUES = ['transferencia recibida'];

// Solo se anuncian por voz los pagos con un nombre de cliente real: ni
// vacío/null, ni un placeholder genérico, ni un pago aún "pendiente" de que
// el emailWatcher complete el titular.
const hasRealClienteName = (payment) => {
  const cliente = payment?.cliente;
  if (!cliente) return false;
  const normalized = cliente.trim().toLowerCase();
  if (normalized === '' || PLACEHOLDER_CLIENTE_VALUES.includes(normalized)) return false;
  if (payment?.estadoCliente === 'pendiente') return false;
  return true;
};

const buildAnnouncementText = (payment) => {
  const monto = payment.monto ?? 0;
  const text = `Pago recibido de ${payment.cliente.trim()} por ${monto} pesos.`;
  console.log(`[voice] Texto armado: ${text}`);
  return text;
};

const FEMALE_VOICE_NAME_HINTS = [
  'female', 'mujer', 'femenina',
  'helena', 'sabina', 'dalia', 'paulina', 'monica', 'mónica', 'lucia', 'lucía',
  'valeria', 'camila', 'esperanza', 'laura', 'elena', 'isabela', 'isabella',
  'sofia', 'sofía', 'paloma', 'conchita', 'marisol', 'victoria', 'catalina',
  'pilar', 'angelica', 'angélica', 'rosa',
];

const isFemaleVoice = (voice) => {
  const name = voice.name?.toLowerCase() ?? '';
  return FEMALE_VOICE_NAME_HINTS.some((hint) => name.includes(hint));
};

const matchesLang = (voice, langPrefix) => voice.lang?.toLowerCase().startsWith(langPrefix.toLowerCase());

const selectBestSpanishVoice = () => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  return (
    voices.find((voice) => matchesLang(voice, 'es-AR') && isFemaleVoice(voice)) ||
    voices.find((voice) => (matchesLang(voice, 'es-419') || voice.name?.toLowerCase().includes('latin')) && isFemaleVoice(voice)) ||
    voices.find((voice) => matchesLang(voice, 'es-MX') && isFemaleVoice(voice)) ||
    voices.find((voice) => matchesLang(voice, 'es') && isFemaleVoice(voice)) ||
    null
  );
};

export const useVoicePaymentAlerts = (isUserLoggedIn) => {
  const [isEnabled, setIsEnabled] = useState(getStoredEnabledPreference);
  const [isSoundUnlocked, setIsSoundUnlocked] = useState(false);
  const [lastAnnouncedPayment, setLastAnnouncedPayment] = useState(null);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(
    () => localStorage.getItem(VOICE_STORAGE_KEY) || AUTO_VOICE_VALUE
  );

  const queueRef = useRef([]);
  const seenIdsRef = useRef(new Set());
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      setAvailableVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const speak = useCallback((text, onEnd) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;

    const voices = window.speechSynthesis.getVoices();
    const chosenVoice = (selectedVoiceURI !== AUTO_VOICE_VALUE
      ? voices.find((voice) => voice.voiceURI === selectedVoiceURI)
      : null) || selectBestSpanishVoice();

    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
  }, [selectedVoiceURI]);

  const processQueue = useCallback(() => {
    if (isSpeakingRef.current) return;
    if (!isEnabled || !isSoundUnlocked) return;
    if (queueRef.current.length === 0) return;

    const nextPayment = queueRef.current.shift();
    isSpeakingRef.current = true;

    speak(buildAnnouncementText(nextPayment), () => {
      isSpeakingRef.current = false;
      markPaymentAsAnnounced(nextPayment.id).catch((error) => {
        console.error('Error al marcar el pago como leído:', error);
      });
      setLastAnnouncedPayment(nextPayment);
      processQueue();
    });
  }, [isEnabled, isSoundUnlocked, speak]);

  useEffect(() => {
    if (!isUserLoggedIn) return;

    const unsubscribe = listenToPaymentConfirmations((payments) => {
      payments
        .filter((payment) => payment.leido === false && !seenIdsRef.current.has(payment.id))
        .forEach((payment) => {
          console.log(`[voice] Cliente recibido: ${JSON.stringify(payment.cliente)}`);

          if (!hasRealClienteName(payment)) {
            console.log('[voice] Pago sin cliente real, se omite anuncio');
            // No se marca como "visto": si el emailWatcher completa el
            // titular más tarde, este mismo pago se puede volver a evaluar.
            return;
          }

          seenIdsRef.current.add(payment.id);
          queueRef.current.push(payment);
        });

      processQueue();
    }, (error) => {
      console.error('Error escuchando avisos de pago confirmados:', error);
    });

    return () => unsubscribe();
  }, [isUserLoggedIn, processQueue]);

  useEffect(() => {
    processQueue();
  }, [isEnabled, isSoundUnlocked, processQueue]);

  const enableSound = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const unlockUtterance = new SpeechSynthesisUtterance(' ');
    unlockUtterance.volume = 0;
    window.speechSynthesis.speak(unlockUtterance);
    setIsSoundUnlocked(true);
  }, []);

  const testVoice = useCallback(async () => {
    try {
      await createTestPaymentConfirmation();
    } catch (error) {
      console.error('Error al crear el pago de prueba:', error);
    }
  }, []);

  const toggleEnabled = useCallback((value) => {
    localStorage.setItem(ENABLED_STORAGE_KEY, String(value));
    setIsEnabled(value);
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
    enableSound,
    testVoice,
    toggleEnabled,
    selectVoice,
  };
};
