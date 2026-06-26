import React from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Clock, FileText, Archive, Sunset } from 'lucide-react';

const PaymentTypeSelector = ({ paymentType, setPaymentType }) => {
  return (
    <div className="space-y-1">
      <Label>Tipo de Pago*</Label>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Button 
          variant={paymentType === 'horas' ? 'default' : 'outline'}
          onClick={() => setPaymentType('horas')}
          className="flex-1"
          size="sm"
        >
          <Clock className="mr-2 h-4 w-4" /> Por Horas
        </Button>
        <Button 
          variant={paymentType === 'turno' ? 'default' : 'outline'}
          onClick={() => setPaymentType('turno')}
          className="flex-1"
          size="sm"
        >
          <Sunset className="mr-2 h-4 w-4" /> Por Turno
        </Button>
        <Button 
          variant={paymentType === 'otro' ? 'default' : 'outline'}
          onClick={() => setPaymentType('otro')}
          className="flex-1"
          size="sm"
        >
          <FileText className="mr-2 h-4 w-4" /> Otro Concepto
        </Button>
        <Button 
          variant={paymentType === 'pago_acumulado' ? 'default' : 'outline'}
          onClick={() => setPaymentType('pago_acumulado')}
          className="flex-1"
          size="sm"
        >
          <Archive className="mr-2 h-4 w-4" /> Pagar Acumulado
        </Button>
      </div>
    </div>
  );
};

export default PaymentTypeSelector;