import React, { useState } from 'react';
import { Loader2, Info, Archive, Calendar, ChevronsRight, PlusCircle, MinusCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

const AccumulatedPaymentFields = ({ loading, data, employee, error }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 border rounded-lg bg-gray-50">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span>Buscando datos acumulados...</span>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="flex items-center justify-center p-4 border rounded-lg bg-yellow-50 text-yellow-700">
        <Info className="mr-2 h-4 w-4" />
        <span>Selecciona un empleado para ver su acumulado.</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-4 border rounded-lg bg-red-50 text-red-700">
        <Info className="mr-2 h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data || !data.totalAcumulado) {
    return (
      <div className="flex items-center justify-center p-4 border rounded-lg bg-blue-50 text-blue-700">
        <Info className="mr-2 h-4 w-4" />
        <span>Este empleado no tiene pagos acumulados pendientes.</span>
      </div>
    );
  }

  const paymentDetails = Object.entries(data)
    .filter(([key]) => key !== 'totalAcumulado' && key !== 'contadorPagos')
    .sort(([dateA], [dateB]) => new Date(dateA.split('-').reverse().join('-')) - new Date(dateB.split('-').reverse().join('-')))
    .map(([date, entries]) => ({
      date,
      entries: Object.values(entries)
    }));

  return (
    <div className="p-4 border-2 border-dashed border-green-500 rounded-lg bg-green-50 text-green-800 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Archive className="mr-3 h-6 w-6 text-green-600" />
          <div>
            <p className="font-semibold">Total Acumulado a Pagar</p>
            <p className="text-xs">Monto total de pagos pendientes para {employee.nombre} {employee.apellido}.</p>
          </div>
        </div>
        <p className="text-2xl font-bold">${data.totalAcumulado.toFixed(2)}</p>
      </div>

      {paymentDetails.length > 0 && (
        <div>
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            <h4 className="font-semibold text-sm text-green-700">Desglose de Pagos Pendientes</h4>
            <Button variant="ghost" size="icon" className="text-green-700 hover:text-green-900">
              {isExpanded ? <MinusCircle className="h-5 w-5" /> : <PlusCircle className="h-5 w-5" />}
            </Button>
          </div>
          
          {isExpanded && (
            <ScrollArea className="h-40 w-full rounded-md border border-green-200 bg-white/50 p-2 mt-2">
              <div className="space-y-3">
                {paymentDetails.map(({ date, entries }) => (
                  <div key={date}>
                    <div className="flex items-center font-bold text-xs text-green-900 mb-1">
                      <Calendar className="h-3.5 w-3.5 mr-1.5" />
                      <span>{date}</span>
                    </div>
                    <ul className="space-y-1.5 pl-4">
                      {entries.map((entry, index) => (
                        <li key={index} className="text-xs flex items-start text-gray-700">
                          <ChevronsRight className="h-3.5 w-3.5 mr-1.5 mt-px flex-shrink-0 text-green-600" />
                          <span className="flex-grow">{entry.descripcion}</span>
                          <span className="font-medium ml-2">${entry.monto.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
};

export default AccumulatedPaymentFields;