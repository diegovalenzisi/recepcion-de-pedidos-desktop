import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { exportOptionalsToExcel } from '@/lib/export/OptionalImportExportUtils';
import { useToast } from '@/components/ui/use-toast';

export default function OptionalExportButton({ optionals, groups }) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    try {
      setIsExporting(true);
      exportOptionalsToExcel(optionals || [], groups || []);
      toast({
        title: "Exportación Exitosa",
        description: "El archivo Excel ha sido descargado.",
        className: "bg-green-500 text-white"
      });
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error al exportar",
        description: "Hubo un problema al generar el archivo."
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button 
      variant="outline" 
      onClick={handleExport} 
      disabled={isExporting || !optionals?.length}
      className="gap-2"
    >
      {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      Exportar
    </Button>
  );
}