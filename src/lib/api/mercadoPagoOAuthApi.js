// ---------------------------------------------------------------------------
// CONEXIÓN DE MERCADO PAGO POR OAuth — lado cliente.
//
// Cada local puede tener hasta 5 cuentas de Mercado Pago conectadas al mismo
// tiempo (`cuentaId` "1" a "5", ver DLV Consultas/functions/lib/mpOAuthState.js
// :CUENTAS_MP_POR_LOCAL), cada una independiente: se conecta, se desconecta y
// recibe avisos de pago por separado.
//
// Esta app NUNCA ve ni guarda access_token/refresh_token/client_secret: sólo
// lee el estado NO sensible de cada posición en `{localId}/MERCADOPAGO/{cuentaId}`
// (conectado, userIdMercadoPago, fechaConexion, liveMode, alias) — nada de eso
// es una credencial de Mercado Pago. El `alias` (ej. "Mónica", "Caja 2") sí se
// escribe directo desde acá porque no es sensible.
//
// Para DESCONECTAR una posición puntual no se guarda ningún token en Firebase:
// se le pide uno nuevo al servidor (mpOAuthDisconnectRequest), de un solo
// propósito y 2 minutos de vigencia, y se usa inmediatamente
// (mpOAuthDisconnect). Así no existe ningún valor persistente que alguien con
// acceso de lectura a esta base pudiera leer y reutilizar más tarde.
//
// El intercambio real de código por tokens, su renovación y la detección de
// pagos (webhook + respaldo programado) para las cuentas conectadas por
// OAuth corren enteramente del lado servidor, en las Cloud Functions de
// `DLV Consultas/functions/mercadoPagoOAuth.js`.
// ---------------------------------------------------------------------------
import { ref, onValue, update } from 'firebase/database';
import { getCurrentDatabaseOrThrow, getCurrentDatabasePath, checkLocalId, getLocalId } from '@/lib/firebase/core';

// Mismo proyecto/región que el resto de las Cloud Functions de DLV
// (ver DLV Consultas/functions/mercadoPagoOAuth.js — REGION/REDIRECT_URI).
const FUNCTIONS_BASE_URL = 'https://us-central1-achava3703.cloudfunctions.net';

/** Posiciones válidas de cuenta de Mercado Pago dentro de un local: 1 a 5, fijo. */
export const CUENTAS_MP_POR_LOCAL = 5;
export const CUENTA_IDS = Array.from({ length: CUENTAS_MP_POR_LOCAL }, (_, i) => String(i + 1));

const mercadoPagoPath = () => {
  checkLocalId();
  return `${getCurrentDatabasePath()}/MERCADOPAGO`;
};

const checkCuentaId = (cuentaId) => {
  if (!CUENTA_IDS.includes(String(cuentaId))) throw new Error(`cuentaId inválido: ${cuentaId} (debe ser 1 a 5)`);
};

/**
 * Escucha en vivo el estado de conexión de las hasta 5 cuentas de Mercado
 * Pago de ESTE local. `callback` recibe un objeto `{ '1': {...} | undefined,
 * '2': {...}, ... }` (nunca `null`: las posiciones sin conectar simplemente
 * no tienen clave). Cada posición conectada trae
 * `{ conectado, userIdMercadoPago, fechaConexion, liveMode, alias }`.
 */
export const listenToMercadoPagoOAuthStatus = (callback, errorCallback) => {
  try {
    const db = getCurrentDatabaseOrThrow();
    const estadoRef = ref(db, mercadoPagoPath());
    return onValue(
      estadoRef,
      (snapshot) => callback(snapshot.val() || {}),
      (error) => { console.error('[mercadoPagoOAuth] error leyendo estado:', error); errorCallback?.(error); },
    );
  } catch (error) {
    console.error('[mercadoPagoOAuth] error configurando listener:', error);
    errorCallback?.(error);
    return () => {};
  }
};

/** URL que hay que abrir en el navegador del sistema para conectar la posición `cuentaId` (1-5) de este local. */
export const buildMercadoPagoOAuthStartUrl = (cuentaId) => {
  checkCuentaId(cuentaId);
  const localId = getLocalId();
  if (!localId) throw new Error('LOCAL_ID_REQUIRED');
  return `${FUNCTIONS_BASE_URL}/mpOAuthStart?localId=${encodeURIComponent(localId)}&cuentaId=${encodeURIComponent(cuentaId)}`;
};

/**
 * Desconecta la posición `cuentaId` (1-5) de este local, en dos pasos, ambos
 * contra el servidor: (1) pedir un token de desconexión recién firmado, de
 * un solo propósito; (2) usarlo de inmediato. Nunca pasa por Firebase. Las
 * demás posiciones del mismo local no se ven afectadas.
 */
export const disconnectMercadoPago = async (cuentaId) => {
  checkCuentaId(cuentaId);
  const localId = getLocalId();
  if (!localId) throw new Error('LOCAL_ID_REQUIRED');

  const rToken = await fetch(
    `${FUNCTIONS_BASE_URL}/mpOAuthDisconnectRequest?localId=${encodeURIComponent(localId)}&cuentaId=${encodeURIComponent(cuentaId)}`,
  );
  const datosToken = await rToken.json().catch(() => ({}));
  if (!rToken.ok || !datosToken?.disconnectToken) {
    throw new Error(datosToken?.error || `No se pudo iniciar la desconexión (HTTP ${rToken.status}).`);
  }

  const r = await fetch(`${FUNCTIONS_BASE_URL}/mpOAuthDisconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disconnectToken: datosToken.disconnectToken }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `No se pudo desconectar (HTTP ${r.status}).`);
  return data;
};

/**
 * Cambia el alias editable (ej. "Principal", "Mónica", "Caja 2") de la
 * posición `cuentaId`. No es un dato sensible — se escribe directo a
 * Firebase, sin pasar por las Cloud Functions. Funciona tanto si la posición
 * ya está conectada como si todavía no (queda guardado para cuando se
 * conecte: el callback de OAuth usa PATCH, nunca pisa el alias existente).
 */
export const updateMercadoPagoAlias = async (cuentaId, alias) => {
  checkCuentaId(cuentaId);
  const db = getCurrentDatabaseOrThrow();
  const aliasLimpio = (alias || '').trim();
  await update(ref(db, `${mercadoPagoPath()}/${cuentaId}`), { alias: aliasLimpio });
};
