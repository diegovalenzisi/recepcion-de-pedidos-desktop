export const GENERIC_CLIENTE_VALUES = ['transferencia recibida', 'mercado pago', 'tu cuenta', 'tu dinero'];

export const normalizeCliente = (rawCliente) => {
  const trimmed = (rawCliente || '').trim();
  if (!trimmed) return null;
  if (GENERIC_CLIENTE_VALUES.includes(trimmed.toLowerCase())) return null;
  return trimmed;
};
