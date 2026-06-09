import { useState, useCallback } from 'react';
import { updateOrder, fetchOrders } from '@/lib/api/ordersApi';
import { useToast } from '@/components/ui/use-toast';

export function useQROrderAssignment(currentShift, optimisticUpdate) {
  const [isAssigning, setIsAssigning] = useState(false);
  const { toast } = useToast();

  const assignOrder = useCallback(async (orderId, deliverer) => {
    if (!orderId || !deliverer) {
      throw new Error('Faltan datos de pedido o repartidor.');
    }

    setIsAssigning(true);
    try {
      // Fetch orders to validate
      const orders = await fetchOrders();
      const order = orders.find(o => String(o.id) === String(orderId));

      if (!order) {
        throw new Error(`El pedido #${orderId} no existe.`);
      }

      if (order.status?.main === 'ENTREGADO') {
        throw new Error(`El pedido #${orderId} ya fue entregado.`);
      }

      if (order.status?.main === 'EN DELIVERY') {
        throw new Error(`El pedido #${orderId} ya está en delivery.`);
      }

      if (order.status?.main !== 'COMANDADO' && order.status?.main !== 'PREPARADO' && order.status?.main !== 'ACEPTADO') {
        throw new Error(`El pedido #${orderId} no está listo para asignación (Estado: ${order.status?.main}).`);
      }

      const delivererName = `${deliverer.nombre} ${deliverer.apellido || ''}`.trim();
      const now = new Date();
      const assignmentTime = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const updates = {
        deliverer: delivererName,
        repartidor: delivererName,
        heladera: 'NO',
        'status/main': 'EN DELIVERY',
        'status/sub': delivererName,
        'status/acknowledged': true,
        'times/assignment': assignmentTime
      };

      const updatedOrder = {
        ...order,
        deliverer: { nombre: delivererName, name: delivererName },
        repartidor: delivererName,
        heladera: 'NO',
        status: {
          ...order.status,
          main: 'EN DELIVERY',
          sub: delivererName,
          acknowledged: true
        },
        times: {
          ...order.times,
          assignment: assignmentTime
        }
      };

      if (optimisticUpdate) {
        optimisticUpdate(orderId, updatedOrder);
      }

      await updateOrder(order.id, updates, currentShift);

      return { success: true, order: updatedOrder };
    } catch (error) {
      console.error('Error assigning order via QR:', error);
      throw error;
    } finally {
      setIsAssigning(false);
    }
  }, [currentShift, optimisticUpdate]);

  return { assignOrder, isAssigning };
}