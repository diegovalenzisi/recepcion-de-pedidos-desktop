import { fetchSettings } from '@/lib/api/settingsApi';
import { ANCHO_POR_DEFECTO, normalizarAncho } from './paper';

export let cachedPrintSettings = {
    printFontSize: 16,
    printFontFamily: 'sans-serif',
    razonSocial: '',
    nombreFantasia: 'HELADERIA',
    cuit: '',
    direccion: '',
    localidad: '',
    printerName: '',
    printTone: 5,
    printHorizontalOffset: 0,
    // Corrector INDEPENDIENTE del de arriba: solo lo lee comprobanteFiscalPrint.js
    // (ticket fiscal/factura térmica). Ausente (instalación vieja) = 0 = posición
    // actual, sin ningún desplazamiento nuevo.
    printFiscalHorizontalOffset: 0,
    // Escala SOLO del ticket fiscal (scaleFactor de webContents.print, ver
    // comprobanteFiscalPrint.jsx). Ausente (instalación vieja) = 100 = tamaño
    // actual, sin cambios. 50-100.
    printFiscalScale: 100,
    // Ancho del rollo térmico, en mm. Ausente o inválido = 80 = lo de siempre.
    printPaperWidth: ANCHO_POR_DEFECTO,
};

export const reloadPrintSettings = async () => {
    try {
        const settings = await fetchSettings();
        if (settings) {
            cachedPrintSettings = {
                ...cachedPrintSettings,
                ...settings,
                printFontSize: Math.max(16, Math.min(settings.printFontSize || 16, 40)),
                printFontFamily: settings.fuenteImpresion || 'sans-serif',
                printerName: settings.printerName || '',
                printTone: settings.printTone || 5,
                printHorizontalOffset: Math.max(-20, Math.min(settings.printHorizontalOffset ?? 0, 20)),
                printFiscalHorizontalOffset: Math.max(-20, Math.min(settings.printFiscalHorizontalOffset ?? 0, 20)),
                printFiscalScale: Math.max(50, Math.min(settings.printFiscalScale ?? 100, 100)),
                // `normalizarAncho` ya devuelve 80 ante ausente/inválido: un local
                // que nunca tocó esta opción imprime exactamente como antes.
                printPaperWidth: normalizarAncho(settings.printPaperWidth),
            };
        }
    } catch (error) {
        console.error("Could not load print settings, using defaults.", error);
    }
};

reloadPrintSettings();