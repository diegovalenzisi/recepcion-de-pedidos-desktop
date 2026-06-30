import { fetchSettings } from '@/lib/api/settingsApi';

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
            };
        }
    } catch (error) {
        console.error("Could not load print settings, using defaults.", error);
    }
};

reloadPrintSettings();