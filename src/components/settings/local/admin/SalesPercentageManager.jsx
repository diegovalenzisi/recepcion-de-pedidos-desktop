
import React, { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Percent } from 'lucide-react';

const SalesPercentageManager = ({ initialPercentage, onSave }) => {
  const [percentage, setPercentage] = useState(initialPercentage);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(percentage);
      toast({
        title: "¡Éxito!",
        description: "Porcentaje de ventas guardado.",
        className: "bg-green-500 text-white"
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudo guardar el porcentaje.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="pt-4 border-t border-primary/20">
      <Label className="font-semibold flex items-center mb-2"><Percent className="mr-2 h-4 w-4" /> Porcentaje de Ventas</Label>
      <div className="flex items-center space-x-2">
        <Input type="number" value={percentage} onChange={(e) => setPercentage(e.target.value)} placeholder="Ej: 10" className="bg-white text-gray-800 flex-grow" />
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Grabar
        </Button>
      </div>
    </div>
  );
};

export default SalesPercentageManager;
