import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchDeliverers } from '@/lib/api/deliverersApi';
import { fetchSettings } from '@/lib/api/settingsApi';
import { Loader2, User, Phone, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { extractOrderDataForWhatsApp } from '@/lib/api/ordersApi';
import { generateEnDeliveryWhatsAppMessage } from '@/lib/whatsapp/deliveryMessageFormatter';
import { openWhatsAppWithMessage } from '@/lib/whatsapp/whatsappHandler';

export default function SelectDeliveryPersonModal({ isOpen, onConfirm, onCancel, order }) {
  const [deliverers, setDeliverers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      loadDeliverers();
      fetchSettings().then(setSettings).catch(console.error);
    }
  }, [isOpen]);

  const loadDeliverers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeliverers();
      const activeDeliverers = data
        .filter(d => !d.estado || d.estado === 'activo' || d.estado === 'Activo')
        .sort((a, b) => {
          const nameA = `${a.nombre} ${a.apellido || ''}`.trim().toLowerCase();
          const nameB = `${b.nombre} ${b.apellido || ''}`.trim().toLowerCase();
          return nameA.localeCompare(nameB);
        });
      
      setDeliverers(activeDeliverers);
    } catch (err) {
      console.error("Error loading deliverers:", err);
      setError("No se pudieron cargar los repartidores.");
      toast({
        variant: "destructive",
        title: "Error de Conexión",
        description: "No se pudieron cargar los repartidores desde la base de datos."
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (deliverer) => {
    if (order) {
      const waData = extractOrderDataForWhatsApp(order);
      
      if (waData && waData.clientPhone) {
        toast({ title: "WhatsApp", description: "Preparando mensaje de envío..." });
        
        // Pass deliverer explicitly as second parameter to ensure name is included
        const msg = await generateEnDeliveryWhatsAppMessage(waData, deliverer);
        openWhatsAppWithMessage(waData.clientPhone, msg, settings?.whatsappPreference);
      }
    }

    if (onConfirm) {
      onConfirm({
        id: deliverer.id,
        legajo: deliverer.legajo || deliverer.id,
        nombre: deliverer.nombre,
        apellido: deliverer.apellido || ''
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <User className="w-6 h-6 text-primary" />
            Asignar Repartidor
          </DialogTitle>
          <DialogDescription>
            {order ? `Seleccione un repartidor para el pedido #${order.id || order.numero}.` : 'Seleccione el repartidor al que se le asignarán los pedidos.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[350px] flex flex-col mt-2">
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm font-medium">Cargando repartidores disponibles...</span>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-destructive gap-3 bg-destructive/10 rounded-lg p-6">
              <AlertCircle className="w-10 h-10" />
              <span className="text-center font-medium">{error}</span>
              <Button variant="outline" onClick={loadDeliverers} className="mt-2 bg-background">
                Reintentar
              </Button>
            </div>
          ) : deliverers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 bg-muted/30 rounded-lg p-6">
              <User className="w-12 h-12 opacity-40" />
              <span className="text-lg font-medium">No hay repartidores disponibles</span>
              <p className="text-sm text-center">Agregue repartidores en la sección de Configuración o RRHH.</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden flex-1 flex flex-col shadow-sm">
              <ScrollArea className="h-[350px] bg-card">
                <Table>
                  <TableHeader className="bg-muted/80 sticky top-0 z-10 backdrop-blur-sm">
                    <TableRow>
                      <TableHead className="font-semibold text-foreground">Nombre del Repartidor</TableHead>
                      <TableHead className="font-semibold text-foreground">Teléfono</TableHead>
                      <TableHead className="w-32 text-center font-semibold text-foreground">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliverers.map(deliverer => (
                      <TableRow 
                        key={deliverer.id} 
                        className="cursor-pointer hover:bg-primary/5 hover:shadow-sm transition-all duration-200 group"
                        onClick={() => handleSelect(deliverer)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                              <User className="w-4 h-4 text-primary" />
                            </div>
                            <span className="text-base">{`${deliverer.nombre} ${deliverer.apellido || ''}`.trim()}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5 opacity-50" />
                            {deliverer.telefono || 'Sin registrar'}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200 shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            Activo
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}