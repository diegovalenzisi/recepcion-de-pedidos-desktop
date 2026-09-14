import { getDatabase, ref, get, query, orderByKey, startAt, endAt, onChildAdded, onChildChanged, onChildRemoved } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { listarCuentasFiscales, normalizarComprobante } from '@/lib/api/comprobanteFiscal';

/**
 * Cuánto esperar tras el último evento antes de avisar. Una alta inicial (al
 * suscribirse) o varias facturas casi simultáneas disparan varios eventos
 * seguidos: se junta todo en UN solo aviso en vez de recargar la pantalla N
 * veces. No es polling — sin eventos no corre nada, el timer se cancela solo.
 */
const DEBOUNCE_MS = 300;

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
 * emitida —por ejemplo, la de un remito convertido, o una de facturación
 * automática— aparezca sola en la pestaña Facturación, sin salir y volver a
 * entrar al módulo.
 *
 * RANGO POR LETRA (FCA…FCC), no por cantidad ni por "últimas N claves": un
 * comprobante fiscal cae ahí sin importar su punto de venta, su CUIT o cuántas
 * cuentas fiscales tenga el local. Antes esto usaba `orderByKey() +
 * limitToLast(80)` — una ventana por ORDEN ALFABÉTICO de clave que fallaba en
 * dos formas reales:
 *   - un local con varias cuentas de mucho volumen corre esa ventana más
 *     rápido de lo que tarda en reaccionar, y la cuenta con menos movimiento
 *     queda afuera de las últimas 80 indefinidamente;
 *   - claves heredadas de otro formato (los 99 FCX legado de Temperley,
 *     guardados alguna vez dentro de VENTAS) ordenan después de cualquier
 *     factura real y pueden llenar la ventana entera — el listener quedaba
 *     suscripto a un rango que nunca iba a contener una factura nueva.
 * Es el mismo defecto (y la misma solución: rango por CLAVE, no heurística de
 * ventana) que ya se corrigió en la reconciliación de remitos — ver
 * `rangoDeClavesDeCuenta` en comprobanteFiscal.js.
 *
 * `onChildAdded/Changed/Removed` en vez de `onValue`: cada evento trae sólo el
 * comprobante que cambió, no el nodo entero (las facturas pueden traer
 * `PDF_BASE64`; un local grande puede tener miles). Los eventos se juntan con
 * un debounce corto para no recargar la pantalla una vez por cada uno.
 *
 * @param {Function} callback  se llama (agrupado) ante cualquier alta, cambio o baja
 * @param {Function} [onError]
 * @returns {Function} cancelar la suscripción
 */
export const suscribirCambiosDeVentas = (callback, onError = null) => {
  const localId = getCurrentDatabasePath();
  if (!localId) return () => {};

  const consulta = query(
    ref(getDatabase(), `${localId}/VENTAS`),
    orderByKey(),
    startAt('FCA'),
    endAt(`FCC${String.fromCharCode(0xf8ff)}`)
  );

  let temporizador = null;
  const avisar = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = null;
      try { callback(); } catch (e) { console.error('[billingApi] error avisando cambio de ventas:', e); }
    }, DEBOUNCE_MS);
  };
  const manejarError = (err) => {
    console.error('[billingApi] error escuchando VENTAS:', err);
    if (onError) onError(err);
  };

  const cancelarAlta = onChildAdded(consulta, avisar, manejarError);
  const cancelarCambio = onChildChanged(consulta, avisar, manejarError);
  const cancelarBaja = onChildRemoved(consulta, avisar, manejarError);

  return () => {
    if (temporizador) clearTimeout(temporizador);
    cancelarAlta();
    cancelarCambio();
    cancelarBaja();
  };
};
