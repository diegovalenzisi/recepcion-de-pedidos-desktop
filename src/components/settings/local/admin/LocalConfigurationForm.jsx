
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { saveLocalConfiguration, fetchLocalConfiguration } from '@/lib/api/localConfigApi';
import { Database, Save, Loader2, Server } from 'lucide-react';

const LocalConfigurationForm = () => {
  const [formData, setFormData] = useState({
    numeroLocal: '',
    firebaseDatabase: '',
    firebaseStorage: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [errors, setErrors] = useState({});
  const { toast } = useToast();

  useEffect(() => {
    loadExistingConfiguration();
  }, []);

  const loadExistingConfiguration = async () => {
    const storedLocalId = localStorage.getItem('localId');
    if (!storedLocalId) {
      return;
    }

    setIsFetching(true);
    try {
      const result = await fetchLocalConfiguration(storedLocalId);
      if (result.success && result.data) {
        setFormData({
          numeroLocal: result.data.numeroLocal || '',
          firebaseDatabase: result.data.firebaseDatabase || '',
          firebaseStorage: result.data.firebaseStorage || '',
        });
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
    } finally {
      setIsFetching(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.numeroLocal.trim()) {
      newErrors.numeroLocal = 'El número de local es obligatorio';
    }

    if (!formData.firebaseDatabase.trim()) {
      newErrors.firebaseDatabase = 'La dirección de base de datos es obligatoria';
    } else if (!isValidUrl(formData.firebaseDatabase)) {
      newErrors.firebaseDatabase = 'Ingrese una URL válida';
    }

    if (!formData.firebaseStorage.trim()) {
      newErrors.firebaseStorage = 'La dirección de storage es obligatoria';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidUrl = (urlString) => {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleSave = async () => {
    if (!validateForm()) {
      toast({
        variant: "destructive",
        title: "Error de validación",
        description: "Por favor, corrija los errores en el formulario.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await saveLocalConfiguration(
        formData.numeroLocal.trim(),
        formData.firebaseDatabase.trim(),
        formData.firebaseStorage.trim()
      );

      if (result.success) {
        toast({
          title: "Configuración guardada",
          description: "La configuración del local se guardó correctamente.",
          variant: "default",
        });
      } else {
        throw new Error(result.error || 'Error al guardar');
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: error.message || "No se pudo guardar la configuración del local.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
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
          <Server className="mr-2 h-5 w-5" />
          Configuración de Base de Datos Local
        </CardTitle>
        <CardDescription>
          Configure las URLs de Firebase para este local. Esta información se guardará en la base de datos central.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="numeroLocal" className="text-sm font-medium">
            Número de Local
          </Label>
          <Input
            id="numeroLocal"
            type="text"
            placeholder="Ej: 31915636"
            value={formData.numeroLocal}
            onChange={(e) => handleInputChange('numeroLocal', e.target.value)}
            className={errors.numeroLocal ? 'border-red-500' : ''}
            disabled={isLoading}
          />
          {errors.numeroLocal && (
            <p className="text-xs text-red-500">{errors.numeroLocal}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="firebaseDatabase" className="text-sm font-medium">
            Dirección de Base de Datos Firebase
          </Label>
          <Input
            id="firebaseDatabase"
            type="url"
            placeholder="https://tu-base-de-datos.firebaseio.com"
            value={formData.firebaseDatabase}
            onChange={(e) => handleInputChange('firebaseDatabase', e.target.value)}
            className={errors.firebaseDatabase ? 'border-red-500' : ''}
            disabled={isLoading}
          />
          {errors.firebaseDatabase && (
            <p className="text-xs text-red-500">{errors.firebaseDatabase}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="firebaseStorage" className="text-sm font-medium">
            Dirección de Storage Firebase
          </Label>
          <Input
            id="firebaseStorage"
            type="text"
            placeholder="tu-bucket.firebasestorage.app"
            value={formData.firebaseStorage}
            onChange={(e) => handleInputChange('firebaseStorage', e.target.value)}
            className={errors.firebaseStorage ? 'border-red-500' : ''}
            disabled={isLoading}
          />
          {errors.firebaseStorage && (
            <p className="text-xs text-red-500">{errors.firebaseStorage}</p>
          )}
        </div>

        <div className="pt-4">
          <Button
            onClick={handleSave}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Guardar Configuración
              </>
            )}
          </Button>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 mt-4">
          <div className="flex items-start">
            <Database className="h-5 w-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
            <div className="text-xs text-blue-800">
              <p className="font-medium mb-1">Información importante:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Esta configuración se guardará en la base de datos central</li>
                <li>El número de local debe ser único para cada sucursal</li>
                <li>Las URLs de Firebase deben corresponder al proyecto correcto</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default LocalConfigurationForm;
