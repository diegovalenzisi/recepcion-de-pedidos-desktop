import { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';

export const usePromotionMinimumStock = (promotion) => {
    const [state, setState] = useState({
        minimumStock: 0,
        limitedBy: null,
        details: [],
        loading: true,
        error: null
    });

    useEffect(() => {
        if (!promotion || !promotion.isPromo || !promotion.promoItems || promotion.promoItems.length === 0) {
            setState({ minimumStock: 0, limitedBy: null, details: [], loading: false, error: null });
            return;
        }

        const localId = getCurrentLocalId();
        if (!localId) {
            setState(s => ({ ...s, loading: false, error: 'No local ID' }));
            return;
        }

        const db = getDatabase();
        let active = true;
        const listeners = [];

        const calculateStock = async () => {
            try {
                if (!active) return;
                
                // Fetch articles and raw materials in one go for simplicity in this hook
                // In a highly optimized scenario, we'd attach specific listeners and update a local map
                const articlesRef = ref(db, `${localId}/ARTICULOS`);
                const mpRef = ref(db, `${localId}/MATERIA_PRIMA`);
                
                let minStock = Infinity;
                let limitedBy = null;
                const details = [];

                const [artSnap, mpSnap, grpSnap] = await Promise.all([
                    get(articlesRef),
                    get(mpRef),
                    get(ref(db, `${localId}/GRUPOS_PRODUCTOS`))
                ]);

                const articlesData = artSnap.exists() ? artSnap.val() : {};
                const mpData = mpSnap.exists() ? mpSnap.val() : {};
                const groupsData = grpSnap.exists() ? grpSnap.val() : {};

                for (const pItem of promotion.promoItems) {
                    // Rama para items de tipo "grupo a elección"
                    if (pItem.tipo === 'grupo') {
                        const group = groupsData[pItem.grupoId];
                        const rawArticulos = group?.articulos;
                        const groupArticleIds = Array.isArray(rawArticulos)
                            ? rawArticulos
                            : Object.values(rawArticulos || {});
                        const allowedIds = (pItem.permitidos && pItem.permitidos.length > 0)
                            ? pItem.permitidos
                            : groupArticleIds;

                        if (allowedIds.length === 0) {
                            minStock = 0;
                            limitedBy = group?.nombre || pItem.nombre || pItem.grupoId;
                            details.push({ id: pItem.grupoId, name: limitedBy, stock: 0, required: pItem.minSeleccion || 1, type: 'group', possible: 0 });
                            continue;
                        }

                        // Sumar stock disponible de todos los artículos permitidos del grupo
                        let totalGroupStock = 0;
                        for (const artId of allowedIds) {
                            const art = articlesData[artId];
                            if (!art) continue;
                            const artStock = art.stock?.propio !== undefined ? Number(art.stock.propio) : 0;
                            totalGroupStock += Math.max(0, artStock);
                        }

                        // Cantidad requerida por venta de promo (minSeleccion o maxSeleccion o cantidad)
                        const required = pItem.minSeleccion > 0 ? pItem.minSeleccion
                            : pItem.maxSeleccion > 0 ? pItem.maxSeleccion
                            : (pItem.cantidad || 1);
                        const possiblePromos = required > 0 ? Math.floor(totalGroupStock / required) : 0;
                        const groupName = group?.nombre || pItem.nombre || pItem.grupoId;

                        details.push({
                            id: pItem.grupoId,
                            name: groupName,
                            stock: totalGroupStock,
                            required,
                            type: 'group',
                            possible: possiblePromos
                        });

                        if (possiblePromos < minStock) {
                            minStock = possiblePromos;
                            limitedBy = groupName;
                        }
                        continue;
                    }

                    const artId = pItem.codigo || pItem.id;
                    const qtyNeeded = pItem.cantidad || 1;
                    const article = articlesData[artId];

                    if (!article) {
                        minStock = 0;
                        limitedBy = artId;
                        details.push({ id: artId, name: artId, stock: 0, required: qtyNeeded, type: 'article' });
                        continue;
                    }

                    // Check article stock
                    let available = article.stock?.propio !== undefined ? article.stock.propio : (article.stock || 0);
                    const possiblePromosArt = Math.floor(available / qtyNeeded);
                    
                    details.push({ 
                        id: artId, 
                        name: article.nombre, 
                        stock: available, 
                        required: qtyNeeded, 
                        type: 'article',
                        possible: possiblePromosArt
                    });

                    if (possiblePromosArt < minStock) {
                        minStock = possiblePromosArt;
                        limitedBy = article.nombre;
                    }

                    // Check raw materials if any
                    if (article.materiaPrima && Array.isArray(article.materiaPrima)) {
                        for (const mp of article.materiaPrima) {
                            const mpId = mp.codigo || mp.id;
                            const mpQtyNeeded = (mp.cantidad || 1) * qtyNeeded;
                            const rawMat = mpData[mpId];
                            
                            if (!rawMat) {
                                minStock = 0;
                                limitedBy = mpId;
                                details.push({ id: mpId, name: mpId, stock: 0, required: mpQtyNeeded, type: 'raw_material' });
                                continue;
                            }

                            let mpAvailable = rawMat.stock || 0;
                            // Handle inheritance if needed (simplified for this context)
                            if (rawMat.heredadoDe) {
                                const parent = articlesData[rawMat.heredadoDe];
                                if (parent) {
                                    mpAvailable = parent.stock?.propio || 0;
                                }
                            }

                            const possiblePromosMp = Math.floor(mpAvailable / mpQtyNeeded);
                            
                            details.push({ 
                                id: mpId, 
                                name: rawMat.nombre, 
                                stock: mpAvailable, 
                                required: mpQtyNeeded, 
                                type: 'raw_material',
                                possible: possiblePromosMp
                            });

                            if (possiblePromosMp < minStock) {
                                minStock = possiblePromosMp;
                                limitedBy = rawMat.nombre;
                            }
                        }
                    }
                }

                if (active) {
                    setState({
                        minimumStock: minStock === Infinity ? 0 : minStock,
                        limitedBy: limitedBy,
                        details: details,
                        loading: false,
                        error: null
                    });
                }
            } catch (err) {
                if (active) setState(s => ({ ...s, loading: false, error: err.message }));
            }
        };

        // Attach listeners to trigger recalculation when relevant nodes change
        const artRef = ref(db, `${localId}/ARTICULOS`);
        const mpRef = ref(db, `${localId}/MATERIA_PRIMA`);
        const grpRef = ref(db, `${localId}/GRUPOS_PRODUCTOS`);

        const artListener = onValue(artRef, () => calculateStock());
        const mpListener = onValue(mpRef, () => calculateStock());
        const grpListener = onValue(grpRef, () => calculateStock());

        listeners.push({ ref: artRef, listener: artListener });
        listeners.push({ ref: mpRef, listener: mpListener });
        listeners.push({ ref: grpRef, listener: grpListener });

        calculateStock();

        return () => {
            active = false;
            listeners.forEach(l => l.ref && l.listener && typeof l.listener === 'function' && l.listener());
        };
    }, [promotion]);

    return state;
};