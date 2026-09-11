import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { User, QrCode, RefreshCw, CheckCircle2, Box } from 'lucide-react';
import QROrderScannerForDelivery from './QROrderScannerForDelivery';
import { useQROrderAssignment } from '@/hooks/useQROrderAssignment';
import { extractOrderDataForWhatsApp } from '@/lib/api/ordersApi';
import { generateEnDeliveryWhatsAppMessage } from '@/lib/whatsapp/deliveryMessageFormatter';
import { openWhatsAppWithMessage } from '@/lib/whatsapp/whatsappHandler';
import { fetchSettings } from '@/lib/api/settingsApi';
import { markWaSent } from '@/lib/whatsapp/waTracker';

export default function QRDelivererAssignmentFlow({ isOpen, onClose, currentShift, optimisticUpdate, initialDeliverer, onChangeDeliverer }) {
  const [assignedDeliverer, setAssignedDeliverer] = useState(null);
  const [assignedOrders, setAssignedOrders] = useState([]);
  const [lastScannedOrder, setLastScannedOrder] = useState(null);
  const [settings, setSettings] = useState(null);
  const [scannerState, setScannerState] = useState('scanning');
  
  const { assignOrder, isAssigning } = useQROrderAssignment(currentShift, optimisticUpdate);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && initialDeliverer) {
      setAssignedDeliverer(initialDeliverer);
      fetchSettings().then(setSettings).catch(console.error);
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

        // Marcar YA, antes del setTimeout de abajo: assignOrder() (arriba) ya
        // escribió el pedido como EN DELIVERY, que es lo que el hook automático
        // (useDeliveryStatusWhatsApp) está escuchando. El setTimeout de 1000ms
        // que sigue es pura espera de UI (mostrar la animación "abriendo
        // WhatsApp...") — sin esta marca, ese segundo entero le daba tiempo de
        // sobra al hook automático para disparar su propio envío antes de que
        // este flujo llegara a generar su mensaje, duplicando el texto en
        // WhatsApp (mismo bug que en AssignDelivererModal.jsx).
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
                      <User className="w-5 h-5 text-primary" />
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
                  <Badge variant="secondary" className="text-lg px-3 bg-primary/10 text-primary hover:bg-primary/20">
                    {assignedOrders.length}
                  </Badge>
                </div>

                <div className="flex-1 w-full flex flex-col items-center justify-center">
                  <h3 className="text-center font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-primary animate-pulse" />
                    Escanea números de pedido
                  </h3>
                  
                  <QROrderScannerForDelivery 
                    onScan={handleScanOrder} 
                    isProcessing={isAssigning} 
                    scannerState={scannerState}
                    onResumeScanning={handleResumeScanning}
                  />
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