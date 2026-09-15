import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar, ChevronLeft, ChevronRight, DollarSign, Lock, Edit, Shield, X, Users, ClipboardList, FileDown, Banknote } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CashRegisterHeader = ({
  currentShift,
  selectedShift,
  shiftsForDate,
  onShiftSelect,
  shiftIsActive,
  loading,
  canManageFund,
  canCloseShift,
  canRetiroEfectivo,
  onFundModalOpen,
  onSafeModalOpen,
  onCloseShiftModalOpen,
  onPartialCloseModalOpen,
  onRetiroEfectivoModalOpen,
  onDateChange,
  displayDate,
  isModal,
  onClose,
  onExportSales
}) => {
  const displayDateString = useMemo(() => {
    if (!displayDate) return 'Cargando fecha...';
    return displayDate.toLocaleDateString('es-ES', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, [displayDate]);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between border-b sticky top-0 bg-white z-20 p-4 gap-4 sm:gap-0">
      <div className="flex items-center space-x-3">
        <DollarSign className="w-8 h-8 text-orange-500" />
        <div>
          <h1 className="text-2xl font-bold">Movimientos de Caja</h1>
          {selectedShift && <p className="text-sm text-gray-500">Mostrando Turno #{selectedShift.id}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={() => onDateChange(-1)} disabled={loading}><ChevronLeft /></Button>
        <div className="flex items-center space-x-2 px-4 py-2 rounded-md border">
          <Calendar className="text-gray-600" />
          <span className="font-semibold text-center">{displayDateString}</span>
        </div>
        <Button variant="outline" size="icon" onClick={() => onDateChange(1)} disabled={loading}><ChevronRight /></Button>
        
        {shiftsForDate.length > 1 && (
            <Select onValueChange={onShiftSelect} value={selectedShift?.id?.toString()} disabled={loading}>
                <SelectTrigger className="w-[180px]">
                    <Users className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Seleccionar Turno" />
                </SelectTrigger>
                <SelectContent>
                    {shiftsForDate.map(shift => (
                        <SelectItem key={shift.id} value={shift.id.toString()}>
                            Turno #{shift.id} ({shift.estado})
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )}
        
        <Button onClick={onExportSales} disabled={loading || !selectedShift} variant="outline" title="Exportar ventas a Excel">
          <FileDown className="mr-2 h-4 w-4" />
          Exportar ventas
        </Button>

        {canManageFund && (
          <Button onClick={onFundModalOpen} disabled={!shiftIsActive || loading} variant="secondary">
            <Edit className="mr-2 h-4 w-4" />
            Fondo
          </Button>
        )}
        <Button onClick={onSafeModalOpen} disabled={!shiftIsActive || loading} variant="outline">
          <Shield className="mr-2 h-4 w-4" />
          Caja Fuerte
        </Button>
        {canRetiroEfectivo && (
          // No se deshabilita con `!shiftIsActive`: el Retiro de Efectivo abarca
          // tiradas de VARIOS turnos (incluso cerrados), no depende del turno
          // que esté seleccionado/abierto en pantalla en este momento.
          <Button onClick={onRetiroEfectivoModalOpen} disabled={loading} variant="outline">
            <Banknote className="mr-2 h-4 w-4" />
            Retiro de Efectivo
          </Button>
        )}
        <Button onClick={onPartialCloseModalOpen} disabled={!shiftIsActive || loading} variant="outline">
            <ClipboardList className="mr-2 h-4 w-4" />
            Cierre Parcial
        </Button>
        {canCloseShift && (
          <Button onClick={onCloseShiftModalOpen} disabled={!shiftIsActive || loading}>
            <Lock className="mr-2 h-4 w-4" />
            Cerrar Turno
          </Button>
        )}
        {isModal && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-6 w-6" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default CashRegisterHeader;