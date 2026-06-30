// Tracks recently-sent WhatsApp messages per order to prevent duplicate opens
// when both the manual send (AssignDelivererModal) and the auto-hook
// (useDeliveryStatusWhatsApp) fire simultaneously for the same assignment.
const sentOrders = new Map();
const DEDUP_WINDOW_MS = 10000;

export function markWaSent(orderId) {
  if (!orderId) return;
  sentOrders.set(String(orderId), Date.now());
}

export function wasWaRecentlySent(orderId) {
  if (!orderId) return false;
  const ts = sentOrders.get(String(orderId));
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_WINDOW_MS) {
    sentOrders.delete(String(orderId));
    return false;
  }
  return true;
}
