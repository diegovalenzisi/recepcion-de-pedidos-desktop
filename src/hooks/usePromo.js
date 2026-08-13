import { useState, useCallback } from 'react';
import { calcularCostoProducto } from '@/lib/utils/promoCosting';
import { getGroupOptionIds, opcionesDisponiblesDeGrupo } from '@/lib/api/stockAvailability';

const initialPromoConfig = {
  isConfiguring: false,
  promoArticle: null,
  itemsToConfigure: [],
  allResolvedItems: [],
  configuredItems: [],
  currentIndex: 0,
  isFinalizing: false,
  isResolvingGroups: false,
  groupChoicesToResolve: [],
  currentGroupIndex: 0,
  resolvedGroupItems: [],
  settings: null,
  context: null,
};

// An item only needs the optionals/flavors step if it has at least one
// active opcionales group configured. Group items already resolved to a
// real article (e.g. "GIO Chocolate") that don't define optionals must not
// trigger this step.
const articleNeedsOptionals = (articleDetails) => {
  const config = articleDetails?.opcionalesConfig || {};
  return Object.values(config).some(group => group && typeof group === 'object' && group.activo);
};

export const usePromo = ({ allArticles, addArticleToOrder, allProductGroups, verifiedArticles, onPromoUnavailable }) => {
  const [promoConfig, setPromoConfig] = useState(initialPromoConfig);

  const resetPromoConfig = useCallback(() => {
    setPromoConfig(initialPromoConfig);
  }, []);

  const proceedWithItems = useCallback((article, settings, context, resolvedGroupItems) => {
    let groupSlotIndex = 0;
    // Sequential counter shared across the whole flatMap so every resolved
    // item gets a globally unique key, even when multiple promoItems share
    // the same codigo/grupoId (e.g. "3x2 cuartos" added as 3 separate
    // entries with cantidad: 1). Date.now()-based keys could collide here
    // because all entries resolve within the same millisecond.
    let resolvedItemSeq = 0;
    // Resolve every promo component (fixed items and group choices) into the
    // real article it represents. From this point on, group items are fully
    // replaced by the chosen real article and "resolved" - nothing about the
    // original group remains.
    const allResolvedItems = (article.promoItems || []).flatMap(promoItem => {
      const quantity = parseInt(promoItem.cantidad, 10) || 1;

      if (promoItem.tipo === 'grupo') {
        const hasMinMax = (promoItem.minSeleccion > 0) || (promoItem.maxSeleccion > 0);
        if (hasMinMax) {
          // Multi-select: un slot con array de articleIds
          const resolved = resolvedGroupItems[groupSlotIndex];
          groupSlotIndex++;
          if (!resolved || !resolved.articleIds) return [];
          return resolved.articleIds.map(articleId => {
            const articleDetails = allArticles.find(art => art.id === articleId);
            if (!articleDetails) return null;
            return {
              ...articleDetails,
              quantity: 1,
              uniqueKey: `${promoItem.uniqueId || articleId}-${resolvedItemSeq++}`,
            };
          }).filter(Boolean);
        }
        // Single-select: quantity slots individuales (comportamiento actual)
        return Array.from({ length: quantity }).map(() => {
          const resolved = resolvedGroupItems[groupSlotIndex];
          groupSlotIndex++;
          if (!resolved) return null;
          const articleDetails = allArticles.find(art => art.id === resolved.articleId);
          if (!articleDetails) return null;
          return {
            ...articleDetails,
            quantity: 1,
            uniqueKey: `${promoItem.uniqueId || resolved.articleId}-${resolvedItemSeq++}`,
          };
        }).filter(Boolean);
      }

      const articleDetails = allArticles.find(art => art.id === promoItem.codigo);
      if (!articleDetails) return [];

      return Array.from({ length: quantity }).map(() => ({
          ...articleDetails,
          quantity: 1,
          uniqueKey: `${promoItem.uniqueId || promoItem.codigo}-${resolvedItemSeq++}`,
      }));
    }).filter(Boolean);

    // Only items that actually have an active opcionales group need the
    // flavors/optionals step. A group item already resolved to a real
    // article (e.g. "GIO Chocolate") without optionals must not reopen any
    // selection screen.
    const itemsToConfigure = allResolvedItems.filter(articleNeedsOptionals);

    let showOptionals = false;
    if (itemsToConfigure.length > 0) {
      if (context === 'counter') {
          showOptionals = !!settings?.showOptionalsInCounter;
      } else if (context === 'delivery') {
          showOptionals = settings?.web?.showOptionalsInDelivery !== false;
      }
    }

    // Costo real con los artículos efectivamente elegidos (incluye grupos resueltos)
    const costoRealTotal = allResolvedItems.reduce((sum, item) => {
      const result = calcularCostoProducto(item.id, 1, allArticles, null);
      return sum + result.costoUnitario;
    }, 0);
    const costoRealRedondeado = Math.round(costoRealTotal * 1000) / 1000;
    console.log(`[PROMO COSTO] costoTotalPromo=${costoRealRedondeado} (venta real con items elegidos)`);

    if (itemsToConfigure.length > 0 && showOptionals) {
      setPromoConfig({
        ...initialPromoConfig,
        isConfiguring: true,
        promoArticle: { ...article, costoTotalReceta: costoRealRedondeado },
        itemsToConfigure,
        allResolvedItems,
        configuredItems: [],
        currentIndex: 0,
        isFinalizing: false,
      });
    } else {
      const finalPromoDetails = allResolvedItems.map(item => ({
        codigo: item.id,
        nombre: item.nombre,
        cantidad: 1,
        selectedOptionals: {},
      }));

      const finalPromo = {
        ...article,
        promoDetails: finalPromoDetails,
        costoTotalReceta: costoRealRedondeado,
        uniqueId: `${article.id}-${Date.now()}`
      };

      addArticleToOrder(finalPromo);
      resetPromoConfig();
    }
  }, [allArticles, addArticleToOrder, resetPromoConfig]);

  const startPromo = useCallback((article, settings, context) => {
    const groupChoicesToResolve = [];
    const descuentaPorArticulo = article.stock?.descuentaPorArticulo === true;
    const availableIds = new Set((verifiedArticles || []).map(a => a.id));

    let hasEmptyGroup = false;

    (article.promoItems || []).forEach(promoItem => {
      if (promoItem.tipo !== 'grupo') return;

      const group = (allProductGroups || []).find(g => g.id === promoItem.grupoId);
      const groupArticleIds = group?.articulos || [];
      const allowedIds = getGroupOptionIds(promoItem, allProductGroups);
      let options = allowedIds
        .map(id => allArticles.find(art => art.id === id))
        .filter(Boolean);

      // [DIAG] Log para verificar qué artículos se resuelven para el grupo
      console.log('[PROMO DIAG] startPromo - resolviendo grupo:', {
        grupoId: promoItem.grupoId,
        grupoNombre: promoItem.nombre,
        grupoEncontrado: !!group,
        articulosEnGrupo: groupArticleIds,
        permitidos: promoItem.permitidos,
        allowedIds,
        optionsResueltas: options.map(o => ({ id: o.id, nombre: o.nombre })),
        descuentaPorArticulo,
        minSeleccion: promoItem.minSeleccion,
        maxSeleccion: promoItem.maxSeleccion,
      });

      // LO QUE SE OFRECE DENTRO DE UNA PROMO = LO QUE SE OFRECE FUERA DE ELLA.
      //
      // `verifiedArticles` es el catálogo ya filtrado por `useStockVerification`
      // para el canal actual: la MISMA fuente que decide qué ve el operador en
      // la grilla. Reutilizarla acá garantiza que un artículo agotado o apagado
      // a mano no se pueda elegir dentro de una promoción, sin duplicar reglas.
      //
      // Antes este filtro corría SOLO si la promo tenía
      // `stock.descuentaPorArticulo === true`. Las promos sin esa marca —que
      // son la mayoría— ofrecían todos los artículos del grupo, incluidos los
      // que estaban en cero, y recién fallaban al descontar. La disponibilidad
      // de una opción no depende de CÓMO descuenta la promo, así que la
      // condición no correspondía.
      //
      // Si `availableIds` está vacío el catálogo verificado todavía no cargó:
      // en ese caso NO se filtra, porque "no sé nada" no es lo mismo que "no
      // hay nada" y vaciar el grupo cancelaría la promo por error.
      {
        const disponibles = opcionesDisponiblesDeGrupo(promoItem, allProductGroups, allArticles, availableIds);
        if (disponibles.length > 0) {
          options = disponibles;
        } else if (availableIds.size > 0) {
          // Ninguna opción del grupo se puede vender: la promo no se puede armar.
          console.warn('[PROMO] grupo sin opciones disponibles:', promoItem.grupoId, promoItem.nombre);
          hasEmptyGroup = true;
        }
      }

      const hasMinMax = (promoItem.minSeleccion > 0) || (promoItem.maxSeleccion > 0);
      if (hasMinMax) {
        // Multi-select: un único slot donde el operador elige entre min y max productos
        groupChoicesToResolve.push({
          nombre: promoItem.nombre,
          options,
          minSeleccion: promoItem.minSeleccion > 0 ? promoItem.minSeleccion : 0,
          maxSeleccion: promoItem.maxSeleccion > 0 ? promoItem.maxSeleccion : null,
          isMultiSelect: true,
        });
      } else {
        // Comportamiento actual: quantity slots de selección individual
        const quantity = parseInt(promoItem.cantidad, 10) || 1;
        for (let i = 0; i < quantity; i++) {
          groupChoicesToResolve.push({
            nombre: promoItem.nombre,
            options,
          });
        }
      }
    });

    if (hasEmptyGroup) {
      if (onPromoUnavailable) onPromoUnavailable(article);
      return;
    }

    if (groupChoicesToResolve.length > 0) {
      setPromoConfig({
        ...initialPromoConfig,
        isResolvingGroups: true,
        promoArticle: article,
        groupChoicesToResolve,
        currentGroupIndex: 0,
        resolvedGroupItems: [],
        settings,
        context,
      });
    } else {
      proceedWithItems(article, settings, context, []);
    }
  }, [allArticles, allProductGroups, verifiedArticles, onPromoUnavailable, proceedWithItems]);

  const handleGroupItemResolved = useCallback((selectedArticleIdOrIds) => {
    // Single-select: string. Multi-select: string[].
    const resolvedItem = Array.isArray(selectedArticleIdOrIds)
      ? { articleIds: selectedArticleIdOrIds }
      : { articleId: selectedArticleIdOrIds };

    const newResolvedItems = [...promoConfig.resolvedGroupItems, resolvedItem];
    const nextIndex = promoConfig.currentGroupIndex + 1;

    if (nextIndex < promoConfig.groupChoicesToResolve.length) {
      setPromoConfig(prev => ({
        ...prev,
        resolvedGroupItems: newResolvedItems,
        currentGroupIndex: nextIndex,
      }));
    } else {
      proceedWithItems(promoConfig.promoArticle, promoConfig.settings, promoConfig.context, newResolvedItems);
    }
  }, [promoConfig, proceedWithItems]);

  const handlePromoItemConfigured = useCallback((configuredItem) => {
    const newConfiguredItems = [...promoConfig.configuredItems, configuredItem];
    const nextIndex = promoConfig.currentIndex + 1;

    if (nextIndex < promoConfig.itemsToConfigure.length) {
      setPromoConfig(prev => ({
        ...prev,
        configuredItems: newConfiguredItems,
        currentIndex: nextIndex,
      }));
    } else {
      setPromoConfig(prev => ({ ...prev, isFinalizing: true }));

      // Rebuild the promo components in their original order, using the
      // configured (with optionals) version where available and the
      // already-resolved item (no optionals needed) otherwise.
      const configuredByKey = new Map(newConfiguredItems.map(item => [item.uniqueKey, item]));
      const finalPromoDetails = promoConfig.allResolvedItems.map(item => {
        const source = configuredByKey.get(item.uniqueKey) || item;
        return {
          codigo: source.id,
          nombre: source.nombre,
          cantidad: 1,
          selectedOptionals: source.selectedOptionals || {},
        };
      });

      const finalPromo = {
        ...promoConfig.promoArticle,
        promoDetails: finalPromoDetails,
        uniqueId: `${promoConfig.promoArticle.id}-${Date.now()}`
      };

      addArticleToOrder(finalPromo);
    }
  }, [promoConfig, addArticleToOrder]);

  return {
    promoConfig,
    startPromo,
    handlePromoItemConfigured,
    handleGroupItemResolved,
    resetPromoConfig,
  };
};
