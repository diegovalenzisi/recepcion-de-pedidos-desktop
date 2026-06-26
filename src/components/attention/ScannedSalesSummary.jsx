import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Receipt, DollarSign, Timer } from 'lucide-react';

export default function ScannedSalesSummary({ scannedSales, sessionStartTime }) {
  const totalAmount = scannedSales.reduce((sum, sale) => {
    return sum + (Number(sale.payment?.total) || Number(sale.payment?.amount) || 0);
  }, 0);

  return (
    <Card className="bg-gray-50 border-gray-200">
      <CardContent className="p-4">
        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Resumen de Sesión</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col items-center p-2 bg-white rounded-md border shadow-sm">
            <Receipt className="w-5 h-5 text-blue-500 mb-1" />
            <span className="text-xl font-bold text-gray-900">{scannedSales.length}</span>
            <span className="text-xs text-gray-500 text-center">Pedidos</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-white rounded-md border shadow-sm">
            <DollarSign className="w-5 h-5 text-green-600 mb-1" />
            <span className="text-xl font-bold text-gray-900">${totalAmount}</span>
            <span className="text-xs text-gray-500 text-center">Total</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-white rounded-md border shadow-sm">
            <Timer className="w-5 h-5 text-orange-500 mb-1" />
            <span className="text-sm font-bold text-gray-900 mt-1">
              {sessionStartTime ? new Date(sessionStartTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
            </span>
            <span className="text-xs text-gray-500 text-center mt-1">Inicio</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}