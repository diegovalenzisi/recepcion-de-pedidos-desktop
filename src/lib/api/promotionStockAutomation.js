import { getDatabase, ref, get, update, onValue, off } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

/**
 * Checks all promotions and updates their active status based on stock availability
 * of their included articles.
 * @returns {Promise<{disabledCount: number, enabledCount: number, disabledPromos: string[], enabledPromos: string[]}>}
 */
export const checkAndUpdatePromotionStockStatus = async () => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    try {
        const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
        const snapshot = await get(articlesRef);
        
        const summary = {
            disabledCount: 0,
            enabledCount: 0,
            disabledPromos: [],
            enabledPromos: []
        };

        if (!snapshot.exists()) return summary;

        const articlesData = snapshot.val();
        const updates = {};

        for (const [key, item] of Object.entries(articlesData)) {
            // Check if it's a promo
            if (item.isPromo) {
                const promoItems = item.promoItems || item.promoDetails || [];
                if (promoItems.length === 0) continue;

                let hasOutOfStock = false;
                
                // Check stock of all articles in the promo
                for (const pItem of promoItems) {
                    const targetId = pItem.codigo || pItem.id;
                    const targetArt = articlesData[targetId];
                    
                    if (targetArt && targetArt.stock && targetArt.stock.propio === 0) {
                        hasOutOfStock = true;
                        break;
                    }
                }

                if (hasOutOfStock) {
                    if (item.activoDelivery !== false) {
                        updates[`${LOCAL_ID}/ARTICULOS/${key}/hadDeliveryEnabled`] = true;
                        updates[`${LOCAL_ID}/ARTICULOS/${key}/activoDelivery`] = false;
                        summary.disabledCount++;
                        summary.disabledPromos.push(item.nombre || key);
                    }
                } else {
                    if (item.hadDeliveryEnabled === true) {
                        updates[`${LOCAL_ID}/ARTICULOS/${key}/hadDeliveryEnabled`] = false;
                        updates[`${LOCAL_ID}/ARTICULOS/${key}/activoDelivery`] = true;
                        summary.enabledCount++;
                        summary.enabledPromos.push(item.nombre || key);
                    }
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
        }

        return summary;
    } catch (error) {
        console.error("Error in checkAndUpdatePromotionStockStatus:", error);
        return { disabledCount: 0, enabledCount: 0, disabledPromos: [], enabledPromos: [] };
    }
};

/**
 * Sets up a real-time listener for stock changes across articles to trigger promo stock updates
 * @param {Function} callback Optional callback to trigger on updates
 * @returns {Function} Unsubscribe function
 */
export const listenToPromotionStockChanges = (callback) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    // Listen to changes in stock transactions or articles 
    // We listen to the root of articles since we need to check stock
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    
    let isInitialLoad = true;
    
    const listener = onValue(articlesRef, async (snapshot) => {
        if (isInitialLoad) {
            isInitialLoad = false;
            return;
        }
        
        // Debounce or directly run the check
        const summary = await checkAndUpdatePromotionStockStatus();
        if (callback && (summary.disabledCount > 0 || summary.enabledCount > 0)) {
            callback(summary);
        }
    });

    return () => off(articlesRef, 'value', listener);
};

/**
 * Gets the current stock status of a specific promotion and its articles
 * @param {string} promotionId ID of the promotion to check
 * @returns {Promise<{hasOutOfStock: boolean, outOfStockArticles: any[], allArticles: any[]}>}
 */
export const getPromotionArticleStockStatus = async (promotionId) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    const result = {
        hasOutOfStock: false,
        outOfStockArticles: [],
        allArticles: []
    };

    try {
        const promoRef = ref(db, `${LOCAL_ID}/ARTICULOS/${promotionId}`);
        const promoSnap = await get(promoRef);
        
        if (!promoSnap.exists()) return result;
        
        const promoData = promoSnap.val();
        const promoItems = promoData.promoItems || promoData.promoDetails || [];
        
        if (promoItems.length === 0) return result;

        const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
        const articlesSnap = await get(articlesRef);
        const articlesData = articlesSnap.val() || {};

        for (const pItem of promoItems) {
            const targetId = pItem.codigo || pItem.id;
            const targetArt = articlesData[targetId];
            
            if (targetArt) {
                const articleInfo = {
                    id: targetId,
                    nombre: targetArt.nombre,
                    stock: targetArt.stock?.propio || 0
                };
                
                result.allArticles.push(articleInfo);
                
                if (articleInfo.stock === 0) {
                    result.hasOutOfStock = true;
                    result.outOfStockArticles.push(articleInfo);
                }
            }
        }
    } catch (error) {
        console.error("Error in getPromotionArticleStockStatus:", error);
    }

    return result;
};