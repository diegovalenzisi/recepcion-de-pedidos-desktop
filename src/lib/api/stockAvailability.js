/**
 * Shared helpers to evaluate the real stock availability of an article,
 * resolving propio/heredado/receta chains, and of a promotion based on
 * the real components that make it up (fixed items and product groups).
 *
 * Used only when an article's `stock.descuentaPorArticulo` flag is true.
 * Promotions/articles without that flag are not affected by this module.
 *
 * "Ignora Stock" (MATERIA_PRIMA/{id}/ignoraStock): se respeta la MISMA regla
 * canónica que usan Desktop, Tablet y DLV (materiaPrimaIgnoraStock, en
 * deliveryPorStock.js). Una materia prima marcada así no limita ni deja sin
 * disponibilidad a los artículos que la usan, aunque su stock sea 0 o negativo;
 * una desactivación manual (`activo === false`) sí la sigue limitando.
 */

import { materiaPrimaIgnoraStock } from './deliveryPorStock';

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
        if (materiaPrimaIgnoraStock(rawMaterial)) return true; // "Ignora Stock"
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
            const availableOptions = optionIds.filter(id => isArticleAvailable(id, articlesData, materiaPrimaData, context));
            // Si hay minSeleccion configurado, necesitamos al menos ese número de opciones disponibles
            const minRequired = (pItem.minSeleccion > 0) ? pItem.minSeleccion : 1;
            if (availableOptions.length < minRequired) return false;
        } else {
            const targetId = pItem.codigo || pItem.id;
            if (!targetId) continue;
            if (!isArticleAvailable(targetId, articlesData, materiaPrimaData, context)) return false;
        }
    }

    return true;
};

// Parsea una cantidad que puede venir como número, string con coma decimal, u otro. Nunca NaN.
const parseQty = (val) => {
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (typeof val === 'string') {
        const n = parseFloat(val.replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

// Normaliza un stock crudo a un número >= 0. Nunca negativo, nunca NaN.
const parseStockAmount = (val) => {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

const devWarnCycle = (chain, articleId) => {
    if (import.meta.env?.DEV) {
        console.warn(`[getAvailableUnits] Ciclo detectado al resolver stock: ${[...chain, articleId].join(' -> ')}. Se devuelve 0 para evitar un bucle infinito.`);
    }
};

const devWarnMissing = (articleId) => {
    if (import.meta.env?.DEV) {
        console.warn(`[getAvailableUnits] Referencia inexistente al calcular stock disponible: "${articleId}" no se encontró en ARTICULOS ni en MATERIA_PRIMA. Se devuelve 0.`);
    }
};

/**
 * Calcula cuántas unidades reales de `articleId` pueden fabricarse/venderse, siguiendo la
 * misma resolución conceptual de cadenas propio/heredado/receta que usa `resolveStockImpact`
 * (transactionsApi.js) para DESCONTAR stock — pero sin modificar ni descontar nada, solo lee.
 *
 * Es la única fuente de verdad para "cuánto stock disponible tiene un artículo", usada tanto
 * por la pantalla de Stock (DataTable) como por el cálculo de disponibilidad de promociones
 * (usePromotionMinimumStock). La activación/desactivación automática de delivery sigue usando
 * `isArticleAvailable`/`isPromoAvailable` (booleano, con gating por activoDelivery/activoMostrador),
 * que es un caso de uso distinto (¿se puede vender ahora?) y no una cantidad.
 *
 * Reglas:
 * - `controlStock === false` (artículo o materia prima) → Infinity (no limita, "ilimitado").
 * - stock propio → el número de `stock.propio` (nunca negativo, nunca NaN).
 * - stock heredado → la disponibilidad del padre (misma unidad, sin dividir).
 * - stock por receta → para cada ingrediente (materia prima u OTRO artículo, incluso anidado):
 *     ratio_ingrediente = disponibilidad(ingrediente) / cantidadRequerida
 *   Se toma el MÍNIMO de todos los ratios SIN redondear cada uno individualmente, y recién al
 *   final se aplica UN SOLO Math.floor sobre ese mínimo. Así "10 kg disponibles / 0.5 kg por
 *   unidad" da exactamente 20, sin perder unidades por redondeos intermedios.
 * - Materia prima (hoja, sin receta propia) → su stock numérico tal cual (SIN redondear: es una
 *   cantidad continua en su propia unidad —kg, litros—, no "unidades fabricables"; el redondeo
 *   final lo aplica quien la consume como ingrediente de una receta).
 * - Referencia inexistente (ni en ARTICULOS ni en MATERIA_PRIMA) → 0 (valor seguro que limita),
 *   con warning en desarrollo.
 * - Ciclo (A hereda/receta-usa B, B hereda/receta-usa A, directa o transitivamente) → 0, con
 *   warning en desarrollo. Se detecta con un set de IDs visitados POR RAMA (no global): permite
 *   que dos ingredientes distintos de una misma receta compartan una materia prima sin falsos
 *   positivos, pero corta cualquier referencia circular real antes de colgar la aplicación.
 *
 * @returns {number} unidades disponibles (entero, resultado de un único Math.floor final para
 *   artículos por receta) o `Infinity` si no hay control de stock. Nunca NaN, nunca negativo.
 */
export const getAvailableUnits = (articleId, articlesData = {}, materiaPrimaData = {}, visited = new Set()) => {
    if (!articleId) return 0;

    if (visited.has(articleId)) {
        devWarnCycle(visited, articleId);
        return 0;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(articleId);

    const article = articlesData[articleId];
    if (article) {
        if (article.controlStock === false) return Infinity;

        const stock = article.stock || {};
        const stockType = getStockType(stock);

        if (stockType === 'heredado' && stock.heredadoDe) {
            return getAvailableUnits(stock.heredadoDe, articlesData, materiaPrimaData, nextVisited);
        }

        if (stockType === 'receta' && stock.receta) {
            const receta = stock.receta;
            const entries = Array.isArray(receta)
                ? receta.map(ing => [ing.codigo || ing.id || ing.nombre, ing.cantidad]).filter(([id]) => Boolean(id))
                : Object.entries(receta);

            if (entries.length === 0) return Infinity; // receta vacía: nada la limita

            let minRatio = Infinity;
            for (const [ingredientId, rawQty] of entries) {
                const qtyNeeded = parseQty(rawQty);
                if (!(qtyNeeded > 0)) continue; // cantidad inválida/cero: ese ingrediente no restringe

                const ingredientAvailable = getAvailableUnits(ingredientId, articlesData, materiaPrimaData, nextVisited);
                const ratio = ingredientAvailable / qtyNeeded; // SIN redondear todavía
                if (ratio < minRatio) minRatio = ratio;
            }

            if (minRatio === Infinity) return Infinity;
            return Math.max(0, Math.floor(minRatio)); // UN SOLO floor, al final
        }

        // propio (o tipo desconocido): stock numérico directo del artículo.
        return parseStockAmount(stock.propio);
    }

    const rawMaterial = materiaPrimaData[articleId];
    if (rawMaterial) {
        if (rawMaterial.controlStock === false) return Infinity;
        if (materiaPrimaIgnoraStock(rawMaterial)) return Infinity; // "Ignora Stock": no limita
        if (rawMaterial.heredadoDe) {
            return getAvailableUnits(rawMaterial.heredadoDe, articlesData, materiaPrimaData, nextVisited);
        }
        return parseStockAmount(rawMaterial.stock); // cantidad continua, sin redondear aquí
    }

    devWarnMissing(articleId);
    return 0;
};
