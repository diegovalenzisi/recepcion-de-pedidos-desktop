// ---------------------------------------------------------------------------
// FACTURAR UN REMITO (FCX) A POSTERIORI — ACCESO DESDE LA APP
//
// Ruta única y canónica del remito:  /{localId}/Remitos/{FCX0008-00000048}
// La factura sigue yendo a la ruta fiscal de siempre: la escribe el motor AFIP
// en /{localId}/VENTAS/{FCB…|FCC…}. Este módulo NO la mueve ni la copia.
//
// El candado es el propio campo `estadoFacturacion` del remito, tomado con una
// transacción de Realtime Database: dos clics seguidos, dos PCs o una PC y una
// tablet a la vez producen UNA sola solicitud. La clave de idempotencia es
// localId + número de FCX.
//
// NO emite Nota de Crédito. NO toca stock, caja, turnos, comisiones ni
// estadísticas. NO crea otra venta ni otro remito.
//
// Archivo IDÉNTICO en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { getDatabase, ref, get, update, runTransaction, set, query, orderByKey, startAt, endAt } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { rutaRemito } from '@/lib/api/remitos';
import { cuentasFiscalesHabilitadasDelLocal, leerConfigFiscal } from '@/lib/api/colasFiscalesApi';
import { cuentaFiscalDeCola } from '@/lib/api/colasFiscales';
import { rangoDeClavesDeCuenta } from '@/lib/api/comprobanteFiscal';
import {
  ESTADO_PENDIENTE,
  ESTADO_ERROR,
  claveEnCola,
  conciliarConFacturaEmitida,
  construirPayloadFacturacion,
  marcaDeError,
  marcaDePendiente,
  validarRemitoParaFacturar,
} from '@/lib/api/facturacionDeRemito';
import { construirRutaLocal, normalizarLocalId, verificarMismoLocal } from '@/lib/api/rutasLocales';

const DEVICE_ID_KEY = 'factDeviceId';

/** Identidad estable de este equipo, sin datos personales. Igual que el arbitraje de facturación. */
export const idDeEsteDispositivo = () => {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'desconocido';
  }
};

/** Error de negocio: se le muestra tal cual al usuario. */
export class RemitoNoFacturable extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'RemitoNoFacturable';
  }
}

const raizLocal = () => normalizarLocalId(getCurrentDatabasePath());

const dbDelMismoLocal = (raiz) => {
  verificarMismoLocal(raiz, raizLocal());
  return getDatabase();
};

/**
 * CUENTAS FISCALES del local activo en condiciones de facturar un remito a
 * posteriori: completas y listas para emitir por ARCA, la MISMA fuente de
 * verdad que usa el motor de facturación para cualquier cola.
 *
 * NUNCA el alias destacado, NUNCA la cuenta favorita ni ninguna cuenta de
 * cobro: eso decide a dónde entra la plata, no con qué CUIT se puede emitir.
 *
 * @returns {Promise<Array<object>>} cuentas listas, cada una con su `cola`.
 */
export const cuentasFiscalesParaFacturarRemito = async () => {
  const raiz = raizLocal();
  if (!raiz) throw new RemitoNoFacturable('No hay un local configurado.');
  return cuentasFiscalesHabilitadasDelLocal(raiz);
};

/**
 * Resuelve con QUÉ CUENTA FISCAL se factura un remito:
 *
 *   0 cuentas habilitadas → se detiene: no hay con qué emitir.
 *   1 cuenta habilitada   → esa, sin preguntar nada.
 *   2+ habilitadas        → hace falta que el caller (la pantalla) ya haya
 *                            elegido una cola en un selector; si no llegó
 *                            ninguna, o la elegida ya no está disponible, se
 *                            detiene con el mismo mensaje que ve el operador.
 *
 * @param {string|null} colaElegida  `FACTURACION_N` que el usuario eligió.
 * @returns {Promise<{cuenta: string, cola: string, cuentaFiscal: object}>}
 * @throws {RemitoNoFacturable} con el mensaje exacto para mostrar.
 */
export const resolverCuentaFiscalParaRemito = async (colaElegida = null) => {
  const cuentas = await cuentasFiscalesParaFacturarRemito();

  if (cuentas.length === 0) {
    throw new RemitoNoFacturable('Este local no tiene ninguna cuenta habilitada para emitir facturas.');
  }
  if (cuentas.length === 1) {
    const unica = cuentas[0];
    return { cuenta: unica.razonSocial || unica.nombre || unica.cola, cola: unica.cola, cuentaFiscal: unica };
  }

  const elegida = colaElegida ? cuentas.find((c) => c.cola === colaElegida) : null;
  if (!elegida) {
    throw new RemitoNoFacturable(
      `Este local tiene ${cuentas.length} cuentas fiscales habilitadas: elegí con cuál facturar.`
    );
  }
  return { cuenta: elegida.razonSocial || elegida.nombre || elegida.cola, cola: elegida.cola, cuentaFiscal: elegida };
};

/** Lee un remito de la ruta canónica del local activo. */
export const leerRemito = async (numeroComprobante) => {
  const raiz = raizLocal();
  if (!raiz) throw new RemitoNoFacturable('No hay un local configurado.');
  const snap = await get(ref(getDatabase(), rutaRemito(raiz, numeroComprobante)));
  return snap.exists() ? snap.val() : null;
};

/**
 * Pide la factura de un remito ya emitido.
 *
 * Orden, deliberado:
 *   1. valida el remito y resuelve la cola ANTES de tocar nada;
 *   2. toma el candado por transacción sobre `estadoFacturacion`;
 *   3. escribe los campos técnicos del pedido;
 *   4. encola en la cola fiscal, con clave derivada del número de remito;
 *   5. si algo del encolado falla, deja el remito en ERROR para reintentar.
 *
 * @param {string|null} colaElegida  `FACTURACION_N` elegida en el selector,
 *        cuando el local tiene 2 o más cuentas fiscales habilitadas. Con 0 o 1
 *        cuenta habilitada se ignora: no hay nada que elegir.
 * @returns {Promise<{estado:'encolado'|'ya-en-curso'|'ya-facturado', cola?:string, cuenta?:string, numeroFactura?:string}>}
 * @throws {RemitoNoFacturable} con un mensaje mostrable al usuario.
 */
export const facturarRemito = async (numeroComprobante, colaElegida = null) => {
  const raiz = raizLocal();
  if (!raiz) throw new RemitoNoFacturable('No hay un local configurado.');

  const remito = await leerRemito(numeroComprobante);
  const validacion = validarRemitoParaFacturar(remito, numeroComprobante);
  if (!validacion.ok) throw new RemitoNoFacturable(validacion.motivo);

  // La cuenta se resuelve antes del candado: si no hay ninguna habilitada, o
  // hace falta elegir entre varias y todavía no se eligió, no se marca nada y
  // el remito queda intacto.
  const { cuenta, cola } = await resolverCuentaFiscalParaRemito(colaElegida);

  // ── CANDADO ──────────────────────────────────────────────────────────────
  // Transacción sobre el propio estado del remito. Si otro equipo llegó
  // primero, la transacción no commitea y acá se sale sin encolar nada.
  const rutaEstado = `${rutaRemito(raiz, numeroComprobante)}/estadoFacturacion`;
  const candado = await runTransaction(ref(dbDelMismoLocal(raiz), rutaEstado), (actual) => {
    if (actual === ESTADO_PENDIENTE || actual === 'FACTURADO') return undefined; // aborta
    return ESTADO_PENDIENTE;
  });
  if (!candado.committed) {
    const actual = candado.snapshot.val();
    return actual === 'FACTURADO'
      ? { estado: 'ya-facturado', numeroFactura: remito.numeroFactura }
      : { estado: 'ya-en-curso' };
  }

  try {
    const deviceId = idDeEsteDispositivo();
    await update(
      ref(dbDelMismoLocal(raiz), rutaRemito(raiz, numeroComprobante)),
      marcaDePendiente({ cola, deviceId })
    );

    const payload = construirPayloadFacturacion({ remito, localId: raiz, cola, solicitadoPor: deviceId });
    // Clave derivada del número de remito: encolar dos veces PISA, no duplica.
    await set(ref(dbDelMismoLocal(raiz), construirRutaLocal(raiz, `${cola}/${claveEnCola(numeroComprobante)}`)), payload);

    console.log(`[REMITO→FACTURA] ${numeroComprobante} encolado en ${raiz}/${cola} por el total ${payload.total} (cuenta "${cuenta}")`);
    return { estado: 'encolado', cola, cuenta };
  } catch (e) {
    // No se pudo encolar: se libera para poder reintentar. No se emitió nada.
    try {
      await update(ref(getDatabase(), rutaRemito(raiz, numeroComprobante)), marcaDeError(e?.message || e));
    } catch { /* si tampoco se puede marcar, queda PENDIENTE y se revisa a mano */ }
    throw new RemitoNoFacturable(`No se pudo encolar la factura del remito ${numeroComprobante}: ${e?.message || e}`);
  }
};

/**
 * Registros fiscales donde PUEDE estar la factura de este remito: el rango de
 * claves EXACTO de la cuenta fiscal que lo encoló (`FC{letra}{puntoVenta}-…`).
 *
 * Reemplaza la vieja heurística de "las últimas N claves de VENTAS por orden
 * alfabético", que fallaba en dos formas reales:
 *   - un local con varias cuentas de MUCHO volumen corre el orden alfabético
 *     más rápido de lo que tarda en reconciliar, y la factura queda afuera de
 *     la ventana PARA SIEMPRE (no hay forma de que "la ventana de las últimas
 *     N" vuelva a incluir una clave vieja);
 *   - claves heredadas de otro formato (p. ej. remitos FCX guardados alguna
 *     vez dentro de VENTAS) ordenan después de cualquier factura real y
 *     pueden llenar la ventana entera, dejándola sin ninguna factura de
 *     verdad sin importar cuánto tiempo pase.
 *
 * El rango por CLAVE (orderByKey + startAt/endAt) no depende de cuántas
 * ventas tenga el local, de cuántas cuentas compartan punto de venta ni del
 * CUIT: sólo del prefijo que la PROPIA cuenta usa para escribir sus
 * comprobantes. Tampoco requiere ningún `.indexOn` en las reglas de Firebase
 * (a diferencia de una consulta por campo como `orderByChild('remitoId')`),
 * así que funciona igual en cualquiera de las bases sin tocar reglas.
 *
 * @returns {Promise<object>} el rango de VENTAS (puede ser `{}` si no se pudo
 *   resolver la cuenta fiscal de la cola — la reconciliación queda entonces
 *   en "esperar", el comportamiento seguro de siempre).
 */
const leerVentasDeLaCuenta = async (db, raiz, cola, configPrevio) => {
  if (!cola) return {};
  const config = configPrevio || await leerConfigFiscal(raiz).catch(() => null);
  const cuenta = cuentaFiscalDeCola(config, cola);
  const rango = cuenta ? rangoDeClavesDeCuenta(cuenta) : null;
  if (!rango) return {};

  const snap = await get(
    query(ref(db, construirRutaLocal(raiz, 'VENTAS')), orderByKey(), startAt(rango.desde), endAt(rango.hasta))
  );
  return snap.exists() ? snap.val() : {};
};

/**
 * Cierra el círculo de un remito PENDIENTE: busca la factura que el motor dejó
 * en la ruta fiscal y, si la encuentra, marca el remito como facturado con su
 * número y su CAE.
 *
 * El motor copia el payload encolado dentro de la factura, así que el vínculo
 * es exacto (`remitoId`), no adivinado por importe ni por fecha. No se toca el
 * motor y no se mueve la factura de la ruta fiscal.
 *
 * @param {object} [opciones]
 * @param {object} [opciones.config]  configuración fiscal ya leída (para no
 *        releerla en cada remito cuando `conciliarRemitosPendientes` procesa
 *        varios de una vez).
 * @returns {Promise<{accion:'esperar'|'facturado'|'reabrir'|'alerta', numeroFactura?:string}>}
 */
export const conciliarRemito = async (numeroComprobante, { config = null } = {}) => {
  const raiz = raizLocal();
  if (!raiz) return { accion: 'esperar', motivo: 'sin-local' };

  const remito = await leerRemito(numeroComprobante);
  if (!remito) return { accion: 'esperar', motivo: 'no-existe' };

  const db = getDatabase();
  const cola = remito.colaFacturacion;

  // El pedido encolado trae, si hubo un rechazo, el mensaje EXACTO que dejó el
  // motor (`errorFacturacion`). Es lo único que puede marcar ERROR: una demora
  // —el pedido ya no está pero la factura todavía no apareció— NO es un error.
  const pedidoSnap = cola
    ? await get(ref(db, construirRutaLocal(raiz, `${cola}/${claveEnCola(numeroComprobante)}`)))
    : null;
  const sigueEnCola = !!(pedidoSnap && pedidoSnap.exists());
  const errorDelMotor = sigueEnCola ? (pedidoSnap.val()?.errorFacturacion || null) : null;

  const ventas = await leerVentasDeLaCuenta(db, raiz, cola, config);

  const resultado = conciliarConFacturaEmitida({ remito, ventas, sigueEnCola, errorDelMotor });

  if (resultado.accion === 'esperar') return resultado;

  if (raizLocal() !== raiz) return { accion: 'esperar', motivo: 'cambio-de-local' };
  await update(ref(dbDelMismoLocal(raiz), rutaRemito(raiz, numeroComprobante)), resultado.marca);

  if (resultado.accion === 'facturado') {
    console.log(`[REMITO→FACTURA] ${numeroComprobante} quedó facturado como ${resultado.marca.numeroFactura}`);
    return { accion: 'facturado', numeroFactura: resultado.marca.numeroFactura };
  }
  if (resultado.accion === 'alerta') {
    console.error(
      `[REMITO→FACTURA] ¡ALERTA! ${numeroComprobante} tiene ${resultado.marca.conciliacionAlertaClaves.length} ` +
      `facturas distintas con el mismo remitoId (${resultado.marca.conciliacionAlertaClaves.join(', ')}). ` +
      'NO se eligió ninguna: revisar a mano, puede haber una factura duplicada.'
    );
    return { accion: 'alerta', claves: resultado.marca.conciliacionAlertaClaves };
  }
  console.warn(`[REMITO→FACTURA] ${numeroComprobante} se liberó para reintentar: ${resultado.marca.errorFacturacion}`);
  return { accion: 'reabrir' };
};

/**
 * Reconcilia los remitos que todavía no están facturados.
 *
 * Incluye los que quedaron en ERROR: pueden tener su factura emitida y el error
 * ser de un intento anterior. Si aparece la factura, el remito se corrige solo a
 * FACTURADO y se le borra el error — que es lo que repara los que quedaron mal
 * marcados por la versión anterior.
 *
 * Lee la configuración fiscal UNA sola vez para todo el lote (no una vez por
 * remito): varios remitos pendientes suelen compartir local, y a veces cola.
 */
export const conciliarRemitosPendientes = async (remitos) => {
  const pendientes = (remitos || []).filter((r) => {
    const e = String(r?.estadoFacturacion || '').toUpperCase();
    return (e === ESTADO_PENDIENTE || e === ESTADO_ERROR) && r?.facturado !== true;
  });
  if (pendientes.length === 0) return [];

  const raiz = raizLocal();
  const config = raiz ? await leerConfigFiscal(raiz).catch(() => null) : null;

  const resultados = [];
  for (const r of pendientes) {
    try {
      resultados.push({ numero: r.numeroFactura || r.id, ...(await conciliarRemito(r.numeroFactura || r.id, { config })) });
    } catch (e) {
      console.error('[REMITO→FACTURA] error reconciliando', r?.id, e?.message || e);
    }
  }
  return resultados;
};
