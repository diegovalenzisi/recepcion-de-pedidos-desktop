import { useState, useEffect, useCallback } from 'react';
import { getOrdersFromCache, saveOrdersToCache, updateOrderInCache, clearDelivererCache } from '@/lib/cache/cacheManager';

export const useOrderCache = () => {
  const [cachedOrders, setCachedOrders] = useState([]);
  const [isCacheLoading, setIsCacheLoading] = useState(true);

  const loadFromCache = useCallback(async () => {
    setIsCacheLoading(true);
    try {
      const orders = await getOrdersFromCache();
      if (orders && orders.length > 0) {
        setCachedOrders(orders);
      }
    } catch (error) {
      console.error("Failed to load orders from cache", error);
    } finally {
      setIsCacheLoading(false);
    }
  }, []);

  const syncCache = useCallback(async (firebaseOrders) => {
    if (firebaseOrders && firebaseOrders.length > 0) {
        setCachedOrders(firebaseOrders);
        await saveOrdersToCache(firebaseOrders);
    } else if (firebaseOrders && firebaseOrders.length === 0) {
        setCachedOrders([]);
        await saveOrdersToCache([]);
    }
  }, []);

  const optimisticUpdate = useCallback(async (orderId, updates) => {
      setCachedOrders(prev => {
          const newOrders = prev.map(o => {
              if (o.id === orderId) {
                  let updatedOrder = { ...o, ...updates };
                  
                  // Handle flat updates for nested status object
                  if (updates['status/main'] || updates['status/sub']) {
                      updatedOrder.status = { 
                          ...updatedOrder.status, 
                          main: updates['status/main'] || updatedOrder.status?.main,
                          sub: updates['status/sub'] || updatedOrder.status?.sub
                      };
                  }

                  // Automatic status/sub synchronization for COMANDADO
                  if (updatedOrder.status?.main === 'COMANDADO') {
                      updatedOrder.status = {
                          ...updatedOrder.status,
                          sub: 'Esperando confirmación'
                      };
                  }

                  return updatedOrder;
              }
              return o;
          });
          
          const updatedOrder = newOrders.find(o => o.id === orderId);
          if (updatedOrder) {
              updateOrderInCache(updatedOrder).catch(console.error);
          }
          return newOrders;
      });
  }, []);

  const invalidateDelivererCache = useCallback(async (orderId) => {
      setCachedOrders(prev => prev.map(o => {
          if (o.id === orderId) {
              const { deliverer, repartidor, ...rest } = o;
              return rest;
          }
          return o;
      }));
      await clearDelivererCache(orderId);
  }, []);

  useEffect(() => {
    loadFromCache();
  }, [loadFromCache]);

  return {
    cachedOrders,
    isCacheLoading,
    syncCache,
    optimisticUpdate,
    loadFromCache,
    invalidateDelivererCache
  };
};