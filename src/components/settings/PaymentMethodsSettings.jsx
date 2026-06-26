import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CreditCard, PlusCircle, Trash2, XCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { AnimatePresence, motion } from 'framer-motion';

const PREDEFINED_METHODS = ["Transferencia", "Mercado Pago", "Cuenta DNI"];

const PaymentMethodsSettings = ({ paymentMethods, onPaymentMethodsChange }) => {
  const [newMethod, setNewMethod] = useState('');
  const { toast } = useToast();

  const handleAddMethod = () => {
    if (newMethod.trim() === '') {
      toast({
        variant: "destructive",
        title: "Campo vacío",
        description: "Debes seleccionar un método de pago.",
      });
      return;
    }
    const currentMethods = paymentMethods || [];
    if (currentMethods.includes(newMethod.trim())) {
      toast({
        variant: "destructive",
        title: "Método duplicado",
        description: `El método de pago "${newMethod.trim()}" ya existe.`,
      });
      return;
    }
    onPaymentMethodsChange([...currentMethods, newMethod.trim()]);
    setNewMethod('');
  };

  const handleRemoveMethod = (methodToRemove) => {
    if (methodToRemove === 'Efectivo') {
        toast({
            variant: "destructive",
            title: "Acción no permitida",
            description: "El método de pago 'Efectivo' no se puede eliminar.",
        });
        return;
    }
    onPaymentMethodsChange((paymentMethods || []).filter(method => method !== methodToRemove));
  };

  const availableMethods = PREDEFINED_METHODS.filter(
    (method) => !(paymentMethods || []).includes(method)
  );

  return (
    <Card className="bg-white shadow-lg border-orange-100">
      <CardHeader>
        <div className="flex items-center space-x-3">
          <CreditCard className="w-6 h-6 text-orange-500" />
          <div>
            <CardTitle className="text-xl font-bold text-gray-800">Formas de Pago</CardTitle>
            <CardDescription>Define los métodos de pago aceptados en tu local.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Label htmlFor="new-payment-method" className="font-semibold text-gray-700">Añadir nuevo método</Label>
          <div className="flex items-center space-x-2">
            <Select onValueChange={setNewMethod} value={newMethod}>
              <SelectTrigger id="new-payment-method" className="bg-gray-50">
                <SelectValue placeholder="Seleccionar método..." />
              </SelectTrigger>
              <SelectContent>
                {availableMethods.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAddMethod} size="sm" className="bg-green-500 hover:bg-green-600" disabled={!newMethod}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Añadir
            </Button>
          </div>
        </div>
        
        <div>
          <h4 className="font-semibold text-gray-700 mb-3">Métodos actuales:</h4>
          <div className="space-y-2">
            <AnimatePresence>
              {(paymentMethods || []).map((method) => (
                <motion.div
                  key={method}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                  className="flex items-center justify-between p-3 bg-gray-100 rounded-lg"
                >
                  <span className="font-medium text-gray-800">{method}</span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleRemoveMethod(method)}
                    className="text-red-500 hover:bg-red-100 hover:text-red-600 disabled:text-gray-400 disabled:hover:bg-transparent"
                    disabled={method === 'Efectivo'}
                    aria-label={`Eliminar ${method}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
            {(!paymentMethods || paymentMethods.length === 0) && (
                <div className="text-center py-4 text-gray-500">
                    <XCircle className="mx-auto h-8 w-8 text-gray-400 mb-2"/>
                    <p>No hay métodos de pago configurados.</p>
                </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PaymentMethodsSettings;