import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchOwner, claimOwner, releaseOwner, subscribeOwner } from '@/lib/api/facturacionOwnerApi';

// Respaldo lento: el arbitraje real ocurre por el listener SSE en tiempo real.
// El polling solo cubre el caso de que el stream SSE se caiga.
const POLL_MS = 20000;

const fAPI = () => window.electronAPI?.facturacion;

const buildAccountList = (config) => {
  if (!config) return [];
  if (config.tipo === 'responsable_inscripto') {
    const ri = config.ri || {};
    return ri.initialized ? [{ key: 'ri', tipo: 'responsable_inscripto', cuentaId: null, fields: ri }] : [];
  }
  if (config.tipo === 'monotributo') {
    return (config.monotributo?.cuentas || [])
      .filter((c) => c.initialized)
      .map((c) => ({ key: `mono_${c.id}`, tipo: 'monotributo', cuentaId: c.id, fields: c }));
  }
  return [];
};

/**
 * Hook compartido de "dueño de facturación" — arbitraje anti-doble-facturación.
 *
 * Una sola PC por cuenta/local puede tener el motor en auto-inicio. La decisión
 * de ownership vive en Firebase (FACTURACION_OWNERS, dentro del RTDB propio de
 * cada cuenta), identificada por machineId — nunca se sincroniza el booleano
 * `activo` en sí (eso seguiría reproduciendo el bug de copiarse a todas las PCs).
 *
 * Usado tanto por el panel de Configuración → Facturación como por el botón
 * visible para todos los usuarios en el footer.
 */
export function useFacturacionOwnership() {
  const [machine, setMachine] = useState(null); // { machineId, hostname }
  const [accounts, setAccounts] = useState([]); // [{ key, tipo, cuentaId, fields, dir, owner, ownerOk, isOwner }]
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const lastLostOwnershipRef = useRef({});
  // Refs para leer estado fresco desde los callbacks del listener SSE
  const machineRef = useRef(null);
  const accountsRef = useRef([]);
  useEffect(() => { machineRef.current = machine; }, [machine]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  // Aplica un cambio de dueño recibido en tiempo real (SSE) para UNA cuenta:
  // actualiza el estado y, si esta PC perdió la posesión, apaga el motor y baja
  // el `activo` local INMEDIATAMENTE (sin esperar al polling).
  const enforceOwner = useCallback(async (accountKey, ownerVal) => {
    const f = fAPI();
    const mid = machineRef.current;
    const acc = accountsRef.current.find((a) => a.key === accountKey);
    if (!f || !mid || !acc) return;

    const owner = ownerVal || null;
    const isOwner = !!owner && owner.machineId === mid.machineId;
    const wasLocalActivo = !!acc.fields.activo;

    // Otra PC tomó la posesión y esta PC estaba activa → apagar ya.
    if (owner && !isOwner && wasLocalActivo && !lastLostOwnershipRef.current[accountKey]) {
      lastLostOwnershipRef.current[accountKey] = true;
      console.log('Esta PC ya no es la autorizada para facturar. Se detiene facturación automática.');
      try { await f.stop(accountKey); } catch { /* noop */ }
      try { await persistActivo(f, acc.tipo, accountKey, acc.cuentaId, false); } catch { /* noop */ }
      setAccounts((prev) => prev.map((a) =>
        a.key === accountKey
          ? { ...a, owner, ownerOk: true, isOwner: false, fields: { ...a.fields, activo: false } }
          : a
      ));
      return;
    }

    if (isOwner) lastLostOwnershipRef.current[accountKey] = false;
    setAccounts((prev) => prev.map((a) =>
      a.key === accountKey ? { ...a, owner, ownerOk: true, isOwner } : a
    ));
  }, []);

  const loadAndPoll = useCallback(async () => {
    const f = fAPI();
    if (!f || !window.electronAPI?.getMachineInfo) { setLoading(false); return; }

    const [config, mid] = await Promise.all([f.readConfig(), window.electronAPI.getMachineInfo()]);
    setMachine(mid);

    const list = buildAccountList(config);
    const withDirs = await Promise.all(
      list.map(async (acc) => ({ ...acc, dir: await f.getAccountDir(acc.tipo, acc.cuentaId) }))
    );

    const withOwner = await Promise.all(
      withDirs.map(async (acc) => {
        const { ok, owner } = await fetchOwner(acc.fields.firebaseDb, acc.fields.cuit, acc.fields.ptoVta);
        const isOwner = ok && owner?.machineId === mid.machineId;
        return { ...acc, owner: ok ? owner : null, ownerOk: ok, isOwner };
      })
    );

    // Detectar transición: esta PC creía ser dueña (activo local true) y Firebase
    // dice que ya no lo es → apagar motor y corregir config local, una sola vez.
    for (const acc of withOwner) {
      const wasLocalActivo = !!acc.fields.activo;
      if (wasLocalActivo && acc.ownerOk && !acc.isOwner && !lastLostOwnershipRef.current[acc.key]) {
        lastLostOwnershipRef.current[acc.key] = true;
        console.log('Esta PC ya no es la autorizada para facturar. Se detiene facturación automática.');
        try { await f.stop(acc.key); } catch { /* noop */ }
        try {
          const cfg = await f.readConfig();
          if (cfg?.tipo === 'responsable_inscripto' && acc.key === 'ri') {
            cfg.ri = { ...cfg.ri, activo: false };
            await f.writeConfig(cfg);
          } else if (cfg?.tipo === 'monotributo') {
            const cuentas = (cfg.monotributo?.cuentas || []).map((c) =>
              c.id === acc.cuentaId ? { ...c, activo: false } : c
            );
            await f.writeConfig({ ...cfg, monotributo: { cuentas } });
          }
        } catch { /* noop */ }
        acc.fields = { ...acc.fields, activo: false };
      } else if (acc.isOwner) {
        lastLostOwnershipRef.current[acc.key] = false;
      }
    }

    setAccounts(withOwner);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAndPoll();
    const id = setInterval(loadAndPoll, POLL_MS);
    return () => clearInterval(id);
  }, [loadAndPoll]);

  // Listener en TIEMPO REAL por cuenta. Se re-suscribe solo cuando cambian las
  // cuentas o sus claves (cuit/ptoVta/firebaseDb) — la firma evita re-suscribir
  // en cada actualización de estado del dueño.
  const subSignature = accounts
    .map((a) => `${a.key}|${a.fields.firebaseDb || ''}|${a.fields.cuit || ''}|${a.fields.ptoVta || ''}`)
    .join(',');
  useEffect(() => {
    const current = accountsRef.current;
    const unsubs = current.map((acc) => {
      const { firebaseDb, cuit, ptoVta } = acc.fields;
      if (!firebaseDb || !cuit || !ptoVta) return () => {};
      return subscribeOwner(firebaseDb, cuit, ptoVta, (ownerVal) => {
        if (ownerVal === undefined) { loadAndPoll(); return; } // cambio parcial → re-leer
        enforceOwner(acc.key, ownerVal);
      });
    });
    return () => unsubs.forEach((u) => { try { u && u(); } catch { /* noop */ } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subSignature, enforceOwner, loadAndPoll]);

  /**
   * Activa o desactiva el inicio automático de facturación para una cuenta EN
   * ESTA PC. Si otra PC ya es dueña, `onNeedConfirm` (provisto por la UI) decide
   * si se toma el control. Si no se puede confirmar el estado real en Firebase,
   * se rechaza la activación (regla de seguridad: nunca tomar posesión a ciegas).
   */
  const toggleAutoStart = useCallback(async (accountKey, wantOn, { onNeedConfirm } = {}) => {
    const acc = accounts.find((a) => a.key === accountKey);
    if (!acc) return { ok: false, reason: 'account-not-found' };

    setBusyKey(accountKey);
    try {
      const f = fAPI();
      const { fields, dir, tipo, cuentaId } = acc;

      if (!wantOn) {
        if (acc.isOwner) {
          await releaseOwner(fields.firebaseDb, fields.cuit, fields.ptoVta);
        }
        await f.stop(accountKey);
        await persistActivo(f, tipo, accountKey, cuentaId, false);
        await loadAndPoll();
        return { ok: true };
      }

      // wantOn === true
      const { ok: fetchOk, owner } = await fetchOwner(fields.firebaseDb, fields.cuit, fields.ptoVta);
      if (!fetchOk) {
        return { ok: false, reason: 'firebase-unavailable' };
      }
      if (owner && owner.machineId !== machine?.machineId) {
        const confirmed = onNeedConfirm ? await onNeedConfirm(owner) : false;
        if (!confirmed) return { ok: false, reason: 'cancelled' };
      }

      const claimed = await claimOwner(fields.firebaseDb, fields.cuit, fields.ptoVta, {
        machineId: machine?.machineId,
        nombrePc: machine?.hostname,
        cuentaId: cuentaId ?? 'ri',
        cuentaNombre: fields.nombre || (tipo === 'responsable_inscripto' ? 'Responsable Inscripto' : 'Monotributo'),
      });
      if (!claimed.ok) return { ok: false, reason: 'claim-failed' };

      await persistActivo(f, tipo, accountKey, cuentaId, true);
      lastLostOwnershipRef.current[accountKey] = false;
      await f.start(accountKey, dir);
      await loadAndPoll();
      return { ok: true };
    } finally {
      setBusyKey(null);
    }
  }, [accounts, machine, loadAndPoll]);

  const isOwnerOfAny = accounts.some((a) => a.isOwner);
  const otherOwner = accounts.find((a) => !a.isOwner && a.owner)?.owner || null;

  return {
    loading,
    machine,
    accounts,
    isOwnerOfAny,
    otherOwner,
    busyKey,
    toggleAutoStart,
    refresh: loadAndPoll,
  };
}

async function persistActivo(f, tipo, key, cuentaId, activo) {
  const cfg = await f.readConfig();
  if (!cfg) return;
  if (tipo === 'responsable_inscripto' && key === 'ri') {
    cfg.ri = { ...cfg.ri, activo };
  } else if (tipo === 'monotributo') {
    const cuentas = (cfg.monotributo?.cuentas || []).map((c) => (c.id === cuentaId ? { ...c, activo } : c));
    cfg.monotributo = { cuentas };
  }
  await f.writeConfig(cfg);
}
