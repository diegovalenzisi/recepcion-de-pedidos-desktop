import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { sortOptionals } from '@/hooks/useOptionalsSorting';

const OptionalConfig = ({ opcionalesConfig, onOpcionalesConfigChange, allOptionalGroups, allOpcionales }) => {
  const [openOptionalGroups, setOpenOptionalGroups] = useState({});

  const groupedOpcionales = useMemo(() => {
    if (!allOpcionales || !allOptionalGroups) return [];
    return allOptionalGroups.map(group => ({
      ...group,
      opcionales: sortOptionals(allOpcionales.filter(op => op.grupo === group.codigo))
    }));
  }, [allOpcionales, allOptionalGroups]);

  const handleOpcionalGroupConfigChange = (groupCode, field, value, type) => {
    const newConfig = { ...opcionalesConfig };
    const group = groupedOpcionales.find(g => g.codigo === groupCode);
    if (!newConfig[groupCode]) {
      newConfig[groupCode] = { activo: false, min: 0, max: 1, obligatorio: false, opcionales: [] };
    }
    
    let finalValue = value;
    if (type === 'checkbox') {
      finalValue = value;
    } else if (type === 'number') {
      finalValue = parseInt(value, 10) || 0;
    }

    newConfig[groupCode] = { ...newConfig[groupCode], [field]: finalValue };
    
    // AUTOMATIC SYNC: When activating a group, automatically include ALL optionals from that group
    if (field === 'activo') {
      if (finalValue && group) {
        // Auto-sync: Add all optionals from this group
        newConfig[groupCode].opcionales = group.opcionales.map(op => op.codigo);
      } else {
        // When deactivating, clear the optionals list
        newConfig[groupCode].opcionales = [];
      }
    }

    onOpcionalesConfigChange(newConfig);
  };

  const handleOpcionalSelectionChange = (groupCode, opcionalCodigo) => {
    const newConfig = { ...opcionalesConfig };
    if (!newConfig[groupCode]) {
      newConfig[groupCode] = { activo: true, min: 0, max: 1, obligatorio: false, opcionales: [] };
    }
    
    const currentSelection = newConfig[groupCode].opcionales || [];
    const isSelected = currentSelection.includes(opcionalCodigo);
    
    if (isSelected) {
      newConfig[groupCode].opcionales = currentSelection.filter(c => c !== opcionalCodigo);
    } else {
      newConfig[groupCode].opcionales = [...currentSelection, opcionalCodigo];
    }
    
    onOpcionalesConfigChange(newConfig);
  };

  return (
    <div>
      <label className="block text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
        Configuración de Opcionales
        <span className="text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1">
          <Zap className="w-3 h-3" />
          Auto-sincronizado
        </span>
      </label>
      <div className="p-3 border rounded-lg max-h-96 overflow-y-auto space-y-2">
        {groupedOpcionales.map(group => {
          const config = opcionalesConfig[group.codigo] || { activo: false, min: 0, max: 1, obligatorio: false, opcionales: [] };
          const isOpen = openOptionalGroups[group.codigo];

          return (
            <div key={group.codigo} className="border rounded-lg p-3 bg-gray-50">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpenOptionalGroups(prev => ({...prev, [group.codigo]: !prev[group.codigo]}))}>
                <div className="flex items-center">
                  <input 
                    type="checkbox"
                    checked={config.activo}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleOpcionalGroupConfigChange(group.codigo, 'activo', e.target.checked, 'checkbox');
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 mr-3"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <h4 className="font-semibold text-gray-800">{group.nombre}</h4>
                </div>
                <div className="flex items-center space-x-2">
                  {config.activo && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Activo</span>
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        {config.opcionales?.length || 0} opcionales
                      </span>
                    </div>
                  )}
                  {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </div>
              
              <AnimatePresence>
              {isOpen && config.activo && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Mínimo</label>
                        <input type="number" value={config.min} onChange={(e) => handleOpcionalGroupConfigChange(group.codigo, 'min', e.target.value, 'number')} className="input-field-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Máximo</label>
                        <input type="number" value={config.max} onChange={(e) => handleOpcionalGroupConfigChange(group.codigo, 'max', e.target.value, 'number')} className="input-field-sm" />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={config.obligatorio} onChange={(e) => handleOpcionalGroupConfigChange(group.codigo, 'obligatorio', e.target.checked, 'checkbox')} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                          <span className="text-sm text-gray-800">Obligatorio</span>
                        </label>
                      </div>
                    </div>
                    
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-700 flex items-start gap-2">
                      <Zap className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <strong>Auto-sincronización activa:</strong> Cuando se agregan nuevos opcionales a este grupo en el sistema, 
                        se activarán automáticamente en este artículo. Puedes desmarcar opcionales individuales si no los necesitas.
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-2">Opcionales Permitidos</label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {group.opcionales.map(op => (
                          <label key={op.codigo} className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={(config.opcionales || []).includes(op.codigo)}
                              onChange={() => handleOpcionalSelectionChange(group.codigo, op.codigo)}
                              className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                            />
                            <span className="text-sm text-gray-800">{op.nombre}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  );
};

export default OptionalConfig;