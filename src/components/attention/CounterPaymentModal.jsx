import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Loader2, CheckCircle, Wallet, Gift, ThumbsDown, Trophy, FileText, Calculator } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { fetchAccounts } from '@/lib/api/accountsApi';
import { fetchEmployees, fetchCategories } from '@/lib/api/hrApi';
import PaymentMethodSlider from '@/components/attention/PaymentMethodSlider';
import ResponsibleEmployeeModal from './ResponsibleEmployeeModal';

const CounterPaymentModal = ({ isOpen, onClose, orderTotal, orderItems, onConfirmPayment, currentShift }) => {
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState('');
  const [paysWith, setPaysWith] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('Efectivo');
  const [availablePaymentMethods, setAvailablePaymentMethods] = useState(['Efectivo']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  
  const [specialDiscountType, setSpecialDiscountType] = useState(null);
  const [responsibleEmployee, setResponsibleEmployee] = useState(null);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [emiteFactura, setEmiteFactura] = useState(false);

  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const currentTotal = useMemo(() => specialDiscountType ? 0 : orderTotal, [specialDiscountType, orderTotal]);
  const remainingBalance = useMemo(() => currentTotal - totalPaid, [currentTotal, totalPaid]);
  
  const loadPaymentMethods = useCallback(async () => {
    try {
        const [accountsData, emp, cat] = await Promise.all([
          fetchAccounts(),
          fetchEmployees(),
          fetchCategories()
        ]);
        const electronicPaymentMethods = (accountsData || []).map(acc => acc.nombre).filter(Boolean);
        const allMethods = ['Efectivo', ...new Set(electronicPaymentMethods)];
        setAvailablePaymentMethods(allMethods);
        if (allMethods.length > 0 && !allMethods.includes(selectedPaymentMethod)) {
            setSelectedPaymentMethod(allMethods[0]);
        }
        setEmployees(emp);
        setCategories(cat);
    } catch(error) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos necesarios.' });
    }
  }, [toast, selectedPaymentMethod]);

  useEffect(() => {
    if (isOpen) {
      setPayments([]);
      setSpecialDiscountType(null);
      setResponsibleEmployee(null);
      setEmiteFactura(false);
      setIsSubmitting(false);
      setPaysWith('');
      loadPaymentMethods();
    }
  }, [isOpen]);

  useEffect(() => {
    if (specialDiscountType) {
      setPayments([{ amount: 0, method: specialDiscountType }]);
    } else {
      setPayments([]);
    }
  }, [specialDiscountType, orderTotal]);

  useEffect(() => {
    if (isOpen && remainingBalance > 0 && !specialDiscountType) {
        setAmount(remainingBalance.toFixed(2));
    } else {
        setAmount('');
    }
  }, [remainingBalance, isOpen, specialDiscountType]);

  const handleSpecialDiscountChange = (type) => {
    if (specialDiscountType === type) {
      setSpecialDiscountType(null);
      setResponsibleEmployee(null);
    } else {
      setSpecialDiscountType(type);
      setIsEmployeeModalOpen(true);
    }
  };
  
  const handleSelectResponsible = (employee) => {
    setResponsibleEmployee(employee);
    setIsEmployeeModalOpen(false);
  };
  
  const handleCloseEmployeeModal = () => {
    if (!responsibleEmployee) {
      setSpecialDiscountType(null);
    }
    setIsEmployeeModalOpen(false);
  };

  const handleAddPayment = () => {
    if (specialDiscountType) return;
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
    setPaysWith('');
  };
  
  const removePayment = (index) => {
    if (specialDiscountType) return;
    setPayments(payments.filter((_, i) => i !== index));
  };

  const handleConfirmPayment = async () => {
    if (isSubmitting) return; 
    
    if (specialDiscountType && !responsibleEmployee) {
      toast({ variant: "destructive", title: "Falta Responsable", description: "Debe seleccionar un empleado responsable." });
      setIsEmployeeModalOpen(true);
      return;
    }
    if (remainingBalance > 0.009 && !specialDiscountType) {
      toast({ variant: "destructive", title: "Saldo pendiente", description: `Aún falta abonar ${formatCurrency(remainingBalance)}.` });
      return;
    }
    if (payments.length === 0 && !specialDiscountType) {
        toast({ variant: "destructive", title: "Sin pagos", description: "Agregue al menos un pago para confirmar." });
        return;
    }

    setIsSubmitting(true);
    try {
        const specialDiscount = specialDiscountType ? { type: specialDiscountType, responsible: responsibleEmployee } : null;
        // Los prepagos PEDIDOSYA/RAPPI se guardan dentro de saveCounterSale (background).
        // No duplicar aquí.
        await onConfirmPayment(payments.filter(p => p.amount > 0), specialDiscount, emiteFactura, currentTotal);
    } catch (e) {
        setIsSubmitting(false);
        toast({ variant: "destructive", title: "Error", description: "Ocurrió un error al procesar el pago." });
    }
  };

  const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

  const calculateChange = useMemo(() => {
    const payValue = parseFloat(paysWith);
    const amountValue = parseFloat(amount);
    if (!isNaN(payValue) && !isNaN(amountValue) && payValue >= amountValue) {
      return payValue - amountValue;
    }
    return 0;
  }, [paysWith, amount]);

  const specialDiscountOptions = [
    { id: 'Sorteo', label: 'Sorteo', icon: Trophy },
    { id: 'Regalo', label: 'Regalo', icon: Gift },
    { id: 'Mal Armado', label: 'Mal Armado', icon: ThumbsDown },
  ];

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-4xl bg-gray-50">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center"><Wallet className="mr-2 text-primary"/>Cobrar Venta</DialogTitle>
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
              <PaymentMethodSlider methods={availablePaymentMethods} onSelect={setSelectedPaymentMethod} selectedMethod={selectedPaymentMethod}/>
            </div>
            
            {selectedPaymentMethod === 'Efectivo' && !specialDiscountType ? (
                <div className="space-y-3 p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="amount" className="text-xs font-semibold text-gray-600 mb-1 block">Monto a Cobrar</Label>
                            <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 text-lg font-bold" placeholder="0.00" />
                        </div>
                        <div>
                            <Label htmlFor="paysWith" className="text-xs font-semibold text-gray-600 mb-1 block">Paga con</Label>
                            <Input 
                                id="paysWith" 
                                type="number" 
                                value={paysWith} 
                                onChange={(e) => setPaysWith(e.target.value)} 
                                className="h-10 text-lg" 
                                placeholder="0.00" 
                            />
                        </div>
                    </div>
                    {paysWith && (
                        <div className="flex justify-between items-center bg-white p-2 rounded border border-green-200 shadow-sm">
                            <span className="text-sm font-medium text-green-800 flex items-center gap-2">
                                <Calculator className="w-4 h-4"/> Vuelto:
                            </span>
                            <span className="text-2xl font-bold text-green-600">{formatCurrency(calculateChange)}</span>
                        </div>
                    )}
                     <Button className="w-full h-10 text-base" onClick={handleAddPayment} disabled={!amount || remainingBalance <= 0}>
                          <Plus className="mr-2 h-4 w-4"/> Añadir Pago
                     </Button>
                </div>
            ) : (
                <div className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-8">
                    <Label htmlFor="amount" className="text-xs font-semibold text-gray-600 mb-1 block">Monto</Label>
                    <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg" placeholder="0.00" disabled={!!specialDiscountType} />
                  </div>
                  <div className="col-span-4">
                      <Button className="w-full h-12 text-base" onClick={handleAddPayment} disabled={!amount || remainingBalance <= 0 || !!specialDiscountType}>
                          <Plus className="mr-2 h-4 w-4"/> Añadir
                      </Button>
                  </div>
                </div>
            )}

            <div className="p-4 rounded-lg bg-white shadow-sm border border-gray-200 space-y-3">
                <h4 className="font-semibold text-gray-700">Descuento Especial</h4>
                <div className="flex justify-around">
                    {specialDiscountOptions.map(option => (
                          <div key={option.id} className="flex items-center space-x-2">
                              <Checkbox id={`counter-${option.id}`} checked={specialDiscountType === option.id} onCheckedChange={() => handleSpecialDiscountChange(option.id)} />
                              <Label htmlFor={`counter-${option.id}`} className="flex items-center gap-1.5 cursor-pointer">
                                <option.icon className="w-4 h-4" />
                                {option.label}
                              </Label>
                          </div>
                    ))}
                </div>
                {specialDiscountType && responsibleEmployee && (
                  <div className="text-center text-xs text-green-700 p-1 bg-green-100 rounded">
                    Responsable: {responsibleEmployee.nombre} {responsibleEmployee.apellido}
                  </div>
                )}
            </div>
          </div>
          <div className="col-span-1">
            <h4 className="font-semibold text-gray-700 mb-2">Pagos Registrados:</h4>
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-2 bg-white p-2 rounded-lg border">
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
                      <Button variant="ghost" size="icon" onClick={() => removePayment(i)} className="text-red-500 hover:bg-red-100 hover:text-red-600" disabled={!!specialDiscountType}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                )) : (
                  <p className="text-center text-gray-500 py-4">Aún no se han registrado pagos.</p>
                )}
              </AnimatePresence>
            </div>
            <div className="flex items-center space-x-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mt-4">
                <Checkbox id="emiteFacturaCounter" checked={emiteFactura} onCheckedChange={setEmiteFactura} />
                <Label htmlFor="emiteFacturaCounter" className="font-medium text-blue-800 flex items-center gap-2 cursor-pointer">
                  <FileText className="w-4 h-4" />
                  Emite Factura
                </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button 
            type="button" 
            onClick={handleConfirmPayment} 
            disabled={isSubmitting || (remainingBalance > 0.01 && !specialDiscountType)}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            Confirmar Venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ResponsibleEmployeeModal
        isOpen={isEmployeeModalOpen}
        onClose={handleCloseEmployeeModal}
        onSelect={handleSelectResponsible}
        employees={employees}
        categories={categories}
      />
    </>
  );
};

export default CounterPaymentModal;