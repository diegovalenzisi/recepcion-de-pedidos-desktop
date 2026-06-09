import React, { useState, useMemo } from 'react';
import { getDatabase, ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import * as XLSX from 'xlsx';
import { eachDayOfInterval, parseISO } from 'date-fns';
import { Loader2, Search, Download, ShieldAlert, BarChart3, Package, Scale } from 'lucide-react';
import { formatDateForFirebase } from '@/lib/utils';
import { fetchAllStockableItems } from '@/lib/api/stockApi';
import { useAuth } from '@/hooks/useAuth';
import { generatePriceExportFilename } from '@/lib/export/priceExportUtils';

const SalesExcelReportPage = () => {
  const { user } = useAuth();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState([]);
  const { toast } = useToast();

  // Access Control Check
  const hasAccess = user && (
    user.rol === 'dueño' || 
    user.rol === 'encargado' || 
    user.usuario === 'DiegoL'
  );

  const fetchSalesForDate = async (db, localId, dateStr) => {
    // dateStr is formatted as dd-MM-yyyy
    const [day, month, year] = dateStr.split('-');

    // 1. Prepare Active Data Queries
    const mostradorRef = query(ref(db, `${localId}/MOSTRADOR`), orderByChild('fechacaja'), equalTo(dateStr));
    const pedidosRef = query(ref(db, `${localId}/PEDIDOS`), orderByChild('fechacaja'), equalTo(dateStr));
    
    // 2. Prepare Backup Data Reference
    const backupDayRef = ref(db, `${localId}/BACKUP/${year}/${month}/${day}`);

    try {
        const [mostradorSnap, pedidosSnap, backupSnap] = await Promise.all([
            get(mostradorRef),
            get(pedidosRef),
            get(backupDayRef)
        ]);

        const salesMap = new Map();

        const addSale = (id, data, source) => {
            // Strict Filtering Rules
            
            // 1. Strict Date Check (Fecha Caja)
            // The sale MUST have a fechacaja and it MUST match the requested date exactly.
            // This prevents data from previous operational days (e.g. post-midnight) appearing if stored in the same backup folder.
            if (data.fechacaja !== dateStr) {
                return;
            }

            // 2. Status Check
            if (source.includes('Delivery') || source.includes('Pedido')) {
                // For Delivery: STRICTLY 'ENTREGADO'
                // Excludes: 'ACEPTADO', 'EN_CAMINO' (en delivery), 'CANCELADO', 'PENDIENTE'
                if (data.status?.main !== 'ENTREGADO') return;
            } else {
                // For Mostrador:
                // Excludes 'CANCELADO'
                if (data.status === 'CANCELADO') return;
            }

            if (!salesMap.has(id)) {
                salesMap.set(id, { ...data, id, source });
            }
        };

        // --- PROCESS ACTIVE DATA ---
        if (mostradorSnap.exists()) {
            const data = mostradorSnap.val();
            Object.keys(data).forEach(key => {
                const sale = data[key];
                if (sale) {
                    addSale(`M${key}`, sale, 'Mostrador (Activo)');
                }
            });
        }

        if (pedidosSnap.exists()) {
            const data = pedidosSnap.val();
            Object.keys(data).forEach(key => {
                const sale = data[key];
                if (sale) {
                    addSale(`D${key}`, sale, 'Delivery (Activo)');
                }
            });
        }

        // --- PROCESS BACKUP DATA ---
        if (backupSnap.exists()) {
            const dayData = backupSnap.val();
            
            const extractSales = (node, prefix, typeLabel) => {
                if (!node) return;
                Object.keys(node).forEach(key => {
                    const sale = node[key];
                    if (sale && typeof sale === 'object') {
                         if (sale.items || sale.total) {
                             addSale(`${prefix}${key}`, sale, typeLabel);
                         }
                    }
                });
            };

            if (dayData.TURNO) {
                Object.values(dayData.TURNO).forEach((turnoData) => {
                    if (turnoData.MOSTRADOR) {
                        if (turnoData.MOSTRADOR.COMPLETADOS) {
                             extractSales(turnoData.MOSTRADOR.COMPLETADOS, 'M', `Mostrador (H)`);
                        } else {
                            extractSales(turnoData.MOSTRADOR, 'M', `Mostrador (H)`);
                        }
                    }
                    if (turnoData.DELIVERY && turnoData.DELIVERY.ENTREGADOS) {
                        extractSales(turnoData.DELIVERY.ENTREGADOS, 'D', `Delivery (H)`);
                    }
                });
            }

            if (dayData.MOSTRADOR) {
                 if (dayData.MOSTRADOR.COMPLETADOS) {
                    extractSales(dayData.MOSTRADOR.COMPLETADOS, 'M', 'Mostrador (H)');
                 } else {
                    extractSales(dayData.MOSTRADOR, 'M', 'Mostrador (H)');
                 }
            }

            if (dayData.DELIVERY && dayData.DELIVERY.ENTREGADOS) {
                extractSales(dayData.DELIVERY.ENTREGADOS, 'D', 'Delivery (H)');
            }
        }

        return Array.from(salesMap.values());

    } catch (error) {
        console.error(`Error fetching data for ${dateStr}:`, error);
        return [];
    }
  };

  const isItemThermal = (def) => {
      if (!def) return false;
      
      const name = (def.nombre || '').toLowerCase();
      // Check if it starts with "termico de" (covers "termico de //", "termico de kilo", etc.)
      if (name.startsWith('termico de') || name.startsWith('térmico de')) {
          return true;
      }

      // Fallback: check metadata
      const dept = (def.departamento || '').toLowerCase();
      const cat = (def.categoria || '').toLowerCase();
      const keywords = ['termico', 'térmico', 'descartable', 'envase', 'caja', 'bolsa'];
      return keywords.some(k => dept.includes(k) || cat.includes(k));
  };

  const resolveIngredients = (itemId, itemData, quantity, stockData, accumulated) => {
      if (itemData.isPromo && itemData.promoItems) {
          itemData.promoItems.forEach(promoItem => {
              const promoSubId = promoItem.id || promoItem.codigo;
              const subItemDef = stockData.articulos[promoSubId] || stockData.materiaPrima[promoSubId];
              
              if (subItemDef) {
                  resolveIngredients(promoSubId, subItemDef, (promoItem.cantidad || 1) * quantity, stockData, accumulated);
              } else {
                  const name = promoItem.nombre || 'Item Promo';
                  if (!accumulated[name]) accumulated[name] = { qty: 0, isThermal: false };
                  accumulated[name].qty += ((promoItem.cantidad || 1) * quantity);
              }
          });
          return;
      }

      const definition = stockData.articulos[itemId] || stockData.materiaPrima[itemId];

      if (!definition) {
           const name = itemData.nombre || 'Desconocido';
           if (!accumulated[name]) accumulated[name] = { qty: 0, isThermal: false };
           accumulated[name].qty += quantity;
           return;
      }

      if (definition.stock && definition.stock.receta) {
          Object.entries(definition.stock.receta).forEach(([ingId, ingQty]) => {
              const ingDef = stockData.articulos[ingId] || stockData.materiaPrima[ingId];
              if (ingDef) {
                  if (ingDef.stock && ingDef.stock.receta) {
                       resolveIngredients(ingId, ingDef, Number(ingQty) * quantity, stockData, accumulated);
                  } else {
                       const name = ingDef.nombre;
                       const isThermal = isItemThermal(ingDef);
                       if (!accumulated[name]) accumulated[name] = { qty: 0, isThermal };
                       accumulated[name].qty += (Number(ingQty) * quantity);
                  }
              }
          });
          return;
      }

      if (definition.stock && definition.stock.heredadoDe) {
           const parentId = definition.stock.heredadoDe;
           const parentDef = stockData.articulos[parentId] || stockData.materiaPrima[parentId];
           if (parentDef) {
               resolveIngredients(parentId, parentDef, quantity, stockData, accumulated);
               return;
           }
      }

      const name = definition.nombre;
      const isThermal = isItemThermal(definition);
      if (!accumulated[name]) accumulated[name] = { qty: 0, isThermal };
      accumulated[name].qty += quantity;
  };

  const findStockDefinition = (item, stockData) => {
      if (item.id && (stockData.articulos[item.id] || stockData.materiaPrima[item.id])) {
          return { id: item.id, ... (stockData.articulos[item.id] || stockData.materiaPrima[item.id]) };
      }
      const artMatch = Object.values(stockData.articulos).find(a => a.nombre === item.nombre);
      if (artMatch) return { id: Object.keys(stockData.articulos).find(key => stockData.articulos[key] === artMatch), ...artMatch };
      const matMatch = Object.values(stockData.materiaPrima).find(m => m.nombre === item.nombre);
      if (matMatch) return { id: Object.keys(stockData.materiaPrima).find(key => stockData.materiaPrima[key] === matMatch), ...matMatch };
      return null;
  };

  const processSaleItems = (sale, stockData) => {
    const rows = [];
    const items = sale.items || [];
    
    let paymentMethod = 'Desconocido';
    if (sale.payment) {
        if (sale.payment.method) {
            paymentMethod = sale.payment.method;
        } else if (sale.payment.payments && Array.isArray(sale.payment.payments)) {
            paymentMethod = sale.payment.payments.map(p => p.method).join(' + ');
        }
    }

    let timeStr = '00:00';
    if (sale.hora) {
        timeStr = sale.hora;
    } else if (sale.times && sale.times.ingress) {
        timeStr = sale.times.ingress;
    } else if (sale.times && sale.times.created) {
         const date = new Date(sale.times.created);
         if (!isNaN(date)) timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    if (timeStr.length === 5) timeStr += ":00";

    const saleDate = sale.fechacaja || sale.date || 'N/A';

    items.forEach(item => {
      let lineValue = 0;
      const qty = parseFloat(item.cantidad || item.quantity || 1);
      
      if (typeof item.valor !== 'undefined') {
          lineValue = parseFloat(item.valor); 
      } else if (typeof item.precio !== 'undefined') {
          lineValue = parseFloat(item.precio) * qty;
      } else if (typeof item.price !== 'undefined') {
          lineValue = parseFloat(item.price) * qty;
      }

      let thermalItems = [];
      let rawMaterialItems = [];

      if (stockData) {
          const ingredients = {};
          if (item.promoItems) {
               resolveIngredients(item.id, { ...item, isPromo: true }, qty, stockData, ingredients);
          } else {
               const def = findStockDefinition(item, stockData);
               if (def) {
                   resolveIngredients(def.id, def, qty, stockData, ingredients);
               } else {
                   ingredients[item.nombre || 'Item'] = { qty, isThermal: false };
               }
          }

          Object.entries(ingredients).forEach(([name, data]) => {
              const formatted = { name, qty: parseFloat(data.qty.toFixed(3)) };
              if (data.isThermal) {
                  thermalItems.push(formatted);
              } else {
                  rawMaterialItems.push(formatted);
              }
          });
      }

      rows.push({
        fechaCaja: saleDate,
        horaVenta: timeStr,
        modo: sale.source,
        cantidad: qty,
        nombreItem: item.nombre || 'Item sin nombre',
        valorVenta: lineValue,
        modoPago: paymentMethod,
        
        // Split data for display/export (will be reformatted on export)
        cantTermico: thermalItems.map(i => i.qty).join('\n'),
        nombreTermico: thermalItems.map(i => i.name).join('\n'),
        cantMateriaPrima: rawMaterialItems.map(i => i.qty).join('\n'),
        nombreMateriaPrima: rawMaterialItems.map(i => i.name).join('\n'),

        // Hidden fields for calculation
        _rawThermalItems: thermalItems,
        _rawMaterialItems: rawMaterialItems
      });
    });

    return rows;
  };

  const getTimeValue = (timeStr) => {
      if (!timeStr) return -1;
      const normalized = timeStr.replace('.', ':');
      const parts = normalized.split(':').map(Number);
      if (parts.length < 2) return 0;
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  };

  const getIceCreamWeight = (name) => {
      if (!name) return 0;
      const n = name.toLowerCase();
      // Exclude packaging or non-bulk items if needed
      if (n.startsWith('termico') || n.startsWith('térmico')) return 0;
      
      // Fractions
      if (n.includes('1/4')) return 0.25;
      if (n.includes('1/2')) return 0.5;
      if (n.includes('3/4')) return 0.75;
      
      // Mixed
      if (n.includes('1.5') || (n.includes('kilo') && n.includes('medio'))) return 1.5;
      
      // Integers with units
      const kiloMatch = n.match(/(\d+)\s*(kilo|kg)/);
      if (kiloMatch) {
          return parseFloat(kiloMatch[1]);
      }
      
      // Generic kilo
      if (n.includes('kilo') || n.includes('kg') || n.includes('un kilo')) return 1.0;
      
      return 0;
  };

  const handleSearch = async () => {
    if (!startDate || !endDate) {
      toast({ variant: 'destructive', title: 'Error', description: 'Por favor seleccione ambas fechas.' });
      return;
    }

    setLoading(true);
    setReportData([]);

    try {
      checkLocalId();
      const LOCAL_ID = getCurrentLocalId();
      const db = getDatabase();

      const stockData = await fetchAllStockableItems();

      const start = parseISO(startDate);
      const end = parseISO(endDate);
      const days = eachDayOfInterval({ start, end });

      const dailyPromises = days.map(async (day) => {
        const dateStr = formatDateForFirebase(day);
        const dailySales = await fetchSalesForDate(db, LOCAL_ID, dateStr);
        return dailySales.flatMap(sale => processSaleItems(sale, stockData));
      });

      const results = await Promise.all(dailyPromises);
      const allRows = results.flat();

      allRows.sort((a, b) => {
          const dateA = a.fechaCaja.split('-').reverse().join(''); 
          const dateB = b.fechaCaja.split('-').reverse().join('');
          
          if (dateA !== dateB) return dateB.localeCompare(dateA); 
          
          return getTimeValue(b.horaVenta) - getTimeValue(a.horaVenta);
      });

      setReportData(allRows);

      if (allRows.length === 0) {
        toast({ title: 'Sin resultados', description: 'No se encontraron ventas en el rango seleccionado.' });
      } else {
        toast({ title: 'Reporte generado', description: `Se encontraron ${allRows.length} items vendidos.` });
      }

    } catch (error) {
      console.error("Error generating report:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'Ocurrió un error al generar el reporte.' });
    } finally {
      setLoading(false);
    }
  };

  // Statistics Calculation - Orders by total quantity sold (descending)
  const statisticsData = useMemo(() => {
    if (!reportData || reportData.length === 0) return [];

    const stats = {};
    reportData.forEach(row => {
        const name = row.nombreItem;
        const qty = parseFloat(row.cantidad) || 0;
        if (!stats[name]) {
            stats[name] = 0;
        }
        stats[name] += qty;
    });

    return Object.entries(stats)
        .map(([name, totalQty]) => ({ name, totalQty }))
        .sort((a, b) => b.totalQty - a.totalQty);
  }, [reportData]);

  // Raw Material Statistics Calculation
  const rawMaterialStats = useMemo(() => {
    if (!reportData || reportData.length === 0) return [];
    const stats = {};
    
    reportData.forEach(row => {
        const processItems = (items) => {
            if (!items) return;
            items.forEach(({ name, qty }) => {
                if (!stats[name]) stats[name] = 0;
                stats[name] += qty;
            });
        };
        
        processItems(row._rawThermalItems);
        processItems(row._rawMaterialItems);
    });

    return Object.entries(stats)
        .map(([name, totalQty]) => ({ name, totalQty }))
        .sort((a, b) => b.totalQty - a.totalQty);
  }, [reportData]);

  // Ice Cream Weight Statistics
  const iceCreamStats = useMemo(() => {
    if (!reportData || reportData.length === 0) return { rows: [], totalGlobalKg: 0 };
    
    const stats = {};
    let totalGlobalKg = 0;

    reportData.forEach(row => {
        const name = row.nombreItem;
        const qty = parseFloat(row.cantidad) || 0;
        const weight = getIceCreamWeight(name);
        
        if (weight > 0) {
            if (!stats[name]) {
                stats[name] = { totalQty: 0, weightPerUnit: weight, totalKg: 0 };
            }
            stats[name].totalQty += qty;
            const kgAmount = qty * weight;
            stats[name].totalKg += kgAmount;
            totalGlobalKg += kgAmount;
        }
    });

    const rows = Object.entries(stats)
        .map(([name, data]) => ({
            name,
            totalQty: data.totalQty,
            weightPerUnit: data.weightPerUnit,
            totalKg: data.totalKg
        }))
        .sort((a, b) => b.totalKg - a.totalKg);
        
    return { rows, totalGlobalKg };
  }, [reportData]);

  const handleExport = () => {
    if (reportData.length === 0) return;

    // Determine max number of raw materials in any single row to create dynamic columns
    let maxRawMaterials = 0;
    reportData.forEach(row => {
        const count = (row._rawMaterialItems?.length || 0);
        if (count > maxRawMaterials) maxRawMaterials = count;
    });

    // Determine max number of thermal items for dynamic columns as well
    let maxThermalItems = 0;
    reportData.forEach(row => {
        const count = (row._rawThermalItems?.length || 0);
        if (count > maxThermalItems) maxThermalItems = count;
    });


    // Sheet 1: Detailed Sales
    const excelData = reportData.map(row => {
        const baseData = {
            'Fecha de Caja': row.fechaCaja,
            'Hora de Pedido': row.horaVenta,
            'Modo': row.modo,
            'Valor': row.valorVenta,           
            'Forma de Pago': row.modoPago,     
            'Cantidad': row.cantidad,
            'Artículo': row.nombreItem,
        };

        // Dynamically add columns for each thermal item
        if (row._rawThermalItems && row._rawThermalItems.length > 0) {
            row._rawThermalItems.forEach((th, index) => {
                baseData[`Cant Termico ${index + 1}`] = th.qty;
                baseData[`Termico ${index + 1}`] = th.name;
            });
        }

        // Dynamically add columns for each raw material
        if (row._rawMaterialItems && row._rawMaterialItems.length > 0) {
            row._rawMaterialItems.forEach((mp, index) => {
                baseData[`Cant MP ${index + 1}`] = mp.qty;
                baseData[`Materia Prima ${index + 1}`] = mp.name;
            });
        }
        
        return baseData;
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Auto-adjust column widths
    const colWidths = [
        { wch: 12 }, // Fecha
        { wch: 10 }, // Hora
        { wch: 20 }, // Modo
        { wch: 15 }, // Valor 
        { wch: 20 }, // Pago 
        { wch: 10 }, // Cant
        { wch: 30 }, // Articulo
        // Dynamic columns for Thermal Items
        ...Array(maxThermalItems).fill([{ wch: 10 }, { wch: 30 }]).flat(),
        // Dynamic columns for Raw Materials
        ...Array(maxRawMaterials).fill([{ wch: 10 }, { wch: 30 }]).flat(),
    ];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte Ventas");
    
    // Sheet 2: Statistics (Sales)
    if (statisticsData && statisticsData.length > 0) {
        const statsExcelData = statisticsData.map(stat => ({
            'Artículo': stat.name,
            'Cantidad Total Vendida': stat.totalQty
        }));

        const wsStats = XLSX.utils.json_to_sheet(statsExcelData);
        wsStats['!cols'] = [{ wch: 40 }, { wch: 25 }];
        XLSX.utils.book_append_sheet(wb, wsStats, "Estadísticas Ventas");
    }

    // Sheet 3: Raw Material Stats
    if (rawMaterialStats && rawMaterialStats.length > 0) {
        const mpStatsExcelData = rawMaterialStats.map(stat => ({
            'Materia Prima / Insumo': stat.name,
            'Cantidad Total Utilizada': stat.totalQty
        }));
        
        const wsMpStats = XLSX.utils.json_to_sheet(mpStatsExcelData);
        wsMpStats['!cols'] = [{ wch: 40 }, { wch: 25 }];
        XLSX.utils.book_append_sheet(wb, wsMpStats, "Consumo Insumos");
    }

    // Sheet 4: Ice Cream Kilos
    if (iceCreamStats.rows.length > 0) {
        const icRows = iceCreamStats.rows.map(row => ({
            'Tipo de Helado': row.name,
            'Peso Unitario (Kg estimate)': row.weightPerUnit,
            'Unidades Vendidas': row.totalQty,
            'Total Kilos': row.totalKg
        }));
        
        // Add total row at the bottom
        icRows.push({
            'Tipo de Helado': 'TOTAL GENERAL',
            'Peso Unitario (Kg estimate)': '',
            'Unidades Vendidas': '',
            'Total Kilos': iceCreamStats.totalGlobalKg
        });

        const wsIceCream = XLSX.utils.json_to_sheet(icRows);
        wsIceCream['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, wsIceCream, "Kilos de Helado");
    }
    
    const localId = getCurrentLocalId();
    const fileName = generatePriceExportFilename(localId, `reporte_ventas_${startDate}_al_${endDate}`);
    
    XLSX.writeFile(wb, fileName);
    
    toast({ title: 'Exportado', description: `El archivo Excel se ha descargado correctamente como ${fileName}`, className: 'bg-green-500 text-white' });
  };


  if (!hasAccess) {
    return (
        <div className="flex flex-col items-center justify-center h-[50vh] space-y-4 p-6">
            <div className="p-4 rounded-full bg-red-100 text-red-600">
                <ShieldAlert className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Acceso Restringido</h2>
            <p className="text-gray-500 text-center max-w-md">
                Esta sección es exclusiva para Dueños, Encargados y Administradores. 
                No tienes permisos suficientes para acceder a este reporte.
            </p>
        </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Reporte de Ventas Excel</h1>
          <p className="text-gray-500">Genere y exporte el detalle de items vendidos por fecha (Incluye Histórico y detalle de Materia Prima).</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros de Búsqueda</CardTitle>
          <CardDescription>Seleccione el rango de fechas. El sistema buscará en ventas activas y en el historial (Backup).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="space-y-2 w-full md:w-auto">
              <label className="text-sm font-medium text-gray-700">Fecha Inicio</label>
              <Input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full md:w-48"
              />
            </div>
            <div className="space-y-2 w-full md:w-auto">
              <label className="text-sm font-medium text-gray-700">Fecha Fin</label>
              <Input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full md:w-48"
              />
            </div>
            <Button 
                onClick={handleSearch} 
                disabled={loading}
                className="w-full md:w-auto bg-orange-600 hover:bg-orange-700 text-white"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Generar Reporte
            </Button>
            {reportData.length > 0 && (
                <Button 
                    onClick={handleExport}
                    variant="outline"
                    className="w-full md:w-auto border-green-600 text-green-700 hover:bg-green-50"
                >
                    <Download className="mr-2 h-4 w-4" />
                    Exportar a Excel (.xlsx)
                </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {reportData.length > 0 && (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Vista Previa ({reportData.length} registros)</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-hidden">
                        <div className="overflow-x-auto max-h-[500px]">
                            <Table>
                                <TableHeader className="bg-gray-50 sticky top-0">
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Hora</TableHead>
                                        <TableHead>Modo</TableHead>
                                        <TableHead>Cant</TableHead>
                                        <TableHead>Artículo</TableHead>
                                        <TableHead className="w-24">Cant Térm</TableHead>
                                        <TableHead className="w-40">Térmico</TableHead>
                                        <TableHead className="w-24">Cant MP</TableHead>
                                        <TableHead className="w-48">Materia Prima</TableHead>
                                        <TableHead>Valor</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {reportData.slice(0, 100).map((row, index) => (
                                        <TableRow key={index}>
                                            <TableCell>{row.fechaCaja}</TableCell>
                                            <TableCell>{row.horaVenta}</TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                                    row.modo.includes('Mostrador') ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                                                }`}>
                                                    {row.modo.charAt(0)}
                                                </span>
                                            </TableCell>
                                            <TableCell>{row.cantidad}</TableCell>
                                            <TableCell className="font-medium max-w-[150px] truncate" title={row.nombreItem}>
                                                {row.nombreItem}
                                            </TableCell>
                                            
                                            {/* Thermal Cols */}
                                            <TableCell className="text-xs text-gray-600 whitespace-pre-wrap">
                                                {row.cantTermico}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-600 max-w-[150px] whitespace-pre-wrap truncate" title={row.nombreTermico}>
                                                {row.nombreTermico}
                                            </TableCell>

                                            {/* Raw Material Cols */}
                                            <TableCell className="text-xs text-gray-600 whitespace-pre-wrap">
                                                {row.cantMateriaPrima}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-600 max-w-[200px] whitespace-pre-wrap truncate" title={row.nombreMateriaPrima}>
                                                {row.nombreMateriaPrima}
                                            </TableCell>
                                            
                                            <TableCell>${row.valorVenta.toLocaleString('es-AR')}</TableCell>
                                        </TableRow>
                                    ))}
                                    {reportData.length > 100 && (
                                        <TableRow>
                                            <TableCell colSpan={10} className="text-center text-gray-500 py-4">
                                                ... y {reportData.length - 100} registros más (Ver exportación completa en Excel) ...
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Sales Stats */}
                <Card>
                    <CardHeader className="flex flex-row items-center space-x-2">
                        <BarChart3 className="w-6 h-6 text-orange-600" />
                        <div>
                            <CardTitle>Ventas por Artículo</CardTitle>
                            <CardDescription>Cantidad total vendida.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-hidden">
                            <div className="overflow-x-auto max-h-[500px]">
                                <Table>
                                    <TableHeader className="bg-gray-50 sticky top-0">
                                        <TableRow>
                                            <TableHead>Artículo</TableHead>
                                            <TableHead className="text-right">Total Vendido</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {statisticsData.map((stat, index) => (
                                            <TableRow key={index}>
                                                <TableCell className="font-medium">{stat.name}</TableCell>
                                                <TableCell className="text-right font-bold">{stat.totalQty}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Raw Material Stats */}
                <Card>
                    <CardHeader className="flex flex-row items-center space-x-2">
                        <Package className="w-6 h-6 text-blue-600" />
                        <div>
                            <CardTitle>Consumo de Insumos</CardTitle>
                            <CardDescription>Materia Prima y Térmicos.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-hidden">
                            <div className="overflow-x-auto max-h-[500px]">
                                <Table>
                                    <TableHeader className="bg-gray-50 sticky top-0">
                                        <TableRow>
                                            <TableHead>Insumo</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rawMaterialStats.map((stat, index) => (
                                            <TableRow key={index}>
                                                <TableCell className="font-medium">{stat.name}</TableCell>
                                                <TableCell className="text-right font-bold">{stat.totalQty.toLocaleString('es-AR', { maximumFractionDigits: 3 })}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Ice Cream Weight Stats */}
                <Card>
                    <CardHeader className="flex flex-row items-center space-x-2">
                        <Scale className="w-6 h-6 text-purple-600" />
                        <div>
                            <CardTitle>Venta de Helado por Kilo</CardTitle>
                            <CardDescription>Conversión aproximada a Kg.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-hidden">
                            <div className="overflow-x-auto max-h-[500px]">
                                <Table>
                                    <TableHeader className="bg-gray-50 sticky top-0">
                                        <TableRow>
                                            <TableHead>Producto</TableHead>
                                            <TableHead className="text-right">Cant</TableHead>
                                            <TableHead className="text-right">Total Kg</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {iceCreamStats.rows.map((row, index) => (
                                            <TableRow key={index}>
                                                <TableCell className="font-medium">{row.name}</TableCell>
                                                <TableCell className="text-right">{row.totalQty}</TableCell>
                                                <TableCell className="text-right font-bold">{row.totalKg.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</TableCell>
                                            </TableRow>
                                        ))}
                                        <TableRow className="bg-purple-50">
                                            <TableCell colSpan={2} className="font-bold text-purple-900 text-right">TOTAL GENERAL:</TableCell>
                                            <TableCell className="font-bold text-purple-900 text-right">{iceCreamStats.totalGlobalKg.toLocaleString('es-AR', { maximumFractionDigits: 2 })} kg</TableCell>
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </>
      )}
    </div>
  );
};

export default SalesExcelReportPage;