import React, { useState, useEffect } from 'react';
import NewOrderModal from '@/components/attention/NewOrderModal';
import CounterPaymentModal from '@/components/attention/CounterPaymentModal';
import { useToast } from '@/components/ui/use-toast';
import { saveCounterSale, fetchCounterSalesForShift, cancelCounterSale } from '@/lib/api/counterApi';
import { Loader2 } from 'lucide-react';
import { fetchSettings } from '@/lib/api/settingsApi';
import { printCounterTicket } from '@/lib/print.js';
import { Button } from '@/components/ui/button';
import CounterSalesList from '@/components/attention/CounterSalesList';
import { useStockStatus } from '@/hooks/useStockStatus';
import StockStatusBadge from '@/components/management/StockStatusBadge';
import OutOfStockModal from '@/components/management/OutOfStockModal';

const CounterPage = ({ currentShift }) => {
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [orderToPay, setOrderToPay] = useState(null);
  const [settings, setSettings] = useState(null);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Stock Status Integration
  const { 
    hasOutOfStock, hasLowStock, outOfStockCount, lowStockCount,
    outOfStockArticles, outOfStockRawMaterials, 
    lowStockArticles, lowStockRawMaterials, lastUpdated, localId 
  } = useStockStatus();
  
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        const fetchedSettings = await fetchSettings();
        setSettings(fetchedSettings);
        if (currentShift) {
          const fetchedSales = await fetchCounterSalesForShift(currentShift, 5);
          setSales(fetchedSales);
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron cargar los datos iniciales."
        });
      } finally {
        setLoading(false);
      }
    };
    loadInitialData();
  }, [currentShift, toast]);

  const refetchSales = async () => {
    if (currentShift) {
      try {
        const fetchedSales = await fetchCounterSalesForShift(currentShift, 5);
        setSales(fetchedSales);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron recargar las ventas."
        });
      }
    }
  };

  const handleOrderCreated = orderData => {
    setOrderToPay({
      items: orderData.items,
      total: orderData.total
    });
    setIsNewOrderOpen(false);
  };

  const handlePaymentSuccess = () => {
    setOrderToPay(null);
    refetchSales();
  };

  const handlePaymentConfirm = async (payments, specialDiscount, emiteFactura, finalTotal) => {
    if (!orderToPay) return;
    try {
      const saleData = {
        items: orderToPay.items,
        total: finalTotal,
        payments: payments,
        specialDiscount: specialDiscount,
        emiteFactura: emiteFactura
      };
      const savedSale = await saveCounterSale(saleData, currentShift);
      if (settings?.printCounterCommand) {
        printCounterTicket(savedSale);
      }
      toast({
        title: "Venta Confirmada",
        description: "La venta y los pagos se han registrado correctamente.",
        className: "bg-green-100 text-green-800"
      });
      handlePaymentSuccess();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al registrar",
        description: error.message
      });
    }
  };

  const handleCancelSale = async (saleToCancel) => {
    try {
      await cancelCounterSale(saleToCancel, currentShift);
      toast({
        title: "Venta Cancelada",
        description: `La venta N° ${saleToCancel.id} ha sido cancelada y el stock restaurado.`,
      });
      refetchSales();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al Cancelar",
        description: error.message,
      });
    }
  };

  const handleModalClose = open => {
    if (!open) {
      setIsNewOrderOpen(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full bg-gray-100">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>;
  }

  return <>
      <div className="p-4 h-full flex flex-col bg-gray-50">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-800">Ventas de Mostrador del Turno</h1>
            
            {/* Real-time Stock Indicator - Handles both OOS and Low Stock */}
            {(hasOutOfStock || hasLowStock) && (
              <div 
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer transition-colors ${hasOutOfStock ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'bg-amber-50 border-amber-200 hover:bg-amber-100'}`}
                onClick={() => setIsStockModalOpen(true)}
                title="Ver alertas de stock"
              >
                <StockStatusBadge 
                  outOfStockCount={outOfStockCount}
                  lowStockCount={lowStockCount}
                />
                <span className={`text-sm font-bold ${hasOutOfStock ? 'text-red-700' : 'text-amber-700'}`}>
                  Stock ({outOfStockCount + lowStockCount})
                </span>
              </div>
            )}
          </div>
          
          <Button onClick={() => setIsNewOrderOpen(true)}>Nueva Venta</Button>
        </div>
        <div className="flex-grow">
            <CounterSalesList sales={sales} onCancelSale={handleCancelSale} />
        </div>
      </div>

      {settings && <NewOrderModal isOpen={isNewOrderOpen} onOpenChange={handleModalClose} onOrderCreated={handleOrderCreated} context="counter" isCounterMode={true} settings={settings} currentShift={currentShift} />}

      {orderToPay && <CounterPaymentModal isOpen={!!orderToPay} onClose={() => setOrderToPay(null)} orderTotal={orderToPay.total} orderItems={orderToPay.items} onConfirmPayment={handlePaymentConfirm} currentShift={currentShift} />}

      <OutOfStockModal 
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        outOfStockArticles={outOfStockArticles}
        outOfStockRawMaterials={outOfStockRawMaterials}
        lowStockArticles={lowStockArticles}
        lowStockRawMaterials={lowStockRawMaterials}
        lastUpdated={lastUpdated}
        localId={localId}
        departments={[]}
      />
    </>;
};
export default CounterPage;