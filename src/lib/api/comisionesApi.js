import { getDatabase, ref, get, set, push, runTransaction, update } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';

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
 * Usa idVenta como clave Firebase → deduplicación automática.
 * Si el registro ya existe, no hace nada.
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

  const registroRef = ref(db, `${localId}/COMISIONES/REGISTRO/${idVenta}`);

  // Deduplicación: si ya existe un registro para esta venta, no crear otro
  const existingSnap = await get(registroRef);
  if (existingSnap.exists()) {
    console.log(`[COMISION] idVenta=${idVenta} yaExiste=true genera=false`);
    return;
  }
  console.log(`[COMISION] idVenta=${idVenta} yaExiste=false genera=true comision=${comisionGenerada}`);

  // Incrementar total acumulado histórico en forma atómica
  const totalRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/TOTALES/totalAcumulado`);
  const { committed, snapshot: totalSnap } = await runTransaction(totalRef, (current) => {
    return (current || 0) + comisionGenerada;
  });

  if (!committed) throw new Error('No se pudo actualizar totalAcumulado de comisiones.');

  const { fecha, hora } = ahora();

  // Revalida antes del set() definitivo: la transacción de arriba fue un await real.
  const freshRegistroRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/REGISTRO/${idVenta}`);
  await set(freshRegistroRef, {
    idVenta: String(idVenta),
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
 */
export const cancelarComision = async (idVenta) => {
  checkLocalId();
  const localId = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  const registroRef = ref(db, `${localId}/COMISIONES/REGISTRO/${idVenta}`);
  const snap = await get(registroRef);
  if (!snap.exists()) return;

  const registro = snap.val();
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
  const freshRegistroRef = ref(op.getDatabaseOrAbort(), `${localId}/COMISIONES/REGISTRO/${idVenta}`);
  await update(freshRegistroRef, {
    estado: 'cancelada',
    fechaCancelacion: fecha,
    horaCancelacion: hora,
  });

  console.log(`[COMISION] cancelarComision idVenta=${idVenta} comision=${comisionGenerada} → cancelada`);
};
