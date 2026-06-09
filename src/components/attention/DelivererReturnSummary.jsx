import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

const formatCurrency = (value) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
};

const DelivererReturnSummary = ({ totals }) => {
  return (
    <Card className="bg-slate-50 border-slate-200">
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Resumen de Rendición</h3>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col space-y-1">
            <span className="text-gray-500">Pedidos Seleccionados</span>
            <span className="text-2xl font-bold text-gray-800">{totals.count}</span>
          </div>
          
          <div className="flex flex-col space-y-1 items-end">
            <span className="text-gray-500">Total General</span>
            <span className="text-xl font-bold text-gray-800">{formatCurrency(totals.grandTotal)}</span>
          </div>
        </div>

        <div className="my-3 border-t border-slate-300"></div>

        <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-green-700 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    Efectivo a Rendir
                </span>
                <span className="font-bold text-green-700 text-lg">{formatCurrency(totals.cashTotal)}</span>
            </div>
            
            <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-blue-700 flex items-center gap-2">
                     <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    Otros Medios
                </span>
                <span className="font-bold text-blue-700">{formatCurrency(totals.otherTotal)}</span>
            </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DelivererReturnSummary;