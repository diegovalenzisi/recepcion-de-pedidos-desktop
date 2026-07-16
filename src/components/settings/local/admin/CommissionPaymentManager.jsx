
import React, { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Coins as HandCoins } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value || 0);

/**
 * accountTotals (provisto por AdminPanel.jsx vía useCommissionBalance — misma fuente y
 * mismo cálculo que el footer y el aviso al entrar: COMISIONES/REGISTRO − COMISIONES/PAGOS,
 * NO RESUMEN_CUENTA/TOTALES ni PAGOS_COMISIONES):
 *   totalCommission  — Total Comisión Acumulada (suma de comisionGenerada válida)
 *   totalPagado      — Total pagos realizados (suma de montoPago aprobado)
 *   aPagar           — Comisión pendiente (totalCommission − totalPagado, nunca negativo)
 */
const CommissionPaymentManager = ({
  accountTotals = { totalCommission: 0, totalPagado: 0, aPagar: 0 },
  onProcessPayment,
  onPaymentSuccess,
}) => {
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleProcess = async () => {
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Monto inválido', description: 'Por favor, ingresá un monto de pago válido.' });
      return;
    }

    setIsProcessing(true);
    try {
      await onProcessPayment(amount);
      toast({
        title: "¡Pago Procesado!",
        description: "El pago se registró y los resúmenes fueron actualizados.",
        className: "bg-green-500 text-white",
        duration: 5000,
      });
      setPaymentAmount('');
      if (onPaymentSuccess) onPaymentSuccess();
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('commissionPaid'));
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al procesar el pago",
        description: error.message || "Ocurrió un error inesperado.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Precomputar aPagar desde el campo dedicado; si no viene, derivar
  const aPagar = accountTotals.aPagar ?? Math.max(0, (accountTotals.totalCommission || 0) - (accountTotals.totalPagado || 0));

  return (
    <div className="pt-4 border-t border-primary/20">
      <Label className="font-semibold flex items-center mb-3">
        <HandCoins className="mr-2 h-4 w-4" /> Pago de Comisiones
      </Label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">

        <div className="space-y-1">
          <Label htmlFor="totalCommission" className="text-sm font-medium text-gray-600">
            Total Comisión Acumulada
          </Label>
          <Input
            id="totalCommission"
            value={formatCurrency(accountTotals.totalCommission)}
            readOnly
            className="bg-gray-100 font-bold text-lg"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="totalPagado" className="text-sm font-medium text-gray-600">
            Total pagos realizados
          </Label>
          <Input
            id="totalPagado"
            value={formatCurrency(accountTotals.totalPagado)}
            readOnly
            className="bg-gray-100 font-bold text-lg"
          />
        </div>

        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="aPagar" className="text-sm font-medium text-orange-700 flex items-center gap-1">
            Comisión pendiente de pago
          </Label>
          <Input
            id="aPagar"
            value={formatCurrency(aPagar)}
            readOnly
            className={`font-bold text-xl ${aPagar > 0 ? 'bg-orange-50 text-orange-800 border-orange-300' : 'bg-gray-100'}`}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="paymentAmount" className="text-sm font-medium text-gray-600">
            Monto a ingresar
          </Label>
          <Input
            id="paymentAmount"
            type="number"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            placeholder="0.00"
            className="bg-white"
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={isProcessing || !paymentAmount || parseFloat(paymentAmount) <= 0}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isProcessing
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <HandCoins className="mr-2 h-4 w-4" />}
              Pagar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Confirmar Pago?</AlertDialogTitle>
              <AlertDialogDescription>
                Estás a punto de registrar un pago de{' '}
                <span className="font-bold">{formatCurrency(paymentAmount)}</span>.
                {' '}Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleProcess} className="bg-green-600 hover:bg-green-700">
                Confirmar y Pagar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </div>
  );
};

export default CommissionPaymentManager;
