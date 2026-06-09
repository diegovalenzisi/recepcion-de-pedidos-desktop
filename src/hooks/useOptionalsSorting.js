import { useMemo } from 'react';

/**
 * Sorts an array of optionals based on 'numeroOrden'.
 * Optionals with a 'numeroOrden' take precedence and are sorted ascending.
 * Optionals without a 'numeroOrden' fallback to alphabetical sorting by 'nombre'.
 */
export const sortOptionals = (optionals) => {
  if (!optionals || !Array.isArray(optionals)) return [];
  
  return [...optionals].sort((a, b) => {
    const aHasOrder = a.numeroOrden !== undefined && a.numeroOrden !== null && a.numeroOrden !== '';
    const bHasOrder = b.numeroOrden !== undefined && b.numeroOrden !== null && b.numeroOrden !== '';

    if (aHasOrder && bHasOrder) {
      const orderA = Number(a.numeroOrden);
      const orderB = Number(b.numeroOrden);
      if (orderA === orderB) {
        return (a.nombre || '').localeCompare(b.nombre || '');
      }
      return orderA - orderB;
    }
    
    if (aHasOrder) return -1;
    if (bHasOrder) return 1;
    
    return (a.nombre || '').localeCompare(b.nombre || '');
  });
};

export const useOptionalsSorting = (optionals) => {
  return useMemo(() => sortOptionals(optionals), [optionals]);
};