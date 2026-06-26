import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const daysOfWeek = [
  { id: 'lunes', name: 'Lunes' },
  { id: 'martes', name: 'Martes' },
  { id: 'miercoles', name: 'Miércoles' },
  { id: 'jueves', name: 'Jueves' },
  { id: 'viernes', name: 'Viernes' },
  { id: 'sabado', name: 'Sábado' },
  { id: 'domingo', name: 'Domingo' },
];

const initialHoursState = daysOfWeek.reduce((acc, day) => {
  acc[day.id] = [
    { start: '', end: '' },
    { start: '', end: '' },
    { start: '', end: '' },
  ];
  return acc;
}, {});

function HoursSettingsModal({ isOpen, onOpenChange, initialHours, onSave: onSaveHours }) {
  const [hours, setHours] = useState(initialHoursState);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      const validInitialHours = initialHours && typeof initialHours === 'object' ? initialHours : {};
      const mergedHours = daysOfWeek.reduce((acc, day) => {
        const rawDayHours = validInitialHours[day.id];
        
        let safeDayHours = Array.isArray(rawDayHours) ? rawDayHours : initialHoursState[day.id];
        safeDayHours = safeDayHours.map(shift => shift || { start: '', end: '' });

        while (safeDayHours.length < 3) {
            safeDayHours.push({ start: '', end: '' });
        }

        acc[day.id] = safeDayHours;
        return acc;
      }, {});
      setHours(mergedHours);
    }
  }, [isOpen, initialHours]);

  const handleTimeChange = (day, shiftIndex, type, value) => {
    setHours(prev => ({
      ...prev,
      [day]: prev[day].map((shift, index) => 
        index === shiftIndex ? { ...shift, [type]: value } : shift
      ),
    }));
  };

  const handleSave = () => {
    onSaveHours(hours);
    toast({
        title: "Horarios Actualizados Localmente",
        description: "Recuerda guardar la configuración general para que los cambios persistan.",
        className: "bg-blue-500 text-white",
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Configuración de Horarios</DialogTitle>
          <DialogDescription>Define los horarios de atención para cada día de la semana.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 py-4 max-h-[60vh] overflow-y-auto pr-4">
          {daysOfWeek.map(day => (
            <div key={day.id} className="space-y-3 p-4 border rounded-lg">
              <h3 className="font-bold text-lg text-gray-800">{day.name}</h3>
              {hours[day.id]?.map((shift, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Label className="w-16">Turno {index + 1}</Label>
                  <Input
                    type="time"
                    value={shift?.start || ''} 
                    onChange={(e) => handleTimeChange(day.id, index, 'start', e.target.value)}
                  />
                  <span className="text-gray-500">-</span>
                  <Input
                    type="time"
                    value={shift?.end || ''}
                    onChange={(e) => handleTimeChange(day.id, index, 'end', e.target.value)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />
            Aceptar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default HoursSettingsModal;