import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import PaymentMethodsSettings from '@/components/settings/PaymentMethodsSettings';
import AdminPanel from './local/AdminPanel';
import GeneralInfo from './local/GeneralInfo';
import OperationalToggles from './local/OperationalToggles';
import AppearanceSettings from './local/AppearanceSettings';
import PrintingSettings from './local/PrintingSettings';
import AudioSettings from './local/AudioSettings';
import DeliveryScreenTypeSelector from './local/DeliveryScreenTypeSelector';
import WhatsAppSettings from './local/WhatsAppSettings';
import { useAuth } from '@/hooks/useAuth';

function LocalSettings({ settings, onSettingsChange, onSave, saving, applySettings }) {
  const { user } = useAuth();
  
  const handleChange = (e) => {
    const { id, value } = e.target;
    onSettingsChange(prev => ({ ...prev, [id]: value }));
  };
  
  const handleAudioChange = (audioFile) => {
    onSettingsChange(prev => ({ ...prev, newOrderSound: audioFile }));
  };

  const handleSliderChange = (id, value) => {
    const newSettings = { ...settings, [id]: value[0] };
    onSettingsChange(newSettings);
    if (id === 'fontSize') {
        applySettings(newSettings);
    }
  };
  
  const handleSwitchChange = (id, checked) => {
    onSettingsChange(prev => ({...prev, [id]: checked}));
  };
  
  const handleDirectChange = (key, value) => {
      onSettingsChange(prev => ({...prev, [key]: value}));
  };

  const handleFontChange = (id, value) => {
    const newSettings = { ...settings, [id]: value };
    onSettingsChange(newSettings);
    if (id === 'fuente') {
        applySettings(newSettings);
    }
  };

  const handlePaymentMethodsChange = (newPaymentMethods) => {
    onSettingsChange(prev => ({ ...prev, formasDePago: newPaymentMethods }));
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-full"
    >
      <Card className="shadow-2xl overflow-hidden mt-6 flex flex-col h-full">
        <CardHeader className="bg-gradient-to-r from-gray-800 to-gray-700 text-white p-6 flex-shrink-0">
          <CardTitle className="text-3xl font-bold">Configuración del Local</CardTitle>
          <CardDescription className="text-gray-300">Administra la información general y los parámetros de tu negocio.</CardDescription>
        </CardHeader>
        <ScrollArea className="flex-grow">
          <CardContent className="p-8 space-y-8">
            {user && user.usuario === 'DiegoL' && (
              <AdminPanel 
                settings={settings} 
                onSettingsChange={onSettingsChange} 
                applySettings={applySettings} 
              />
            )}
            <GeneralInfo settings={settings} handleChange={handleChange} handleFontChange={handleFontChange} />
            <DeliveryScreenTypeSelector 
              value={settings.deliveryViewMode || settings.deliveryScreenType}
              onChange={(val) => handleDirectChange('deliveryViewMode', val)}
            />
            <OperationalToggles settings={settings} onSettingsChange={handleSwitchChange} />
            <AppearanceSettings settings={settings} onSettingsChange={handleDirectChange} />
            <PrintingSettings 
                settings={settings}
                handleChange={handleChange}
                handleSliderChange={handleSliderChange}
                handleFontChange={handleFontChange}
            />
            <AudioSettings 
                onAudioChange={handleAudioChange} 
                initialAudioName={settings.newOrderSound?.name}
                initialAudioDataUrl={settings.newOrderSound?.dataUrl}
            />
            <WhatsAppSettings />
            <PaymentMethodsSettings paymentMethods={settings.formasDePago} onPaymentMethodsChange={handlePaymentMethodsChange} />
          </CardContent>
        </ScrollArea>
        <CardFooter className="bg-gray-100 p-6 flex justify-end flex-shrink-0">
          <Button onClick={onSave} disabled={saving} className="w-40 h-12 text-lg font-bold bg-primary hover:bg-primary-dark">
            {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

export default LocalSettings;