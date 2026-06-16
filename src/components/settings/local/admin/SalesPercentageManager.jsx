
import React, { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Percent } from 'lucide-react';
import { saveSalesPercentage, fetchSalesPercentage } from '@/lib/api/settingsApi';

const SalesPercentageManager = () => {
  const [percentage, setPercentage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const loadPercentage = async () => {
      try {
        const value = await fetchSalesPercentage();
        console.log('[porcentaje ventas] valor cargado desde Firebase:', value);
        if (value !== null && value !== undefined) {
          setPercentage(String(value));
        }
      } catch (error) {
        console.error('[porcentaje ventas] error al cargar:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadPercentage();
  }, []);

  const handleSave = async () => {
    const numericValue = parseFloat(percentage);
    console.log('[porcentaje ventas] valor ingresado:', percentage, '→ numérico:', numericValue);

    if (isNaN(numericValue)) {
      toast({ variant: "destructive", title: "Valor inválido", description: "Ingresá un número válido." });
      return;
    }

    setIsSaving(true);
    try {
      console.log('[porcentaje ventas] guardando valor:', numericValue);
      await saveSalesPercentage(numericValue);
      console.log('[porcentaje ventas] guardado OK');
      toast({
        title: "¡Éxito!",
        description: "Porcentaje de ventas guardado.",
        className: "bg-green-500 text-white"
      });
    } catch (error) {
      console.error('[porcentaje ventas] error real:', error);
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
        <Input
          type="number"
          value={percentage}
          onChange={(e) => setPercentage(e.target.value)}
          placeholder="Ej: 10"
          className="bg-white text-gray-800 flex-grow"
          disabled={isLoading}
        />
        <Button onClick={handleSave} disabled={isSaving || isLoading}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Grabar
        </Button>
      </div>
    </div>
  );
};

export default SalesPercentageManager;
