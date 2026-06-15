import { cachedPrintSettings } from './settings';
import { toast } from '@/components/ui/use-toast';

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
            toast({
                variant: "destructive",
                title: "No se pudo imprimir",
                description: "Falló la impresión directa (conexión local/impresora). El pedido se guardó igual.",
            });
        }
    } else {
        try {
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                toast({
                    variant: "destructive",
                    title: "Ventana de impresión bloqueada",
                    description: "Permita las ventanas emergentes para poder imprimir.",
                });
                return;
            }
            printWindow.document.write(htmlContent);
            printWindow.document.close();
            printWindow.onload = () => {
                printWindow.print();
                setTimeout(() => printWindow.close(), 100);
            };
        } catch (error) {
            console.error('Browser printing failed:', error);
            toast({
                variant: "destructive",
                title: "No se pudo imprimir",
                description: "Ocurrió un error al abrir la ventana de impresión. El pedido se guardó igual.",
            });
        }
    }
};