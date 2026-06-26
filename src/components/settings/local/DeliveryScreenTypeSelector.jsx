import React from 'react';
import { Monitor, Layers } from 'lucide-react';

const DeliveryScreenTypeSelector = ({ value = 'table', onChange }) => {
  return (
    <div className="space-y-4 py-4 border-b border-gray-100 last:border-0">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">Tipo de Pantalla Delivery</h3>
        <p className="text-sm text-gray-500">Seleccione el diseño de la pantalla de atención para los pedidos de envío.</p>
      </div>
      <div className="flex gap-4">
        <button
          onClick={() => onChange('table')}
          className={`flex-1 flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all duration-200 ${
            value === 'table' || value === 'actual' || !value
              ? 'border-primary bg-primary/5 text-primary shadow-sm'
              : 'border-gray-200 hover:border-primary/50 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Monitor className="w-8 h-8 mb-3" />
          <span className="font-semibold text-lg">Opción 1: Vista por tabla</span>
          <span className="text-xs mt-1 opacity-80">Lista en tabla y barra lateral</span>
        </button>
        
        <button
          onClick={() => onChange('grid')}
          className={`flex-1 flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all duration-200 ${
            value === 'grid' || value === 'cuadrilla'
              ? 'border-primary bg-primary/5 text-primary shadow-sm'
              : 'border-gray-200 hover:border-primary/50 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Layers className="w-8 h-8 mb-3" />
          <span className="font-semibold text-lg">Opción 2: Vista por cuadrilla</span>
          <span className="text-xs mt-1 opacity-80">Tarjetas organizadas en grilla</span>
        </button>
      </div>
    </div>
  );
};

export default DeliveryScreenTypeSelector;