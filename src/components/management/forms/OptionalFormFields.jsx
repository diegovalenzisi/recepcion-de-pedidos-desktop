import React from 'react';
import { Textarea } from '@/components/ui/textarea';

const OptionalFormFields = ({ formData, handleChange, allData }) => {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
        <input name="nombre" type="text" className="input-field" placeholder="Ej: Rocklets" value={formData.nombre || ''} onChange={handleChange} required />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
        <Textarea name="descripcion" className="input-field" placeholder="Ej: Pedazos de chocolate confitado" value={formData.descripcion || ''} onChange={handleChange} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Grupo</label>
          <select name="grupo" value={formData.grupo || ''} onChange={handleChange} className="input-field" required>
            <option value="">Seleccione un grupo...</option>
            {(allData['grupos-opcionales'] || []).map(g => (
              <option key={g.codigo} value={g.codigo}>{g.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Número de Orden</label>
          <input 
            name="numeroOrden" 
            type="number" 
            min="1" 
            className="input-field" 
            placeholder="Ej: 1" 
            value={formData.numeroOrden || ''} 
            onChange={handleChange} 
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Precio</label>
        <input name="precio" type="number" className="input-field" placeholder="0.00" value={formData.precio || ''} onChange={handleChange} />
      </div>
      <div className="flex items-center pt-2">
        <input name="activo" type="checkbox" id="activo" className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" checked={formData.activo || false} onChange={handleChange} />
        <label htmlFor="activo" className="ml-2 block text-sm text-gray-900">Activo</label>
      </div>
    </>
  );
};

export default OptionalFormFields;