import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { savePromotion, updatePromotion } from '@/lib/api/promotionsApi';
import { Loader2 } from 'lucide-react';

const DAYS_OF_WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export default function CreatePromotionModal({ isOpen, onClose, onSuccess, editPromotion = null }) {
  const [name, setName] = useState('');
  const [selectedDays, setSelectedDays] = useState([]);
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      if (editPromotion) {
        setName(editPromotion.name || '');
        setSelectedDays(editPromotion.days || []);
        setIsActive(editPromotion.status === 'active');
      } else {
        setName('');
        setSelectedDays([]);
        setIsActive(true);
      }
    }
  }, [isOpen, editPromotion]);

  const handleDayToggle = (day) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'El nombre es requerido' });
      return;
    }
    if (selectedDays.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona al menos un día' });
      return;
    }

    setIsSaving(true);
    try {
      const promoData = {
        name: name.trim(),
        days: selectedDays,
        status: isActive ? 'active' : 'inactive'
      };

      if (editPromotion) {
        await updatePromotion(editPromotion.id, promoData);
        toast({ title: 'Éxito', description: 'Promoción actualizada correctamente' });
      } else {
        await savePromotion(promoData);
        toast({ title: 'Éxito', description: 'Promoción creada correctamente' });
      }
      onSuccess();
      onClose();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error de validación', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editPromotion ? 'Editar Promoción' : 'Crear Nueva Promoción'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="promo-name">Nombre de la Promoción</Label>
            <Input
              id="promo-name"
              placeholder="Ej: Lunes de Descuentos"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Días de Aplicación</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`day-${day}`} 
                    checked={selectedDays.includes(day)}
                    onCheckedChange={() => handleDayToggle(day)}
                  />
                  <Label htmlFor={`day-${day}`} className="cursor-pointer">{day}</Label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-2 mt-4 pt-4 border-t">
            <Checkbox 
              id="promo-active" 
              checked={isActive}
              onCheckedChange={setIsActive}
            />
            <Label htmlFor="promo-active" className="cursor-pointer font-medium">Promoción Activa</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}