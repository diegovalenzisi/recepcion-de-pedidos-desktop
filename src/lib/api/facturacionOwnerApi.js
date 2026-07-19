/**
 * "Dueño de facturación" por cuenta/local — arbitraje anti-doble-facturación.
 *
 * Se guarda en el MISMO RTDB que usa el motor de facturación de esa cuenta
 * (fields.firebaseDb — puede ser un proyecto Firebase distinto al de la app,
 * ya que cada cuenta AFIP define su propio FIREBASE_DB), en un path nuevo e
 * independiente de CONFIGURACION (FACTURACION_OWNERS), para no depender de
 * getCurrentLocalId() ni pisar reglas existentes.
 *
 * Se usa REST plano (fetch) — mismo patrón que el resto de la app usa contra
 * RTDB — para no requerir el SDK de Firebase apuntando a un proyecto distinto
 * del ya inicializado por la app.
 */

import { normalizeFirebaseDatabaseURL } from '@/lib/utils/firebaseUrl';

const sanitizeKey = (v) => String(v ?? '').trim().replace(/[.#$[\]/\s]/g, '');

export const ownerKeyFor = (cuit, ptoVta) => `${sanitizeKey(cuit)}_${sanitizeKey(ptoVta)}`;

// Normaliza el esquema/host de firebaseDb (misma utilidad que usa el guardado
// en FacturacionManager.jsx y el proceso principal) antes de armar la URL —
// defensivo: fetch() ya es insensible a mayúsculas en el esquema, pero así
// esta función nunca depende de esa particularidad del navegador.
const ownerUrl = (firebaseDb, cuit, ptoVta) => {
  let base;
  try {
    base = normalizeFirebaseDatabaseURL(firebaseDb);
  } catch {
    base = String(firebaseDb || '').replace(/\/+$/, '');
  }
  return `${base}/FACTURACION_OWNERS/${ownerKeyFor(cuit, ptoVta)}.json`;
};

const withTimeout = (ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

/**
 * Lee el dueño actual. NUNCA asume ownership en caso de error/timeout:
 * devuelve { ok: false } si no se pudo confirmar el estado real en Firebase.
 */
export const fetchOwner = async (firebaseDb, cuit, ptoVta) => {
  if (!firebaseDb || !cuit || !ptoVta) return { ok: false, owner: null };
  const { signal, clear } = withTimeout(6000);
  try {
    const resp = await fetch(ownerUrl(firebaseDb, cuit, ptoVta), { signal });
    clear();
    if (!resp.ok) return { ok: false, owner: null };
    const data = await resp.json();
    return { ok: true, owner: data || null };
  } catch (e) {
    clear();
    return { ok: false, owner: null, error: e?.message };
  }
};

/** Toma posesión: esta PC pasa a ser la única autorizada para facturar esta cuenta. */
export const claimOwner = async (firebaseDb, cuit, ptoVta, ownerData) => {
  try {
    const resp = await fetch(ownerUrl(firebaseDb, cuit, ptoVta), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ownerData, cuit, ptoVta, updatedAt: Date.now() }),
    });
    return { ok: resp.ok };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
};

/** Libera la posesión: ninguna PC queda autorizada hasta que alguna la reclame. */
export const releaseOwner = async (firebaseDb, cuit, ptoVta) => {
  try {
    const resp = await fetch(ownerUrl(firebaseDb, cuit, ptoVta), { method: 'DELETE' });
    return { ok: resp.ok };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
};

/**
 * Escucha en TIEMPO REAL al dueño de una cuenta usando el streaming SSE de RTDB
 * (EventSource sobre el endpoint .json). Cada vez que otra PC toma posesión
 * (claimOwner) o la libera (releaseOwner), este callback se dispara casi al
 * instante, permitiendo que la PC anterior se apague sin esperar al polling.
 *
 * callback(owner):
 *   - owner = objeto { machineId, ... }  → dueño actual
 *   - owner = null                        → sin dueño
 *   - owner = undefined                   → cambio parcial: conviene re-leer con fetchOwner
 *
 * Devuelve una función para cancelar la suscripción. Reconecta solo ante errores.
 */
export const subscribeOwner = (firebaseDb, cuit, ptoVta, callback) => {
  if (!firebaseDb || !cuit || !ptoVta || typeof EventSource === 'undefined') {
    return () => {};
  }
  const url = ownerUrl(firebaseDb, cuit, ptoVta);
  let es = null;
  let closed = false;
  let reconnectTimer = null;

  const handleEvent = (e) => {
    // RTDB manda keep-alive (data: null) que ignoramos.
    if (!e?.data || e.data === 'null') return;
    try {
      const parsed = JSON.parse(e.data);
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'path')) {
        if (parsed.path === '/') {
          callback(parsed.data ?? null);       // objeto completo del dueño (o null)
        } else {
          callback(undefined);                  // cambio parcial → re-leer
        }
      }
    } catch {
      /* keep-alive u otro evento no-JSON: ignorar */
    }
  };

  const connect = () => {
    if (closed) return;
    try {
      es = new EventSource(url);
    } catch {
      reconnectTimer = setTimeout(connect, 4000);
      return;
    }
    es.addEventListener('put', handleEvent);
    es.addEventListener('patch', handleEvent);
    es.onerror = () => {
      try { es && es.close(); } catch { /* noop */ }
      if (!closed) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 4000);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    clearTimeout(reconnectTimer);
    try { es && es.close(); } catch { /* noop */ }
  };
};
