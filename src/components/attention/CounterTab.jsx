import React, { useState, useEffect } from 'react';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import NewOrderModal from '@/components/attention/NewOrderModal';
import CounterPaymentModal from '@/components/attention/CounterPaymentModal';
import CounterSalesList from '@/components/attention/CounterSalesList';
import { saveCounterSale, fetchCounterSalesForShift, cancelCounterSale } from '@/lib/api/counterApi';
import { printCounterTicket } from '@/lib/print.js';
import { useStockStatus } from '@/hooks/useStockStatus';
import StockStatusBadge from '@/components/management/StockStatusBadge';
import OutOfStockModal from '@/components/management/OutOfStockModal';

function CounterTab({ currentShift, settings }) {
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [orderToPay, setOrderToPay] = useState(null);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const { 
    hasOutOfStock, 
    hasLowStock, 
    outOfStockCount, 
    lowStockCount,
    outOfStockArticles, 
    outOfStockRawMaterials, 
    lowStockArticles, 
    lowStockRawMaterials, 
    lastUpdated, 
    localId 
  } = useStockStatus();
  
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);

  const loadSales = async (showLoadingIndicator = true) => {
    if (showLoadingIndicator) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    
    try {
      if (currentShift) {
        const fetchedSales = await fetchCounterSalesForShift(currentShift, 10);
        setSales(fetchedSales || []);
      }
    } catch (error) {
      console.error("[CounterTab] Error loading sales:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudieron cargar las ventas del turno."
      });
    } finally {
      if (showLoadingIndicator) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    if (currentShift) {
      loadSales();
    } else {
      setLoading(false);
    }
  }, [currentShift]);

  const handleOrderCreated = (orderData) => {
    if (!orderData) return;
    setOrderToPay({
      items: orderData.items || [],
      total: orderData.total || 0
    });
    setIsNewOrderOpen(false);
  };

  const handlePaymentSuccess = () => {
    setOrderToPay(null);
    loadSales(false);
  };

  const handlePaymentConfirm = async (payments, specialDiscount, emiteFactura, finalTotal) => {
    if (!orderToPay) return;

    const tUI = Date.now();
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
        const tPrint = Date.now();
        printCounterTicket(savedSale);
        console.log(`[VENTA MOSTRADOR] imprimir: ${Date.now() - tPrint} ms`);
      }

      toast({
        title: "Venta Confirmada",
        description: "La venta y los pagos se han registrado correctamente.",
        className: "bg-green-100 text-green-800 border-green-200"
      });

      console.log(`[VENTA MOSTRADOR] actualizar UI: ${Date.now() - tUI} ms`);
      handlePaymentSuccess();
    } catch (error) {
      console.error("[CounterTab] Error saving sale:", error);
      toast({
        variant: "destructive",
        title: "Error al registrar",
        description: error.message || "No se pudo registrar la venta."
      });
    }
  };

  const handleCancelSale = async (saleToCancel) => {
    if (!saleToCancel) return;
    
    try {
      await cancelCounterSale(saleToCancel, currentShift);
      
      toast({
        title: "Venta Cancelada",
        description: `La venta N° ${saleToCancel.id} ha sido cancelada y el stock restaurado.`,
      });
      
      loadSales(false);
    } catch (error) {
      console.error("[CounterTab] Error canceling sale:", error);
      toast({
        variant: "destructive",
        title: "Error al Cancelar",
        description: error.message || "No se pudo cancelar la venta.",
      });
    }
  };

  const handleRefresh = () => {
    loadSales(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-4 text-gray-600">Cargando ventas de mostrador...</span>
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-2 bg-white border-b shadow-sm z-10 rounded-t-lg">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-700 px-2">Ventas de Mostrador</h2>
            
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
          
          <div className="flex gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleRefresh}
              disabled={refreshing}
              title="Actualizar ventas"
              className="h-9 w-9 text-gray-500 hover:text-primary hover:bg-primary/10"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Button 
              onClick={() => setIsNewOrderOpen(true)}
              className="flex items-center gap-2"
              disabled={!currentShift}
            >
              <Plus className="h-4 w-4" />
              Nueva Venta
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 bg-gray-50/50 p-2">
          {sales && sales.length > 0 ? (
            <CounterSalesList 
              sales={sales} 
              onCancelSale={handleCancelSale}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>No hay ventas registradas en este turno.</p>
            </div>
          )}
        </ScrollArea>
      </div>

      {settings && (
        <NewOrderModal 
          isOpen={isNewOrderOpen} 
          onOpenChange={setIsNewOrderOpen}
          onOrderCreated={handleOrderCreated} 
          context="counter" 
          isCounterMode={true} 
          settings={settings} 
          currentShift={currentShift}
        />
      )}

      {orderToPay && (
        <CounterPaymentModal 
          isOpen={!!orderToPay} 
          onClose={() => setOrderToPay(null)} 
          orderTotal={orderToPay.total} 
          orderItems={orderToPay.items} 
          onConfirmPayment={handlePaymentConfirm} 
          currentShift={currentShift}
        />
      )}

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
    </>
  );
}

export default CounterTab;