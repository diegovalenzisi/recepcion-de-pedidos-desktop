import { useState, useCallback } from 'react';

export const usePromo = ({ allArticles, addArticleToOrder }) => {
  const [promoConfig, setPromoConfig] = useState({
    isConfiguring: false,
    promoArticle: null,
    itemsToConfigure: [],
    configuredItems: [],
    currentIndex: 0,
    isFinalizing: false,
  });

  const resetPromoConfig = useCallback(() => {
    setPromoConfig({
      isConfiguring: false,
      promoArticle: null,
      itemsToConfigure: [],
      configuredItems: [],
      currentIndex: 0,
      isFinalizing: false,
    });
  }, []);

  const startPromo = useCallback((article, settings, context) => {
    const itemsToConfigure = (article.promoItems || []).flatMap(promoItem => {
      const articleDetails = allArticles.find(art => art.id === promoItem.codigo);
      if (!articleDetails) return [];
      
      const quantity = parseInt(promoItem.cantidad, 10) || 1;
      return Array.from({ length: quantity }).map((_, i) => ({
          ...articleDetails,
          quantity: 1,
          uniqueKey: `${promoItem.codigo}-${i}-${Date.now()}`,
      }));
    }).filter(Boolean);

    const hasOptionalsOnItems = itemsToConfigure.some(item => {
        const config = item.opcionalesConfig || {};
        return Object.values(config).some(group => group.activo);
    });

    let showOptionals = false;
    if (context === 'counter' && hasOptionalsOnItems) {
        showOptionals = !!settings?.showOptionalsInCounter;
    } else if (context === 'delivery' && hasOptionalsOnItems) {
        showOptionals = settings?.web?.showOptionalsInDelivery !== false; 
    }

    if (itemsToConfigure.length > 0 && hasOptionalsOnItems && showOptionals) {
      setPromoConfig({
        isConfiguring: true,
        promoArticle: article,
        itemsToConfigure,
        configuredItems: [],
        currentIndex: 0,
        isFinalizing: false,
      });
    } else {
      const finalPromoDetails = itemsToConfigure.map(item => ({
        codigo: item.id,
        nombre: item.nombre,
        cantidad: 1,
        selectedOptionals: {},
      }));

      const finalPromo = {
        ...article,
        promoDetails: finalPromoDetails,
        uniqueId: `${article.id}-${Date.now()}`
      };
      
      addArticleToOrder(finalPromo);
    }
  }, [allArticles, addArticleToOrder]);

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
      
      const finalPromoDetails = newConfiguredItems.map(item => ({
        codigo: item.id,
        nombre: item.nombre,
        cantidad: 1,
        selectedOptionals: item.selectedOptionals || {},
      }));

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
    resetPromoConfig,
  };
};