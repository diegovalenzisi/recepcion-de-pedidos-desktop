import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const LocalNewManager = () => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleConfirm = async () => {
    setShowConfirm(false);
    setLoading(true);
    try {
      await window.electronAPI?.localResetForNew?.();
      // Si llega aquí, la app no reinició (no debería pasar)
      toast({ title: 'Reiniciando...', description: 'La aplicación se está reiniciando.' });
    } catch (e) {
      console.error('[LOCAL NUEVO] Error:', e);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo completar el reseteo. Revisá los logs.',
      });
      setLoading(false);
    }
  };

  return (
    <>
      <Card className="border-orange-200 bg-orange-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-orange-800 flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Local nuevo
          </CardTitle>
          <CardDescription className="text-orange-700">
            Prepara esta PC para configurar un local diferente. Borra la configuración local de Mercado Pago, Facturación AFIP e ID de local. <strong>No borra datos de Firebase.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="border-orange-400 text-orange-700 hover:bg-orange-100"
            onClick={() => setShowConfirm(true)}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Local nuevo
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Configurar local nuevo?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Esto borrará de esta PC la configuración local de Mercado Pago, Facturación AFIP y número de local para permitir configurar un local nuevo.
              </span>
              <span className="block font-semibold text-foreground">
                No se borrarán datos de Firebase.
              </span>
              <span className="block text-sm">
                Se borrarán: mp-accounts.json, backend.env, serviceAccountKey.json, facturacion-config.json, certificados y carpetas AFIP locales.
              </span>
              <span className="block text-sm font-semibold text-foreground">
                ¿Deseás continuar?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default LocalNewManager;
