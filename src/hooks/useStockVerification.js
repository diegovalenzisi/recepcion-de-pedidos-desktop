import { useState, useCallback, useEffect, useRef } from 'react';
import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { useStockStatus } from '@/hooks/useStockStatus';
import { isPromoAvailable } from '@/lib/api/stockAvailability';

/**
 * Hook to verify real-time stock and availability for an array of articles.
 * Combines Firebase snapshot fetching (for accurate parent/child evaluation)
 * with the real-time useStockStatus listener for fallback and rapid updates.
 *
 * @param {Array} articles - Initial array of articles to verify
 * @param {string} context - 'delivery' or 'counter' context to check active flags
 * @param {boolean} isOpen - Whether the modal/component is open (to prevent unnecessary fetches)
 * @param {Array} allProductGroups - Product groups (grupos-productos), used to resolve
 *   group items of promotions with stock.descuentaPorArticulo === true
 */
export const useStockVerification = (articles = [], context = 'delivery', isOpen = false, allProductGroups = []) => {
    const [verifiedArticles, setVerifiedArticles] = useState([]);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState(null);
    
    // Use the real-time stock status hook as requested
    const { outOfStockArticles, lastUpdated } = useStockStatus();
    
    // Store in ref to prevent useCallback dependency cycles
    const outOfStockRef = useRef(outOfStockArticles);
    useEffect(() => {
        outOfStockRef.current = outOfStockArticles;
    }, [outOfStockArticles]);

    const verifyStock = useCallback(async (articlesToVerify) => {
        const list = articlesToVerify || articles;
        if (!list || list.length === 0) {
            setVerifiedArticles([]);
            return;
        }
        
        setIsVerifying(true);
        setError(null);
        
        try {
            const db = getDatabase();
            const localId = getCurrentLocalId();
            const articlesRef = ref(db, `${localId}/ARTICULOS`);
            const snapshot = await get(articlesRef);
            const realTimeArticles = snapshot.val() || {};

            const hasDescuentaPorArticulo = list.some(article => {
                const rtArticle = realTimeArticles[article.id] || article;
                return rtArticle.isPromo && rtArticle.stock?.descuentaPorArticulo === true;
            });

            let materiaPrimaData = {};
            if (hasDescuentaPorArticulo) {
                const mpSnapshot = await get(ref(db, `${localId}/MATERIA_PRIMA`));
                materiaPrimaData = mpSnapshot.val() || {};
            }

            const filtered = list.filter(article => {
                const rtArticle = realTimeArticles[article.id] || article;

                // 1. Verify active status based on context
                const isActive = context === 'delivery' ? rtArticle.activoDelivery !== false : rtArticle.activoMostrador !== false;
                if (!isActive) return false;

                // Promotions that decuct stock from their real components: availability
                // depends on those components, not on the promo's own stock fields.
                if (rtArticle.isPromo && rtArticle.stock?.descuentaPorArticulo === true) {
                    return isPromoAvailable(rtArticle, realTimeArticles, materiaPrimaData, allProductGroups, context);
                }

                // 2. If article explicitly does not control stock, it's available
                if (rtArticle.controlStock === false) return true;

                // 3. Verify real-time stock > 0
                const isInherited = rtArticle.stock?.stockType === 'heredado' || rtArticle.stock?.heredadoDe;
                if (isInherited) {
                    const parentId = rtArticle.stock?.heredadoDe;
                    const parent = realTimeArticles[parentId];
                    
                    if (!parent) return false; // Parent missing entirely
                    
                    // Verify parent's active status
                    const parentIsActive = context === 'delivery' ? parent.activoDelivery !== false : parent.activoMostrador !== false;
                    if (!parentIsActive) return false;
                    
                    // Verify parent's stock > 0
                    const parentStock = parent.stock?.propio !== undefined ? Number(parent.stock.propio) : Number(parent.stock || 0);
                    if (parentStock <= 0) return false;
                } else {
                    // Verify own stock > 0
                    const ownStock = rtArticle.stock?.propio !== undefined ? Number(rtArticle.stock.propio) : Number(rtArticle.stock || 0);
                    if (ownStock <= 0) return false;
                }
                
                return true;
            });

            // 4. Extra safety check against real-time OOS arrays from useStockStatus hook
            // (skipped for promos that decuct stock by real article, since their own
            // stock fields don't represent their actual availability)
            const currentOos = outOfStockRef.current || [];
            const oosIds = new Set(currentOos.map(a => a.codigo || a.id));
            const finalFiltered = filtered.filter(a => {
                if (a.isPromo && a.stock?.descuentaPorArticulo === true) return true;
                if (a.controlStock === false) return true;
                return !oosIds.has(a.id);
            });

            setVerifiedArticles(finalFiltered);
        } catch (err) {
            console.error("Error verifying real-time stock:", err);
            setError(err.message);
            
            // Fallback: Filter locally using the hook's real-time list
            const currentOos = outOfStockRef.current || [];
            const oosIds = new Set(currentOos.map(a => a.codigo || a.id));
            const fallbackFiltered = list.filter(a => {
                const isActive = context === 'delivery' ? a.activoDelivery !== false : a.activoMostrador !== false;
                if (!isActive) return false;
                if (a.controlStock === false) return true;
                return !oosIds.has(a.id);
            });
            setVerifiedArticles(fallbackFiltered);
        } finally {
            setIsVerifying(false);
        }
    }, [articles, context, allProductGroups]);

    // Automatically re-verify when articles change, the modal opens, or real-time stock listener fires
    useEffect(() => {
        if (isOpen && articles.length > 0) {
            verifyStock(articles);
        }
    }, [isOpen, articles, verifyStock, lastUpdated]);

    return { verifiedArticles, isVerifying, error, verifyStock };
};