// ---------------------------------------------------------------------------
// IMPRESIÓN AUTOMÁTICA DEL COMPROBANTE FISCAL — FIREBASE
//
// Capa delgada sobre impresionFiscal.js: mira las facturas emitidas, toma la
// impresión con una transacción (una sola terminal gana) e imprime. Las reglas
// —gracia, lease, reintentos— viven en el módulo puro.
//
// NO toca /{localId}/VENTAS ni la cola fiscal: sólo escribe su propio estado en
// /{localId}/IMPRESION/{claveFactura}.
// ---------------------------------------------------------------------------

import { getDatabase, ref, get, onValue, runTransaction, query, orderByKey, limitToLast } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { construirRutaLocal, normalizarLocalId } from '@/lib/api/rutasLocales';
import { idDeEsteDispositivo } from '@/lib/api/facturacionDeRemitoApi';
import { imprimirComprobanteFiscal } from '@/lib/print/comprobanteFiscalPrint';
import {
  decidirImpresion, marcaImpresa, marcaError, pidioImpresion, tieneCae,
  IMPRIMIENDO,
} from '@/lib/api/impresionFiscal';

/** Cuántos comprobantes recientes se vigilan. */
const VENTAS_A_VIGILAR = 40;

/** Cada cuánto se reevalúa (para que venzan la gracia y el backoff). */
const TICK_MS = 10_000;

const rutaImpresion = (raiz, clave) => construirRutaLocal(raiz, `IMPRESION/${clave}`);

/**
 * Intenta imprimir UNA factura. Devuelve qué pasó, sin lanzar nunca: un fallo de
 * impresión no puede romper la aplicación.
 */
export const intentarImprimirFactura = async (clave, registro, { deviceId = null } = {}) => {
  const raiz = normalizarLocalId(getCurrentDatabasePath());
  if (!raiz) return { accion: 'nada', motivo: 'sin-local' };

  const yo = deviceId || idDeEsteDispositivo();
  const db = getDatabase();
  const refNodo = ref(db, rutaImpresion(raiz, clave));

  // TOMA DE LA IMPRESIÓN. La condición la evalúa el servidor dentro de la
  // transacción: dos terminales a la vez producen UNA sola impresión.
  let decision = { accion: 'nada', motivo: 'sin-evaluar' };
  try {
    await runTransaction(refNodo, (nodo) => {
      decision = decidirImpresion({ nodo, registro, deviceId: yo });
      return decision.accion === 'imprimir' ? decision.nodo : undefined;
    });
  } catch (e) {
    return { accion: 'nada', motivo: 'error-de-lock', detalle: e?.message };
  }

  if (decision.accion !== 'imprimir') return decision;

  // Ya es MÍA: imprimo y cierro el estado según el resultado.
  let resultado;
  try {
    resultado = await imprimirComprobanteFiscal(clave, registro);
  } catch (e) {
    resultado = { ok: false, motivo: e?.message || 'error-inesperado' };
  }

  const cerrar = resultado.ok
    ? (n) => marcaImpresa(n, { deviceId: yo, numero: resultado.numero })
    : (n) => marcaError(n, {
      deviceId: yo,
      mensaje: resultado.faltantes?.length
        ? `${resultado.motivo}: ${resultado.faltantes.join(' · ')}`
        : resultado.motivo,
    });

  try {
    await runTransaction(refNodo, (nodo) => {
      // Sólo cierra quien la tiene tomada: si otra terminal la retomó mientras
      // tanto, no se pisa su estado.
      if (nodo && nodo.estado === IMPRIMIENDO && String(nodo.deviceId) !== String(yo)) return undefined;
      return cerrar(nodo);
    });
  } catch { /* el estado se recupera en el próximo barrido */ }

  return resultado.ok
    ? { accion: 'impresa', motivo: decision.motivo, numero: resultado.numero }
    : { accion: 'error', motivo: resultado.motivo, faltantes: resultado.faltantes };
};

/**
 * Revisa las facturas recientes y procesa las que estén esperando impresión.
 * Es el barrido de recuperación: sirve al arrancar, al reconectar y en cada tick
 * (para que venzan la ventana de gracia y el backoff de los reintentos).
 */
export const recuperarImpresionesPendientes = async ({ deviceId = null } = {}) => {
  const raiz = normalizarLocalId(getCurrentDatabasePath());
  if (!raiz) return { revisadas: 0, impresas: 0 };

  const db = getDatabase();
  const snap = await get(query(ref(db, construirRutaLocal(raiz, 'VENTAS')), orderByKey(), limitToLast(VENTAS_A_VIGILAR)));
  if (!snap.exists()) return { revisadas: 0, impresas: 0 };

  const ventas = snap.val() || {};
  let impresas = 0;
  let revisadas = 0;

  // En serie: son pocas y cada impresión abre una ventana.
  for (const clave of Object.keys(ventas)) {
    const registro = ventas[clave];
    if (!pidioImpresion(registro) || !tieneCae(registro)) continue;
    revisadas += 1;
    const r = await intentarImprimirFactura(clave, registro, { deviceId });
    if (r.accion === 'impresa') impresas += 1;
  }
  return { revisadas, impresas };
};

/**
 * Vigila las facturas emitidas y dispara la impresión pendiente.
 *
 * Combina dos disparadores porque hacen falta los dos:
 *   · onValue  → reacciona apenas el motor escribe el comprobante con CAE;
 *   · tick     → hace vencer la ventana de gracia y el backoff, que son tiempo
 *                y no producen ningún evento de Firebase.
 *
 * @returns {() => void} función para dejar de vigilar.
 */
export const vigilarImpresionesFiscales = ({ onEstado = null } = {}) => {
  const raiz = normalizarLocalId(getCurrentDatabasePath());
  if (!raiz) return () => {};

  const deviceId = idDeEsteDispositivo();
  const db = getDatabase();
  let vivo = true;
  let corriendo = false;

  const procesar = async () => {
    if (!vivo || corriendo) return;      // una pasada por vez
    corriendo = true;
    try {
      const r = await recuperarImpresionesPendientes({ deviceId });
      if (onEstado && r.impresas > 0) onEstado(r);
    } catch (e) {
      console.warn('[impresión fiscal] barrido con error:', e?.message || e);
    } finally {
      corriendo = false;
    }
  };

  const off = onValue(
    query(ref(db, construirRutaLocal(raiz, 'VENTAS')), orderByKey(), limitToLast(VENTAS_A_VIGILAR)),
    () => { procesar(); },
    (e) => console.warn('[impresión fiscal] listener de VENTAS:', e?.message || e),
  );

  const timer = setInterval(procesar, TICK_MS);
  procesar();   // recuperación inmediata al arrancar

  return () => {
    vivo = false;
    clearInterval(timer);
    try { off(); } catch { /* ya desuscripto */ }
  };
};
