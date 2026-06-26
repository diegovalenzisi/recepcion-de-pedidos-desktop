const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

export const getFechaActual = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export const getHoraActual = (date = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ARGENTINA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
