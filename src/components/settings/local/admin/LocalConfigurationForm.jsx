
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Database, Save, Loader2, RefreshCw } from 'lucide-react';

// Configuración de Firebase y del local guardada en AppData/config/local-config.json.
// NO va a Firebase. Se opera solo desde esta PC.
const LocalConfigurationForm = () => {
  const [formData, setFormData] = useState({
    localId:       '',
    businessName:  '',
    adminUser:     '',
    databaseURL:   '',
    storageBucket: '',
    apiKey:        '',
    projectId:     '',
  });
  const [loading,  setLoading]  = useState(false);
  const [fetching, setFetching] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setFetching(true);
    try {
      // Intenta leer desde disco (async, para obtener la versión más reciente)
      const config = await window.electronAPI?.localConfig?.read?.();
      if (config) {
        setFormData({
          localId:       config.localId       || localStorage.getItem('localId') || '',
          businessName:  config.businessName  || '',
          adminUser:     config.adminUser     || '',
          databaseURL:   config.firebase?.databaseURL   || '',
          storageBucket: config.firebase?.storageBucket || '',
          apiKey:        config.firebase?.apiKey        || '',
          projectId:     config.firebase?.projectId     || '',
        });
      } else {
        // Sin config guardada: precarga el localId desde localStorage
        setFormData(prev => ({ ...prev, localId: localStorage.getItem('localId') || '' }));
      }
    } catch (e) {
      console.error('[LocalConfig] Error cargando:', e);
    } finally {
      setFetching(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!formData.localId.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'El ID de local es obligatorio.' });
      return;
    }
    if (!formData.databaseURL.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'La URL de la base de datos es obligatoria.' });
      return;
    }
    if (!formData.apiKey.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'La API Key de Firebase es obligatoria.' });
      return;
    }
    if (!formData.projectId.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'El Project ID de Firebase es obligatorio.' });
      return;
    }

    setLoading(true);
    try {
      const config = {
        version:      1,
        localId:      formData.localId.trim(),
        businessName: formData.businessName.trim() || undefined,
        adminUser:    formData.adminUser.trim()    || undefined,
        firebase: {
          databaseURL:   formData.databaseURL.trim(),
          storageBucket: formData.storageBucket.trim() || undefined,
          apiKey:        formData.apiKey.trim(),
          projectId:     formData.projectId.trim(),
        },
      };

      const result = await window.electronAPI?.localConfig?.write?.(config);
      if (result?.ok) {
        toast({
          title: 'Configuración guardada',
          description: 'Se guardó en esta PC. Reiniciá la aplicación para aplicar los cambios.',
        });
      } else {
        throw new Error(result?.error || 'Error desconocido');
      }
    } catch (e) {
      console.error('[LocalConfig] Error guardando:', e);
      toast({ variant: 'destructive', title: 'Error al guardar', description: e.message });
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Cargando configuración...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center text-primary">
          <Database className="mr-2 h-5 w-5" />
          Configuración Firebase de esta PC
        </CardTitle>
        <CardDescription>
          Se guarda solo en esta computadora ({'%'}APPDATA%\Recepción de Pedidos\config\local-config.json).
          Permite usar un local diferente a los preconfigurados. Reiniciá la app después de guardar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lc-localId">ID de local *</Label>
            <Input
              id="lc-localId"
              placeholder="Ej: 12345678"
              value={formData.localId}
              onChange={(e) => handleChange('localId', e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lc-businessName">Nombre del negocio</Label>
            <Input
              id="lc-businessName"
              placeholder="Ej: HELADERÍA EL SOL"
              value={formData.businessName}
              onChange={(e) => handleChange('businessName', e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="lc-databaseURL">Firebase Database URL *</Label>
          <Input
            id="lc-databaseURL"
            placeholder="https://mi-proyecto-default-rtdb.firebaseio.com"
            value={formData.databaseURL}
            onChange={(e) => handleChange('databaseURL', e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lc-apiKey">Firebase API Key *</Label>
            <Input
              id="lc-apiKey"
              placeholder="AIzaSy..."
              value={formData.apiKey}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lc-projectId">Firebase Project ID *</Label>
            <Input
              id="lc-projectId"
              placeholder="mi-proyecto"
              value={formData.projectId}
              onChange={(e) => handleChange('projectId', e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lc-storageBucket">Storage Bucket</Label>
            <Input
              id="lc-storageBucket"
              placeholder="mi-proyecto.firebasestorage.app"
              value={formData.storageBucket}
              onChange={(e) => handleChange('storageBucket', e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lc-adminUser">Usuario admin (opcional)</Label>
            <Input
              id="lc-adminUser"
              placeholder="Ej: MiUsuario"
              value={formData.adminUser}
              onChange={(e) => handleChange('adminUser', e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={loading} className="flex-1 sm:flex-none">
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Guardando...</>
            ) : (
              <><Save className="mr-2 h-4 w-4" />Guardar en esta PC</>
            )}
          </Button>
          <Button variant="outline" onClick={loadConfig} disabled={loading || fetching}>
            <RefreshCw className="mr-2 h-4 w-4" />Recargar
          </Button>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 mt-2">
          <p className="text-xs text-blue-800 font-medium mb-1">Importante:</p>
          <ul className="text-xs text-blue-800 list-disc list-inside space-y-0.5 ml-2">
            <li>Esta configuración es solo para esta PC. No se sube a Firebase.</li>
            <li>Tiene prioridad sobre los valores preconfigurados de la app.</li>
            <li>Se borra al usar "Local nuevo" para cambiar de local.</li>
            <li>Campos con * son obligatorios para nuevos locales.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default LocalConfigurationForm;
