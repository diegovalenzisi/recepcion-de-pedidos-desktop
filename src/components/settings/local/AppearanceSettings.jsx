import React from 'react';
import { Palette } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const ColorPreview = ({ mode }) => {
  const colors = mode === 'saturated' 
    ? ['bg-orange-500', 'bg-blue-500', 'bg-green-500'] 
    : ['bg-orange-100', 'bg-blue-100', 'bg-green-100'];

  return (
    <div className="flex gap-1 mt-2">
      {colors.map((color, i) => (
        <div key={i} className={cn("h-6 w-6 rounded-full border border-gray-200 shadow-sm", color)} />
      ))}
    </div>
  );
};

const AppearanceSettings = ({ settings, onSettingsChange }) => {
  const currentMode = settings.deliveryOrderColorMode || 'pastel';

  const handleModeChange = (checked) => {
    onSettingsChange('deliveryOrderColorMode', checked ? 'saturated' : 'pastel');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between p-4 border rounded-lg bg-white">
        <div className="flex gap-4">
          <div className="mt-1 bg-purple-100 p-2 rounded-full">
            <Palette className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <Label htmlFor="color-mode" className="font-bold text-base">Modo de Color de Pedidos</Label>
            <p className="text-sm text-gray-500 mb-2">
              Elige entre tonos pastel suaves o colores saturados vibrantes para los estados de los pedidos.
            </p>
            <div className="flex gap-6">
                <div>
                    <span className="text-xs font-semibold text-gray-500">Vista Previa:</span>
                    <ColorPreview mode={currentMode} />
                </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium", currentMode === 'pastel' ? "text-primary" : "text-gray-400")}>Pastel</span>
          <Switch
            id="color-mode"
            checked={currentMode === 'saturated'}
            onCheckedChange={handleModeChange}
          />
          <span className={cn("text-sm font-medium", currentMode === 'saturated' ? "text-primary" : "text-gray-400")}>Saturado</span>
        </div>
      </div>
    </div>
  );
};

export default AppearanceSettings;