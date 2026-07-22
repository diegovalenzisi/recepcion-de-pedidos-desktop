import { getDatabase, ref, get, runTransaction, update, push, set, onValue } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { shouldAutoToggleDelivery, handleStockDepletion, handleStockReplenishment, validateInheritedStockStatus } from './stockDeliveryAutomation';
import { checkAndUpdatePromotionStockStatus } from './promotionStockAutomation';
import { construirPlanDeStock } from './stockPlan';
import { revertirEnRecurso, resolverResultadoRecurso } from './stockAtomico';

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
    const LOCAL_ID = getCurrentDatabasePath();
    // Un solo "op" para todo el procesamiento de stock: hay varios await
    // reales (lock, lecturas de artículos/materia prima, reporte) antes de
    // las transacciones de stock, y más awaits (esas mismas transacciones)
    // antes del push de cada movimiento y del markTransactionAsCompleted final.
    const op = beginFirebaseOperation(LOCAL_ID);
    const db = op.getDatabaseOrAbort();

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

        // PLAN ÚNICO DE STOCK (Fase 2, punto 10).
        //
        // Antes este bucle resolvía solo el artículo base y los hijos de promo,
        // y los opcionales quedaban afuera: un topping vinculado a un artículo
        // real se cobraba pero nunca se descontaba.
        //
        // `construirPlanDeStock` arma UNA sola operación con artículo base,
        // hijos de promoción y opcionales de departamento, resolviendo cada
        // consumo hasta la RUTA FÍSICA que realmente cambia (propio, heredado o
        // receta) y agrupando cuando varios caminos caen en el mismo nodo. No se
        // crea una segunda llamada de stock ni un segundo referenceId.
        //
        // Reglas que aplica: los opcionales resuelven SOLO por articleId y nunca
        // por nombre; un opcional manual sin articleId no mueve stock; el
        // consumo sale del snapshot congelado y validado, jamás del nombre; y un
        // opcional gratuito basado en artículo igual descuenta.
        const plan = construirPlanDeStock({
            items,
            articulos: articlesData,
            materiaPrima: materiaPrimaData,
            permitirNombreEnBase: true,   // compatibilidad de artículos base históricos
        });
        Object.assign(impactMap, plan.impactMap);

        for (const aviso of plan.avisos) {
            if (aviso.tipo === 'fallback-por-nombre') {
                console.warn(`[stock] artículo resuelto por NOMBRE (compatibilidad histórica): "${aviso.buscado}" → ${aviso.resuelto}`, aviso);
            } else if (aviso.tipo === 'recurso-inexistente' || aviso.tipo === 'consumo-invalido' || aviso.tipo === 'ciclo') {
                console.warn(`[stock] ${aviso.tipo}`, aviso);
            }
        }
        if (plan.faltantes.length > 0) {
            console.warn(`[stock] ${plan.faltantes.length} recurso(s) del pedido no existen en el catálogo`, plan.faltantes);
        }

        if (Object.keys(impactMap).length > 0) {
            // Revalida antes del set() del reporte: el Promise.all(get) de
            // arriba fue un await real.
            await saveProcessReport(op.getDatabaseOrAbort(), LOCAL_ID, impactMap, articlesData, materiaPrimaData, source, referenceId);
        }

        const updatePromises = [];
        const automationPromises = [];
        const validationPromises = [];
        const operationalDate = getOperationalDate(new Date());

        // Revalida antes de empezar las transacciones de stock: arriba hubo
        // varios await reales (lock, lecturas, reporte).
        const stockDb = op.getDatabaseOrAbort();
        for (const id in impactMap) {
            const { quantity, type } = impactMap[id];

            const path = type === 'ARTICULO'
                ? `${LOCAL_ID}/ARTICULOS/${id}/stock/propio`
                : `${LOCAL_ID}/MATERIA_PRIMA/${id}/stock`;

            const itemRef = ref(stockDb, path);
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
                    // Revalida antes del push() definitivo: la transacción de
                    // stock de arriba fue un await real.
                    const transactionsRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/TRANSACCIONES_STOCK`);
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
            // Revalida antes del update() final del lock: arriba hubo varios await reales.
            await markTransactionAsCompleted(op.getDatabaseOrAbort(), LOCAL_ID, referenceId);
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

/**
 * REVERSIÓN IDEMPOTENTE DE UNA VENTA DE MOSTRADOR (Fase 2, punto 11).
 *
 * Única autoridad de reversión: reemplaza al camino viejo
 * (restoreStockForItem + bulkUpdateStock), que no tenía referenceId y por lo
 * tanto reponía de nuevo en cada cancelación repetida.
 *
 * Cómo garantiza que no repone dos veces: no se apoya en el pedido actual sino
 * en lo que cada recurso REGISTRÓ haber recibido. `revertirEnRecurso` mira el
 * `appliedOps` del propio nodo dentro de la transacción:
 *   · si la operación original no figura ahí     → no repone (nunca se descontó);
 *   · si la reversión ya figura                  → `ya-revertido`;
 *   · si figura la original y no la reversión    → repone exactamente su importe.
 * Por eso una operación original PARCIAL revierte solo los recursos realmente
 * aplicados, sin necesidad de reconstruir nada.
 *
 * @returns {{ success, estado, resultados, motivo? }}
 *   estado: 'reversed' | 'already-reversed' | 'original-not-applied' | 'reversal-partial'
 */
export const reverseStockForCounterSale = async (sale) => {
    if (!sale || !sale.items || sale.items.length === 0) {
        return { success: true, estado: 'reversed', resultados: [], motivo: 'sin-items' };
    }
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

    const referenceIdOriginal = `MOSTRADOR_${sale.id}`;
    const referenceIdReversion = `REVERSAL_MOSTRADOR_${sale.id}`;

    // Solo se revierte lo que efectivamente se aplicó.
    const marcaOriginal = (await get(ref(db, `${LOCAL_ID}/PROCESSED_STOCK_IDS/${referenceIdOriginal}`))).val();
    if (!marcaOriginal || marcaOriginal.status !== 'completed') {
        return { success: true, estado: 'original-not-applied', resultados: [], motivo: 'la venta no descontó stock' };
    }
    const marcaReversion = (await get(ref(db, `${LOCAL_ID}/PROCESSED_STOCK_IDS/${referenceIdReversion}`))).val();
    if (marcaReversion && marcaReversion.status === 'completed') {
        return { success: true, estado: 'already-reversed', resultados: [], motivo: 'ya se había repuesto' };
    }

    const [articlesSnapshot, materiaPrimaSnapshot] = await Promise.all([
        get(ref(db, `${LOCAL_ID}/ARTICULOS`)),
        get(ref(db, `${LOCAL_ID}/MATERIA_PRIMA`)),
    ]);
    const articlesData = articlesSnapshot.val() || {};
    const materiaPrimaData = materiaPrimaSnapshot.val() || {};

    // El mismo plan que se usó al descontar: base + hijos de promo + opcionales,
    // agrupado por ruta física.
    const plan = construirPlanDeStock({ items: sale.items, articulos: articlesData, materiaPrima: materiaPrimaData });

    const resultados = [];
    const dbRev = op.getDatabaseOrAbort();
    for (const [itemId, datos] of Object.entries(plan.impactMap)) {
        const rutaNodo = datos.type === 'ARTICULO'
            ? `${LOCAL_ID}/ARTICULOS/${itemId}/stock`
            : `${LOCAL_ID}/MATERIA_PRIMA/${itemId}`;
        const refNodo = ref(dbRev, rutaNodo);

        // Precarga: el reductor de runTransaction recibe null en su primera
        // llamada si el nodo no está en el árbol de sincronización.
        await new Promise((resolve) => {
            const off = onValue(refNodo, () => { off(); resolve(); });
        });

        let resultado = null;
        let invocacion = 0;
        await runTransaction(refNodo, (nodo) => {
            invocacion += 1;
            const r = revertirEnRecurso(nodo, {
                referenceIdOriginal, referenceIdReversion, tipo: datos.type, invocacion,
            });
            resultado = r.resultado;
            return r.nodo;
        });
        if (resultado === 'retryable') {
            resultado = resolverResultadoRecurso(resultado, (await get(refNodo)).val());
        }
        resultados.push({ itemId, tipo: datos.type, resultado });
    }

    const repuestos = resultados.filter((r) => r.resultado === 'revertido');
    const problemas = resultados.filter((r) => !['revertido', 'ya-revertido', 'original-no-aplicada'].includes(r.resultado));
    const estado = problemas.length > 0 ? 'reversal-partial' : 'reversed';

    await set(ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/PROCESSED_STOCK_IDS/${referenceIdReversion}`), {
        status: estado === 'reversed' ? 'completed' : 'reversal-partial',
        referenceId: referenceIdReversion,
        revierteA: referenceIdOriginal,
        timestamp: Date.now(),
        movementId: `MOV_${referenceIdReversion}`,
        resultados,
    });

    if (problemas.length > 0) {
        console.warn('[stock] la reversión de mostrador quedó incompleta', { referenceIdReversion, problemas });
    }
    return { success: true, estado, resultados, repuestos: repuestos.length };
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