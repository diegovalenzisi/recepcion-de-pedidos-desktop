import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Info, AlertCircle } from 'lucide-react';

const ChangeStatusModal = ({ isOpen, onOpenChange, currentStatus, onSubmit }) => {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus || 'ACEPTADO');

  const statusOptions = [
    { value: 'ACEPTADO', label: 'Aceptado' },
    { value: 'COMANDADO', label: 'Comandado' },
    { value: 'EN DELIVERY', label: 'En Delivery' },
    { value: 'CANCELADO', label: 'Cancelado' },
  ];
  
  React.useEffect(() => {
      if (isOpen) {
          setSelectedStatus(currentStatus || 'ACEPTADO');
      }
  }, [isOpen, currentStatus]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedStatus === 'ENTREGADO' && currentStatus !== 'EN DELIVERY') {
      return; // Prevent submission if validation fails
    }
    onSubmit({
        main: selectedStatus,
        sub: selectedStatus === 'COMANDADO' ? 'Esperando confirmación' : undefined
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Cambiar Estado del Pedido</DialogTitle>
          <p className="text-sm text-gray-500 mt-1">Estado actual: <strong className="text-gray-700">{currentStatus}</strong></p>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-4">
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccione un estado" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
                <SelectItem 
                  value="ENTREGADO" 
                  disabled={currentStatus !== 'EN DELIVERY'}
                  className={currentStatus !== 'EN DELIVERY' ? 'opacity-50 cursor-not-allowed' : ''}
                >
                  Entregado
                </SelectItem>
              </SelectContent>
            </Select>
            
            {currentStatus !== 'EN DELIVERY' && (
              <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Solo pedidos EN DELIVERY pueden marcarse como ENTREGADO
              </p>
            )}
            
            {selectedStatus === 'COMANDADO' && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-md flex items-start gap-2 animate-in fade-in zoom-in-95">
                    <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-blue-700">
                        El sub-estado se establecerá automáticamente en <strong>"Esperando confirmación"</strong> al guardar los cambios.
                    </p>
                </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={selectedStatus === 'ENTREGADO' && currentStatus !== 'EN DELIVERY'}
            >
              Guardar Cambios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeStatusModal;