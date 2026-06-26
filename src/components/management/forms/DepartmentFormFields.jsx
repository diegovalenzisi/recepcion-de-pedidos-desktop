import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const DepartmentFormFields = ({ formData, handleChange }) => {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
        <input name="nombre" type="text" className="input-field" placeholder="Ej: Helados" value={formData.nombre || ''} onChange={handleChange} required />
      </div>
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 mt-4">
        <p className="block text-sm font-bold text-gray-800 mb-2">Configuración de Venta y Visibilidad</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Payment Methods */}
          <div className="space-y-2">
            <p className="font-medium text-gray-700">Métodos de Pago</p>
            <div className="flex items-center">
              <input type="checkbox" id="permiteVentaEfectivo" name="permiteVentaEfectivo" checked={formData.permiteVentaEfectivo || false} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              <label htmlFor="permiteVentaEfectivo" className="ml-2 block text-sm text-gray-900">Admite Venta Efectivo</label>
            </div>
            <div className="flex items-center">
              <input type="checkbox" id="permiteVentaElectronica" name="permiteVentaElectronica" checked={formData.permiteVentaElectronica || false} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              <label htmlFor="permiteVentaElectronica" className="ml-2 block text-sm text-gray-900">Admite Venta Electrónica</label>
            </div>
          </div>
          {/* Availability */}
          <div className="space-y-2">
            <p className="font-medium text-gray-700">Disponibilidad</p>
            <div className="flex items-center">
              <input type="checkbox" id="activoDelivery" name="activoDelivery" checked={formData.activoDelivery || false} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              <label htmlFor="activoDelivery" className="ml-2 block text-sm text-gray-900">Activo en Delivery</label>
            </div>
            <div className="flex items-center">
              <input type="checkbox" id="activoMostrador" name="activoMostrador" checked={formData.activoMostrador || false} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
              <label htmlFor="activoMostrador" className="ml-2 block text-sm text-gray-900">Activo en Mostrador</label>
            </div>
          </div>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Orden Web</label>
        <input name="ordenWeb" type="number" className="input-field" placeholder="Ej: 1" value={formData.ordenWeb || ''} onChange={handleChange} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Orden Local</label>
        <input name="ordenLocal" type="number" className="input-field" placeholder="Ej: 1" value={formData.ordenLocal || ''} onChange={handleChange} />
      </div>
    </>
  );
};

export default DepartmentFormFields;