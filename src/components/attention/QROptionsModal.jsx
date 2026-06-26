import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Bike, RotateCcw, QrCode } from 'lucide-react';
import SelectDeliveryPersonModal from './SelectDeliveryPersonModal';
import { useToast } from '@/components/ui/use-toast';

const QROptionsModal = ({ isOpen, onOpenChange, onAssignDeliverer, onQRScannerOpen, order }) => {
  const [showSelectModal, setShowSelectModal] = useState(false);
  const { toast } = useToast();

  const handleConfirmAssignment = async (deliverer) => {
    try {
      if (onAssignDeliverer) {
        await onAssignDeliverer(deliverer);
      }
    } catch (error) {
      console.error("Error starting assignment flow:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Error al iniciar asignación de repartidor.",
      });
    } finally {
      setShowSelectModal(false);
      onOpenChange(false);
    }
  };

  const handleCancelAssignment = () => {
    setShowSelectModal(false);
  };

  return (
    <>
      <Dialog open={isOpen && !showSelectModal} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-primary" />
              Opciones de Código QR
            </DialogTitle>
            <DialogDescription>
              Seleccione la acción que desea realizar utilizando el lector de código QR.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button 
              className="h-14 justify-start px-6 text-base bg-white hover:bg-blue-50 border-gray-200" 
              variant="outline"
              onClick={() => {
                setShowSelectModal(true);
              }}
            >
              <Bike className="w-5 h-5 mr-3 text-blue-600" />
              <div className="flex flex-col items-start">
                <span className="font-semibold text-gray-800">Asignar Repartidor</span>
                <span className="text-[10px] text-gray-500 font-normal">Escanee QR para asignar pedido</span>
              </div>
            </Button>
            <Button 
              className="h-14 justify-start px-6 text-base bg-white hover:bg-orange-50 border-gray-200" 
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                if (onQRScannerOpen) onQRScannerOpen();
              }}
            >
              <RotateCcw className="w-5 h-5 mr-3 text-orange-600" />
              <div className="flex flex-col items-start">
                <span className="font-semibold text-gray-800">Tomar Rendiciones</span>
                <span className="text-[10px] text-gray-500 font-normal">Escanee QR para rendir pedidos</span>
              </div>
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <SelectDeliveryPersonModal
        isOpen={showSelectModal}
        onConfirm={handleConfirmAssignment}
        onCancel={handleCancelAssignment}
        order={order}
      />
    </>
  );
};

export default QROptionsModal;