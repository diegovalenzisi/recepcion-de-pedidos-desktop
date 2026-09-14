// ---------------------------------------------------------------------------
// Posicionamiento manual 2D de opcionales/sabores — LOCAL por PC, NUNCA en
// Firebase. Ver electron/lib/optionalesGridLocal.js.
//
// Mismo patrón que localOptionalOrderApi.js: `deviceId` es el MISMO
// identificador que ya usa la app para registrarse en
// `{localId}/DISPOSITIVOS/{deviceId}` (obtenerDeviceId) — no se crea un
// segundo id de equipo.
// ---------------------------------------------------------------------------
import { obtenerDeviceId } from '@/lib/api/deviceIdentity';
import { getCurrentLocalId, getLocalId } from '@/lib/firebase/core';

const resolverLocalId = () => getCurrentLocalId() || getLocalId();

const apiDisponible = () => (
  typeof window !== 'undefined' && !!window.electronAPI && !!window.electronAPI.optionalesGrid
);

/**
 * Grilla guardada de TODOS los grupos, para el local y el dispositivo (PC)
 * actuales. `{}` si no hay nada guardado todavía o si no se pudo leer (nunca
 * lanza: permite caer a la grilla por defecto).
 */
export const fetchAllOptionalGrids = async () => {
  if (!apiDisponible()) return {};
  const localId = resolverLocalId();
  if (!localId) return {};
  try {
    const deviceId = obtenerDeviceId();
    const gridsMap = await window.electronAPI.optionalesGrid.readAll({ localId, deviceId });
    return (gridsMap && typeof gridsMap === 'object') ? gridsMap : {};
  } catch (error) {
    console.error('[Optional Grid API local] Error fetching all optional grids:', error);
    return {};
  }
};

/** Grilla guardada de UN grupo. `null` si no hay nada guardado. */
export const fetchOptionalGrid = async (groupId) => {
  const all = await fetchAllOptionalGrids();
  return (all && all[groupId]) ? all[groupId] : null;
};

/** Guarda la grilla de UN grupo para esta PC + este local. */
export const saveOptionalGrid = async (groupId, grid) => {
  if (!apiDisponible()) return;
  const localId = resolverLocalId();
  if (!localId || !groupId || !grid || typeof grid !== 'object') {
    console.warn('[Optional Grid API local] Invalid parameters for saveOptionalGrid');
    return;
  }
  try {
    const deviceId = obtenerDeviceId();
    const r = await window.electronAPI.optionalesGrid.write({ localId, deviceId, groupId, grid });
    if (!r || !r.ok) throw new Error(r?.motivo || 'No se pudo guardar');
    console.log(`[Optional Grid API local] Grid saved for group: ${groupId}`, grid);
  } catch (error) {
    console.error('[Optional Grid API local] Error saving optional grid:', error);
    throw new Error(`No se pudo guardar la distribución de opcionales para el grupo ${groupId}`);
  }
};
