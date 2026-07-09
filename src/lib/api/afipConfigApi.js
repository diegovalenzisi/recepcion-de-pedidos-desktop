import { getDatabase, ref, set, get } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';

const AFIP_PATH = (localId) => `${localId}/CONFIGURACION/FACTURACION_AFIP`;

// Campos que NO se guardan en Firebase (paths locales, archivos seleccionados,
// o decisiones que deben ser exclusivas de ESTA PC).
//
// IMPORTANTE — `activo` ("Inicio automático de facturación") es intencionalmente
// PC-local: si se sincronizara vía Firebase, cualquier otra PC que abra el mismo
// local heredaría automáticamente el inicio automático y podría facturar el mismo
// pedido dos veces. Nunca debe viajar a Firebase ni adoptarse desde Firebase.
const LOCAL_ONLY_FIELDS = ['certFile', 'keyFile', 'serviceAccountFile', 'activo'];

function sanitize(fields) {
  const out = { ...fields };
  LOCAL_ONLY_FIELDS.forEach(f => delete out[f]);
  return out;
}

/**
 * Guarda la configuración AFIP (sin archivos sensibles) en RTDB.
 * Los paths de Storage (certStoragePath, etc.) se guardan si ya fueron subidos.
 */
export const saveAfipConfigToFirebase = async (config) => {
  const localId = getCurrentDatabasePath();
  if (!localId) throw new Error('localId no disponible');

  const db  = getDatabase();
  const doc = {
    tipo:       config.tipo,
    autoStart:  config.autoStart ?? false,
    updatedAt:  new Date().toISOString(),
    ri:         config.ri ? sanitize(config.ri) : undefined,
    monotributo: config.monotributo
      ? { cuentas: (config.monotributo.cuentas || []).map(sanitize) }
      : undefined,
  };

  // Eliminar campos undefined para no escribir nulls en RTDB
  Object.keys(doc).forEach(k => doc[k] === undefined && delete doc[k]);

  await set(ref(db, AFIP_PATH(localId)), doc);
};

/**
 * Lee la configuración AFIP desde RTDB.
 * Devuelve null si no existe.
 */
export const fetchAfipConfigFromFirebase = async () => {
  const localId = getCurrentDatabasePath();
  if (!localId) return null;
  const db  = getDatabase();
  const snap = await get(ref(db, AFIP_PATH(localId)));
  return snap.exists() ? snap.val() : null;
};

/**
 * Actualiza solo los paths de Storage de una cuenta específica en RTDB,
 * sin pisar el resto de la configuración.
 */
export const updateAfipCertPaths = async (tipo, cuentaId, paths) => {
  const localId = getCurrentDatabasePath();
  if (!localId) return;
  const db    = getDatabase();
  let subPath = '';
  if (tipo === 'responsable_inscripto') {
    subPath = `${AFIP_PATH(localId)}/ri`;
  } else {
    // find cuenta index... easier: use set on the full cuenta
    // just do a full config update from the caller instead
    return;
  }
  const r = ref(db, subPath);
  const snap = await get(r);
  if (snap.exists()) {
    await set(r, { ...snap.val(), ...paths });
  }
};
