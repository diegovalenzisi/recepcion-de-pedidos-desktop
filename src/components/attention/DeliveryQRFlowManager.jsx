import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { User, QrCode, RefreshCw, CheckCircle2, Box, Play } from 'lucide-react';
import QROrderScannerForDelivery from './QROrderScannerForDelivery';
import { useQROrderAssignment } from '@/hooks/useQROrderAssignment';
import { extractOrderDataForWhatsApp } from '@/lib/api/ordersApi';
import { generateEnDeliveryWhatsAppMessage } from '@/lib/whatsapp/deliveryMessageFormatter';
import { openWhatsAppWithMessage } from '@/lib/whatsapp/whatsappHandler';
import { markWaSent } from '@/lib/whatsapp/waTracker';

export default function DeliveryQRFlowManager({ isOpen, onClose, currentShift, optimisticUpdate, initialDeliverer, onChangeDeliverer, settings }) {
  const [assignedDeliverer, setAssignedDeliverer] = useState(null);
  const [assignedOrders, setAssignedOrders] = useState([]);
  const [lastScannedOrder, setLastScannedOrder] = useState(null);
  
  const [scannerState, setScannerState] = useState('scanning'); 

  const { assignOrder, isAssigning } = useQROrderAssignment(currentShift, optimisticUpdate);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && initialDeliverer) {
      setAssignedDeliverer(initialDeliverer);
      setScannerState('scanning');
    }
  }, [isOpen, initialDeliverer]);

  const handleScanOrder = async (orderId) => {
    try {
      const result = await assignOrder(orderId, assignedDeliverer);
      
      if (result.success) {
        setAssignedOrders(prev => [...prev, result.order]);
        setLastScannedOrder(result.order);
        
        toast({
          title: 'Pedido Asignado',
          description: `Pedido #${orderId} asignado a ${assignedDeliverer.nombre}`,
          className: 'bg-green-50 border-green-200 text-green-800'
        });

        setScannerState('opening_whatsapp');

        // Marcar YA, antes del setTimeout de abajo: ver el mismo comentario en
        // QRDelivererAssignmentFlow.jsx. assignOrder() ya escribió el pedido
        // como EN DELIVERY; sin esta marca, el segundo entero de espera de UI
        // que sigue le daba tiempo de sobra al hook automático
        // (useDeliveryStatusWhatsApp) para disparar su propio envío primero y
        // duplicar el texto en WhatsApp.
        markWaSent(result.order.id);

        // Trigger explicit EN DELIVERY WhatsApp message with deliverer name
        setTimeout(async () => {
          try {
            const waData = extractOrderDataForWhatsApp(result.order);
            
            if (waData && waData.clientPhone) {
              // Pass assignedDeliverer explicitly as second parameter
              const msg = await generateEnDeliveryWhatsAppMessage(waData, assignedDeliverer);
              await openWhatsAppWithMessage(waData.clientPhone, msg, settings?.whatsappPreference);
              setScannerState('waiting_return');
            } else {
              toast({ variant: "destructive", title: "Sin teléfono", description: "El pedido no tiene teléfono registrado." });
              setScannerState('scanning');
            }
          } catch (e) {
            console.error("Error triggering WhatsApp:", e);
            setScannerState('scanning');
          }
        }, 1000); 
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al asignar pedido",
        description: error.message
      });
      throw error;
    }
  };

  const handleResumeScanning = () => {
    setScannerState('scanning');
  };

  const handleClose = () => {
    setAssignedDeliverer(null);
    setAssignedOrders([]);
    setLastScannedOrder(null);
    setScannerState('scanning');
    onClose();
  };

  const handleChangeDeliverer = () => {
    setAssignedDeliverer(null);
    setAssignedOrders([]);
    setLastScannedOrder(null);
    setScannerState('scanning');
    onClose();
    if (onChangeDeliverer) {
      onChangeDeliverer();
    }
  };

  const getStatusMessage = () => {
    switch (scannerState) {
      case 'opening_whatsapp': return 'Abriendo WhatsApp...';
      case 'waiting_return': return 'Esperando retorno (toca para continuar)';
      default: return 'Escanea números de pedido';
    }
  };

  const getStatusColor = () => {
    switch (scannerState) {
      case 'opening_whatsapp': return 'text-yellow-600';
      case 'waiting_return': return 'text-gray-500';
      default: return 'text-blue-600';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-gray-50">
        {assignedDeliverer && (
          <div className="flex flex-col h-full max-h-[85vh]">
            <Card className="border-0 shadow-none rounded-none bg-transparent flex-1 flex flex-col">
              <CardHeader className="bg-white border-b pb-4 shrink-0">
                <CardTitle className="flex justify-between items-center text-lg">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground font-normal uppercase tracking-wider mb-1">Repartidor Asignado</span>
                    <div className="flex items-center gap-2">
                      <User className="w-5 h-5 text-blue-600" />
                      <span className="font-bold">{assignedDeliverer.nombre} {assignedDeliverer.apellido || ''}</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleChangeDeliverer} className="gap-2 text-gray-600">
                    <RefreshCw className="w-4 h-4" />
                    Cambiar
                  </Button>
                </CardTitle>
              </CardHeader>
              
              <CardContent className="pt-6 flex-1 flex flex-col items-center">
                <div className="w-full flex justify-between items-center bg-white p-3 rounded-lg border shadow-sm mb-6">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Box className="w-5 h-5" />
                    <span className="font-medium text-sm">Pedidos Asignados:</span>
                  </div>
                  <Badge variant="secondary" className="text-lg px-3 bg-blue-100 text-blue-700 hover:bg-blue-200">
                    {assignedOrders.length}
                  </Badge>
                </div>

                <div className="flex-1 w-full flex flex-col items-center justify-center">
                  <h3 className={`text-center font-medium mb-4 flex items-center gap-2 transition-colors ${getStatusColor()}`}>
                    {scannerState === 'scanning' ? (
                      <QrCode className="w-5 h-5 animate-pulse" />
                    ) : (
                      <Play className="w-5 h-5" />
                    )}
                    {getStatusMessage()}
                  </h3>
                  
                  <QROrderScannerForDelivery 
                    onScan={handleScanOrder} 
                    isProcessing={isAssigning} 
                    scannerState={scannerState}
                    onResumeScanning={handleResumeScanning}
                  />

                  {scannerState === 'waiting_return' && (
                    <Button 
                      onClick={handleResumeScanning} 
                      className="mt-6 w-full max-w-[280px] bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Continuar Escaneando
                    </Button>
                  )}
                </div>

                {lastScannedOrder && (
                  <div className="w-full mt-6 p-3 bg-green-50 text-green-800 rounded-lg border border-green-200 flex justify-between items-center animate-in fade-in slide-in-from-bottom-2">
                    <div>
                      <p className="font-semibold flex items-center gap-2 text-sm">
                         <CheckCircle2 className="w-4 h-4" />
                         Último: #{lastScannedOrder.id}
                      </p>
                      <p className="text-xs opacity-80 mt-0.5 truncate max-w-[200px]">
                        {lastScannedOrder.client?.name || 'Cliente sin nombre'}
                      </p>
                    </div>
                    <Badge className="bg-green-600 hover:bg-green-700 shadow-none border-transparent text-white text-xs">
                      EN DELIVERY
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}