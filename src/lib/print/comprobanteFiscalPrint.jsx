// ---------------------------------------------------------------------------
// IMPRESIÓN DEL COMPROBANTE FISCAL DEFINITIVO
//
// Imprime una factura YA EMITIDA, con todos sus datos fiscales: razón social,
// nombre de fantasía, CUIT, condición frente al IVA, domicilio, letra y tipo de
// comprobante, punto de venta, número, fecha y hora, productos, total, forma de
// pago, CAE, vencimiento del CAE y QR oficial de ARCA.
//
// NO es el ticket de mostrador (`printCounterTicket`), que no lleva ningún dato
// fiscal: usarlo para una factura entregaría al cliente un comprobante sin CAE.
//
// El registro crudo de /{localId}/VENTAS se normaliza con comprobanteFiscal.js
// —el mismo módulo que usa la reimpresión desde Ventas—, así que la letra, el
// emisor y el QR salen resueltos por la misma cascada y no se inventa nada.
// `validarComprobanteFiscal` rechaza imprimir un comprobante incompleto.
// ---------------------------------------------------------------------------

import React from 'react';
import { renderToString } from 'react-dom/server';
import ReceiptDocument from '@/components/sales/ReceiptDocument';
import { normalizarComprobante, validarComprobanteFiscal } from '@/lib/api/comprobanteFiscal';
import { leerConfigFiscal } from '@/lib/api/colasFiscalesApi';
import { cachedPrintSettings } from '@/lib/print/settings';

/**
 * Estilos TÉRMICOS de 80 mm para la impresión DIRECTA.
 *
 * Diferencias con los de la ventana de vista previa, todas deliberadas:
 *   · `@page { size: 80mm auto; margin: 0 }` — el alto lo define el contenido,
 *     así no sale una hoja en blanco al final ni se corta el pie;
 *   · sin `max-width` en píxeles ni padding de 20 px: el ancho útil es el del
 *     rollo, con un margen mínimo para que no se coma el borde;
 *   · la fuente NO se trae de Google Fonts: la ventana de impresión es oculta y
 *     no puede quedarse esperando una descarga que quizá no llegue. Se usa la
 *     monoespaciada del sistema, que es lo que la térmica imprime igual.
 *   · el QR se limita en ancho para que entre completo en los 80 mm.
 */
// Recibe el offset en mm (cachedPrintSettings.printFiscalHorizontalOffset, leído
// EN EL MOMENTO de imprimir, no al importar el módulo — cachedPrintSettings se
// rellena async después del import, así que una constante de nivel de módulo
// habría quedado congelada en 0). Mismo mecanismo que ya usan command.js y
// counterTicket.js para su propio corrector (`margin-left` en mm), pero con su
// propia clave: este offset NUNCA debe mezclarse con el de comandas.
const estilosTermicos80mm = (offsetMm = 0) => `
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Roboto Mono', 'Consolas', 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.25;
    width: 80mm;
    margin-left: ${offsetMm}mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt { width: 100%; box-sizing: border-box; padding: 2mm 3mm 6mm; margin: 0; }
  .header { text-align: center; margin-bottom: 8px; }
  .header h1 { margin: 0; font-size: 1.15em; }
  .header .letra { margin: 4px 0 2px; font-size: 1.6em; font-weight: 700; }
  .header h2 { margin: 2px 0; font-size: 0.95em; }
  .details, .items, .totals { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .details td, .items td, .totals td { padding: 1px 0; vertical-align: top; }
  .details td:first-child { white-space: nowrap; padding-right: 6px; }
  .items th { text-align: left; border-bottom: 1px dashed #000; padding: 2px 0; font-size: 0.85em; }
  .totals { text-align: right; }
  .item-row td { vertical-align: top; }
  .qty { text-align: right; padding-right: 6px; }
  .price { text-align: right; white-space: nowrap; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .footer { text-align: center; font-size: 0.8em; }
  /* El QR de ARCA entero: nunca más ancho que el rollo. */
  img { max-width: 34mm; height: auto; display: block; margin: 4px auto; }
  /* Nada puede desbordar los 80 mm y provocar una segunda página. */
  * { max-width: 100%; word-wrap: break-word; overflow-wrap: break-word; }
`;

const estilosPreview = (offsetMm = 0) => `
  @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap');
  body { font-family: 'Roboto Mono', monospace; margin: 0; margin-left: ${offsetMm}mm; padding: 20px; }
  .receipt { max-width: 300px; margin: auto; }
  .header { text-align: center; margin-bottom: 20px; }
  .header h1 { margin: 0; font-size: 1.2em; }
  .header .letra { margin: 6px 0 2px; }
  .header h2 { margin: 2px 0; font-size: 1em; }
  .details, .items, .totals { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .details td, .items td, .totals td { padding: 4px 0; }
  .details td:first-child { white-space: nowrap; padding-right: 8px; }
  .items th { text-align: left; border-bottom: 1px dashed #000; padding: 4px 0; font-size: 0.85em; }
  .totals { text-align: right; }
  .item-row td { vertical-align: top; }
  .qty { text-align: right; padding-right: 10px; }
  .price { text-align: right; }
  hr { border: none; border-top: 1px dashed #000; margin: 10px 0; }
`;

/**
 * Imprime el comprobante fiscal de una factura emitida.
 *
 * @param {string} clave     clave del registro (FCB…/FCC…)
 * @param {object} registro  registro tal cual quedó en /{localId}/VENTAS
 * @returns {Promise<{ok: boolean, motivo?: string, faltantes?: string[]}>}
 *   Nunca lanza: la venta ya está guardada y un problema de impresión no puede
 *   tumbar el flujo. El resultado permite avisar al cajero.
 */
export async function imprimirComprobanteFiscal(clave, registro) {
  try {
    const config = await leerConfigFiscal();
    const comprobante = normalizarComprobante(clave, registro, { config });

    // Un comprobante incompleto NO se imprime: es preferible avisar que
    // entregar un papel al que le falten datos obligatorios.
    const validacion = validarComprobanteFiscal(comprobante);
    if (!validacion.valido) {
      return { ok: false, motivo: 'comprobante-incompleto', faltantes: validacion.problemas };
    }
    if (validacion.avisos.length > 0) {
      console.warn('[factura mostrador] avisos del comprobante:', validacion.avisos);
    }

    const ventana = window.open('', '_blank', 'width=800,height=600');
    if (!ventana) return { ok: false, motivo: 'ventana-bloqueada' };

    const html = renderToString(<ReceiptDocument sale={comprobante} />);
    ventana.document.write(
      `<html><head><title>Comprobante ${comprobante.numeroCompleto || clave}</title>`
      + `<style>${estilosPreview(cachedPrintSettings.printFiscalHorizontalOffset || 0)}</style></head><body>${html}</body></html>`,
    );
    ventana.document.close();
    ventana.focus();
    ventana.print();
    return { ok: true, numero: comprobante.numeroCompleto || clave };
  } catch (e) {
    console.error('[factura mostrador] no se pudo imprimir el comprobante fiscal:', e);
    return { ok: false, motivo: e?.message || String(e) };
  }
}

/**
 * IMPRESIÓN DIRECTA de una factura ya emitida, sin visor y sin diálogo.
 *
 * Reutiliza EXACTAMENTE el mismo camino que las comandas:
 * `window.electron.printDirect` → IPC `print-direct` → BrowserWindow oculta con
 * `webContents.print({ silent: true, printBackground: true })`. No se crea otro
 * sistema de impresión ni se fija ninguna impresora por código: si no hay un
 * nombre configurado, Windows usa la PREDETERMINADA.
 *
 * El contenido es el MISMO `ReceiptDocument` que ya se usa para ver y reimprimir
 * —misma normalización fiscal, mismo emisor, mismo QR de ARCA—, sólo que con la
 * hoja de estilos térmica de 80 mm.
 *
 * Recibe el comprobante YA NORMALIZADO — que es exactamente lo que devuelve
 * `fetchBillingData` y lo que la tabla de Facturación tiene en cada fila. No se
 * vuelve a normalizar: hacerlo dos veces sobre el mismo objeto no es lo que el
 * módulo fiscal espera.
 *
 * @param {object} comprobante  comprobante normalizado (normalizarComprobante)
 * @returns {Promise<{ok: boolean, numero?: string, motivo?: string, faltantes?: string[]}>}
 *   Nunca lanza: devuelve el motivo para que la pantalla avise sin romperse.
 */
export async function imprimirFacturaDirecto(comprobante) {
  try {
    if (!comprobante || typeof comprobante !== 'object') {
      return { ok: false, motivo: 'sin-comprobante' };
    }
    const clave = comprobante.id || comprobante.numeroCompleto || comprobante.numeroFactura;

    // Un comprobante incompleto NO se imprime: mejor avisar que entregar un
    // papel sin CAE o sin datos del emisor.
    const validacion = validarComprobanteFiscal(comprobante);
    if (!validacion.valido) {
      return { ok: false, motivo: 'comprobante-incompleto', faltantes: validacion.problemas };
    }
    if (validacion.avisos.length > 0) {
      console.warn('[factura] avisos del comprobante:', validacion.avisos);
    }

    const cuerpo = renderToString(<ReceiptDocument sale={comprobante} />);
    const html =
      `<!DOCTYPE html><html><head><meta charset="utf-8">`
      + `<title>${comprobante.numeroCompleto || clave}</title>`
      + `<style>${estilosTermicos80mm(cachedPrintSettings.printFiscalHorizontalOffset || 0)}</style></head><body>${cuerpo}</body></html>`;

    if (!(typeof window !== 'undefined' && window.electron && window.electron.printDirect)) {
      // Fuera de Electron no hay impresión silenciosa posible.
      return { ok: false, motivo: 'sin-electron' };
    }

    // printerName vacío ⇒ impresora PREDETERMINADA de Windows.
    const printerName = cachedPrintSettings.printerName || '';
    // scaleFactor (50-100): escala TODO el comprobante como una sola unidad
    // (texto, QR, márgenes) vía webContents.print — no es un ancho de CSS.
    // Ausente/100 = tamaño actual, sin cambios. Exclusivo del ticket fiscal:
    // no se manda en ningún otro llamado a printDirect (comandas, mostrador).
    const r = await window.electron.printDirect(html, printerName, {
      density: cachedPrintSettings.printTone,
      copies: 1,
      scaleFactor: cachedPrintSettings.printFiscalScale || 100,
    });

    if (r && r.success === false) {
      return { ok: false, motivo: r.closed ? 'ventana-cerrada' : 'rechazado' };
    }

    console.log(`[FACTURA] impresa directo: ${comprobante.numeroCompleto || clave}`
      + ` (impresora: ${printerName || 'predeterminada de Windows'})`);
    return { ok: true, numero: comprobante.numeroCompleto || clave };
  } catch (e) {
    // El motivo REAL va al log; la pantalla muestra el mensaje para el usuario.
    console.error('[FACTURA] no se pudo imprimir directo:', e);
    return { ok: false, motivo: e?.message || String(e) };
  }
}
