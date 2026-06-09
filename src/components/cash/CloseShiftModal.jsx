
import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { closeShift, generateShiftReportData } from '@/lib/api/cash';
import { saveShiftSummaryToPath } from '@/lib/api/cash/summary.js';
import { getCurrentLocalId } from '@/lib/firebase/core.js';
import { Loader2, ShieldAlert } from 'lucide-react';
import { fetchVendorsByCategory } from '@/lib/api/hrApi';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';

const CloseShiftModal = ({ isOpen, onClose, shiftData, sales, onShiftClosed, settings, user, totalCost }) => {
  const [cashCount, setCashCount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authorizedUsers, setAuthorizedUsers] = useState([]);
  const [selectedResponsible, setSelectedResponsible] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  useEffect(() => {
    if (isOpen) {
      const loadAuthorizedUsers = async () => {
        try {
          const vendors = await fetchVendorsByCategory();
          setAuthorizedUsers(vendors);
        } catch (error) {
          console.error("Error loading vendors:", error);
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los vendedores autorizados.' });
        }
      };
      
      loadAuthorizedUsers();
    }
  }, [isOpen, toast]);

  const canSeeDetails = useMemo(() => {
    if (!user) return false;
    if (user.usuario === 'DiegoL') return true;
    const userRole = (user.rol || '').toLowerCase();
    return ['dueño', 'encargado', 'admin', 'gerente'].includes(userRole);
  }, [user]);

  const reportData = useMemo(() => {
    if (!shiftData || !sales || !settings) return null;
    return generateShiftReportData(shiftData, sales, parseFloat(cashCount || 0), settings);
  }, [shiftData, sales, cashCount, settings]);

  const handleProgressUpdate = (message) => {
    setProgressMessage(message);
  };

  const handleCloseShift = async () => {
    if (cashCount === '' || isNaN(parseFloat(cashCount))) {
      toast({ variant: 'destructive', title: 'Error', description: 'Por favor, ingrese un monto de efectivo válido.' });
      return;
    }
    if (!selectedResponsible) {
      toast({ variant: 'destructive', title: 'Error', description: 'Por favor, seleccione un responsable.' });
      return;
    }
    
    // Validate that the selected user actually exists and is a VENDEDOR
    const responsibleUser = authorizedUsers.find(u => `${u.nombre} ${u.apellido}`.trim() === selectedResponsible);
    if (!responsibleUser || responsibleUser.categoriaNombre?.toUpperCase() !== 'VENDEDOR') {
        toast({ variant: 'destructive', title: 'Error', description: 'El usuario seleccionado no es válido o no pertenece a la categoría VENDEDOR.' });
        return;
    }

    setIsLoading(true);
    setProgressMessage('Iniciando cierre...');
    try {
      const shiftDataToSave = {
        ...shiftData,
        costoTotal: totalCost !== undefined ? totalCost : 0
      };

      await closeShift(shiftDataToSave, parseFloat(cashCount), sales, null, selectedResponsible, handleProgressUpdate);
      
      // Calculate and save shift summary data to Firebase CAJAS path
      setProgressMessage('Guardando resumen del turno...');
      const localId = getCurrentLocalId();
      const calculatedTotalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
      const expensesArray = Object.values(shiftDataToSave.gastos || {});
      const calculatedTotalExpenses = expensesArray.reduce((sum, exp) => sum + (exp?.monto || 0), 0);
      const safeEntries = Object.values(shiftDataToSave.CAJAFUERTE || {}).filter(Boolean);
      const calculatedTotalSafe = safeEntries.reduce((sum, entry) => sum + (entry.valor || 0), 0);
      const calculatedGanancia = calculatedTotalSales - calculatedTotalExpenses - (totalCost || 0);

      const summaryData = {
          ventasTotales: calculatedTotalSales,
          gastosTotales: calculatedTotalExpenses,
          cajaFuerte: calculatedTotalSafe,
          costoTotal: totalCost || 0,
          ganancia: Math.round(calculatedGanancia * 1000) / 1000,
          fondoInicial: shiftDataToSave.fondoInicial || 0
      };

      await saveShiftSummaryToPath(localId, shiftDataToSave.date, shiftDataToSave.id, summaryData);

      toast({ title: 'Turno Cerrado', description: `El turno #${shiftData.id} ha sido cerrado exitosamente.` });
      onShiftClosed(null);
      onClose();
    } catch (error) {
      console.error("Error closing shift:", error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cerrar el turno.' });
    } finally {
      setIsLoading(false);
      setProgressMessage('');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
  };

  const formatCostCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amount || 0);
  };

  useEffect(() => {
    if (!isOpen) {
      setCashCount('');
      setSelectedResponsible('');
      setIsLoading(false);
      setProgressMessage('');
    }
  }, [isOpen]);

  if (!shiftData || !reportData) return null;

  const { summary } = reportData;
  const { difference } = summary;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cerrar Turno #{shiftData.id}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <p className="text-lg font-semibold text-gray-700">Procesando cierre de turno...</p>
            <div className="w-full max-w-md">
              <Progress value={100} className="h-2 animate-pulse" />
              <p className="text-sm text-center mt-2 text-gray-500">{progressMessage}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
              {canSeeDetails ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <p>Fecha de Caja:</p><p className="font-semibold text-right">{shiftData.date}</p>
                    <p>Hora de Cierre:</p><p className="font-semibold text-right">{new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                    <p>Número de Turno:</p><p className="font-semibold text-right">#{shiftData.id}</p>
                    <p>Fondo Inicial:</p><p className="font-semibold text-right">{formatCurrency(summary.fondoInicial)}</p>
                    <p>Ventas en Efectivo:</p><p className="font-semibold text-right">{formatCurrency(summary.totalCashSales)}</p>
                    <p>Ventas Electrónicas:</p><p className="font-semibold text-right">{formatCurrency(summary.totalElectronicSales)}</p>
                    <p>Gastos en Efectivo:</p><p className="font-semibold text-right text-red-500">-{formatCurrency(summary.totalCashExpenses)}</p>
                    <p>Gastos Electrónicos:</p><p className="font-semibold text-right text-red-500">-{formatCurrency(summary.totalElectronicExpenses)}</p>
                    <p>Monto en Resguardo:</p><p className="font-semibold text-right text-blue-500">-{formatCurrency(summary.totalSafe)}</p>
                    <p>Costo Total:</p><p className="font-semibold text-right text-orange-500">{formatCostCurrency(totalCost)}</p>
                    <p className="font-bold border-t pt-2">Efectivo Esperado:</p><p className="font-bold border-t pt-2 text-right">{formatCurrency(summary.cashInBox)}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center bg-gray-50 p-4 rounded-lg">
                    <ShieldAlert className="w-16 h-16 text-orange-500 mb-4" />
                    <h3 className="text-lg font-semibold text-center">Cierre de Turno de Empleado</h3>
                    <p className="text-sm text-gray-600 text-center mt-2">
                        Por favor, ingrese el monto total de efectivo contado en la caja y seleccione el vendedor responsable del cierre.
                    </p>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cash-count">Efectivo Contado en Caja</Label>
                  <Input
                    id="cash-count"
                    type="number"
                    placeholder="Ingrese el monto contado"
                    value={cashCount}
                    onChange={(e) => setCashCount(e.target.value)}
                    className="text-lg"
                  />
                </div>

                {canSeeDetails && (
                  <div className={`p-2 rounded-md text-center font-bold ${difference === 0 ? 'bg-gray-100' : difference > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    Diferencia: {formatCurrency(difference)}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="responsible">Vendedor Responsable</Label>
                  <Select onValueChange={setSelectedResponsible} value={selectedResponsible}>
                    <SelectTrigger id="responsible">
                      <SelectValue placeholder="Seleccione un vendedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {authorizedUsers.length === 0 ? (
                        <SelectItem value="none" disabled>No hay vendedores disponibles</SelectItem>
                      ) : (
                        authorizedUsers.map(emp => {
                          const fullName = `${emp.nombre || ''} ${emp.apellido || ''}`.trim();
                          return (
                            <SelectItem key={emp.legajo || fullName} value={fullName}>
                              <div className="flex justify-between items-center w-full gap-4">
                                <span>{fullName}</span>
                                <span className="text-xs text-muted-foreground uppercase">VENDEDOR</span>
                              </div>
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="justify-end">
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="secondary" disabled={isLoading}>Cancelar</Button>
                </DialogClose>
                <Button onClick={handleCloseShift} disabled={isLoading || cashCount === '' || isNaN(parseFloat(cashCount)) || !selectedResponsible}>
                  Confirmar y Cerrar Turno
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CloseShiftModal;
