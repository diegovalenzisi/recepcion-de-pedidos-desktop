import React from 'react';
import { Clock, DollarSign } from 'lucide-react';
import TimeSelector from '@/pages/hr/payment-form/TimeSelector';

const HoursPaymentFields = ({ formData, handleChange, totalHours, totalPayment, error }) => {
  const formatHoursDisplay = (hoursDecimal) => {
    if (typeof hoursDecimal !== 'number' || hoursDecimal < 0) {
      return '0hs';
    }
    const hours = Math.floor(hoursDecimal);
    const minutes = Math.round((hoursDecimal - hours) * 60);
  
    let parts = [];
    if (hours > 0) {
      parts.push(`${hours}hs`);
    }
    if (minutes > 0) {
      parts.push(`${minutes}ms`);
    }
    
    if (parts.length === 0) return '0hs';
  
    return parts.join(' ');
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 p-2 border rounded-lg">
          <h3 className="col-span-2 font-semibold text-sm mb-1">Turno 1</h3>
          <TimeSelector label="Desde" value={formData.turno1Desde} onChange={(v) => handleChange('turno1Desde', v)} />
          <TimeSelector label="Hasta" value={formData.turno1Hasta} onChange={(v) => handleChange('turno1Hasta', v)} />
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-2 p-2 border rounded-lg">
          <h3 className="col-span-2 font-semibold text-sm mb-1">Turno 2</h3>
          <TimeSelector label="Desde" value={formData.turno2Desde} onChange={(v) => handleChange('turno2Desde', v)} />
          <TimeSelector label="Hasta" value={formData.turno2Hasta} onChange={(v) => handleChange('turno2Hasta', v)} />
        </div>
      </div>

      {error && <p className="text-red-500 text-xs text-center">{error}</p>}

      <div className="mt-2 p-2 bg-orange-50 rounded-lg flex justify-around items-center">
        <div className="text-center">
          <div className="flex items-center text-gray-600 text-xs">
            <Clock className="h-3 w-3 mr-1" />
            <span className="font-medium">Total Horas</span>
          </div>
          <p className="text-lg font-bold text-orange-600">{formatHoursDisplay(totalHours)}</p>
        </div>
        <div className="text-center">
          <div className="flex items-center text-gray-600 text-xs">
            <DollarSign className="h-3 w-3 mr-1" />
            <span className="font-medium">Total a Pagar</span>
          </div>
          <p className="text-lg font-bold text-green-600">${totalPayment.toFixed(2)}</p>
        </div>
      </div>
    </>
  );
};

export default HoursPaymentFields;