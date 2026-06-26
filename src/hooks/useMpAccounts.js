import { useState, useEffect, useCallback } from 'react';

export const maskToken = (token) => {
  if (!token || token.length < 12) return '****';
  return token.slice(0, 10) + '****' + token.slice(-4);
};

const readAccountsViaIPC = async () => {
  if (window.electronAPI?.mpAccounts?.read) {
    return window.electronAPI.mpAccounts.read();
  }
  const stored = localStorage.getItem('mp-accounts-safe');
  return stored ? JSON.parse(stored) : [];
};

const writeAccountsViaIPC = async (accounts) => {
  if (window.electronAPI?.mpAccounts?.write) {
    return window.electronAPI.mpAccounts.write(accounts);
  }
  // Fallback browser: guardar sin tokens
  const safe = accounts.map(({ accessTokenMercadoPago: _t, ...rest }) => rest);
  localStorage.setItem('mp-accounts-safe', JSON.stringify(safe));
};

export const useMpAccounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await readAccountsViaIPC();
      setAccounts(Array.isArray(all) ? all : []);
    } catch (e) {
      console.error('[mp-config] error cargando cuentas:', e);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const persist = useCallback(async (newAccounts) => {
    setAccounts(newAccounts);
    await writeAccountsViaIPC(newAccounts);
  }, []);

  const addAccount = useCallback(async (account) => {
    const isFirst = accounts.length === 0;
    const newAccounts = [...accounts, { ...account, activo: isFirst }];
    await persist(newAccounts);
    console.log('[mp-config] cuenta agregada:', account.nombreCuenta);
  }, [accounts, persist]);

  const updateAccount = useCallback(async (nombreCuenta, updates) => {
    const newAccounts = accounts.map((a) =>
      a.nombreCuenta === nombreCuenta ? { ...a, ...updates } : a,
    );
    await persist(newAccounts);
    console.log('[mp-config] cuenta actualizada:', nombreCuenta);
  }, [accounts, persist]);

  const deleteAccount = useCallback(async (nombreCuenta) => {
    const filtered = accounts.filter((a) => a.nombreCuenta !== nombreCuenta);
    if (filtered.length > 0 && !filtered.some((a) => a.activo)) {
      filtered[0] = { ...filtered[0], activo: true };
    }
    await persist(filtered);
    console.log('[mp-config] cuenta eliminada:', nombreCuenta);
  }, [accounts, persist]);

  const setActiveAccount = useCallback(async (nombreCuenta) => {
    const newAccounts = accounts.map((a) => ({ ...a, activo: a.nombreCuenta === nombreCuenta }));
    await persist(newAccounts);
    console.log('[mp-config] cuenta activa cambiada:', nombreCuenta);
  }, [accounts, persist]);

  const restartBackend = useCallback(async () => {
    if (window.electronAPI?.backendRestart) {
      console.log('[mp-config] reiniciando backend por cambio de cuenta');
      return window.electronAPI.backendRestart();
    }
    return null;
  }, []);

  const activeAccount = accounts.find((a) => a.activo) ?? null;

  return {
    accounts,
    activeAccount,
    loading,
    addAccount,
    updateAccount,
    deleteAccount,
    setActiveAccount,
    restartBackend,
    reload: load,
  };
};
