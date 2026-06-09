import { cachedPrintSettings } from './settings';

export const printElectron = async (htmlContent, options = {}) => {
    if (window && window.electron) {
        try {
            const printerName = cachedPrintSettings.printerName;
            const printOptions = {
                ...options,
                density: cachedPrintSettings.printTone,
            };
            await window.electron.printDirect(htmlContent, printerName, printOptions);
        } catch (error) {
            console.error('Electron printing failed:', error);
            alert('Error al imprimir directamente. Revise la consola para más detalles.');
        }
    } else {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Por favor, permita las ventanas emergentes para imprimir.');
            return;
        }
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.onload = () => {
            printWindow.print();
            setTimeout(() => printWindow.close(), 100);
        };
    }
};