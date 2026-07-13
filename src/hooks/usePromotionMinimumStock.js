import { useState, useEffect } from 'react';
import { getDatabase, ref, onValue, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { getAvailableUnits } from '@/lib/api/stockAvailability';

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
                
                // minStock empieza en Infinity como sentinela de "todavía no evaluado". Con
                // artículos sin control de stock (controlStock === false), un componente puede
                // legítimamente valer Infinity ("ilimitado"), así que ya no alcanza con comparar
                // `< minStock` para decidir si se procesó algo: Infinity < Infinity es false, y
                // el sentinela quedaría indistinguible de un resultado real ilimitado. `hasAnyItem`
                // resuelve esa ambigüedad explícitamente.
                let minStock = Infinity;
                let limitedBy = null;
                let hasAnyItem = false;
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
                            hasAnyItem = true;
                            limitedBy = group?.nombre || pItem.nombre || pItem.grupoId;
                            details.push({ id: pItem.grupoId, name: limitedBy, stock: 0, required: pItem.minSeleccion || 1, type: 'group', possible: 0 });
                            continue;
                        }

                        // Sumar stock disponible REAL (propio, heredado o receta, con materia
                        // prima y recetas anidadas) de todos los artículos permitidos del grupo.
                        // Un artículo sin control de stock aporta Infinity, lo cual vuelve
                        // Infinity la suma del grupo entero — correcto: si alguna opción del
                        // grupo es ilimitada, el grupo no debe limitar la promo.
                        let totalGroupStock = 0;
                        for (const artId of allowedIds) {
                            const art = articlesData[artId];
                            if (!art) continue;
                            const artAvailable = getAvailableUnits(artId, articlesData, mpData);
                            totalGroupStock += Math.max(0, artAvailable);
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

                        hasAnyItem = true;
                        if (limitedBy === null || possiblePromos < minStock) {
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
                        hasAnyItem = true;
                        limitedBy = artId;
                        details.push({ id: artId, name: artId, stock: 0, required: qtyNeeded, type: 'article', possible: 0 });
                        continue;
                    }

                    // Disponibilidad REAL del artículo, respetando su tipo de stock: propio,
                    // heredado o receta (incluyendo materia prima y recetas anidadas). Antes se
                    // usaba normalizarStock(article.stock), que para un artículo por receta
                    // devolvía 0 porque el objeto de stock no tiene campo `propio` — causa raíz
                    // del bug "Stock 0" en promociones con artículos por receta. getAvailableUnits
                    // es la única fuente de verdad, compartida con la pantalla de Stock (DataTable).
                    const available = getAvailableUnits(artId, articlesData, mpData);
                    const possiblePromosArt = Math.floor(available / qtyNeeded);

                    details.push({
                        id: artId,
                        name: article.nombre,
                        stock: available,
                        required: qtyNeeded,
                        type: 'article',
                        possible: possiblePromosArt
                    });

                    hasAnyItem = true;
                    if (limitedBy === null || possiblePromosArt < minStock) {
                        minStock = possiblePromosArt;
                        limitedBy = article.nombre;
                    }
                }

                if (active) {
                    // minStock === Infinity solo debe convertirse a 0 si NUNCA se procesó ningún
                    // ítem (no debería pasar con promoItems.length > 0, pero se deja como red de
                    // seguridad). Si SÍ se procesaron ítems y el resultado es Infinity, es porque
                    // todos los componentes son genuinamente ilimitados (controlStock === false)
                    // — debe conservarse como Infinity para que la UI lo muestre como "ilimitado",
                    // no como "sin stock".
                    setState({
                        minimumStock: hasAnyItem ? minStock : 0,
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