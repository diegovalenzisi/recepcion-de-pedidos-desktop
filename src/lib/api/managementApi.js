
import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId, getCurrentDatabaseOrThrow, beginFirebaseOperation } from '@/lib/firebase/core';
import { getDatabase, ref, get, set, remove, runTransaction, update, onValue, off } from 'firebase/database';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { validateInheritedStockStatus, reconciliarMateriaPrima } from './stockDeliveryAutomation';
import { aplicarReglaMateriaPrima, resolverToggleManualMateriaPrima } from './deliveryPorStock';
import { calcularCostoPromo } from '@/lib/utils/promoCosting';
import { deleteArticleImage, migrateArticleImageIfNeeded } from '@/lib/firebase/storage';
import { getAvailableUnits } from '@/lib/api/stockAvailability';

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
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation(LOCAL_ID);
    const db = op.getDatabaseOrAbort();

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
            // Revalida antes del update() definitivo: el get() de arriba fue un await real.
            await update(ref(op.getDatabaseOrAbort()), updates);
        }

        return { synced: syncCount, errors };
    } catch (error) {
        console.error('[Optional Sync] Error syncing optional to articles:', error);
        throw new Error(`Failed to sync optional to articles: ${error.message}`);
    }
};

const removeOptionalFromArticles = async (groupCode, optionalCode) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation(LOCAL_ID);
    const db = op.getDatabaseOrAbort();

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
            // Revalida antes del update() definitivo: el get() de arriba fue un await real.
            await update(ref(op.getDatabaseOrAbort()), updates);
        }

        return { removed: removeCount };
    } catch (error) {
        console.error('[Optional Cleanup] Error removing optional from articles:', error);
        throw error;
    }
};

export const listenToManagementData = (tabId, callback, errorCallback) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const tabConfig = getTabConfig(tabId);
    if (!tabConfig) return () => {};

    let db;
    try {
        db = getCurrentDatabaseOrThrow();
    } catch (e) {
        console.warn('[listenToManagementData] Firebase todavía no está listo, no se suscribe:', e.message);
        if (errorCallback) errorCallback(e);
        return () => {};
    }
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
    const LOCAL_ID = getCurrentDatabasePath();
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
    const LOCAL_ID = getCurrentDatabasePath();
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

// NOTA: sin callers en el código actual (verificado). Se corrige igualmente para no dejar el
// mismo bug duplicado (para un artículo por receta, `article.stock` es un objeto truthy → el
// cálculo anterior daba NaN) latente por si se vuelve a usar. No calcula grupos a elección
// (mismo alcance que tenía originalmente); si se necesita, usar usePromotionMinimumStock, que sí
// los contempla y es la versión reactiva/con listeners de este mismo cálculo.
export const fetchPromotionMinimumStock = async (promotionId) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
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
        let hasAnyItem = false;
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
                hasAnyItem = true;
                limitedBy = artId;
                details.push({ id: artId, name: artId, stock: 0, required: qtyNeeded, type: 'article', possible: 0 });
                continue;
            }

            // Disponibilidad real respetando propio/heredado/receta (misma función que usan
            // la pantalla de Stock y usePromotionMinimumStock — ver stockAvailability.js).
            const available = getAvailableUnits(artId, articlesData, mpData);
            const possiblePromosArt = Math.floor(available / qtyNeeded);

            details.push({
                id: artId, name: article.nombre, stock: available, required: qtyNeeded,
                type: 'article', possible: possiblePromosArt
            });

            hasAnyItem = true;
            if (limitedBy === null || possiblePromosArt < minStock) {
                minStock = possiblePromosArt;
                limitedBy = article.nombre;
            }
        }

        return {
            minimumStock: hasAnyItem ? minStock : 0,
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
    const LOCAL_ID = getCurrentDatabasePath();
    const tabConfig = getTabConfig(tabId);
    if (!tabConfig) throw new Error("Invalid tab ID");

    let finalData = { ...data };
    let finalPath;
    let newKey = finalData.codigo;

    // Un solo "op" para toda la función: hay varios await reales antes del
    // set() definitivo (lecturas previas, migración de imagen a Storage) y
    // más awaits después (sync de opcionales, validación de stock heredado)
    // antes de la transacción del contador. Se revalida en cada punto de
    // escritura, no solo al principio.
    const op = beginFirebaseOperation(LOCAL_ID);
    const db = op.getDatabaseOrAbort();

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
        // MATERIA_PRIMA/{id}/ignoraStock: SIEMPRE booleano real (nunca string).
        // Ausente en el formulario o en Firebase = false. No se migra nada en
        // masa: el campo se persiste al crear o editar cada materia prima.
        dataToSave.ignoraStock = finalData.ignoraStock === true;
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
            dataToSave.promoItems = dataToSave.promoItems.map(({ uniqueId, ...item }) => {
                // Limpiar permitidos vacío: Firebase convierte [] a null y lo elimina,
                // lo que genera ambigüedad. Omitir el campo si no hay restricción activa.
                if (item.tipo === 'grupo' && Array.isArray(item.permitidos) && item.permitidos.length === 0) {
                    const { permitidos, ...cleanItem } = item;
                    return cleanItem;
                }
                return item;
            });
            // [DIAG] Log del objeto exacto de promoItems que se enviará a Firebase
            console.log('[PROMO DIAG] saveData - promoItems antes de guardar en Firebase:', JSON.stringify(dataToSave.promoItems, null, 2));
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

    // Para promos: calcular y persistir costo total desde sus componentes
    if (tabId === 'articulos' && dataToSave.isPromo && Array.isArray(dataToSave.promoItems) && dataToSave.promoItems.length > 0) {
        try {
            const promoCostResult = calcularCostoPromo(
                dataToSave.nombre || '',
                dataToSave.promoItems,
                allData?.articulos || [],
                allData?.['materia-prima'] || [],
                allData?.['grupos-productos'] || []
            );
            dataToSave.costoTotalPromo = promoCostResult.costoFijo;
            dataToSave.costoTotalReceta = promoCostResult.costoEstimado;
            dataToSave.costoEstimadoMinimo = promoCostResult.costoMinimo;
            dataToSave.costoEstimadoMaximo = promoCostResult.costoMaximo;
            dataToSave.detalleCostosPromo = promoCostResult.detalle;
            console.log('[managementApi] Promo costo guardado:', {
                costoTotalReceta: promoCostResult.costoEstimado,
                costoTotalPromo: promoCostResult.costoFijo,
                min: promoCostResult.costoMinimo,
                max: promoCostResult.costoMaximo,
            });
        } catch (err) {
            console.warn('[managementApi] No se pudo calcular costo de promo:', err);
        }
    }

    // ── Imagen de artículo: migración a storageBasePath + limpieza de la vieja ──
    // Se decide ANTES del set() qué imagen vieja borrar (después), y si hay que
    // migrar la actual. NUNCA se borra antes de que el set() sea exitoso.
    let oldFotoToDelete = null;
    if (tabId === 'articulos' && isEditing) {
        const oldFoto  = existingArticleData?.foto;
        const formFoto = dataToSave.foto;
        const isFirebaseUrl = (u) => typeof u === 'string' && u.includes('firebasestorage.googleapis.com');

        if (formFoto === oldFoto && isFirebaseUrl(oldFoto)) {
            // A) Guardado sin cambiar imagen → intentar migrar a storageBasePath.
            try {
                const migrated = await migrateArticleImageIfNeeded(oldFoto, newKey);
                if (migrated?.newUrl) {
                    dataToSave.foto = migrated.newUrl; // se guarda la URL nueva
                    oldFotoToDelete = oldFoto;         // borrar la vieja tras el set
                }
            } catch (e) {
                // Migración falló → mantener la vieja, no borrar nada.
                console.warn('[Article Image] Migración omitida (se conserva la imagen actual):', e?.message || e);
            }
        } else if (formFoto === '' && isFirebaseUrl(oldFoto)) {
            // C) Se quitó la imagen → borrar la vieja tras el set.
            oldFotoToDelete = oldFoto;
        } else if (isFirebaseUrl(formFoto) && formFoto !== oldFoto && isFirebaseUrl(oldFoto)) {
            // B) Se reemplazó por una imagen nueva de Firebase → borrar la vieja tras el set.
            oldFotoToDelete = oldFoto;
        }
        // D) precio/nombre sin imagen, o URL externa → no se toca Storage.
    }

    // [DIAG] Log del objeto completo enviado a Firebase
    if (dataToSave.isPromo) {
        console.log('[PROMO DIAG] saveData - objeto completo enviado a Firebase:', {
            path: finalPath,
            isPromo: dataToSave.isPromo,
            nombre: dataToSave.nombre,
            promoItems: dataToSave.promoItems,
            stock: dataToSave.stock,
        });
    }
    // MATERIA PRIMA: resolver `activo` + marcadores ANTES del set() (que
    // reemplaza el nodo completo). Se arrastran los flags previos para no perder
    // la memoria de restauración, y se respeta la intención MANUAL del usuario
    // según el stock (encender con stock 0 no habilita; apagar durante el
    // agotamiento cancela la restauración). El cascadeo a los artículos y el
    // caso puramente de stock los asegura la reconciliación posterior al set().
    //
    // El interruptor "Ignora Stock" entra por `base.ignoraStock` (valor NUEVO) y
    // por eso se resuelve EN ESTE MISMO GUARDADO, sin necesidad de otra venta ni
    // de reiniciar la aplicación:
    //   · encenderlo con stock agotado → la materia prima deja de estar agotada;
    //     si el apagado había sido AUTOMÁTICO y antes estaba activa, vuelve a
    //     `activo = true` y se borran sus marcadores. Si la había apagado el
    //     usuario a mano, sigue apagada.
    //   · apagarlo con stock agotado → se aplica el bloqueo normal en el acto
    //     (activo = false, marcadores guardados) y la reconciliación posterior
    //     apaga el delivery de los artículos que la usan.
    if (tabId === 'materia-prima') {
        let existente = {};
        if (isEditing) {
            try {
                const s = await get(ref(op.getDatabaseOrAbort(), finalPath));
                if (s.exists()) existente = s.val() || {};
            } catch (e) {
                console.warn('[MP Save] No se pudo leer el estado previo:', e?.message || e);
            }
        }
        const base = { ...existente, ...dataToSave };
        if (dataToSave.activo === undefined && existente.activo !== undefined) {
            base.activo = existente.activo;
        }
        base.apagadoAutomaticoPorStock = existente.apagadoAutomaticoPorStock;
        base.activoAntesDeAgotarse = existente.activoAntesDeAgotarse;
        base.stock = dataToSave.stock;

        const intencionManual = dataToSave.activo !== undefined
            && Boolean(dataToSave.activo) !== Boolean(existente.activo);
        const { patch } = intencionManual
            ? resolverToggleManualMateriaPrima(base, Boolean(dataToSave.activo))
            : aplicarReglaMateriaPrima(base);

        dataToSave.apagadoAutomaticoPorStock = existente.apagadoAutomaticoPorStock;
        dataToSave.activoAntesDeAgotarse = existente.activoAntesDeAgotarse;
        if (base.activo !== undefined) dataToSave.activo = base.activo;
        for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete dataToSave[k];
            else dataToSave[k] = v;
        }
        for (const k of ['activo', 'apagadoAutomaticoPorStock', 'activoAntesDeAgotarse']) {
            if (dataToSave[k] === undefined) delete dataToSave[k];
        }
    }

    // Revalida antes del set() definitivo: arriba puede haber habido lecturas
    // previas y/o una migración de imagen a Storage (awaits reales).
    await set(ref(op.getDatabaseOrAbort(), finalPath), dataToSave);

    // MATERIA PRIMA: reconciliación idempotente posterior al set — pone
    // activo=false si el stock quedó en 0 y cascada activoDelivery a los
    // artículos que la usan (y restaura lo que corresponda).
    if (tabId === 'materia-prima') {
        try { await reconciliarMateriaPrima(newKey); }
        catch (e) { console.warn('[MP Save] reconciliación posterior falló:', e?.message || e); }
    }

    // RTDB ya quedó guardado OK → recién ahora borrar la imagen vieja (best-effort).
    if (oldFotoToDelete && oldFotoToDelete !== dataToSave.foto) {
        try { await deleteArticleImage(oldFotoToDelete); }
        catch (e) { console.warn('[Article Image] No se pudo borrar la imagen vieja:', e?.message || e); }
    }

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
        // Revalida antes de tocar el contador: el guardado principal ya está
        // hecho (correctamente, en el local en el que empezó); esto es una
        // actualización secundaria y NO debe escribirse en un local distinto.
        const counterRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/CONTADORES/${tabConfig.path}`);
        await runTransaction(counterRef, (currentCounter) => {
            return Math.max(currentCounter || 0, numericId);
        });
    }
    
    return finalData;
};

export const deleteData = async (tabId, item) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const tabConfig = getTabConfig(tabId);
    if (!tabConfig) throw new Error("Invalid tab ID");
    
    let path = `${LOCAL_ID}/${tabConfig.path}/${item.codigo}`;
    if (tabId === 'opcionales') {
        path = `${LOCAL_ID}/${tabConfig.path}/${item.grupo}/${item.codigo}`;
    }

    const op = beginFirebaseOperation(LOCAL_ID);

    if (tabId === 'opcionales') {
        try {
            await removeOptionalFromArticles(item.grupo, item.codigo);
        } catch (cleanupError) {
            console.error('[Optional Delete] Failed to cleanup optional from articles:', cleanupError);
        }
    }

    // Revalida antes del remove() definitivo: removeOptionalFromArticles()
    // arriba hizo su propio await real.
    const itemRef = ref(op.getDatabaseOrAbort(), path);
    await remove(itemRef);

    // Artículo borrado de RTDB → borrar también su imagen en Storage (best-effort).
    // deleteArticleImage ya ignora foto vacío y URLs que no sean de Firebase Storage.
    if (tabId === 'articulos') {
        try { await deleteArticleImage(item.foto); }
        catch (e) { console.warn('[Article Image] No se pudo borrar la imagen del artículo eliminado:', e?.message || e); }
    }

    return true;
};

export const updateTachoStock = async (tachoId, newStock) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const db = getDatabase();
    const stockRef = ref(db, `${LOCAL_ID}/TACHOS/${tachoId}/stock`);
    
    await set(stockRef, newStock);
};

export const updateArticlePrice = async (articleId, newPrice) => {
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
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
    const LOCAL_ID = getCurrentDatabasePath();
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
    const LOCAL_ID = getCurrentDatabasePath();
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
