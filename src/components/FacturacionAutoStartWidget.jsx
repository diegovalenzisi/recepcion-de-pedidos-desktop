import React, { useRef, useState } from 'react';
import { Receipt, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useFacturacionOwnership } from '@/hooks/useFacturacionOwnership';
import { useToast } from '@/components/ui/use-toast';
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

/**
 * Botón de "Facturación automática" visible para TODOS los usuarios (no solo
 * administradores), ubicado entre "Comisión a Pagar" y la fecha en el footer.
 *
 * Solo una PC por cuenta/local puede tener esto activado (ownership arbitrado
 * vía Firebase, ver useFacturacionOwnership). Tomar el control desde esta PC
 * requiere confirmación explícita si otra PC ya está facturando, porque la
 * desactiva automáticamente allá.
 */
const FacturacionAutoStartWidget = () => {
  const { loading, accounts, isOwnerOfAny, otherOwner, busyKey, toggleAutoStart } = useFacturacionOwnership();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOwner, setConfirmOwner] = useState(null);
  const confirmResolveRef = useRef(null);

  if (!window.electronAPI?.facturacion) return null;
  if (!loading && accounts.length === 0) return null; // esta cuenta/local no tiene facturación configurada

  const askConfirm = (owner) =>
    new Promise((resolve) => {
      setConfirmOwner(owner);
      confirmResolveRef.current = resolve;
      setConfirmOpen(true);
    });

  const resolveConfirm = (value) => {
    setConfirmOpen(false);
    confirmResolveRef.current?.(value);
    confirmResolveRef.current = null;
  };

  const handleToggle = async (checked) => {
    // Controla TODAS las cuentas configuradas en esta PC como un solo grupo,
    // para que el botón único del footer refleje un estado simple y coherente.
    for (const acc of accounts) {
      if (acc.isOwner === checked) continue; // ya está en el estado deseado
      const result = await toggleAutoStart(acc.key, checked, { onNeedConfirm: askConfirm });
      if (!result.ok) {
        if (result.reason === 'firebase-unavailable') {
          toast({
            variant: 'destructive',
            title: 'Sin conexión con Firebase',
            description: 'No se pudo confirmar el estado de facturación. Por seguridad, no se activó.',
          });
        } else if (result.reason !== 'cancelled') {
          toast({ variant: 'destructive', title: 'No se pudo cambiar el estado de facturación automática' });
        }
        return;
      }
    }
    toast({
      title: checked ? 'Facturación automática activada en esta PC' : 'Facturación automática desactivada en esta PC',
      className: checked ? 'bg-green-500 text-white' : undefined,
    });
  };

  const statusText = isOwnerOfAny
    ? 'Esta PC factura automáticamente'
    : otherOwner
      ? `Factura automática activa en: ${otherOwner.nombrePc || 'otra PC'}`
      : 'Ninguna PC tiene facturación automática activa';

  return (
    <>
      <div
        className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800 border border-cyan-500/40 whitespace-nowrap"
        title={statusText}
      >
        <Receipt className={`h-3.5 w-3.5 ${isOwnerOfAny ? 'text-green-400' : 'text-cyan-400'}`} />
        <span className="text-gray-300 font-medium">Facturación</span>
        {busyKey ? (
          <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
        ) : (
          <Switch
            checked={isOwnerOfAny}
            onCheckedChange={handleToggle}
            className="scale-75 data-[state=checked]:bg-green-500"
          />
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(v) => !v && resolveConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Tomar el control de la facturación automática?</AlertDialogTitle>
            <AlertDialogDescription>
              La PC <strong>{confirmOwner?.nombrePc || 'otra PC'}</strong> ya está autorizada para facturar
              esta cuenta{confirmOwner?.cuentaNombre ? ` (${confirmOwner.cuentaNombre})` : ''}. Si continuás,
              esa PC se desactivará automáticamente y esta PC pasará a ser la única que emite comprobantes
              para esta cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveConfirm(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveConfirm(true)} className="bg-cyan-600 hover:bg-cyan-700">
              Tomar el control
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default FacturacionAutoStartWidget;
