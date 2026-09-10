import { useState, useCallback, useEffect, useRef } from 'react';
import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { useStockStatus } from '@/hooks/useStockStatus';
import { isArticleAvailable, isPromoAvailable } from '@/lib/api/stockAvailability';
import { tipoDeStock } from '@/lib/api/disponibilidadReceta';

/**
 * Hook to verify real-time stock and availability for an array of articles.
 * Combines Firebase snapshot fetching (for accurate parent/child evaluation)
 * with the real-time useStockStatus listener for fallback and rapid updates.
 *
 * MOSTRADOR Y DELIVERY USAN ESTA MISMA FUNCIÓN, con la misma regla.
 *
 * La disponibilidad se CALCULA en vivo con `isArticleAvailable`
 * (stockAvailability.js → disponibilidadReceta.js, canónico). No se lee ninguna
 * marca persistida de "agotado": lo único persistido que se respeta es el activo
 * MANUAL del canal (`activoDelivery` / `activoMostrador`), que jamás se escribe
 * desde acá.
 *
 * Antes este filtro solo entendía stock propio y heredado. Un artículo por
 * receta caía en `Number(stock)` sobre un objeto → NaN → `NaN <= 0` es false →
 * pasaba SIEMPRE. En Delivery el artículo igual desaparecía, pero por otro
 * motivo (una automatización le apagaba `activoDelivery` en Firebase); en
 * Mostrador nadie apaga `activoMostrador`, así que quedaba visible con la
 * materia prima en cero. Ahora los dos canales deciden por cálculo.
 *
 * MATERIA_PRIMA se lee SIEMPRE: sin ella no se puede evaluar ninguna receta.
 * Antes solo se leía cuando había una promo con `descuentaPorArticulo`.
 *
 * @param {Array} articles - Initial array of articles to verify
 * @param {string} context - 'delivery' or 'counter' context to check active flags
 * @param {boolean} isOpen - Whether the modal/component is open (to prevent unnecessary fetches)
 * @param {Array} allProductGroups - Product groups (grupos-productos), usados para resolver
 *   los grupos de elección de CUALQUIER promo con promoItems (no solo las que tengan
 *   stock.descuentaPorArticulo === true — ver isPromoAvailable más abajo)
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

            // ARTICULOS y MATERIA_PRIMA SIEMPRE, y del mismo instante: evaluar una
            // receta exige las dos mitades del dato.
            const [snapshot, mpSnapshot] = await Promise.all([
                get(ref(db, `${localId}/ARTICULOS`)),
                get(ref(db, `${localId}/MATERIA_PRIMA`)),
            ]);
            const realTimeArticles = snapshot.val() || {};
            const materiaPrimaData = mpSnapshot.val() || {};

            // Catálogo sobre el que se evalúa: manda el snapshot fresco, y la copia
            // local solo rellena un artículo que todavía no esté en él. Sin esto, un
            // artículo ausente del snapshot se resolvería como "no existe" → oculto.
            const catalogo = { ...Object.fromEntries(list.map(a => [a.id, a])), ...realTimeArticles };

            const filtered = list.filter(article => {
                const rtArticle = catalogo[article.id] || article;

                // Cualquier promo con promoItems se evalúa por sus componentes reales:
                // NO por "algún artículo obligatorio se agotó" (every) sino por
                // "cada ítem obligatorio disponible Y cada grupo con al menos las
                // opciones necesarias para completar la elección" (some/cantidad
                // mínima) — ver isPromoAvailable. `descuentaPorArticulo` es un flag
                // de CÓMO se descuenta el stock al vender, no de disponibilidad: una
                // promo armada con promoItems casi nunca tiene un `stock` propio
                // significativo, así que antes (gateado detrás de ese flag) la
                // mayoría de las promos cayían al camino de abajo y se evaluaban
                // contra su propio `stock` inexistente/heredado roto, en vez de
                // contra sus componentes reales.
                const promoItems = rtArticle.promoItems || rtArticle.promoDetails || [];
                if (rtArticle.isPromo && promoItems.length > 0) {
                    const isActive = context === 'delivery' ? rtArticle.activoDelivery !== false : rtArticle.activoMostrador !== false;
                    if (!isActive) return false;
                    return isPromoAvailable(rtArticle, catalogo, materiaPrimaData, allProductGroups, context);
                }

                // Regla ÚNICA: activo manual del canal + poder producir 1 unidad
                // (stock propio, heredado o receta con las cantidades reales).
                return isArticleAvailable(article.id, catalogo, materiaPrimaData, context);
            });

            // 4. Extra safety check against real-time OOS arrays from useStockStatus hook
            // (skipped for promos con componentes reales, ya evaluadas arriba por
            // isPromoAvailable: su propio `stock` no representa su disponibilidad)
            //
            // Esta red mira SOLO `stock.propio` / `stock.heredado`, así que no aplica a
            // un artículo por receta: ahí `propio` no significa nada (suele quedar en 0
            // como resto de una configuración anterior) y taparía la decisión correcta
            // que ya tomó `isArticleAvailable`. Para esos artículos manda el cálculo.
            const currentOos = outOfStockRef.current || [];
            const oosIds = new Set(currentOos.map(a => a.codigo || a.id));
            const finalFiltered = filtered.filter(a => {
                const aPromoItems = a.promoItems || a.promoDetails || [];
                if (a.isPromo && aPromoItems.length > 0) return true;
                if (a.controlStock === false) return true;
                if (tipoDeStock((catalogo[a.id] || a).stock) === 'receta') return true;
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