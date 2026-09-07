// ---------------------------------------------------------------------------
// Texto del aviso por voz de un pago recibido. Módulo puro (sin React, sin
// Firebase, sin speechSynthesis) para que se pueda probar solo — lo usa
// useVoicePaymentAlerts.js al armar cada anuncio de la cola.
//
// `cuentaMp` es el alias editable (ej. "Mónica", "Caja 2") de la cuenta de
// Mercado Pago que recibió el pago — sólo lo trae un registro de
// PAGOS_CONFIRMADOS cuando el local tiene más de una cuenta conectada (ver
// DLV Consultas/functions/lib/mpPaymentRecord.js). Sin ese campo, el aviso
// queda EXACTAMENTE igual que siempre.
// ---------------------------------------------------------------------------
export const buildAnnouncementText = (payment) => {
  const monto = payment.monto ?? 0;
  const clienteReal = payment.cliente?.trim();
  const isPending = payment.estadoCliente === 'pendiente';
  const cuenta = payment.cuentaMp?.trim();

  if (clienteReal && !isPending) {
    return cuenta
      ? `Pago recibido de ${clienteReal} por ${monto} pesos en Mercado Pago ${cuenta}.`
      : `Pago recibido de ${clienteReal} por ${monto} pesos.`;
  }
  const medio = cuenta ? `Mercado Pago ${cuenta}` : (payment.medio?.trim() || 'Mercado Pago');
  return `Pago recibido de ${medio} por ${monto} pesos.`;
};
