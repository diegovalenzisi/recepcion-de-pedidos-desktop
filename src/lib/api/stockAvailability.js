/**
 * Shared helpers to evaluate the real stock availability of an article,
 * resolving propio/heredado/receta chains, and of a promotion based on
 * the real components that make it up (fixed items and product groups).
 *
 * Used only when an article's `stock.descuentaPorArticulo` flag is true.
 * Promotions/articles without that flag are not affected by this module.
 */

const getStockType = (stock) => {
    if (!stock) return 'propio';
    if (stock.stockType) return stock.stockType;
    if (stock.receta && typeof stock.receta === 'object' && Object.keys(stock.receta).length > 0) return 'receta';
    if (stock.heredadoDe) return 'heredado';
    return 'propio';
};

/**
 * Recursively checks whether an article (or raw material) has stock available,
 * following heredado/receta chains. Mirrors the resolution logic used by
 * resolveStockImpact in transactionsApi.js.
 */
export const isArticleAvailable = (articleId, articlesData = {}, materiaPrimaData = {}, context = 'delivery', visited = new Set()) => {
    if (!articleId || visited.has(articleId)) return false;
    visited.add(articleId);

    const article = articlesData[articleId];
    if (article) {
        const isActive = context === 'delivery' ? article.activoDelivery !== false : article.activoMostrador !== false;
        if (!isActive) return false;

        if (article.controlStock === false) return true;

        const stock = article.stock || {};
        const stockType = getStockType(stock);

        if (stockType === 'heredado' && stock.heredadoDe) {
            return isArticleAvailable(stock.heredadoDe, articlesData, materiaPrimaData, context, visited);
        }

        if (stockType === 'receta' && stock.receta) {
            const receta = stock.receta;
            const ingredientIds = Array.isArray(receta)
                ? receta.map(ing => ing.codigo || ing.id || ing.nombre).filter(Boolean)
                : Object.keys(receta);

            if (ingredientIds.length === 0) return true;
            return ingredientIds.every(ingredientId => isArticleAvailable(ingredientId, articlesData, materiaPrimaData, context, visited));
        }

        return Number(stock.propio || 0) > 0;
    }

    const rawMaterial = materiaPrimaData[articleId];
    if (rawMaterial) {
        if (rawMaterial.controlStock === false) return true;
        if (rawMaterial.heredadoDe) {
            return isArticleAvailable(rawMaterial.heredadoDe, articlesData, materiaPrimaData, context, visited);
        }
        return Number(rawMaterial.stock || 0) > 0;
    }

    return false;
};

/**
 * Returns the list of article ids that can be chosen for a promo group item:
 * the explicit `permitidos` list if set, otherwise all articles of the group.
 */
export const getGroupOptionIds = (promoItem, productGroups = []) => {
    const group = (productGroups || []).find(g => g.id === promoItem.grupoId);
    const groupArticleIds = group?.articulos || [];
    return (promoItem.permitidos && promoItem.permitidos.length > 0) ? promoItem.permitidos : groupArticleIds;
};

/**
 * Determines whether a promotion is sellable based on the real availability
 * of its components: every fixed item must be available, and for each group
 * item at least one of its allowed options must be available.
 */
export const isPromoAvailable = (promoArticle, articlesData = {}, materiaPrimaData = {}, productGroups = [], context = 'delivery') => {
    const promoItems = promoArticle.promoItems || promoArticle.promoDetails || [];
    if (promoItems.length === 0) return true;

    for (const pItem of promoItems) {
        if (pItem.tipo === 'grupo') {
            const optionIds = getGroupOptionIds(pItem, productGroups);
            if (optionIds.length === 0) continue;
            const anyAvailable = optionIds.some(id => isArticleAvailable(id, articlesData, materiaPrimaData, context));
            if (!anyAvailable) return false;
        } else {
            const targetId = pItem.codigo || pItem.id;
            if (!targetId) continue;
            if (!isArticleAvailable(targetId, articlesData, materiaPrimaData, context)) return false;
        }
    }

    return true;
};
