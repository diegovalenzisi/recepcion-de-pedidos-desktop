/**
 * Utilidades para determinar el impacto de una venta sobre
 * stock, caja y comisiones. Centraliza la lógica de estado
 * para evitar inconsistencias entre módulos.
 */

/**
 * Devuelve true si la venta está realmente concretada
 * (cobrada/entregada) y puede afectar caja, stock y comisiones.
 *
 * MOSTRADOR: status === 'COMPLETADO'
 * PEDIDOS:   status.main === 'ENTREGADO' + tiene pago registrado
 */
export const isSaleFinalized = (sale) => {
  if (!sale) return false;
  const type = (sale.type || sale.tipo || '').toLowerCase();
  if (type === 'mostrador') {
    return sale.status === 'COMPLETADO';
  }
  // Delivery
  return sale.status?.main === 'ENTREGADO' && sale.payment != null;
};

/** Devuelve true si la venta debe descontar stock */
export const shouldImpactStock = (sale) => isSaleFinalized(sale);

/** Devuelve true si la venta debe sumarse a los totales de caja */
export const shouldImpactCaja = (sale) => isSaleFinalized(sale);

/** Devuelve true si la venta debe generar registro de comisión */
export const shouldGenerateCommission = (sale) => isSaleFinalized(sale);

/**
 * Parsea un valor de costo y devuelve un número seguro (nunca NaN).
 * Acepta: number, string numérico, undefined, null, ''
 * En cualquier caso inválido devuelve 0.
 */
export const safeCost = (value) => {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
};
