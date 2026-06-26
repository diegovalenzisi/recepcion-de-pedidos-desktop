import { useState, useEffect, useCallback, useRef } from 'react';

const HEALTH_INTERVAL_MS = 30_000;

/**
 * Combina dos fuentes:
 *  1. /health del backend (requiere backend corriendo)
 *  2. mp:backend-diag IPC   (siempre disponible — lee archivos locales)
 *
 * Si el backend no responde, devuelve el diagnóstico local para mostrar
 * exactamente qué falta (backend.env, creds Firebase, token MP, etc.)
 */
export const useMpBackendStatus = () => {
  const [state, setState] = useState({
    reachable:             false,
    tokenPresente:         false,
    localId:               null,
    rutaFirebase:          null,
    pollingIntervalS:      null,
    uptimeS:               null,
    lastPollTime:          null,
    lastPollTotal:         null,
    lastPollApproved:      null,
    lastWriteTime:         null,
    lastWriteId:           null,
    lastError:             null,
    emailWatcherEnabled:   null,
    checkTime:             null,
    // diag (disponible aunque backend esté detenido)
    diagAvailable:         false,
    backendEnvExists:      null,
    backendEnvPath:        null,
    backendEntryExists:    null,
    mpAccountsExists:      null,
    firebaseCredsPresente: null,
    rutaPagosPresente:     null,
    crashFast:             false,
    activeAccountName:     null,
    firebaseProject:       null,
  });
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const check = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading(true);
    try {
      // Siempre pedimos el diag (no requiere backend corriendo)
      const diagPromise = window.electronAPI.mpBackendDiag?.() ?? Promise.resolve(null);
      // Intentamos /health (puede fallar si backend está caído)
      const healthPromise = window.electronAPI.mpBackendHealth?.() ?? Promise.resolve(null);

      const [diag, health] = await Promise.all([diagPromise, healthPromise]);

      if (!mountedRef.current) return;

      // backendLastError de Electron (diag.lastError) es relevante SOLO cuando el backend
      // crasheó o no responde. Si el backend está activo, no usarlo para evitar que
      // mensajes informativos de stderr (ej. email watcher no configurado) aparezcan como Error MP.
      const lastError = health?.ok
        ? (health?.lastPoll?.error ?? null)
        : (health?.error ?? diag?.lastError ?? null);

      setState({
        // Desde /health (backend corriendo)
        reachable:         health?.ok ?? false,
        tokenPresente:     health?.mp?.tokenPresente ?? diag?.tokenPresente ?? false,
        localId:           health?.mp?.localId      ?? diag?.localId        ?? null,
        rutaFirebase:      health?.mp?.rutaFirebase  ?? null,
        pollingIntervalS:  health?.mp?.pollingIntervalS ?? null,
        uptimeS:           health?.uptimeS ?? null,
        lastPollTime:      health?.lastPoll?.time    ?? null,
        lastPollTotal:     health?.lastPoll?.total   ?? null,
        lastPollApproved:  health?.lastPoll?.approved ?? null,
        lastWriteTime:     health?.lastWrite?.time   ?? null,
        lastWriteId:       health?.lastWrite?.id     ?? null,
        lastError,
        emailWatcherEnabled: health?.mp?.emailWatcherEnabled ?? null,
        checkTime:         new Date(),
        // Desde diag (siempre disponible)
        diagAvailable:         !!diag,
        backendEnvExists:      diag?.backendEnvExists      ?? null,
        backendEnvPath:        diag?.backendEnvPath        ?? null,
        backendEntryExists:    diag?.backendEntryExists    ?? null,
        mpAccountsExists:      diag?.mpAccountsExists      ?? null,
        firebaseCredsPresente: diag?.firebaseCredsPresente ?? null,
        rutaPagosPresente:     diag?.rutaPagosPresente     ?? null,
        crashFast:             diag?.crashFast             ?? false,
        activeAccountName:     diag?.activeAccountName     ?? null,
        firebaseProject:       diag?.firebaseProject       ?? null,
      });
    } catch {
      if (mountedRef.current) {
        setState(s => ({ ...s, reachable: false, checkTime: new Date() }));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, HEALTH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  return { ...state, loading, refresh: check };
};
