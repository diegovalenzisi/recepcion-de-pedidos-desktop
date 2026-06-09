
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DollarSign, ArrowUp, ArrowDown, PiggyBank, Briefcase, Coins, TrendingUp } from 'lucide-react';

const SummaryItem = ({ icon: Icon, label, value, color, decimals = 2 }) => (
  <div className="flex justify-between items-center text-sm py-2 border-b border-gray-200 last:border-b-0">
    <div className="flex items-center text-gray-600">
      <Icon className={`h-4 w-4 mr-2 ${color}`} />
      <span>{label}</span>
    </div>
    <span className="font-bold text-gray-800">
      ${(value || 0).toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  </div>
);

function CashRegisterSummary({ currentShift, totalSales, totalExpenses, totalSafe, cashInBox, totalsByPaymentMethod, cashData, totalCost }) {
  // Enforce precise reading of the starting fund for the current shift. 
  // It prefers live cashData over the passed prop to ensure real-time accuracy.
  const fondoInicial = cashData?.fondoInicial !== undefined 
      ? cashData.fondoInicial 
      : (currentShift?.fondoInicial || 0);
      
  const cashInBoxFinal = currentShift?.estado === 'cerrado' ? cashData?.cierreEfectivoContado : cashInBox;
  const difference = currentShift?.estado === 'cerrado' ? cashData?.cierreDiferencia : 0;
  const totalSalesFinal = currentShift?.estado === 'cerrado' ? cashData?.cierreTotalVentas : totalSales;
  const finalTotalCost = currentShift?.estado === 'cerrado' && cashData?.costoTotal !== undefined ? cashData.costoTotal : totalCost;

  // Ganancia calculation
  const ganancia = (totalSalesFinal || 0) - (totalExpenses || 0) - (finalTotalCost || 0);
  let gananciaColor = 'text-gray-600';
  if (ganancia > 0) gananciaColor = 'text-green-600';
  if (ganancia < 0) gananciaColor = 'text-red-600';

  return (
    <Card className="shadow-lg rounded-xl overflow-hidden h-fit">
      <CardHeader className="bg-gray-50 border-b p-4">
        <CardTitle className="text-lg font-bold flex items-center">
          Resumen de Turno #{currentShift?.id || '...'}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <SummaryItem icon={DollarSign} label="Fondo Inicial" value={fondoInicial} color="text-green-500" />
        <SummaryItem icon={ArrowUp} label="Ventas Totales" value={totalSalesFinal} color="text-blue-500" />
        <SummaryItem icon={ArrowDown} label="Gastos Totales" value={totalExpenses} color="text-red-500" />
        <SummaryItem icon={PiggyBank} label="Caja Fuerte" value={totalSafe} color="text-purple-500" />
        <SummaryItem icon={Coins} label="Costo Total" value={finalTotalCost} color="text-orange-500" decimals={3} />
        <SummaryItem icon={TrendingUp} label="Ganancia" value={ganancia} color={gananciaColor} decimals={3} />
        
        <div className="mt-4 pt-4 border-t-2 border-dashed">
          <div className="flex justify-between items-center text-base py-2">
            <div className="flex items-center font-semibold">
              <Briefcase className="h-5 w-5 mr-2 text-primary" />
              <span>Efectivo en Caja</span>
            </div>
            <span className="font-extrabold text-xl text-primary">
              ${(cashInBoxFinal || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {currentShift?.estado === 'cerrado' && difference !== 0 && (
          <div className={`mt-2 p-2 rounded-md text-sm text-center font-bold ${difference > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {difference > 0 ? 'Sobrante: ' : 'Faltante: '} 
            ${Math.abs(difference || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}

        <div className="mt-4">
          <p className="font-semibold text-sm mb-2 text-gray-500">Desglose de Ventas:</p>
          {Object.entries(totalsByPaymentMethod || {}).map(([method, amount]) => (
            <SummaryItem key={method} icon={DollarSign} label={method} value={amount} color="text-gray-400" />
          ))}
          {(!totalsByPaymentMethod || Object.keys(totalsByPaymentMethod).length === 0) && (
             <span className="text-sm text-gray-400 italic">Sin ventas registradas.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CashRegisterSummary;
