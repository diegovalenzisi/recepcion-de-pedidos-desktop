import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, FileDown, Calendar as CalendarIcon } from 'lucide-react';
import { fetchShiftsForDate, fetchSalesForShift } from '@/lib/api/cash/index.js';
import { exportVentasXlsx, buildVentasFileName } from '@/lib/export/salesExportUtils';
import { formatDateForFirebase, getLocalTodayDate } from '@/lib/utils';

// Enumera las fechas (Date, medianoche local) entre from y to inclusive. Cap defensivo.
const enumerateDates = (from, to) => {
  const out = [];
  if (!from || !to) return out;
  let a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (a > b) return out;
  let guard = 0;
  while (a <= b && guard < 400) {
    out.push(new Date(a));
    a.setDate(a.getDate() + 1);
    guard += 1;
  }
  return out;
};

function ExportSalesModal({ isOpen, onClose, selectedShift }) {
  const [mode, setMode] = useState('turno'); // 'turno' | 'rango'
  const [fromDate, setFromDate] = useState(() => getLocalTodayDate());
  const [toDate, setToDate] = useState(() => getLocalTodayDate());
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const fmtMoney = (n) => `$${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const gatherRangeSales = async () => {
    const dates = enumerateDates(fromDate, toDate);
    const all = [];
    for (const d of dates) {
      const shifts = await fetchShiftsForDate(d);        // turnos de esa fecha (CAJAS + BACKUP)
      for (const sh of shifts) {
        const s = await fetchSalesForShift(sh);           // ventas del turno (mismo set que la caja)
        if (s && s.length) all.push(...s);
      }
    }
    return all;
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      let sales = [];
      let label = '';

      if (mode === 'turno') {
        if (!selectedShift) {
          toast({ variant: 'destructive', title: 'Sin turno', description: 'No hay un turno seleccionado para exportar.' });
          return;
        }
        sales = await fetchSalesForShift(selectedShift);
        label = `Turno${selectedShift.id}_${selectedShift.date}`;
      } else {
        if (!fromDate || !toDate || fromDate > toDate) {
          toast({ variant: 'destructive', title: 'Rango inválido', description: 'La fecha "Desde" debe ser anterior o igual a "Hasta".' });
          return;
        }
        sales = await gatherRangeSales();
        label = `${formatDateForFirebase(fromDate)}_a_${formatDateForFirebase(toDate)}`;
      }

      if (!sales || sales.length === 0) {
        toast({ title: 'Sin ventas', description: 'No se encontraron ventas para exportar en la selección.' });
        return;
      }

      const { count, total } = await exportVentasXlsx(sales, buildVentasFileName(label));
      toast({
        title: 'Exportación lista',
        description: `${count} venta(s) exportada(s). Total: ${fmtMoney(total)}.`,
        className: 'bg-green-500 text-white',
      });
      onClose();
    } catch (error) {
      console.error('[EXPORTAR_VENTAS]', error);
      toast({ variant: 'destructive', title: 'Error al exportar', description: 'No se pudo generar el archivo de ventas.' });
    } finally {
      setExporting(false);
    }
  };

  const DatePicker = ({ value, onChange, label }) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? formatDateForFirebase(value) : 'Seleccione'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar mode="single" selected={value} onSelect={(d) => d && onChange(d)} initialFocus />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v && !exporting) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" /> Exportar ventas</DialogTitle>
          <DialogDescription>
            Genera un Excel (.xlsx) con una fila por venta: fecha de sistema, fecha de caja, turno, hora, número de pedido, tipo de entrega, medio de pago y total.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === 'turno' ? 'default' : 'outline'}
              onClick={() => setMode('turno')}
            >
              Turno seleccionado
            </Button>
            <Button
              type="button"
              variant={mode === 'rango' ? 'default' : 'outline'}
              onClick={() => setMode('rango')}
            >
              Rango de fechas
            </Button>
          </div>

          {mode === 'turno' ? (
            <div className="rounded-md border p-3 text-sm text-gray-600">
              {selectedShift
                ? <>Se exportarán las ventas del <strong>Turno #{selectedShift.id}</strong> (fecha de caja <strong>{selectedShift.date}</strong>).</>
                : <span className="text-red-600">No hay un turno seleccionado.</span>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Desde" value={fromDate} onChange={setFromDate} />
              <DatePicker label="Hasta" value={toDate} onChange={setToDate} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>Cancelar</Button>
          <Button onClick={handleExport} disabled={exporting} className="bg-green-600 hover:bg-green-700 text-white">
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            {exporting ? 'Exportando...' : 'Exportar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExportSalesModal;
