// ---------------------------------------------------------------------------
// REGISTRO DEL DISPOSITIVO — Desktop.
//
// Antes de activar la contabilidad nueva hay que poder comprobar que TODOS los
// equipos ya tienen la versión que emite movimientos. Hoy eso no se puede
// saber: `DISPOSITIVOS` solo lo escribe la Tablet, y desde una pantalla de
// configuración que un equipo puede no abrir nunca.
//
// Este módulo registra el equipo AL ARRANQUE, en la MISMA estructura que ya
// existe, agregándole `clientVersion`:
//
//     {localId}/DISPOSITIVOS/{deviceId}
//         deviceName
//         deviceType     'desktop'
//         localId
//         lastSeenAt
//         clientVersion
//
// El `deviceId` se genera una vez y se guarda: un equipo que reinicia actualiza
// su `lastSeenAt`, no crea otra entrada.
//
// Todavía NO se usa para bloquear nada. Es solo el registro que va a permitir
// verificar adopción antes del corte.
// ---------------------------------------------------------------------------

/** Clave del id persistente de este equipo. */
const CLAVE_DEVICE_ID = 'dlvDeviceId';

/** UUID del equipo. Se genera una sola vez. */
const nuevoDeviceId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* sigue al fallback */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * Id de este equipo, estable entre reinicios.
 * @param {Storage} almacen inyectable para poder probarlo sin navegador
 */
export const obtenerDeviceId = (almacen = (typeof localStorage !== 'undefined' ? localStorage : null)) => {
  if (!almacen) return nuevoDeviceId();
  try {
    const guardado = almacen.getItem(CLAVE_DEVICE_ID);
    if (guardado) return guardado;
    const id = nuevoDeviceId();
    almacen.setItem(CLAVE_DEVICE_ID, id);
    return id;
  } catch {
    return nuevoDeviceId();
  }
};

/**
 * Payload del registro. Función PURA.
 *
 * `deviceType` y `clientVersion` los provee cada aplicación: es lo único que
 * cambia entre plataformas. Desktop toma la versión de `__APP_VERSION__` (Vite,
 * desde package.json) y Tablet de `App.getInfo()` (Capacitor, desde la APK
 * instalada). En los dos casos es la fuente REAL: nunca un número a mano.
 */
export const datosDeRegistro = ({ localId, deviceId, clientVersion, deviceType, ahora = Date.now(), deviceName }) => ({
  deviceName: deviceName || `${deviceType === 'tablet' ? 'Tablet' : 'Desktop'} ${localId}`,
  deviceType,
  localId: String(localId),
  lastSeenAt: ahora,
  clientVersion: String(clientVersion),
});

/**
 * Registra/actualiza este equipo en el local actual.
 *
 * PATCH, no PUT: no pisa a los demás dispositivos, y un equipo que ya existía
 * conserva su `deviceId` y solo refresca `lastSeenAt` y `clientVersion`.
 *
 * Nunca lanza: un fallo de registro no puede impedir que el local trabaje.
 */
export const registrarDispositivo = async ({ localId, firebaseUrl, deviceType, clientVersion }) => {
  if (!localId || !firebaseUrl) return { ok: false, motivo: 'sin local' };
  const deviceId = obtenerDeviceId();
  const datos = datosDeRegistro({ localId, deviceId, deviceType, clientVersion: clientVersion || 'desconocida' });
  try {
    const r = await fetch(`${firebaseUrl}/${localId}/DISPOSITIVOS/${deviceId}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    if (!r.ok) return { ok: false, motivo: `HTTP ${r.status}`, deviceId };
    console.log(`[DISPOSITIVO] ${deviceId} registrado: ${datos.deviceType} v${datos.clientVersion}`);
    return { ok: true, deviceId, datos };
  } catch (e) {
    console.warn('[DISPOSITIVO] no se pudo registrar:', e?.message || e);
    return { ok: false, motivo: e?.message || 'error', deviceId };
  }
};
