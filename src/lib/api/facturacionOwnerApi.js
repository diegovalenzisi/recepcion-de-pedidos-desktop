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

const sanitizeKey = (v) => String(v ?? '').trim().replace(/[.#$[\]/\s]/g, '');

export const ownerKeyFor = (cuit, ptoVta) => `${sanitizeKey(cuit)}_${sanitizeKey(ptoVta)}`;

const ownerUrl = (firebaseDb, cuit, ptoVta) => {
  const base = String(firebaseDb || '').replace(/\/+$/, '');
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
