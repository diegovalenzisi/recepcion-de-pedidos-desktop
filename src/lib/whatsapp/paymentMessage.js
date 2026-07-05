// Arma el mensaje de WhatsApp de cobro que se abre al presionar el botón WhatsApp
// sobre un pedido. El texto sale de Configuración → Configuración web → Mensajes
// predeterminados → Mensaje de WhatsApp (settings.web.whatsappMessage). Si no hay
// mensaje configurado, se usa DEFAULT_WHATSAPP_MESSAGE como fallback.
//
// Tokens reemplazados:
//   {cliente}        → nombre del cliente
//   {numero}         → número de pedido (crudo; el '#' va en el texto)
//   {total}          → total a pagar (número; el '$' va en el texto)
//   {aliasFavorita}  → alias de la cuenta favorita
//   {titularCuenta}  → titular (aNombreDe) de la cuenta favorita
//
// Nota: se usa comilla simple para que ${total} quede LITERAL (sin interpolar).
export const DEFAULT_WHATSAPP_MESSAGE =
  'Hola *{cliente}*, te hablamos desde la heladería por tu pedido #{numero}.\n\n' +
  'Por favor envía el pago de ${total} a el alias *{aliasFavorita}*\n' +
  'A nombre de: *{titularCuenta}*\n\n' +
  'Una vez que recibamos el comprobante, comenzaremos a armarlo.\n\n' +
  'Gracias!!!';

// Mensaje predeterminado para "Mensaje al Asignar Repartidor" (Config web).
// Se usa como fallback y como texto precargado cuando el campo está vacío.
// ${total} queda LITERAL (comilla simple, sin interpolar).
export const DEFAULT_ASSIGN_DELIVERER_MESSAGE =
  'Hola *{cliente}*, tu pedido #{numero} ya fue asignado al repartidor *{repartidor}*.\n\n' +
  'Está saliendo hacia tu domicilio.\n\n' +
  'Total a pagar: ${total}\n\n' +
  'Gracias!!!';

const FALLBACK_ALIAS   = 'ALIAS NO CONFIGURADO';
const FALLBACK_TITULAR = 'TITULAR NO CONFIGURADO';

// Reemplazo global simple y seguro (sin regex, evita problemas con caracteres especiales).
const replaceAll = (str, token, value) => str.split(token).join(value);

export const buildPaymentWhatsAppMessage = ({ order, template, alias, titular }) => {
  const client = order?.client || order?.cliente || {};
  const cliente = client.name || client.nombre || 'Cliente';
  const numero  = order?.id != null ? String(order.id) : '';

  const rawTotal = order?.payment?.total ?? order?.payment?.amount ?? order?.total ?? 0;
  const totalNum = Number(rawTotal) || 0;
  const total    = Number.isInteger(totalNum) ? String(totalNum) : totalNum.toFixed(2);

  const aliasFav      = (alias   && String(alias).trim())   ? String(alias).trim()   : FALLBACK_ALIAS;
  const titularCuenta = (titular && String(titular).trim()) ? String(titular).trim() : FALLBACK_TITULAR;

  const tpl = (template && String(template).trim()) ? String(template) : DEFAULT_WHATSAPP_MESSAGE;

  let out = tpl;
  out = replaceAll(out, '{cliente}', cliente);
  out = replaceAll(out, '{numero}', numero);
  out = replaceAll(out, '{total}', total);
  out = replaceAll(out, '{aliasFavorita}', aliasFav);
  out = replaceAll(out, '{titularCuenta}', titularCuenta);
  return out;
};

// Normaliza el total de un pedido a número limpio (ej. 8500, o 8500.50 con decimales).
// Contempla tanto el pedido completo (payment.total/amount, total) como la forma
// "waData" de extractOrderDataForWhatsApp (totalPrice).
const formatTotal = (order) => {
  const rawTotal = order?.payment?.total ?? order?.payment?.amount ?? order?.total ?? order?.totalPrice ?? 0;
  const n = Number(rawTotal) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

// Arma el mensaje que se envía al asignar repartidor / pasar a EN DELIVERY.
// Usa la plantilla configurada (settings.web.assignDelivererMessage); si está vacía,
// usa DEFAULT_ASSIGN_DELIVERER_MESSAGE. Reemplaza:
//   {cliente} {numero} {total} {repartidor} {direccion}
export const buildDelivererAssignedMessage = ({ order, template, deliverer }) => {
  const client = order?.client || order?.cliente || {};
  const cliente = order?.clientName || client.name || client.nombre || 'Cliente';
  const numero  = (order?.orderNumber ?? order?.id ?? order?.numero) != null
    ? String(order.orderNumber ?? order.id ?? order.numero)
    : '';
  const total     = formatTotal(order);
  const direccion = client.address || client.direccion || order?.deliveryAddress || order?.direccion || '';
  const repartidor = (deliverer && String(deliverer).trim()) ? String(deliverer).trim() : 'nuestro repartidor';

  const tpl = (template && String(template).trim()) ? String(template) : DEFAULT_ASSIGN_DELIVERER_MESSAGE;

  let out = tpl;
  out = replaceAll(out, '{cliente}', cliente);
  out = replaceAll(out, '{numero}', numero);
  out = replaceAll(out, '{total}', total);
  out = replaceAll(out, '{repartidor}', repartidor);
  out = replaceAll(out, '{direccion}', direccion);
  return out;
};
