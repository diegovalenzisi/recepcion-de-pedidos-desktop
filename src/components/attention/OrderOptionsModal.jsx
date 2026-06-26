import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Gift, Trophy, ThumbsDown, UserCog, X, CheckCircle2 } from 'lucide-react';

const OrderOptionsModal = ({ isOpen, onOpenChange, order, onSelectOption }) => {
  const [selectedSpecial, setSelectedSpecial] = useState(null);

  // Reset selection when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedSpecial(null);
    }
  }, [isOpen]);

  if (!order) return null;

  const handleSpecialToggle = (type) => {
    setSelectedSpecial(prev => prev === type ? null : type);
  };

  const handleConfirm = () => {
    if (selectedSpecial) {
      onSelectOption(selectedSpecial);
    }
  };

  const options = [
    { id: 'Sorteo', label: 'Sorteo', icon: Trophy, color: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
    { id: 'Regalo', label: 'Regalo', icon: Gift, color: 'text-pink-600', bgColor: 'bg-pink-50', borderColor: 'border-pink-200' },
    { id: 'Mal Armado', label: 'Mal Armado', icon: ThumbsDown, color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white border-0 shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-xl font-bold text-slate-800 flex items-center gap-2">
            Opciones del Pedido #{order.id}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            Seleccione una categoría especial o edite los datos básicos.
          </DialogDescription>
        </DialogHeader>
        
        <div className="p-6 space-y-6">
          {/* Special Categories with Radio-like Checkbox behavior */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Categoría Especial</h4>
            <div className="grid grid-cols-1 gap-2">
              {options.map((option) => (
                <div 
                  key={option.id}
                  onClick={() => handleSpecialToggle(option.id)}
                  className={`
                    flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all
                    ${selectedSpecial === option.id 
                      ? `${option.bgColor} ${option.borderColor} shadow-sm` 
                      : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${selectedSpecial === option.id ? 'bg-white shadow-sm' : 'bg-slate-100'}`}>
                      <option.icon className={`w-5 h-5 ${option.color}`} />
                    </div>
                    <Label className="font-bold text-slate-700 cursor-pointer">{option.label}</Label>
                  </div>
                  <Checkbox 
                    checked={selectedSpecial === option.id}
                    onCheckedChange={() => handleSpecialToggle(option.id)}
                    className="h-5 w-5 rounded-full"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
             <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Acciones de Edición</h4>
             <Button 
              variant="outline" 
              className="w-full h-12 justify-start px-4 text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-100"
              onClick={() => onSelectOption('edit_client')}
             >
              <UserCog className="w-5 h-5 mr-3" />
              Editar Datos del Cliente
             </Button>
          </div>
        </div>

        <DialogFooter className="p-4 bg-slate-50 border-t flex flex-row sm:justify-between items-center gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-500">
            <X className="w-4 h-4 mr-2" /> Cerrar
          </Button>
          <Button 
            disabled={!selectedSpecial}
            onClick={handleConfirm}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Aplicar Selección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OrderOptionsModal;