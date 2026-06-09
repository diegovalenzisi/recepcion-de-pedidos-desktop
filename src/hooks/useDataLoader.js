import { useState, useCallback } from 'react';
import { useAbortController } from './useAbortController';
import { logger } from '@/lib/errorLogger';

export function useDataLoader(fetchFn, options = {}) {
  const { 
    initialData = null, 
    onSuccess, 
    onError, 
    componentName = 'UnknownLoader'
  } = options;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { getSignal } = useAbortController();

  const loadData = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    const signal = getSignal();

    try {
      const result = await fetchFn(signal, ...args);
      if (!signal.aborted) {
        setData(result);
        if (onSuccess) onSuccess(result);
        return result;
      }
    } catch (err) {
      if (!signal.aborted) {
        setError(err.message || 'Error fetching data');
        logger.log(err, { component: componentName, context: 'useDataLoader' });
        if (onError) onError(err);
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [fetchFn, getSignal, onSuccess, onError, componentName]);

  return { data, setData, loading, error, loadData };
}