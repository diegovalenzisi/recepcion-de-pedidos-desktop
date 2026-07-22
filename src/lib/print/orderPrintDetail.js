// ---------------------------------------------------------------------------
// Detalle de impresión de un pedido — FUNCIÓN PURA basada EXCLUSIVAMENTE en el
// snapshot guardado. No consulta catálogo, ni precios actuales, ni stock, ni
// configuración de grupos, ni Firebase. No escribe nada. Por eso la reimpresión
// es una operación de lectura pura: llamar a estas funciones no puede producir
// efectos secundarios.
//
// AUDITORÍA DE SALIDAS DE IMPRESIÓN — a dónde va cada cosa:
//
//   Acción de UI                     Función              Archivo                     Tipo            ¿Importes?
//   ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Confirmar venta de mostrador     printCounterTicket   lib/print/counterTicket.js  ticket cliente  SÍ (este módulo)
//   (CounterTab.jsx / CounterPage)                                                                    total + opcionales
//   Enviar pedido a cocina           printCommand         lib/print/command.js        comanda cocina  NO (por diseño;
//   (useDeliveryActions)                                                                              sólo unidad+opcionales)
//   Cerrar/retirar caja fuerte       printSafeTicket      lib/print/safeTicket.js     arqueo caja     no aplica
//   Reimprimir factura (SalesPage)   printTicket          components/sales/           comprobante     SÍ, pero del
//                                                         ReceiptDocument.jsx         fiscal AFIP     registro fiscal
//
// El único destino al cliente que ahora muestra el desglose económico de los
// opcionales es counterTicket.js (vía counterTicketHtml.js). La comanda de
// cocina sigue SIN importes por decisión del negocio. ReceiptDocument reimprime
// la factura AFIP: sus importes salen del registro fiscal guardado, nunca de un
// recálculo local, y sólo muestra el desglose si el propio registro lo trae.
// ---------------------------------------------------------------------------

import { normalizarImporte } from '../api/optionalsPricing.js';

/**
 * Formato monetario por defecto del ticket: entero cuando el importe no tiene
 * centavos ($14.500) y con centavos solo si realmente los tiene ($14.500,50).
 * Cada destino puede inyectar el suyo (opción `formatImporte`) para NO mezclar
 * dos estilos monetarios dentro del mismo comprobante (condición 8).
 */
export const formatImporteTicket = (n) => {
  const num = Number(n) || 0;
  const decimales = Number.isInteger(num) ? 0 : 2;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(num).replace(/ /g, ' ');
};

/** Nombre seguro: nunca undefined / null / [object Object]. */
function nombreSeguro(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object' && typeof x.nombre === 'string') return x.nombre;
  if (x && typeof x === 'object' && typeof x.name === 'string') return x.name;
  return '';
}

/**
 * Importe a imprimir de un opcional, SOLO desde el snapshot.
 * Prioridad: `total` válido → `precioUnitario × cantidad` → nada.
 * NUNCA consulta el catálogo actual. Devuelve null si no hay importe imprimible
 * (opcional gratuito o histórico sin precio) para no imprimir +$0 ni NaN.
 */
export function importeOpcionalImprimible(op) {
  if (!op || typeof op !== 'object') return null;

  const rTotal = normalizarImporte(op.total);
  if (rTotal.valido && !rTotal.ausente && rTotal.valor > 0) return rTotal.valor;

  const rUnit = normalizarImporte(op.precioUnitario !== undefined ? op.precioUnitario : op.precio);
  if (rUnit.valido && !rUnit.ausente && rUnit.valor > 0) {
    const cant = Number(op.cantidad ?? op.quantity ?? 1) || 1;
    return rUnit.valor * cant;
  }
  return null; // gratuito, histórico sin precio, o inválido → sin importe
}

/** Lista plana y ordenada de los opcionales de una línea (respeta numeroOrden). */
export function opcionalesOrdenados(selectedOptionals) {
  if (!selectedOptionals || typeof selectedOptionals !== 'object') return [];
  const grupos = [];
  for (const gid of Object.keys(selectedOptionals)) {
    const lista = selectedOptionals[gid];
    if (!Array.isArray(lista) || lista.length === 0) continue;
    const ops = lista
      .filter((o) => o && nombreSeguro(o))
      .slice()
      .sort((a, b) => {
        const na = Number(a.numeroOrden); const nb = Number(b.numeroOrden);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;   // orden explícito
        return 0;                                                         // si no, orden de selección
      });
    if (ops.length === 0) continue;
    grupos.push({
      grupoId: gid,
      grupoNombre: nombreSeguro(ops[0].grupoNombre || ops[0].groupName) || '',
      opcionales: ops,
    });
  }
  return grupos;
}

/**
 * Líneas de texto de UNA línea del pedido (una unidad).
 * @param {object} item  línea persistida (con snapshot si es nueva)
 * @param {{conImportes?:boolean}} opts
 * @returns {string[]}
 */
export function lineasDeItem(item, { conImportes = true, formatImporte = formatImporteTicket } = {}) {
  if (!item || typeof item !== 'object') return [];
  const out = [];

  const nombre = (nombreSeguro(item.nombre) || 'ARTÍCULO').toUpperCase();
  const esPromo = !!item.isPromo;
  const titulo = esPromo ? `PROMO ${nombre}` : nombre;

  // Encabezado con unidad SOLO cuando la línea forma parte de varias unidades.
  const ui = Number(item.unidadIndice);
  const ut = Number(item.unidadTotal);
  out.push(Number.isFinite(ui) && Number.isFinite(ut) && ut > 1
    ? `${titulo} — UNIDAD ${ui} DE ${ut}`
    : titulo);

  if (conImportes) {
    const rBase = normalizarImporte(item.precioBaseUnitario !== undefined ? item.precioBaseUnitario : item.valor);
    if (rBase.valido && !rBase.ausente) out.push(`Precio base|${formatImporte(rBase.valor)}`);
  }

  // Opcionales del propio ítem (agrupados, con nombre de grupo si existe).
  for (const grupo of opcionalesOrdenados(item.selectedOptionals)) {
    const etiqueta = grupo.grupoNombre ? `${grupo.grupoNombre}: ` : '';
    const gratuitos = [];
    for (const op of grupo.opcionales) {
      const imp = conImportes ? importeOpcionalImprimible(op) : null;
      const cant = Number(op.cantidad ?? op.quantity ?? 1) || 1;
      const nom = nombreSeguro(op);
      if (imp !== null && imp > 0) {
        // Pago: se imprime con importe (ya multiplicado; nunca se vuelve a multiplicar).
        out.push(`+ ${nom}${cant > 1 ? ` x${cant}` : ''}|${formatImporte(imp)}`);
      } else {
        // Gratuito / histórico sin precio: nombre solo, jamás "+$0".
        gratuitos.push(`${nom}${cant > 1 ? ` x${cant}` : ''}`);
      }
    }
    if (gratuitos.length > 0) out.push(`${etiqueta}${gratuitos.join(' / ')}`);
  }

  // Hijos de promoción: cada uno con SUS propios opcionales (nunca mezclados).
  const hijos = item.promoItems || item.promoDetails;
  if (Array.isArray(hijos)) {
    hijos.forEach((hijo, idx) => {
      out.push(`${(nombreSeguro(hijo) || `ITEM ${idx + 1}`).toUpperCase()}`);
      for (const grupo of opcionalesOrdenados(hijo.selectedOptionals)) {
        const etiqueta = grupo.grupoNombre ? `${grupo.grupoNombre}: ` : '';
        const gratuitos = [];
        for (const op of grupo.opcionales) {
          const imp = conImportes ? importeOpcionalImprimible(op) : null;
          const nom = nombreSeguro(op);
          if (imp !== null && imp > 0) out.push(`+ ${nom}|${formatImporte(imp)}`);
          else gratuitos.push(nom);
        }
        if (gratuitos.length > 0) out.push(`${etiqueta}${gratuitos.join(' / ')}`);
      }
    });
  }

  if (conImportes) {
    // Subtotal SOLO desde el snapshot; si no hay, se omite (histórico sin desglose).
    const rSub = normalizarImporte(item.subtotalLinea);
    if (rSub.valido && !rSub.ausente) out.push(`Subtotal|${formatImporte(rSub.valor)}`);
  }

  return out;
}

/**
 * Detalle completo del pedido para imprimir. Solo lectura, solo snapshot.
 * @returns {{ lineas: string[], total: number|null }}
 */
export function construirDetalleImpresionPedido(order, { conImportes = true, formatImporte = formatImporteTicket } = {}) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  const lineas = [];

  items.forEach((item, i) => {
    if (i > 0) lineas.push('');
    lineas.push(...lineasDeItem(item, { conImportes, formatImporte }));
  });

  let total = null;
  if (conImportes) {
    // El total sale del snapshot del pedido (lo que se cobró), no del catálogo.
    const rTotalGuardado = normalizarImporte(order && (order.payment?.total ?? order.total));
    if (rTotalGuardado.valido && !rTotalGuardado.ausente) {
      total = rTotalGuardado.valor;
    } else {
      // Sin total guardado: se suma el subtotal congelado de cada línea.
      const suma = items.reduce((s, it) => {
        const r = normalizarImporte(it && it.subtotalLinea);
        return r.valido && !r.ausente ? s + r.valor : s;
      }, 0);
      total = suma > 0 ? suma : null;
    }
    if (total !== null) {
      lineas.push('');
      lineas.push(`TOTAL PEDIDO|${formatImporte(total)}`);
    }
  }

  return { lineas, total };
}

/** Render de texto plano a dos columnas (para comparar en pruebas y depurar). */
export function detalleATexto(lineas, ancho = 44) {
  return lineas
    .map((l) => {
      const i = l.indexOf('|');
      if (i === -1) return l;
      const izq = l.slice(0, i);
      const der = l.slice(i + 1);
      const relleno = Math.max(1, ancho - izq.length - der.length);
      return izq + ' '.repeat(relleno) + der;
    })
    .join('\n');
}
