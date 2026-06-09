import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

const OtherPaymentFields = ({ formData, handleChange, errors }) => {
  return (
    <div className="space-y-3 p-3 border rounded-lg">
      <div className="space-y-1">
        <Label htmlFor="conceptoManual">Concepto*</Label>
        <Input id="conceptoManual" value={formData.conceptoManual} onChange={(e) => handleChange('conceptoManual', e.target.value)} placeholder="Ej: Adelanto de sueldo, Bono" />
        {errors.conceptoManual && <p className="text-red-500 text-xs">{errors.conceptoManual}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="montoManual">Monto a Pagar*</Label>
        <Input id="montoManual" type="number" value={formData.montoManual} onChange={(e) => handleChange('montoManual', e.target.value)} placeholder="Ej: 50000" />
        {errors.montoManual && <p className="text-red-500 text-xs">{errors.montoManual}</p>}
      </div>
    </div>
  );
};

export default OtherPaymentFields;