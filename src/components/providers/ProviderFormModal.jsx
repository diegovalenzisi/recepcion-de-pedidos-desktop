
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Building2 } from 'lucide-react';

const ProviderFormModal = ({ isOpen, onClose, onSave, editingProvider }) => {
  const [formData, setFormData] = useState({
    nombre: '',
    telefono: '',
    email: '',
    direccion: '',
    cuit: '',
    notas: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (editingProvider) {
      setFormData({
        nombre: editingProvider.nombre || '',
        telefono: editingProvider.telefono || '',
        email: editingProvider.email || '',
        direccion: editingProvider.direccion || '',
        cuit: editingProvider.cuit || '',
        notas: editingProvider.notas || ''
      });
    } else {
      setFormData({
        nombre: '',
        telefono: '',
        email: '',
        direccion: '',
        cuit: '',
        notas: ''
      });
    }
  }, [editingProvider, isOpen]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.nombre.trim()) {
      toast({
        variant: 'destructive',
        title: 'Campo Requerido',
        description: 'El nombre del proveedor es obligatorio.'
      });
      return;
    }

    setIsSaving(true);
    try {
      await onSave(formData);
      toast({
        title: editingProvider ? 'Proveedor Actualizado' : 'Proveedor Creado',
        description: `${formData.nombre} ha sido ${editingProvider ? 'actualizado' : 'guardado'} correctamente.`,
        className: 'bg-green-50 border-green-200 text-green-800'
      });
      onClose();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo guardar el proveedor.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building2 className="w-6 h-6 text-primary" />
            {editingProvider ? 'Editar Proveedor' : 'Nuevo Proveedor'}
          </DialogTitle>
          <DialogDescription>
            {editingProvider 
              ? 'Modifica la información del proveedor existente.' 
              : 'Completa los datos del nuevo proveedor.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">ID de Proveedor</Label>
            <Input
              value={editingProvider ? editingProvider.id : 'Se asignará un ID automáticamente'}
              disabled
              className="text-gray-500 bg-gray-50 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nombre" className="text-sm font-medium">
                Nombre del Proveedor <span className="text-red-500">*</span>
              </Label>
              <Input
                id="nombre"
                value={formData.nombre}
                onChange={(e) => handleChange('nombre', e.target.value)}
                placeholder="Ej: Distribuidora San Martín"
                required
                className="text-gray-900"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cuit" className="text-sm font-medium">
                CUIT / Tax ID
              </Label>
              <Input
                id="cuit"
                value={formData.cuit}
                onChange={(e) => handleChange('cuit', e.target.value)}
                placeholder="20-12345678-9"
                className="text-gray-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="telefono" className="text-sm font-medium">
                Teléfono
              </Label>
              <Input
                id="telefono"
                value={formData.telefono}
                onChange={(e) => handleChange('telefono', e.target.value)}
                placeholder="+54 9 11 1234-5678"
                className="text-gray-900"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="proveedor@ejemplo.com"
                className="text-gray-900"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="direccion" className="text-sm font-medium">
              Dirección
            </Label>
            <Input
              id="direccion"
              value={formData.direccion}
              onChange={(e) => handleChange('direccion', e.target.value)}
              placeholder="Calle 123, Ciudad, Provincia"
              className="text-gray-900"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas" className="text-sm font-medium">
              Notas / Observaciones
            </Label>
            <Textarea
              id="notas"
              value={formData.notas}
              onChange={(e) => handleChange('notas', e.target.value)}
              placeholder="Información adicional sobre el proveedor..."
              rows={3}
              className="text-gray-900 resize-none"
            />
          </div>

          <DialogFooter className="gap-2 mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                editingProvider ? 'Actualizar Proveedor' : 'Crear Proveedor'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ProviderFormModal;
