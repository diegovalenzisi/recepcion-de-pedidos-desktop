import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { shouldAutoToggleDelivery, handleStockDepletion, handleStockReplenishment, reconciliarMateriaPrima } from './stockDeliveryAutomation';
import { checkAndUpdatePromotionStockStatus } from './promotionStockAutomation';
import { resolveStockImpact } from './transactionsApi';

const fetchData = async (path) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    if (!LOCAL_ID) throw new Error("Local ID no está configurado.");

    const url = `${API_URL}/${LOCAL_ID}/${path}.json`;
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404) return []; 
        throw new Error(`Error fetching ${path}: ${response.statusText}`);
    }
    const data = await response.json();
    if (!data) return [];
    
    return Object.keys(data).map(key => {
        const itemData = data[key];
        return {
            codigo: key,
            ...itemData
        };
    });
};

export const fetchAllStockableItems = async () => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    if (!LOCAL_ID) throw new Error("Local ID no está configurado.");

    const articulosUrl = `${API_URL}/${LOCAL_ID}/ARTICULOS.json`;
    const materiaPrimaUrl = `${API_URL}/${LOCAL_ID}/MATERIA_PRIMA.json`;

    try {
        const [articulosRes, materiaPrimaRes] = await Promise.all([
            fetch(articulosUrl),
            fetch(materiaPrimaUrl)
        ]);
        
        const articulos = articulosRes.ok ? (await articulosRes.json() || {}) : {};
        const materiaPrima = materiaPrimaRes.ok ? (await materiaPrimaRes.json() || {}) : {};
        
        return { articulos, materiaPrima };
    } catch (error) {
        console.error("Error fetching all stockable items:", error);
        throw new Error("No se pudo obtener la información de stock.");
    }
};

export const fetchStockItems = async () => {
    checkLocalId(); 
    
    const articulos = await fetchData('ARTICULOS');
    const materiaPrima = await fetchData('MATERIA_PRIMA');

    const stockableArticulos = articulos
        .filter(item => (item.stockType === 'propio' || item.stockType === 'receta') && item.activo)
        .map(item => ({
            ...item,
            tipo: 'Artículo',
            stock: item.stock !== undefined ? item.stock : 0
        }));

    const stockableMateriaPrima = materiaPrima
        .filter(item => item.activo)
        .map(item => ({
            ...item,
            tipo: 'Materia Prima',
            stock: item.stock !== undefined ? item.stock : 0
        }));

    return [...stockableArticulos, ...stockableMateriaPrima];
};

export const updateStock = async (itemCodigo, newStock, itemType) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    if (!LOCAL_ID) throw new Error("Local ID no está configurado.");
    // El fetch(url) de abajo lee el stock PREVIO antes de escribir el nuevo —
    // un await real. beginFirebaseOperation()/getDatabaseOrAbort() revalida
    // que el local no haya cambiado antes del PUT definitivo.
    const op = beginFirebaseOperation();

    const path = itemType === 'Artículo' ? 'ARTICULOS' : 'MATERIA_PRIMA';
    const url = `${API_URL}/${LOCAL_ID}/${path}/${itemCodigo}/stock.json`;

    let previousStock = 0;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const stockData = await response.json();
            previousStock = itemType === 'Artículo' ? (stockData?.propio || 0) : (stockData || 0);
        }
    } catch (e) {
        console.warn(`[Stock Update] Could not fetch previous stock for ${itemCodigo}`);
    }

    op.getDatabaseOrAbort();
    const stockValue = itemType === 'Artículo' ? { propio: newStock } : newStock;
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(stockValue),
    });

    if (!response.ok) {
        throw new Error('Failed to update stock');
    }

    const result = await response.json();

    if (itemType === 'Artículo') {
        try {
            const articleUrl = `${API_URL}/${LOCAL_ID}/${path}/${itemCodigo}.json`;
            const articleResponse = await fetch(articleUrl);
            if (articleResponse.ok) {
                const articleData = await articleResponse.json();
                const isOwnStock = shouldAutoToggleDelivery(articleData);
                
                console.log(`[Stock Ingress API] Validating stock change for ${itemCodigo}. Prev: ${previousStock}, New: ${newStock}`);
                
                if (newStock === 0 && previousStock > 0) {
                    await handleStockDepletion(itemCodigo, newStock, previousStock, isOwnStock);
                }
                else if (newStock > 0 && previousStock === 0) {
                    await handleStockReplenishment(itemCodigo, newStock, previousStock, isOwnStock);
                }
                
                // Also verify promotions as stock changed
                await checkAndUpdatePromotionStockStatus();
            }
        } catch (automationError) {
            console.error(`[Stock Automation] Error applying automation for ${itemCodigo}:`, automationError);
        }
    } else {
        // MATERIA PRIMA: reconciliar activoDelivery según el nuevo stock (idempotente).
        try {
            await reconciliarMateriaPrima(itemCodigo);
        } catch (automationError) {
            console.error(`[MP Delivery] Error reconciliando ${itemCodigo}:`, automationError);
        }
    }

    return result;
};

export const bulkUpdateStock = async (updates) => {
    checkLocalId();
    const API_URL = getFirebaseUrl();
    const LOCAL_ID = getCurrentDatabasePath();
    if (!LOCAL_ID) throw new Error("Local ID no está configurado.");
    const op = beginFirebaseOperation();

    const stockChanges = [];
    
    for (const [path, value] of Object.entries(updates)) {
        const articleMatch = path.match(/ARTICULOS\/([^\/]+)\/stock\/propio/);
        if (articleMatch) {
            const articleId = articleMatch[1];
            
            try {
                const prevUrl = `${API_URL}/${LOCAL_ID}/ARTICULOS/${articleId}/stock/propio.json`;
                const prevResponse = await fetch(prevUrl);
                const previousStock = prevResponse.ok ? (await prevResponse.json() || 0) : 0;
                
                stockChanges.push({
                    articleId,
                    newStock: value,
                    previousStock
                });
            } catch (e) {
                console.warn(`[Bulk Update] Could not fetch previous stock for ${articleId}`);
            }
        }
    }

    // Revalida antes del PATCH masivo definitivo: el loop de arriba hizo un
    // fetch() por artículo para leer el stock previo (awaits reales).
    op.getDatabaseOrAbort();
    const url = `${API_URL}/${LOCAL_ID}.json`;

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("Bulk update failed:", errorData);
        throw new Error('Falló la actualización masiva de stock.');
    }

    const result = await response.json();

    for (const change of stockChanges) {
        try {
            const articleUrl = `${API_URL}/${LOCAL_ID}/ARTICULOS/${change.articleId}.json`;
            const articleResponse = await fetch(articleUrl);
            
            if (articleResponse.ok) {
                const articleData = await articleResponse.json();
                const isOwnStock = shouldAutoToggleDelivery(articleData);
                
                console.log(`[Bulk Ingress API] Validating stock change for ${change.articleId}. Prev: ${change.previousStock}, New: ${change.newStock}`);
                
                if (change.newStock === 0 && change.previousStock > 0) {
                    await handleStockDepletion(change.articleId, change.newStock, change.previousStock, isOwnStock);
                }
                else if (change.newStock > 0 && change.previousStock === 0) {
                    await handleStockReplenishment(change.articleId, change.newStock, change.previousStock, isOwnStock);
                }
            }
        } catch (automationError) {
            console.error(`[Stock Automation] Error in bulk update for ${change.articleId}:`, automationError);
        }
    }

    // MATERIA PRIMA: reconciliar activoDelivery de cada materia prima tocada por
    // el PATCH masivo (idempotente; lee el estado ya escrito).
    const mpIds = new Set();
    for (const path of Object.keys(updates)) {
        const m = String(path).match(/MATERIA_PRIMA\/([^/]+)\/stock$/);
        if (m) mpIds.add(m[1]);
    }
    for (const mpId of mpIds) {
        await reconciliarMateriaPrima(mpId).catch(err => console.error(`[MP Delivery] bulk ${mpId}:`, err));
    }

    // Verify promotions availability after bulk stock changes
    if (stockChanges.length > 0) {
        await checkAndUpdatePromotionStockStatus().catch(err => console.warn('Failed to verify promotion stock', err));
    }

    return result;
};

export const deductStockForItem = async (item, quantity, allStockData, stockUpdates, affectedItems) => {
    const { articulos, materiaPrima } = allStockData;
    const itemCode = item.id || item.codigo;
    const articleDetails = articulos[itemCode];

    if (!articleDetails) {
        const rawMaterialDetails = materiaPrima[itemCode];
        if (rawMaterialDetails) {
            const updatePath = `MATERIA_PRIMA/${itemCode}/stock`;
            const currentStock = stockUpdates[updatePath] !== undefined 
                ? Number(stockUpdates[updatePath]) 
                : Number(rawMaterialDetails.stock) || 0;
            const newStock = currentStock - Number(quantity);
            stockUpdates[updatePath] = newStock;
        }
        return;
    }

    affectedItems.add(itemCode);

    if (articleDetails.isPromo) {
        // Use the same resolution engine as the deduction path (resolveStockImpact)
        // so promo group items restore stock to the real chosen article (codigo),
        // not to the group/promo itself, and propio/heredado/receta are respected.
        const promoChildren = item.promoItems || item.promoDetails || articleDetails.promoItems || [];
        const impactMap = {};
        promoChildren.forEach(promoItem => {
            const promoQty = Number(promoItem.cantidad) || 1;
            const promoIdentifier = promoItem.codigo || promoItem.id || promoItem.nombre;
            if (promoIdentifier) {
                resolveStockImpact(promoIdentifier, promoQty * Number(quantity), articulos, materiaPrima, impactMap, new Set());
            }
        });

        for (const [resolvedId, impact] of Object.entries(impactMap)) {
            affectedItems.add(resolvedId);
            const updatePath = impact.type === 'ARTICULO'
                ? `ARTICULOS/${resolvedId}/stock/propio`
                : `MATERIA_PRIMA/${resolvedId}/stock`;
            const baseStock = impact.type === 'ARTICULO'
                ? Number(articulos[resolvedId]?.stock?.propio) || 0
                : Number(materiaPrima[resolvedId]?.stock) || 0;
            const currentStock = stockUpdates[updatePath] !== undefined
                ? Number(stockUpdates[updatePath])
                : baseStock;
            stockUpdates[updatePath] = currentStock - impact.quantity;
        }
        return;
    }

    if (articleDetails.stock && articleDetails.stock.receta && Object.keys(articleDetails.stock.receta).length > 0) {
        for (const [componentCode, quantityNeeded] of Object.entries(articleDetails.stock.receta)) {
            const componentItem = { id: componentCode, codigo: componentCode };
            await deductStockForItem(componentItem, Number(quantityNeeded) * Number(quantity), allStockData, stockUpdates, affectedItems);
        }
        return;
    }

    if (articleDetails.stock && articleDetails.stock.heredadoDe) {
        const inheritedItem = { id: articleDetails.stock.heredadoDe, codigo: articleDetails.stock.heredadoDe };
        await deductStockForItem(inheritedItem, quantity, allStockData, stockUpdates, affectedItems);
        return;
    }

    if (articleDetails.stock && articleDetails.stock.propio !== undefined && articleDetails.stock.propio !== null) {
        const updatePath = `ARTICULOS/${itemCode}/stock/propio`;
        const currentStock = stockUpdates[updatePath] !== undefined 
            ? Number(stockUpdates[updatePath]) 
            : Number(articleDetails.stock.propio) || 0;
        const newStock = currentStock - Number(quantity);
        stockUpdates[updatePath] = newStock;
        
        if (!stockUpdates._automationTracking) {
            stockUpdates._automationTracking = [];
        }
        stockUpdates._automationTracking.push({
            articleId: itemCode,
            previousStock: currentStock,
            newStock: newStock,
            isOwnStock: shouldAutoToggleDelivery(articleDetails)
        });
        
        // Trigger verification (non-blocking) - this is usually used within bulk context
        checkAndUpdatePromotionStockStatus().catch(() => {});
        return;
    }
};

export const restoreStockForItem = async (item, quantity, allStockData, stockUpdates, affectedItems) => {
    const result = await deductStockForItem(item, -quantity, allStockData, stockUpdates, affectedItems);
    // Trigger verification (non-blocking) - this is usually used within bulk context
    checkAndUpdatePromotionStockStatus().catch(() => {});
    return result;
};