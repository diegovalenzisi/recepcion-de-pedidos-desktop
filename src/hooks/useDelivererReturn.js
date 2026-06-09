import { useState, useMemo, useEffect } from 'react';
import { updateOrder } from '@/lib/api/ordersApi';
import { useToast } from '@/components/ui/use-toast';

export const useDelivererReturn = (orders, deliverers, currentShift, onReturnCompleted) => {
  const [selectedDelivererId, setSelectedDelivererId] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  // Filter orders for the selected deliverer that are "EN DELIVERY"
  const pendingOrders = useMemo(() => {
    if (!selectedDelivererId) return [];

    const deliverer = deliverers.find(d => d.id === selectedDelivererId);
    if (!deliverer) return [];
    
    const delivererName = `${deliverer.nombre} ${deliverer.apellido}`;

    return orders.filter(order => 
      order.deliverer === delivererName && 
      order.status?.main === 'EN DELIVERY'
    );
  }, [orders, selectedDelivererId, deliverers]);

  // Automatically select all orders when deliverer changes
  useEffect(() => {
    if (pendingOrders.length > 0) {
      setSelectedOrderIds(pendingOrders.map(o => o.id));
    } else {
      setSelectedOrderIds([]);
    }
  }, [pendingOrders]);

  const toggleOrderSelection = (orderId) => {
    setSelectedOrderIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId) 
        : [...prev, orderId]
    );
  };

  const totals = useMemo(() => {
    const selected = pendingOrders.filter(o => selectedOrderIds.includes(o.id));
    
    return selected.reduce((acc, order) => {
      const isCash = order.payment?.method === 'Efectivo';
      const orderTotal = order.payment?.total || order.payment?.amount || 0;
      const orderChange = order.payment?.change || 0;
      
      // Formula: total = sum of all payment amounts + sum of all change amounts
      // This represents the total cash/money the deliverer returns with (Value of goods + Change provided originally)
      const totalValueForOrder = orderTotal + orderChange;

      if (isCash) {
        acc.cashTotal += totalValueForOrder;
      } else {
        acc.otherTotal += totalValueForOrder;
      }
      acc.grandTotal += totalValueForOrder;
      acc.count += 1;
      return acc;
    }, { cashTotal: 0, otherTotal: 0, grandTotal: 0, count: 0 });
  }, [pendingOrders, selectedOrderIds]);

  const confirmReturn = async () => {
    if (selectedOrderIds.length === 0) {
        toast({ variant: 'destructive', title: 'Sin selección', description: 'Seleccione al menos un pedido.' });
        return;
    }

    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;

    const now = new Date();
    const deliveredTime = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const updates = selectedOrderIds.map(async (orderId) => {
        try {
            const order = pendingOrders.find(o => o.id === orderId);
            if (!order) return;

            const dataToUpdate = {
                'status/main': 'ENTREGADO',
                'times/delivered': deliveredTime,
                fechacaja: currentShift?.fechaCaja || order.fechacaja, 
            };
            
            await updateOrder(orderId, dataToUpdate, currentShift);
            successCount++;
        } catch (error) {
            console.error(`Failed to return order ${orderId}`, error);
            failCount++;
        }
    });

    await Promise.all(updates);

    setIsProcessing(false);

    if (failCount === 0) {
        toast({ 
            title: 'Rendición Exitosa', 
            description: `Se han procesado ${successCount} pedidos correctamente.`,
            className: 'bg-green-600 text-white'
        });
        if (onReturnCompleted) onReturnCompleted();
    } else {
        toast({ 
            variant: 'destructive', 
            title: 'Rendición Parcial', 
            description: `Se procesaron ${successCount} pedidos. ${failCount} fallaron.` 
        });
    }
  };

  return {
    selectedDelivererId,
    setSelectedDelivererId,
    pendingOrders,
    selectedOrderIds,
    toggleOrderSelection,
    totals,
    confirmReturn,
    isProcessing,
    selectAll: () => setSelectedOrderIds(pendingOrders.map(o => o.id)),
    deselectAll: () => setSelectedOrderIds([])
  };
};