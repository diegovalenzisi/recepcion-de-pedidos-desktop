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

import { getDatabase, ref, get, update, runTransaction, set, query, orderByKey, limitToLast } from 'firebase/database';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { rutaRemito } from '@/lib/api/remitos';
import { resolverCuentaDeAliasFavorito } from '@/lib/api/facturaORemito';
import { leerCuentasDelLocal } from '@/lib/api/facturaORemitoApi';
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

/** Cuántos registros fiscales recientes se miran al reconciliar. */
const VENTAS_A_REVISAR = 60;

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
 * Cola fiscal con la que se factura un remito: la de la cuenta asociada al
 * ALIAS DESTACADO del local (/{localId}/ALIAS).
 *
 *   /{localId}/ALIAS  →  la ÚNICA cuenta cuyo campo `alias` coincide
 *                     →  la cola fiscal de ESA cuenta (FACTURACION_1, 2 o 3)
 *
 * La cola NO sale del texto del alias ni de `isFavorite`: sale de la cuenta a la
 * que el alias pertenece. Es la misma resolución —y el mismo módulo puro— que
 * usa PedidosYa prepago, así que las dos rutas no pueden divergir.
 *
 * @returns {Promise<{cuenta: string, cola: string, alias: string, cuentaId: string}>}
 * @throws {RemitoNoFacturable} si el alias falta, está duplicado, no tiene
 *         cuenta asociada, o esa cuenta no resuelve FACTURACION_1/2/3.
 */
export const resolverCuentaFiscalFavorita = async () => {
  const raiz = raizLocal();
  const cuentas = await leerCuentasDelLocal();

  const aliasSnap = await get(ref(getDatabase(), construirRutaLocal(raiz, 'ALIAS')));
  const alias = aliasSnap.exists() ? aliasSnap.val() : null;

  console.log(`[FACTURACION] Buscando alias destacado: ${construirRutaLocal(raiz, 'ALIAS')}`);
  const r = resolverCuentaDeAliasFavorito({ alias, cuentas });

  if (r.estado !== 'ok') {
    // Mensaje ÚNICO y mostrable. No se manda nada por defecto ni se toca el remito.
    const mensaje =
      'No se puede facturar este remito porque el alias destacado no tiene una cuenta fiscal válida asociada.';
    console.error(`[FACTURACION] ${mensaje}`, { estado: r.estado, alias, detalle: r.motivo });
    throw new RemitoNoFacturable(`${mensaje} ${r.motivo}`);
  }

  console.log(`[FACTURACION] Alias destacado encontrado: ${r.alias}`);
  console.log(`[FACTURACION] Cuenta asociada: ${r.cuentaId} (${r.cuenta})`);
  console.log(`[FACTURACION] Cola resuelta: ${r.cola}`);

  return { cuenta: r.cuenta, cola: r.cola, alias: r.alias, cuentaId: r.cuentaId };
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
 * @returns {Promise<{estado:'encolado'|'ya-en-curso'|'ya-facturado', cola?:string, cuenta?:string, numeroFactura?:string}>}
 * @throws {RemitoNoFacturable} con un mensaje mostrable al usuario.
 */
export const facturarRemito = async (numeroComprobante) => {
  const raiz = raizLocal();
  if (!raiz) throw new RemitoNoFacturable('No hay un local configurado.');

  const remito = await leerRemito(numeroComprobante);
  const validacion = validarRemitoParaFacturar(remito, numeroComprobante);
  if (!validacion.ok) throw new RemitoNoFacturable(validacion.motivo);

  // La cola se resuelve antes del candado: si la configuración fiscal está
  // incompleta no se marca nada, el remito queda intacto y se avisa.
  const { cuenta, cola } = await resolverCuentaFiscalFavorita();

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
 * Cierra el círculo de un remito PENDIENTE: busca la factura que el motor dejó
 * en la ruta fiscal y, si la encuentra, marca el remito como facturado con su
 * número y su CAE.
 *
 * El motor copia el payload encolado dentro de la factura, así que el vínculo
 * es exacto (`remitoId`), no adivinado por importe ni por fecha. No se toca el
 * motor y no se mueve la factura de la ruta fiscal.
 *
 * @returns {Promise<{accion:'esperar'|'facturado'|'reabrir', numeroFactura?:string}>}
 */
export const conciliarRemito = async (numeroComprobante) => {
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

  // Sólo los registros fiscales recientes: la factura de un remito recién
  // encolado está entre los últimos. Evita leer VENTAS entero.
  const recientes = await get(
    query(ref(db, construirRutaLocal(raiz, 'VENTAS')), orderByKey(), limitToLast(VENTAS_A_REVISAR))
  );

  const resultado = conciliarConFacturaEmitida({
    remito, ventas: recientes.exists() ? recientes.val() : {}, sigueEnCola, errorDelMotor,
  });

  if (resultado.accion === 'esperar') return resultado;

  if (raizLocal() !== raiz) return { accion: 'esperar', motivo: 'cambio-de-local' };
  await update(ref(dbDelMismoLocal(raiz), rutaRemito(raiz, numeroComprobante)), resultado.marca);

  if (resultado.accion === 'facturado') {
    console.log(`[REMITO→FACTURA] ${numeroComprobante} quedó facturado como ${resultado.marca.numeroFactura}`);
    return { accion: 'facturado', numeroFactura: resultado.marca.numeroFactura };
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
 */
export const conciliarRemitosPendientes = async (remitos) => {
  const pendientes = (remitos || []).filter((r) => {
    const e = String(r?.estadoFacturacion || '').toUpperCase();
    return (e === ESTADO_PENDIENTE || e === ESTADO_ERROR) && r?.facturado !== true;
  });
  const resultados = [];
  for (const r of pendientes) {
    try {
      resultados.push({ numero: r.numeroFactura || r.id, ...(await conciliarRemito(r.numeroFactura || r.id)) });
    } catch (e) {
      console.error('[REMITO→FACTURA] error reconciliando', r?.id, e?.message || e);
    }
  }
  return resultados;
};
