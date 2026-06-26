/**
 * Estado compartido del poller — permite que server.js exponga stats del
 * último poll sin imports circulares.
 * Ambos módulos importan este objeto y lo mutan directamente.
 */
export const pollStats = {
  lastPollTime:   null,  // ISO string
  lastPollTotal:  null,  // number — pagos en la ventana temporal
  lastPollApproved: null, // number — aprobados en el último poll
  lastWriteTime:  null,  // ISO string — última vez que se guardó un pago en Firebase
  lastWriteId:    null,  // string — id del último pago guardado
  lastErrorTime:  null,  // ISO string
  lastError:      null,  // string — mensaje del último error de MP API
};
