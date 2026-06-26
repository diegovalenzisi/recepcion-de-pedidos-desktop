/**
 * Firebase Field Mapping Utility
 * 
 * Documents the exact Firebase structure for orders and provides
 * centralized constants to prevent read/write mismatches.
 * 
 * Typical Order Structure regarding deliverers:
 * {
 *   id: "17",
 *   status: { main: "EN DELIVERY", sub: "..." },
 *   deliverer: "DIEGOL" | { nombre: "DIEGOL", id: "..." } // Primary field
 *   // Legacy fields sometimes found:
 *   // repartidor: { nombre: "DIEGOL" }
 *   // delivererName: "DIEGOL"
 * }
 */

export const ORDER_FIELDS = {
  DELIVERER: 'deliverer', // The official field name we should be reading/saving to
  REPARTIDOR_FALLBACK: 'repartidor',
  DELIVERER_NAME_FALLBACK: 'delivererName'
};

/**
 * Robustly extracts the deliverer name from an order object,
 * checking the primary 'deliverer' field first, then falling back to legacy fields.
 */
export const extractDelivererName = (order, componentName = 'Unknown') => {
  if (!order) return 'Sin asignar';
  
  let name = 'Sin asignar';

  // 1. Check primary field 'deliverer'
  if (order[ORDER_FIELDS.DELIVERER]) {
      const rep = order[ORDER_FIELDS.DELIVERER];
      if (typeof rep === 'object' && rep !== null && rep.nombre) {
          name = rep.nombre;
      } else if (typeof rep === 'string' && rep.trim() !== '') {
          name = rep;
      }
  }
  // 2. Check fallback 'repartidor'
  else if (order[ORDER_FIELDS.REPARTIDOR_FALLBACK]) {
      const rep = order[ORDER_FIELDS.REPARTIDOR_FALLBACK];
      if (typeof rep === 'object' && rep !== null && rep.nombre) {
          name = rep.nombre;
      } else if (typeof rep === 'string' && rep.trim() !== '') {
          name = rep;
      }
  }
  // 3. Check fallback 'delivererName'
  else if (order[ORDER_FIELDS.DELIVERER_NAME_FALLBACK] && typeof order[ORDER_FIELDS.DELIVERER_NAME_FALLBACK] === 'string' && order[ORDER_FIELDS.DELIVERER_NAME_FALLBACK].trim() !== '') {
      name = order[ORDER_FIELDS.DELIVERER_NAME_FALLBACK];
  }

  return name;
};