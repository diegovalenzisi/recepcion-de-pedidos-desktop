import { getDatabase, ref, get, set, push, runTransaction, update, increment, serverTimestamp } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { claveDeVenta, claveLegada, identidadDeVenta, registroEsDelCanal } from '@/lib/api/comisionVentaKey';
import {
  aCentavos, contabilidadActiva, rutaTotales,
  planDeVenta, planDeAnulacion, planCompletoDePago,
  tieneEfectoContable, deltasDeVenta, deltasDeAnulacion,
} from '@/lib/api/comisionMovimiento';

// ---------------------------------------------------------------------------
// PUENTE ENTRE EL PLAN PURO Y FIREBASE.
//
// `comisionMovimiento.js` decide QUÉ mover (rutas + deltas). Acá se convierte
// en UNA sola escritura multipath con los `increment()` del servidor.
//
// Mientras `migracionVersion < 1` nada de esto corre: los tres acumuladores no
// existen todavía y cada función se comporta EXACTAMENTE como antes.
// ---------------------------------------------------------------------------

/** Lee el nodo de totales una sola vez. Devuelve null si no existe. */
const leerTotales = async (db, localId) => (await get(ref(db, rutaTotales(localId)))).val();

/**
 * Error de una operación contable que Firebase rechazó por algo que NO es un
 * duplicado: un pago mayor a la deuda, un acumulador que quedaría inválido,
 * reglas mal desplegadas, un movimiento mal formado, un cliente incompatible.
 * Tiene que verse, no confundirse con un reintento.
 */
export class ComisionRechazadaError extends Error {
  constructor(opId, causa) {
    super(`La operación de comisión ${opId} fue rechazada por la base. `
      + 'No se aplicó ningún movimiento ni se modificó ningún total.');
    this.name = 'ComisionRechazadaError';
    this.opId = opId;
    this.motivo = 'operacion_rechazada';
    this.causa = causa;
  }
}

/**
 * Aplica un plan contable: el movimiento y los tres incrementos en el MISMO
 * `update()`. O entra todo, o no entra nada.
 *
 * QUÉ SIGNIFICA UN PERMISSION_DENIED
 * ----------------------------------
 * No alcanza con suponer "ya estaba aplicado". Las reglas rechazan por varias
 * razones distintas y confundirlas escondería un error contable real:
 *
 *   · el `opId` ya existe            → duplicado legítimo, resultado normal
 *   · el pago supera la deuda        → la validación de acumulador ≥ 0
 *   · un acumulador quedaría inválido
 *   · las reglas no son las esperadas
 *   · el movimiento está mal formado
 *
 * Por eso, ante un rechazo se CONSULTA el movimiento:
 *   - si existe  → fue un duplicado: `aplicado: false, motivo: 'ya_aplicado'`
 *   - si no existe → fue rechazado por otra causa: se LANZA
 *     `ComisionRechazadaError`, con el detalle técnico en el log.
 *
 * En los dos casos no se movió nada; la diferencia es que uno es esperable y
 * el otro tiene que llegar a la superficie.
 */
const aplicarPlan = async (db, plan, extras = null) => {
  const payload = {
    [plan.movimiento.ruta]: { ...plan.movimiento.valor, ts: serverTimestamp() },
    [plan.rutaMarcaDeTiempo]: serverTimestamp(),
    ...(extras || {}),
  };
  for (const inc of plan.incrementos) payload[inc.ruta] = increment(inc.delta);

  try {
    await update(ref(db), payload);
    console.log(`[COMISION] movimiento ${plan.opId} aplicado`);
    return { aplicado: true, motivo: 'aplicado' };
  } catch (e) {
    const denegado = String(e?.message || '').includes('PERMISSION_DENIED');
    if (!denegado) throw e;

    // ¿Existe el movimiento? Esa es la diferencia entre "duplicado" y "error".
    let existe = false;
    try {
      existe = (await get(ref(db, plan.movimiento.ruta))).exists();
    } catch (errLectura) {
      // Sin poder comprobarlo NO se asume nada: se trata como rechazo.
      console.error(`[COMISION] ${plan.opId}: no se pudo verificar el movimiento:`, errLectura?.message || errLectura);
      throw new ComisionRechazadaError(plan.opId, e);
    }

    if (existe) {
      console.log(`[COMISION] movimiento ${plan.opId} ya estaba aplicado (duplicado)`);
      return { aplicado: false, motivo: 'ya_aplicado' };
    }

    console.error(`[COMISION] ${plan.opId} RECHAZADO y el movimiento NO existe. `
      + 'Causa probable: pago mayor a la deuda, acumulador inválido o reglas incorrectas.', e);
    throw new ComisionRechazadaError(plan.opId, e);
  }
};

const ahora = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`,
    hora: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
};

/**
 * Aplica el plan COMPLETO de un pago: movimiento, acumuladores, comprobante y
 * los registros que el pago alcanza — todo en la misma escritura atómica.
 *
 * No existe el estado "deuda descontada pero detalle incompleto": es una sola
 * operación. Verificado contra el emulador con 250 registros (1.256 rutas).
 */
const aplicarPlanCompleto = (db, plan) => aplicarPlan(db, plan, {
  [plan.comprobante.ruta]: plan.comprobante.valor,
  ...plan.detalle,
});

/**
 * Registra la comisión generada por una venta concretada.
 *
 * La clave es CANÓNICA (`M{id}` / `D{id}`): mostrador y delivery numeran con
 * contadores separados y, cuando esos contadores se cruzan, la clave numérica
 * pelada hace que la segunda venta se confunda con un duplicado y pierda su
 * comisión en silencio. Ver comisionVentaKey.js.
 *
 * Deduplicación en dos pasos, para no contar dos veces una venta que ya tenía
 * su registro con el esquema viejo:
 *   1. clave canónica `M{id}`/`D{id}`
 *   2. clave legada `{id}`, PERO solo si su canal coincide — si el registro
 *      legado es del otro canal, es justamente la colisión y hay que crear el
 *      registro nuevo.
 */
export const registrarComision = async ({
  idVenta,
  ventaTotal,
  modoVenta,
  origen,
  porcentajeComision,
  comisionGenerada,
  comisionGeneradaCentavos,
}) => {
  checkLocalId();
  const localId = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  const identidad = identidadDeVenta(modoVenta, idVenta);
  const ventaKey = identidad.ventaKey;
  const registroRef = ref(db, `${localId}/COMISIONES/REGISTRO/${ventaKey}`);

  // 1) ¿ya existe con la clave canónica?
  const existingSnap = await get(registroRef);
  if (existingSnap.exists()) {
    console.log(`[COMISION] ventaKey=${ventaKey} yaExiste=true genera=false`);
    return;
  }

  // 2) ¿existe con la clave legada Y del mismo canal? (venta anterior al cambio)
  const legadoSnap = await get(ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/REGISTRO/${claveLegada(idVenta)}`));
  if (legadoSnap.exists() && registroEsDelCanal(legadoSnap.val(), modoVenta)) {
    console.log(`[COMISION] ventaKey=${ventaKey} yaExiste=true (clave legada ${claveLegada(idVenta)}) genera=false`);
    return;
  }

  console.log(`[COMISION] ventaKey=${ventaKey} yaExiste=false genera=true comision=${comisionGenerada}`);

  // La comision viene YA determinada por quien concreto la venta. Solo se
  // deriva si un llamador viejo no la manda: no se recalcula con el porcentaje.
  const comisionCentavos = Number.isInteger(comisionGeneradaCentavos)
    ? comisionGeneradaCentavos
    : aCentavos(comisionGenerada);
  const opIdDeVenta = `V-${ventaKey}`;
  const totales = await leerTotales(op.getDatabaseOrAbort(), localId);
  const activa = contabilidadActiva(totales);

  // Incrementar total acumulado histórico en forma atómica
  const totalRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/TOTALES/totalAcumulado`);
  const { committed, snapshot: totalSnap } = await runTransaction(totalRef, (current) => {
    return (current || 0) + comisionGenerada;
  });

  if (!committed) throw new Error('No se pudo actualizar totalAcumulado de comisiones.');

  const { fecha, hora } = ahora();

  // Revalida antes del set() definitivo: la transacción de arriba fue un await real.
  const freshRegistroRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/REGISTRO/${ventaKey}`);
  await set(freshRegistroRef, {
    // Identidad EXPLÍCITA además de la clave: ninguna lógica futura debería
    // tener que deducir el canal de la primera letra de la key.
    ...identidad,
    fecha,
    hora,
    modoVenta,
    ventaTotal,
    porcentajeComision,
    comisionGenerada,
    // Importe exacto en centavos enteros. Es el que usa la contabilidad nueva y
    // el que va a leer la anulación: así se revierte SIEMPRE lo que la venta
    // generó de verdad, aunque el porcentaje haya cambiado desde entonces.
    comisionGeneradaCentavos: comisionCentavos,
    // Timestamp DEL SERVIDOR. Es lo único que permite decidir si una venta es
    // anterior o posterior a la frontera contable: `fecha`/`hora` son strings
    // del reloj del cliente, y la forma de la clave (M/D) no sirve porque esas
    // claves existen desde el hotfix de identidad, ANTES de activar.
    registradoEn: serverTimestamp(),
    totalComisionesAcumuladas: totalSnap.val(),
    estado: 'pendiente',
    origen,
    ...(activa ? { opId: opIdDeVenta } : {}),
  });

  // CONTABILIDAD NUEVA. Dormida mientras migracionVersion < 1.
  //
  // Una venta con comisión 0 (local con porcentaje en 0, como Achaval) guarda
  // su identidad igual, pero no hay nada que mover: no se emite movimiento y
  // los acumuladores quedan intactos.
  if (activa && tieneEfectoContable(deltasDeVenta(comisionCentavos))) {
    await aplicarPlan(op.getDatabaseOrAbort(), planDeVenta({
      localId, modoVenta, idVenta, comisionCentavos,
      meta: { ventaKey, ventaTotal: aCentavos(ventaTotal), origen },
    }));
  }
};

/**
 * Procesa el pago de comisiones pendientes.
 * Marca los registros de COMISIONES/REGISTRO como "pagada" en orden cronológico.
 * Si el pago no alcanza para cubrir un registro completo, marca ese registro
 * como "pagada_parcial" con saldoPendiente.
 * Crea un registro en COMISIONES/PAGOS con el resumen del pago.
 */
export const registrarPagoComision = async (montoPago, responsable = 'Sistema', idPagoIntento = null) => {
  checkLocalId();
  const localId = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  const totales = await leerTotales(db, localId);

  // -------------------------------------------------------------------------
  // CONTABILIDAD NUEVA: EL PAGO ENTERO EN UNA SOLA ESCRITURA.
  //
  // Un pago mueve dos cosas: la DEUDA (los acumuladores) y el DETALLE (qué
  // registros quedan pagados, más el comprobante). Si fueran dos escrituras, un
  // fallo entre medio dejaría la deuda correcta y el detalle incompleto, sin
  // que nadie se entere.
  //
  // Se arma todo junto y se manda en un único `update()` multipath — movimiento
  // create-only, los tres increments, el comprobante y los registros. Verificado
  // contra el emulador con un pago que alcanzó 250 registros: 1.256 rutas en una
  // sola escritura. O entra todo, o no entra nada.
  //
  // `idPagoIntento` lo genera y CONSERVA el llamador: un reintento apunta al
  // mismo `P-{id}` y las reglas lo rechazan sin descontar de nuevo.
  // -------------------------------------------------------------------------
  // GUARDA: con la contabilidad activa, un pago SIN identidad de intento no
  // puede aplicarse. Sin `idPago` no hay `P-{id}` determinístico y por lo tanto
  // no hay idempotencia: un reintento descontaría dos veces. Antes que dejar
  // pasar un pago sin protección, se corta y se ve.
  if (contabilidadActiva(totales) && !idPagoIntento) {
    throw new Error(
      'Pago de comisión sin identidad de intento (idPago). Con la contabilidad '
      + 'nueva activa todo pago tiene que llegar con su idPago persistido; sin él '
      + 'no hay forma de evitar un doble descuento ante un reintento.',
    );
  }

  if (contabilidadActiva(totales) && idPagoIntento) {
    const snapReg = await get(ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/REGISTRO`));
    const pendientesCentavos = [];
    snapReg.forEach((child) => {
      const v = child.val();
      if (!v) return;
      const enCentavos = (pesos, centavos) => (Number.isInteger(centavos) ? centavos : aCentavos(pesos));
      if (v.estado === 'pendiente') {
        pendientesCentavos.push({
          key: child.key, fecha: v.fecha, hora: v.hora, estado: v.estado,
          pendingAmount: enCentavos(v.comisionGenerada, v.comisionGeneradaCentavos),
        });
      } else if (v.estado === 'pagada_parcial') {
        pendientesCentavos.push({
          key: child.key, fecha: v.fecha, hora: v.hora, estado: v.estado,
          pendingAmount: enCentavos(v.saldoPendiente, v.saldoPendienteCentavos),
        });
      }
    });

    const { fecha: fechaPago, hora: horaPago } = ahora();
    const plan = planCompletoDePago({
      localId, idPago: idPagoIntento, montoCentavos: aCentavos(montoPago),
      responsable, fechaPago, horaPago, pendientes: pendientesCentavos,
    });

    const r = await aplicarPlanCompleto(op.getDatabaseOrAbort(), plan);
    // Si fue RECHAZADO por algo que no es un duplicado, aplicarPlanCompleto ya
    // lanzó y el operador lo ve. Acá solo queda el caso normal de reintento.
    if (!r.aplicado) {
      console.log(`[COMISION] pago ${idPagoIntento} ya estaba aplicado: no se repite`);
      return { yaAplicado: true };
    }
    return { aplicado: true, registrosPagados: plan.registrosPagados };
  }

  // -------------------------------------------------------------------------
  // CAMINO DORMIDO: exactamente el de siempre, sin cambios.
  // -------------------------------------------------------------------------
  const snap = await get(ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/REGISTRO`));
  if (!snap.exists()) return;

  // Recolectar pendientes (incluyendo pagos parciales previos)
  const pendientes = [];
  snap.forEach((child) => {
    const val = child.val();
    if (!val) return;
    if (val.estado === 'pendiente') {
      pendientes.push({ key: child.key, ...val, pendingAmount: val.comisionGenerada });
    } else if (val.estado === 'pagada_parcial') {
      pendientes.push({ key: child.key, ...val, pendingAmount: val.saldoPendiente || 0 });
    }
  });

  if (pendientes.length === 0) return;

  // Ordenar del más antiguo al más nuevo (dd-mm-aaaa hh:mm:ss → Date)
  pendientes.sort((a, b) => {
    const toMs = (d, h) => {
      const [dd, mm, yyyy] = d.split('-');
      return new Date(`${yyyy}-${mm}-${dd}T${h}`).getTime();
    };
    return toMs(a.fecha, a.hora) - toMs(b.fecha, b.hora);
  });

  const { fecha: fechaPago, hora: horaPago } = ahora();
  const nuevoPagoRef = push(ref(db, `${localId}/COMISIONES/PAGOS`));
  const idPagoComision = nuevoPagoRef.key;

  let restante = montoPago;
  const registrosPagados = [];
  const updates = {};

  for (const reg of pendientes) {
    if (restante <= 0) break;
    const base = `${localId}/COMISIONES/REGISTRO/${reg.key}`;

    if (restante >= reg.pendingAmount) {
      // Pago completo de este registro
      updates[`${base}/estado`] = 'pagada';
      updates[`${base}/fechaPago`] = fechaPago;
      updates[`${base}/horaPago`] = horaPago;
      updates[`${base}/montoPago`] = reg.pendingAmount;
      updates[`${base}/idPagoComision`] = idPagoComision;
      // Limpiar saldo parcial si existía
      if (reg.estado === 'pagada_parcial') {
        updates[`${base}/saldoPendiente`] = null;
      }
      restante -= reg.pendingAmount;
      registrosPagados.push(reg.key);
    } else {
      // Pago parcial: el monto restante no alcanza para cubrir este registro
      updates[`${base}/estado`] = 'pagada_parcial';
      updates[`${base}/fechaPago`] = fechaPago;
      updates[`${base}/horaPago`] = horaPago;
      updates[`${base}/montoPago`] = restante;
      updates[`${base}/saldoPendiente`] = reg.pendingAmount - restante;
      updates[`${base}/idPagoComision`] = idPagoComision;
      registrosPagados.push(reg.key);
      restante = 0;
    }
  }

  if (registrosPagados.length === 0) return;

  // Revalida antes de las dos escrituras definitivas: el get() de arriba fue
  // un await real. Se reutiliza nuevoPagoRef (su key ya se usó en `updates`
  // más arriba) pero re-derivada sobre una database revalidada.
  const freshDb = op.getDatabaseOrAbort();
  const freshPagoRef = ref(freshDb, `${localId}/COMISIONES/PAGOS/${idPagoComision}`);

  // Aplicar todas las actualizaciones de estado en un solo write atómico
  await update(ref(freshDb), updates);

  // Guardar registro del pago
  await set(freshPagoRef, {
    fechaPago,
    horaPago,
    montoPago,
    registrosPagados,
    responsable,
  });
};

/**
 * Cancela el registro de comisión de una venta que fue anulada.
 * Solo aplica si el registro existe y está pendiente o parcialmente pagado.
 * Si ya fue pagada completamente, no modifica nada.
 *
 * @param {string|number} idVenta
 * @param {string} [modoVenta] 'mostrador' | 'delivery'. Si se omite se
 *   mantiene el comportamiento HISTÓRICO exacto (solo clave numérica): así un
 *   llamador que todavía no informe el canal no puede cancelar por error la
 *   comisión del otro canal.
 */
export const cancelarComision = async (idVenta, modoVenta) => {
  checkLocalId();
  const localId = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  const base = `${localId}/COMISIONES/REGISTRO`;
  let registroRef = null;
  let registro = null;
  let claveResuelta = null;

  if (modoVenta === undefined || modoVenta === null) {
    // Comportamiento histórico, sin cambios.
    const r = ref(db, `${base}/${claveLegada(idVenta)}`);
    const s = await get(r);
    if (s.exists()) { registroRef = r; registro = s.val(); claveResuelta = claveLegada(idVenta); }
  } else {
    // 1) clave canónica
    const rc = ref(db, `${base}/${claveDeVenta(modoVenta, idVenta)}`);
    const sc = await get(rc);
    if (sc.exists()) {
      registroRef = rc; registro = sc.val(); claveResuelta = claveDeVenta(modoVenta, idVenta);
    } else {
      // 2) clave legada, SOLO si es del mismo canal: si el registro numérico
      //    pertenece al otro canal, cancelarlo sería revertir la comisión de
      //    una venta ajena — el daño exacto que produce la colisión.
      const rl = ref(op.getDatabaseOrAbort(), `${base}/${claveLegada(idVenta)}`);
      const sl = await get(rl);
      if (sl.exists() && registroEsDelCanal(sl.val(), modoVenta)) {
        registroRef = rl; registro = sl.val(); claveResuelta = claveLegada(idVenta);
      }
    }
  }

  if (!registroRef || !registro) return;
  if (registro.estado === 'pagada') {
    console.log(`[COMISION] cancelarComision idVenta=${idVenta} → ya estaba pagada, no se cancela`);
    return;
  }

  const comisionGenerada = registro.comisionGenerada || 0;
  // SIEMPRE la comisión que generó ESTA venta, nunca el porcentaje de hoy. Los
  // registros nuevos ya la traen en centavos; los anteriores se convierten.
  const comisionCentavos = Number.isInteger(registro.comisionGeneradaCentavos)
    ? registro.comisionGeneradaCentavos
    : aCentavos(comisionGenerada);

  const totales = await leerTotales(op.getDatabaseOrAbort(), localId);
  const activa = contabilidadActiva(totales);

  // Descontar del total acumulado. Revalida antes: el get() de arriba fue un await real.
  const totalRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/TOTALES/totalAcumulado`);
  await runTransaction(totalRef, (current) => {
    return Math.max(0, (current || 0) - comisionGenerada);
  });

  // CONTABILIDAD NUEVA. `A-{ventaKey}` es único por venta, así que anular dos
  // veces revierte una sola. Dormida mientras migracionVersion < 1.
  if (activa && modoVenta && tieneEfectoContable(deltasDeAnulacion(comisionCentavos))) {
    await aplicarPlan(op.getDatabaseOrAbort(), planDeAnulacion({
      localId, modoVenta, idVenta, comisionCentavos,
      meta: { ventaKey: claveResuelta },
    }));
  }

  const { fecha, hora } = ahora();
  // Se revalida la database, pero se conserva la MISMA clave que se resolvió
  // arriba: escribir sobre `${idVenta}` marcaría como cancelado el registro
  // legado del otro canal.
  const freshRegistroRef = ref(op.getDatabaseOrAbort(), `${base}/${claveResuelta}`);
  await update(freshRegistroRef, {
    estado: 'cancelada',
    fechaCancelacion: fecha,
    horaCancelacion: hora,
  });

  console.log(`[COMISION] cancelarComision ventaKey=${claveResuelta} comision=${comisionGenerada} → cancelada`);
};
