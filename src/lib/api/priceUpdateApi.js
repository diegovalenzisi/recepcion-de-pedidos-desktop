import { getDatabase, ref, get, update, push, remove } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { savePriceHistory } from './PriceHistoryApi';
import { fetchAndCacheDepartments, mapDepartmentIdToName, validatePriceData, fetchAndMapDepartmentNames, getDepartmentName } from './priceUpdateUtils';

export const validatePrice = (price) => {
  const num = Number(price);
  return !isNaN(num) && num >= 0;
};

export const fetchAllArticles = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  
  const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
  
  const [articlesSnap, deptsData] = await Promise.all([
    get(articlesRef),
    fetchAndCacheDepartments()
  ]);
  
  if (!articlesSnap.exists()) return [];
  
  const articlesData = articlesSnap.val();
  
  return Object.keys(articlesData).map(key => {
    const article = articlesData[key];
    const deptId = article.departamento;
    const deptName = mapDepartmentIdToName(deptId, deptsData);
    
    return {
      id: key,
      ...article,
      codigo: article.codigo || key,
      departamentoId: deptId,
      departamento: deptName
    };
  });
};

export const updateArticlePrices = async (articles, userName, tipo = 'inmediato') => {
  if (!articles || articles.length === 0) throw new Error("No hay artículos para actualizar");

  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const updates = {};
  const historyEntries = [];
  const now = new Date();
  const fecha = now.toISOString().split('T')[0];
  const hora = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  articles.forEach(article => {
    const newPrice = Number(article.precio_nuevo || article.newPrice);
    const validation = validatePriceData(newPrice, article.codigo || article.id, article.mappedDeptName || article.departamento);
    
    if (!validation.isValid) {
      throw new Error(`Error en artículo ${article.codigo}: ${validation.errors.join(', ')}`);
    }

    updates[`${LOCAL_ID}/ARTICULOS/${article.id}/valor`] = newPrice;
    historyEntries.push({
      codigo: article.codigo || article.id,
      nombre: article.nombre,
      departamento: article.mappedDeptName || article.departamento || 'Sin Departamento',
      precio_anterior: article.valor || 0,
      precio_nuevo: newPrice,
      fecha,
      hora,
      usuario: userName || 'Sistema',
      tipo
    });
  });

  await update(ref(db), updates);
  await savePriceHistory(historyEntries);
  return true;
};

export const saveScheduledUpdate = async (updateData) => {
  if (!updateData.changes || updateData.changes.length === 0) throw new Error("No hay cambios programados");
  if (!updateData.date) throw new Error("Fecha de programación inválida");

  // Validate all items before saving
  updateData.changes.forEach(article => {
    const newPrice = Number(article.precio_nuevo || article.newPrice);
    const deptName = article.mappedDeptName || article.departamento;
    const validation = validatePriceData(newPrice, article.codigo, deptName);
    if (!validation.isValid) {
      throw new Error(`Error en artículo ${article.codigo}: ${validation.errors.join(', ')}`);
    }
    // ensure mapped dept name is saved
    article.departamento = deptName;
  });

  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const scheduledRef = ref(db, `${LOCAL_ID}/ACTUALIZACIONES_PROGRAMADAS`);
  await push(scheduledRef, {
    ...updateData,
    status: 'pending',
    createdAt: Date.now()
  });
};

export const fetchScheduledUpdates = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const scheduledRef = ref(db, `${LOCAL_ID}/ACTUALIZACIONES_PROGRAMADAS`);
  
  const [snapshot, deptMap] = await Promise.all([
    get(scheduledRef),
    fetchAndMapDepartmentNames()
  ]);
  
  if (!snapshot.exists()) return [];
  
  const data = snapshot.val();
  return Object.keys(data)
    .map(key => {
      const updateEntry = data[key];
      
      // Enrich with department names
      if (updateEntry.changes) {
        updateEntry.changes = updateEntry.changes.map(change => ({
          ...change,
          departamentoId: change.departamentoId || change.departamento,
          departamento: getDepartmentName(change.departamentoId || change.departamento, deptMap) !== '-' 
            ? getDepartmentName(change.departamentoId || change.departamento, deptMap) 
            : change.departamento
        }));
      }

      return { id: key, ...updateEntry };
    })
    .filter(update => update.status === 'pending');
};

export const cancelScheduledUpdate = async (updateId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const updateRef = ref(db, `${LOCAL_ID}/ACTUALIZACIONES_PROGRAMADAS/${updateId}`);
  await remove(updateRef);
};