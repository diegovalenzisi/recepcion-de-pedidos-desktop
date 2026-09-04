import React from 'react';
import { renderToString } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { reloadPrintSettings, cachedPrintSettings } from './settings';
import { printElectron } from './electronPrint';
import { generateOptionalsHtml } from './utils';
import { bloquesDeComanda } from './comandaModelo.js';
import { getBusinessNameUppercase } from '@/lib/businessNameUtils';
import { medidasDePapel, cssExtraAngosto } from './paper';

export const printCommand = async (order, optionalGroups = []) => {
  await reloadPrintSettings();

  const orderDate = order.date || '';
  const settings = cachedPrintSettings;

  let itemsHtml = '';
  let totalItems = 0;

  // UNIDADES: cada unidad configurada se guarda como su propia línea, tanto si
  // el pedido se cargó a mano como si llegó de DLV Pedidos. Cada una se imprime
  // como un BLOQUE independiente —nombre del artículo repetido y su propia
  // selección— separado del anterior. NO se numeran las unidades.
  bloquesDeComanda(order.items).forEach(({ item, cantidad }, indice) => {
    const quantity = cantidad;
    totalItems += quantity;

    // Separación entre bloques: espacio amplio para que en el papel se lea
    // claramente dónde termina una unidad y empieza la siguiente.
    if (indice > 0) {
      itemsHtml += '<tr><td colspan="2" class="item-separator"></td></tr>';
    }

    let subItemsHtml = '';
    if (item.promoItems && item.promoItems.length > 0) {
        subItemsHtml += '<div class="promo-sub-items">';
        item.promoItems.forEach(promoItem => {
            const optionalsForSubItem = generateOptionalsHtml(promoItem.selectedOptionals, optionalGroups);
            subItemsHtml += `
                <div class="promo-sub-item">
                    <div class="item-name-small">${promoItem.nombre}</div>
                    ${optionalsForSubItem}
                </div>
            `;
        });
        subItemsHtml += '</div>';
    } else {
        subItemsHtml = generateOptionalsHtml(item.selectedOptionals, optionalGroups);
    }
    
    // La COMANDA no lleva importes (diseño actual del sistema, ver auditoría en
    // orderPrintDetail.js) y NO numera las unidades: cada una es su propio
    // bloque y se distingue por la separación, no por un "UNIDAD 1 DE 2".
    const itemName = item.isPromo ? `PROMO ${item.nombre.toUpperCase()}` : item.nombre;

    itemsHtml += `
      <tr>
        <td style="text-align: left; vertical-align: top; padding-right: 8px;">${quantity}x</td>
        <td style="text-align: left; vertical-align: top;">
          <div class="item-name">${itemName}</div>
          ${subItemsHtml}
        </td>
      </tr>
    `;
  });
  
  let baseAddress = order.client.address || '';
  const e1 = order.client.entrecalle1;
  const e2 = order.client.entrecalle2;

  if (e1 && e2) {
      baseAddress += ` entre ${e1} y ${e2}`;
  } else if (e1) {
      baseAddress += ` entre ${e1}`;
  } else if (e2) {
      baseAddress += ` entre ${e2}`;
  }

  const clientAddress = `${baseAddress}${order.client.details ? `, ${order.client.details}`: ''}`;

  // Fallback for legacy entrecalles field if it exists but the new separate fields don't
  const legacyEntrecallesHtml = (order.client.entrecalles && !e1 && !e2)
    ? `<div class="section observation-section">
         <p><strong>ENTRECALLES / INSTRUCCIONES ESPECIALES:</strong></p>
         <p class="observation-text">${order.client.entrecalles}</p>
       </div>`
    : '';

  const observationHtml = order.observation 
    ? `<div class="section observation-section">
         <p><strong>Observación:</strong></p>
         <p class="observation-text">${order.observation}</p>
       </div>`
    : '';

  // Only show if manually scheduled (order.hora exists)
  const deliveryTime = order.hora;

  const deliveryTimeHtml = deliveryTime 
    ? `
      <div class="delivery-box">
        <span class="delivery-label">HORA ENTREGA</span>
        <span class="delivery-value">${deliveryTime}</span>
      </div>
      `
    : '';
    
  // Deposit and Payment Info
  let paymentInfoHtml = `
      <p class="total-label">Forma Pago: ${order.payment.method}</p>
      <p class="total-label">TOTAL: $${order.payment.amount.toFixed(2)}</p>
  `;

  if (order.payment.deposit && order.payment.deposit.amount > 0) {
      paymentInfoHtml += `
          <div style="border-top: 1px dotted black; margin-top: 5px; padding-top: 5px;">
              <p class="total-label">SEÑA (${order.payment.deposit.method}): $${order.payment.deposit.amount.toFixed(2)}</p>
              <p class="total-label" style="font-size: 1.3em;">RESTO A PAGAR: $${(order.payment.amount - order.payment.deposit.amount).toFixed(2)}</p>
          </div>
      `;
  } else {
      paymentInfoHtml += `
          <p class="total-label">PAGA CON: $${(order.payment.paysWith || 0).toFixed(2)}</p>
          <p class="total-label">VUELTO: $${(order.payment.change || 0).toFixed(2)}</p>
      `;
  }

  // Generate QR Code SVG String
  const qrElement = React.createElement(QRCodeSVG, { value: String(order.id), size: 120 });
  const qrSvg = renderToString(qrElement);
  
  // Get location-specific business name
  const businessName = getBusinessNameUppercase();

  // Medidas del rollo. Con 80 mm (el default) todo lo de abajo queda idéntico
  // a como estaba: 80mm de ancho, 3mm de padding y escala 1.
  const papel = medidasDePapel(settings.printPaperWidth);

  const content = `
    <html>
      <head>
        <title>Comanda Pedido #${order.id}</title>
        <style>
          @media print {
            @page {
              size: ${papel.anchoMm}mm auto;
              margin: 0;
            }
          }
          body {
            font-family: ${settings.printFontFamily}, sans-serif;
            width: ${papel.anchoMm}mm;
            box-sizing: border-box;
            font-size: ${Math.round(settings.printFontSize * papel.escala)}px;
            margin: 0;
            margin-left: ${settings.printHorizontalOffset || 0}mm;
            padding: ${papel.paddingMm}mm;
            color: black !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-weight: bold;
          }
          * {
            font-weight: bold !important;
            color: black !important;
          }
          .center { text-align: center; }
          .left-align { text-align: left; }
          .uppercase { text-transform: uppercase; }
          .header { margin-bottom: 5px; }
          .header .title { font-size: 1.4em; margin: 0; }
          .header .order-id { font-size: 1.3em; margin: 0; }
          .header .order-type { font-size: 1.2em; margin: 0; }
          .local-info p { margin: 1px 0; font-size: 0.8em; }
          .section { border-top: 2px dashed black; padding-top: 5px; margin-top: 5px; }
          .section p { margin: 2px 0; font-size: 0.9em; }
          .client-address { font-weight: bold; color: black !important; }
          .items-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
          .items-table td { padding: 2px 0; text-align: left; }
          .item-name { font-size: 1.1em; }
          /* Separación entre bloques: cada unidad configurada se lee aparte,
             sin necesidad de numerarla. */
          .item-separator {
            height: 10mm;
            border-bottom: 1px dotted black;
          }
          .totals p { margin: 2px 0; }
          .totals .total-label { font-size: 1.2em; }
          .observation-section { border-top: 2px solid black; }
          .observation-text { font-size: 1.1em; white-space: pre-wrap; word-wrap: break-word; }
          .optionals-container, .promo-sub-items {
            padding-left: 0;
            margin-top: 2px;
          }
          .promo-sub-item {
             margin-bottom: 5px;
          }
          .item-name-small {
            font-size: 1em;
          }
          .optional-group-name {
            text-transform: uppercase;
            margin-top: 3px;
          }
          .optional-item {
            text-align: left;
          }
          .delivery-box {
            border: 3px solid black;
            margin: 10px 0;
            padding: 5px 0;
            text-align: center;
          }
          .delivery-label {
            font-size: 1.1em;
            text-transform: uppercase;
            display: block;
          }
          .delivery-value {
            font-size: 1.8em;
            font-weight: 900;
            display: block;
            margin-top: 2px;
          }
          .qr-section {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px dashed black;
          }
          .qr-label {
            font-size: 1.1em;
            margin-top: 5px;
          }${cssExtraAngosto(settings.printPaperWidth)}
        </style>
      </head>
      <body>
        <div class="header center">
          <p class="title uppercase">Orden</p>
          <p class="order-id">#${order.id}</p>
          <p class="order-type uppercase">${order.type === 'ENVIO' ? 'DELIVERY' : (order.type || '').toUpperCase()}</p>
        </div>

        <div class="local-info center">
          <p>DOCUMENTO NO VALIDO COMO FACTURA</p>
          <p class="uppercase">${businessName}</p>
          <p class="uppercase">${settings.nombreFantasia}</p>
          <p>${settings.direccion}</p>
          <p>${settings.localidad}</p>
          <p>${settings.cuit}</p>
        </div>
        
        <div class="section">
          <p>Fecha Pedido: ${orderDate}</p>
          <p>Fecha Entrega: ${order.fechacaja || orderDate}</p>
          <p>Hora Ingreso: ${order.times.ingress}</p>
        </div>

        ${deliveryTimeHtml}

        <div class="section">
          <p>Cliente: ${order.client.name}</p>
          <p><span class="client-address">Direc.:</span> <span class="client-address">${clientAddress}</span></p>
          <p>Tel.: ${order.client.phone}</p>
        </div>
        
        ${legacyEntrecallesHtml}
        ${observationHtml}

        <div class="section">
          <table class="items-table">
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>
        
        <div class="section totals">
          <p>Items: ${totalItems}</p>
          ${paymentInfoHtml}
        </div>
        
        <div class="qr-section">
          ${qrSvg}
          <p class="qr-label">Orden: #${order.id}</p>
        </div>
      </body>
    </html>
  `;
  await printElectron(content);
};