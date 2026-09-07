// ---------------------------------------------------------------------------
// VENTAS DE MOSTRADOR POR DEPARTAMENTO — ACCESO DESDE LA APP
//
// SOLO LECTURA. Resuelve el local activo y delega en ventasPorDepartamentoFlujo.js.
//
// Todas las rutas empiezan por /{localId}/ (regla de rutasLocales.js). Sin
// localId válido no se consulta nada, y si el usuario cambia de local mientras
// la consulta está en vuelo, se aborta: nunca se mezclan dos comercios ni se
// pintan en pantalla datos del local anterior.
// ---------------------------------------------------------------------------

import { getDatabase } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { leerVentasPorDepartamento } from '@/lib/api/ventasPorDepartamentoFlujo';
import { normalizarLocalId } from '@/lib/api/rutasLocales';

const raizLocal = () => normalizarLocalId(getCurrentDatabasePath());

/**
 * Historial de ventas de Mostrador por departamento (PedidosYa/Rappi/M.LIBRE)
 * del local ACTIVO, unificado y sin duplicar.
 *
 * @param {object} opciones { desde, hasta, historialCompleto }
 * @returns {Promise<{filas: Array, diagnostico: object, localId: string}>}
 * @throws  Error('LOCAL_ID_REQUIRED') si no hay local; error con code
 *          'LOCAL_CHANGED' si el local cambió durante la consulta.
 */
export const fetchVentasPorDepartamento = async ({ desde, hasta, historialCompleto = false } = {}) => {
  const raiz = raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');

  const resultado = await leerVentasPorDepartamento(getDatabase(), raiz, {
    desde,
    hasta,
    historialCompleto,
    // Se revalida entre lectura y lectura: si el usuario cambió de local, la
    // consulta se corta en vez de devolver datos mezclados.
    seguirVigente: () => raizLocal() === raiz,
  });

  return { ...resultado, localId: raiz };
};
