import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Loader2, CheckCircle, Wallet } from 'lucide-react';
import PaymentMethodSlider from '@/components/attention/PaymentMethodSlider';

const SplitPaymentModal = ({ isOpen, onOpenChange, order, onConfirm, paymentMethods = ['Efectivo'] }) => {
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('Efectivo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const orderTotal = useMemo(() => order?.payment?.total || 0, [order]);
  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const remainingBalance = useMemo(() => orderTotal - totalPaid, [orderTotal, totalPaid]);

  useEffect(() => {
    if (isOpen && order) {
      setPayments(order.payment?.details || []);
      if (paymentMethods.length > 0) {
        setSelectedPaymentMethod(paymentMethods[0]);
      }
    } else {
      setPayments([]);
    }
  }, [isOpen, order, paymentMethods]);

  useEffect(() => {
    if (isOpen && remainingBalance > 0) {
      setAmount(remainingBalance.toFixed(2));
    } else {
      setAmount('');
    }
  }, [remainingBalance, isOpen]);

  const handleAddPayment = () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({ variant: 'destructive', title: 'Monto inválido', description: 'Por favor, ingrese un monto válido.' });
      return;
    }
    if (parsedAmount > remainingBalance + 0.001) {
      toast({ variant: 'destructive', title: 'Monto excede el saldo', description: 'El monto ingresado es mayor que el saldo pendiente.' });
      return;
    }
    if (!selectedPaymentMethod) {
      toast({ variant: 'destructive', title: 'Método no seleccionado', description: 'Por favor, elija un método de pago.' });
      return;
    }

    setPayments([...payments, { amount: parsedAmount, method: selectedPaymentMethod }]);
  };

  const removePayment = (index) => {
    setPayments(payments.filter((_, i) => i !== index));
  };

  const handleConfirm = async () => {
    if (remainingBalance > 0.009) {
      toast({ variant: "destructive", title: "Saldo pendiente", description: `Aún falta abonar ${formatCurrency(remainingBalance)}.` });
      return;
    }
    if (payments.length === 0) {
      toast({ variant: "destructive", title: "Sin pagos", description: "Agregue al menos un pago para confirmar." });
      return;
    }

    setIsSubmitting(true);
    await onConfirm(payments.filter(p => p.amount > 0));
    setIsSubmitting(false);
  };

  const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-gray-50">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center"><Wallet className="mr-2 text-orange-500" />Dividir Pago</DialogTitle>
          <DialogDescription>
            Divida el pago del pedido. Total: {formatCurrency(orderTotal)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-6 py-4">
          <div className="col-span-1 flex flex-col gap-4">
            <div className="p-4 rounded-lg bg-white shadow border border-gray-200">
              <div className="flex justify-between items-center text-lg">
                <span className="font-medium text-gray-600">Total Pagado:</span>
                <span className="font-bold text-green-600">{formatCurrency(totalPaid)}</span>
              </div>
              <div className="flex justify-between items-center text-xl mt-1">
                <span className="font-bold text-gray-800">Saldo Pendiente:</span>
                <span className="font-extrabold text-red-600">{formatCurrency(remainingBalance)}</span>
              </div>
            </div>

            <div className="space-y-4">
              <PaymentMethodSlider methods={paymentMethods} onSelect={setSelectedPaymentMethod} selectedMethod={selectedPaymentMethod} />
            </div>

            <div className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-8">
                <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg" placeholder="0.00" />
              </div>
              <div className="col-span-4">
                <Button className="w-full h-12 text-base" onClick={handleAddPayment} disabled={!amount || remainingBalance <= 0}>
                  <Plus className="mr-2 h-4 w-4" /> Añadir
                </Button>
              </div>
            </div>
          </div>
          <div className="col-span-1">
            <h4 className="font-semibold text-gray-700 mb-2">Pagos Registrados:</h4>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 bg-white p-2 rounded-lg border">
              <AnimatePresence>
                {payments.length > 0 ? payments.map((p, i) => (
                  p.amount > 0 && <motion.div
                    key={i}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                    className="flex items-center justify-between p-3 bg-gray-100 rounded-lg"
                  >
                    <span className="font-medium text-gray-800">{p.method}</span>
                    <div className="flex items-center gap-4">
                      <span className="font-bold text-gray-900">{formatCurrency(p.amount)}</span>
                      <Button variant="ghost" size="icon" onClick={() => removePayment(i)} className="text-red-500 hover:bg-red-100 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                )) : (
                  <p className="text-center text-gray-500 py-4">Aún no se han registrado pagos.</p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || remainingBalance > 0.01}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            Confirmar Pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SplitPaymentModal;