import { getDatabase, ref, get, update } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';

/**
 * Stock Delivery Automation Module
 * Automatically manages delivery channel availability based on stock levels
 * Applies to articles with own stock and their inherited children
 */

export const shouldAutoToggleDelivery = (article) => {
  if (!article) return false;
  
  const hasOwnStock = article.stock?.stockType === 'propio' || 
                      (article.stock?.propio !== undefined && article.stock?.propio !== null);
  
  const hasInheritedStock = article.stock?.stockType === 'heredado' || article.stock?.heredadoDe;
  
  return hasOwnStock || hasInheritedStock;
};

/**
 * Validates and updates the delivery status of all articles that inherit stock
 * from the specified parent article. Uses recursion to handle multi-level inheritance.
 * @param {string} parentId - Parent Article ID
 * @param {number} parentStockValue - The new stock value of the parent
 */
export const validateInheritedStockStatus = async (parentId, parentStockValue) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation(LOCAL_ID);
  const db = op.getDatabaseOrAbort();

  try {
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    const snapshot = await get(articlesRef);
    
    if (!snapshot.exists()) return;
    
    const articlesData = snapshot.val();
    const updates = {};
    const isDepleted = parentStockValue === 0;
    const timestamp = Date.now();
    const visited = new Set();
    
    const traverse = (currentParentId, isParentDepleted) => {
      for (const [articleId, article] of Object.entries(articlesData)) {
        const isInherited = (article.stock?.stockType === 'heredado' && article.stock?.heredadoDe === currentParentId) ||
                            (article.stock?.heredadoDe === currentParentId);
        
        if (isInherited && !visited.has(articleId)) {
          visited.add(articleId);
          
          if (isParentDepleted) {
            const isCurrentlyActive = article.activoDelivery !== false;
            if (isCurrentlyActive) {
              // Parent depleted -> disable child delivery and save state
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/activoDelivery`] = false;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = true;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/lastAutoToggle`] = timestamp;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/autoToggleReason`] = 'cascade_stock_depleted';
              console.log(`[Stock Automation] Disabled delivery for inherited child ${articleId} (parent ${currentParentId} depleted). Saving hadDeliveryEnabled=true.`);
            } else if (article.hadDeliveryEnabled !== false) {
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = false;
            }
          } else {
            // Parent replenished -> enable child delivery ONLY if it was previously active
            console.log(`[Stock Automation] Evaluating inherited child ${articleId} for replenishment. hadDeliveryEnabled=${article.hadDeliveryEnabled}`);
            if (article.hadDeliveryEnabled === true) {
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/activoDelivery`] = true;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = false;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/lastAutoToggle`] = timestamp;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/autoToggleReason`] = 'cascade_stock_replenished';
              console.log(`[Stock Automation] Restored delivery for inherited child ${articleId} (parent ${currentParentId} replenished)`);
            } else if (article.hadDeliveryEnabled !== false) {
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = false;
            }
          }
          
          // Recursively traverse children of this child
          traverse(articleId, isParentDepleted);
        }
      }
    };
    
    traverse(parentId, isDepleted);
    
    if (Object.keys(updates).length > 0) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      await update(ref(op.getDatabaseOrAbort()), updates);
      console.log(`[Stock Automation] Applied ${Object.keys(updates).length} cascade updates for parent ${parentId}`);
    }
  } catch (error) {
    console.error(`[Stock Automation] Error validating inherited stock for parent ${parentId}:`, error);
  }
};

export const handleStockDepletion = async (articleId, currentStock, previousStock, isOwnStock) => {
  console.log(`[Stock Automation] handleStockDepletion triggered for ${articleId}. Stock: ${previousStock} -> ${currentStock}.`);
  // Always validate inherited children first if this article is a parent
  await validateInheritedStockStatus(articleId, currentStock);

  if (!isOwnStock) return;
  if (currentStock !== 0 || previousStock <= 0) return;

  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation(LOCAL_ID);
  const db = op.getDatabaseOrAbort();

  try {
    const articleRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}`);
    const snapshot = await get(articleRef);

    if (!snapshot.exists()) {
      console.warn(`[Stock Automation] Article ${articleId} not found`);
      return;
    }

    const articleData = snapshot.val();
    const isCurrentlyActive = articleData.activoDelivery !== false;
    const updates = {};

    if (isCurrentlyActive) {
      updates.hadDeliveryEnabled = true;
      updates.activoDelivery = false;
      updates.lastAutoToggle = Date.now();
      updates.autoToggleReason = 'stock_depleted';
      console.log(`[Stock Automation] Disabled delivery for ${articleId} (stock depleted). Saving hadDeliveryEnabled=true.`);
      console.log(`[DELIVERY AUTO STOCK] articulo=${articleId} stock=${currentStock} estadoAnterior=true desactivadoPorStock=true restaurado=false`);
    } else if (articleData.hadDeliveryEnabled !== false) {
      updates.hadDeliveryEnabled = false;
    }

    if (Object.keys(updates).length > 0) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      const freshArticleRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/ARTICULOS/${articleId}`);
      await update(freshArticleRef, updates);
    }
  } catch (error) {
    console.error(`[Stock Automation] Error handling depletion for ${articleId}:`, error);
    throw error;
  }
};

export const handleStockReplenishment = async (articleId, currentStock, previousStock, isOwnStock) => {
  console.log(`[Stock Automation] handleStockReplenishment triggered for ${articleId}. Stock: ${previousStock} -> ${currentStock}.`);
  // Always validate inherited children first if this article is a parent
  await validateInheritedStockStatus(articleId, currentStock);

  if (!isOwnStock) return;
  if (previousStock !== 0 || currentStock <= 0) return;

  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation(LOCAL_ID);
  const db = op.getDatabaseOrAbort();

  try {
    const articleRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}`);
    const snapshot = await get(articleRef);

    if (!snapshot.exists()) {
      console.warn(`[Stock Automation] Article ${articleId} not found`);
      return;
    }

    const articleData = snapshot.val();
    const updates = {};

    console.log(`[Stock Automation] Evaluating ${articleId} for replenishment: hadDeliveryEnabled=${articleData.hadDeliveryEnabled}`);

    if (articleData.hadDeliveryEnabled === true) {
      updates.hadDeliveryEnabled = false;
      updates.activoDelivery = true;
      updates.lastAutoToggle = Date.now();
      updates.autoToggleReason = 'stock_replenished';
      console.log(`[Stock Automation] Restored delivery for ${articleId} (stock replenished). Resetting hadDeliveryEnabled=false.`);
      console.log(`[DELIVERY AUTO STOCK] articulo=${articleId} stock=${currentStock} estadoAnterior=true desactivadoPorStock=false restaurado=true`);
    } else if (articleData.hadDeliveryEnabled !== false) {
      updates.hadDeliveryEnabled = false;
    }

    if (Object.keys(updates).length > 0) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      const freshArticleRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/ARTICULOS/${articleId}`);
      await update(freshArticleRef, updates);
    }
  } catch (error) {
    console.error(`[Stock Automation] Error handling replenishment for ${articleId}:`, error);
    throw error;
  }
};

export const fetchAffectedArticles = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    const snapshot = await get(articlesRef);
    
    if (!snapshot.exists()) return [];
    
    const articlesData = snapshot.val();
    const affectedArticles = [];
    
    for (const [articleId, articleData] of Object.entries(articlesData)) {
      if (articleData.hadDeliveryEnabled === true && shouldAutoToggleDelivery(articleData)) {
        affectedArticles.push({
          id: articleId,
          codigo: articleId,
          nombre: articleData.nombre,
          stock: articleData.stock?.propio !== undefined ? articleData.stock.propio : 0,
          activoDelivery: articleData.activoDelivery,
          hadDeliveryEnabled: articleData.hadDeliveryEnabled,
          lastAutoToggle: articleData.lastAutoToggle,
          autoToggleReason: articleData.autoToggleReason,
          departamento: articleData.departamento
        });
      }
    }
    
    return affectedArticles.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  } catch (error) {
    console.error('[Stock Automation] Error fetching affected articles:', error);
    throw error;
  }
};

export const manualOverrideDelivery = async (articleId, newDeliveryStatus) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const articleRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}`);
    
    const updates = {
      activoDelivery: newDeliveryStatus,
      hadDeliveryEnabled: newDeliveryStatus, // Sync state when manually overridden
      lastAutoToggle: Date.now(),
      autoToggleReason: 'manual_override'
    };
    
    await update(articleRef, updates);
    console.log(`[Stock Automation] Manual override for ${articleId}: delivery ${newDeliveryStatus ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error(`[Stock Automation] Error during manual override for ${articleId}:`, error);
    throw error;
  }
};