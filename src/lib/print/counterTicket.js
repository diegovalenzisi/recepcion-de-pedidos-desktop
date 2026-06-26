import React from 'react';
import { renderToString } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { reloadPrintSettings, cachedPrintSettings } from './settings';
import { printElectron } from './electronPrint';
import { getBusinessNameUppercase } from '@/lib/businessNameUtils';

export const printCounterTicket = async (sale) => {
  await reloadPrintSettings();
  const settings = cachedPrintSettings;

  let itemsHtml = '';
  sale.items.forEach(item => {
    itemsHtml += `
      <tr>
        <td style="text-align: left; vertical-align: top; padding-right: 8px;">${item.quantity}x</td>
        <td style="text-align: left; vertical-align: top;">
          <div class="item-name">${item.nombre.toUpperCase()}</div>
        </td>
      </tr>
    `;
  });

  // Generate QR Code SVG String
  const qrElement = React.createElement(QRCodeSVG, { value: String(sale.id), size: 130 });
  const qrSvg = renderToString(qrElement);
  
  // Get location-specific business name
  const businessName = getBusinessNameUppercase();

  const content = `
    <html>
      <head>
        <title>Comanda Mostrador #${sale.id}</title>
        <style>
          @media print { @page { size: 80mm auto; margin: 0; } }
          body { 
            font-family: ${settings.printFontFamily}, sans-serif; 
            width: 80mm; 
            box-sizing: border-box;
            font-size: ${settings.printFontSize}px;
            margin: 0;
            padding: 3mm;
            color: black !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-weight: bold;
          }
          * { font-weight: bold !important; color: black !important; }
          .center { text-align: center; }
          .uppercase { text-transform: uppercase; }
          .header { margin-bottom: 5px; }
          .header .business-name { font-size: 1.4em; margin: 5px 0; }
          .header .title { font-size: 1.6em; margin: 0; }
          .header .order-id { font-size: 1.5em; margin: 0; }
          .section { border-top: 2px dashed black; padding-top: 5px; margin-top: 5px; }
          .section p { margin: 2px 0; }
          .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
          .items-table td { padding: 2px 0; text-align: left; font-size: 1.2em; }
          .item-name { font-size: 1.1em; }
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
            font-size: 1.2em;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="header center">
          <p class="business-name uppercase">${businessName}</p>
          <p class="title uppercase">PARA RETIRAR</p>
          <p class="order-id">#${sale.id}</p>
        </div>
        <div class="section">
          <table class="items-table">
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>
        
        <div class="qr-section">
          ${qrSvg}
          <p class="qr-label">Pedido: #${sale.id}</p>
        </div>
      </body>
    </html>
  `;
  await printElectron(content);
};