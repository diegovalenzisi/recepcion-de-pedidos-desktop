/**
 * "Dueño de facturación" por cuenta/local — arbitraje anti-doble-facturación.
 *
 * Se guarda en el MISMO RTDB que usa el motor de facturación de esa cuenta
 * (fields.firebaseDb — puede ser un proyecto Firebase distinto al de la app,
 * ya que cada cuenta AFIP define su propio FIREBASE_DB).
 *
 * RUTA CANÓNICA (regla de almacenamiento por local):
 *
 *     /{localId}/FACTURACION_OWNERS/{cuit}_{ptoVta}
 *
 * Ahí viven TODOS los datos técnicos del dueño: id y tipo de dispositivo,
 * lease, heartbeat, vencimiento, estado, inicio automático y los locks/tokens
 * asociados. Desktop y Tablet usan exactamente la misma estructura.
 *
 * La ruta global anterior (`/FACTURACION_OWNERS/{key}`) quedó DEPRECADA: ya no
 * se escribe nunca. Solo se lee como FALLBACK, y únicamente cuando el registro
 * nuevo todavía no existe, para no romper una instalación que aún no migró.
 * No hay doble escritura: la fuente de verdad es siempre la ruta nueva.
 *
 * Se usa REST plano (fetch) — mismo patrón que el resto de la app usa contra
 * RTDB — para no requerir el SDK de Firebase apuntando a un proyecto distinto
 * del ya inicializado por la app.
 */

import { normalizeFirebaseDatabaseURL } from '@/lib/utils/firebaseUrl';
import { construirRutaLocal, normalizarLocalId, LocalIdRequeridoError } from './rutasLocales';

const sanitizeKey = (v) => String(v ?? '').trim().replace(/[.#$[\]/\s]/g, '');

export const ownerKeyFor = (cuit, ptoVta) => `${sanitizeKey(cuit)}_${sanitizeKey(ptoVta)}`;

// Normaliza el esquema/host de firebaseDb (misma utilidad que usa el guardado
// en FacturacionManager.jsx y el proceso principal) antes de armar la URL —
// defensivo: fetch() ya es insensible a mayúsculas en el esquema, pero así
// esta función nunca depende de esa particularidad del navegador.
const baseUrl = (firebaseDb) => {
  try {
    return normalizeFirebaseDatabaseURL(firebaseDb);
  } catch {
    return String(firebaseDb || '').replace(/\/+$/, '');
  }
};

/**
 * URL del registro del dueño DENTRO del local. Sin un localId válido lanza
 * `LOCAL_ID_REQUIRED`: no existe ruta de reserva ni raíz de fallback.
 */
export const ownerUrl = (firebaseDb, cuit, ptoVta, localId) => {
  const ruta = construirRutaLocal(localId, `FACTURACION_OWNERS/${ownerKeyFor(cuit, ptoVta)}`);
  return `${baseUrl(firebaseDb)}/${ruta}.json`;
};

/** URL del registro en la ruta global DEPRECADA. Solo se usa para LEER (fallback). */
const ownerUrlLegado = (firebaseDb, cuit, ptoVta) =>
  `${baseUrl(firebaseDb)}/FACTURACION_OWNERS/${ownerKeyFor(cuit, ptoVta)}.json`;

const withTimeout = (ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
};

/**
 * Lee el dueño actual. NUNCA asume ownership en caso de error/timeout:
 * devuelve { ok: false } si no se pudo confirmar el estado real en Firebase.
 *
 * Orden de lectura: PRIMERO la ruta nueva `/{localId}/FACTURACION_OWNERS/...`.
 * Solo si ahí no hay nada se consulta, de forma TEMPORAL, la ruta global vieja.
 * Un `null` en la ruta nueva significa "sin dueño" únicamente después de que el
 * fallback también dio vacío; así una instalación sin migrar sigue respetando al
 * dueño que ya estaba anotado y no arranca una segunda facturación.
 */
export const fetchOwner = async (firebaseDb, cuit, ptoVta, localId) => {
  if (!firebaseDb || !cuit || !ptoVta) return { ok: false, owner: null };
  if (!normalizarLocalId(localId)) {
    return { ok: false, owner: null, error: 'LOCAL_ID_REQUIRED' };
  }
  const leer = async (url) => {
    const { signal, clear } = withTimeout(6000);
    try {
      const resp = await fetch(url, { signal });
      clear();
      if (!resp.ok) return { ok: false, owner: null };
      return { ok: true, owner: (await resp.json()) || null };
    } catch (e) {
      clear();
      return { ok: false, owner: null, error: e?.message };
    }
  };

  const nuevo = await leer(ownerUrl(firebaseDb, cuit, ptoVta, localId));
  if (!nuevo.ok) return nuevo;              // error de red: NO se asume nada
  if (nuevo.owner) return nuevo;            // ruta nueva: fuente de verdad

  // Fallback TEMPORAL de solo lectura sobre la ruta global deprecada.
  const legado = await leer(ownerUrlLegado(firebaseDb, cuit, ptoVta));
  if (legado.ok && legado.owner) {
    return { ok: true, owner: { ...legado.owner, __origenLegado: true } };
  }
  return nuevo;                             // sin dueño en ninguna de las dos
};

/**
 * Toma posesión: esta PC pasa a ser la única autorizada para facturar esta
 * cuenta. Escribe EXCLUSIVAMENTE en `/{localId}/FACTURACION_OWNERS/...`.
 * Sin localId válido no escribe nada y devuelve el error.
 */
export const claimOwner = async (firebaseDb, cuit, ptoVta, ownerData, localId) => {
  let url;
  try {
    url = ownerUrl(firebaseDb, cuit, ptoVta, localId);
  } catch (e) {
    if (e instanceof LocalIdRequeridoError) {
      console.error('[FACTURACION_OWNERS] claim cancelado: no hay local válido.', e.message);
      return { ok: false, error: e.code };
    }
    throw e;
  }
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...ownerData,
        cuit,
        ptoVta,
        localId: normalizarLocalId(localId),
        updatedAt: Date.now(),
      }),
    });
    return { ok: resp.ok };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
};

/**
 * Libera la posesión: ninguna PC queda autorizada hasta que alguna la reclame.
 * Borra SOLO el registro nuevo; la ruta vieja no se toca (se migra aparte).
 */
export const releaseOwner = async (firebaseDb, cuit, ptoVta, localId) => {
  let url;
  try {
    url = ownerUrl(firebaseDb, cuit, ptoVta, localId);
  } catch (e) {
    if (e instanceof LocalIdRequeridoError) {
      console.error('[FACTURACION_OWNERS] release cancelado: no hay local válido.', e.message);
      return { ok: false, error: e.code };
    }
    throw e;
  }
  try {
    const resp = await fetch(url, { method: 'DELETE' });
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
export const subscribeOwner = (firebaseDb, cuit, ptoVta, callback, localId) => {
  if (!firebaseDb || !cuit || !ptoVta || typeof EventSource === 'undefined') {
    return () => {};
  }
  let url;
  try {
    url = ownerUrl(firebaseDb, cuit, ptoVta, localId);
  } catch (e) {
    // Sin local válido no se escucha nada: es preferible no tener stream a
    // escuchar el nodo equivocado.
    console.error('[FACTURACION_OWNERS] suscripción cancelada:', e.message);
    return () => {};
  }
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
