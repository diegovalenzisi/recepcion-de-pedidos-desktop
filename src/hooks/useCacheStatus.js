import { useState, useEffect, useCallback } from 'react';
import { getCacheMeta } from '@/lib/cache/cacheManager';

export const useCacheStatus = (isOnline = true) => {
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, synced, error, offline
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [cacheSize, setCacheSize] = useState(0);

  const refreshStatus = useCallback(async () => {
    try {
      const meta = await getCacheMeta();
      setLastSyncTime(meta.lastSync);
      setCacheSize(meta.count);
      
      if (!isOnline) {
          setSyncStatus('offline');
      } else {
          setSyncStatus('synced');
      }
    } catch (e) {
      setSyncStatus('error');
    }
  }, [isOnline]);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [refreshStatus]);

  return {
    syncStatus,
    setSyncStatus,
    lastSyncTime,
    cacheSize,
    refreshStatus
  };
};