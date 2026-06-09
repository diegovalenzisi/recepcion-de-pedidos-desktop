import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MinusCircle } from 'lucide-react';

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
};

const CashRegisterExpenses = ({ expenses }) => {
  const paidExpenses = (Object.values(expenses || {}))
    .filter(expense => expense && expense.status !== 'A Pagar')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
  return (
    <Card className="flex-grow flex flex-col">
      <CardHeader><CardTitle>Gastos del Turno</CardTitle></CardHeader>
      <CardContent className="flex-grow relative">
        <ScrollArea className="absolute inset-0 pr-4">
          {paidExpenses.length > 0 ? (
            <div className="space-y-2">
              {paidExpenses.map(expense => (
                <div key={expense.id} className="flex justify-between items-center p-2 rounded-md bg-red-50 border border-red-100">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${expense.paymentMethod === 'efectivo' ? 'bg-gray-200 text-gray-700' : 'bg-blue-200 text-blue-800'}`}>
                      {expense.paymentMethod === 'efectivo' ? 'EF' : 'MP'}
                    </span>
                    <p className="text-sm font-medium text-red-800">{expense.concepto}</p>
                  </div>
                  <p className="font-bold text-red-800">{formatCurrency(expense.monto)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500">
              <MinusCircle className="mx-auto h-12 w-12 text-gray-400 mb-2" />
              <p>No hay gastos registrados en este turno.</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default CashRegisterExpenses;