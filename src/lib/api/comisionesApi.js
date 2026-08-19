import { getDatabase, ref, get, set, push, runTransaction, update } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { claveDeVenta, claveLegada, identidadDeVenta, registroEsDelCanal } from '@/lib/api/comisionVentaKey';

const ahora = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`,
    hora: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
};

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
    totalComisionesAcumuladas: totalSnap.val(),
    estado: 'pendiente',
    origen,
  });
};

/**
 * Procesa el pago de comisiones pendientes.
 * Marca los registros de COMISIONES/REGISTRO como "pagada" en orden cronológico.
 * Si el pago no alcanza para cubrir un registro completo, marca ese registro
 * como "pagada_parcial" con saldoPendiente.
 * Crea un registro en COMISIONES/PAGOS con el resumen del pago.
 */
export const registrarPagoComision = async (montoPago, responsable = 'Sistema') => {
  checkLocalId();
  const localId = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  const snap = await get(ref(db, `${localId}/COMISIONES/REGISTRO`));
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

  // Descontar del total acumulado. Revalida antes: el get() de arriba fue un await real.
  const totalRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/TOTALES/totalAcumulado`);
  await runTransaction(totalRef, (current) => {
    return Math.max(0, (current || 0) - comisionGenerada);
  });

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
