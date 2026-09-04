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