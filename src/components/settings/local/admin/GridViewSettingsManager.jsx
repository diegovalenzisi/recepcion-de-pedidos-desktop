
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, LayoutGrid } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { fetchGridViewSettings, saveGridViewSettings } from '@/lib/api/settingsApi';

const GridViewSettingsManager = ({ onSettingsChange }) => {
  const [settings, setSettings] = useState({
    showAddress: false,
    showPhone: false,
    showAmount: false,
    showChange: false,
    showPaymentType: false,
    showDeliverer: false,
    gridColumns: 5,
    gridRows: 4
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await fetchGridViewSettings();
      if (data) {
        setSettings(prev => ({ 
          ...prev, 
          ...data,
          gridColumns: Number(data.gridColumns) || 5,
          gridRows: Number(data.gridRows) || 4
        }));
      }
    } catch (error) {
      console.error("Failed to load grid view settings", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleToggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleChange = (e) => {
    const { id, value } = e.target;
    let numValue = parseInt(value, 10);
    
    if (isNaN(numValue)) {
      numValue = 1;
    }
    
    if (id === 'gridColumns') {
      numValue = Math.min(Math.max(numValue, 1), 10);
    } else if (id === 'gridRows') {
      numValue = Math.min(Math.max(numValue, 1), 20);
    }
    
    setSettings(prev => ({ ...prev, [id]: numValue }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveGridViewSettings(settings);
      
      if (onSettingsChange && result.success) {
        onSettingsChange(prev => ({ 
          ...prev, 
          gridViewSettings: result.data 
        }));
      }

      await loadSettings();

      toast({
        title: "Configuración guardada",
        description: `Preferencias actualizadas: ${result.data.gridColumns} columnas.`,
        className: "bg-green-500 text-white",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudieron guardar las preferencias.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-4">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="border border-primary/20 bg-white/50">
      <CardHeader>
        <CardTitle className="flex items-center text-lg">
          <LayoutGrid className="mr-2 h-5 w-5 text-primary" />
          Preferencias de Vista Cuadrilla
        </CardTitle>
        <CardDescription>
          Seleccione la información y dimensiones para la vista por cuadrilla.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gridColumns">Columnas (Máximo 10)</Label>
            <Input 
              type="number" 
              id="gridColumns" 
              min="1" 
              max="10" 
              value={settings.gridColumns} 
              onChange={handleChange} 
              className="w-full bg-white text-gray-900"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gridRows">Filas por página sugeridas (Máximo 20)</Label>
            <Input 
              type="number" 
              id="gridRows" 
              min="1" 
              max="20" 
              value={settings.gridRows} 
              onChange={handleChange}
              className="w-full bg-white text-gray-900"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
          <div className="flex items-center space-x-2">
            <Checkbox id="showAddress" checked={settings.showAddress} onCheckedChange={() => handleToggle('showAddress')} />
            <label htmlFor="showAddress" className="text-sm font-medium leading-none cursor-pointer">Mostrar Dirección</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="showPhone" checked={settings.showPhone} onCheckedChange={() => handleToggle('showPhone')} />
            <label htmlFor="showPhone" className="text-sm font-medium leading-none cursor-pointer">Mostrar Teléfono</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="showAmount" checked={settings.showAmount} onCheckedChange={() => handleToggle('showAmount')} />
            <label htmlFor="showAmount" className="text-sm font-medium leading-none cursor-pointer">Mostrar Monto Total</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="showChange" checked={settings.showChange} onCheckedChange={() => handleToggle('showChange')} />
            <label htmlFor="showChange" className="text-sm font-medium leading-none cursor-pointer">Mostrar Vuelto</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="showPaymentType" checked={settings.showPaymentType} onCheckedChange={() => handleToggle('showPaymentType')} />
            <label htmlFor="showPaymentType" className="text-sm font-medium leading-none cursor-pointer">Mostrar Tipo de Pago</label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="showDeliverer" checked={settings.showDeliverer} onCheckedChange={() => handleToggle('showDeliverer')} />
            <label htmlFor="showDeliverer" className="text-sm font-medium leading-none cursor-pointer">Mostrar Repartidor</label>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="mt-4 w-full md:w-auto">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar Preferencias de Cuadrilla
        </Button>
      </CardContent>
    </Card>
  );
};

export default GridViewSettingsManager;
