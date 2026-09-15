import { reloadPrintSettings, cachedPrintSettings } from './settings';
import { printElectron } from './electronPrint';
import { getBusinessNameUppercase } from '@/lib/businessNameUtils';
import { medidasDePapel, cssExtraAngosto } from './paper';

const formatMoney = (n) => `$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)}`;

/**
 * Ticket de RETIRO DE EFECTIVO — mismo mecanismo de impresión térmica (80/58 mm)
 * que ya usa el ticket de Caja Fuerte (printSafeTicket). A propósito NO muestra
 * saldo de Caja Fuerte antes/después: este comprobante es solo la constancia de
 * qué tiradas quedaron comprendidas en el retiro, nunca modifica Caja Fuerte.
 *
 * @param {object} ticketData
 * @param {number} ticketData.retiroId
 * @param {string} ticketData.fecha           dd-MM-yyyy
 * @param {string} ticketData.hora            HH:mm:ss
 * @param {string} ticketData.responsableNombre
 * @param {string} ticketData.responsableRol
 * @param {Array<{fecha:string, hora:string, entryId:string|number, turnoId:string|number, valor:number}>} ticketData.tiradas
 * @param {number} ticketData.cantidad
 * @param {number} ticketData.total
 */
export const printRetiroTicket = async (ticketData) => {
    await reloadPrintSettings();
    const settings = cachedPrintSettings;
    const { fecha, hora, responsableNombre, responsableRol, tiradas = [], cantidad, total } = ticketData;

    const businessName = getBusinessNameUppercase();
    const papel = medidasDePapel(settings.printPaperWidth);
    const px = (n) => Math.round(n * papel.escala);
    const dottedLines = Array(12).fill('<div class="dot-line">.</div>').join('');

    const tiradasHtml = tiradas.map((t) => `
                <div class="tirada-block">
                    <div class="ticket-item">${t.fecha} ${t.hora}</div>
                    <div class="ticket-item">Tirada #${t.entryId}</div>
                    <div class="ticket-item">Turno #${t.turnoId}</div>
                    <div class="ticket-item value">${formatMoney(t.valor)}</div>
                </div>
    `).join('');

    const content = `
        <html>
            <head>
                <title>Comprobante Retiro de Efectivo</title>
                <style>
                    @media print { @page { size: ${papel.anchoMm}mm auto; margin: 0; } }
                    body {
                        font-family: ${settings.printFontFamily}, sans-serif;
                        width: ${papel.anchoMm}mm;
                        box-sizing: border-box;
                        margin: 0;
                        margin-left: ${settings.printHorizontalOffset || 0}mm;
                        padding: ${papel.anchoMm === 80 ? 5 : 3}mm;
                        color: black !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        font-weight: bold;
                    }
                    * { font-weight: bold !important; color: black !important; }
                    .ticket-header {
                        text-align: center;
                        font-size: ${px(24)}px;
                        margin-bottom: 4px;
                        text-transform: uppercase;
                    }
                    .ticket-subheader {
                        text-align: center;
                        font-size: ${px(20)}px;
                        margin-bottom: 10px;
                        text-transform: uppercase;
                    }
                    .ticket-item {
                        font-size: ${px(18)}px;
                        line-height: 1.2;
                        margin: 3px 0;
                        text-transform: uppercase;
                    }
                    .value { font-size: ${px(20)}px; }
                    .separator {
                        border-top: 1px dashed black;
                        margin: 8px 0;
                    }
                    .tiradas-title {
                        text-align: center;
                        font-size: ${px(18)}px;
                        margin: 4px 0;
                        text-transform: uppercase;
                    }
                    .tirada-block {
                        margin: 6px 0;
                        padding-bottom: 4px;
                        border-bottom: 1px dotted #666;
                    }
                    .totales {
                        margin-top: 8px;
                        font-size: ${px(20)}px;
                        text-transform: uppercase;
                    }
                    .signature-line {
                        margin-top: 20px;
                        font-size: ${px(16)}px;
                        text-align: center;
                    }
                    .ticket-footer {
                        text-align: center;
                        font-size: ${px(16)}px;
                        margin-top: 10px;
                        text-transform: uppercase;
                    }
                    .dot-line {
                        text-align: center;
                        line-height: 0.5;
                        font-size: ${px(20)}px;
                    }
                    .footer-container { margin-top: 20px; }${cssExtraAngosto(settings.printPaperWidth)}
                </style>
            </head>
            <body>
                ${dottedLines}
                <div class="ticket-header">${businessName}</div>
                <div class="ticket-subheader">Retiro de Efectivo</div>
                <div class="ticket-item">Fecha: ${fecha}</div>
                <div class="ticket-item">Hora: ${hora}</div>
                <div class="ticket-item">Responsable: ${responsableNombre}</div>
                <div class="ticket-item">Rol: ${responsableRol}</div>

                <div class="separator"></div>
                <div class="tiradas-title">Tiradas Incluidas</div>
                ${tiradasHtml}
                <div class="separator"></div>

                <div class="totales">Cantidad de Tiradas: ${cantidad}</div>
                <div class="totales">Total Retirado: ${formatMoney(total)}</div>

                <div class="footer-container">
                    <div class="signature-line">Responsable:</div>
                    <div class="signature-line">${responsableNombre}</div>
                    <div class="signature-line">${responsableRol}</div>
                </div>
                ${dottedLines}
            </body>
        </html>
    `;
    await printElectron(content, { height: 'auto' });
};
