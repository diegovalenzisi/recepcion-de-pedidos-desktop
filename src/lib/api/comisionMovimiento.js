// ---------------------------------------------------------------------------
// CONTABILIDAD DE COMISIONES — MOVIMIENTOS Y ACUMULADORES.
//
// Tres valores viven en Firebase y NUNCA se reconstruyen recorriendo el
// historial:
//
//     COMISIONES/TOTALES/totalAcumuladoCentavos   comisión histórica válida
//     COMISIONES/TOTALES/totalPagadoCentavos      todo lo pagado
//     COMISIONES/TOTALES/saldoPendienteCentavos   la deuda de ahora
//
// Se mueven SOLO por una venta, una anulación o un pago. Iniciar la aplicación
// no los toca: los lee y nada más.
//
// LA OPERACIÓN CONTABLE ES UNA SOLA ESCRITURA
// -------------------------------------------
// El movimiento y los tres incrementos viajan en el MISMO `update()`
// multipath. No existe un estado intermedio "movimiento escrito pero totales
// sin actualizar", porque no hay dos pasos: hay uno.
//
//     update(ref(db), {
//       'COMISIONES/MOVIMIENTOS/{opId}': { … },        // create-only por reglas
//       'COMISIONES/TOTALES/totalAcumuladoCentavos': increment(dHist),
//       'COMISIONES/TOTALES/saldoPendienteCentavos': increment(dSaldo),
//       'COMISIONES/TOTALES/totalPagadoCentavos':    increment(dPagado),
//     })
//
// El `opId` es DETERMINÍSTICO (V-M123, A-D456, P-{idPago}), así que un
// reintento vuelve a apuntar a la misma clave y las reglas lo rechazan: el
// `update()` entero se descarta, incluidos los incrementos. Reintentar es
// gratis y no puede contar dos veces.
//
// Módulo PURO: arma el PLAN (rutas + deltas numéricos). Los `increment()` y
// `serverTimestamp()` los inyecta la capa de Firebase, que es la única que
// conoce el SDK. Así todo esto se prueba sin navegador y sin red.
// ---------------------------------------------------------------------------

import { canalDeModoVenta, claveDeVenta } from './comisionVentaKey.js';

/** Tipos de movimiento contable. */
export const TIPO_MOVIMIENTO = Object.freeze({
  VENTA: 'VENTA',
  ANULACION: 'ANULACION',
  PAGO: 'PAGO',
});

/** Versión de migración a partir de la cual la contabilidad nueva está ACTIVA. */
export const VERSION_ACTIVA = 1;

// ---------------------------------------------------------------------------
// DINERO
// ---------------------------------------------------------------------------

/**
 * Pesos → centavos enteros.
 *
 * Todo lo contable se guarda en enteros para que `0.1 + 0.2` no vuelva a
 * producir un total como el que ya hay en producción
 * (`totalAcumulado: 197686.25000000012`).
 */
export const aCentavos = (pesos) => {
  const n = Number(pesos);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

/** Centavos → pesos, SOLO para mostrar. Nunca para acumular. */
export const aPesos = (centavos) => {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
};

/** ¿Es un importe contable válido? Entero y no negativo. */
export const esImporteValido = (centavos) =>
  Number.isInteger(centavos) && centavos >= 0;

// ---------------------------------------------------------------------------
// IDENTIDAD DE LA OPERACIÓN
// ---------------------------------------------------------------------------

/** `V-M123` / `V-D123` */
export const opIdVenta = (modoVenta, idVenta) =>
  `V-${claveDeVenta(modoVenta, idVenta)}`;

/** `A-M123` / `A-D123` */
export const opIdAnulacion = (modoVenta, idVenta) =>
  `A-${claveDeVenta(modoVenta, idVenta)}`;

/**
 * `P-{idPago}`. El idPago lo genera el cliente ANTES de escribir y lo conserva
 * mientras el intento siga pendiente: es lo que hace que un reintento apunte a
 * la misma operación en vez de crear un pago nuevo.
 */
export const opIdPago = (idPago) => `P-${String(idPago)}`;

/** ¿Este texto tiene forma de opId conocido? */
export const esOpIdValido = (opId) =>
  /^(V|A)-[MD]\d+$/.test(String(opId ?? '')) || /^P-.+$/.test(String(opId ?? ''));

// ---------------------------------------------------------------------------
// ESTADO DE LA CONTABILIDAD
// ---------------------------------------------------------------------------

/**
 * ¿La contabilidad nueva está activa?
 *
 * Mientras `migracionVersion < 1` TODO el sistema nuevo está DORMIDO: los
 * escritores se comportan igual que antes y no tocan los acumuladores. Es lo
 * que permite desplegar el código nuevo antes de migrar, sin ventana entre una
 * cosa y la otra.
 */
export const contabilidadActiva = (totales) =>
  Number(totales?.migracionVersion ?? 0) >= VERSION_ACTIVA;

/** Los tres acumuladores, saneados. Ausente = 0. */
export const leerAcumuladores = (totales) => ({
  totalAcumuladoCentavos: Number(totales?.totalAcumuladoCentavos ?? 0) || 0,
  totalPagadoCentavos: Number(totales?.totalPagadoCentavos ?? 0) || 0,
  saldoPendienteCentavos: Number(totales?.saldoPendienteCentavos ?? 0) || 0,
});

// ---------------------------------------------------------------------------
// DELTAS
// ---------------------------------------------------------------------------

/** Venta: sube el histórico y sube la deuda. */
export const deltasDeVenta = (centavos) => ({
  dHist: centavos, dSaldo: centavos, dPagado: 0,
});

/** Anulación: baja el histórico y baja la deuda, por la comisión ORIGINAL. */
export const deltasDeAnulacion = (centavos) => ({
  dHist: -centavos, dSaldo: -centavos, dPagado: 0,
});

/** Pago: sube lo pagado y baja la deuda. El histórico no se toca. */
export const deltasDePago = (centavos) => ({
  dHist: 0, dSaldo: -centavos, dPagado: centavos,
});

// ---------------------------------------------------------------------------
// VALIDACIONES
// ---------------------------------------------------------------------------

/**
 * ¿Se puede aplicar este pago? La deuda NUNCA puede quedar negativa.
 *
 * Esto es la cortesía para el operador: la garantía real la dan las reglas de
 * Firebase, que rechazan la escritura completa (no se crea el movimiento, no
 * sube `totalPagado`, no baja el saldo).
 */
export const validarPago = (montoCentavos, saldoCentavos) => {
  if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
    return { ok: false, motivo: 'El importe del pago tiene que ser mayor a cero.' };
  }
  if (montoCentavos > saldoCentavos) {
    return {
      ok: false,
      motivo: `El pago de $${aPesos(montoCentavos).toLocaleString('es-AR', { minimumFractionDigits: 2 })} `
        + `supera la deuda de $${aPesos(saldoCentavos).toLocaleString('es-AR', { minimumFractionDigits: 2 })}.`,
    };
  }
  return { ok: true, motivo: '' };
};

/** ¿Aplicar estos deltas dejaría algún acumulador negativo? */
export const dejariaNegativo = (acumuladores, deltas) => {
  const a = leerAcumuladores(acumuladores);
  return (a.totalAcumuladoCentavos + (deltas.dHist || 0)) < 0
    || (a.saldoPendienteCentavos + (deltas.dSaldo || 0)) < 0
    || (a.totalPagadoCentavos + (deltas.dPagado || 0)) < 0;
};

// ---------------------------------------------------------------------------
// EL PLAN DE ESCRITURA
// ---------------------------------------------------------------------------

/** Rutas del nodo de totales y de un movimiento. */
export const rutaTotales = (localId) => `${localId}/COMISIONES/TOTALES`;
export const rutaMovimiento = (localId, opId) => `${localId}/COMISIONES/MOVIMIENTOS/${opId}`;

/**
 * Plan de UNA operación contable: el movimiento y los tres incrementos que
 * tienen que entrar juntos.
 *
 * Devuelve rutas y deltas NUMÉRICOS. La capa de Firebase los convierte en
 * `increment()` y arma un único `update()`.
 */
export const planDeMovimiento = ({ localId, opId, tipo, referencia, deltas, meta = {} }) => {
  const T = rutaTotales(localId);
  return {
    opId,
    movimiento: {
      ruta: rutaMovimiento(localId, opId),
      valor: {
        tipo,
        ref: String(referencia ?? ''),
        dHist: deltas.dHist || 0,
        dSaldo: deltas.dSaldo || 0,
        dPagado: deltas.dPagado || 0,
        ...meta,
      },
    },
    incrementos: [
      { ruta: `${T}/totalAcumuladoCentavos`, delta: deltas.dHist || 0 },
      { ruta: `${T}/saldoPendienteCentavos`, delta: deltas.dSaldo || 0 },
      { ruta: `${T}/totalPagadoCentavos`, delta: deltas.dPagado || 0 },
    ],
    rutaMarcaDeTiempo: `${T}/actualizadoEn`,
  };
};

/** Plan de la comisión de una venta. */
export const planDeVenta = ({ localId, modoVenta, idVenta, comisionCentavos, meta }) =>
  planDeMovimiento({
    localId,
    opId: opIdVenta(modoVenta, idVenta),
    tipo: TIPO_MOVIMIENTO.VENTA,
    referencia: claveDeVenta(modoVenta, idVenta),
    deltas: deltasDeVenta(comisionCentavos),
    meta: { canal: canalDeModoVenta(modoVenta), ...meta },
  });

/** Plan de la anulación de una venta, por su comisión ORIGINAL. */
export const planDeAnulacion = ({ localId, modoVenta, idVenta, comisionCentavos, meta }) =>
  planDeMovimiento({
    localId,
    opId: opIdAnulacion(modoVenta, idVenta),
    tipo: TIPO_MOVIMIENTO.ANULACION,
    referencia: claveDeVenta(modoVenta, idVenta),
    deltas: deltasDeAnulacion(comisionCentavos),
    meta: { canal: canalDeModoVenta(modoVenta), ...meta },
  });

/** Plan de un pago de comisión. */
export const planDePago = ({ localId, idPago, montoCentavos, meta }) =>
  planDeMovimiento({
    localId,
    opId: opIdPago(idPago),
    tipo: TIPO_MOVIMIENTO.PAGO,
    referencia: String(idPago),
    deltas: deltasDePago(montoCentavos),
    meta,
  });

/**
 * ¿Esta operación tiene efecto contable?
 *
 * Una venta de un local con porcentaje 0 genera comisión 0: su identidad se
 * guarda igual (para que el día que se configure un porcentaje todo funcione),
 * pero no hay nada que mover, así que no se emite movimiento ni se tocan los
 * acumuladores.
 */
export const tieneEfectoContable = (deltas) =>
  (deltas.dHist || 0) !== 0 || (deltas.dSaldo || 0) !== 0 || (deltas.dPagado || 0) !== 0;
