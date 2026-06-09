import { useRef, useCallback, useEffect } from 'react';

export function useAbortController() {
  const abortControllerRef = useRef(null);

  const getSignal = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current.signal;
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return { getSignal, abort };
}