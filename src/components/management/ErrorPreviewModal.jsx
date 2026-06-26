import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';

export default function ErrorPreviewModal({ isOpen, errors, validCount, onClose, onCancel, onImportValid }) {
  const errorRowsCount = new Set(errors.map(e => e.rowNumber)).size;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <AlertCircle className="w-6 h-6 text-destructive" />
            Errores de Validación de Importación
          </DialogTitle>
        </DialogHeader>

        <div className="bg-destructive/10 border border-destructive/20 text-destructive-foreground px-4 py-3 rounded-lg flex items-start gap-3 mt-2 shadow-sm">
          <XCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-destructive">Se encontraron {errorRowsCount} fila(s) con errores:</p>
            <p className="text-sm opacity-90">Estas filas no se pueden importar hasta que se corrijan los valores indicados.</p>
          </div>
        </div>

        {validCount > 0 && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center gap-2 shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
            <span className="font-medium text-sm">{validCount} fila(s) válida(s) lista(s) para importar.</span>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-[250px] border rounded-md mt-4 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/80 sticky top-0 backdrop-blur-sm z-10 border-b">
              <tr>
                <th className="p-3 text-left font-semibold w-16">Fila</th>
                <th className="p-3 text-left font-semibold w-32">Columna</th>
                <th className="p-3 text-left font-semibold w-48">Valor Inválido</th>
                <th className="p-3 text-left font-semibold">Descripción del Error</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((err, i) => (
                <tr key={i} className="border-b border-muted/50 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium text-center text-muted-foreground">{err.rowNumber}</td>
                  <td className="p-3 font-mono text-xs font-semibold">{err.column}</td>
                  <td className="p-3 text-destructive font-medium truncate max-w-[180px]" title={String(err.value)}>
                    {err.value !== undefined && err.value !== null && err.value !== '' ? (
                      <span className="bg-destructive/10 px-1.5 py-0.5 rounded text-destructive">{String(err.value)}</span>
                    ) : (
                      <em className="text-muted-foreground opacity-70">Vacío</em>
                    )}
                  </td>
                  <td className="p-3 text-destructive/90">{err.errorMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>

        <DialogFooter className="mt-6 flex flex-col sm:flex-row sm:justify-between gap-3">
          <Button variant="outline" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            Cancelar importación
          </Button>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="secondary" onClick={onClose} className="border-primary/20 text-primary hover:bg-primary/10 transition-colors">
              Corregir archivo y volver a subir
            </Button>
            {validCount > 0 && (
              <Button onClick={onImportValid} className="bg-green-600 hover:bg-green-700 text-white shadow-sm transition-colors">
                Importar solo filas válidas
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}