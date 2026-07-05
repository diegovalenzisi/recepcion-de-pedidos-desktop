import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, CalendarClock, Calendar as CalendarIcon, RefreshCw, CloudOff, Cloud, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import NewOrderModal from '@/components/attention/NewOrderModal';
import AssignDelivererModal from '@/components/attention/AssignDelivererModal';
import SplitPaymentModal from '@/components/attention/SplitPaymentModal';
import ChangeStatusModal from '@/components/attention/ChangeStatusModal';
import OrderDetailModal from '@/components/attention/OrderDetailModal';
import ChangeDeliveryTimeModal from '@/components/attention/ChangeDeliveryTimeModal';
import SearchOrderModal from '@/components/attention/SearchOrderModal';
import DelivererReturnModal from '@/components/attention/DelivererReturnModal';
import QRScannerModal from '@/components/attention/QRScannerModal';
import QRAssignDelivererModal from '@/components/attention/QRAssignDelivererModal';
import { listenToOrders, updateOrder, validateStatusChange } from '@/lib/api/ordersApi';
import { fetchDeliverers } from '@/lib/api/deliverersApi';
import { fetchOptionalGroups } from '@/lib/api/managementApi';
import { fetchAccounts, fetchFavoriteAccountInfo } from '@/lib/api/accountsApi';
import { fetchEmployees, fetchCategories } from '@/lib/api/hrApi';
import { openWhatsApp } from '@/lib/whatsapp/whatsappHandler';
import { buildPaymentWhatsAppMessage } from '@/lib/whatsapp/paymentMessage';
import DeliveryActionBar from '@/components/attention/delivery/DeliveryActionBar';
import DeliveryOrderTable from '@/components/attention/delivery/DeliveryOrderTable';
import DeliveryGridView from '@/components/attention/delivery/DeliveryGridView';
import useDeliveryActions from '@/hooks/useDeliveryActions';
import { formatDateForFirebase, getOperationalDate } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStockStatus } from '@/hooks/useStockStatus';
import StockStatusBadge from '@/components/management/StockStatusBadge';
import OutOfStockModal from '@/components/management/OutOfStockModal';
import { useOrderCache } from '@/hooks/useOrderCache';
import { useCacheStatus } from '@/hooks/useCacheStatus';
import { useDeliveryStatusWhatsApp } from '@/hooks/useDeliveryStatusWhatsApp';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function DeliveryTab({ settings, context, currentShift, alarmingOrderIds = [], acknowledgeOrder }) {
  const { cachedOrders, isCacheLoading, syncCache, optimisticUpdate, invalidateDelivererCache } = useOrderCache();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { syncStatus, setSyncStatus, refreshStatus } = useCacheStatus(isOnline);

  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0); 
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [deliverers, setDeliverers] = useState([]);
  const [optionalGroups, setOptionalGroups] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const { toast } = useToast();
  
  const { 
    hasOutOfStock, hasLowStock, outOfStockCount, lowStockCount,
    outOfStockArticles, outOfStockRawMaterials, 
    lowStockArticles, lowStockRawMaterials, lastUpdated, localId 
  } = useStockStatus();
  
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  
  const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false);
  const [isChangeTimeModalOpen, setIsChangeTimeModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [showQRAssignDelivererModal, setShowQRAssignDelivererModal] = useState(false);
  const [selectedDelivererForQR, setSelectedDelivererForQR] = useState(null);
  
  const [orderToEditClient, setOrderToEditClient] = useState(null);
  
  const [showFinished, setShowFinished] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => getOperationalDate(new Date()));

  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);

  const useBlackText = settings?.blackTextColorDelivery ?? true;
  const colorMode = settings?.deliveryOrderColorMode || 'pastel';
  
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('deliveryViewMode') || settings?.deliveryViewMode || settings?.deliveryScreenType || 'table';
  });

  const handleViewModeChange = useCallback((newMode) => {
    setViewMode(newMode);
    localStorage.setItem('deliveryViewMode', newMode);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (currentShift?.fechaCaja) {
        const [d, m, y] = currentShift.fechaCaja.split('-').map(Number);
        const shiftDate = new Date(y, m - 1, d);
        setSelectedDate(shiftDate);
    }
  }, [currentShift?.fechaCaja]);

  const loadInitialData = useCallback(async () => {
    try {
      const [fetchedDeliverers, fetchedOptionalGroups, fetchedAccounts] = await Promise.all([
        fetchDeliverers(),
        fetchOptionalGroups(),
        fetchAccounts()
      ]);
      setDeliverers(fetchedDeliverers);
      setOptionalGroups(fetchedOptionalGroups);

      const allMethods = fetchedAccounts.map(acc => acc.nombre).filter(Boolean);
      setPaymentMethods(['Efectivo', ...new Set(allMethods)]);
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar datos iniciales." });
    }
  }, [toast]);

  const loadHrData = useCallback(async () => {
      try {
        const [emp, cat] = await Promise.all([fetchEmployees(), fetchCategories()]);
        setEmployees(emp);
        setCategories(cat);
      } catch (error) {
        console.error("Error loading HR data", error);
      }
  }, []);

  useEffect(() => {
    loadInitialData();
    loadHrData();
  }, [loadInitialData, loadHrData]);

  useEffect(() => {
    if (!isOnline) {
      setLoading(false);
      setSyncStatus('offline');
      return;
    }

    setLoading(true);
    setSyncStatus('syncing');
    
    let syncTimeout;

    const unsubscribe = listenToOrders((fetchedOrders) => {
      if (syncTimeout) clearTimeout(syncTimeout);
      
      syncTimeout = setTimeout(() => {
          syncCache(fetchedOrders).then(() => {
             setSyncStatus('synced');
             refreshStatus();
          });
      }, 500);

      setLoading(false);
    }, (error) => {
      console.error("Firebase connection error:", error);
      setSyncStatus('error');
      toast({ variant: "destructive", title: "Error de conexión", description: "Usando datos en caché (Modo offline)." });
      setLoading(false);
    });

    return () => {
        if (syncTimeout) clearTimeout(syncTimeout);
        unsubscribe();
    };
  }, [refreshKey, isOnline, syncCache, setSyncStatus, refreshStatus, toast]); 

  const forceRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const orders = useMemo(() => {
    const rawOrders = cachedOrders || [];
    const targetDateStr = formatDateForFirebase(selectedDate);
    
    const getDateValue = (dateStr) => {
        if (!dateStr) return 0;
        let d, m, y;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            [y, m, d] = dateStr.split('-').map(Number);
        }
        else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
            [d, m, y] = dateStr.split('-').map(Number);
        }
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
             [d, m, y] = dateStr.split('/').map(Number);
        } else {
             return 0;
        }
        return y * 10000 + m * 100 + d;
    };

    const targetDateValue = getDateValue(targetDateStr);

    let activeDateValue;
    if (currentShift?.fechaCaja) {
        activeDateValue = getDateValue(currentShift.fechaCaja);
    } else {
        const currentOpDate = getOperationalDate(new Date());
        const currentOpDateStr = formatDateForFirebase(currentOpDate);
        activeDateValue = getDateValue(currentOpDateStr);
    }

    const isViewingActiveDate = targetDateValue === activeDateValue;

    return rawOrders.filter(order => {
        const orderDateStr = order.fechacaja || order.date;
        const orderDateValue = getDateValue(orderDateStr);
        
        const isFinished = order.status?.main === 'ENTREGADO' || order.status?.main === 'CANCELADO';
        
        if (orderDateValue === targetDateValue) {
             if (isFinished && !showFinished) return false;
             return true;
        }

        if (isViewingActiveDate && orderDateValue < targetDateValue && !isFinished) {
            return true;
        }

        return false;
    });
  }, [cachedOrders, selectedDate, showFinished, currentShift]);

  const deliveryOrders = useMemo(() => {
    return orders.filter(o => o.status?.main === 'EN DELIVERY');
  }, [orders]);

  const assignableOrders = useMemo(() => {
    return orders.filter(o => o.status?.main === 'COMANDADO' || o.status?.main === 'PREPARADO' || o.status?.main === 'EN DELIVERY');
  }, [orders]);

  useDeliveryStatusWhatsApp(orders);

  useEffect(() => {
     if (selectedOrderId && !orders.find(o => o.id === selectedOrderId)) {
         setSelectedOrderId(null);
     }
  }, [orders, selectedOrderId]);

  const handleSelectOrder = useCallback((orderId) => {
    setSelectedOrderId(orderId);
    if (alarmingOrderIds.includes(orderId)) {
      acknowledgeOrder(orderId);
    }
  }, [alarmingOrderIds, acknowledgeOrder]);
  
  const handleDoubleClickOrder = useCallback((orderId) => {
    const order = orders.find(o => o.id === orderId);
    if(order) {
      setOrderToEditClient(order);
      setIsEditClientModalOpen(true);
    }
  }, [orders]);

  const handleDateChange = (e) => {
    if (e.target.value) {
        const [y, m, d] = e.target.value.split('-').map(Number);
        const newDate = new Date(y, m - 1, d);
        setSelectedDate(newDate);
    }
  };

  const handleConfirmClientUpdate = async (updatedData) => {
    if (!orderToEditClient) return false;
    try {
      const newStatusMain = typeof updatedData.status === 'object' ? updatedData.status?.main : updatedData.status;
      if (newStatusMain === 'ENTREGADO') {
        const currentStatus = orderToEditClient.status?.main;
        // Validate against the NEW delivery type being saved (RETIRO bypasses the EN DELIVERY requirement)
        const validation = validateStatusChange(currentStatus, 'ENTREGADO', updatedData.type ?? orderToEditClient.type);
        if (!validation.isValid) {
          console.warn(`[Audit] Attempted to deliver order ${orderToEditClient.id} with status ${currentStatus}`);
          toast({ variant: "destructive", title: "Acción no permitida", description: validation.message });
          return false;
        }
      }

      const payload = {
        client: updatedData.client,
        payment: {
          ...orderToEditClient.payment, 
          ...updatedData.payment,     
        },
        observation: updatedData.observation,
        type: updatedData.type,
        heladera: updatedData.heladera
      };

      if (updatedData.status) {
          payload.status = updatedData.status;
      }

      if (updatedData.specialDiscount) {
          payload.specialDiscount = updatedData.specialDiscount;
      } else {
          payload.specialDiscount = null;
      }

      if (typeof payload.payment.total === 'undefined' || payload.payment.total === null) {
          payload.payment.total = payload.payment.amount || 0;
      }
      
      if (updatedData.payment && updatedData.payment.montoAbonado !== undefined) {
          payload.payment.montoAbonado = updatedData.payment.montoAbonado;
          payload.payment.paysWith = updatedData.payment.montoAbonado;
      }
      
      optimisticUpdate(orderToEditClient.id, payload);
      await updateOrder(orderToEditClient.id, payload, currentShift);
  
      toast({
        title: "Pedido actualizado",
        description: "Los datos del pedido han sido modificados."
      });
      setIsEditClientModalOpen(false);
      setOrderToEditClient(null);
      return true;
    } catch (error) {
       toast({
        variant: "destructive",
        title: "Error de Firebase",
        description: error.message
      });
      return false;
    }
  };

  const handleTimeChange = async (newDate, newTime) => {
    if (!selectedOrder) return;
    try {
        let fechacaja = newDate;
        
        if (/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
             const [y, m, d] = newDate.split('-');
             fechacaja = `${d}-${m}-${y}`;
        }
        else if (/^\d{2}\/\d{2}\/\d{4}$/.test(newDate)) {
             const [d, m, y] = newDate.split('/');
             fechacaja = `${d}-${m}-${y}`;
        }

        const payload = {
            date: newDate,
            hora: newTime,
            fechacaja: fechacaja 
        };
        
        optimisticUpdate(selectedOrder.id, payload);
        await updateOrder(selectedOrder.id, payload, currentShift);
        
        toast({ title: "Actualizado", description: "Fecha y hora del pedido actualizadas." });
    } catch (e) {
        console.error(e);
        toast({ variant: "destructive", title: "Error", description: "No se pudo actualizar." });
    }
  };
  
  const handleToggleHeladera = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status?.main !== 'COMANDADO') {
       toast({ 
          variant: "destructive",
          title: "Acción no permitida", 
          description: "Solo los pedidos en estado COMANDADO pueden guardarse en heladera." 
       });
       return;
    }
    
    const currentHeladera = order.heladera || 'NO';
    const newHeladera = currentHeladera === 'SI' || currentHeladera === true ? 'NO' : 'SI';
    
    try {
      optimisticUpdate(orderId, { heladera: newHeladera });
      await updateOrder(orderId, { heladera: newHeladera }, currentShift);
      toast({ 
        title: "Estado actualizado", 
        description: `El pedido ${newHeladera === 'SI' ? 'ha sido guardado en la heladera' : 'ha sido retirado de la heladera'}.`,
        variant: "default"
      });
    } catch (error) {
      console.error("Error toggling heladera status:", error);
      toast({ 
        variant: "destructive", 
        title: "Error", 
        description: "No se pudo actualizar el estado de la heladera." 
      });
    }
  };

  const handleOrderCreatedWithSelection = (newOrderId) => {
    // No-op
  };

  const handleQRScanSuccess = async (orderToProcess) => {
    if (!orderToProcess) return;

    if (orderToProcess.status?.main !== 'EN DELIVERY' && orderToProcess.type !== 'RETIRO') {
      console.warn(`[Audit] Attempted to deliver order ${orderToProcess.id} with status ${orderToProcess.status?.main}`);
      toast({ variant: "destructive", title: "Acción no permitida", description: "Solo pedidos EN DELIVERY pueden marcarse como ENTREGADO" });
      return;
    }

    try {
      const now = new Date();
      const deliveredTime = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const dataToUpdate = {
        'status/main': 'ENTREGADO',
        heladera: 'NO', 
        fechacaja: currentShift?.fechaCaja || orderToProcess.fechacaja,
        turno: currentShift?.id || orderToProcess.turno,
        'times/delivered': deliveredTime
      };
      
      if (optimisticUpdate) {
          optimisticUpdate(orderToProcess.id, dataToUpdate);
      }

      const result = await updateOrder(orderToProcess.id, dataToUpdate, currentShift);

      if (result?.stockResult) {
          if (result.stockResult.success) {
               toast({ 
                 title: "Pedido Entregado", 
                 description: "Stock descontado correctamente.", 
                 className: "bg-green-500 text-white" 
               });
          } else {
               toast({ 
                 variant: "destructive", 
                 title: "Atención: Error de Stock", 
                 description: `El pedido se entregó pero hubo un error de stock: ${result.stockResult.error}` 
               });
          }
      } else {
          toast({ 
            title: "Pedido Entregado", 
            description: `Pedido #${orderToProcess.id} marcado como entregado.`, 
            className: "bg-green-500 text-white" 
          });
      }
    } catch (error) {
      console.error("QR Delivery Error:", error);
      toast({
        variant: "destructive",
        title: "Atención",
        description: `Hubo un error al actualizar el pedido: ${error.message}`,
      });
    }
  };

  const handleSelectDelivererForQR = (deliverer) => {
    setSelectedDelivererForQR(deliverer);
    setShowQRAssignDelivererModal(false);
    setIsQRScannerOpen(true);
  };

  const handleQRScanAssignSuccess = async (orderToProcess, deliverer) => {
    if (!orderToProcess || !deliverer) return;
    try {
      const payload = {
        deliverer: deliverer,
        'status/main': 'EN DELIVERY'
      };
      
      if (optimisticUpdate) {
          optimisticUpdate(orderToProcess.id, payload);
      }

      await updateOrder(orderToProcess.id, payload, currentShift);

      toast({ 
        title: "Pedido Asignado", 
        description: `Pedido #${orderToProcess.id} asignado a ${deliverer.nombre}.`, 
        className: "bg-green-50 border-green-200 text-green-800" 
      });
    } catch (error) {
      console.error("QR Assign Error:", error);
      toast({
        variant: "destructive",
        title: "Error de Asignación",
        description: `Hubo un error al asignar el pedido: ${error.message}`,
      });
    }
  };

  const selectedOrder = orders.find(o => o.id === selectedOrderId);

  const {
    processingAction,
    processingOrderId, 
    modalState,
    handleActionClick: originalHandleActionClick,
    handleOrderCreated,
    handleAssignDeliverer,
    handleStatusChange,
    handleConfirmSplitPayment,
    setModalState,
    showDeliveredConfirmation,
    setShowDeliveredConfirmation,
    handleConfirmDelivered,
    handleCancelDelivered
  } = useDeliveryActions({ 
    selectedOrderId, 
    selectedOrder, 
    orders, 
    deliverers, 
    optionalGroups, 
    settings, 
    currentShift, 
    onOrderCreated: handleOrderCreatedWithSelection, 
    setSelectedOrderId,
    optimisticUpdate,
    invalidateDelivererCache 
  });

  const handleActionClick = async (actionId) => {
    if (actionId === 'search') {
      setIsSearchModalOpen(true);
      return;
    }
    if (actionId === 'qrAssign') {
      setShowQRAssignDelivererModal(true);
      return;
    }
    if (actionId === 'whatsapp') {
      if (!selectedOrder) {
        toast({
          variant: "destructive",
          title: "Atención",
          description: "Selecciona un pedido para enviar un mensaje."
        });
        return;
      }
      
      try {
        const phone = selectedOrder.client?.phone || selectedOrder.client?.telefono || '';

        if (!phone) {
          toast({
            variant: "destructive",
            title: "Sin teléfono",
            description: "El cliente no tiene un teléfono registrado."
          });
          return;
        }

        // El texto sale de Configuración → Configuración web → Mensaje de WhatsApp
        // (settings.web.whatsappMessage). Si está vacío, el helper usa el fallback.
        // Alias y titular salen de la cuenta favorita (CUENTAS: alias / aNombreDe).
        const { alias, titular } = await fetchFavoriteAccountInfo();
        const message = buildPaymentWhatsAppMessage({
          order: selectedOrder,
          template: settings?.web?.whatsappMessage || '',
          alias,
          titular,
        });

        const pref = settings?.whatsappPreference || 'web';
        openWhatsApp(phone, message, pref);

      } catch (error) {
        console.error("Error generando WhatsApp:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudo generar el mensaje de WhatsApp."
        });
      }
      return; 
    }
    
    // Fallback for all other actions to original hook
    originalHandleActionClick(actionId);
  };

  const handleAssignDelivererWithRefresh = async (deliverer, sendWhatsApp) => {
    try {
       if (selectedOrderId) {
           optimisticUpdate(selectedOrderId, {
               deliverer: deliverer
           });
       }
       await handleAssignDeliverer(deliverer, sendWhatsApp);
    } catch (e) {
       console.error("[DeliveryTab] ❌ Error in wrapped assignment:", e);
       throw e; 
    }
  };

  const renderSyncStatus = () => {
    if (syncStatus === 'offline') {
        return <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-md text-xs font-medium text-gray-500" title="Trabajando sin conexión (Caché)"><CloudOff className="w-3 h-3"/> Offline</div>;
    }
    if (syncStatus === 'syncing') {
        return <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-md text-xs font-medium text-blue-600 animate-pulse" title="Sincronizando con base de datos..."><Loader2 className="w-3 h-3 animate-spin"/> Syncing...</div>;
    }
    if (syncStatus === 'synced') {
        return <div className="flex items-center gap-1 px-2 py-1 bg-green-50 rounded-md text-xs font-medium text-green-600" title="Datos actualizados"><CheckCircle2 className="w-3 h-3"/> Synced</div>;
    }
    return <div className="flex items-center gap-1 px-2 py-1 bg-red-50 rounded-md text-xs font-medium text-red-600"><Cloud className="w-3 h-3"/> Error</div>;
  };

  if ((loading || isCacheLoading) && cachedOrders.length === 0) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-4 text-gray-600">Cargando datos...</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full space-x-4">
        <div className="flex-grow flex flex-col min-h-0">
          <div className="flex items-center justify-between p-2 bg-white border-b shadow-sm z-10 rounded-t-lg">
             <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-700 px-2">Pedidos</h2>
                    {renderSyncStatus()}
                </div>
                
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

                <div className="flex items-center bg-gray-50 border rounded-md px-2 py-1">
                    <CalendarIcon className="h-4 w-4 text-gray-500 mr-2" />
                    <input 
                        type="date" 
                        className="bg-transparent text-sm border-none focus:ring-0 text-gray-700 outline-none h-6 w-32"
                        value={format(selectedDate, 'yyyy-MM-dd')}
                        onChange={handleDateChange}
                    />
                </div>
                <div className="flex items-center space-x-2 border-l pl-4 border-gray-200">
                    <Checkbox 
                        id="showFinished" 
                        checked={showFinished} 
                        onCheckedChange={setShowFinished}
                    />
                    <label 
                        htmlFor="showFinished" 
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-600 cursor-pointer"
                    >
                        Mostrar finalizados
                    </label>
                </div>
                
                <div className="flex items-center space-x-2 border-l pl-4 border-gray-200">
                  <span className={cn("text-xs font-bold transition-colors", viewMode === 'table' ? "text-primary" : "text-gray-400")}>Lista</span>
                  <Switch 
                    checked={viewMode === 'grid'} 
                    onCheckedChange={(c) => handleViewModeChange(c ? 'grid' : 'table')}
                    className="data-[state=checked]:bg-primary scale-90"
                  />
                  <span className={cn("text-xs font-bold transition-colors", viewMode === 'grid' ? "text-primary" : "text-gray-400")}>Cuadrícula</span>
                </div>
             </div>
             
             <div className="flex gap-2">
                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={forceRefresh}
                    title="Sincronizar pedidos"
                    className="h-9 w-9 text-gray-500 hover:text-primary hover:bg-primary/10"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setIsChangeTimeModalOpen(true)}
                    disabled={!selectedOrderId}
                    className="flex items-center gap-2 text-cyan-700 hover:text-cyan-800 hover:bg-cyan-50"
                >
                    <CalendarClock className="h-4 w-4" />
                    Cambiar Fecha/Hora
                </Button>
             </div>
          </div>
          <ScrollArea className="flex-1 bg-gray-50/50 p-2">
            {viewMode === 'grid' || viewMode === 'cuadrilla' ? (
              <DeliveryGridView
                orders={orders}
                selectedOrderId={selectedOrderId}
                processingOrderId={processingOrderId}
                onSelectOrder={handleSelectOrder}
                onDoubleClickOrder={handleDoubleClickOrder}
                alarmingOrderIds={alarmingOrderIds}
                useBlackText={useBlackText}
                colorMode={colorMode}
                settings={settings}
              />
            ) : (
              <DeliveryOrderTable
                orders={orders}
                selectedOrderId={selectedOrderId}
                processingOrderId={processingOrderId} 
                onSelectOrder={handleSelectOrder}
                onDoubleClickOrder={handleDoubleClickOrder}
                alarmingOrderIds={alarmingOrderIds}
                useBlackText={useBlackText}
                colorMode={colorMode}
              />
            )}
          </ScrollArea>
        </div>
        <DeliveryActionBar
          onActionClick={handleActionClick}
          onToggleHeladera={handleToggleHeladera}
          onAssignDeliverer={() => setModalState('assignDeliverer', true)}
          onDelivererReturn={() => setModalState('delivererReturns', true)}
          onQRScannerOpen={() => setIsQRScannerOpen(true)}
          onQRAssignDeliverer={() => setShowQRAssignDelivererModal(true)}
          processingAction={processingAction}
          selectedOrderId={selectedOrderId}
          selectedOrder={selectedOrder}
          currentShift={currentShift}
          hasDeliverers={deliverers.length > 0}
          hasOrders={orders.length > 0}
        />
      </div>

      <SearchOrderModal 
        isOpen={isSearchModalOpen}
        onOpenChange={setIsSearchModalOpen}
      />

      <QRAssignDelivererModal
        isOpen={showQRAssignDelivererModal}
        onClose={() => setShowQRAssignDelivererModal(false)}
        onSelectDeliverer={handleSelectDelivererForQR}
      />

      <QRScannerModal
        isOpen={isQRScannerOpen}
        onClose={() => setIsQRScannerOpen(false)}
        deliveryOrders={deliveryOrders}
        assignableOrders={assignableOrders}
        onOrderDelivered={handleQRScanSuccess}
        onAssignDelivererClick={() => setShowQRAssignDelivererModal(true)}
        selectedDeliverer={selectedDelivererForQR}
        onOrderAssigned={(orderToProcess) => handleQRScanAssignSuccess(orderToProcess, selectedDelivererForQR)}
      />

      <NewOrderModal 
        isOpen={modalState.newOrder || modalState.modifyOrder}
        isEditing={modalState.modifyOrder}
        orderToEdit={modalState.modifyOrder ? selectedOrder : null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setModalState('newOrder', false);
            setModalState('modifyOrder', false);
          }
        }}
        onOrderCreated={handleOrderCreated}
        context={context}
        currentShift={currentShift}
        settings={settings}
      />
      
      <AssignDelivererModal
        isOpen={modalState.assignDeliverer}
        onOpenChange={(isOpen) => setModalState('assignDeliverer', isOpen)}
        deliverers={deliverers}
        onAssign={handleAssignDelivererWithRefresh}
        order={selectedOrder}
        currentShift={currentShift}
      />
      
      <SplitPaymentModal
        isOpen={modalState.splitPayment}
        onOpenChange={(isOpen) => setModalState('splitPayment', isOpen)}
        order={selectedOrder}
        onConfirm={handleConfirmSplitPayment}
        paymentMethods={paymentMethods}
      />
      <ChangeStatusModal
        isOpen={modalState.changeStatus}
        onOpenChange={(isOpen) => setModalState('changeStatus', isOpen)}
        currentStatus={selectedOrder?.status?.main}
        onSubmit={handleStatusChange}
      />
      
      <DelivererReturnModal
        isOpen={modalState.delivererReturns}
        onOpenChange={(isOpen) => setModalState('delivererReturns', isOpen)}
        orders={orders}
        deliverers={deliverers}
        currentShift={currentShift}
      />

      {orderToEditClient && (
        <OrderDetailModal
          isOpen={isEditClientModalOpen}
          onOpenChange={setIsEditClientModalOpen}
          orderData={orderToEditClient}
          onConfirm={handleConfirmClientUpdate}
          allowedPaymentMethods={paymentMethods}
          employees={employees}
          currentShift={currentShift}
        />
      )}

      {selectedOrder && (
        <ChangeDeliveryTimeModal
            isOpen={isChangeTimeModalOpen}
            order={selectedOrder}
            onOpenChange={setIsChangeTimeModalOpen}
            onConfirm={handleTimeChange}
        />
      )}

      <AlertDialog open={showDeliveredConfirmation} onOpenChange={setShowDeliveredConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar Pedido Entregado?</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Está seguro de marcar el pedido #{selectedOrderId} como "Entregado"? Esta acción registrará la venta y descontará el stock.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelivered}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelivered}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OutOfStockModal 
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        outOfStockArticles={outOfStockArticles}
        outOfStockRawMaterials={outOfStockRawMaterials}
        lowStockArticles={lowStockRawMaterials}
        lastUpdated={lastUpdated}
        localId={localId}
        departments={[]}
      />
    </>
  );
}

export default DeliveryTab;