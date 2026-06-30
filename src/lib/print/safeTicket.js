import { reloadPrintSettings, cachedPrintSettings } from './settings';
import { printElectron } from './electronPrint';
import { getLocalId } from '@/lib/firebase/core';
import { getBusinessNameUppercase } from '@/lib/businessNameUtils';

export const printSafeTicket = async (ticketData) => {
    await reloadPrintSettings();
    const settings = cachedPrintSettings;
    const { drawNumber, date, time, shiftId, responsible, value } = ticketData;

    const localId = getLocalId();
    let branchName = '';
    if (localId === '51501748') {
        branchName = 'Centenario';
    } else if (localId === '40508022') {
        branchName = 'Achaval';
    } else if (localId === '38827976') {
        branchName = 'Temperley';
    } else if (localId === '12345678') {
        branchName = 'Prueba';
    } else if (localId === '31915636') {
        branchName = 'JLS 2026';
    }
    
    const branchHtml = branchName ? `<div class="ticket-item">Sucursal: ${branchName.toUpperCase()}</div>` : '';
    const dottedLines = Array(12).fill('<div class="dot-line">.</div>').join('');
    
    // Get location-specific business name
    const businessName = getBusinessNameUppercase();

    const content = `
        <html>
            <head>
                <title>Comprobante Caja Fuerte</title>
                <style>
                    @media print { @page { size: 80mm auto; margin: 0; } }
                    body {
                        font-family: ${settings.printFontFamily}, sans-serif;
                        width: 80mm;
                        box-sizing: border-box;
                        margin: 0;
                        margin-left: ${settings.printHorizontalOffset || 0}mm;
                        padding: 5mm;
                        color: black !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        font-weight: bold;
                    }
                    * { font-weight: bold !important; color: black !important; }
                    .ticket-header {
                        text-align: center;
                        font-size: 24px;
                        margin-bottom: 10px;
                        text-transform: uppercase;
                    }
                    .ticket-item {
                        font-size: 20px;
                        line-height: 1.2;
                        margin: 5px 0;
                        text-transform: uppercase;
                    }
                    .value {
                        font-size: 24px;
                    }
                    .signature-line {
                        margin-top: 20px;
                        font-size: 18px;
                        text-align: center;
                    }
                    .ticket-footer {
                        text-align: center;
                        font-size: 16px;
                        margin-top: 10px;
                        text-transform: uppercase;
                    }
                    .dot-line {
                        text-align: center;
                        line-height: 0.5;
                        font-size: 20px;
                    }
                    .footer-container {
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                ${dottedLines}
                <div class="ticket-header">${businessName}</div>
                <div class="ticket-item">Tirada: ${drawNumber}</div>
                <div class="ticket-item">Fecha: ${date}</div>
                <div class="ticket-item">Hora: ${time}</div>
                ${branchHtml}
                <div class="ticket-item">Turno: ${shiftId}</div>
                <div class="ticket-item">Responsable: ${responsible}</div>
                <div class="ticket-item value">Valor: $${new Intl.NumberFormat('es-AR').format(value)}</div>
                
                <div class="footer-container">
                    <div class="signature-line">FIRMA:....................................</div>
                    <br>
                    <br>
                    <div class="ticket-footer">RECUERDE TIRAR EN CAJA FUERTE</div>
                </div>
                ${dottedLines}
            </body>
        </html>
    `;
    await printElectron(content, { height: 'auto' });
};