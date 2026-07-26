// ---------------------------------------------------------------------------
// REMITOS (FCX) — ACCESO DESDE LA APP
//
// Ruta única y canónica:   /{localId}/Remitos/{FCX0008-00010294}
//
// PROHIBIDO: /Remitos global, /Remitos/{localId}, o cualquier orden que no
// tenga el número de local como PRIMER segmento. Sin localId válido no se
// escribe nada (rutasLocales.js lanza LOCAL_ID_REQUIRED y acá se aborta).
//
// QUÉ NO HACE ESTE MÓDULO (a propósito):
//   - no descuenta stock              → lo hace transactionsApi al guardar la venta
//   - no toca caja ni turnos          → la venta ya impactó en MOSTRADOR / PEDIDOS
//   - no registra comisiones          → myAccountApi, una sola vez, en la venta
//   - no borra ni mueve la venta      → MOSTRADOR / PEDIDOS / BACKUP quedan intactos
//   - no factura ni pide CAE          → un remito NO es una factura
// Emitir un remito es UNA escritura de comprobante y UNA marca en la venta de
// origen. Reprocesar la misma venta no genera un segundo remito.
//
// Esta capa sólo resuelve QUIÉN (el local activo) y CON QUÉ (base de datos,
// punto de venta). La mecánica está en remitosFlujo.js, que se prueba contra el
// emulador. Archivo IDÉNTICO en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { getDatabase, ref, get, update, onValue, off } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import {
  NODO_REMITOS,
  PUNTO_VENTA_POR_DEFECTO,
  filasDeRemitos,
  rutaRemito,
  rutaRemitos,
} from '@/lib/api/remitos';
import { emitirRemito } from '@/lib/api/remitosFlujo';
import { normalizarLocalId, verificarMismoLocal } from '@/lib/api/rutasLocales';

/**
 * Raíz de datos del local activo. En Desktop puede ser un `databasePath`
 * configurado; en Tablet es el número de local. Los dos exponen el mismo
 * getter, así que este archivo es literalmente el mismo en los dos proyectos.
 */
const raizLocal = () => normalizarLocalId(getCurrentDatabasePath());

/**
 * Base de datos revalidando el local ANTES de cada escritura definitiva.
 * Entre un await y el siguiente el usuario pudo cambiar de local: si eso pasa,
 * `verificarMismoLocal` lanza LOCAL_CHANGED y la escritura se aborta en vez de
 * caer en el local equivocado.
 */
const dbDelMismoLocal = (raiz) => {
  verificarMismoLocal(raiz, raizLocal());
  return getDatabase();
};

// Punto de venta por local. Se lee una vez por local y se cachea: es
// configuración, no cambia entre ventas.
const cachePuntoVenta = {};

/**
 * Punto de venta para numerar los remitos. Sale de la configuración AFIP del
 * local (el mismo que usan sus facturas) para que el comprobante sea
 * reconocible; la SECUENCIA es propia y NUNCA consume la de AFIP.
 */
export const obtenerPuntoVenta = async (raiz) => {
  if (cachePuntoVenta[raiz]) return cachePuntoVenta[raiz];
  try {
    const snap = await get(ref(getDatabase(), `${raiz}/CONFIGURACION/FACTURACION_AFIP`));
    const cfg = snap.exists() ? snap.val() : null;
    const pv = cfg?.ri?.ptoVta || cfg?.monotributo?.cuentas?.[0]?.ptoVta || PUNTO_VENTA_POR_DEFECTO;
    cachePuntoVenta[raiz] = pv;
    return pv;
  } catch (e) {
    console.warn('[REMITO] No se pudo leer el punto de venta, se usa el de por defecto:', e?.message || e);
    return PUNTO_VENTA_POR_DEFECTO;
  }
};

/** Sólo para pruebas / cambio de local: olvida el punto de venta cacheado. */
export const limpiarCachePuntoVenta = () => {
  for (const k of Object.keys(cachePuntoVenta)) delete cachePuntoVenta[k];
};

/**
 * Emite el remito de una venta NO facturada, en el local activo.
 *
 * Nunca lanza: un fallo acá no puede tumbar la venta, que ya está guardada.
 *
 * @returns {Promise<{estado: string, numeroComprobante?: string, motivo?: string}>}
 *   estado ∈ 'emitido' | 'ya-emitido' | 'omitido' | 'sin-local' | 'error'
 */
export const emitirRemitoDeVenta = async (venta, { canal = 'mostrador' } = {}) => {
  // Sin local válido NO se escribe: ni en la raíz, ni en el último local, ni en
  // "undefined". Se cancela y se avisa.
  const raiz = raizLocal();
  if (!raiz) {
    console.error('[REMITO] Cancelado: no hay localId válido. No se escribe el remito.');
    return { estado: 'sin-local', motivo: 'LOCAL_ID_REQUIRED' };
  }

  try {
    const puntoVenta = await obtenerPuntoVenta(raiz);
    const resultado = await emitirRemito({
      db: dbDelMismoLocal(raiz),
      raiz,
      venta,
      canal,
      puntoVenta,
      revalidarDb: () => dbDelMismoLocal(raiz),
    });
    if (resultado.estado === 'emitido') {
      console.log(`[REMITO] ${resultado.numeroComprobante} emitido para ${canal} ${venta?.id} en ${raiz}/${NODO_REMITOS}`);
    }
    return resultado;
  } catch (error) {
    console.error(`[REMITO] Error emitiendo el remito de ${canal} ${venta?.id}:`, error?.message || error);
    return { estado: 'error', motivo: error?.message || String(error) };
  }
};

/** Lectura puntual de /{localId}/Remitos. Devuelve filas listas para la tabla. */
export const fetchRemitos = async () => {
  const raiz = raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');

  const snap = await get(ref(getDatabase(), rutaRemitos(raiz)));
  if (!snap.exists()) return [];
  return filasDeRemitos(snap.val());
};

/**
 * Suscripción en vivo a /{localId}/Remitos.
 *
 * La suscripción queda ATADA al local con el que se creó: si el usuario cambia
 * de local, el callback deja de dispararse aunque el listener viejo todavía no
 * se haya desmontado, y nunca se mezclan remitos de dos locales.
 *
 * @returns {() => void} función para cancelar la suscripción.
 */
export const suscribirRemitos = (callback, onError = null) => {
  const raiz = raizLocal();
  if (!raiz) {
    console.warn('[REMITO] Sin local configurado: no se suscribe a Remitos.');
    if (onError) onError(new Error('LOCAL_ID_REQUIRED'));
    return () => {};
  }

  let db;
  try {
    db = getDatabase();
  } catch (e) {
    console.warn('[REMITO] Firebase todavía no está listo, no se suscribe:', e?.message || e);
    if (onError) onError(e);
    return () => {};
  }

  const nodo = ref(db, rutaRemitos(raiz));
  const listener = onValue(
    nodo,
    (snapshot) => {
      // El local pudo cambiar entre que se montó el listener y que llegó el
      // evento: en ese caso este dato es de OTRO local y se descarta.
      if (raizLocal() !== raiz) return;
      callback(filasDeRemitos(snapshot.val()));
    },
    (error) => {
      console.error('[REMITO] Error escuchando Remitos:', error?.message || error);
      if (onError) onError(error);
    }
  );

  return () => off(nodo, 'value', listener);
};

/**
 * Marca un remito como facturado a posteriori (por si un remito se convierte en
 * factura). NO borra el remito: deja la trazabilidad y evita que se cuente dos
 * veces, porque la pestaña sólo lista los que tienen facturado === false.
 */
export const marcarRemitoFacturado = async (numeroComprobante, numeroFactura) => {
  const raiz = raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  await update(ref(getDatabase(), rutaRemito(raiz, numeroComprobante)), {
    facturado: true,
    numeroFactura: numeroFactura || null,
    facturadoEn: new Date().toISOString(),
  });
};
