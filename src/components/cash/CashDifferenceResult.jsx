import React from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';

const formatCurrency = (amount) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);

// ---------------------------------------------------------------------------
// Resultado de la diferencia de caja — se muestra UNA sola vez, inmediatamente
// después de que closeShift() confirmó el cierre (nunca antes). Puramente
// presentacional: no importa nada de Firebase ni de managementApi/cash — solo
// recibe `difference`, `cashInBox` (efectivo esperado) y `cashCount` (efectivo
// contado), los mismos tres números que reportData.summary ya calculaba en
// CloseShiftModal.jsx antes de cerrar. No recalcula ni redondea distinto.
// ---------------------------------------------------------------------------
const CashDifferenceResult = ({ difference, cashInBox, cashCount, onAccept }) => {
  const esFavor = difference > 0;
  const esCero = difference === 0;

  // Clases SIEMPRE completas y literales (nunca `bg-${color}-50` armado por
  // interpolación): el purgador de Tailwind escanea el código en busca de
  // nombres de clase completos, y una clase reconstruida en tiempo de
  // ejecución no aparece como tal en el archivo — quedaría afuera del CSS
  // final y el color no se vería en producción.
  const estado = esCero
    ? { label: 'CAJA CORRECTA', box: 'border-blue-200 bg-blue-50', text: 'text-blue-700', Icon: MinusCircle }
    : esFavor
      ? { label: 'A FAVOR', box: 'border-green-200 bg-green-50', text: 'text-green-700', Icon: CheckCircle2 }
      : { label: 'EN CONTRA', box: 'border-red-200 bg-red-50', text: 'text-red-700', Icon: AlertTriangle };

  const signo = esFavor ? '+' : '';

  return (
    <div className="py-6 flex flex-col items-center text-center space-y-6">
      <p className="text-sm font-semibold tracking-wide text-gray-500 uppercase">Diferencia de Caja</p>

      <div className={`w-full rounded-xl border-2 py-8 px-6 flex flex-col items-center space-y-3 ${estado.box}`}>
        <estado.Icon className={`w-12 h-12 ${estado.text}`} />
        <p className={`text-2xl font-extrabold ${estado.text}`}>{estado.label}</p>
        <p className={`text-4xl font-extrabold ${estado.text}`}>
          {signo}{formatCurrency(difference)}
        </p>
      </div>

      {(cashInBox !== undefined || cashCount !== undefined) && (
        <div className="w-full grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-md bg-gray-50 border py-3">
            <p className="text-gray-500">Efectivo Esperado</p>
            <p className="font-semibold text-gray-800">{formatCurrency(cashInBox)}</p>
          </div>
          <div className="rounded-md bg-gray-50 border py-3">
            <p className="text-gray-500">Efectivo Contado</p>
            <p className="font-semibold text-gray-800">{formatCurrency(cashCount)}</p>
          </div>
        </div>
      )}

      <Button onClick={onAccept} size="lg" className="w-full max-w-xs text-lg h-12">
        ACEPTAR
      </Button>
    </div>
  );
};

export default CashDifferenceResult;
