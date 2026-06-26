import { useState, useEffect } from 'react';

/**
 * Retrieves the local WhatsApp preference from localStorage.
 * Defaults to true if the key does not exist.
 */
export const getLocalWhatsAppPreference = () => {
  const storedValue = localStorage.getItem('whatsapp_read_from_db');
  // If null (first time), we default to true as per Task 1
  if (storedValue === null) return true;
  return storedValue === 'true';
};

/**
 * Saves the local WhatsApp preference to localStorage.
 * Dispatches a custom event so other hook instances can sync.
 */
export const setLocalWhatsAppPreference = (value) => {
  localStorage.setItem('whatsapp_read_from_db', String(value));
  window.dispatchEvent(new Event('whatsapp_local_pref_changed'));
};

/**
 * Hook to manage the local WhatsApp preference state.
 * This state is unique to each device/browser instance.
 */
export const useLocalWhatsAppPreference = () => {
  const [isLocalEnabled, setIsLocalEnabled] = useState(getLocalWhatsAppPreference());

  useEffect(() => {
    const handleStorageChange = () => {
      setIsLocalEnabled(getLocalWhatsAppPreference());
    };
    
    // Listen for changes made within the same tab or across the app via custom event
    window.addEventListener('whatsapp_local_pref_changed', handleStorageChange);
    // Standard storage event for changes in other tabs
    window.addEventListener('storage', (e) => {
      if (e.key === 'whatsapp_read_from_db') {
        handleStorageChange();
      }
    });

    return () => {
      window.removeEventListener('whatsapp_local_pref_changed', handleStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const togglePreference = (value) => {
    setLocalWhatsAppPreference(value);
    setIsLocalEnabled(value);
  };

  return { isLocalEnabled, togglePreference };
};