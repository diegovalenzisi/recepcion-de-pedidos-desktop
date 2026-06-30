import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bike, User, Loader2, Search, MessageSquare, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { updateOrder, extractOrderDataForWhatsApp } from '@/lib/api/ordersApi';
import { useToast } from '@/components/ui/use-toast';
import { generateEnDeliveryWhatsAppMessage } from '@/lib/whatsapp/deliveryMessageFormatter';
import { openWhatsAppWithMessage } from '@/lib/whatsapp/whatsappHandler';
import { useWhatsAppPreference } from '@/hooks/useWhatsAppPreference';
import { markWaSent } from '@/lib/whatsapp/waTracker';

function AssignDelivererModal({ isOpen, onOpenChange, deliverers, onAssign, order, currentShift }) {
  const [selectedDelivererId, setSelectedDelivererId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);
  const { toast } = useToast();
  const { preference: waPreference } = useWhatsAppPreference();

  const handleAssign = async () => {
    if (!selectedDelivererId) return;
    setIsAssigning(true);
    const deliverer = deliverers.find(d => d.id === selectedDelivererId);
    
    try {
      if (order?.status?.main === 'EN DELIVERY') {
        await updateOrder(order.id, {
          status: { main: 'ACEPTADO', sub: 'Esperando confirmación' }
        }, currentShift);
        
        await onAssign(deliverer, false, null);
        
        await updateOrder(order.id, {
          status: { main: 'EN DELIVERY', sub: 'En camino' }
        }, currentShift);
      } else {
        await onAssign(deliverer, false, null);
      }

      if (sendWhatsApp && order) {
        const waData = extractOrderDataForWhatsApp(order);
        
        if (waData && waData.clientPhone) {
          toast({ title: "WhatsApp", description: "Preparando mensaje de envío..." });
          
          // Pass deliverer explicitly as second parameter to ensure name is included
          const msg = await generateEnDeliveryWhatsAppMessage(waData, deliverer);
          markWaSent(order.id);
          openWhatsAppWithMessage(waData.clientPhone, msg, waPreference);
        } else {
          toast({ variant: "destructive", title: "Sin teléfono", description: "El pedido no tiene teléfono registrado para WhatsApp." });
        }
      }

      toast({
        title: "Asignación exitosa",
        description: `El pedido fue asignado a ${deliverer.nombre}.`,
      });
      onOpenChange(false);
    } catch (error) {
      console.error(`[AssignDelivererModal] ❌ Error during assignment:`, error);
      toast({
        variant: "destructive",
        title: "Error al asignar",
        description: "Hubo un problema al asignar el repartidor. Por favor intente nuevamente.",
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const filteredDeliverers = deliverers.filter(d => 
    `${d.nombre} ${d.apellido}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar Repartidor</DialogTitle>
          <DialogDescription>Selecciona un repartidor de la lista para asignarlo al pedido.</DialogDescription>
        </DialogHeader>
        <div className="my-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar repartidor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
        </div>
        <ScrollArea className="h-56">
          <div className="p-1 space-y-2">
            {filteredDeliverers.length > 0 ? filteredDeliverers.map(d => (
              <div
                key={d.id}
                onClick={() => setSelectedDelivererId(d.id)}
                className={`flex items-center p-3 rounded-lg cursor-pointer transition-all duration-200 border-2 ${
                  selectedDelivererId === d.id
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-transparent hover:bg-gray-100'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mr-4">
                  <Bike className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800">{d.nombre} {d.apellido}</p>
                  <p className="text-xs text-gray-500">{d.telefono || 'Sin teléfono'}</p>
                </div>
              </div>
            )) : (
              <p className="text-center text-gray-500 py-8">No se encontraron repartidores.</p>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center space-x-2 my-4">
          <Checkbox id="send-whatsapp" checked={sendWhatsApp} onCheckedChange={setSendWhatsApp} />
          <Label htmlFor="send-whatsapp" className="flex items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            <MessageSquare className="h-4 w-4 text-green-600" />
            Enviar WhatsApp al cliente con detalle del pedido
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleAssign} disabled={!selectedDelivererId || isAssigning}>
            {isAssigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <User className="mr-2 h-4 w-4" />}
            {isAssigning ? 'Asignando...' : 'Asignar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssignDelivererModal;