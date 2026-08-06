import { getDatabase, ref, get, query, orderByChild, equalTo, runTransaction } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { fetchAllStockableItems } from '@/lib/api/stockApi';

const updateStatisticsRecursive = async (item, quantity, fechaCaja, allStockableItems, updates) => {
  const { articulos, materiaPrima } = allStockableItems;
  const itemCode = item.id || item.codigo;

  const allItemsMap = { ...articulos, ...materiaPrima };

  if (allItemsMap[itemCode]) {
    const path = `ESTADISTICAS/${fechaCaja}/${itemCode}`;
    if (!updates[path]) {
      updates[path] = 0;
    }
    updates[path] += quantity;
  }

  const articleDetails = articulos[itemCode];
  if (articleDetails) {
    if (articleDetails.stock?.receta) {
      for (const [ingredientCode, ingredientQty] of Object.entries(articleDetails.stock.receta)) {
        const ingredientItem = { id: ingredientCode, codigo: ingredientCode };
        await updateStatisticsRecursive(ingredientItem, ingredientQty * quantity, fechaCaja, allStockableItems, updates);
      }
    }
    
    if (articleDetails.isPromo) {
      const promoItems = item.promoDetails || articleDetails.promoItems || [];
      for (const promoItem of promoItems) {
        await updateStatisticsRecursive(promoItem, (promoItem.cantidad || 1) * quantity, fechaCaja, allStockableItems, updates);
      }
    }

    if (articleDetails.stock?.heredadoDe) {
        const inheritedItem = { id: articleDetails.stock.heredadoDe, codigo: articleDetails.stock.heredadoDe };
        await updateStatisticsRecursive(inheritedItem, quantity, fechaCaja, allStockableItems, updates);
    }
  }
};

export const updateStatistics = async (items, fechaCaja) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();

  const allStockableItems = await fetchAllStockableItems();

  const updates = {};
  for (const item of items) {
    const quantity = item.cantidad || item.quantity || 1;
    await updateStatisticsRecursive(item, quantity, fechaCaja, allStockableItems, updates);
  }

  for (const path in updates) {
    // Revalida en CADA iteración: fetchAllStockableItems() de arriba fue un
    // await real, y este loop en sí puede ser largo (una transacción por path).
    const statRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/${path}`);
    await runTransaction(statRef, (currentData) => {
      return (currentData || 0) + updates[path];
    });
  }
};

export const fetchSalesByDate = async (date) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();

  const processOrders = (orders) => {
    return Object.keys(orders || {}).map(key => {
      const order = { ...orders[key], id: key };
      if (order.payment && typeof order.payment.total === 'undefined') {
        order.payment.total = order.payment.amount;
      }
      return order;
    });
  };

  try {
    const counterSalesRef = query(ref(db, `${LOCAL_ID}/MOSTRADOR`), orderByChild('fechacaja'), equalTo(date));
    const counterSnapshot = await get(counterSalesRef);
    const counterSalesData = counterSnapshot.val() || {};
    const counterSales = Object.keys(counterSalesData).map(key => ({ ...counterSalesData[key], id: `M${key}`, type: 'Mostrador' }));

    const deliveryOrdersRef = query(ref(db, `${LOCAL_ID}/PEDIDOS`), orderByChild('fechacaja'), equalTo(date));
    const deliverySnapshot = await get(deliveryOrdersRef);
    const deliveryOrdersData = deliverySnapshot.val() || {};
    const deliveryOrders = processOrders(deliveryOrdersData).map(order => ({ ...order, id: `D${order.id}`, type: 'Delivery' }));

    const allSales = [...counterSales, ...deliveryOrders];
    allSales.sort((a, b) => new Date(b.date + ' ' + b.hora) - new Date(a.date + ' ' + a.hora));

    return allSales;
  } catch (error) {
    console.error("Error fetching sales by date:", error);
    throw error;
  }
};

export const fetchStatisticsByDateRange = async (startDate, endDate) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  const statisticsRef = ref(db, `${LOCAL_ID}/ESTADISTICAS`);

  const snapshot = await get(statisticsRef);
  if (!snapshot.exists()) {
    return { articles: [], rawMaterials: [] };
  }

  const allItems = await fetchAllStockableItems();
  const { articulos, materiaPrima } = allItems;
  
  const allStats = snapshot.val();
  const aggregatedStats = {};

  Object.keys(allStats).forEach(dateStr => {
    const dateParts = dateStr.split('-');
    if(dateParts.length !== 3) return;
    const date = new Date(+dateParts[2], dateParts[1] - 1, +dateParts[0]);

    if (date >= startDate && date <= endDate) {
      const dayStats = allStats[dateStr];
      Object.entries(dayStats).forEach(([code, total]) => {
        if (!aggregatedStats[code]) {
          aggregatedStats[code] = { total: 0, codigo: code };
        }
        aggregatedStats[code].total += total;
      });
    }
  });
  
  const aggregatedList = Object.values(aggregatedStats);
  const articlesList = [];
  const rawMaterialsList = [];

  aggregatedList.forEach(item => {
    if (articulos[item.codigo]) {
      articlesList.push({ ...item, nombre: articulos[item.codigo].nombre });
    } else if (materiaPrima[item.codigo]) {
      rawMaterialsList.push({ ...item, nombre: materiaPrima[item.codigo].nombre });
    }
  });

  const sortedArticles = articlesList.sort((a, b) => b.total - a.total);
  const sortedRawMaterials = rawMaterialsList.sort((a, b) => b.total - a.total);
  
  return { articles: sortedArticles, rawMaterials: sortedRawMaterials };
};