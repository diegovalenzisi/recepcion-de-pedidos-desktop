import { useState, useEffect, createContext, useContext } from 'react';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { ref, onValue } from 'firebase/database';
import { getDatabase } from 'firebase/database';

// Valor por defecto con la forma completa para que cualquier consumidor funcione
// aunque (por error) quede fuera del provider, sin romper la UI.
const STOCK_STATUS_DEFAULT = {
  hasOutOfStock: false, hasLowStock: false, isLoading: true,
  outOfStockArticles: [], outOfStockRawMaterials: [],
  lowStockArticles: [], lowStockRawMaterials: [],
  outOfStockItems: [], lowStockItems: [],
  outOfStockCount: 0, lowStockCount: 0,
  lastUpdated: null, localId: null,
};

// Contexto para compartir UNA sola instancia de useStockStatus en toda la app y así
// evitar listeners duplicados sobre ARTICULOS/MATERIA_PRIMA. El provider vive en App.jsx;
// StockPage consume con useStockStatusContext() en vez de volver a montar el hook.
export const StockStatusContext = createContext(STOCK_STATUS_DEFAULT);
export const useStockStatusContext = () => useContext(StockStatusContext);

export const useStockStatus = () => {
  const [hasOutOfStock, setHasOutOfStock] = useState(false);
  const [hasLowStock, setHasLowStock] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const [outOfStockArticles, setOutOfStockArticles] = useState([]);
  const [outOfStockRawMaterials, setOutOfStockRawMaterials] = useState([]);
  const [lowStockArticles, setLowStockArticles] = useState([]);
  const [lowStockRawMaterials, setLowStockRawMaterials] = useState([]);
  
  const [outOfStockItems, setOutOfStockItems] = useState([]);
  const [lowStockItems, setLowStockItems] = useState([]);
  
  const [outOfStockCount, setOutOfStockCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  
  const [lastUpdated, setLastUpdated] = useState(null);
  const [localId, setLocalId] = useState(null);

  useEffect(() => {
    const currentId = getCurrentLocalId();
    setLocalId(currentId);
    
    if (!currentId) {
      setIsLoading(false);
      return;
    }

    const db = getDatabase();
    const articulosRef = ref(db, `${currentId}/ARTICULOS`);
    // El único nodo real de materia prima es MATERIA_PRIMA (ver managementApi/stockApi).
    // Se eliminaron los listeners a MATERIA-PRIMA y materia-prima: no existen en Firebase
    // y solo generaban suscripciones y recálculos desperdiciados.
    const materiaPrimaRef = ref(db, `${currentId}/MATERIA_PRIMA`);

    let currentArticles = [];
    let currentRawMaterials = [];

    const updateState = () => {
      const outOfStockArt = [];
      const lowStockArt = [];
      
      currentArticles.forEach(article => {
        // Skip articles that don't want their stock controlled
        if (article.controlStock === false) {
          return;
        }

        const parseStock = (val) => {
          if (val === undefined || val === null || val === '') return null;
          const num = Number(val);
          return isNaN(num) ? null : num;
        };

        let stockPropio = null;
        let stockHeredado = null;

        if (typeof article.stock === 'object' && article.stock !== null) {
          stockPropio = parseStock(article.stock.propio);
          stockHeredado = parseStock(article.stock.heredado);
        } else {
          stockPropio = parseStock(article.stock);
          stockHeredado = parseStock(article.stockHeredado);
        }

        const isPropioZeroOrLess = stockPropio !== null && stockPropio <= 0;
        const isHeredadoZeroOrLess = stockHeredado !== null && stockHeredado <= 0;
        
        const minStock = Number(article.stockMinimo) || 0;
        const isPropioLow = !isPropioZeroOrLess && (stockPropio !== null && stockPropio <= minStock);
        const isHeredadoLow = !isHeredadoZeroOrLess && (stockHeredado !== null && stockHeredado <= minStock);

        if (isPropioZeroOrLess || isHeredadoZeroOrLess) {
          outOfStockArt.push(article);
        } else if (isPropioLow || isHeredadoLow) {
          lowStockArt.push(article);
        }
      });

      const uniqueRawMaterials = currentRawMaterials;
      
      const outOfStockRaw = [];
      const lowStockRaw = [];

      uniqueRawMaterials.forEach(rm => {
        const stock = Number(rm.stock);
        const minStock = Number(rm.minimo) || 0;
        
        if (!isNaN(stock) && stock <= 0) {
          outOfStockRaw.push(rm);
        } else if (!isNaN(stock) && stock <= minStock) {
          lowStockRaw.push(rm);
        }
      });

      setOutOfStockArticles(outOfStockArt);
      setLowStockArticles(lowStockArt);
      setOutOfStockRawMaterials(outOfStockRaw);
      setLowStockRawMaterials(lowStockRaw);

      const combinedOutOfStock = [
        ...outOfStockArt.map(art => ({
          id: art.codigo,
          name: art.nombre,
          type: 'article',
          stock: typeof art.stock === 'object' ? art.stock.propio : art.stock,
          stockMinimo: Number(art.stockMinimo) || 0,
          originalData: art
        })),
        ...outOfStockRaw.map(rm => ({
          id: rm.codigo,
          name: rm.nombre,
          type: 'rawMaterial',
          stock: rm.stock,
          stockMinimo: Number(rm.minimo) || 0,
          originalData: rm
        }))
      ];
      
      const combinedLowStock = [
        ...lowStockArt.map(art => ({
          id: art.codigo,
          name: art.nombre,
          type: 'article',
          stock: typeof art.stock === 'object' ? art.stock.propio : art.stock,
          stockMinimo: Number(art.stockMinimo) || 0,
          originalData: art
        })),
        ...lowStockRaw.map(rm => ({
          id: rm.codigo,
          name: rm.nombre,
          type: 'rawMaterial',
          stock: rm.stock,
          stockMinimo: Number(rm.minimo) || 0,
          originalData: rm
        }))
      ];

      setOutOfStockItems(combinedOutOfStock);
      setLowStockItems(combinedLowStock);

      const oosCount = combinedOutOfStock.length;
      const lowCount = combinedLowStock.length;

      setOutOfStockCount(oosCount);
      setLowStockCount(lowCount);
      setHasOutOfStock(oosCount > 0);
      setHasLowStock(lowCount > 0);

      setLastUpdated(new Date());
      setIsLoading(false);
    };

    const unsubscribeArt = onValue(articulosRef, (snapshot) => {
      const data = snapshot.val();
      currentArticles = data ? Object.keys(data).map(key => ({ codigo: key, ...data[key] })) : [];
      updateState();
    }, (error) => {
      console.error("Error loading articles stock:", error);
      setIsLoading(false);
    });

    const unsubscribeRaw = onValue(materiaPrimaRef, (snapshot) => {
      const data = snapshot.val();
      currentRawMaterials = data ? Object.keys(data).map(key => ({ codigo: key, ...data[key] })) : [];
      updateState();
    });

    return () => {
      unsubscribeArt();
      unsubscribeRaw();
    };
  }, []);

  return { 
    hasOutOfStock, hasLowStock,
    isLoading, 
    outOfStockArticles, outOfStockRawMaterials,
    lowStockArticles, lowStockRawMaterials,
    outOfStockItems, lowStockItems,
    outOfStockCount, lowStockCount,
    lastUpdated, localId 
  };
};