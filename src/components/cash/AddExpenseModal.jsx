import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DollarSign, Loader2, Save, Type, X, CreditCard, Wallet, User } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function AddExpenseModal({ isOpen, onClose, onExpenseAdded, currentShift, employees, categories }) {
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [responsibleId, setResponsibleId] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const sellerCategoryId = useMemo(() => {
    if (!categories) return null;
    const sellerCategory = categories.find(c => c.nombre.toLowerCase() === 'vendedor');
    return sellerCategory ? sellerCategory.id : null;
  }, [categories]);

  const sellerEmployees = useMemo(() => {
    if (!sellerCategoryId || !employees) return [];
    return employees.filter(e => e.categoriaId === sellerCategoryId);
  }, [employees, sellerCategoryId]);
  
  const resetForm = () => {
    setConcepto('');
    setMonto('');
    setPaymentMethod(null);
    setResponsibleId('');
  };

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  const handleSave = async (e) => {
    e.preventDefault();
    const expenseAmount = parseFloat(monto);
    if (!concepto.trim()) {
        toast({ variant: "destructive", title: "Concepto requerido", description: "Por favor, ingrese una descripción para el gasto." });
        return;
    }
    if (isNaN(expenseAmount) || expenseAmount <= 0) {
      toast({ variant: "destructive", title: "Monto inválido", description: "Por favor, ingresa un monto válido y mayor a cero." });
      return;
    }
    if (!paymentMethod) {
      toast({ variant: "destructive", title: "Método de pago requerido", description: "Por favor, seleccione si el gasto fue en efectivo o electrónico." });
      return;
    }
    if (!responsibleId) {
        toast({ variant: "destructive", title: "Responsable requerido", description: "Por favor, seleccione un vendedor responsable." });
        return;
    }
    
    setSaving(true);
    const responsibleEmployee = employees.find(e => e.legajo === responsibleId);
    const employeeName = responsibleEmployee ? `${responsibleEmployee.nombre} ${responsibleEmployee.apellido}` : 'No disponible';

    const expenseData = {
        concepto,
        monto: expenseAmount,
        paymentMethod,
        timestamp: new Date().toISOString(),
        empleado: employeeName,
    };
    
    try {
        await onExpenseAdded(expenseData);
        resetForm();
    } catch(error) {
        // Error toast is handled in the parent component
    } finally {
        setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    resetForm();
    onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
             <Button variant="ghost" size="icon" className="absolute top-4 right-4 text-gray-500 hover:bg-gray-100" onClick={handleClose}>
                <X/>
            </Button>
            <div className="p-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center mb-4">
                  <DollarSign className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-3xl font-bold text-gray-800">Registrar Gasto General</h2>
                <p className="text-gray-500 mt-2">
                    Añade un nuevo gasto para el turno actual #{currentShift?.id}.
                </p>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="expense-concept" className="text-lg font-semibold text-gray-700">Concepto</Label>
                        <div className="relative">
                            <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <Input id="expense-concept" type="text" placeholder="Ej: Compra de servilletas" value={concepto} onChange={(e) => setConcepto(e.target.value)} className="pl-10 pr-4 py-3 h-auto bg-gray-50 text-base" required autoFocus />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="expense-responsible" className="text-lg font-semibold text-gray-700">Responsable</Label>
                        <Select value={responsibleId} onValueChange={setResponsibleId}>
                          <SelectTrigger className="pl-10 pr-4 py-3 h-auto bg-gray-50 text-base">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <SelectValue placeholder="Seleccionar vendedor..." />
                          </SelectTrigger>
                          <SelectContent>
                            {sellerEmployees.map(employee => (
                              <SelectItem key={employee.legajo} value={employee.legajo}>
                                {employee.nombre} {employee.apellido}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                    </div>
                </div>

                 <div className="space-y-2">
                  <Label htmlFor="expense-amount" className="text-lg font-semibold text-gray-700">Monto</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <Input id="expense-amount" type="number" placeholder="0.00" value={monto} onChange={(e) => setMonto(e.target.value)} className="pl-10 pr-4 py-3 text-2xl h-auto text-center font-bold bg-gray-50" required />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-lg font-semibold text-gray-700">Método de Pago</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <Button type="button" variant={paymentMethod === 'efectivo' ? 'default' : 'outline'} onClick={() => setPaymentMethod('efectivo')} className="h-12 text-base" >
                      <Wallet className="mr-2 h-5 w-5" /> Efectivo
                    </Button>
                    <Button type="button" variant={paymentMethod === 'electronico' ? 'default' : 'outline'} onClick={() => setPaymentMethod('electronico')} className="h-12 text-base" >
                      <CreditCard className="mr-2 h-5 w-5" /> Electrónico
                    </Button>
                  </div>
                </div>

                <Button type="submit" disabled={saving || !paymentMethod || !responsibleId} className="w-full h-14 text-xl font-bold bg-red-500 hover:bg-red-600 text-white">
                    {saving ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <Save className="mr-3 h-6 w-6" />}
                    {saving ? 'Guardando...' : 'Guardar Gasto'}
                </Button>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default AddExpenseModal;