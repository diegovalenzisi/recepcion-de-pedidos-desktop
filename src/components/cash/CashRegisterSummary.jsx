
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DollarSign, ArrowUp, ArrowDown, PiggyBank, Briefcase, Coins, TrendingUp, User, Lock, CheckCircle } from 'lucide-react';

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
  const fondoInicial = cashData?.fondoInicial !== undefined
    ? cashData.fondoInicial
    : (currentShift?.fondoInicial || 0);

  // Fix 2: detección robusta de cerrado. Si cashData viene desde BACKUP/.../TURNO/.../CAJA
  // con campos de cierre, usar esos valores guardados aunque selectedShift.estado venga incompleto.
  const isClosed =
    currentShift?.estado === 'cerrado'
    || cashData?.estado === 'cerrado'
    || cashData?.cierreTotalVentas !== undefined
    || cashData?.cierreGanancia !== undefined
    || cashData?.cierreTotalesPorPago !== undefined;

  // Para turnos cerrados usar los valores guardados al cierre; fallback a los calculados
  const cashInBoxFinal = isClosed ? (cashData?.cierreEfectivoContado ?? cashInBox) : cashInBox;
  const difference = isClosed ? (cashData?.cierreDiferencia ?? 0) : 0;
  const totalSalesFinal = isClosed ? (cashData?.cierreTotalVentas ?? totalSales) : totalSales;
  const totalExpensesFinal = isClosed ? (cashData?.cierreTotalGastos ?? totalExpenses) : totalExpenses;
  const finalTotalCost = isClosed && cashData?.costoTotal !== undefined ? cashData.costoTotal : totalCost;
  const gananciaFinal = isClosed && cashData?.cierreGanancia !== undefined
    ? cashData.cierreGanancia
    : ((totalSalesFinal || 0) - (totalExpensesFinal || 0) - (finalTotalCost || 0));

  // Para turnos cerrados preferir cierreTotalesPorPago (guardado al cierre)
  const paymentTotals = isClosed && cashData?.cierreTotalesPorPago
    ? cashData.cierreTotalesPorPago
    : (totalsByPaymentMethod || {});

  // Movimientos de caja fuerte
  const safeEntries = cashData?.CAJAFUERTE
    ? Object.values(cashData.CAJAFUERTE).filter(Boolean)
    : [];

  let gananciaColor = 'text-gray-600';
  if (gananciaFinal > 0) gananciaColor = 'text-green-600';
  if (gananciaFinal < 0) gananciaColor = 'text-red-600';

  return (
    <Card className="shadow-lg rounded-xl overflow-hidden h-fit">
      <CardHeader className="bg-gray-50 border-b p-4">
        <CardTitle className="text-lg font-bold flex items-center justify-between">
          <span>Resumen de Turno #{currentShift?.id || '...'}</span>
          {isClosed
            ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Lock className="h-3 w-3" /> Cerrado
              </span>
            : <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <CheckCircle className="h-3 w-3" /> Abierto
              </span>
          }
        </CardTitle>
        {isClosed && cashData?.cierreResponsable && (
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
            <User className="h-3 w-3" />
            Cerrado por: <span className="font-medium ml-1">{cashData.cierreResponsable}</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="p-4">
        <SummaryItem icon={DollarSign} label="Fondo Inicial" value={fondoInicial} color="text-green-500" />
        <SummaryItem icon={ArrowUp} label="Ventas Totales" value={totalSalesFinal} color="text-blue-500" />
        <SummaryItem icon={ArrowDown} label="Gastos Totales" value={totalExpensesFinal} color="text-red-500" />

        <SummaryItem icon={PiggyBank} label="Caja Fuerte" value={totalSafe} color="text-purple-500" />
        {safeEntries.length > 0 && (
          <div className="pl-6 pb-1 space-y-0.5">
            {safeEntries.map((entry, i) => (
              <div key={i} className="flex justify-between text-xs text-gray-500">
                <span>{entry.descripcion || entry.motivo || 'Movimiento'}</span>
                <span>${(entry.valor || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ))}
          </div>
        )}

        <SummaryItem icon={Coins} label="Costo Total" value={finalTotalCost} color="text-orange-500" decimals={3} />
        <SummaryItem icon={TrendingUp} label="Ganancia" value={gananciaFinal} color={gananciaColor} decimals={3} />

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

        {isClosed && difference !== 0 && (
          <div className={`mt-2 p-2 rounded-md text-sm text-center font-bold ${difference > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {difference > 0 ? 'Sobrante: ' : 'Faltante: '}
            ${Math.abs(difference || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}

        <div className="mt-4">
          <p className="font-semibold text-sm mb-2 text-gray-500">Desglose de Ventas:</p>
          {Object.entries(paymentTotals).map(([method, amount]) => (
            <SummaryItem key={method} icon={DollarSign} label={method} value={amount} color="text-gray-400" />
          ))}
          {Object.keys(paymentTotals).length === 0 && (
            <span className="text-sm text-gray-400 italic">Sin ventas registradas.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CashRegisterSummary;
