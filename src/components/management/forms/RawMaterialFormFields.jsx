
import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const RawMaterialFormFields = ({ formData, onFieldChange }) => {
  const handleChange = (e) => {
    onFieldChange(e.target.name, e.target.value);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2 md:col-span-2">
        <Label>Nombre</Label>
        <Input 
          name="nombre" 
          placeholder="Ej: Harina 0000" 
          value={formData.nombre || ''} 
          onChange={handleChange} 
          required 
        />
      </div>

      <div className="space-y-2">
        <Label>Unidad de Medida</Label>
        <Select 
          value={formData.unidadMedida || formData.unidad || 'unidad'} 
          onValueChange={(val) => onFieldChange('unidadMedida', val)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Seleccione unidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="kg">Kilogramo (kg)</SelectItem>
            <SelectItem value="litro">Litro (L)</SelectItem>
            <SelectItem value="unidad">Unidad (u.)</SelectItem>
            <SelectItem value="gramo">Gramo (g)</SelectItem>
            <SelectItem value="mililitro">Mililitro (ml)</SelectItem>
            <SelectItem value="metro">Metro (m)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Stock Actual</Label>
        <Input 
          name="stock" 
          type="number" 
          step="0.01" 
          value={formData.stock || ''} 
          onChange={handleChange} 
        />
      </div>

      <div className="space-y-2">
        <Label>Stock Mínimo</Label>
        <Input 
          name="minimo" 
          type="number" 
          step="0.01" 
          value={formData.minimo || ''} 
          onChange={handleChange} 
        />
      </div>

      <div className="space-y-2">
        <Label>Precio por Bulto ($)</Label>
        <Input 
          name="precioBulto" 
          type="number" 
          step="0.01" 
          min="0" 
          value={formData.precioBulto || ''} 
          onChange={handleChange} 
        />
      </div>

      <div className="space-y-2">
        <Label>Unidades por Bulto</Label>
        <Input 
          name="unidadesPorBulto" 
          type="number" 
          step="0.01" 
          min="0.01" 
          value={formData.unidadesPorBulto || ''} 
          onChange={handleChange} 
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label>Costo por Unidad (Calculado)</Label>
        <Input 
          readOnly 
          value={`$ ${Number(formData.costoUnitario || 0).toFixed(2)}`} 
          className="bg-gray-100 text-gray-500 cursor-not-allowed font-medium" 
        />
      </div>
    </div>
  );
};

export default RawMaterialFormFields;
