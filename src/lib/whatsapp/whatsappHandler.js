// En Electron se usa shell.openExternal vía IPC.
// En el navegador se usa window.open como fallback.
const openUrl = (url) => {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
};

export const openWhatsApp = async (phoneNumber, messagePromiseOrString = '', preference = 'web') => {
  try {
    const resolvedMessage = await Promise.resolve(messagePromiseOrString);
    const phone = phoneNumber ? String(phoneNumber).replace(/\D/g, '') : '';
    const processedMessage = typeof resolvedMessage === 'string' ? resolvedMessage.trim() : '';
    const text = processedMessage ? `&text=${encodeURIComponent(processedMessage)}` : '';

    if (preference === 'app') {
      const appUrl = phone
        ? `whatsapp://send?phone=${phone}${text}`
        : `whatsapp://send?${text.substring(1)}`;
      openUrl(appUrl);
    } else {
      const webUrl = phone
        ? `https://web.whatsapp.com/send?phone=${phone}${text}`
        : `https://web.whatsapp.com/send?${text.substring(1)}`;
      openUrl(webUrl);
    }
  } catch (error) {
    console.error("Error formatting WhatsApp message:", error);
  }
};

export const openWhatsAppWithMessage = async (phoneNumber, messagePromiseOrString, preference = 'web') => {
  try {
    const resolvedMessage = await Promise.resolve(messagePromiseOrString);
    const phone = phoneNumber ? String(phoneNumber).replace(/\D/g, '') : '';
    const processedMessage = typeof resolvedMessage === 'string' ? resolvedMessage.trim() : '';
    const text = processedMessage ? `&text=${encodeURIComponent(processedMessage)}` : '';

    if (preference === 'app') {
      const appUrl = phone
        ? `whatsapp://send?phone=${phone}${text}`
        : `whatsapp://send?${text.substring(1)}`;
      openUrl(appUrl);
    } else {
      const webUrl = phone
        ? `https://web.whatsapp.com/send?phone=${phone}${text}`
        : `https://web.whatsapp.com/send?${text.substring(1)}`;
      openUrl(webUrl);
    }
  } catch (error) {
    console.error("Error formatting WhatsApp message:", error);
  }
};
