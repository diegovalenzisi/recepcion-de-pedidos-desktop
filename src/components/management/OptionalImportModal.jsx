import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Upload, AlertCircle, CheckCircle2, Loader2, FileSpreadsheet } from 'lucide-react';
import { parseOptionalsExcel, formatOptionalForFirebase } from '@/lib/export/OptionalImportExportUtils';
import { saveData } from '@/lib/api/managementApi';
import { Progress } from '@/components/ui/progress';

export default function OptionalImportModal({ isOpen, onClose, groups, existingOptionals, onSuccess }) {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [validationResult, setValidationResult] = useState(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const fileInputRef = useRef(null);
  const { toast } = useToast();

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.xlsx')) {
      toast({
        variant: "destructive",
        title: "Archivo inválido",
        description: "Por favor seleccione un archivo Excel (.xlsx)"
      });
      return;
    }

    setFile(selectedFile);
    setIsProcessing(true);
    setValidationResult(null);

    try {
      const result = await parseOptionalsExcel(selectedFile, groups);
      setValidationResult(result);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo procesar el archivo."
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!validationResult || validationResult.validRows.length === 0) return;

    setIsImporting(true);
    setProgress(0);
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    const total = validationResult.validRows.length;
    console.log("Iniciando importación. Total a procesar:", total);

    try {
      for (let i = 0; i < total; i++) {
        const row = validationResult.validRows[i];
        const existingItem = existingOptionals.find(opt => String(opt.codigo) === String(row.codigo));

        if (existingItem && !updateExisting) {
          skippedCount++;
          setProgress(((i + 1) / total) * 100);
          continue;
        }

        const formattedData = formatOptionalForFirebase(row);
        
        if (existingItem) {
          formattedData.id = existingItem.id;
        }

        try {
          console.log(`Intentando guardar opcional ${formattedData.codigo}:`, formattedData);
          const response = await saveData('opcionales', formattedData, !!existingItem, { opcionales: existingOptionals });
          console.log(`Respuesta de Firebase para ${formattedData.codigo}:`, response);
          successCount++;
        } catch (saveError) {
          console.error(`Error guardando opcional ${formattedData.codigo}:`, saveError);
          errorCount++;
        }
        
        setProgress(((i + 1) / total) * 100);
      }

      if (errorCount > 0) {
        toast({
          variant: "destructive",
          title: "Importación Parcial",
          description: `${successCount} importados. ${errorCount} fallaron. ${skippedCount} omitidos. Revisa la consola para más detalles.`
        });
      } else {
        toast({
          title: "Importación Completada",
          description: `${successCount} opcionales importados/actualizados correctamente. ${skippedCount > 0 ? `(${skippedCount} omitidos)` : ''}`,
          className: "bg-green-500 text-white"
        });
      }
      
      if (onSuccess) onSuccess();
      handleClose();
    } catch (error) {
      console.error("Error general durante la importación:", error);
      toast({
        variant: "destructive",
        title: "Error de importación",
        description: "Ocurrió un error crítico durante la importación. Se detuvo el proceso."
      });
    } finally {
      setIsImporting(false);
      setProgress(0);
    }
  };

  const handleClose = () => {
    setFile(null);
    setValidationResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const hasErrors = validationResult?.invalidRows?.length > 0 || validationResult?.globalError;
  const canImport = validationResult?.validRows?.length > 0 && !isImporting;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isImporting && !open && handleClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            Importar Opcionales
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 space-y-6 py-4">
          <div className="space-y-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <Label htmlFor="excel-file">Archivo Excel (.xlsx)</Label>
              <Input 
                id="excel-file" 
                type="file" 
                accept=".xlsx"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isProcessing || isImporting}
              />
            </div>
            
            <div className="flex items-center space-x-2 border p-3 rounded-lg bg-slate-50">
              <Switch 
                id="update-existing" 
                checked={updateExisting} 
                onCheckedChange={setUpdateExisting}
                disabled={isImporting}
              />
              <Label htmlFor="update-existing" className="cursor-pointer flex-1">
                Actualizar existentes
                <span className="block text-xs text-slate-500 font-normal mt-0.5">
                  Si un código ya existe, actualizará sus datos. Si se desactiva, los omitirá.
                </span>
              </Label>
            </div>
          </div>

          {isProcessing && (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p>Procesando archivo...</p>
            </div>
          )}

          {validationResult && !isProcessing && (
            <div className="space-y-4 animate-in fade-in">
              {validationResult.globalError ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 flex gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{validationResult.globalError}</p>
                </div>
              ) : (
                <>
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3 text-green-800">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-semibold">{validationResult.validRows.length} filas válidas listas para importar</span>
                    </div>
                  </div>

                  {validationResult.invalidRows.length > 0 && (
                    <div className="border border-red-200 rounded-lg overflow-hidden">
                      <div className="bg-red-50 px-4 py-2 font-semibold text-red-800 border-b border-red-200 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {validationResult.invalidRows.length} filas con errores (se omitirán)
                      </div>
                      <div className="max-h-[200px] overflow-y-auto bg-white p-4 space-y-3">
                        {validationResult.invalidRows.map((invalid, idx) => (
                          <div key={idx} className="text-sm">
                            <span className="font-semibold text-slate-700">Fila {invalid.data.rowNumber}:</span>
                            <ul className="list-disc pl-5 text-red-600 mt-1">
                              {invalid.errors.map((err, errIdx) => (
                                <li key={errIdx}>{err}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {isImporting && (
            <div className="space-y-2 py-4">
              <div className="flex justify-between text-sm font-medium">
                <span>Importando datos...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={handleClose} disabled={isImporting}>
            Cancelar
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={!canImport}
            className="bg-green-600 hover:bg-green-700 text-white gap-2"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isImporting ? 'Importando...' : 'Iniciar Importación'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}