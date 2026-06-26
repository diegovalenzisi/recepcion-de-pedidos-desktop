import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { fetchWhatsAppPreference, saveWhatsAppPreference } from '@/lib/api/settingsApi';
import { useLocalWhatsAppPreference } from '@/hooks/useLocalWhatsAppPreference';
import { Loader2, MessageSquare, Save, MonitorSmartphone } from 'lucide-react';

const WhatsAppSettings = () => {
  const [preference, setPreference] = useState('web');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  
  // Use the updated hook which now defaults to true
  const { isLocalEnabled, togglePreference } = useLocalWhatsAppPreference();

  useEffect(() => {
    const loadPref = async () => {
      try {
        const pref = await fetchWhatsAppPreference();
        setPreference(pref || 'web');
      } catch (error) {
        console.error("Error loading global WhatsApp preference:", error);
      } finally {
        setLoading(false);
      }
    };
    loadPref();
  }, []);

  const handleSaveGlobal = async () => {
    setSaving(true);
    try {
      await saveWhatsAppPreference(preference);
      toast({
        title: "Configuración guardada",
        description: "Preferencia global de WhatsApp actualizada correctamente.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudo guardar la preferencia global.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8 border rounded-lg bg-white mt-6">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <Card className="mt-6 shadow-sm border border-gray-200">
      <CardHeader className="bg-gray-50/50 pb-4 border-b">
         <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-600" />
            <CardTitle className="text-xl text-gray-800">Configuración de WhatsApp</CardTitle>
         </div>
         <CardDescription className="text-gray-500">
            Ajustes de integración y comportamiento de WhatsApp al despachar pedidos.
         </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-8">
        
        {/* Local PC Settings Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 uppercase tracking-wider">
              <MonitorSmartphone className="w-4 h-4" />
              Ajustes Locales (Solo esta PC)
            </h3>
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">DISPOSITIVO ACTUAL</span>
          </div>
          
          <div className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm bg-white hover:bg-gray-50/30 transition-colors">
            <div className="space-y-0.5 max-w-[80%]">
              <Label className="text-base font-semibold text-gray-800 cursor-pointer" htmlFor="local-whatsapp-toggle">
                Leer WhatsApp desde base de datos
              </Label>
              <p className="text-sm text-gray-500 leading-tight">
                Al activar esta opción, esta computadora abrirá WhatsApp automáticamente cuando el estado de un pedido cambie a "EN DELIVERY". 
                <span className="block mt-1 font-medium text-amber-600 italic">Cada PC mantiene su propia configuración independiente. Por defecto está habilitado.</span>
              </p>
            </div>
            <Switch
              id="local-whatsapp-toggle"
              checked={isLocalEnabled}
              onCheckedChange={(val) => {
                togglePreference(val);
                toast({
                  title: val ? "Auto-WhatsApp Activado" : "Auto-WhatsApp Desactivado",
                  description: `Esta PC ${val ? 'ahora' : 'ya no'} abrirá WhatsApp automáticamente.`,
                });
              }}
              className="data-[state=checked]:bg-green-600"
            />
          </div>
        </div>

        <div className="border-t border-gray-100 my-2"></div>

        {/* Global Settings Section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">Ajustes Globales (Toda la Empresa)</h3>
          <p className="text-sm text-gray-500 -mt-2">Esta configuración afecta a todos los usuarios de la cuenta.</p>
          
          <RadioGroup value={preference} onValueChange={setPreference} className="flex flex-col space-y-4">
            <div 
              className={`flex items-start space-x-3 p-4 rounded-lg border transition-all cursor-pointer ${preference === 'web' ? 'border-green-500 bg-green-50/30' : 'border-gray-200 bg-white hover:border-green-300'}`}
              onClick={() => setPreference('web')}
            >
              <RadioGroupItem value="web" id="web" className="mt-1 data-[state=checked]:border-green-600 data-[state=checked]:text-green-600" />
              <Label htmlFor="web" className="flex-1 cursor-pointer">
                <span className="font-semibold text-gray-800 block text-base">WhatsApp Web</span>
                <span className="text-sm text-gray-500 mt-1 block leading-tight">
                  Abre en una nueva pestaña del navegador. Ideal para computadoras de escritorio.
                </span>
              </Label>
            </div>
            
            <div 
              className={`flex items-start space-x-3 p-4 rounded-lg border transition-all cursor-pointer ${preference === 'app' ? 'border-green-500 bg-green-50/30' : 'border-gray-200 bg-white hover:border-green-300'}`}
              onClick={() => setPreference('app')}
            >
              <RadioGroupItem value="app" id="app" className="mt-1 data-[state=checked]:border-green-600 data-[state=checked]:text-green-600" />
              <Label htmlFor="app" className="flex-1 cursor-pointer">
                <span className="font-semibold text-gray-800 block text-base">WhatsApp App</span>
                <span className="text-sm text-gray-500 mt-1 block leading-tight">
                  Intenta abrir la aplicación nativa instalada en tu dispositivo (Windows/Mac/Celular).
                </span>
              </Label>
            </div>
          </RadioGroup>
          
          <div className="mt-6 flex justify-end">
            <Button 
              onClick={handleSaveGlobal} 
              disabled={saving} 
              className="bg-green-600 hover:bg-green-700 text-white min-w-[180px]"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {saving ? 'Guardando...' : 'Guardar Preferencia Global'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppSettings;