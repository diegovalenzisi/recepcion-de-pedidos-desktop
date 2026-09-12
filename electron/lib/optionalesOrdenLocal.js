'use strict';

const path = require('node:path');
const fsReal = require('node:fs');

// ---------------------------------------------------------------------------
// ORDEN MANUAL DE OPCIONALES/SABORES — LOCAL POR PC, NUNCA EN FIREBASE.
//
// El orden en que el operador arrastra los sabores en OptionalSelectionModal
// (Nuevo Pedido) se guardaba en Firebase, en
// `{localId}/CONFIGURACION/ORDEN_OPCIONALES/{groupId}` — UN solo orden para
// TODO el local, compartido por todas sus PCs. Eso es lo que se reemplaza
// acá: el orden pasa a ser una preferencia de ESTA PC, independiente por
// local y por dispositivo, y NUNCA se escribe a Firebase ni se sincroniza.
//
// ALMACENAMIENTO: un archivo JSON por local, en
//     userData/optionales-orden/{localId}.json
// con la forma:
//     { [deviceId]: { [groupId]: string[] (ids de opcionales, en orden) } }
//
// `userData` vive FUERA de la carpeta de instalación (que una actualización
// SÍ reemplaza): sobrevive reinicios de Windows y actualizaciones de la app,
// igual que `facturacion-config.json`/`active-local.json`, que usan el mismo
// patrón.
//
// `deviceId` es el MISMO identificador que ya usa la app para registrarse en
// `{localId}/DISPOSITIVOS/{deviceId}` (obtenerDeviceId, src/lib/api/deviceIdentity.js)
// — no se crea un segundo id de equipo. Lo resuelve y lo manda el renderer
// (ahí vive localStorage); este módulo solo lo usa como clave de archivo.
//
// Módulo con efectos reales de filesystem, pero con las funciones de fs
// inyectables para poder probarlo contra un directorio temporal real, sin
// tocar el userData real ni depender de Electron.
// ---------------------------------------------------------------------------

/** Nombre de archivo (un archivo por local, nunca uno global). */
function rutaArchivoOrden(userDataDir, localId) {
  return path.join(userDataDir, 'optionales-orden', `${String(localId)}.json`);
}

/**
 * Lee el archivo de orden de un local. Un archivo ausente, vacío o corrupto
 * se trata como "todavía no hay nada guardado" (nunca rompe la pantalla de
 * pedido): devuelve `{}`.
 */
function leerArchivoOrden(ruta, { existsSyncFn = fsReal.existsSync, readFileSyncFn = fsReal.readFileSync } = {}) {
  if (!existsSyncFn(ruta)) return {};
  try {
    const data = JSON.parse(readFileSyncFn(ruta, 'utf-8'));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch {
    return {};
  }
}

/** Escribe el archivo completo (ya mergeado por el caller). Crea la carpeta si falta. */
function escribirArchivoOrden(ruta, data, { mkdirSyncFn = fsReal.mkdirSync, writeFileSyncFn = fsReal.writeFileSync } = {}) {
  mkdirSyncFn(path.dirname(ruta), { recursive: true });
  writeFileSyncFn(ruta, JSON.stringify(data, null, 2), 'utf-8');
}

const soloStrings = (arr) => (Array.isArray(arr) ? arr.filter((id) => typeof id === 'string') : []);

/** Todos los grupos guardados para ESTE dispositivo. `{}` si no hay nada. */
function obtenerOrdenesDelDispositivo(data, deviceId) {
  const porDispositivo = data && typeof data === 'object' ? data[deviceId] : null;
  if (!porDispositivo || typeof porDispositivo !== 'object') return {};
  const resultado = {};
  for (const [groupId, orden] of Object.entries(porDispositivo)) {
    resultado[groupId] = soloStrings(orden);
  }
  return resultado;
}

/** Orden guardado de UN grupo para este dispositivo. `[]` si no hay nada. */
function obtenerOrdenGuardado(data, deviceId, groupId) {
  return obtenerOrdenesDelDispositivo(data, deviceId)[groupId] || [];
}

/** Devuelve un `data` NUEVO (inmutable) con el orden de un grupo actualizado. */
function conOrdenActualizado(data, deviceId, groupId, ordenNuevo) {
  const base = data && typeof data === 'object' ? data : {};
  const previoDispositivo = base[deviceId] && typeof base[deviceId] === 'object' ? base[deviceId] : {};
  return {
    ...base,
    [deviceId]: {
      ...previoDispositivo,
      [groupId]: soloStrings(ordenNuevo),
    },
  };
}

/** Igual que `conOrdenActualizado`, para varios grupos a la vez (mismo dispositivo). */
function conOrdenesMultiplesActualizadas(data, deviceId, ordenesPorGrupo) {
  let resultado = data && typeof data === 'object' ? data : {};
  for (const [groupId, orden] of Object.entries(ordenesPorGrupo || {})) {
    resultado = conOrdenActualizado(resultado, deviceId, groupId, orden);
  }
  return resultado;
}

/**
 * Combina el orden GUARDADO de un grupo con los ids REALMENTE vigentes ahora:
 *   - conserva el orden guardado para los ids que siguen existiendo;
 *   - IGNORA sin error los ids guardados que ya no existen (sabor eliminado);
 *   - agrega al FINAL, en su orden original, cualquier id vigente que no
 *     estuviera guardado (sabor nuevo).
 * Nunca muta `ordenGuardado` ni `idsVigentes`.
 */
function combinarOrdenConVigentes(ordenGuardado, idsVigentes) {
  const vigentes = soloStrings(idsVigentes);
  const vigentesSet = new Set(vigentes);
  const yaUbicados = new Set();
  const resultado = [];

  for (const id of soloStrings(ordenGuardado)) {
    if (vigentesSet.has(id) && !yaUbicados.has(id)) {
      resultado.push(id);
      yaUbicados.add(id);
    }
  }
  for (const id of vigentes) {
    if (!yaUbicados.has(id)) {
      resultado.push(id);
      yaUbicados.add(id);
    }
  }
  return resultado;
}

module.exports = {
  rutaArchivoOrden,
  leerArchivoOrden,
  escribirArchivoOrden,
  obtenerOrdenesDelDispositivo,
  obtenerOrdenGuardado,
  conOrdenActualizado,
  conOrdenesMultiplesActualizadas,
  combinarOrdenConVigentes,
};
