// ---------------------------------------------------------------------------
// VENTAS POR APP (PedidosYa / Rappi) — ACCESO DESDE LA APP
//
// SOLO LECTURA. Resuelve el local activo y delega en ventasAppsFlujo.js.
//
// Todas las rutas empiezan por /{localId}/ (regla de rutasLocales.js). Sin
// localId válido no se consulta nada, y si el usuario cambia de local mientras
// la consulta está en vuelo, se aborta: nunca se mezclan dos comercios ni se
// pintan en pantalla datos del local anterior.
//
// Archivo IDÉNTICO en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { getDatabase } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { leerVentasDeApps } from '@/lib/api/ventasAppsFlujo';
import { normalizarLocalId } from '@/lib/api/rutasLocales';

const raizLocal = () => normalizarLocalId(getCurrentDatabasePath());

/**
 * Historial de ventas por app del local ACTIVO, unificado y sin duplicar.
 *
 * @param {object} opciones { desde, hasta, historialCompleto }
 * @returns {Promise<{filas: Array, diagnostico: object, localId: string}>}
 * @throws  Error('LOCAL_ID_REQUIRED') si no hay local; error con code
 *          'LOCAL_CHANGED' si el local cambió durante la consulta.
 */
export const fetchVentasDeApps = async ({ desde, hasta, historialCompleto = false } = {}) => {
  const raiz = raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');

  const resultado = await leerVentasDeApps(getDatabase(), raiz, {
    desde,
    hasta,
    historialCompleto,
    // Se revalida entre lectura y lectura: si el usuario cambió de local, la
    // consulta se corta en vez de devolver datos mezclados.
    seguirVigente: () => raizLocal() === raiz,
  });

  return { ...resultado, localId: raiz };
};
