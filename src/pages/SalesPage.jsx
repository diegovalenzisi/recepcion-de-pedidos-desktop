import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchBillingData, suscribirCambiosDeVentas } from '@/lib/api/billingApi';
import { suscribirRemitos } from '@/lib/api/remitosApi';
import { facturarRemito, conciliarRemitosPendientes } from '@/lib/api/facturacionDeRemitoApi';
import { textoConfirmacion } from '@/lib/api/facturacionDeRemito';
import { esClaveDeFactura } from '@/lib/api/comprobanteFiscal';
import { imprimirFacturaDirecto } from '@/lib/print/comprobanteFiscalPrint';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
  // Los remitos NO viven en VENTAS (esa es la ruta fiscal): salen de
  // /{localId}/Remitos y se escuchan en vivo, por eso van en su propio estado.
  const [remitosData, setRemitosData] = useState([]);
  const [remitosLoading, setRemitosLoading] = useState(true);
  const [remitosError, setRemitosError] = useState(null);
  // Facturación posterior de un remito: cuál se está confirmando y cuál está
  // en curso (para que el botón no se pueda apretar dos veces).
  const [remitoAFacturar, setRemitoAFacturar] = useState(null);
  const [facturando, setFacturando] = useState(null);
  // Factura que se está mandando a imprimir (evita el doble clic).
  const [imprimiendo, setImprimiendo] = useState(null);
  // Espejo de los remitos para poder conciliarlos desde el listener de VENTAS
  // sin volver a suscribirse cada vez que cambia la lista.
  const remitosRef = useRef([]);
  const { toast } = useToast();
  const { user } = useAuth();

  // Date filter state
  const [filterMode, setFilterMode] = useState('today'); // 'today' or 'custom'
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const userPermissions = user?.permissions || {};
  const canViewInvoices = user?.rol === 'dueño' || userPermissions.ventas_facturacion;
  const canViewDeliveryNotes = user?.rol === 'dueño' || userPermissions.ventas_remitos;

  // El PDF ORIGINAL que devolvió AFIP es el comprobante fiscal: si está guardado
  // se muestra ese, sea Factura B o C. Antes esto miraba `startsWith('FCB')`, y
  // como el runtime de monotributo no deja el PDF en Firebase, TODAS las facturas
  // de los locales monotributo caían en la reimpresión.
  const handlePrint = (saleData) => {
    if (saleData.pdfBase64) {
      try {
        const pdfWindow = window.open("");
        pdfWindow.document.write(`<iframe width='100%' height='100%' src='data:application/pdf;base64,${saleData.pdfBase64}'></iframe>`);
        pdfWindow.document.title = `${saleData.tipoNombre || 'Factura'} ${saleData.numeroCompleto || saleData.numeroFactura}`;
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Error de PDF",
          description: "No se pudo mostrar el PDF original. Se genera la reimpresión.",
        });
        printTicket(saleData);
      }
      return;
    }

    printTicket(saleData);
  };

  // IMPRESIÓN DIRECTA de una factura: sin visor, sin diálogo, a la impresora
  // predeterminada de Windows. Usa el MISMO servicio que las comandas.
  //
  // `imprimiendo` guarda la clave de la factura en curso: el botón queda
  // deshabilitado mientras dura, así un doble clic no manda dos copias.
  const imprimirFacturaDirecta = useCallback(async (saleData) => {
    // La fila de la tabla YA es el comprobante normalizado (fetchBillingData).
    const clave = saleData?.id || saleData?.numeroCompleto || saleData?.numeroFactura;
    if (!clave || imprimiendo) return;

    setImprimiendo(clave);
    try {
      const r = await imprimirFacturaDirecto(saleData);
      if (r.ok) {
        toast({
          title: 'Factura enviada a la impresora',
          description: `${r.numero} salió por la impresora predeterminada.`,
        });
        return;
      }
      // El motivo REAL ya quedó en el log; acá va el mensaje para el usuario.
      const detalle = r.motivo === 'comprobante-incompleto'
        ? `Al comprobante le faltan datos: ${(r.faltantes || []).join(', ')}.`
        : 'Verificá la impresora predeterminada de Windows.';
      toast({
        variant: 'destructive',
        title: 'No se pudo imprimir la factura',
        description: detalle,
      });
    } finally {
      setImprimiendo(null);
    }
  }, [imprimiendo, toast]);

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
              .header .letra { margin: 6px 0 2px; }
              .header h2 { margin: 2px 0; font-size: 1em; }
              .details, .items, .totals { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
              .details td, .items td, .totals td { padding: 4px 0; }
              .details td:first-child { white-space: nowrap; padding-right: 8px; }
              .items th { text-align: left; border-bottom: 1px dashed #000; padding: 4px 0; font-size: 0.85em; }
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

  // `silencioso`: recarga sin mostrar el spinner de pantalla completa. Lo usa
  // la actualización en vivo — si mostrara "Cargando" en cada cambio, la tabla
  // parpadearía cada vez que se emite una factura.
  const loadSalesData = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
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
      if (!silencioso) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSalesData();
  }, [loadSalesData]);


  // REMITOS — /{localId}/Remitos, en vivo.
  //
  // La suscripción está atada al local con el que se creó: al cambiar de local
  // se cancela la anterior (cleanup del efecto) y el propio módulo descarta los
  // eventos que lleguen tarde del local viejo. Nunca se mezclan dos locales.
  const localPath = getCurrentDatabasePath();

  // FACTURACIÓN EN VIVO — /{localId}/VENTAS.
  //
  // Sin esto, una factura recién emitida (por ejemplo la de un remito
  // convertido) no aparecía hasta refrescar la pantalla a mano: los datos se
  // leían una sola vez al montar. Ahora, en cuanto el motor guarda el
  // comprobante, la pestaña Facturación se recarga sola — su contador y su
  // tabla se actualizan sin que el usuario toque nada.
  useEffect(() => {
    const cancelar = suscribirCambiosDeVentas(() => {
      // Recarga SILENCIOSA de Facturación (sin spinner de pantalla)...
      loadSalesData(true);
      // ...y de paso se cierra el círculo de los remitos que estaban esperando:
      // la factura que acaba de aparecer puede ser justamente la de uno de
      // ellos, así que pasa a FACTURADO en el acto, sin esperar el barrido.
      conciliarRemitosPendientes(remitosRef.current).catch(() => {});
    });
    return () => cancelar();
  }, [loadSalesData, localPath]);

  useEffect(() => {
    if (!canViewDeliveryNotes) return undefined;

    setRemitosLoading(true);
    setRemitosError(null);
    const cancelar = suscribirRemitos(
      (filas) => {
        setRemitosData(filas);
        remitosRef.current = filas;
        setRemitosLoading(false);
        setRemitosError(null);
      },
      (err) => {
        console.error('[SalesPage] Error escuchando remitos:', err);
        setRemitosData([]);
        setRemitosLoading(false);
        setRemitosError('No se pudieron cargar los comprobantes.');
      }
    );
    return () => cancelar();
  }, [canViewDeliveryNotes, localPath]);

  // FACTURAR UN REMITO A POSTERIORI.
  //
  // No emite Nota de Crédito ni anula el remito: manda sus productos e importes
  // al motor de facturación de siempre y, cuando la factura sale, el remito
  // queda vinculado a ella. No descuenta stock ni registra caja otra vez.
  const confirmarFacturacionRemito = useCallback(async () => {
    const remito = remitoAFacturar;
    if (!remito) return;
    const numero = remito.numeroFactura;
    setRemitoAFacturar(null);
    setFacturando(numero);
    try {
      const r = await facturarRemito(numero);
      if (r.estado === 'encolado') {
        toast({
          title: 'Factura solicitada',
          description: `El comprobante ${numero} se envió a facturación por el total. Vas a ver el número de factura acá mismo cuando el motor la emita.`,
        });
      } else if (r.estado === 'ya-en-curso') {
        toast({ title: 'Ya está en curso', description: `El comprobante ${numero} ya tiene una facturación pendiente.` });
      } else if (r.estado === 'ya-facturado') {
        toast({ title: 'Ya facturado', description: `El comprobante ${numero} ya fue facturado${r.numeroFactura ? ` como ${r.numeroFactura}` : ''}.` });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'No se pudo enviar a facturación', description: e?.message || String(e) });
    } finally {
      setFacturando(null);
    }
  }, [remitoAFacturar, toast]);

  // Cierra el círculo de los remitos que quedaron esperando: busca la factura
  // que dejó el motor en la ruta fiscal y le pone su número y su CAE al remito.
  const pendientes = useMemo(
    () => remitosData
      // También los que quedaron en ERROR: si su factura existe, se reparan solos.
      .filter((r) => ['PENDIENTE', 'ERROR'].includes(String(r.estadoFacturacion || '').toUpperCase()) && r.facturado !== true)
      .map((r) => r.numeroFactura).join(','),
    [remitosData]
  );
  useEffect(() => {
    if (!canViewDeliveryNotes || !pendientes) return undefined;
    let vivo = true;
    const revisar = () => { if (vivo) conciliarRemitosPendientes(remitosData).catch(() => {}); };
    revisar();
    const id = setInterval(revisar, 15000);
    return () => { vivo = false; clearInterval(id); };
    // `pendientes` cambia sólo cuando cambia el conjunto de remitos esperando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewDeliveryNotes, pendientes, localPath]);

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

  // Mismo filtro de fechas para Facturación y Remitos: las dos pestañas
  // responden igual al botón "Hoy" y al rango Desde/Hasta.
  const filtrarPorFecha = useCallback((registros) => {
    if (!registros.length) return [];

    let start;
    let end;
    try {
      start = startOfDay(parse(startDate, 'yyyy-MM-dd', new Date()));
      end = endOfDay(parse(endDate, 'yyyy-MM-dd', new Date()));
    } catch (e) {
      console.warn("Invalid date format", e);
      return registros;
    }

    return registros.filter(registro => {
      if (!registro.fecha) return false;
      try {
        const fecha = parse(registro.fecha, 'dd-MM-yyyy', new Date());
        return isWithinInterval(fecha, { start, end });
      } catch (e) {
        return false;
      }
    });
  }, [startDate, endDate]);

  const filteredSales = useMemo(() => filtrarPorFecha(sales), [sales, filtrarPorFecha]);

  // Facturas fiscales del local. El PREFIJO de la clave (FCB…/FCC…) sólo dice
  // que el registro es una factura: NO dice de qué letra. La letra real la
  // resuelve comprobanteFiscal.js con el CbteTipo de ARCA o la cuenta emisora.
  const facturas = filteredSales.filter(sale => esClaveDeFactura(sale.id));
  // Remitos: SOLO de /{localId}/Remitos. VENTAS es la ruta fiscal y no se toca.
  const remitos = useMemo(() => filtrarPorFecha(remitosData), [remitosData, filtrarPorFecha]);

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
        <meta name="description" content="Gestión de Ventas y Facturación." />
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
            {canViewDeliveryNotes && <TabsTrigger value="remitos">Facturación 2 ({remitos.length})</TabsTrigger>}
          </TabsList>
          
          {canViewInvoices && (
            <TabsContent value="facturacion" className="flex-1 min-h-0 m-0 data-[state=active]:flex flex-col">
              <Card className="flex-1 flex flex-col min-h-0 border-slate-200 shadow-sm">
                <CardHeader className="py-3 px-4 bg-slate-50 border-b shrink-0 flex flex-row items-center justify-between">
                  <CardTitle className="text-lg text-slate-700">Facturas</CardTitle>
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
                    <SalesTable
                      data={facturas}
                      onPrint={imprimirFacturaDirecta}
                      onVerFactura={handlePrint}
                      imprimiendo={imprimiendo}
                      tableType="invoices"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
          
          {canViewDeliveryNotes && (
            <TabsContent value="remitos" className="flex-1 min-h-0 m-0 data-[state=active]:flex flex-col">
              <Card className="flex-1 flex flex-col min-h-0 border-slate-200 shadow-sm">
                <CardHeader className="py-3 px-4 bg-slate-50 border-b shrink-0 flex flex-row items-center justify-between">
                  <CardTitle className="text-lg text-slate-700">Facturación 2</CardTitle>
                  <span className="text-sm font-medium text-slate-500 bg-white px-2 py-1 rounded border">
                    {isTodayFiltered ? 'Mostrando ventas de hoy' : `Del ${format(parse(startDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')} al ${format(parse(endDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}`}
                  </span>
                </CardHeader>
                <CardContent className="flex-1 p-0 min-h-0 overflow-hidden">
                  {remitosLoading ? (
                     <div className="flex justify-center items-center h-full">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : remitosError ? (
                    <div className="flex justify-center items-center h-full text-red-500">{remitosError}</div>
                  ) : (
                    <SalesTable
                      data={remitos}
                      onPrint={handlePrint}
                      tableType="delivery_notes"
                      onFacturarRemito={setRemitoAFacturar}
                      facturando={facturando}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Confirmación de la facturación posterior de un remito. */}
      <Dialog open={!!remitoAFacturar} onOpenChange={(abierto) => !abierto && setRemitoAFacturar(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{textoConfirmacion(remitoAFacturar?.numeroFactura || '').titulo}</DialogTitle>
            <DialogDescription className="pt-2 text-slate-600">
              {textoConfirmacion(remitoAFacturar?.numeroFactura || '').descripcion}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemitoAFacturar(null)}>Cancelar</Button>
            <Button onClick={confirmarFacturacionRemito} className="bg-blue-600 hover:bg-blue-700">Facturar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SalesPage;