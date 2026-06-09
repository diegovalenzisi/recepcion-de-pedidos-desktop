
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileText, Plus, Trash2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { checkRemitoExists } from '@/lib/api/providersApi';

const RemitoFormModal = ({ isOpen, onClose, onSave, editingRemito, providerName, providerId }) => {
  const [formData, setFormData] = useState({
    numeroRemito: '',
    fecha: format(new Date(), 'yyyy-MM-dd'),
    monto: '',
    descripcion: '',
    items: []
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingRemito, setIsCheckingRemito] = useState(false);
  const [remitoExistsError, setRemitoExistsError] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (editingRemito) {
      setFormData({
        numeroRemito: editingRemito.numeroRemito || editingRemito.numero || editingRemito.id || '',
        fecha: editingRemito.fecha || format(new Date(), 'yyyy-MM-dd'),
        monto: editingRemito.monto?.toString() || '',
        descripcion: editingRemito.descripcion || '',
        items: (editingRemito.items || []).map(item => ({
          descripcion: item.descripcion || '',
          precioUnitario: item.precioUnitario || '',
          cantidad: item.cantidad != null ? item.cantidad.toString().replace('.', ',') : ''
        }))
      });
      setRemitoExistsError('');
    } else {
      setFormData({
        numeroRemito: '',
        fecha: format(new Date(), 'yyyy-MM-dd'),
        monto: '',
        descripcion: '',
        items: []
      });
      setRemitoExistsError('');
    }
  }, [editingRemito, isOpen]);

  // Real-time validation for numeroRemito
  useEffect(() => {
    if (!formData.numeroRemito || editingRemito) {
      setRemitoExistsError('');
      setIsCheckingRemito(false);
      return;
    }

    const checkDuplicate = async () => {
      setIsCheckingRemito(true);
      try {
        const exists = await checkRemitoExists(formData.numeroRemito);
        if (exists) {
          setRemitoExistsError('El número de remito ya existe');
        } else {
          setRemitoExistsError('');
        }
      } catch (error) {
        console.error("Error checking remito duplicate", error);
      } finally {
        setIsCheckingRemito(false);
      }
    };

    const timeoutId = setTimeout(checkDuplicate, 500);
    return () => clearTimeout(timeoutId);
  }, [formData.numeroRemito, editingRemito]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { descripcion: '', cantidad: '', precioUnitario: '' }]
    }));
  };

  const handleRemoveItem = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const handleCantidadChange = (index, value) => {
    let val = value.replace(/[^0-9.,]/g, '');
    val = val.replace('.', ',');
    const parts = val.split(',');
    if (parts.length > 2) {
      val = parts[0] + ',' + parts.slice(1).join('').substring(0, 3);
    } else if (parts.length === 2) {
      val = parts[0] + ',' + parts[1].substring(0, 3);
    }
    handleItemChange(index, 'cantidad', val);
  };

  const calculateLineTotal = (cantidad, precioUnitario) => {
    const cantStr = cantidad ? cantidad.toString().replace(',', '.') : '0';
    const cant = parseFloat(cantStr) || 0;
    const precio = parseFloat(precioUnitario) || 0;
    return cant * precio;
  };

  const calculateTotalGeneral = () => {
    return formData.items.reduce((total, item) => {
      return total + calculateLineTotal(item.cantidad, item.precioUnitario);
    }, 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.numeroRemito || formData.numeroRemito.trim() === '') {
      toast({
        variant: 'destructive',
        title: 'Campo Requerido',
        description: 'El número de remito es obligatorio.'
      });
      return;
    }

    if (remitoExistsError) {
      toast({
        variant: 'destructive',
        title: 'Número Inválido',
        description: 'El número de remito ya existe.'
      });
      return;
    }

    if (!formData.fecha) {
      toast({
        variant: 'destructive',
        title: 'Campo Requerido',
        description: 'La fecha es obligatoria.'
      });
      return;
    }

    if (formData.items.length > 0) {
      const invalidItems = formData.items.filter(item => {
        if (!item.descripcion.trim()) return true;
        const cantStr = item.cantidad ? item.cantidad.toString().replace(',', '.') : '0';
        const cant = parseFloat(cantStr);
        const precio = parseFloat(item.precioUnitario);
        if (isNaN(cant) || cant <= 0) return true;
        if (isNaN(precio) || precio < 0) return true;
        return false;
      });

      if (invalidItems.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Items Inválidos',
          description: 'Verifica que todos los items tengan descripción, cantidad válida (mayor a 0) y precio unitario válido (no negativo).'
        });
        return;
      }
    }

    const finalMonto = formData.items.length > 0 ? calculateTotalGeneral() : parseFloat(formData.monto) || 0;

    setIsSaving(true);
    try {
      const savedRemito = await onSave({
        ...formData,
        monto: finalMonto,
        items: formData.items.filter(item => item.descripcion.trim()).map(item => ({
          descripcion: item.descripcion,
          precioUnitario: item.precioUnitario,
          cantidad: item.cantidad
        }))
      });
      
      const savedNumber = savedRemito?.numeroRemito || formData.numeroRemito || savedRemito?.id;
      
      toast({
        title: editingRemito ? 'Remito Actualizado' : 'Remito Creado',
        description: `Remito #${savedNumber} ha sido ${editingRemito ? 'actualizado' : 'generado y guardado'} correctamente.`,
        className: 'bg-green-50 border-green-200 text-green-800'
      });
      onClose();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo guardar el remito.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isSaveDisabled = isSaving || isCheckingRemito || !!remitoExistsError || !formData.numeroRemito;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="w-6 h-6 text-primary" />
            {editingRemito ? `Editar Remito #${formData.numeroRemito}` : 'Nuevo Remito'}
          </DialogTitle>
          {providerName && (
            <DialogDescription className="text-base flex gap-2 mt-1">
              <span className="font-medium text-primary">ID Proveedor: {providerId}</span>
              <span className="font-medium">| Proveedor: {providerName}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto" style={{ maxHeight: 'calc(95vh - 180px)' }}>
          <div className="px-6 py-4">
            <form id="remito-form" onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                <div className="space-y-2">
                  <Label htmlFor="numeroRemito" className="text-sm font-medium">
                    Número de Remito <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="numeroRemito"
                      value={formData.numeroRemito}
                      onChange={(e) => handleChange('numeroRemito', e.target.value)}
                      disabled={!!editingRemito}
                      placeholder="Ingrese número de remito"
                      className={`text-gray-900 font-mono ${remitoExistsError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                    />
                    {isCheckingRemito && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {remitoExistsError && (
                    <div className="flex items-center gap-1 text-sm text-red-500 mt-1">
                      <AlertCircle className="w-4 h-4" />
                      <span>{remitoExistsError}</span>
                    </div>
                  )}
                  {!formData.numeroRemito && !editingRemito && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Requerido
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fecha" className="text-sm font-medium">
                    Fecha <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="fecha"
                    type="date"
                    value={formData.fecha}
                    onChange={(e) => handleChange('fecha', e.target.value)}
                    required
                    className="text-gray-900"
                  />
                </div>

                {formData.items.length === 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="monto" className="text-sm font-medium">
                      Monto Total
                    </Label>
                    <Input
                      id="monto"
                      type="number"
                      step="0.01"
                      value={formData.monto}
                      onChange={(e) => handleChange('monto', e.target.value)}
                      placeholder="0.00"
                      className="text-gray-900"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="descripcion" className="text-sm font-medium">
                  Descripción General
                </Label>
                <Textarea
                  id="descripcion"
                  value={formData.descripcion}
                  onChange={(e) => handleChange('descripcion', e.target.value)}
                  placeholder="Descripción del remito..."
                  rows={2}
                  className="text-gray-900 resize-none"
                />
              </div>

              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-center mb-4">
                  <Label className="text-base font-semibold">Items del Remito</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
                    <Plus className="w-4 h-4 mr-2" />
                    Agregar Item
                  </Button>
                </div>

                {formData.items.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground bg-white rounded-lg border-2 border-dashed">
                    <p className="text-sm">No hay items agregados.</p>
                    <p className="text-xs mt-1">Si no agrega items, ingrese el monto total directamente arriba.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="border rounded-lg bg-white overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-gray-100">
                            <TableHead className="w-[50px] font-semibold">#</TableHead>
                            <TableHead className="font-semibold min-w-[200px]">Descripción</TableHead>
                            <TableHead className="w-[120px] font-semibold text-right">Cantidad</TableHead>
                            <TableHead className="w-[140px] font-semibold text-right">Precio Unitario</TableHead>
                            <TableHead className="w-[140px] font-semibold text-right">Total Línea</TableHead>
                            <TableHead className="w-[80px] font-semibold text-center">Acción</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {formData.items.map((item, index) => (
                            <TableRow key={index} className="hover:bg-gray-50">
                              <TableCell className="font-medium text-gray-500">
                                {index + 1}
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={item.descripcion}
                                  onChange={(e) => handleItemChange(index, 'descripcion', e.target.value)}
                                  placeholder="Descripción del item"
                                  className="text-gray-900 h-9"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={item.cantidad}
                                  onChange={(e) => handleCantidadChange(index, e.target.value)}
                                  placeholder="0,000"
                                  className="text-gray-900 text-right h-9"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.precioUnitario}
                                  onChange={(e) => handleItemChange(index, 'precioUnitario', e.target.value)}
                                  placeholder="0.00"
                                  className="text-gray-900 text-right h-9"
                                />
                              </TableCell>
                              <TableCell className="text-right font-semibold text-primary">
                                ${calculateLineTotal(item.cantidad, item.precioUnitario).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveItem(index)}
                                  className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    
                    <div className="flex justify-end pt-4 border-t-2 border-gray-300">
                      <div className="bg-primary/10 rounded-lg px-6 py-4 border-2 border-primary/20">
                        <div className="text-sm font-medium text-gray-600 mb-1">Total General</div>
                        <div className="text-3xl font-bold text-primary">
                          ${calculateTotalGeneral().toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button form="remito-form" type="submit" disabled={isSaveDisabled}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              editingRemito ? 'Actualizar Remito' : 'Crear Remito'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RemitoFormModal;
