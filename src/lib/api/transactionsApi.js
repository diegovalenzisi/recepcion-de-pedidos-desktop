import { getDatabase, ref, get, runTransaction, update, push, set } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { shouldAutoToggleDelivery, handleStockDepletion, handleStockReplenishment, validateInheritedStockStatus } from './stockDeliveryAutomation';
import { checkAndUpdatePromotionStockStatus } from './promotionStockAutomation';

const parseQuantity = (val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        return parseFloat(val.replace(',', '.')) || 0;
    }
    return 0;
};

export const resolveStockImpact = (itemId, quantity, articlesData, materiaPrimaData, impactMap, visited = new Set()) => {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    let resolvedId = itemId;
    let foundInArticles = false;
    let foundInMP = false;

    if (articlesData[resolvedId]) {
        const art = articlesData[resolvedId];
        const hasStockConfig = (art.stock && (
            art.stock.stockType === 'propio' || 
            art.stock.stockType === 'receta' || 
            art.stock.stockType === 'heredado' ||
            art.stock.propio !== undefined ||
            (art.stock.receta && Object.keys(art.stock.receta).length > 0) ||
            art.stock.heredadoDe
        ));
        
        if (hasStockConfig) {
            foundInArticles = true;
        }
    } 
    
    if (!foundInArticles && materiaPrimaData[resolvedId]) {
        foundInMP = true;
    } 
    
    if (!foundInArticles && !foundInMP) {
        const searchTerm = String(itemId).trim().toLowerCase();
        
        const articleKey = Object.keys(articlesData).find(key => 
            articlesData[key].nombre && String(articlesData[key].nombre).trim().toLowerCase() === searchTerm
        );
        
        if (articleKey) {
            const art = articlesData[articleKey];
            const hasStockConfig = (art.stock && (
                art.stock.stockType === 'propio' || 
                art.stock.stockType === 'receta' || 
                art.stock.stockType === 'heredado' ||
                art.stock.propio !== undefined ||
                (art.stock.receta && Object.keys(art.stock.receta).length > 0) ||
                art.stock.heredadoDe
            ));

            if (hasStockConfig) {
                resolvedId = articleKey;
                foundInArticles = true;
            }
        }
        
        if (!foundInArticles) {
            const mpKey = Object.keys(materiaPrimaData).find(key => 
                materiaPrimaData[key].nombre && String(materiaPrimaData[key].nombre).trim().toLowerCase() === searchTerm
            );
            if (mpKey) {
                resolvedId = mpKey;
                foundInMP = true;
            }
        }
    }

    if (foundInArticles) {
        const article = articlesData[resolvedId];
        const stockType = article.stock?.stockType;
        const hasReceta = article.stock?.receta;
        const hasHeredado = article.stock?.heredadoDe;
        const hasPropio = article.stock?.propio !== undefined;

        if (stockType === 'propio' || (!stockType && hasPropio)) {
            if (!impactMap[resolvedId]) {
                impactMap[resolvedId] = { quantity: 0, type: 'ARTICULO' };
            }
            impactMap[resolvedId].quantity += quantity;
        } 
        else if ((stockType === 'receta' || !stockType) && hasReceta) {
            const receta = article.stock.receta;
            
            if (typeof receta === 'object' && !Array.isArray(receta)) {
                 Object.entries(receta).forEach(([ingredientId, ingredientQty]) => {
                    const qtyNeeded = parseQuantity(ingredientQty);
                    resolveStockImpact(ingredientId, quantity * qtyNeeded, articlesData, materiaPrimaData, impactMap, visited);
                });
            }
            else if (Array.isArray(receta)) {
                receta.forEach(ing => {
                    const ingId = ing.codigo || ing.id || ing.nombre;
                    const qtyNeeded = parseQuantity(ing.cantidad);
                    if (ingId) {
                        resolveStockImpact(ingId, quantity * qtyNeeded, articlesData, materiaPrimaData, impactMap, visited);
                    }
                });
            }
        } 
        else if ((stockType === 'heredado' || !stockType) && hasHeredado) {
            resolveStockImpact(article.stock.heredadoDe, quantity, articlesData, materiaPrimaData, impactMap, visited);
        }
        return;
    }

    if (foundInMP) {
        if (!impactMap[resolvedId]) {
            impactMap[resolvedId] = { quantity: 0, type: 'MATERIA_PRIMA' };
        }
        impactMap[resolvedId].quantity += quantity;
        return;
    }
};

const saveProcessReport = async (db, localId, impactMap, articlesData, materiaPrimaData, source, referenceId) => {
    const now = new Date();
    const operationalDate = getOperationalDate(now);
    const fechaCaja = formatDateForFirebase(operationalDate);
    const timeString = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const reportPath = `${localId}/INFORME/${fechaCaja}/${timeString}/SUCESO`;
    
    const detalles = Object.entries(impactMap).map(([id, data]) => {
        let name = id;
        if (data.type === 'ARTICULO' && articlesData[id]) name = articlesData[id].nombre;
        if (data.type === 'MATERIA_PRIMA' && materiaPrimaData[id]) name = materiaPrimaData[id].nombre;
        
        return {
            item: name,
            itemId: id,
            cantidad: data.quantity,
            tipo: data.type
        };
    });

    const reportData = {
        dia: fechaCaja,
        hora: timeString,
        tipo: source,
        referenceId: referenceId || null,
        detalles: detalles
    };

    try {
        await set(ref(db, reportPath), reportData);
    } catch (e) {
        console.error("Error saving process report:", e);
    }
}

const acquireTransactionLock = async (db, localId, referenceId) => {
    if (!referenceId) return true; 
    
    const lockRef = ref(db, `${localId}/PROCESSED_STOCK_IDS/${referenceId}`);
    
    try {
        const result = await runTransaction(lockRef, (currentData) => {
            if (currentData) return; 
            return { timestamp: Date.now(), status: 'processing' };
        });
        return result.committed;
    } catch (e) {
        console.error("Error acquiring transaction lock:", e);
        return false; 
    }
};

const markTransactionAsCompleted = async (db, localId, referenceId) => {
    if (!referenceId) return;
    const lockRef = ref(db, `${localId}/PROCESSED_STOCK_IDS/${referenceId}`);
    await update(lockRef, { status: 'completed', completedAt: Date.now() });
};

const processStockUpdate = async (items, source = 'Venta Delivery', referenceId = null) => {
    if (!items || items.length === 0) return { success: true, message: 'No items' };

    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();

    if (referenceId) {
        const lockAcquired = await acquireTransactionLock(db, LOCAL_ID, referenceId);
        if (!lockAcquired) {
            console.warn(`Stock update for ${referenceId} already processed or in progress.`);
            return { success: true, message: 'Already processed' };
        }
    }

    const impactMap = {}; 
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    const materiaPrimaRef = ref(db, `${LOCAL_ID}/MATERIA_PRIMA`);

    try {
        const [articlesSnapshot, materiaPrimaSnapshot] = await Promise.all([
            get(articlesRef),
            get(materiaPrimaRef)
        ]);

        const articlesData = articlesSnapshot.val() || {};
        const materiaPrimaData = materiaPrimaSnapshot.val() || {};

        items.forEach(item => {
            const quantityToReduce = parseQuantity(item.quantity || item.cantidad || 1);
            let itemCodigo = item.codigo || item.id;
            const identifier = itemCodigo || item.nombre;

            const promoChildren = (item.isPromo && (item.promoItems || item.promoDetails)) || [];
            const hasChildren = promoChildren.length > 0;

            if (identifier && !hasChildren) {
                resolveStockImpact(identifier, quantityToReduce, articlesData, materiaPrimaData, impactMap, new Set());
            }

            if (hasChildren) {
                promoChildren.forEach(promoItem => {
                     const promoQty = parseQuantity(promoItem.cantidad || 1);
                     const promoIdentifier = promoItem.codigo || promoItem.id || promoItem.nombre;
                     if (promoIdentifier) {
                         resolveStockImpact(promoIdentifier, promoQty * quantityToReduce, articlesData, materiaPrimaData, impactMap, new Set());
                     }
                });
            }
        });

        if (Object.keys(impactMap).length > 0) {
            await saveProcessReport(db, LOCAL_ID, impactMap, articlesData, materiaPrimaData, source, referenceId);
        }

        const updatePromises = [];
        const automationPromises = [];
        const validationPromises = [];
        const operationalDate = getOperationalDate(new Date());

        for (const id in impactMap) {
            const { quantity, type } = impactMap[id];
            
            const path = type === 'ARTICULO'
                ? `${LOCAL_ID}/ARTICULOS/${id}/stock/propio` 
                : `${LOCAL_ID}/MATERIA_PRIMA/${id}/stock`;
            
            const itemRef = ref(db, path);
            const amountToReduce = quantity;

            const transactionPromise = runTransaction(itemRef, (currentStock) => {
                if (currentStock === null || typeof currentStock === 'undefined') return -amountToReduce;
                return (Number(currentStock) || 0) - amountToReduce;
            }).then(async ({ committed, snapshot }) => {
                if (committed) {
                    const newStockValue = snapshot.val();
                    const isArticle = type === 'ARTICULO';
                    
                    if (isArticle) {
                        const articleData = articlesData[id];
                        const isOwnStock = shouldAutoToggleDelivery(articleData);
                        const previousStock = (Number(snapshot.val()) || 0) + amountToReduce;
                        
                        console.log(`[Stock Transaction] Article ${id}: ${previousStock} -> ${newStockValue}`);

                        if (newStockValue === 0 && previousStock > 0) {
                            automationPromises.push(
                                handleStockDepletion(id, newStockValue, previousStock, isOwnStock)
                                    .catch(err => console.error(`[Automation Depletion] Failed for ${id}:`, err))
                            );
                        } else if (newStockValue > 0 && previousStock === 0) {
                            automationPromises.push(
                                handleStockReplenishment(id, newStockValue, previousStock, isOwnStock)
                                    .catch(err => console.error(`[Automation Replenishment] Failed for ${id}:`, err))
                            );
                        } else {
                            validationPromises.push(
                                validateInheritedStockStatus(id, newStockValue)
                                    .catch(err => console.error(`[Validation] Failed for inherited stock of ${id}:`, err))
                            );
                        }
                    }

                    const transaction = {
                        tipo: 'salida',
                        itemId: id,
                        isArticle,
                        cantidad: amountToReduce,
                        fecha: operationalDate.toISOString(),
                        timestamp: Date.now(),
                        motivo: source,
                        referenceId: referenceId
                    };
                    const transactionsRef = ref(db, `${LOCAL_ID}/TRANSACCIONES_STOCK`);
                    await push(transactionsRef, transaction);
                }
            });
            updatePromises.push(transactionPromise);
        }

        await Promise.all(updatePromises);
        
        if (validationPromises.length > 0) {
            await Promise.all(validationPromises);
        }

        if (automationPromises.length > 0) {
            await Promise.all(automationPromises);
        }

        if (referenceId) {
            await markTransactionAsCompleted(db, LOCAL_ID, referenceId);
        }

        return { success: true };
    } catch (error) {
        console.error("Error processing stock update:", error);
        throw error;
    }
};

export const processStockForDeliveredOrder = async (order) => {
    if (!order || !order.items || order.items.length === 0) return { success: true, message: 'No items to process' };
    const referenceId = order.id ? `DELIVERY_${order.id}` : null;
    
    try {
        await processStockUpdate(order.items, 'Venta Delivery', referenceId);
        // Verify promotion availability after stock modifications
        await checkAndUpdatePromotionStockStatus().catch(err => console.warn('Failed to verify promotion stock', err));
        return { success: true };
    } catch (error) {
        console.error("Stock deduction failed:", error);
        return { success: false, error: error.message };
    }
};

export const processStockForCounterSale = async (sale) => {
    if (!sale || !sale.items || sale.items.length === 0) return { success: true };
    const referenceId = sale.id ? `MOSTRADOR_${sale.id}` : null;
    try {
        await processStockUpdate(sale.items, 'Venta Mostrador', referenceId);
        // Verify promotion availability after stock modifications
        await checkAndUpdatePromotionStockStatus().catch(err => console.warn('Failed to verify promotion stock', err));
        return { success: true };
    } catch(e) {
        console.error("Stock deduction failed for counter sale", e);
        return { success: false, error: e.message };
    }
};