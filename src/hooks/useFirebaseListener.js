import { useEffect, useRef } from 'react';
import { logger } from '@/lib/errorLogger';

export function useFirebaseListener(listenerFn, dependencies, options = {}) {
  const { componentName = 'Unknown' } = options;
  const unsubscribeRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    
    try {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      
      const wrappedCallback = (data) => {
        if (!isMounted) return;
        return data;
      };

      const wrappedErrorCallback = (error) => {
        if (!isMounted) return;
        logger.log(error, { component: componentName, context: 'Firebase Listener Error' });
      };

      // Call the listener factory function
      const unsub = listenerFn(wrappedCallback, wrappedErrorCallback);
      
      if (typeof unsub === 'function') {
        unsubscribeRef.current = unsub;
      } else {
        console.warn(`[useFirebaseListener] listenerFn did not return an unsubscribe function in ${componentName}`);
      }
    } catch (error) {
      logger.log(error, { component: componentName, context: 'Firebase Listener Setup' });
    }

    return () => {
      isMounted = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}