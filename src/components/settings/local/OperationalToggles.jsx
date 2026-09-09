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

      {/* Sólo afecta a las ventas de MOSTRADOR. Apagado (por defecto) el
          sistema se comporta exactamente como antes. */}
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
      
      {/* El cierre temporal de Recepción ya no se controla desde acá: se
          unificó en un único campo (CONFIGURACION/swich + swichDesde) que
          también usa DLV Consultas, para no tener dos controles distintos
          para el mismo concepto. El switch "Respetar Horario"/`manualClose`
          que vivía en este lugar quedó reemplazado — ver LocalStatusIndicator
          (badge de arriba) y CerradoManualSwitch en DLV Consultas
          ("Recepción Habilitada"). */}
      <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50 border-gray-200">
        <div>
          <Label className="font-bold text-gray-700">Habilitar / cerrar temporalmente Recepción</Label>
          <p className="text-sm text-gray-500">Se controla desde DLV Consultas → Configuraciones → "Recepción Habilitada". El estado se refleja acá arriba, en el indicador de la barra superior.</p>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div>
          <Label htmlFor="print-counter-command" className="font-bold">Imprime comandas en mostrador</Label>
          <p className="text-sm text-gray-500">Si está activo, al confirmar una venta por mostrador se imprime automáticamente la comanda.</p>
        </div>
        <Switch
          id="print-counter-command"
          checked={settings.printCounterCommand ?? false}
          onCheckedChange={(checked) => handleToggle('printCounterCommand', checked)}
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