
import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { getDatabase, ref, get, set, remove, runTransaction, update, onValue, off } from 'firebase/database';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { validateInheritedStockStatus } from './stockDeliveryAutomation';

const getTabConfig = (tabId) => {
    const config = {
        articulos: { path: 'ARTICULOS', idPrefix: 'A' },
        'materia-prima': { path: 'MATERIA_PRIMA', idPrefix: 'M' },
        'grupos-opcionales': { path: 'GRUPOS_OPCIONALES', idPrefix: 'G' },
        'grupos-productos': { path: 'GRUPOS_PRODUCTOS', idPrefix: 'GP' },
        opcionales: { path: 'OPCIONALES', idPrefix: 'O' },
        departamentos: { path: 'DEPARTAMENTOS', idPrefix: 'D' },
        tachos: { path: 'TACHOS', idPrefix: 'T' }
    };
    return config[tabId];
};

const processSnapshot = (snapshot, tabId) => {
    const data = snapshot.val();
    if (!data) return [];

    if (tabId === 'opcionales') {
        const allOptionals = [];
        for (const groupKey in data) {
            const groupOptionals = data[groupKey];
            for (const optionalKey in groupOptionals) {
                allOptionals.push({
                    ...groupOptionals[optionalKey],
                    codigo: optionalKey,
                    id: optionalKey,
                    grupo: groupKey,
                });
            }
        }
        return allOptionals;
    }

    return Object.keys(data).map(key => ({
        ...data[key],
        codigo: key,
        id: key,
    }));
};

const syncOptionalToArticles = async (groupCode, optionalCode) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    try {
        const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
        const articlesSnapshot = await get(articlesRef);
        
        if (!articlesSnapshot.exists()) {
            return { synced: 0, errors: [] };
        }
        
        const articlesData = articlesSnapshot.val();
        const updates = {};
        let syncCount = 0;
        const errors = [];
        
        for (const articleId in articlesData) {
            const article = articlesData[articleId];
            
            if (article.opcionalesConfig && article.opcionalesConfig[groupCode]) {
                const groupConfig = article.opcionalesConfig[groupCode];
                
                if (groupConfig.activo === true) {
                    const currentOpcionales = groupConfig.opcionales || [];
                    
                    if (!currentOpcionales.includes(optionalCode)) {
                        const updatedOpcionales = [...currentOpcionales, optionalCode];
                        updates[`${LOCAL_ID}/ARTICULOS/${articleId}/opcionalesConfig/${groupCode}/opcionales`] = updatedOpcionales;
                        syncCount++;
                    }
                }
            }
        }
        
        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
        }
        
        return { synced: syncCount, errors };
    } catch (error) {
        console.error('[Optional Sync] Error syncing optional to articles:', error);
        throw new Error(`Failed to sync optional to articles: ${error.message}`);
    }
};

const removeOptionalFromArticles = async (groupCode, optionalCode) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    try {
        const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
        const articlesSnapshot = await get(articlesRef);
        
        if (!articlesSnapshot.exists()) return { removed: 0 };
        
        const articlesData = articlesSnapshot.val();
        const updates = {};
        let removeCount = 0;
        
        for (const articleId in articlesData) {
            const article = articlesData[articleId];
            
            if (article.opcionalesConfig && article.opcionalesConfig[groupCode]) {
                const groupConfig = article.opcionalesConfig[groupCode];
                const currentOpcionales = groupConfig.opcionales || [];
                
                if (currentOpcionales.includes(optionalCode)) {
                    const updatedOpcionales = currentOpcionales.filter(code => code !== optionalCode);
                    updates[`${LOCAL_ID}/ARTICULOS/${articleId}/opcionalesConfig/${groupCode}/opcionales`] = updatedOpcionales;
                    removeCount++;
                }
            }
        }
        
        if (Object.keys(updates).length > 0) {
            await update(ref(db), updates);
        }
        
        return { removed: removeCount };
    } catch (error) {
        console.error('[Optional Cleanup] Error removing optional from articles:', error);
        throw error;
    }
};

export const listenToManagementData = (tabId, callback, errorCallback) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const tabConfig = getTabConfig(tabId);
    if (!tabConfig) return () => {};
    
    const dataRef = ref(db, `${LOCAL_ID}/${tabConfig.path}`);

    const listener = onValue(dataRef, (snapshot) => {
        const processedData = processSnapshot(snapshot, tabId);
        callback(processedData);
    }, (error) => {
        if (errorCallback) errorCallback(error);
    });

    return () => off(dataRef, 'value', listener);
};

export const fetchAllManagementData = async (tabs) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const data = {};

    const promises = tabs.map(async (tab) => {
        const tabConfig = getTabConfig(tab.id);
        if (!tabConfig) return;

        const dataRef = ref(db, `${LOCAL_ID}/${tabConfig.path}`);
        try {
            const snapshot = await get(dataRef);
            data[tab.id] = processSnapshot(snapshot, tab.id);
        } catch (error) {
            console.error(`Error fetching ${tab.id}:`, error);
            data[tab.id] = [];
        }
    });

    await Promise.all(promises);
    return data;
};

export const fetchOptionalGroups = async () => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const groupsRef = ref(db, `${LOCAL_ID}/GRUPOS_OPCIONALES`);
    
    try {
        const snapshot = await get(groupsRef);
        return processSnapshot(snapshot, 'grupos-opcionales');
    } catch (error) {
        console.error('Error fetching optional groups:', error);
        throw error;
    }
};

export const fetchPromotionMinimumStock = async (promotionId) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    
    try {
        const promoRef = ref(db, `${LOCAL_ID}/ARTICULOS/${promotionId}`);
        const promoSnap = await get(promoRef);
        
        if (!promoSnap.exists() || !promoSnap.val().isPromo) {
            throw new Error("Promotion not found or invalid.");
        }
        
        const promotion = promoSnap.val();
        const promoItems = promotion.promoItems || [];
        
        const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
        const mpRef = ref(db, `${LOCAL_ID}/MATERIA_PRIMA`);
        
        const [artSnap, mpSnap] = await Promise.all([
            get(articlesRef),
            get(mpRef)
        ]);

        const articlesData = artSnap.exists() ? artSnap.val() : {};
        const mpData = mpSnap.exists() ? mpSnap.val() : {};

        let minStock = Infinity;
        let limitedBy = null;
        const details = [];

        for (const pItem of promoItems) {
            // Items que son "grupo de productos a elección" no tienen un único
            // artículo asociado, por lo que se excluyen del cálculo de stock mínimo.
            if (pItem.tipo === 'grupo') continue;

            const artId = pItem.codigo || pItem.id;
            const qtyNeeded = pItem.cantidad || 1;
            const article = articlesData[artId];

            if (!article) {
                minStock = 0;
                limitedBy = artId;
                details.push({ id: artId, name: artId, stock: 0, required: qtyNeeded, type: 'article' });
                continue;
            }

            let available = article.stock?.propio !== undefined ? article.stock.propio : (article.stock || 0);
            const possiblePromosArt = Math.floor(available / qtyNeeded);
            
            details.push({ 
                id: artId, name: article.nombre, stock: available, required: qtyNeeded, 
                type: 'article', possible: possiblePromosArt
            });

            if (possiblePromosArt < minStock) {
                minStock = possiblePromosArt;
                limitedBy = article.nombre;
            }

            if (article.materiaPrima && Array.isArray(article.materiaPrima)) {
                for (const mp of article.materiaPrima) {
                    const mpId = mp.codigo || mp.id;
                    const mpQtyNeeded = (mp.cantidad || 1) * qtyNeeded;
                    const rawMat = mpData[mpId];
                    
                    if (!rawMat) continue;

                    let mpAvailable = rawMat.stock || 0;
                    if (rawMat.heredadoDe && articlesData[rawMat.heredadoDe]) {
                        mpAvailable = articlesData[rawMat.heredadoDe].stock?.propio || 0;
                    }

                    const possiblePromosMp = Math.floor(mpAvailable / mpQtyNeeded);
                    
                    details.push({ 
                        id: mpId, name: rawMat.nombre, stock: mpAvailable, required: mpQtyNeeded, 
                        type: 'raw_material', possible: possiblePromosMp
                    });

                    if (possiblePromosMp < minStock) {
                        minStock = possiblePromosMp;
                        limitedBy = rawMat.nombre;
                    }
                }
            }
        }
        
        return {
            minimumStock: minStock === Infinity ? 0 : minStock,
            limitedBy,
            details
        };
    } catch (error) {
        console.error('Error fetching promotion minimum stock:', error);
        throw error;
    }
};

export const saveData = async (tabId, data, isEditing, allData = {}) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const tabConfig = getTabConfig(tabId);
    if (!tabConfig) throw new Error("Invalid tab ID");

    let finalData = { ...data };
    let finalPath;
    let newKey = finalData.codigo;

    const db = getDatabase();

    if (!newKey) {
        throw new Error("El código es obligatorio.");
    }

    finalData.id = newKey;
    
    let previousGroup = null;
    let existingArticleData = null;

    if (tabId === 'opcionales' && isEditing) {
        try {
            const existingRef = ref(db, `${LOCAL_ID}/OPCIONALES`);
            const existingSnapshot = await get(existingRef);
            if (existingSnapshot.exists()) {
                const existingData = existingSnapshot.val();
                for (const groupKey in existingData) {
                    if (existingData[groupKey][newKey]) {
                        previousGroup = groupKey;
                        break;
                    }
                }
            }
        } catch (error) {
            console.warn('[Optional Save] Could not fetch previous group:', error);
        }
    }
    
    if (tabId === 'opcionales') {
        if (!finalData.grupo) throw new Error("Group is required for optionals.");
        finalPath = `${LOCAL_ID}/${tabConfig.path}/${finalData.grupo}/${newKey}`;
    } else {
        finalPath = `${LOCAL_ID}/${tabConfig.path}/${newKey}`;
    }
    
    let dataToSave = { ...finalData };

    if (tabId === 'materia-prima') {
        dataToSave.precioBulto = Math.round(Number(finalData.precioBulto || 0) * 1000) / 1000;
        dataToSave.unidadesPorBulto = Number(finalData.unidadesPorBulto) || 1;
        dataToSave.costoUnitario = Math.round((dataToSave.unidadesPorBulto > 0 ? dataToSave.precioBulto / dataToSave.unidadesPorBulto : 0) * 1000) / 1000;
        dataToSave.unidadMedida = finalData.unidadMedida || 'unidad';
        dataToSave.unidad = dataToSave.unidadMedida;
    }

    if (tabId === 'articulos' && !isEditing) {
        dataToSave.hadDeliveryEnabled = Boolean(dataToSave.activoDelivery);
    }

    if (tabId === 'articulos' && isEditing) {
        try {
            const existingRef = ref(db, finalPath);
            const existingSnapshot = await get(existingRef);
            if (existingSnapshot.exists()) {
                existingArticleData = existingSnapshot.val();
                if (dataToSave.hadDeliveryEnabled === undefined && existingArticleData.hadDeliveryEnabled !== undefined) {
                    dataToSave.hadDeliveryEnabled = existingArticleData.hadDeliveryEnabled;
                }
            }
        } catch (error) {
            console.warn('[Article Save] Could not fetch existing data:', error);
        }
    }

    if (tabId === 'articulos') {
        if (dataToSave.hasOwnProperty('activoDelivery')) {
            dataToSave.activoDelivery = Boolean(dataToSave.activoDelivery);
        }
        if (dataToSave.hasOwnProperty('activoMostrador')) {
            dataToSave.activoMostrador = Boolean(dataToSave.activoMostrador);
        }
        dataToSave.lastModified = Date.now();
        
        const parsedCost = Number(finalData.costoTotalReceta);
        dataToSave.costoTotalReceta = isNaN(parsedCost) ? 0 : Math.round(parsedCost * 1000) / 1000;
        
        dataToSave.composition = (finalData.composition || []).map(item => ({
            ...item,
            unitCost: Math.round(Number(item.unitCost || 0) * 1000) / 1000,
            totalCost: Math.round(Number(item.totalCost || 0) * 1000) / 1000
        }));

        console.log('[managementApi] Saving article with costoTotalReceta:', dataToSave.costoTotalReceta, 'composition:', dataToSave.composition);

        if (dataToSave.valor !== undefined) {
            dataToSave.valor = Math.round(Number(dataToSave.valor || 0) * 1000) / 1000;
        }

        if (isEditing && existingArticleData) {
            const existingStock = existingArticleData.stock?.propio || 0;
            const newStock = dataToSave.stock?.propio || 0;
            const userChangedActivoDelivery = dataToSave.activoDelivery !== existingArticleData.activoDelivery;
            
            if (!userChangedActivoDelivery) {
                if (newStock === 0 && existingStock > 0) {
                    const isCurrentlyActive = existingArticleData.activoDelivery !== false;
                    if (isCurrentlyActive) {
                        dataToSave.hadDeliveryEnabled = true;
                        dataToSave.activoDelivery = false;
                        dataToSave.autoToggleReason = 'manual_stock_depleted';
                    } else if (existingArticleData.hadDeliveryEnabled !== false) {
                        dataToSave.hadDeliveryEnabled = false;
                    }
                } else if (newStock > 0 && existingStock === 0) {
                    if (existingArticleData.hadDeliveryEnabled === true) {
                        dataToSave.hadDeliveryEnabled = false;
                        dataToSave.activoDelivery = true;
                        dataToSave.autoToggleReason = 'manual_stock_replenished';
                    } else if (existingArticleData.hadDeliveryEnabled !== false) {
                        dataToSave.hadDeliveryEnabled = false;
                    }
                }
            } else {
                dataToSave.hadDeliveryEnabled = Boolean(dataToSave.activoDelivery);
            }
        }
    }

    if (tabId === 'opcionales') {
        if (dataToSave.hasOwnProperty('activo')) {
            dataToSave.activoDelivery = dataToSave.activo;
            dataToSave.activoMostrador = dataToSave.activo;
        }
        
        if (dataToSave.precio !== undefined) {
            dataToSave.precio = Math.round(Number(dataToSave.precio || 0) * 1000) / 1000;
        }

        if (dataToSave.numeroOrden === '' || dataToSave.numeroOrden === null || dataToSave.numeroOrden === undefined) {
            delete dataToSave.numeroOrden;
        } else {
            dataToSave.numeroOrden = Number(dataToSave.numeroOrden);
        }
    }

    if (tabId === 'tachos') {
        dataToSave = {
            nombre: finalData.nombre,
            stock: finalData.stock || 0,
            deberiaHaber: finalData.deberiaHaber || 0,
            orden: finalData.orden ? parseInt(finalData.orden, 10) : 0
        };
    } else {
        if (dataToSave.id) delete dataToSave.id;
        if (dataToSave.codigo) delete dataToSave.codigo;
        if (tabId === 'opcionales' && dataToSave.grupo) {
            delete dataToSave.grupo;
        }
        if (dataToSave.uniqueId) delete dataToSave.uniqueId;
        if (dataToSave.promoItems) {
            dataToSave.promoItems = dataToSave.promoItems.map(({ uniqueId, ...item }) => item);
        }
        if (tabId === 'articulos') {
            dataToSave.stockMinimo = Number(finalData.stockMinimo) || 0;
            if (!isEditing && dataToSave.controlStock === undefined) {
                dataToSave.controlStock = true;
            }
        }
        
        if (dataToSave.previousActivoDelivery !== undefined) delete dataToSave.previousActivoDelivery;
        if (dataToSave.previousActivoMostrador !== undefined) delete dataToSave.previousActivoMostrador;
    }
    
    await set(ref(db, finalPath), dataToSave);

    if (tabId === 'opcionales') {
        try {
            if (previousGroup && previousGroup !== finalData.grupo) {
                await removeOptionalFromArticles(previousGroup, newKey);
            }
            await syncOptionalToArticles(finalData.grupo, newKey);
        } catch (syncError) {
            console.error('[Optional Save] Failed to sync optional to articles:', syncError);
        }
    }

    if (tabId === 'articulos') {
        try {
            const stockVal = dataToSave.stock?.propio || 0;
            await validateInheritedStockStatus(newKey, stockVal);
        } catch (error) {
            console.warn('[Article Save] Error triggering inherited stock validation:', error);
        }
    }

    const numericId = parseInt(newKey.replace(tabConfig.idPrefix, ''), 10);
    if (!isNaN(numericId)) {
        const counterRef = ref(db, `${LOCAL_ID}/CONTADORES/${tabConfig.path}`);
        await runTransaction(counterRef, (currentCounter) => {
            return Math.max(currentCounter || 0, numericId);
        });
    }
    
    return finalData;
};

export const deleteData = async (tabId, item) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const tabConfig = getTabConfig(tabId);
    if (!tabConfig) throw new Error("Invalid tab ID");
    
    let path = `${LOCAL_ID}/${tabConfig.path}/${item.codigo}`;
    if (tabId === 'opcionales') {
        path = `${LOCAL_ID}/${tabConfig.path}/${item.grupo}/${item.codigo}`;
    }

    const db = getDatabase();
    const itemRef = ref(db, path);
    
    if (tabId === 'opcionales') {
        try {
            await removeOptionalFromArticles(item.grupo, item.codigo);
        } catch (cleanupError) {
            console.error('[Optional Delete] Failed to cleanup optional from articles:', cleanupError);
        }
    }
    
    await remove(itemRef);

    return true;
};

export const updateTachoStock = async (tachoId, newStock) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const stockRef = ref(db, `${LOCAL_ID}/TACHOS/${tachoId}/stock`);
    
    await set(stockRef, newStock);
};

export const updateArticlePrice = async (articleId, newPrice) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const priceRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}/valor`);
    
    await set(priceRef, Math.round(Number(newPrice || 0) * 1000) / 1000);

    try {
        const stockSnap = await get(ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}/stock/propio`));
        await validateInheritedStockStatus(articleId, stockSnap.val() || 0);
    } catch (e) {
        console.warn(`Could not validate inherited stock for ${articleId}`, e);
    }
};

export const updateArticleControlStock = async (articleId, newStatus) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const controlStockRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}/controlStock`);
    
    await set(controlStockRef, newStatus);

    try {
        const stockSnap = await get(ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}/stock/propio`));
        await validateInheritedStockStatus(articleId, stockSnap.val() || 0);
    } catch (e) {
        console.warn(`Could not validate inherited stock for ${articleId}`, e);
    }
};

export const updateArticleStatusBasedOnStock = async (articleId, newStock) => {
    return;
};

export const sendTachoReport = async (reportData, tachos) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();

    const operationalDate = getOperationalDate(new Date());
    const dateString = formatDateForFirebase(operationalDate);
    
    const reportPath = `${LOCAL_ID}/TACHOS_REPORTES/${dateString}`;
    const reportRef = ref(db, reportPath);

    const tachosObject = {};
    tachos.forEach(t => {
        const key = t.orden ? String(t.orden) : `NO_ORDEN_${t.codigo}`;
        tachosObject[key] = { 
            nombre: t.nombre, 
            stock: t.stock 
        };
    });

    const dataToSave = {
        reporte: reportData,
        tachos: tachosObject
    };

    await set(reportRef, dataToSave);
};

export { syncOptionalToArticles, removeOptionalFromArticles };
