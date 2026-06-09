import { useMemo } from 'react';

export const useDeliveryOrderColors = (mode = 'pastel') => {
  const colors = useMemo(() => {
    const isSaturated = mode === 'saturated';

    // Background colors based on mode
    const backgrounds = {
      COMANDADO: isSaturated ? 'bg-orange-500' : 'bg-orange-100',
      'EN DELIVERY': isSaturated ? 'bg-blue-500' : 'bg-blue-100',
      ENTREGADO: isSaturated ? 'bg-green-500' : 'bg-green-100',
      CANCELADO: isSaturated ? 'bg-red-500' : 'bg-red-100',
      ACEPTADO: isSaturated ? 'bg-slate-500' : 'bg-slate-300',
      default: isSaturated ? 'bg-gray-200' : 'bg-white'
    };

    // Text colors (without black text override)
    const texts = {
      COMANDADO: isSaturated ? 'text-white' : 'text-orange-900',
      'EN DELIVERY': isSaturated ? 'text-white' : 'text-blue-900',
      ENTREGADO: isSaturated ? 'text-white' : 'text-green-900',
      CANCELADO: isSaturated ? 'text-white' : 'text-red-900',
      ACEPTADO: isSaturated ? 'text-white' : 'text-slate-900',
      default: isSaturated ? 'text-gray-900' : 'text-gray-900'
    };

    return { backgrounds, texts };
  }, [mode]);

  const getRowStyles = (status, useBlackText = false) => {
    const bgClass = colors.backgrounds[status] || colors.backgrounds.default;
    
    // Base text color logic
    let textClass = '';
    
    if (useBlackText) {
      textClass = 'text-black';
    } else {
      textClass = colors.texts[status] || colors.texts.default;
    }
    
    // Additional styling for cancelled
    const decorationClass = status === 'CANCELADO' ? 'line-through' : '';

    return {
      bgClass,
      textClass,
      decorationClass,
      fullClass: `${bgClass} ${textClass} ${decorationClass}`
    };
  };

  return { getRowStyles, mode };
};