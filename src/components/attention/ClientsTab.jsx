import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { fetchClients, saveClient, deleteClient } from '@/lib/api/clientsApi';
import { Loader2, User, Home, Phone, Edit, Trash2, Search, MapPin, AlertCircle } from 'lucide-react';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';

const ClientFormModal = ({ isOpen, onOpenChange, client, onSave }) => {
  const [formData, setFormData] = useState({ nombre: '', direccion: '', entrecalle1: '', entrecalle2: '', phone: '' });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setFormData({ 
        phone: client.phone || '',
        nombre: client.nombre || '', 
        direccion: client.direccion || '',
        entrecalle1: client.entrecalle1 || '',
        entrecalle2: client.entrecalle2 || '',
      });
    } else {
      setFormData({ phone: '', nombre: '', direccion: '', entrecalle1: '', entrecalle2: '' });
    }
  }, [client]);

  const handleSave = async () => {
    if (!formData.phone || formData.phone.trim() === '') {
        alert("El teléfono es obligatorio.");
        return;
    }
    setIsSaving(true);
    await onSave({ ...client, ...formData });
    setIsSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
          <DialogDescription>
            {client ? `Editando los datos del cliente con teléfono ${client.phone}.` : 'Agregando un nuevo cliente. El teléfono es obligatorio.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Teléfono (ID) <span className="text-red-500">*</span></Label>
            <Input 
                id="phone" 
                value={formData.phone} 
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })} 
                disabled={!!client} 
                className={!!client ? "bg-gray-100" : ""}
                placeholder="Ej: 1122334455"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" value={formData.nombre} onChange={(e) => setFormData({ ...formData, nombre: e.target.value })} placeholder="Ej: Juan Pérez" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" value={formData.direccion} onChange={(e) => setFormData({ ...formData, direccion: e.target.value })} placeholder="Ej: Av. San Martín 123" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entrecalle1">Entrecalle 1</Label>
            <Input id="entrecalle1" value={formData.entrecalle1} onChange={(e) => setFormData({ ...formData, entrecalle1: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entrecalle2">Entrecalle 2</Label>
            <Input id="entrecalle2" value={formData.entrecalle2} onChange={(e) => setFormData({ ...formData, entrecalle2: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={isSaving || !formData.phone}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function ClientsTab() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingClient, setEditingClient] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);
  const { toast } = useToast();

  const loadClients = useCallback(async () => {
    console.log("[ClientsTab] Montando e iniciando carga de clientes...");
    setLoading(true);
    setError(null);
    try {
      const fetchedClients = await fetchClients();
      console.log(`[ClientsTab] Clientes cargados en el estado: ${fetchedClients.length}`);
      setClients(fetchedClients);
    } catch (err) {
      console.error("[ClientsTab] Error en carga:", err);
      setError("No se pudieron obtener los datos de los clientes. Verifique su conexión.");
      toast({
        variant: 'destructive',
        title: 'Error al cargar clientes',
        description: 'No se pudieron obtener los datos de los clientes.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const handleEdit = (client) => {
    setEditingClient(client);
    setIsModalOpen(true);
  };

  const handleNewClient = () => {
    setEditingClient(null);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = (client) => {
    setClientToDelete(client);
  };

  const confirmDelete = async () => {
    if (!clientToDelete) return;
    try {
      await deleteClient(clientToDelete.phone);
      toast({
        title: 'Cliente eliminado',
        description: `El cliente ${clientToDelete.nombre || clientToDelete.phone} ha sido eliminado.`,
        className: 'bg-green-500 text-white',
      });
      setClientToDelete(null);
      loadClients();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error al eliminar',
        description: 'No se pudo eliminar el cliente.',
      });
      setClientToDelete(null);
    }
  };

  const handleSave = async (clientData) => {
    try {
      await saveClient(clientData);
      toast({
        title: 'Cliente guardado',
        description: 'Los datos del cliente se han actualizado correctamente.',
        className: 'bg-green-500 text-white',
      });
      loadClients();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: 'No se pudieron guardar los datos del cliente.',
      });
    }
  };

  // Safe filtering memoized to prevent UI freezes on bad data
  const filteredClients = useMemo(() => {
    if (!clients || !Array.isArray(clients)) return [];
    
    return clients.filter((client) => {
      if (!client) return false;
      const term = searchTerm.toLowerCase().trim();
      if (!term) return true; // Si no hay busqueda, retornar todo
      
      const nombre = (client.nombre || '').toLowerCase();
      const phone = (client.phone || '').toLowerCase();
      const direccion = (client.direccion || '').toLowerCase();
      const entrecalle1 = (client.entrecalle1 || '').toLowerCase();
      const entrecalle2 = (client.entrecalle2 || '').toLowerCase();

      return nombre.includes(term) ||
             phone.includes(term) ||
             direccion.includes(term) ||
             entrecalle1.includes(term) ||
             entrecalle2.includes(term);
    });
  }, [clients, searchTerm]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-full flex flex-col p-4 bg-white rounded-lg shadow-sm"
      >
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
              <h2 className="text-2xl font-bold text-gray-800">Gestión de Clientes</h2>
              <p className="text-sm text-gray-500">Administre la base de datos de clientes para envíos.</p>
          </div>
          <div className="flex items-center space-x-2 w-full md:w-auto">
            <div className="relative flex-grow md:flex-grow-0">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <Input
                placeholder="Buscar por nombre, tel, dire..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-full md:w-64"
              />
            </div>
            <Button onClick={handleNewClient} className="bg-orange-600 hover:bg-orange-700 text-white shrink-0">
                Nuevo Cliente
            </Button>
            <Button variant="outline" onClick={loadClients} disabled={loading} className="shrink-0" title="Recargar">
                <Loader2 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {error ? (
           <div className="flex-grow flex flex-col items-center justify-center p-8 text-center bg-red-50 rounded-lg border border-red-200">
               <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
               <h3 className="text-lg font-semibold text-red-800 mb-2">Error de conexión</h3>
               <p className="text-red-600 mb-4">{error}</p>
               <Button onClick={loadClients} variant="outline" className="border-red-300 text-red-700 hover:bg-red-100">Reintentar</Button>
           </div>
        ) : (
            <div className="flex-grow overflow-auto border border-gray-200 rounded-lg shadow-inner bg-gray-50/50 relative">
            <table className="w-full text-sm text-left text-gray-600">
                <thead className="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10 shadow-sm">
                <tr>
                    <th scope="col" className="px-6 py-4 font-bold"><Phone className="inline-block mr-1.5" size={14} /> Teléfono</th>
                    <th scope="col" className="px-6 py-4 font-bold"><User className="inline-block mr-1.5" size={14} /> Nombre</th>
                    <th scope="col" className="px-6 py-4 font-bold"><Home className="inline-block mr-1.5" size={14} /> Dirección</th>
                    <th scope="col" className="px-6 py-4 font-bold"><MapPin className="inline-block mr-1.5" size={14} /> Entrecalles</th>
                    <th scope="col" className="px-6 py-4 font-bold text-center">Acciones</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                {loading && clients.length === 0 ? (
                    <tr>
                    <td colSpan="5" className="text-center py-20">
                        <div className="flex flex-col items-center justify-center space-y-4">
                            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                            <p className="text-gray-500 font-medium">Cargando base de datos de clientes...</p>
                        </div>
                    </td>
                    </tr>
                ) : filteredClients.length === 0 ? (
                    <tr>
                    <td colSpan="5" className="text-center py-16 text-gray-500">
                        <div className="flex flex-col items-center justify-center">
                            <Search className="h-10 w-10 text-gray-300 mb-3" />
                            <p className="font-medium text-lg text-gray-600">No se encontraron clientes</p>
                            {searchTerm && <p className="text-sm mt-1">Modifique los filtros de búsqueda.</p>}
                        </div>
                    </td>
                    </tr>
                ) : (
                    filteredClients.map((client) => (
                    <tr key={client.phone} className="hover:bg-orange-50/50 transition-colors">
                        <td className="px-6 py-3 font-bold text-gray-900 whitespace-nowrap">{client.phone}</td>
                        <td className="px-6 py-3 font-medium text-gray-800">{client.nombre || <span className="text-gray-400 italic">Sin nombre</span>}</td>
                        <td className="px-6 py-3">{client.direccion || '-'}</td>
                        <td className="px-6 py-3">
                            <div className="text-xs">
                                {client.entrecalle1 && <div>1: {client.entrecalle1}</div>}
                                {client.entrecalle2 && <div>2: {client.entrecalle2}</div>}
                                {!client.entrecalle1 && !client.entrecalle2 && <span className="text-gray-400">-</span>}
                            </div>
                        </td>
                        <td className="px-6 py-3 text-center">
                            <div className="flex items-center justify-center space-x-2">
                                <Button variant="outline" size="sm" onClick={() => handleEdit(client)} className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200">
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDeleteRequest(client)} className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </td>
                    </tr>
                    ))
                )}
                </tbody>
            </table>
            </div>
        )}
      </motion.div>
      <ClientFormModal isOpen={isModalOpen} onOpenChange={setIsModalOpen} client={editingClient} onSave={handleSave} />
      <ConfirmationDialog
        isOpen={!!clientToDelete}
        onClose={() => setClientToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar cliente?`}
        description={`¿Está seguro que desea eliminar a "${clientToDelete?.nombre || 'este cliente'}" (Tel: ${clientToDelete?.phone})? Esta acción no se puede deshacer.`}
      />
    </>
  );
}

export default ClientsTab;