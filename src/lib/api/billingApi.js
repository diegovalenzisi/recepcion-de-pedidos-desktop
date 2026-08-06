import { getDatabase, ref, get, query, orderByKey, limitToLast, onValue } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { listarCuentasFiscales, normalizarComprobante } from '@/lib/api/comprobanteFiscal';

/** Ventana de comprobantes que se escucha en vivo (detectar altas, no traer todo). */
const VENTAS_EN_VIVO = 80;

// COMPROBANTES FISCALES DEL LOCAL — /{localId}/VENTAS
//
// Los registros vienen con los nombres de campo que dejó el runtime que los
// emitió (PRODUCTO / producto / producto_1…, CLIENTE / clientes, TOTAL / total,
// VtoCAE / CAE_VTO). La traducción a una única forma vive en
// comprobanteFiscal.js: acá sólo se lee Firebase.
//
// La configuración fiscal del local se lee JUNTO con las ventas porque es la
// que permite saber qué cuenta emitió cada comprobante y, con eso, su letra
// real. El prefijo de la clave (FCB…/FCC…) NO decide la letra.

export const fetchBillingData = async () => {
  const localId = getCurrentDatabasePath();
  if (!localId) {
    throw new Error('Local ID no está configurado.');
  }

  const db = getDatabase();

  try {
    const [snapshot, cfgSnap] = await Promise.all([
      get(ref(db, `${localId}/VENTAS`)),
      get(ref(db, `${localId}/CONFIGURACION/FACTURACION_AFIP`)),
    ]);

    if (!snapshot.exists()) return [];

    const config = cfgSnap.exists() ? cfgSnap.val() : null;
    // Se indexa una sola vez para todo el listado, no una por comprobante.
    const cuentas = listarCuentasFiscales(config);

    const salesData = snapshot.val();
    const comprobantes = Object.keys(salesData).map((key) =>
      normalizarComprobante(key, salesData[key], { config, cuentas })
    );

    const instante = (c) => {
      const [d, m, a] = String(c.fecha || '').split(/[-/]/);
      if (!a) return 0;
      const [hh = '0', mi = '0', ss = '0'] = String(c.hora || '').split(':');
      const t = new Date(Number(a), Number(m) - 1, Number(d), Number(hh), Number(mi), Number(ss)).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    return comprobantes.sort((a, b) => instante(b) - instante(a));
  } catch (error) {
    console.error('Error fetching billing data:', error);
    throw error;
  }
};

/**
 * Aviso EN VIVO de que /{localId}/VENTAS cambió.
 *
 * No devuelve los datos: sólo dispara el callback para que la pantalla vuelva a
 * leer con `fetchBillingData` (que además necesita la configuración fiscal para
 * resolver la letra de cada comprobante). Es lo que hace que una factura recién
 * emitida —por ejemplo, la de un remito convertido— aparezca sola en la pestaña
 * Facturación, sin refrescar a mano.
 *
 * Se escucha una VENTANA de los últimos comprobantes, no el nodo entero: alcanza
 * para detectar altas y evita traerse todo el historial en cada cambio.
 *
 * @param {Function} callback  se llama en cada cambio (y una vez al suscribirse)
 * @param {Function} [onError]
 * @returns {Function} cancelar la suscripción
 */
export const suscribirCambiosDeVentas = (callback, onError = null) => {
  const localId = getCurrentDatabasePath();
  if (!localId) return () => {};

  const consulta = query(ref(getDatabase(), `${localId}/VENTAS`), orderByKey(), limitToLast(VENTAS_EN_VIVO));
  const suscripcion = onValue(
    consulta,
    () => { try { callback(); } catch (e) { console.error('[billingApi] error avisando cambio de ventas:', e); } },
    (err) => {
      console.error('[billingApi] error escuchando VENTAS:', err);
      if (onError) onError(err);
    }
  );
  return () => suscripcion();
};
