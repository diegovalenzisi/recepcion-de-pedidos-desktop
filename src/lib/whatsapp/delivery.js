import { openWhatsApp } from './whatsappHandler';

export const generateDeliveryWhatsAppMessage = (order, accounts = [], autoOpenPreference = null, fetchedAlias = null, savedMessage = null) => {
  const client = order.client || order.cliente || {};
  const nombreCliente = client.name || client.nombre || 'Cliente';
  const orderId = order.id ? `${order.id}` : '';
  const phoneStr = client.phone || client.telefono || '';

  // Si se provee un mensaje guardado, lo usamos en lugar de generar uno nuevo
  if (savedMessage && savedMessage.trim() !== '') {
      // Opcional: Podríamos reemplazar placeholders aquí si fuera necesario
      // pero por ahora lo usamos tal cual
      const finalMessage = savedMessage;
      
      if (autoOpenPreference) {
         openWhatsApp(phoneStr, finalMessage, autoOpenPreference);
      }
      return finalMessage;
  }

  const paymentMethodName = order.payment?.method || order.metodoPago || (order.pagos && order.pagos.length > 0 ? order.pagos[0].method : 'Efectivo');
  
  // LOGICA PARA PAGOS POR TRANSFERENCIA
  if (paymentMethodName.toLowerCase().includes('transferencia')) {
      const total = order.payment?.total || order.payment?.amount || order.total || 0;
      let aliasLocal = fetchedAlias;
      
      // Fallback si el alias no se pasó directamente
      if (!aliasLocal) {
          const account = accounts.find(acc => acc.nombre?.toLowerCase().includes('transferencia')) || accounts.find(acc => acc.isFavorite);
          aliasLocal = account?.alias || '[Alias del local]';
      }

      // MENSAJE DINÁMICO REEMPLAZANDO CUALQUIER TEXTO HARDCODEADO
      const message = `Hola ${nombreCliente}, nos comunicamos por tu pedido numero ${orderId}, necesitamos que transfieras el total de $${parseFloat(total).toFixed(2)} al alias ${aliasLocal}. Al pedido pasara al sector de armado una vez que nos envies el comprobante. GRACIAS!!!`;
      
      if (autoOpenPreference) {
         openWhatsApp(phoneStr, message, autoOpenPreference);
      }
      return message;
  }

  // Lógica por defecto para otros métodos de pago
  let message = `Hola *${nombreCliente}*, tu pedido #${orderId} está en camino! 🛵\n\n`;
  message += `*Detalle del pedido:*\n`;
  
  const items = order.items || order.articulos || [];
  if (Array.isArray(items)) {
      items.forEach(item => {
        const qty = item.cantidad || item.quantity || 1;
        const name = item.nombre || item.articulo?.nombre || item.name || 'Articulo';
        const price = item.valor || item.precio || item.price || 0;
        message += `• ${qty}x ${name} ($${parseFloat(price).toFixed(2)})\n`;
      });
  }
  
  const total = order.payment?.total || order.payment?.amount || order.total || 0;
  message += `\n*Total: $${parseFloat(total).toFixed(2)}*\n`;

  if (paymentMethodName.toLowerCase() === 'efectivo') {
      message += `*Forma de pago:* Efectivo\n`;
  } else {
      const account = accounts.find(acc => acc.nombre === paymentMethodName);
      if (account) {
          message += `*Forma de pago:* ${paymentMethodName}\n`;
          if (account.alias) {
             message += `*Alias:* ${account.alias}`;
             if (account.aNombreDe && account.aNombreDe.trim()) {
                 message += ` a nombre de ${account.aNombreDe}`;
             }
             message += `\n`;
          }
      } else {
          message += `*Forma de pago:* ${paymentMethodName}\n`;
      }
  }
  
  const address = client.address || client.direccion;
  if (address) {
      message += `\n*Dirección de entrega:* ${address}\n`;
  }

  message += `\nGracias por elegirnos!`;
  
  // Auto-open si se provee preferencia
  if (autoOpenPreference) {
     openWhatsApp(phoneStr, message, autoOpenPreference);
  }
  
  return message;
};