import React from 'react';

const TachoFormFields = ({ formData, handleChange }) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Orden</label>
          <input
            name="orden"
            type="number"
            className="input-field"
            value={formData.orden || 0}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
          <input
            name="nombre"
            type="text"
            className="input-field"
            value={formData.nombre || ''}
            onChange={handleChange}
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
        <input
          name="stock"
          type="number"
          step="0.01"
          className="input-field"
          value={formData.stock || 0}
          onChange={handleChange}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Debería Haber</label>
        <input
          name="deberiaHaber"
          type="number"
          step="0.01"
          className="input-field"
          value={formData.deberiaHaber || 0}
          onChange={handleChange}
        />
      </div>
    </div>
  );
};

export default TachoFormFields;