import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Download, CreditCard, Calendar as CalendarIcon, Filter, X } from 'lucide-react';
import { fetchPrepayments, fetchPrepaymentsByDateRange } from '@/lib/api/prepaymentApi';
import * as XLSX from 'xlsx';

const PrepaymentReportPage = () => {
  const [loading, setLoading] = useState(true);
  const [pedidosYaRecords, setPedidosYaRecords] = useState([]);
  const [rappiRecords, setRappiRecords] = useState([]);
  const [activeTab, setActiveTab] = useState('PEDIDOSYA');
  
  // Date filtering state
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);
  
  const { toast } = useToast();

  const loadData = useCallback(async (start, end) => {
    setLoading(true);
    try {
      let pyData = [];
      let rpData = [];

      if (start && end) {
        const startObj = new Date(start + 'T00:00:00');
        const endObj = new Date(end + 'T23:59:59');
        
        if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
            throw new Error('Fechas inválidas');
        }

        [pyData, rpData] = await Promise.all([
          fetchPrepaymentsByDateRange('PREPAGO PEDIDOSYA', startObj, endObj),
          fetchPrepaymentsByDateRange('PREPAGO RAPPI', startObj, endObj)
        ]);
      } else {
        [pyData, rpData] = await Promise.all([
          fetchPrepayments('PREPAGO PEDIDOSYA'),
          fetchPrepayments('PREPAGO RAPPI')
        ]);
      }
      
      // Deduplicate data by ID just in case the API returns duplicates
      const deduplicate = (data) => {
        const seen = new Set();
        return data.filter(item => {
          const duplicate = seen.has(item.id);
          seen.add(item.id);
          return !duplicate;
        });
      };

      setPedidosYaRecords(deduplicate(pyData || []));
      setRappiRecords(deduplicate(rpData || []));
    } catch (error) {
      console.error("Error fetching prepayments:", error);
      toast({
        variant: "destructive",
        title: "Error de carga",
        description: "No se pudieron obtener los registros de prepago."
      });
      setPedidosYaRecords([]);
      setRappiRecords([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let isMounted = true;
    
    if (isMounted) {
        if (isFiltering && startDate && endDate) {
            loadData(startDate, endDate);
        } else if (!isFiltering) {
            loadData(null, null);
        }
    }

    return () => {
      isMounted = false;
    };
  }, [loadData, isFiltering, startDate, endDate]);

  const handleApplyFilter = () => {
      if (!startDate || !endDate) {
          toast({
              variant: "destructive",
              title: "Atención",
              description: "Seleccione fecha de inicio y fin."
          });
          return;
      }
      if (new Date(startDate) > new Date(endDate)) {
          toast({
              variant: "destructive",
              title: "Atención",
              description: "La fecha de inicio debe ser menor o igual a la fecha de fin."
          });
          return;
      }
      setIsFiltering(true);
  };

  const handleClearFilter = () => {
      setStartDate('');
      setEndDate('');
      setIsFiltering(false);
  };

  const calculateTotals = useCallback((records = []) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    return records.reduce((acc, record) => {
      const recDate = new Date(record.timestamp || (record.fecha ? record.fecha.split('-').reverse().join('-') : new Date()));
      const monto = Number(record.monto) || 0;
      
      acc.total += monto;
      acc.count += 1;

      if (recDate >= today) acc.today += monto;
      if (recDate >= startOfWeek) acc.week += monto;
      if (recDate >= startOfMonth) acc.month += monto;
      
      return acc;
    }, { today: 0, week: 0, month: 0, total: 0, count: 0 });
  }, []);

  const pyStats = useMemo(() => calculateTotals(pedidosYaRecords), [pedidosYaRecords, calculateTotals]);
  const rpStats = useMemo(() => calculateTotals(rappiRecords), [rappiRecords, calculateTotals]);

  const handleExport = useCallback((records, type) => {
    if (!records || records.length === 0) {
        toast({
            variant: "destructive",
            title: "Atención",
            description: "No hay datos para exportar."
        });
        return;
    }
    try {
        const exportData = records.map(r => ({
            ID: r.id,
            Fecha: r.fecha,
            Hora: r.hora,
            Monto: r.monto
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Reporte_${type}`);
        
        const dateStr = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `Reporte_Prepagos_${type}_${dateStr}.xlsx`);
        
        toast({
            title: "Exportación exitosa",
            description: `El archivo excel se ha descargado correctamente.`,
            className: "bg-green-50 text-green-800 border-green-200"
        });
    } catch (error) {
        console.error("Export error:", error);
        toast({
            variant: "destructive",
            title: "Error al exportar",
            description: "Hubo un problema al generar el archivo Excel."
        });
    }
  }, [toast]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: 'ARS' 
    }).format(amount || 0);
  };

  const renderStatsCards = (stats, brandColor) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card className="shadow-sm border-l-4" style={{ borderLeftColor: brandColor }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Hoy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(stats.today)}</p>
        </CardContent>
      </Card>
      <Card className="shadow-sm border-l-4" style={{ borderLeftColor: brandColor }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Esta Semana</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(stats.week)}</p>
        </CardContent>
      </Card>
      <Card className="shadow-sm border-l-4" style={{ borderLeftColor: brandColor }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Este Mes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(stats.month)}</p>
        </CardContent>
      </Card>
      <Card className="shadow-sm border-l-4" style={{ borderLeftColor: brandColor }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Operaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{stats.count}</p>
        </CardContent>
      </Card>
    </div>
  );

  const renderTable = (records) => (
    <div className="bg-white rounded-md border shadow-sm overflow-hidden relative min-h-[200px]">
      {loading ? (
        <div className="absolute inset-0 z-10 bg-white/50 flex items-center justify-center backdrop-blur-sm">
             <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-bold">Fecha</TableHead>
            <TableHead className="font-bold">Hora</TableHead>
            <TableHead className="font-bold">Monto</TableHead>
            <TableHead className="text-right font-bold">Referencia</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.length > 0 ? (
            records.map((record) => {
              // Ensure we have a truly unique key by combining fields if ID isn't unique enough,
              // though we already deduplicate the array in loadData.
              const uniqueKey = record.id ? record.id.toString() : `${record.fecha}-${record.hora}-${record.monto}-${Math.random()}`;
              
              return (
                <TableRow key={uniqueKey} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="py-3">{record.fecha}</TableCell>
                  <TableCell className="py-3">{record.hora}</TableCell>
                  <TableCell className="py-3 font-semibold text-primary">{formatCurrency(record.monto)}</TableCell>
                  <TableCell className="py-3 text-right text-xs font-mono text-muted-foreground">
                    {record.id ? record.id.toString().slice(-8).toUpperCase() : 'N/A'}
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                No se encontraron registros de prepago para esta plataforma en el rango seleccionado.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 md:p-6 space-y-6"
    >
      <Helmet>
        <title>Reportes de Prepago | DLV Sistemas</title>
        <meta name="description" content="Visualice y exporte los reportes de pagos adelantados de plataformas de delivery." />
      </Helmet>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reportes de Prepago</h1>
            <p className="text-sm text-muted-foreground">Gestión y control de ingresos por PedidosYa y Rappi</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-2 rounded-lg border shadow-sm">
            <div className="flex items-center space-x-2">
                <CalendarIcon className="w-4 h-4 text-gray-500" />
                <Label htmlFor="start" className="sr-only">Desde</Label>
                <Input 
                    type="date" 
                    id="start" 
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)} 
                    className="h-9 w-[140px] text-sm"
                />
            </div>
            <span className="text-gray-400">-</span>
            <div className="flex items-center space-x-2">
                 <Label htmlFor="end" className="sr-only">Hasta</Label>
                <Input 
                    type="date" 
                    id="end" 
                    value={endDate} 
                    onChange={(e) => setEndDate(e.target.value)} 
                    className="h-9 w-[140px] text-sm"
                />
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto">
                <Button variant={isFiltering ? "default" : "secondary"} size="sm" onClick={handleApplyFilter} className="w-full sm:w-auto">
                    <Filter className="w-4 h-4 mr-2" />
                    Filtrar
                </Button>
                {isFiltering && (
                    <Button variant="ghost" size="icon" onClick={handleClearFilter} title="Limpiar filtro">
                        <X className="w-4 h-4 text-red-500" />
                    </Button>
                )}
            </div>
        </div>

        <Button 
          onClick={() => handleExport(activeTab === 'PEDIDOSYA' ? pedidosYaRecords : rappiRecords, activeTab)} 
          variant="outline"
          className="w-full lg:w-auto bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
          disabled={loading || (activeTab === 'PEDIDOSYA' ? pedidosYaRecords.length === 0 : rappiRecords.length === 0)}
        >
          <Download className="w-4 h-4 mr-2" /> 
          Exportar a Excel (.xlsx)
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-8">
          <TabsTrigger value="PEDIDOSYA" className="data-[state=active]:bg-[#EA044E] data-[state=active]:text-white transition-colors duration-300">
            PedidosYa
          </TabsTrigger>
          <TabsTrigger value="RAPPI" className="data-[state=active]:bg-[#FF441F] data-[state=active]:text-white transition-colors duration-300">
            Rappi
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="PEDIDOSYA" className="mt-0 focus-visible:ring-0">
          {renderStatsCards(pyStats, '#EA044E')}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Historial de Transacciones
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {pedidosYaRecords.length} items
              </span>
            </h2>
            {renderTable(pedidosYaRecords)}
          </div>
        </TabsContent>

        <TabsContent value="RAPPI" className="mt-0 focus-visible:ring-0">
          {renderStatsCards(rpStats, '#FF441F')}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Historial de Transacciones
              <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {rappiRecords.length} items
              </span>
            </h2>
            {renderTable(rappiRecords)}
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default PrepaymentReportPage;