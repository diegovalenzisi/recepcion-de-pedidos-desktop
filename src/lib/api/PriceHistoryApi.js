import { getDatabase, ref, get, push, remove } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

export const savePriceHistory = async (changes) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const historyRef = ref(db, `priceHistory/${LOCAL_ID}`);
  
  const promises = changes.map(change => {
    if (!change.departamento) {
      console.warn(`Artículo ${change.codigo} no tiene departamento asociado. Se guardará como "Sin Departamento".`);
    }

    const record = {
      codigo: change.codigo || '',
      nombre: change.nombre || '',
      departamento: change.departamento || 'Sin Departamento',
      precio_anterior: Number(change.precio_anterior) || 0,
      precio_nuevo: Number(change.precio_nuevo) || 0,
      fecha: change.fecha || new Date().toISOString().split('T')[0],
      hora: change.hora || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      usuario: change.usuario || 'Sistema',
      tipo: change.tipo || 'inmediato',
      timestamp: Date.now()
    };
    return push(historyRef, record);
  });
  
  await Promise.all(promises);
};

export const fetchPriceHistoryByDateRange = async (startDate, endDate) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const historyRef = ref(db, `priceHistory/${LOCAL_ID}`);
  const snapshot = await get(historyRef);
  
  if (!snapshot.exists()) return [];
  
  const data = snapshot.val();
  let history = Object.keys(data).map(key => ({ id: key, ...data[key] }));
  
  if (startDate && endDate) {
    history = history.filter(item => {
      const itemDate = new Date(item.timestamp);
      return itemDate >= startDate && itemDate <= endDate;
    });
  }
  
  return history.sort((a, b) => b.timestamp - a.timestamp);
};

export const deletePriceHistoryRecord = async (recordId) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const recordRef = ref(db, `priceHistory/${LOCAL_ID}/${recordId}`);
  await remove(recordRef);
};