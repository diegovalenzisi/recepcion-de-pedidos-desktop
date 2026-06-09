import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateShiftReportData, savePartialClose } from '@/lib/api/cash';
import { Printer, Info, Save, Loader2 } from 'lucide-react';
import { PDFViewer } from '@react-pdf/renderer';
import ShiftReportDocument from '@/components/cash/ShiftReportDocument';
import { useToast } from '@/components/ui/use-toast';
import { fetchVendorsByCategory } from '@/lib/api/hrApi';

const PartialCloseModal = ({ isOpen, onClose, shiftData, sales, settings, user }) => {
  const [showPdf, setShowPdf] = useState(false);
  const [cashCount, setCashCount] = useState('');
  const [responsible, setResponsible] = useState('');
  const [sellerEmployees, setSellerEmployees] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const canSeeDetails = useMemo(() => {
    if (!user) return false;
    if (user.usuario === 'DiegoL') return true;
    const userRole = user.rol;
    return userRole === 'dueño' || userRole === 'encargado';
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      const loadData = async () => {
        try {
          const vendors = await fetchVendorsByCategory();
          setSellerEmployees(vendors);
        } catch (error) {
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los vendedores.' });
        }
      };
      loadData();
    }
  }, [isOpen, toast]);

  const reportData = useMemo(() => {
    if (!shiftData || !sales || !settings) return null;
    return generateShiftReportData(shiftData, sales, parseFloat(cashCount || 0), settings);
  }, [shiftData, sales, cashCount, settings]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
  };

  useEffect(() => {
    if (!isOpen) {
      setShowPdf(false);
      setCashCount('');
      setResponsible('');
      setIsSaving(false);
    }
  }, [isOpen]);
  
  const handleSavePartial = async () => {
    if (!cashCount || !responsible) {
        toast({
            variant: "destructive",
            title: "Datos incompletos",
            description: "Por favor, ingrese el efectivo contado y seleccione un responsable.",
        });
        return;
    }

    // Validate selected responsible
    const selectedEmp = sellerEmployees.find(emp => `${emp.nombre} ${emp.apellido}`.trim() === responsible);
    if (!selectedEmp || selectedEmp.categoriaNombre?.toUpperCase() !== 'VENDEDOR') {
        toast({
            variant: "destructive",
            title: "Error de validación",
            description: "El empleado seleccionado no es válido o no pertenece a la categoría VENDEDOR.",
        });
        return;
    }

    setIsSaving(true);
    try {
        await savePartialClose(shiftData, reportData.summary, responsible);
        toast({
            title: "Éxito",
            description: "El cierre parcial ha sido guardado correctamente.",
        });
        onClose();
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Error al guardar",
            description: "No se pudo guardar el cierre parcial. Por favor, intente de nuevo.",
        });
        console.error("Error saving partial close:", error);
    } finally {
        setIsSaving(false);
    }
  };

  if (!shiftData || !reportData) return null;

  if (showPdf && canSeeDetails) {
    return (
      <Dialog open={showPdf} onOpenChange={(open) => !open && setShowPdf(false)}>
        <DialogContent className="max-w-4xl h-[90vh]">
          <DialogHeader>
            <DialogTitle>Reporte Parcial de Turno</DialogTitle>
          </DialogHeader>
          <div className="h-full">
            <PDFViewer width="100%" height="100%">
              <ShiftReportDocument data={reportData} />
            </PDFViewer>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { summary } = reportData;
  const { difference } = summary;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cierre Parcial - Turno #{shiftData.id}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
          
          {canSeeDetails ? (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold mb-2">Resumen Actual del Turno</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <p>Fondo Inicial:</p><p className="font-semibold text-right">{formatCurrency(summary.fondoInicial)}</p>
                <p>Ventas en Efectivo:</p><p className="font-semibold text-right">{formatCurrency(summary.totalCashSales)}</p>
                <p>Ventas Electrónicas:</p><p className="font-semibold text-right">{formatCurrency(summary.totalElectronicSales)}</p>
                <p>Gastos en Efectivo:</p><p className="font-semibold text-right text-red-500">-{formatCurrency(summary.totalCashExpenses)}</p>
                <p>Gastos Electrónicos:</p><p className="font-semibold text-right text-red-500">-{formatCurrency(summary.totalElectronicExpenses)}</p>
                <p>Monto en Resguardo:</p><p className="font-semibold text-right text-blue-500">-{formatCurrency(summary.totalSafe)}</p>
                <p className="font-bold border-t pt-2">Efectivo Esperado:</p><p className="font-bold border-t pt-2 text-right">{formatCurrency(summary.cashInBox)}</p>
              </div>
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center bg-gray-50 p-6 rounded-lg text-center">
                <Info className="w-12 h-12 text-blue-500 mb-4" />
                <h3 className="text-lg font-semibold">Informe Parcial</h3>
                <p className="text-sm text-gray-600 mt-2">
                    Declare el efectivo en caja y seleccione el vendedor responsable. Esta acción guardará un registro del estado actual.
                </p>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cash-count-partial">Efectivo Contado en Caja</Label>
              <Input
                id="cash-count-partial"
                type="number"
                placeholder="Ingrese el monto contado"
                value={cashCount}
                onChange={(e) => setCashCount(e.target.value)}
                className="text-lg"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="responsible-partial">Vendedor Responsable</Label>
              <Select onValueChange={setResponsible} value={responsible}>
                <SelectTrigger id="responsible-partial">
                  <SelectValue placeholder="Seleccione un vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {sellerEmployees.length === 0 ? (
                    <SelectItem value="none" disabled>No hay vendedores disponibles</SelectItem>
                  ) : (
                    sellerEmployees.map(emp => {
                      const fullName = `${emp.nombre} ${emp.apellido}`.trim();
                      return (
                        <SelectItem key={emp.legajo} value={fullName}>
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

            {cashCount && canSeeDetails && (
              <div className={`p-2 rounded-md text-center font-bold ${difference === 0 ? 'bg-gray-100' : difference > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                Diferencia: {formatCurrency(difference)}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="justify-between sm:justify-between items-center">
          <div className="flex gap-2">
             <Button onClick={handleSavePartial} disabled={isSaving || !cashCount || !responsible}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Guardar Cierre Parcial
             </Button>
            {canSeeDetails && (
                <Button onClick={() => setShowPdf(true)} variant="outline">
                    <Printer className="mr-2 h-4 w-4" /> Ver Reporte
                </Button>
            )}
          </div>
          <DialogClose asChild>
            <Button type="button" variant="secondary">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PartialCloseModal;