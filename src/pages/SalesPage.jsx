import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchBillingData } from '@/lib/api/billingApi';
import SalesTable from './SalesTable';
import { Loader2, Calendar as CalendarIcon, FilterX } from 'lucide-react';
import { renderToString } from 'react-dom/server';
import ReceiptDocument from '@/components/sales/ReceiptDocument';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { format, parse, isWithinInterval, startOfDay, endOfDay, isSameDay } from 'date-fns';

const SalesPage = () => {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Date filter state
  const [filterMode, setFilterMode] = useState('today'); // 'today' or 'custom'
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const userPermissions = user?.permissions || {};
  const canViewInvoices = user?.rol === 'dueño' || userPermissions.ventas_facturacion;
  const canViewDeliveryNotes = user?.rol === 'dueño' || userPermissions.ventas_remitos;

  const handlePrint = (saleData) => {
    if (saleData.numeroFactura?.startsWith('FCB') && saleData.pdfBase64) {
      try {
        const pdfWindow = window.open("");
        pdfWindow.document.write(`<iframe width='100%' height='100%' src='data:application/pdf;base64,${saleData.pdfBase64}'></iframe>`);
        pdfWindow.document.title = `Factura ${saleData.numeroFactura}`;
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Error de PDF",
          description: "No se pudo mostrar el PDF. Se generará un ticket.",
        });
        printTicket(saleData);
      }
      return;
    }
    
    printTicket(saleData);
  };

  const printTicket = (saleData) => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (printWindow) {
      const receiptHtml = renderToString(<ReceiptDocument sale={saleData} />);
      printWindow.document.write(`
        <html>
          <head>
            <title>Imprimir Comprobante</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap');
              body { font-family: 'Roboto Mono', monospace; margin: 0; padding: 20px; }
              .receipt { max-width: 300px; margin: auto; }
              .header { text-align: center; margin-bottom: 20px; }
              .header h1 { margin: 0; font-size: 1.2em; }
              .details, .items, .totals { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
              .details td, .items td, .totals td { padding: 4px 0; }
              .items th { text-align: left; border-bottom: 1px dashed #000; padding: 4px 0; }
              .totals { text-align: right; }
              .item-row td { vertical-align: top; }
              .qty { text-align: right; padding-right: 10px; }
              .price { text-align: right; }
              hr { border: none; border-top: 1px dashed #000; margin: 10px 0; }
              .footer { text-align: center; font-size: 0.8em; }
              @media print {
                @page { margin: 10mm; }
                body { -webkit-print-color-adjust: exact; }
              }
            </style>
          </head>
          <body>
            ${receiptHtml}
            <script>
              window.onload = function() {
                window.print();
                window.onafterprint = function() { window.close(); };
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } else {
      toast({
        variant: "destructive",
        title: "Error de Impresión",
        description: "No se pudo abrir la ventana de impresión. Verifique la configuración de su navegador.",
      });
    }
  };

  const loadSalesData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBillingData();
      const sortedData = data.sort((a, b) => {
        const parseDateTime = (dateStr, timeStr) => {
          if (!dateStr || !timeStr || typeof dateStr !== 'string' || typeof timeStr !== 'string') {
            return null;
          }
          const dateParts = dateStr.split('-');
          const timeParts = timeStr.split(':');
          if (dateParts.length !== 3 || timeParts.length < 2) {
            return null;
          }
          const [day, month, year] = dateParts.map(Number);
          const [hours, minutes, seconds] = timeParts.map(Number);
          const d = new Date(year, month - 1, day, hours, minutes, seconds || 0);
          return isNaN(d) ? null : d;
        };

        const dateTimeA = parseDateTime(a.fecha, a.hora);
        const dateTimeB = parseDateTime(b.fecha, b.hora);

        if (!dateTimeA && !dateTimeB) return 0;
        if (!dateTimeA) return 1;
        if (!dateTimeB) return -1;
        
        return dateTimeB.getTime() - dateTimeA.getTime();
      });
      setSales(sortedData);
    } catch (err) {
      setError('No se pudieron cargar los datos de ventas. Por favor, inténtelo de nuevo más tarde.');
      toast({
        variant: 'destructive',
        title: 'Error de Carga',
        description: 'No se pudieron cargar los datos de ventas.',
      });
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSalesData();
  }, [loadSalesData]);

  const handleSetToday = () => {
    setFilterMode('today');
    const today = format(new Date(), 'yyyy-MM-dd');
    setStartDate(today);
    setEndDate(today);
  };

  const handleDateChange = (type, value) => {
    setFilterMode('custom');
    if (type === 'start') setStartDate(value);
    if (type === 'end') setEndDate(value);
  };

  const filteredSales = useMemo(() => {
    if (!sales.length) return [];

    let start = new Date();
    let end = new Date();

    try {
      start = startOfDay(parse(startDate, 'yyyy-MM-dd', new Date()));
      end = endOfDay(parse(endDate, 'yyyy-MM-dd', new Date()));
    } catch (e) {
      console.warn("Invalid date format", e);
      return sales;
    }

    return sales.filter(sale => {
      if (!sale.fecha) return false;
      try {
        const saleDate = parse(sale.fecha, 'dd-MM-yyyy', new Date());
        return isWithinInterval(saleDate, { start, end });
      } catch (e) {
        return false;
      }
    });
  }, [sales, startDate, endDate]);

  // FCB = Responsable Inscripto. FCC = Monotributo (Factura C, ej. FCC0001-00000790).
  // Ambas son facturas emitidas con CAE; solo cambia el motor/régimen que las generó.
  const facturas = filteredSales.filter(sale => {
    const id = String(sale.id || '');
    return id.startsWith('FCB') || id.startsWith('FCC');
  });
  const remitos = filteredSales.filter(sale => String(sale.id)?.startsWith('FCX'));
  
  const defaultTab = canViewInvoices ? 'facturacion' : canViewDeliveryNotes ? 'remitos' : '';

  const isTodayFiltered = useMemo(() => {
    try {
      const start = parse(startDate, 'yyyy-MM-dd', new Date());
      const end = parse(endDate, 'yyyy-MM-dd', new Date());
      return isSameDay(start, new Date()) && isSameDay(end, new Date());
    } catch {
      return false;
    }
  }, [startDate, endDate]);

  return (
    <>
      <Helmet>
        <title>Ventas - DLV</title>
        <meta name="description" content="Gestión de Ventas, Facturación y Remitos." />
      </Helmet>
      <div className="container mx-auto p-4 flex flex-col h-[calc(100vh-2rem)]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Módulo de Ventas</h1>
          
          <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-2 rounded-lg border shadow-sm">
            <Button 
              variant={isTodayFiltered ? "default" : "outline"} 
              size="sm" 
              onClick={handleSetToday}
              className={isTodayFiltered ? "bg-blue-600 hover:bg-blue-700" : ""}
            >
              <CalendarIcon className="w-4 h-4 mr-2" />
              Hoy
            </Button>
            
            <div className="h-6 w-px bg-slate-200 hidden sm:block mx-1"></div>
            
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600">Desde:</span>
                <Input 
                  type="date" 
                  value={startDate} 
                  onChange={(e) => handleDateChange('start', e.target.value)}
                  className="h-8 w-[130px] text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-600">Hasta:</span>
                <Input 
                  type="date" 
                  value={endDate} 
                  onChange={(e) => handleDateChange('end', e.target.value)}
                  className="h-8 w-[130px] text-sm"
                  min={startDate}
                />
              </div>
            </div>
            
            {filterMode === 'custom' && (
               <Button 
                 variant="ghost" 
                 size="sm" 
                 onClick={handleSetToday}
                 className="text-slate-500 hover:text-slate-700"
                 title="Limpiar filtros"
               >
                 <FilterX className="w-4 h-4" />
               </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue={defaultTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className={`grid ${canViewInvoices && canViewDeliveryNotes ? 'grid-cols-2' : 'grid-cols-1'} w-full md:w-[400px] mb-4`}>
            {canViewInvoices && <TabsTrigger value="facturacion">Facturación ({facturas.length})</TabsTrigger>}
            {canViewDeliveryNotes && <TabsTrigger value="remitos">Remitos ({remitos.length})</TabsTrigger>}
          </TabsList>
          
          {canViewInvoices && (
            <TabsContent value="facturacion" className="flex-1 min-h-0 m-0 data-[state=active]:flex flex-col">
              <Card className="flex-1 flex flex-col min-h-0 border-slate-200 shadow-sm">
                <CardHeader className="py-3 px-4 bg-slate-50 border-b shrink-0 flex flex-row items-center justify-between">
                  <CardTitle className="text-lg text-slate-700">Comprobantes (FCB)</CardTitle>
                  <span className="text-sm font-medium text-slate-500 bg-white px-2 py-1 rounded border">
                    {isTodayFiltered ? 'Mostrando ventas de hoy' : `Del ${format(parse(startDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} al ${format(parse(endDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}`}
                  </span>
                </CardHeader>
                <CardContent className="flex-1 p-0 min-h-0 overflow-hidden">
                  {loading ? (
                    <div className="flex justify-center items-center h-full">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : error ? (
                    <div className="flex justify-center items-center h-full text-red-500">{error}</div>
                  ) : (
                    <SalesTable data={facturas} onPrint={handlePrint} tableType="invoices" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
          
          {canViewDeliveryNotes && (
            <TabsContent value="remitos" className="flex-1 min-h-0 m-0 data-[state=active]:flex flex-col">
              <Card className="flex-1 flex flex-col min-h-0 border-slate-200 shadow-sm">
                <CardHeader className="py-3 px-4 bg-slate-50 border-b shrink-0 flex flex-row items-center justify-between">
                  <CardTitle className="text-lg text-slate-700">Remitos (FCX)</CardTitle>
                  <span className="text-sm font-medium text-slate-500 bg-white px-2 py-1 rounded border">
                    {isTodayFiltered ? 'Mostrando ventas de hoy' : `Del ${format(parse(startDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} al ${format(parse(endDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}`}
                  </span>
                </CardHeader>
                <CardContent className="flex-1 p-0 min-h-0 overflow-hidden">
                  {loading ? (
                     <div className="flex justify-center items-center h-full">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : error ? (
                    <div className="flex justify-center items-center h-full text-red-500">{error}</div>
                  ) : (
                    <SalesTable data={remitos} onPrint={handlePrint} tableType="delivery_notes" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
};

export default SalesPage;