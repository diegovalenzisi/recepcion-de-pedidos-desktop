'use strict';

// -----------------------------------------------------------------------
// COMPARACIÓN DE VERSIONES DEL ACTUALIZADOR OBLIGATORIO.
//
// REGLA ABSOLUTA: el actualizador JAMÁS instala automáticamente una versión
// MENOR a la ya instalada — ni siquiera si `mandatory` (obligatoria) está en
// true. `mandatory` solo significa:
//
//     "si hay una versión REMOTA MÁS NUEVA que la instalada, no dejar
//      arrancar hasta actualizar"
//
// NUNCA significa "la PC tiene que terminar con exactamente esa versión". Si
// la instalada ya es igual o más nueva que la remota, `mandatory` no hace
// nada: se arranca normalmente.
//
// La comparación es NUMÉRICA por segmento, nunca lexicográfica/de string:
// "1.10.0" > "1.9.99" y "1.3.100" > "1.3.99", aunque como texto sea al revés.
// Soporta cualquier cantidad de segmentos (no asume exactamente 3).
//
// Módulo PURO: sin Electron, sin red, sin filesystem, sin `app.getVersion()`.
// Se prueba directo con node:assert — ver __tests__/actualizacionVersion.test.js.
// -----------------------------------------------------------------------

/** true si `a` es una versión ESTRICTAMENTE mayor que `b`, comparando segmento por segmento como número. */
function esVersionMayor(a, b) {
  const pa = String(a ?? '').trim().split('.').map(Number);
  const pb = String(b ?? '').trim().split('.').map(Number);
  const largo = Math.max(pa.length, pb.length);
  for (let i = 0; i < largo; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false; // todos los segmentos iguales
}

/** true si `a` y `b` son exactamente la misma versión, segmento por segmento. */
function esMismaVersion(a, b) {
  return !esVersionMayor(a, b) && !esVersionMayor(b, a);
}

/**
 * Decide qué hacer frente a `latest.json`, sin permitir NUNCA un downgrade
 * automático — ni siquiera con `mandatory: true`.
 *
 *   remoteVersion > currentVersion                   -> hasUpdate: true
 *   remoteVersion > currentVersion && mandatory       -> blocksStartup: true (obligatoria)
 *   remoteVersion <= currentVersion (igual O MENOR)   -> hasUpdate: false, blocksStartup: false,
 *                                                         SIEMPRE, sin importar `mandatory`.
 *
 * @param {{ currentVersion: string, remoteVersion: string, mandatory: boolean }} params
 * @returns {{ hasUpdate: boolean, blocksStartup: boolean, reason: string }}
 *   reason: 'version-ausente' | 'version-local-mas-nueva' | 'version-igual'
 *         | 'actualizacion-obligatoria' | 'actualizacion-disponible'
 */
function decidirActualizacion({ currentVersion, remoteVersion, mandatory }) {
  if (!currentVersion || !remoteVersion) {
    return { hasUpdate: false, blocksStartup: false, reason: 'version-ausente' };
  }

  const hayVersionMasNueva = esVersionMayor(remoteVersion, currentVersion);
  if (!hayVersionMasNueva) {
    // Cubre tanto "remota == local" como "remota < local" (el caso crítico
    // del downgrade): en ambos casos NO se actualiza, sin excepción.
    return {
      hasUpdate: false,
      blocksStartup: false,
      reason: esVersionMayor(currentVersion, remoteVersion) ? 'version-local-mas-nueva' : 'version-igual',
    };
  }

  return {
    hasUpdate: true,
    blocksStartup: mandatory === true,
    reason: mandatory === true ? 'actualizacion-obligatoria' : 'actualizacion-disponible',
  };
}

module.exports = { esVersionMayor, esMismaVersion, decidirActualizacion };
