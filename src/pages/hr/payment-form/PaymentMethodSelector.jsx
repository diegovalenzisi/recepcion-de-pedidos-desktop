import React from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Wallet, CreditCard } from 'lucide-react';

const PaymentMethodSelector = ({ paymentMethod, setPaymentMethod, error }) => {
  return (
    <div className="space-y-1">
      <Label>Método de Pago*</Label>
      <div className="flex gap-2">
        <Button 
          variant={paymentMethod === 'efectivo' ? 'default' : 'outline'}
          onClick={() => setPaymentMethod('efectivo')}
          className="flex-1"
          size="sm"
        >
          <Wallet className="mr-2 h-4 w-4" /> Efectivo
        </Button>
        <Button 
          variant={paymentMethod === 'electronico' ? 'default' : 'outline'}
          onClick={() => setPaymentMethod('electronico')}
          className="flex-1"
          size="sm"
        >
          <CreditCard className="mr-2 h-4 w-4" /> Electrónico
        </Button>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}
    </div>
  );
};

export default PaymentMethodSelector;