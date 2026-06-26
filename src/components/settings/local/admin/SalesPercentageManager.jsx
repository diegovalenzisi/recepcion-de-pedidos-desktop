
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Percent, Bell } from 'lucide-react';
import { saveSalesPercentage, fetchSalesPercentage, saveAlarmaPago, fetchAlarmaPago } from '@/lib/api/settingsApi';

const parsePercentage = (str) => {
  if (str === null || str === undefined || str === '') return NaN;
  const cleaned = String(str).trim().replace(/%/g, '').replace(',', '.').trim();
  return parseFloat(cleaned);
};

const SalesPercentageManager = () => {
  const [percentage, setPercentage] = useState('');
  const [alarmaPago, setAlarmaPago] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAlarm, setIsSavingAlarm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [value, alarm] = await Promise.all([
        fetchSalesPercentage(),
        fetchAlarmaPago(),
      ]);
      if (value !== null && value !== undefined) setPercentage(String(value));
      if (alarm !== null && alarm !== undefined) setAlarmaPago(String(alarm));
    } catch (error) {
      console.error('[porcentaje ventas] error al cargar:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    const numericValue = parsePercentage(percentage);
    if (isNaN(numericValue) || numericValue < 0) {
      toast({ variant: 'destructive', title: 'Valor inválido', description: 'Ingresá un número válido. Ej: 1 o 1% para el 1%.' });
      return;
    }
    setIsSaving(true);
    try {
      await saveSalesPercentage(numericValue);
      setPercentage(String(numericValue));
      toast({ title: 'Guardado', description: `Porcentaje de ventas: ${numericValue}%` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: 'No se pudo guardar el porcentaje.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAlarm = async () => {
    const numericValue = parseFloat(alarmaPago) || 0;
    if (numericValue < 0) {
      toast({ variant: 'destructive', title: 'Valor inválido', description: 'El monto debe ser 0 o mayor.' });
      return;
    }
    setIsSavingAlarm(true);
    try {
      await saveAlarmaPago(numericValue);
      toast({
        title: 'Guardado',
        description: numericValue === 0 ? 'Alarma de pago desactivada.' : `Alarma de pago: $${numericValue.toLocaleString('es-AR')}`,
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: 'No se pudo guardar la alarma.' });
    } finally {
      setIsSavingAlarm(false);
    }
  };

  return (
    <div className="pt-4 border-t border-primary/20 space-y-4">

      <div className="space-y-2">
        <Label className="font-semibold flex items-center">
          <Percent className="mr-2 h-4 w-4" /> Porcentaje de Ventas
        </Label>
        <div className="flex items-center space-x-2">
          <Input
            type="text"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
            placeholder="Ej: 1 o 1%"
            className="bg-white text-gray-800 flex-grow"
            disabled={isLoading}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Grabar
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-3 border-t border-dashed border-primary/20">
        <Label className="font-semibold flex items-center">
          <Bell className="mr-2 h-4 w-4" /> Alarma de pago
        </Label>
        <div className="flex items-center space-x-2">
          <Input
            type="number"
            value={alarmaPago}
            onChange={(e) => setAlarmaPago(e.target.value)}
            placeholder="Ej: 50000 — 0 para desactivar"
            className="bg-white text-gray-800 flex-grow"
            disabled={isLoading}
            min="0"
          />
          <Button onClick={handleSaveAlarm} disabled={isSavingAlarm || isLoading}>
            {isSavingAlarm ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Grabar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Cuando la comisión a pagar supere este monto, se mostrará un aviso de cobro. Ingresá 0 para desactivar.
        </p>
      </div>

    </div>
  );
};

export default SalesPercentageManager;
