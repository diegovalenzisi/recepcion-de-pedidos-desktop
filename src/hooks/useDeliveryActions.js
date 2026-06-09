import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { updateOrder } from '@/lib/api/ordersApi';
import { printCommand } from '@/lib/print.js';
import { useAccounts } from '@/contexts/AccountsContext';

const useDeliveryActions = ({ 
  selectedOrderId, 
  selectedOrder, 
  orders, 
  deliverers, 
  optionalGroups, 
  settings, 
  currentShift, 
  onOrderCreated: onOrderCreatedCallback, 
  setSelectedOrderId,
  optimisticUpdate,
  invalidateDelivererCache 
}) => {
  const { toast } = useToast();
  const [processingAction, setProcessingAction] = useState('none');
  const [processingOrderId, setProcessingOrderId] = useState(null);
  const [modalState, setModalState] = useState({
    newOrder: false,
    modifyOrder: false,
    assignDeliverer: false,
    splitPayment: false,
    changeStatus: false,
    delivererReturns: false, 
  });
  const [showDeliveredConfirmation, setShowDeliveredConfirmation] = useState(false);
  const { favoriteAccount } = useAccounts();

  const setModalOpen = (modal, isOpen) => {
    setModalState(prev => ({ ...prev, [modal]: isOpen }));
  };

  const clearProcessingState = useCallback(() => {
    setProcessingAction('none');
    setProcessingOrderId(null);
  }, []);

  const handleDelivered = async (payments) => {
    if (!selectedOrderId) {
      toast({ variant: 'destructive', title: 'Ningún pedido seleccionado' });
      return;
    }

    setProcessingAction('delivered');
    setProcessingOrderId(selectedOrderId);

    const orderToProcess = orders.find(o => o.id === selectedOrderId);
    if (!orderToProcess) {
      clearProcessingState();
      return;
    }

    const currentIndex = orders.findIndex(o => o.id === selectedOrderId);

    try {
      const now = new Date();
      const deliveredTime = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const dataToUpdate = {
        'status/main': 'ENTREGADO',
        heladera: 'NO', // Reset heladera when status changes from COMANDADO
        payment: {
          ...orderToProcess.payment,
          method: payments ? 'Pago Dividido' : orderToProcess.payment.method,
          payments: payments || null,
        },
        fechacaja: currentShift.fechaCaja,
        turno: currentShift.id,
        'times/delivered': deliveredTime
      };
      
      if (optimisticUpdate) {
          optimisticUpdate(selectedOrderId, dataToUpdate);
      }

      const result = await updateOrder(selectedOrderId, dataToUpdate, currentShift);

      if (result.stockResult) {
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
            description: "Estado actualizado.", 
            className: "bg-green-500 text-white" 
          });
      }

      if (currentIndex > 0) {
        setSelectedOrderId(orders[currentIndex - 1].id);
      } else if (orders.length > 1) {
        setSelectedOrderId(orders[1].id);
      } else {
        setSelectedOrderId(null);
      }

    } catch (error) {
      console.error("Delivery Error:", error);
      toast({
        variant: "destructive",
        title: "Atención",
        description: `Hubo un error al actualizar el pedido: ${error.message}`,
      });
    } finally {
      clearProcessingState();
      setShowDeliveredConfirmation(false);
    }
  };

  const handleConfirmDelivered = () => {
    handleDelivered();
  };
  
  const handleCancelDelivered = () => {
    setShowDeliveredConfirmation(false);
    clearProcessingState();
  };

  const handleCommand = async () => {
    if (!selectedOrderId) return;
    const orderToCommand = orders.find(o => o.id === selectedOrderId);
    if (!orderToCommand) return;

    setProcessingAction('command');
    setProcessingOrderId(selectedOrderId);

    try {
      const updates = { 
        'status/main': 'COMANDADO', 
        'status/sub': 'Esperando confirmación', 
        'status/acknowledged': true 
      };
      
      if (optimisticUpdate) {
        optimisticUpdate(selectedOrderId, updates);
      }
      
      await updateOrder(selectedOrderId, updates);
      printCommand(orderToCommand, optionalGroups);
      
      toast({
        title: "¡Comandado!",
        description: `El pedido #${selectedOrderId} se envió a la cocina y se imprimió.`,
        className: "bg-orange-500 text-white"
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Error al comandar", description: "No se pudo actualizar el estado del pedido." });
    } finally {
      clearProcessingState();
    }
  };

  const handleActionClick = useCallback(async (actionId) => {
    if (processingAction === actionId) return;

    if (!selectedOrderId && !['new_order', 'refresh', 'search', 'deliverer_returns'].includes(actionId)) {
      toast({ variant: 'destructive', title: 'Ningún pedido seleccionado' });
      return;
    }
    
    switch (actionId) {
      case 'new_order': 
        setModalOpen('newOrder', true); 
        break;
      case 'edit_order': 
        setModalOpen('modifyOrder', true); 
        break;
      case 'refresh': 
        toast({ title: "Actualizado", description: "La lista se sincroniza en tiempo real." }); 
        break;
      case 'assign_deliverer': 
        setModalOpen('assignDeliverer', true); 
        break;
      case 'command': 
        handleCommand(); 
        break;
      case 'edit_status': 
        setModalOpen('changeStatus', true); 
        break;
      case 'delivered':
        if (selectedOrder?.type === 'ENVIO' && !selectedOrder?.deliverer && !selectedOrder?.repartidor) {
          toast({
            variant: "destructive",
            title: "Acción no permitida",
            description: "No se puede marcar como entregado un pedido de envío sin repartidor asignado.",
          });
        } else {
          setProcessingAction('delivered'); 
          setProcessingOrderId(selectedOrderId);
          setShowDeliveredConfirmation(true);
        }
        break;
      case 'split_payment': 
        setModalOpen('splitPayment', true); 
        break;
      case 'deliverer_returns':
        setModalOpen('delivererReturns', true);
        break;
      case 'whatsapp':
        setProcessingAction('whatsapp');
        setProcessingOrderId(selectedOrderId);
        if (selectedOrder?.client?.phone) {
          const phone = String(selectedOrder.client.phone).replace(/\D/g, '');
          const localName = settings?.nombreFantasia || 'nuestro local';
          const clientName = selectedOrder.client.name || 'Cliente';
          const orderId = selectedOrder.id || 'N/A';
          const totalAmount = selectedOrder.payment.amount.toFixed(2);
          
          try {
            const alias = favoriteAccount?.alias;
            let message;
            if (alias) {
              message = `Hola {nombre del cliente}, te contactamos desde {nombre de fantasia} sobre tu pedido N° {numero de pedido}, te pedimos por favor que transfieras el valor de ${totalAmount} al Alias ${alias} y pasanos el comprobante por este medio. ¡Muchas Gracias!`;
              message = message
                .replace('{nombre del cliente}', clientName)
                .replace('{nombre de fantasia}', localName)
                .replace('{numero de pedido}', orderId)
                .replace('{valor total}', totalAmount)
                .replace('{alias}', alias);
            } else {
              message = settings?.web?.whatsappMessage || `Hola {nombre del cliente}, te contactamos desde {nombre de fantasia} sobre tu pedido N° {numero de pedido}.`;
              message = message
                .replace('{nombre del cliente}', clientName)
                .replace('{nombre de fantasia}', localName)
                .replace('{numero de pedido}', orderId);
            }

            const whatsappUrl = `whatsapp://send?phone=549${phone}&text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');

          } catch (error) {
            toast({ variant: 'destructive', title: 'Error al obtener alias', description: 'No se pudo obtener el alias para el mensaje.' });
          } finally {
            clearProcessingState();
          }
        } else {
          toast({ variant: 'destructive', title: 'No se encontró el teléfono' });
          clearProcessingState();
        }
        break;
      case 'search':
          break;
      default:
        toast({ title: "Función no implementada", description: `🚧 La acción "${actionId}" aún no está disponible.` });
    }
  }, [selectedOrderId, selectedOrder, orders, favoriteAccount, settings, toast, processingAction, clearProcessingState]);

  const handleOrderCreated = (newOrderId) => {
    setModalOpen('newOrder', false);
    setModalOpen('modifyOrder', false);
    if (newOrderId && onOrderCreatedCallback) {
      onOrderCreatedCallback(newOrderId);
    }
  };
  
  const handleAssignDeliverer = async (deliverer, sendWhatsApp) => {
    if (!selectedOrderId || !deliverer) return;
    
    setProcessingAction('assign_deliverer');
    setProcessingOrderId(selectedOrderId);
    
    if (invalidateDelivererCache) {
        await invalidateDelivererCache(selectedOrderId);
    }

    const delivererName = `${deliverer.nombre} ${deliverer.apellido}`;
    const now = new Date();
    const assignmentTime = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (optimisticUpdate) {
        optimisticUpdate(selectedOrderId, {
            deliverer: delivererName,
            repartidor: delivererName,
            heladera: 'NO', // Reset heladera when assigned
            status: {
                ...(selectedOrder?.status || {}),
                main: 'EN DELIVERY',
                sub: delivererName,
                acknowledged: true
            },
            times: {
                ...(selectedOrder?.times || {}),
                assignment: assignmentTime
            }
        });
    }

    const dataToUpdate = {
        deliverer: delivererName,
        repartidor: delivererName,
        heladera: 'NO',
        'status/main': 'EN DELIVERY',
        'status/sub': `${delivererName}`,
        'status/acknowledged': true,
        'times/assignment': assignmentTime
    };

    try {
        await updateOrder(selectedOrderId, dataToUpdate);
        toast({ title: "Repartidor Asignado", description: `Pedido asignado a ${delivererName}.`, className: "bg-blue-500 text-white" });
        setModalOpen('assignDeliverer', false);
        
        if (sendWhatsApp && selectedOrder?.client?.phone) {
            const phone = String(selectedOrder.client.phone.replace(/\D/g, ''));
            const clientName = selectedOrder?.client?.name || 'Consumidor Final';
            const orderId = selectedOrder?.id || '';
            let defaultMessage = `Hola ${clientName}, tu pedido N°${orderId} te lo esta por llevar ${delivererName}, por favor estate Atento.`;
            const customMessage = settings?.web?.assignDelivererMessage;
            if (customMessage) {
              defaultMessage += ` ${customMessage}`;
            }
            const whatsappUrl = `whatsapp://send?phone=549${phone}&text=${encodeURIComponent(defaultMessage)}`;
            window.open(whatsappUrl, '_blank');
        }
    } catch (error) {
        toast({ variant: "destructive", title: "Error al asignar repartidor" });
    } finally {
        clearProcessingState();
    }
  };

  const handleStatusChange = async (statusData) => {
    const newStatus = typeof statusData === 'string' ? statusData : statusData.main;
    const subStatus = typeof statusData === 'object' ? statusData.sub : undefined;

    if (!selectedOrderId || !newStatus || selectedOrder?.status?.main === newStatus) {
      setModalOpen('changeStatus', false);
      return;
    }
    
    setProcessingAction('edit_status');
    setProcessingOrderId(selectedOrderId);

    try {
        const updates = { 'status/main': newStatus, 'status/acknowledged': true };
        
        if (subStatus) {
            updates['status/sub'] = subStatus;
        } else if (newStatus === 'COMANDADO') {
            updates['status/sub'] = 'Esperando confirmación';
        }
        
        // Reset heladera if status is no longer COMANDADO
        if (newStatus !== 'COMANDADO') {
            updates.heladera = 'NO';
        }

        if (optimisticUpdate) {
            optimisticUpdate(selectedOrderId, updates);
        }

        await updateOrder(selectedOrderId, updates);
        toast({ title: "Estado Actualizado", description: `El pedido cambió a ${newStatus}.`, className: "bg-green-500 text-white" });
        setModalOpen('changeStatus', false);
    } catch (error) {
        toast({ variant: "destructive", title: "Error al cambiar estado" });
    } finally {
        clearProcessingState();
    }
  };

  const handleConfirmSplitPayment = (payments) => {
    setModalOpen('splitPayment', false);
    handleDelivered(payments);
  };

  return {
    processingAction,
    processingOrderId,
    modalState,
    handleActionClick,
    handleOrderCreated,
    handleAssignDeliverer,
    handleStatusChange,
    handleConfirmSplitPayment,
    setModalState,
    showDeliveredConfirmation,
    setShowDeliveredConfirmation,
    handleConfirmDelivered,
    handleCancelDelivered
  };
};

export default useDeliveryActions;