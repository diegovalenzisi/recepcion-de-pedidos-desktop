import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const OperationalToggles = ({ settings, onSettingsChange }) => {

  const handleToggle = (key, value) => {
    onSettingsChange(key, value);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div>
          <Label htmlFor="delivery-enabled" className="font-bold">Delivery Habilitado</Label>
          <p className="text-sm text-gray-500">Activa o desactiva la opción de pedidos para delivery.</p>
        </div>
        <Switch
          id="delivery-enabled"
          checked={settings.deliveryEnabled ?? true}
          onCheckedChange={(checked) => handleToggle('deliveryEnabled', checked)}
        />
      </div>

      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div>
          <Label htmlFor="pickup-enabled" className="font-bold">Retiro en Local Habilitado</Label>
          <p className="text-sm text-gray-500">Activa o desactiva la opción de pedidos para retirar en el local.</p>
        </div>
        <Switch
          id="pickup-enabled"
          checked={settings.pickupEnabled ?? true}
          onCheckedChange={(checked) => handleToggle('pickupEnabled', checked)}
        />
      </div>
      
       <div className="flex items-center justify-between p-4 border rounded-lg bg-blue-50 border-blue-200">
        <div>
          <Label htmlFor="respect-schedule" className="font-bold text-blue-800">Respetar Horario</Label>
          <p className="text-sm text-blue-700">Si está activo, el local sigue el horario programado. Si se desactiva, el local se cierra manualmente.</p>
        </div>
        <Switch
          id="respect-schedule"
          checked={!(settings.manualClose ?? false)}
          onCheckedChange={(checked) => handleToggle('manualClose', !checked)}
          className="data-[state=checked]:bg-blue-500"
        />
      </div>

      <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50 border-gray-200">
        <div>
          <Label htmlFor="black-text-delivery" className="font-bold text-black">Texto Negro en Pedidos</Label>
          <p className="text-sm text-gray-700">Activa el color de texto negro para facilitar la lectura en los pedidos de delivery.</p>
        </div>
        <Switch
          id="black-text-delivery"
          checked={settings.blackTextColorDelivery ?? true}
          onCheckedChange={(checked) => handleToggle('blackTextColorDelivery', checked)}
          className="data-[state=checked]:bg-black"
        />
      </div>
    </div>
  );
};

export default OperationalToggles;