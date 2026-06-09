import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

let departmentsCache = null;

export const fetchAndCacheDepartments = async (forceRefresh = false) => {
  if (departmentsCache && !forceRefresh) return departmentsCache;
  
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const deptsRef = ref(db, `${LOCAL_ID}/DEPARTAMENTOS`);
  
  try {
    const snap = await get(deptsRef);
    if (snap.exists()) {
      departmentsCache = snap.val();
      return departmentsCache;
    }
    return {};
  } catch (error) {
    console.error("Error fetching departments:", error);
    return {};
  }
};

export const fetchAndMapDepartmentNames = async () => {
  try {
    const depts = await fetchAndCacheDepartments();
    const map = {};
    if (depts) {
      Object.keys(depts).forEach(key => {
        map[key] = depts[key].nombre || key;
      });
    }
    return map;
  } catch (error) {
    console.error("Error mapping department names:", error);
    return {};
  }
};

export const getDepartmentName = (departmentId, departmentMap) => {
  if (!departmentId || !departmentMap) return "-";
  // If it's already exactly mapped or exists in the map
  if (departmentMap[departmentId]) return departmentMap[departmentId];
  // If we suspect the ID is already a name that wasn't found in keys, but want strict fallback:
  // For backward compatibility where departmentId might already be the name:
  const isName = Object.values(departmentMap).includes(departmentId);
  return isName ? departmentId : "-";
};

export const mapDepartmentIdToName = (deptId, depts) => {
  if (!deptId) return 'Sin Departamento';
  if (depts && depts[deptId] && depts[deptId].nombre) {
    return depts[deptId].nombre;
  }
  return deptId;
};

export const validatePriceData = (price, code, department) => {
  const errors = [];
  const num = Number(price);
  
  if (price === '' || price === undefined || price === null || isNaN(num) || num < 0) {
    errors.push("Precio debe ser 0 o positivo");
  }
  if (!code || String(code).trim() === '') {
    errors.push("El código del artículo es inválido.");
  }
  if (!department || String(department).trim() === '' || department === '-') {
    errors.push("El departamento es inválido.");
  }
  return {
    isValid: errors.length === 0,
    errors
  };
};

export const formatPriceChangeSummary = (changes) => {
  if (!changes || changes.length === 0) return "No hay cambios para guardar.";
  const total = changes.length;
  const sample = changes.slice(0, 5).map(c => `- ${c.codigo} (${c.nombre}): $${c.valor || c.precio_anterior || 0} → $${c.precio_nuevo}`).join('\n');
  return `Se actualizarán ${total} artículos en total.\n\nEjemplos:\n${sample}${total > 5 ? '\n...y otros ' + (total - 5) + ' artículos.' : ''}`;
};