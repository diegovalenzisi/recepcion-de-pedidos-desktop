import { getDatabase, ref, get, set, remove, update } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { v4 as uuidv4 } from 'uuid';

const getPromotionsPath = () => {
  checkLocalId();
  return `${getCurrentLocalId()}/PROMOTIONS`;
};

export const fetchPromotions = async () => {
  const db = getDatabase();
  const snapshot = await get(ref(db, getPromotionsPath()));
  if (snapshot.exists()) {
    const data = snapshot.val();
    return Object.keys(data).map(key => ({
      id: key,
      ...data[key],
      days: data[key].days || [],
      articlesActivate: data[key].articlesActivate || [],
      articlesDeactivate: data[key].articlesDeactivate || []
    }));
  }
  return [];
};

export const validateDayAvailability = async (days, excludePromotionId = null) => {
  const promotions = await fetchPromotions();
  const takenDays = new Set();
  
  promotions.forEach(promo => {
    if (promo.id !== excludePromotionId && promo.status === 'active') {
      promo.days.forEach(day => takenDays.add(day));
    }
  });

  const conflicts = days.filter(day => takenDays.has(day));
  if (conflicts.length > 0) {
    throw new Error(`Los siguientes días ya tienen una promoción activa: ${conflicts.join(', ')}`);
  }
  return true;
};

export const validatePromotionArticles = (deactivateList, activateList) => {
  if (deactivateList.length !== activateList.length) {
    throw new Error('La cantidad de artículos a desactivar debe ser igual a la cantidad de artículos a activar.');
  }
  return true;
};

export const savePromotion = async (promotionData) => {
  if (promotionData.status === 'active') {
    await validateDayAvailability(promotionData.days || []);
  }

  const db = getDatabase();
  const id = uuidv4();
  const newPromo = {
    ...promotionData,
    id,
    articlesActivate: promotionData.articlesActivate || [],
    articlesDeactivate: promotionData.articlesDeactivate || [],
    days: promotionData.days || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await set(ref(db, `${getPromotionsPath()}/${id}`), newPromo);
  return newPromo;
};

export const updatePromotion = async (promotionId, updates) => {
  if (updates.status === 'active' || updates.days) {
    const db = getDatabase();
    const currentSnap = await get(ref(db, `${getPromotionsPath()}/${promotionId}`));
    const currentPromo = currentSnap.val() || {};
    const daysToCheck = updates.days || currentPromo.days || [];
    const statusToCheck = updates.status || currentPromo.status || 'active';
    
    if (statusToCheck === 'active') {
      await validateDayAvailability(daysToCheck, promotionId);
    }
  }

  const db = getDatabase();
  const updateData = {
    ...updates,
    updatedAt: new Date().toISOString()
  };

  await update(ref(db, `${getPromotionsPath()}/${promotionId}`), updateData);
  return { id: promotionId, ...updateData };
};

export const deletePromotion = async (promotionId) => {
  const db = getDatabase();
  await remove(ref(db, `${getPromotionsPath()}/${promotionId}`));
  return true;
};

export const getPromotionsByDay = async (dayOfWeek) => {
  const promotions = await fetchPromotions();
  return promotions.find(p => p.status === 'active' && p.days.includes(dayOfWeek)) || null;
};

export const updatePromotionArticles = async (promotionId, articlesDeactivate, articlesActivate) => {
  validatePromotionArticles(articlesDeactivate, articlesActivate);
  
  const db = getDatabase();
  await update(ref(db, `${getPromotionsPath()}/${promotionId}`), {
    articlesDeactivate,
    articlesActivate,
    updatedAt: new Date().toISOString()
  });
  return true;
};