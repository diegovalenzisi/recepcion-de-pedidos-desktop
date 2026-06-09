import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { fetchDeliverers, saveDeliverer, deleteDeliverer } from '@/lib/api/deliverersApi';
import { Loader2, Bike, Edit, Trash2, Search, UserPlus, User, Home, Phone, FileText, CreditCard, Hash } from 'lucide-react';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';

const DelivererFormModal = ({ isOpen, onOpenChange, deliverer, onSave }) => {
  const [formData, setFormData] = useState({
    id: null,
    nombre: '',
    apellido: '',
    direccion: '',
    telefono: '',
    dni: '',
    patente: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (deliverer) {
      setFormData({
        id: deliverer.id || null,
        nombre: deliverer.nombre || '',
        apellido: deliverer.apellido || '',
        direccion: deliverer.direccion || '',
        telefono: deliverer.telefono || '',
        dni: deliverer.dni || '',
        patente: deliverer.patente || ''
      });
    } else {
      setFormData({ id: null, nombre: '', apellido: '', direccion: '', telefono: '', dni: '', patente: '' });
    }
    setErrors({});
  }, [deliverer, isOpen]);

  const validate = () => {
    const newErrors = {};
    if (!formData.nombre) newErrors.nombre = 'El nombre es obligatorio.';
    if (!formData.apellido) newErrors.apellido = 'El apellido es obligatorio.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setIsSaving(true);
    await onSave(formData, !!deliverer);
    setIsSaving(false);
    onOpenChange(false);
  };

  const handleChange = (e) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
    if(errors[id]) {
        const newErrors = {...errors};
        delete newErrors[id];
        setErrors(newErrors);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{deliverer ? 'Editar Repartidor' : 'Nuevo Repartidor'}</DialogTitle>
          <DialogDescription>Completa los datos del repartidor. Nombre y apellido son obligatorios.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="space-y-1">
             <Label htmlFor="id">ID Repartidor</Label>
             <Input id="id" value={formData.id || 'Automático'} disabled />
          </div>
           <div className="space-y-1">
            <Label htmlFor="dni">DNI</Label>
            <Input id="dni" value={formData.dni} onChange={handleChange} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nombre">Nombre*</Label>
            <Input id="nombre" value={formData.nombre} onChange={handleChange} />
            {errors.nombre && <p className="text-red-500 text-xs">{errors.nombre}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="apellido">Apellido*</Label>
            <Input id="apellido" value={formData.apellido} onChange={handleChange} />
            {errors.apellido && <p className="text-red-500 text-xs">{errors.apellido}</p>}
          </div>
          <div className="space-y-1 col-span-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" value={formData.direccion} onChange={handleChange} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="telefono">Teléfono</Label>
            <Input id="telefono" value={formData.telefono} onChange={handleChange} />
          </div>
           <div className="space-y-1">
            <Label htmlFor="patente">Patente</Label>
            <Input id="patente" value={formData.patente} onChange={handleChange} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};


function DeliverersTab() {
  const [deliverers, setDeliverers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingDeliverer, setEditingDeliverer] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [delivererToDelete, setDelivererToDelete] = useState(null);
  const { toast } = useToast();

  const loadDeliverers = useCallback(async () => {
    setLoading(true);
    try {
      const fetchedDeliverers = await fetchDeliverers();
      setDeliverers(fetchedDeliverers);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error al cargar repartidores',
        description: 'No se pudieron obtener los datos de los repartidores.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDeliverers();
  }, [loadDeliverers]);

  const handleAdd = () => {
    setEditingDeliverer(null);
    setIsModalOpen(true);
  };
  
  const handleEdit = (deliverer) => {
    setEditingDeliverer(deliverer);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = (deliverer) => {
    setDelivererToDelete(deliverer);
  };

  const confirmDelete = async () => {
    if (!delivererToDelete) return;
    try {
      await deleteDeliverer(delivererToDelete.id);
      toast({
        title: 'Repartidor eliminado',
        description: `El repartidor ${delivererToDelete.nombre} ${delivererToDelete.apellido} ha sido eliminado.`,
      });
      setDelivererToDelete(null);
      loadDeliverers();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error al eliminar',
        description: 'No se pudo eliminar el repartidor.',
      });
       setDelivererToDelete(null);
    }
  };

  const handleSave = async (delivererData, isEditing) => {
    try {
      await saveDeliverer(delivererData, isEditing);
      toast({
        title: `Repartidor ${isEditing ? 'actualizado' : 'agregado'}`,
        description: 'Los datos del repartidor se han guardado correctamente.',
      });
      loadDeliverers();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: 'No se pudieron guardar los datos del repartidor.',
      });
    }
  };

  const filteredDeliverers = deliverers.filter((d) => {
    if (!d || !d.id) return false;
    const term = searchTerm.toLowerCase();
    const nombre = d.nombre || '';
    const apellido = d.apellido || '';
    const id = d.id ? d.id.toString() : '';
    const dni = d.dni || '';

    return (
      nombre.toLowerCase().includes(term) ||
      apellido.toLowerCase().includes(term) ||
      id.includes(term) ||
      dni.includes(term)
    );
  });

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-full flex flex-col"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Gestión de Repartidores</h2>
          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <Input
                placeholder="Buscar repartidor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
             <Button onClick={handleAdd}>
                <UserPlus className="mr-2 h-4 w-4" /> Nuevo Repartidor
            </Button>
          </div>
        </div>

        <div className="flex-grow overflow-auto p-1">
            {loading ? (
                <div className="flex justify-center items-center h-full">
                    <Loader2 className="h-12 w-12 animate-spin text-orange-500" />
                </div>
            ) : filteredDeliverers.length === 0 ? (
                <div className="text-center py-10 text-gray-500">
                    <Bike size={48} className="mx-auto mb-4" />
                    <p>No se encontraron repartidores.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    <AnimatePresence>
                    {filteredDeliverers.map((d, index) => (
                        <motion.div 
                            key={d.id} 
                            variants={cardVariants}
                            initial="hidden"
                            animate="visible"
                            exit="hidden"
                            transition={{ duration: 0.3, delay: index * 0.05 }}
                            layout
                        >
                            <div className="bg-white rounded-lg shadow-md p-4 flex flex-col h-full border hover:shadow-lg transition-shadow">
                                <div className="flex items-center mb-3">
                                    <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mr-4">
                                        <Bike className="w-6 h-6 text-orange-500" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-gray-800">{d.nombre} {d.apellido}</h3>
                                        <p className="text-sm text-gray-500 flex items-center"><Hash size={12} className="mr-1" /> ID: {d.id}</p>
                                    </div>
                                </div>
                                <div className="space-y-2 text-sm text-gray-700 flex-grow">
                                    <p className="flex items-center"><Phone size={14} className="mr-2 text-gray-400"/> {d.telefono || 'N/A'}</p>
                                    <p className="flex items-center"><Home size={14} className="mr-2 text-gray-400"/> {d.direccion || 'N/A'}</p>
                                    <p className="flex items-center"><FileText size={14} className="mr-2 text-gray-400"/> DNI: {d.dni || 'N/A'}</p>
                                    <p className="flex items-center"><CreditCard size={14} className="mr-2 text-gray-400"/> Patente: {d.patente || 'N/A'}</p>
                                </div>
                                <div className="mt-4 pt-3 border-t flex justify-end space-x-2">
                                     <Button variant="outline" size="sm" onClick={() => handleEdit(d)}>
                                        <Edit className="h-4 w-4 mr-1" /> Editar
                                    </Button>
                                    <Button variant="destructive" size="sm" onClick={() => handleDeleteRequest(d)}>
                                        <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
      </motion.div>
      <DelivererFormModal 
        isOpen={isModalOpen} 
        onOpenChange={setIsModalOpen} 
        deliverer={editingDeliverer} 
        onSave={handleSave} 
      />
      <ConfirmationDialog
        isOpen={!!delivererToDelete}
        onClose={() => setDelivererToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar a ${delivererToDelete?.nombre} ${delivererToDelete?.apellido}?`}
        description="Esta acción eliminará permanentemente al repartidor del sistema."
      />
    </>
  );
}

export default DeliverersTab;