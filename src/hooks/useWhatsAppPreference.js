import { useState, useEffect } from 'react';
import { fetchWhatsAppPreference } from '@/lib/api/settingsApi';

export const useWhatsAppPreference = () => {
  const [preference, setPreference] = useState('web');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const loadPref = async () => {
      try {
        const pref = await fetchWhatsAppPreference();
        if (isMounted && pref) {
          setPreference(pref);
        }
      } catch (error) {
        console.error("Failed to load WhatsApp preference", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    loadPref();
    
    return () => {
      isMounted = false;
    };
  }, []);

  return { preference, loading };
};