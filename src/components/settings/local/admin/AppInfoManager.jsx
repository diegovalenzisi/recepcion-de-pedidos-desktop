
import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, UploadCloud, Image as ImageIcon, Smartphone } from 'lucide-react';
import { saveSettings } from '@/lib/api/settingsApi';
import { uploadAppIcon } from '@/lib/firebase/storage';
import { getLocalId } from '@/lib/firebase/core';

const MAX_ICON_SIZE_BYTES = 2 * 1024 * 1024;

const AppInfoManager = ({ settings, onSettingsChange }) => {
  const [appName, setAppName] = useState('');
  const [appIcon, setAppIcon] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    if (settings) {
      setAppName(settings.nombreAppPedidos || '');
      setAppIcon(settings.iconoAppPedidos || null);
    }
  }, [settings]);

  // Vista previa local del archivo seleccionado, sin convertirlo a base64.
  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let iconUrl = appIcon;

      if (selectedFile) {
        const localId = getLocalId();
        iconUrl = await uploadAppIcon(selectedFile, localId);
      }

      const settingsToSave = {
        nombreAppPedidos: appName,
        iconoAppPedidos: iconUrl,
      };
      await saveSettings(settingsToSave);

      setAppIcon(iconUrl);
      setSelectedFile(null);
      if (onSettingsChange) onSettingsChange(prev => ({ ...prev, ...settingsToSave }));
      toast({
        title: "¡Éxito!",
        description: "Información de la app de pedidos guardada.",
        className: "bg-green-500 text-white"
      });
    } catch (error) {
      console.error('[APP_PEDIDOS_SAVE_ERROR]', error);
      if (error.code && error.message) {
        console.error(error.code, error.message);
      }
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudo guardar la información de la app.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleIconUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        variant: "destructive",
        title: "Archivo inválido",
        description: "El icono debe ser una imagen (PNG, JPG, etc.)."
      });
      return;
    }

    if (file.size > MAX_ICON_SIZE_BYTES) {
      toast({
        variant: "destructive",
        title: "Archivo muy grande",
        description: "El icono no debe pesar más de 2MB."
      });
      return;
    }

    setSelectedFile(file);
  };

  const displayIcon = previewUrl || appIcon;

  return (
    <div className="pt-4 border-t border-primary/20 space-y-4">
      <h3 className="font-semibold flex items-center"><Smartphone className="mr-2 h-4 w-4" /> App de Pedidos</h3>

      <div className="space-y-2">
        <Label htmlFor="appName">Nombre App</Label>
        <Input id="appName" value={appName} onChange={(e) => setAppName(e.target.value)} className="bg-white" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div className="space-y-2">
          <Label>Icono App</Label>
          <div className="flex items-center gap-4">
            <Input type="file" ref={fileInputRef} onChange={handleIconUpload} className="hidden" accept="image/*" />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current.click()}>
              <UploadCloud className="mr-2 h-4 w-4" /> Subir
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </div>
        </div>
        <div className="space-y-2">
            <Label>Vista previa</Label>
            <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden border">
                {displayIcon ? (
                <img src={displayIcon} alt="Vista previa del icono" className="w-full h-full object-cover" />
                ) : (
                <ImageIcon className="w-10 h-10 text-gray-400" />
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default AppInfoManager;
