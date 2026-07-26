import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Download, CreditCard, Calendar as CalendarIcon, Filter, History } from 'lucide-react';
import { fetchVentasDeApps } from '@/lib/api/ventasAppsApi';
import {
  ETIQUETA_PLATAFORMA,
  calcularTotales,
  filasParaExcel,
  filtrarPorPlataforma,
  filtrarPorRango,
} from '@/lib/api/ventasApps';
import { getCurrentDatabasePath } from '@/lib/firebase/core';
import * as XLSX from 'xlsx';

// Rango por defecto: el mes en curso. Acota la lectura del BACKUP a ~30 nodos
// en vez de recorrer toda la base; el botón "Historial completo" lo amplía.
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const primerDiaDelMesISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const INICIO_HISTORIAL = '2024-01-01';

const PrepaymentReportPage = () => {
  const [loading, setLoading] = useState(true);
  const [filas, setFilas] = useState([]);
  const [diagnostico, setDiagnostico] = useState(null);
  const [activeTab, setActiveTab] = useState('PEDIDOSYA');

  const [startDate, setStartDate] = useState(primerDiaDelMesISO());
  const [endDate, setEndDate] = useState(hoyISO());
  // Rango efectivamente consultado (el que se aplicó, no el que se está tipeando).
  const [rango, setRango] = useState({ desde: primerDiaDelMesISO(), hasta: hoyISO(), completo: false });

  const { toast } = useToast();
  const localId = getCurrentDatabasePath();
  // Identifica la consulta en curso: si el usuario cambia el rango o el local
  // antes de que termine, la respuesta vieja se descarta.
  const consultaRef = useRef(0);

  useEffect(() => {
    const idConsulta = ++consultaRef.current;
    let vigente = true;

    const cargar = async () => {
      setLoading(true);
      try {
        const { filas: datos, diagnostico: diag } = await fetchVentasDeApps({
          desde: rango.desde,
          hasta: rango.hasta,
          historialCompleto: rango.completo,
        });
        if (!vigente || idConsulta !== consultaRef.current) return;
        setFilas(datos);
        setDiagnostico(diag);
      } catch (error) {
        if (!vigente || idConsulta !== consultaRef.current) return;
        if (error?.code === 'LOCAL_CHANGED') return; // cambió el local: la carga del nuevo ya viene en camino
        console.error('[PrepaymentReport] Error leyendo ventas por app:', error);
        setFilas([]);
        setDiagnostico(null);
        toast({
          variant: 'destructive',
          title: 'Error de carga',
          description: error?.message?.includes('LOCAL_ID_REQUIRED')
            ? 'No hay un local configurado.'
            : 'No se pudieron obtener las ventas de PedidosYa/Rappi.',
        });
      } finally {
        if (vigente && idConsulta === consultaRef.current) setLoading(false);
      }
    };

    cargar();
    // Al cambiar de local o de rango se invalida la consulta anterior: sus
    // resultados ya no se aplican al estado.
    return () => { vigente = false; };
  }, [rango, localId, toast]);

  const handleApplyFilter = () => {
    if (!startDate || !endDate) {
      toast({ variant: 'destructive', title: 'Atención', description: 'Seleccione fecha de inicio y fin.' });
      return;
    }
    if (startDate > endDate) {
      toast({ variant: 'destructive', title: 'Atención', description: 'La fecha de inicio debe ser menor o igual a la de fin.' });
      return;
    }
    setRango({ desde: startDate, hasta: endDate, completo: false });
  };

  const handleHistorialCompleto = () => {
    const desde = INICIO_HISTORIAL;
    const hasta = hoyISO();
    setStartDate(desde);
    setEndDate(hasta);
    setRango({ desde, hasta, completo: true });
  };

  // El rango ya se aplicó al leer, pero se vuelve a filtrar en memoria para que
  // lo que se ve, lo que se cuenta y lo que se exporta sean SIEMPRE lo mismo
  // (las ventas vivas y el ledger se leen enteros, no por día).
  const filasDelRango = useMemo(
    () => filtrarPorRango(filas, rango.desde, rango.hasta),
    [filas, rango]
  );

  const filasPY = useMemo(() => filtrarPorPlataforma(filasDelRango, 'PEDIDOSYA'), [filasDelRango]);
  const filasRP = useMemo(() => filtrarPorPlataforma(filasDelRango, 'RAPPI'), [filasDelRango]);

  const statsPY = useMemo(() => calcularTotales(filasPY), [filasPY]);
  const statsRP = useMemo(() => calcularTotales(filasRP), [filasRP]);

  const filasVisibles = activeTab === 'PEDIDOSYA' ? filasPY : filasRP;

  const handleExport = useCallback(() => {
    if (filasVisibles.length === 0) {
      toast({ variant: 'destructive', title: 'Atención', description: 'No hay datos para exportar.' });
      return;
    }
    try {
      // Exactamente las filas visibles y filtradas, en el mismo orden.
      const ws = XLSX.utils.json_to_sheet(filasParaExcel(filasVisibles, localId));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Ventas_${activeTab}`);
      XLSX.writeFile(wb, `Ventas_${activeTab}_${rango.desde}_a_${rango.hasta}.xlsx`);
      toast({
        title: 'Exportación exitosa',
        description: `${filasVisibles.length} registros exportados.`,
        className: 'bg-green-50 text-green-800 border-green-200',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({ variant: 'destructive', title: 'Error al exportar', description: 'Hubo un problema al generar el archivo Excel.' });
    }
  }, [filasVisibles, activeTab, localId, rango, toast]);

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);

  const renderStatsCards = (stats, brandColor) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {[
        ['Hoy', formatCurrency(stats.hoy)],
        ['Esta Semana', formatCurrency(stats.semana)],
        ['Este Mes', formatCurrency(stats.mes)],
        ['Operaciones', String(stats.operaciones)],
      ].map(([titulo, valor]) => (
        <Card key={titulo} className="shadow-sm border-l-4" style={{ borderLeftColor: brandColor }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{titulo}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{valor}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const renderTable = (registros) => (
    <div className="bg-white rounded-md border shadow-sm overflow-x-auto relative min-h-[200px]">
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
            <TableHead className="font-bold">Plataforma</TableHead>
            <TableHead className="font-bold">Referencia</TableHead>
            <TableHead className="font-bold">Canal</TableHead>
            <TableHead className="font-bold">Turno</TableHead>
            <TableHead className="text-right font-bold">Importe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {registros.length > 0 ? (
            registros.map((r) => (
              <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="py-3">{r.fecha || '—'}</TableCell>
                <TableCell className="py-3">{r.hora || '—'}</TableCell>
                <TableCell className="py-3">{ETIQUETA_PLATAFORMA[r.plataforma] || r.plataforma}</TableCell>
                <TableCell className="py-3 font-mono text-xs">{r.referencia || '—'}</TableCell>
                <TableCell className="py-3 text-muted-foreground text-sm">{r.canal}</TableCell>
                <TableCell className="py-3 text-muted-foreground text-sm">{r.turno ?? '—'}</TableCell>
                <TableCell className="py-3 text-right font-semibold text-primary">{formatCurrency(r.importe)}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                {loading ? 'Cargando…' : 'No se encontraron ventas de esta plataforma en el rango seleccionado.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  const renderTab = (plataforma, registros, stats, color) => (
    <TabsContent value={plataforma} className="mt-0 focus-visible:ring-0">
      {renderStatsCards(stats, color)}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Historial de Ventas
          <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {registros.length} {registros.length === 1 ? 'venta' : 'ventas'} · {formatCurrency(stats.total)}
          </span>
        </h2>
        {renderTable(registros)}
      </div>
    </TabsContent>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-6 space-y-6">
      <Helmet>
        <title>Reportes de Prepago | DLV Sistemas</title>
        <meta name="description" content="Ventas cobradas con PedidosYa y Rappi, con su historial completo." />
      </Helmet>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reportes de Prepago</h1>
            <p className="text-sm text-muted-foreground">
              Ventas cobradas con PedidosYa y Rappi{localId ? ` · local ${localId}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-2 rounded-lg border shadow-sm">
          <div className="flex items-center space-x-2">
            <CalendarIcon className="w-4 h-4 text-gray-500" />
            <Label htmlFor="start" className="sr-only">Desde</Label>
            <Input type="date" id="start" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-[140px] text-sm" />
          </div>
          <span className="text-gray-400">-</span>
          <div className="flex items-center space-x-2">
            <Label htmlFor="end" className="sr-only">Hasta</Label>
            <Input type="date" id="end" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-[140px] text-sm" />
          </div>
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <Button variant="default" size="sm" onClick={handleApplyFilter} className="w-full sm:w-auto">
              <Filter className="w-4 h-4 mr-2" />
              Filtrar
            </Button>
            <Button variant="secondary" size="sm" onClick={handleHistorialCompleto} title="Leer todo el historial disponible (más lento)">
              <History className="w-4 h-4 mr-2" />
              Historial completo
            </Button>
          </div>
        </div>

        <Button
          onClick={handleExport}
          variant="outline"
          className="w-full lg:w-auto bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
          disabled={loading || filasVisibles.length === 0}
        >
          <Download className="w-4 h-4 mr-2" />
          Exportar a Excel (.xlsx)
        </Button>
      </div>

      {diagnostico && !loading && (
        <p className="text-xs text-muted-foreground">
          Fuentes leídas: {diagnostico.vivas} ventas del turno abierto · {diagnostico.respaldadas} de turnos cerrados
          ({diagnostico.diasLeidos} días de BACKUP){diagnostico.planas ? ` · ${diagnostico.planas} del respaldo antiguo` : ''}
          {' '}· {diagnostico.ledger} registros del ledger de prepagos.
        </p>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-8">
          <TabsTrigger value="PEDIDOSYA" className="data-[state=active]:bg-[#EA044E] data-[state=active]:text-white transition-colors duration-300">
            PedidosYa
          </TabsTrigger>
          <TabsTrigger value="RAPPI" className="data-[state=active]:bg-[#FF441F] data-[state=active]:text-white transition-colors duration-300">
            Rappi
          </TabsTrigger>
        </TabsList>

        {renderTab('PEDIDOSYA', filasPY, statsPY, '#EA044E')}
        {renderTab('RAPPI', filasRP, statsRP, '#FF441F')}
      </Tabs>
    </motion.div>
  );
};

export default PrepaymentReportPage;
