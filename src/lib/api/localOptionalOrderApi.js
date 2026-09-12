// ---------------------------------------------------------------------------
// Orden manual de opcionales/sabores — LOCAL por PC, NUNCA en Firebase.
//
// Reemplaza a optionalOrderApi.js (que guardaba en
// `{localId}/CONFIGURACION/ORDEN_OPCIONALES/{groupId}`, UN solo orden
// compartido por TODAS las PCs del local). Mismos nombres y firmas de función
// que ese módulo — OptionalSelectionModal.jsx solo cambia de dónde importa —
// pero ahora el destino es un archivo en `userData` de ESTA PC (ver
// electron/lib/optionalesOrdenLocal.js), vía IPC (`window.electronAPI.optionalesOrden`).
//
// `deviceId` es el MISMO identificador que ya usa la app para registrarse en
// `{localId}/DISPOSITIVOS/{deviceId}` (obtenerDeviceId) — no se crea un
// segundo id de equipo.
// ---------------------------------------------------------------------------
import { obtenerDeviceId } from '@/lib/api/deviceIdentity';
import { getCurrentLocalId, getLocalId } from '@/lib/firebase/core';

const resolverLocalId = () => getCurrentLocalId() || getLocalId();

const apiDisponible = () => (
  typeof window !== 'undefined' && !!window.electronAPI && !!window.electronAPI.optionalesOrden
);

/**
 * Orden guardado de TODOS los grupos, para el local y el dispositivo
 * (PC) actuales. `{}` si no hay nada guardado todavía o si no se pudo leer
 * (nunca lanza: permite caer al orden por defecto del catálogo).
 */
export const fetchAllOptionalOrders = async () => {
  if (!apiDisponible()) return {};
  const localId = resolverLocalId();
  if (!localId) return {};
  try {
    const deviceId = obtenerDeviceId();
    const ordersMap = await window.electronAPI.optionalesOrden.readAll({ localId, deviceId });
    return (ordersMap && typeof ordersMap === 'object') ? ordersMap : {};
  } catch (error) {
    console.error('[Optional Order API local] Error fetching all optional orders:', error);
    return {};
  }
};

/** Orden guardado de UN grupo. `null` si no hay nada guardado. */
export const fetchOptionalOrder = async (groupId) => {
  const all = await fetchAllOptionalOrders();
  return (all && Array.isArray(all[groupId])) ? all[groupId] : null;
};

/** Guarda el orden de UN grupo para esta PC + este local. */
export const saveOptionalOrder = async (groupId, orderedItemIds) => {
  if (!apiDisponible()) return;
  const localId = resolverLocalId();
  if (!localId || !groupId || !Array.isArray(orderedItemIds)) {
    console.warn('[Optional Order API local] Invalid parameters for saveOptionalOrder');
    return;
  }
  try {
    const deviceId = obtenerDeviceId();
    const r = await window.electronAPI.optionalesOrden.write({ localId, deviceId, groupId, order: orderedItemIds });
    if (!r || !r.ok) throw new Error(r?.motivo || 'No se pudo guardar');
    console.log(`[Optional Order API local] Order saved for group: ${groupId}`, orderedItemIds);
  } catch (error) {
    console.error('[Optional Order API local] Error saving optional order:', error);
    throw new Error(`No se pudo guardar el orden de opcionales para el grupo ${groupId}`);
  }
};

/** Guarda el orden de varios grupos a la vez, para esta PC + este local. */
export const saveMultipleOptionalOrders = async (ordersMap) => {
  if (!apiDisponible()) return;
  const localId = resolverLocalId();
  if (!localId || !ordersMap || typeof ordersMap !== 'object') {
    console.warn('[Optional Order API local] Invalid ordersMap for saveMultipleOptionalOrders');
    return;
  }
  const entradasValidas = Object.fromEntries(
    Object.entries(ordersMap).filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
  );
  if (Object.keys(entradasValidas).length === 0) {
    console.log('[Optional Order API local] No valid orders to save');
    return;
  }
  try {
    const deviceId = obtenerDeviceId();
    const r = await window.electronAPI.optionalesOrden.writeMultiple({ localId, deviceId, ordersMap: entradasValidas });
    if (!r || !r.ok) throw new Error(r?.motivo || 'No se pudo guardar');
    console.log('[Optional Order API local] Multiple orders saved:', Object.keys(entradasValidas));
  } catch (error) {
    console.error('[Optional Order API local] Error saving multiple optional orders:', error);
    throw new Error('No se pudo guardar el orden de opcionales');
  }
};
