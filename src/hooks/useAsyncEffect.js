import { useEffect, useRef } from 'react';
import { logger } from '@/lib/errorLogger';

export function useAsyncEffect(effect, dependencies, options = {}) {
  const { timeoutMs = 10000, componentName = 'Unknown' } = options;
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    let timeoutId;
    let cleanupFn;

    const executeEffect = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Async effect timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        const result = await Promise.race([
          effect(() => isMounted.current),
          timeoutPromise
        ]);

        if (typeof result === 'function') {
          cleanupFn = result;
        }
      } catch (error) {
        if (isMounted.current) {
          logger.log(error, { component: componentName, context: 'useAsyncEffect' });
          console.error(`[useAsyncEffect Error in ${componentName}]`, error);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    executeEffect();

    return () => {
      isMounted.current = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (typeof cleanupFn === 'function') {
        cleanupFn();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}