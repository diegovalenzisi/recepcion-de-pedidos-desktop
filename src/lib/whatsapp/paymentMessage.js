// Arma el mensaje de WhatsApp de cobro que se abre al presionar el botón WhatsApp
// sobre un pedido. Hay DOS plantillas separadas, según el medio de pago real del pedido
// (ver isCashOnlyOrder más abajo):
//   - Electrónico: Configuración → Configuración web → Mensaje WhatsApp para pagos
//     electrónicos (settings.web.whatsappMessage). Fallback: DEFAULT_WHATSAPP_MESSAGE.
//   - Efectivo: Configuración → Configuración web → Mensaje WhatsApp para pagos en
//     efectivo (settings.web.whatsappMessageEfectivo). Fallback: DEFAULT_WHATSAPP_MESSAGE_EFECTIVO.
//
// Tokens reemplazados (en ambas plantillas):
//   {cliente}        → nombre del cliente
//   {numero}         → número de pedido (crudo; el '#' va en el texto)
//   {total}          → total a pagar (número; el '$' va en el texto)
//   {aliasFavorita}  → alias de la cuenta (si se proveyó)
//   {titularCuenta}  → titular (aNombreDe) de la cuenta (si se proveyó)
//
// Nota: se usa comilla simple para que ${total} quede LITERAL (sin interpolar).
export const DEFAULT_WHATSAPP_MESSAGE =
  'Hola *{cliente}*, te hablamos desde la heladería por tu pedido #{numero}.\n\n' +
  'Por favor envía el pago de ${total} a el alias *{aliasFavorita}*\n' +
  'A nombre de: *{titularCuenta}*\n\n' +
  'Una vez que recibamos el comprobante, comenzaremos a armarlo.\n\n' +
  'Gracias!!!';

// Mensaje predeterminado para pagos en EFECTIVO. Exigido tal cual, sin variables de
// cuenta/alias (el cliente paga en mano, no hay nada que transferir).
export const DEFAULT_WHATSAPP_MESSAGE_EFECTIVO =
  'Hola *{cliente}*, te hablamos desde la heladería por tu pedido #{numero}.';

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
const FALLBACK_CLIENT_NAME = 'Cliente';

// Reemplazo global simple y seguro (sin regex, evita problemas con caracteres especiales).
const replaceAll = (str, token, value) => str.split(token).join(value);

// Rellena los tokens comunes de ambas plantillas de cobro (electrónico y efectivo) sobre
// un texto ya resuelto (con su fallback ya aplicado). Compartida para no duplicar el
// reemplazo de {cliente}/{numero}/{total}/{aliasFavorita}/{titularCuenta} en dos lugares.
const fillPaymentTemplate = (tpl, { order, alias, titular }) => {
  const client = order?.client || order?.cliente || {};
  // Si el cliente no tiene nombre, se usa el mismo fallback que ya usaba la app ('Cliente'),
  // nunca 'undefined'/'null' ni texto roto.
  const cliente = (client.name || client.nombre || '').trim() || FALLBACK_CLIENT_NAME;
  const numero  = order?.id != null ? String(order.id) : '';

  const rawTotal = order?.payment?.total ?? order?.payment?.amount ?? order?.total ?? 0;
  const totalNum = Number(rawTotal) || 0;
  const total    = Number.isInteger(totalNum) ? String(totalNum) : totalNum.toFixed(2);

  const aliasFav      = (alias   && String(alias).trim())   ? String(alias).trim()   : FALLBACK_ALIAS;
  const titularCuenta = (titular && String(titular).trim()) ? String(titular).trim() : FALLBACK_TITULAR;

  let out = tpl;
  out = replaceAll(out, '{cliente}', cliente);
  out = replaceAll(out, '{numero}', numero);
  out = replaceAll(out, '{total}', total);
  out = replaceAll(out, '{aliasFavorita}', aliasFav);
  out = replaceAll(out, '{titularCuenta}', titularCuenta);
  return out;
};

export const buildPaymentWhatsAppMessage = ({ order, template, alias, titular }) => {
  const tpl = (template && String(template).trim()) ? String(template) : DEFAULT_WHATSAPP_MESSAGE;
  return fillPaymentTemplate(tpl, { order, alias, titular });
};

// Mensaje de cobro para pagos en EFECTIVO. Mismos tokens que el electrónico (por si el
// usuario decide personalizarlo con {total}, etc.), sin requerir alias/titular.
export const buildCashWhatsAppMessage = ({ order, template }) => {
  const tpl = (template && String(template).trim()) ? String(template) : DEFAULT_WHATSAPP_MESSAGE_EFECTIVO;
  return fillPaymentTemplate(tpl, { order, alias: null, titular: null });
};

// ---------------------------------------------------------------------------
// Detección del medio de pago: efectivo vs. electrónico.
// ---------------------------------------------------------------------------
// Normaliza un nombre de medio de pago para comparar de forma robusta: minúsculas, sin
// acentos, guiones/guiones bajos convertidos a espacio, espacios repetidos colapsados.
// Así "Transferencia_1", "TRANSFERENCIA 1" y "transferencia1" se tratan de forma consistente.
// Rango Unicode de marcas diacriticas combinantes (U+0300-U+036F), escrito con escape
// \uXXXX explicito (ASCII puro en el fuente) para evitar cualquier ambiguedad de encoding.
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const normalizePaymentMethodName = (name) => {
  return String(name || '')
    .normalize('NFD').replace(DIACRITICS_REGEX, '') // quita acentos (letra con tilde -> letra sin tilde)
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Un medio de pago es "efectivo" si, normalizado, contiene la palabra "efectivo" o es
// exactamente "cash". Cualquier otro medio (Transferencia, Transferencia 1/2, Mercado Pago,
// tarjeta, QR, billeteras, o cualquier medio personalizado) se considera electrónico por
// default — no hace falta enumerar variantes electrónicas, solo detectar efectivo con certeza.
export const isCashPaymentMethod = (methodName) => {
  const normalized = normalizePaymentMethodName(methodName);
  if (!normalized) return false;
  return normalized.includes('efectivo') || normalized === 'cash';
};

// Extrae los medios de pago REALES y ACTUALES de un pedido.
//
// order.payment.method es el ÚNICO campo que TODOS los flujos de edición mantienen al día
// (incluida la edición de un solo método desde el detalle del pedido — OrderDetailModal.jsx vía
// DeliveryTab.jsx:handleConfirmClientUpdate — que solo toca `.method` y nunca lee/escribe/limpia
// `.payments`). order.payment.payments (array) puede quedar con datos VIEJOS de una edición
// anterior o de la creación del pedido, porque nada lo limpia al pasar a un método único.
//
// El array SOLO es la fuente vigente cuando el pedido está realmente en pago dividido: la única
// escritura que pone `payment.payments` en sincro real es useDeliveryActions.js (handleDelivered),
// y esa misma escritura SIEMPRE fija `payment.method = 'Pago Dividido'` en el mismo update atómico
// (ver useDeliveryActions.js). Por eso ese string es la señal confiable de "el array es actual";
// fuera de ese caso, method manda siempre — así no se mezcla el pago histórico con el actual.
//
// Prioridad:
//   1) 'Pago Dividido' en payment.method + payment.payments no vacío → pago dividido vigente.
//   2) payment.method (string único) — caso normal, incluye después de cualquier edición.
//   3) payment.payments como último fallback, solo si payment.method no existe en absoluto.
//   4) [] si no hay ningún dato de pago.
export const getOrderPaymentMethods = (order) => {
  const payment = order?.payment || {};
  const singleMethod = payment.method != null ? String(payment.method) : '';
  const paymentsArray = Array.isArray(payment.payments)
    ? payment.payments.map((p) => p?.method).filter(Boolean)
    : [];

  if (singleMethod === 'Pago Dividido' && paymentsArray.length > 0) {
    return paymentsArray;
  }
  if (singleMethod) return [singleMethod];
  if (paymentsArray.length > 0) return paymentsArray;
  return [];
};

// Un pedido usa el mensaje de EFECTIVO solo si tiene al menos un medio de pago informado y
// TODOS son efectivo. Si tiene algún medio electrónico (o ninguno informado), usa el mensaje
// electrónico — prioridad explícita: "si es efectivo → efectivo; si no es efectivo → electrónico".
export const isCashOnlyOrder = (order) => {
  const methods = getOrderPaymentMethods(order);
  return methods.length > 0 && methods.every(isCashPaymentMethod);
};

/**
 * Punto de entrada ÚNICO para armar el mensaje de WhatsApp de cobro de un pedido, sin
 * importar la pantalla desde la que se dispare (Atención/Pedidos, Delivery, etc.). Decide
 * la plantilla según el medio de pago real del pedido (ver isCashOnlyOrder) y rellena los
 * tokens. `alias`/`titular` solo se usan si termina resolviendo al mensaje electrónico.
 */
export const resolvePaymentWhatsAppMessage = ({ order, templateElectronico, templateEfectivo, alias, titular }) => {
  if (isCashOnlyOrder(order)) {
    return buildCashWhatsAppMessage({ order, template: templateEfectivo });
  }
  return buildPaymentWhatsAppMessage({ order, template: templateElectronico, alias, titular });
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
