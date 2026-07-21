
import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/components/ui/use-toast.js';
import {
  fetchShiftsForDate,
  fetchHistoricalCashData,
  fetchSalesForShift,
  listenToCashData,
  listenToSales
} from '@/lib/api/cash/index.js';
import { setInitialCashFund } from '@/lib/api/cash/fund.js';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Loader2, Lock, Edit, ShieldAlert, Shield, ClipboardList } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import CloseShiftModal from '@/components/cash/CloseShiftModal.jsx';
import PartialCloseModal from '@/components/cash/PartialCloseModal.jsx';
import CashFundModal from '@/components/cash/CashFundModal.jsx';
import SafeModal from '@/components/cash/SafeModal.jsx';
import ExportSalesModal from '@/components/cash/ExportSalesModal.jsx';
import { useAuth } from '@/hooks/useAuth.jsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.jsx';
import CashRegisterHeader from '@/components/cash/CashRegisterHeader.jsx';
import CashRegisterSummary from '@/components/cash/CashRegisterSummary.jsx';
import CashRegisterExpenses from '@/components/cash/CashRegisterExpenses.jsx';
import CashRegisterSales from '@/components/cash/CashRegisterSales.jsx';
import { formatDateForFirebase, parseDateString, getLocalTodayDate } from '@/lib/utils.js';
import { useAsyncEffect } from '@/hooks/useAsyncEffect.js';
import ErrorBoundary from '@/components/ErrorBoundary.jsx';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

function CashRegisterPageContent({ currentShift: activeShift, onShiftChange, userPermissions, settings, isModal, onClose }) {
  // Fecha de la pantalla de caja: si hay un turno abierto, se usa la fecha de ESA caja; si no,
  // la fecha local real del sistema. Ver el efecto de abajo (se mantiene sincronizada con activeShift).
  const [displayDate, setDisplayDate] = useState(() => (
    activeShift?.date ? parseDateString(activeShift.date) : getLocalTodayDate()
  ));
  
  const [shiftsForDate, setShiftsForDate] = useState([]);
  const [selectedShift, setSelectedShift] = useState(null);
  const [cashData, setCashData] = useState(null);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCloseShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const [isPartialCloseModalOpen, setPartialCloseModalOpen] = useState(false);
  const [isFundModalOpen, setFundModalOpen] = useState(false);
  const [isSafeModalOpen, setSafeModalOpen] = useState(false);
  const [isExportModalOpen, setExportModalOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { ready: firebaseReady } = useFirebaseReadiness();

  const hasFullAccess = userPermissions.cajas;
  const canManageFund = userPermissions.cajas_gestionar_fondo;
  const canCloseShift = userPermissions.cajas_cerrar_turno;

  // Regla de fecha de la pantalla de caja:
  // - Si HAY un turno abierto, la pantalla usa la fecha de ESA caja (no cambia por pasar la
  //   medianoche: una caja del 09/07 sigue en 09/07 aunque sean las 04:00 del 10/07).
  // - Si NO hay turno abierto, usa la fecha local real del sistema (calendario).
  // Se re-evalúa cuando cambia el turno activo (abrir/cerrar), no por el reloj.
  useEffect(() => {
    setDisplayDate(activeShift?.date ? parseDateString(activeShift.date) : getLocalTodayDate());
  }, [activeShift]);

  useAsyncEffect(async (isMounted) => {
    if (!displayDate) return;
    
    setLoading(true);
    try {
        let fetchedShifts = await fetchShiftsForDate(displayDate);
        if (!isMounted()) return;

        const dateString = formatDateForFirebase(displayDate);
        if (activeShift && activeShift.date === dateString) {
            const exists = fetchedShifts.find(s => String(s.id) === String(activeShift.id));
            if (!exists) {
                fetchedShifts = [activeShift, ...fetchedShifts].sort((a, b) => Number(b.id) - Number(a.id));
            }
        }

        setShiftsForDate(fetchedShifts);

        const activeShiftOnThisDate = fetchedShifts.find(s => String(s.id) === String(activeShift?.id));
        
        if (activeShiftOnThisDate) {
            setSelectedShift(activeShiftOnThisDate);
        } else if (fetchedShifts.length > 0) {
            setSelectedShift(fetchedShifts[0]);
        } else {
            setSelectedShift(null);
        }
    } catch (error) {
        if (!isMounted()) return;
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los turnos.' });
        setShiftsForDate([]);
        setSelectedShift(null);
    } finally {
        if (isMounted()) setLoading(false);
    }
  }, [displayDate, activeShift, toast], { componentName: 'CashRegisterPage-Shifts' });

  useEffect(() => {
    let isMounted = true;
    setCashData(null);
    setSales([]);

    if (!selectedShift || !firebaseReady) {
        setLoading(false);
        return;
    }

    setLoading(true);

    // Historial vs. vivo: se decide por el campo `estado` PROPIO del turno, que es la única
    // señal confiable (createNewShift lo pone en 'abierto'; closeShift lo pasa a 'cerrado' y a
    // la vez mueve los datos a BACKUP). Solo un turno 'abierto' usa listeners vivos; cualquier
    // otro estado (cerrado, o incompleto/sin estado) se lee desde BACKUP. NO se compara contra
    // ningún turno "activo" externo, porque ese dato puede llegar stale y marcaría el turno
    // abierto real como histórico (bug que bloqueaba caja y mostraba datos en cero).
    const isHistorical = !selectedShift || selectedShift.estado !== 'abierto';

    if (isHistorical) {
        Promise.all([
            fetchHistoricalCashData(selectedShift),
            fetchSalesForShift(selectedShift)
        ]).then(([fetchedCashData, fetchedSales]) => {
            if (isMounted) {
                setCashData(fetchedCashData);
                setSales(fetchedSales);
                setLoading(false);
            }
        }).catch(() => {
            if (isMounted) {
                toast({ variant: 'destructive', title: 'Error', description: 'Error al cargar turno cerrado.' });
                setLoading(false);
            }
        });
        return () => { isMounted = false; };
    }

    const cashUnsub = listenToCashData(selectedShift, (data) => {
        if (isMounted) {
            setCashData(data || { fondoInicial: selectedShift.fondoInicial || 0, gastos: {}, CAJAFUERTE: {} });
            setLoading(false);
        }
    });
    
    const salesUnsub = listenToSales(selectedShift, (data) => {
        if (isMounted) {
            setSales(data || []);
        }
    });

    return () => {
        isMounted = false;
        cashUnsub();
        salesUnsub();
    };
  }, [selectedShift, toast, firebaseReady]);

  const handleShiftClosed = (newShift) => {
    onShiftChange(newShift);
    if (isModal && onClose) {
      onClose();
    }
  };

  const handleDateChange = (direction) => {
    setDisplayDate(prevDate => {
        const newDate = new Date(prevDate);
        newDate.setDate(newDate.getDate() + direction);
        return newDate;
    });
  };

  const handleShiftSelect = (shiftId) => {
      const shiftToSelect = shiftsForDate.find(s => String(s.id) === String(shiftId));
      if(shiftToSelect) {
        setSelectedShift(shiftToSelect);
      }
  };

  const handleFundSet = async (amount) => {
    if (!selectedShift) return;
    try {
      const updatedShift = await setInitialCashFund(selectedShift.id, amount, selectedShift.date);
      onShiftChange({ ...selectedShift, ...updatedShift });
    } catch (error) {
       toast({ variant: 'destructive', title: 'Error', description: 'No se pudo actualizar el fondo de caja.' });
    }
  };

  const { totalsByPaymentMethod, totalSales, totalExpenses, cashInBox, totalSafe, totalCost } = useMemo(() => {
    if (!sales || !selectedShift) return { totalsByPaymentMethod: {}, totalSales: 0, totalExpenses: 0, cashInBox: 0, totalSafe: 0, totalCost: 0 };
    
    const validSales = sales.filter(sale => sale.status !== 'CANCELADO');
    const totalSalesValue = validSales.reduce((sum, sale) => sum + (sale.total || 0), 0);

    let calculatedCost = 0;
    
    console.log(`[Shift Summary] Fetching CostoTotal for shift ${selectedShift.id}. Processing ${validSales.length} valid sales...`);
    
    const totalCostValue = validSales.reduce((sum, sale) => {
      let saleCost = 0;
      if (sale.CostoTotal !== undefined && sale.CostoTotal !== null) {
         saleCost = Number(sale.CostoTotal);
         console.log(`[Shift Summary] Found CostoTotal for ${sale.type} #${sale.id}: ${saleCost}`);
      } else {
         saleCost = (sale.items || []).reduce((itemSum, item) => {
            const qty = item.cantidad || item.quantity || 1;
            const unitCost = item.costoTotalReceta || item.costoUnitario || 0;
            return itemSum + (qty * unitCost);
         }, 0);
         console.log(`[Shift Summary] Calculated fallback CostoTotal for ${sale.type} #${sale.id}: ${saleCost}`);
      }
      return sum + saleCost;
    }, 0);

    calculatedCost = Math.round(totalCostValue * 1000) / 1000;
    console.log(`[Shift Summary] Final rounded CostoTotal for shift: ${calculatedCost}`);

    const totalsByPaymentMethodValue = validSales.reduce((acc, sale) => {
      (sale.payments || []).forEach(payment => {
        acc[payment.method] = (acc[payment.method] || 0) + (payment.amount || 0);
      });
      return acc;
    }, {});
    
    const expensesArray = cashData?.gastos ? Object.values(cashData.gastos).filter(Boolean) : [];
    const paidExpenses = expensesArray.filter(expense => expense.status !== 'A Pagar' && !(expense.concepto || '').startsWith('Nota de Credito'));
    const totalExpensesValue = paidExpenses.reduce((sum, expense) => sum + (expense.monto || 0), 0);
    
    const safeEntries = cashData?.CAJAFUERTE ? Object.values(cashData.CAJAFUERTE).filter(Boolean) : [];
    const totalSafeValue = safeEntries.reduce((sum, entry) => sum + (entry.valor || 0), 0);

    const totalCashSales = totalsByPaymentMethodValue['Efectivo'] || 0;
    const totalCashExpenses = paidExpenses
      .filter(expense => expense.paymentMethod === 'efectivo')
      .reduce((sum, expense) => sum + (expense.monto || 0), 0);
    
    const fondoInicial = cashData?.fondoInicial !== undefined ? cashData.fondoInicial : (selectedShift.fondoInicial || 0);
    const cashInBoxValue = fondoInicial + totalCashSales - totalCashExpenses - totalSafeValue;

    return { 
        totalsByPaymentMethod: totalsByPaymentMethodValue, 
        totalSales: totalSalesValue, 
        totalExpenses: totalExpensesValue, 
        cashInBox: cashInBoxValue,
        totalSafe: totalSafeValue,
        totalCost: calculatedCost
    };
  }, [sales, cashData, selectedShift]);

  // Las acciones de caja (Cerrar Turno, Fondo, Caja Fuerte, Cierre Parcial) se habilitan cuando
  // el turno visualizado está ABIERTO. Se usa el estado propio del turno (señal confiable), no
  // una comparación contra un "turno activo" externo que puede llegar stale y deshabilitar los
  // botones a usuarios con permiso aunque el turno del día esté realmente abierto. Los turnos
  // cerrados/históricos quedan 'cerrado', por lo que siguen protegidos (no se pueden operar).
  const shiftIsActive = !!selectedShift && selectedShift.estado === 'abierto';

  const renderContent = () => {
    return (
      <div className="p-1 h-full flex flex-col">
        <Card className="shadow-xl rounded-xl flex-grow flex flex-col bg-white">
          <CashRegisterHeader
            currentShift={activeShift}
            selectedShift={selectedShift}
            shiftsForDate={shiftsForDate}
            onShiftSelect={handleShiftSelect}
            shiftIsActive={shiftIsActive}
            loading={loading}
            canManageFund={canManageFund}
            canCloseShift={canCloseShift}
            onFundModalOpen={() => setFundModalOpen(true)}
            onSafeModalOpen={() => setSafeModalOpen(true)}
            onCloseShiftModalOpen={() => setCloseShiftModalOpen(true)}
            onPartialCloseModalOpen={() => setPartialCloseModalOpen(true)}
            onDateChange={handleDateChange}
            displayDate={displayDate}
            isModal={isModal}
            onClose={onClose}
            onExportSales={() => setExportModalOpen(true)}
          />
          <CardContent className="p-4 flex-grow flex flex-col md:flex-row gap-4">
            {!hasFullAccess && !canManageFund && !canCloseShift ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <ShieldAlert className="h-16 w-16 text-red-500 mb-4" />
                  <h2 className="text-2xl font-bold mb-2">Acceso Denegado</h2>
                  <p className="text-gray-600">No tienes permisos para acceder a los datos de caja.</p>
              </div>
            ) : !hasFullAccess ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-full max-w-md text-center space-y-4">
                  <h2 className="text-xl font-bold">Gestión de Caja</h2>
                  <p className="text-gray-600">Acciones rápidas para el turno actual:</p>
                  <div className="flex flex-col justify-center gap-4">
                    {canManageFund && (
                      <Button onClick={() => setFundModalOpen(true)} disabled={!shiftIsActive || loading} variant="secondary" size="lg">
                        <Edit className="mr-2 h-4 w-4" /> Gestionar Fondo
                      </Button>
                    )}
                     {canCloseShift && (
                       <Button onClick={() => setSafeModalOpen(true)} disabled={!shiftIsActive || loading} variant="outline" size="lg">
                          <Shield className="mr-2 h-4 w-4" /> Caja Fuerte
                       </Button>
                     )}
                     <Button onClick={() => setPartialCloseModalOpen(true)} disabled={!shiftIsActive || loading} variant="outline" size="lg">
                        <ClipboardList className="mr-2 h-4 w-4" /> Cierre Parcial
                     </Button>
                    {canCloseShift && (
                       <Button onClick={() => setCloseShiftModalOpen(true)} disabled={!shiftIsActive || loading} size="lg">
                          <Lock className="mr-2 h-4 w-4" /> Cerrar Turno
                       </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : loading ? (
              <div className="flex-1 flex justify-center items-center"><Loader2 className="w-16 h-16 animate-spin text-orange-500" /></div>
            ) : !selectedShift ? (
              <div className="flex-1 flex justify-center items-center text-center text-gray-500">
                  <div>
                      <Lock className="mx-auto h-12 w-12 text-gray-400 mb-2"/>
                      <p className="font-semibold text-lg">No se encontraron turnos para esta fecha.</p>
                  </div>
               </div>
            ) : (
              <>
                <div className="md:w-1/3 flex flex-col gap-4">
                  <CashRegisterSummary
                    key={`summary-${selectedShift.id}`}
                    currentShift={selectedShift}
                    totalSales={totalSales}
                    totalExpenses={totalExpenses}
                    totalSafe={totalSafe}
                    cashInBox={cashInBox}
                    totalCost={totalCost}
                    totalsByPaymentMethod={totalsByPaymentMethod}
                    cashData={cashData}
                  />
                  <CashRegisterExpenses key={`expenses-${selectedShift.id}`} expenses={cashData?.gastos} />
                </div>
                <div className="md:w-2/3 flex-grow flex flex-col">
                  <CashRegisterSales key={`sales-${selectedShift.id}`} sales={sales} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const commonModals = (
    <>
      {isCloseShiftModalOpen && (
        <CloseShiftModal
          isOpen={isCloseShiftModalOpen}
          onClose={() => setCloseShiftModalOpen(false)}
          shiftData={ selectedShift && cashData ? { ...selectedShift, ...cashData } : null }
          sales={sales}
          onShiftClosed={handleShiftClosed}
          settings={settings}
          user={user}
          totalCost={totalCost}
        />
      )}
      {isPartialCloseModalOpen && (
        <PartialCloseModal
          isOpen={isPartialCloseModalOpen}
          onClose={() => setPartialCloseModalOpen(false)}
          shiftData={ selectedShift && cashData ? { ...selectedShift, ...cashData } : null }
          sales={sales}
          settings={settings}
          user={user}
        />
      )}
       <CashFundModal
        isOpen={isFundModalOpen}
        onClose={() => setFundModalOpen(false)}
        onFundSet={handleFundSet}
        shift={selectedShift}
        isEditable={true}
      />
      <SafeModal
        isOpen={isSafeModalOpen}
        onClose={() => setSafeModalOpen(false)}
        shift={selectedShift}
      />
      {isExportModalOpen && (
        <ExportSalesModal
          isOpen={isExportModalOpen}
          onClose={() => setExportModalOpen(false)}
          selectedShift={selectedShift}
        />
      )}
    </>
  );

  if (isModal) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="w-screen h-screen max-w-full max-h-full p-0 m-0 border-0 rounded-none bg-transparent">
          <ScrollArea className="h-full w-full bg-gray-100">
            <div className="p-4">
              {renderContent()}
            </div>
          </ScrollArea>
          {commonModals}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      {renderContent()}
      {commonModals}
    </>
  );
}

export default function CashRegisterPage(props) {
  return (
    <ErrorBoundary componentName="CashRegisterPage">
      <CashRegisterPageContent {...props} />
    </ErrorBoundary>
  );
}
