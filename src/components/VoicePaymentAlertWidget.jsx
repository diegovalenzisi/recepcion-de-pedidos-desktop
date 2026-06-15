import React from 'react';
import { Volume2, VolumeX, PlayCircle, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AUTO_VOICE_VALUE } from '@/hooks/useVoicePaymentAlerts';

const VoicePaymentAlertWidget = ({
  isEnabled,
  isSoundUnlocked,
  lastAnnouncedPayment,
  availableVoices,
  selectedVoiceURI,
  enableSound,
  testVoice,
  toggleEnabled,
  selectVoice,
}) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors"
          title="Avisos por voz de pagos"
        >
          {isEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="voice-alerts-toggle" className="text-sm font-medium">
            Avisos por voz de pagos
          </Label>
          <Switch
            id="voice-alerts-toggle"
            checked={isEnabled}
            onCheckedChange={toggleEnabled}
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={enableSound} className="flex-1">
            <Unlock className="mr-2 h-4 w-4" />
            Activar sonido
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={testVoice} className="flex-1">
            <PlayCircle className="mr-2 h-4 w-4" />
            Probar voz
          </Button>
        </div>

        {!isSoundUnlocked && (
          <p className="text-xs text-muted-foreground">
            Hacé clic en "Activar sonido" una vez para habilitar los avisos por voz en este dispositivo.
          </p>
        )}

        <div className="space-y-1">
          <Label htmlFor="voice-alerts-voice-select" className="text-sm font-medium">
            Voz para los avisos
          </Label>
          <Select value={selectedVoiceURI} onValueChange={selectVoice}>
            <SelectTrigger id="voice-alerts-voice-select" className="h-9 text-xs">
              <SelectValue placeholder="Automática" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_VOICE_VALUE}>Automática (recomendada)</SelectItem>
              {availableVoices.map((voice) => (
                <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground border-t pt-2">
          <span className="font-medium">Último pago anunciado: </span>
          {lastAnnouncedPayment ? (
            <span>
              Pedido {lastAnnouncedPayment.pedidoId} - {lastAnnouncedPayment.cliente} - ${lastAnnouncedPayment.monto}
            </span>
          ) : (
            <span>Sin avisos todavía</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default VoicePaymentAlertWidget;
