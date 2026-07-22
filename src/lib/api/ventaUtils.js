/**
 * Utilidades para determinar el impacto de una venta sobre
 * stock, caja y comisiones. Centraliza la lógica de estado
 * para evitar inconsistencias entre módulos.
 */
import { calcularTotalOpcionalesUnidad, listarOpcionalesSeleccionados } from './optionalsPricing.js';

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

/**
 * Convierte cualquier valor de costo a un número seguro. NUNCA devuelve un objeto,
 * así que es seguro para renderizar. Si viene un objeto (p. ej. { receta, stockType }
 * o { costoTotal, ... }) intenta extraer un número conocido; si no, devuelve 0.
 */
export const normalizarCosto = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(/\$/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  if (valor && typeof valor === 'object') {
    const posible =
      valor.costoTotalReceta ??
      valor.costoTotal ??
      valor.totalCosto ??
      valor.costoUnitario ??
      valor.costo ??
      valor.valor ??
      valor.propio ??
      0;
    // Evitar recursión infinita si el campo elegido vuelve a ser un objeto
    return typeof posible === 'object' ? 0 : normalizarCosto(posible);
  }
  return 0;
};

/**
 * Convierte un valor de stock/cantidad a número seguro para render y comparación.
 * Si el stock viene como objeto de configuración de artículo ({ stockType, propio,
 * receta, heredadoDe }), toma `propio`; si no, 0. Nunca devuelve un objeto.
 */
export const normalizarStock = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
  if (valor && typeof valor === 'object') {
    const n = Number(valor.propio);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/**
 * Calcula venta, costo y ganancia de una lista de ítems de una venta.
 *   totalVenta = Σ cantidad × valor (precio de venta unitario)
 *   totalCosto = Σ cantidad × (costoTotalReceta ?? costoUnitario)   [costo real del artículo]
 *   ganancia   = totalVenta − totalCosto
 * Redondea a 3 decimales, igual que el campo CostoTotal ya existente.
 * NO afecta facturación/CAE/PDF: solo agrega datos de gestión a la venta.
 */
export const calcularVentaCostoGanancia = (items = []) => {
  let totalVenta = 0;
  let totalCosto = 0;
  if (Array.isArray(items)) {
    for (const item of items) {
      const qty       = Number(item.cantidad) || Number(item.quantity) || 1;
      // normalizarCosto garantiza número aunque el campo venga como objeto (nunca NaN/objeto)
      const unitPrice = normalizarCosto(item.valor ?? item.precio ?? item.price);
      const unitCost  = normalizarCosto(item.costoTotalReceta ?? item.costoUnitario);
      totalVenta += qty * unitPrice;
      totalCosto += qty * unitCost;

      // VENTA: los opcionales pagos también se cobran, así que suman a la venta.
      // Antes quedaban fuera y la venta/ganancia salían mal.
      // COSTO: solo se suma el COSTO REAL del artículo usado como opcional
      // (costoTotalReceta/costoUnitario del artículo vinculado). Un opcional
      // manual sin costo configurado NO aporta costo: nunca se usa su precio de
      // venta como costo (inflaría el costo y hundiría la ganancia).
      totalVenta += qty * calcularTotalOpcionalesUnidad(item.selectedOptionals);
      for (const op of listarOpcionalesSeleccionados(item.selectedOptionals)) {
        const cantOp = Number(op.cantidad ?? op.quantity ?? 1) || 1;
        const costoOp = normalizarCosto(op.costoTotalReceta ?? op.costoUnitario ?? op.costo);
        totalCosto += qty * cantOp * costoOp;
      }
    }
  }
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const venta = r3(totalVenta);
  const costo = r3(totalCosto);
  return { totalVenta: venta, totalCosto: costo, ganancia: r3(venta - costo) };
};
