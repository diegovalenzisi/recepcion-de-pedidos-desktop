// ---------------------------------------------------------------------------
// Armado del HTML del TICKET DE MOSTRADOR (comprobante que recibe el cliente).
//
// Está separado de counterTicket.js —que sólo resuelve settings, QR y el envío a
// la impresora— para que esta salida real pueda ejercitarse en pruebas sin
// React ni Electron. counterTicket.js NO duplica este armado: lo importa.
//
// Solo lectura: usa exclusivamente el snapshot del pedido. No consulta catálogo,
// no toca stock, no escribe en Firebase, no muta el pedido recibido.
// ---------------------------------------------------------------------------

import { construirDetalleImpresionPedido, lineasDeItem, formatImporteTicket } from './orderPrintDetail.js';

/** Escape mínimo para nombres provenientes de datos (evita romper el HTML). */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Etiqueta "— UNIDAD n DE m" solo cuando la línea es una de varias unidades. */
export function etiquetaUnidadItem(item) {
  const ui = Number(item && item.unidadIndice);
  const ut = Number(item && item.unidadTotal);
  return (Number.isFinite(ui) && ut > 1) ? ` — UNIDAD ${ui} DE ${ut}` : '';
}

/** Convierte las líneas "izquierda|importe" del detalle en filas del ticket. */
function detalleHtmlDeItem(item) {
  return lineasDeItem(item, { formatImporte: formatImporteTicket })
    .slice(1) // el título ya se imprime como nombre del ítem
    .map((l) => {
      const i = l.indexOf('|');
      if (i === -1) return `<div class="opt-line"><span>${esc(l)}</span></div>`;
      return `<div class="opt-line"><span>${esc(l.slice(0, i))}</span>`
        + `<span class="opt-amount">${esc(l.slice(i + 1))}</span></div>`;
    })
    .join('');
}

/**
 * Cuerpo del ticket (ítems + total). Función real usada por printCounterTicket.
 * @returns {{ itemsHtml: string, totalHtml: string, total: number|null }}
 */
export function buildCounterTicketBody(sale) {
  const items = Array.isArray(sale && sale.items) ? sale.items : [];
  const detalle = construirDetalleImpresionPedido(sale, { formatImporte: formatImporteTicket });

  const itemsHtml = items.map((item) => `
      <tr>
        <td style="text-align: left; vertical-align: top; padding-right: 8px;">${Number(item.quantity) || 1}x</td>
        <td style="text-align: left; vertical-align: top;">
          <div class="item-name">${esc(String(item.nombre || '').toUpperCase())}${etiquetaUnidadItem(item)}</div>
          ${detalleHtmlDeItem(item)}
        </td>
      </tr>
    `).join('');

  const totalHtml = detalle.total !== null
    ? `<div class="ticket-total"><span>TOTAL</span><span>${formatImporteTicket(detalle.total)}</span></div>`
    : '';

  return { itemsHtml, totalHtml, total: detalle.total };
}

/** CSS del detalle económico (80mm: importe a la derecha, sin desbordes). */
export const COUNTER_TICKET_DETAIL_CSS = `
          .opt-line { display: flex; justify-content: space-between; gap: 6px; font-size: 0.85em; }
          .opt-amount { white-space: nowrap; }
          .ticket-total {
            display: flex; justify-content: space-between; gap: 6px;
            border-top: 2px dashed black; margin-top: 6px; padding-top: 4px; font-size: 1.3em;
          }`;
