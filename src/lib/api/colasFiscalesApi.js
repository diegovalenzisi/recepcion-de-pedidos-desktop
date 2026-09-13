// ---------------------------------------------------------------------------
// COLAS FISCALES — LECTURA DEL LOCAL ACTIVO
//
// Capa delgada sobre colasFiscales.js: resuelve el local, lee su configuración
// fiscal y el estado de sus colas. Acá no hay ninguna regla: todas viven en el
// módulo puro, que se prueba sin Firebase.
//
// Rutas que se leen (el local es SIEMPRE el primer segmento):
//   /{localId}/CONFIGURACION/FACTURACION_AFIP     cuentas fiscales por cola
//   /{localId}/FACTURACION_N                      pendientes de cada cola
//   /{localId}/FACTURACION_OWNERS/{cuit}_{ptoVta} ownership de cada cuenta
//
// Archivo IDÉNTICO en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { getDatabase, ref, get, query, orderByKey, limitToFirst } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { construirRutaLocal, normalizarLocalId } from '@/lib/api/rutasLocales';
import { normalizarNombreCuenta } from '@/lib/api/facturaORemito';
import {
  COLAS_FISCALES,
  COLA_LEGADA,
  claveOwnership,
  cuentaFiscalDeCola,
  cuentasFiscalesHabilitadasParaFacturar,
  detectarColasHuerfanas,
  radiografiaDeColas,
  switchesDeCuentasCobro,
  validarCuentaFiscal,
} from '@/lib/api/colasFiscales';

/** Raíz de datos del local activo. */
const raizLocal = () => normalizarLocalId(getCurrentDatabasePath());

/**
 * Configuración fiscal del local activo, tal cual está guardada.
 * Devuelve null si el local no tiene ninguna cargada.
 */
export const leerConfigFiscal = async (localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const snap = await get(ref(getDatabase(), construirRutaLocal(raiz, 'CONFIGURACION/FACTURACION_AFIP')));
  return snap.exists() ? snap.val() : null;
};

/**
 * Pendientes de cada cola, sin descargarlas enteras: se cuentan las claves y se
 * toma la más antigua para poder informar la antigüedad del atasco.
 *
 * Las colas se nombran `D{id}` / `M{id}`, así que la clave no trae fecha: la
 * antigüedad sale del campo `fecha` del primer pendiente.
 */
export const leerPendientesPorCola = async (localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const db = getDatabase();
  const salida = {};

  await Promise.all([...COLAS_FISCALES, COLA_LEGADA].map(async (cola) => {
    const nodo = ref(db, construirRutaLocal(raiz, cola));
    const snap = await get(nodo);
    if (!snap.exists()) return;
    const data = snap.val() || {};
    const claves = Object.keys(data);
    if (claves.length === 0) return;

    // Fechas del pendiente más viejo y del más nuevo, en el formato dd-MM-yyyy
    // que escribe la cola. La del más NUEVO es la que permite distinguir un
    // atasco histórico de una cola que todavía está recibiendo ventas.
    let masViejoMs = null;
    let masNuevoMs = null;
    for (const k of claves) {
      const f = String(data[k]?.fecha ?? '');
      const m = f.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!m) continue;
      const t = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
      if (!Number.isFinite(t)) continue;
      if (masViejoMs === null || t < masViejoMs) masViejoMs = t;
      if (masNuevoMs === null || t > masNuevoMs) masNuevoMs = t;
    }
    salida[cola] = { n: claves.length, masViejoMs, masNuevoMs, ejemplos: claves.slice(0, 5) };
  }));

  return salida;
};

/**
 * Ownership de cada cuenta fiscal del local. Se lee del MISMO RTDB de la app:
 * es donde vive `/{localId}/FACTURACION_OWNERS`.
 *
 * Nunca asume ownership: si no se puede leer, devuelve null para esa cuenta
 * (desconocido), que es distinto de "no tiene dueño".
 */
export const leerOwnershipPorCuenta = async (config, localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const snap = await get(ref(getDatabase(), construirRutaLocal(raiz, 'FACTURACION_OWNERS')));
  const owners = snap.exists() ? snap.val() || {} : {};
  const salida = {};
  for (const c of radiografiaDeColas({ config, localId: raiz }).colas) {
    if (!c.cuenta?.cuit || !c.cuenta?.puntoVenta) continue;
    const k = claveOwnership(c.cuenta.cuit, c.cuenta.puntoVenta);
    salida[c.cola] = owners[k] || null;
  }
  return salida;
};

/**
 * ESTADO COMPLETO DE LAS NUEVE COLAS del local activo. Es la única fuente para
 * la pantalla de facturación y para la auditoría, así que las dos informan
 * exactamente lo mismo.
 */
/** Interruptores `imprimeFactura` de las cuentas de COBRO del local. */
export const leerSwitchesCuentaCobro = async (localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const snap = await get(ref(getDatabase(), construirRutaLocal(raiz, 'CUENTAS')));
  return switchesDeCuentasCobro(snap.exists() ? snap.val() : {});
};

export const radiografiaDelLocal = async (localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const [config, pendientesPorCola, switchesCuentaCobro] = await Promise.all([
    leerConfigFiscal(raiz),
    leerPendientesPorCola(raiz),
    leerSwitchesCuentaCobro(raiz),
  ]);
  // Los switches de cobro entran en la radiografía: una cola cuya cuenta NO
  // factura no se reporta como error ni como huérfana.
  const radiografia = radiografiaDeColas({ config, localId: raiz, pendientesPorCola, switchesCuentaCobro });
  return { ...radiografia, config, pendientesPorCola, switchesCuentaCobro };
};

/** Colas con ventas esperando que nadie va a facturar. Sólo informa. */
export const colasHuerfanasDelLocal = async (localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  const [config, pendientesPorCola, switchesCuentaCobro] = await Promise.all([
    leerConfigFiscal(raiz),
    leerPendientesPorCola(raiz),
    leerSwitchesCuentaCobro(raiz),
  ]);
  return detectarColasHuerfanas({ config, pendientesPorCola, switchesCuentaCobro });
};

/**
 * CUENTAS FISCALES DEL LOCAL ACTIVO REALMENTE HABILITADAS PARA FACTURAR POR
 * ARCA (completas y listas). No depende de ningún alias ni cuenta favorita: es
 * la fuente que usa, por ejemplo, el selector manual de "Facturar remito".
 */
export const cuentasFiscalesHabilitadasDelLocal = async (localId = null) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const config = await leerConfigFiscal(raiz);
  return cuentasFiscalesHabilitadasParaFacturar(config, { localId: raiz });
};

/**
 * VALIDACIÓN OBLIGATORIA ANTES DE FACTURAR.
 *
 * Se llama con la cola que ya eligió la regla de negocio. Si la cuenta fiscal de
 * esa cola no está en condiciones, la venta NO se encola y NO se cae a un FCX:
 * el caller corta con el motivo exacto.
 *
 * @returns {Promise<{listo: boolean, estado: string, faltantes: string[], avisos: string[], mensaje: string|null, cuenta: object|null}>}
 */
export const validarColaAntesDeFacturar = async (cola, { localId = null, config = null } = {}) => {
  const raiz = localId ? normalizarLocalId(localId) : raizLocal();
  if (!raiz) throw new Error('LOCAL_ID_REQUIRED: no hay local configurado.');
  const cfg = config || await leerConfigFiscal(raiz);
  const cuenta = cuentaFiscalDeCola(cfg, cola);

  // EL SWITCH DE LA CUENTA DE COBRO TIENE QUE LLEGAR HASTA ACÁ.
  //
  // `validarCuentaFiscal` ya sabe qué hacer con una cola cuya cuenta de cobro
  // NO factura: devuelve `noFactura:true` / `esError:false` y no pide CUIT,
  // certificado ni runtime. Pero nunca se le pasaba el dato, así que ese camino
  // no se ejecutaba nunca: la cola caía en "no configurada" y la venta se
  // detenía con un error fiscal (`mensaje: null`) por una cuenta que
  // deliberadamente no factura.
  const nombreCobro = cuenta?.cuentaCobro ?? null;
  let imprimeFactura = null;
  if (nombreCobro) {
    const switches = await leerSwitchesCuentaCobro(raiz);
    const clave = normalizarNombreCuenta(nombreCobro);
    // `undefined` = esa cuenta de cobro ya no existe en el local → se deja en
    // null y decide el resto de la validación, como antes.
    if (Object.prototype.hasOwnProperty.call(switches, clave)) imprimeFactura = switches[clave];
  }

  const validacion = validarCuentaFiscal(cuenta, { localId: raiz, imprimeFactura });
  return { ...validacion, cuenta };
};
