
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Building2, 
  FileText, 
  Plus, 
  Edit, 
  Trash2, 
  Search, 
  Loader2, 
  Package, 
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar
} from 'lucide-react';
import ProviderFormModal from '@/components/providers/ProviderFormModal';
import RemitoFormModal from '@/components/providers/RemitoFormModal';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import {
  fetchProviders,
  saveProvider,
  updateProvider,
  deleteProvider,
  fetchRemitos,
  saveRemito,
  updateRemito,
  deleteRemito,
  listenToProviders,
  listenToRemitos
} from '@/lib/api/providersApi';
import { format } from 'date-fns';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

function ProvidersPage() {
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [remitos, setRemitos] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [remitosLoading, setRemitosLoading] = useState(false);
  
  const [isProviderModalOpen, setProviderModalOpen] = useState(false);
  const [isRemitoModalOpen, setRemitoModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [editingRemito, setEditingRemito] = useState(null);
  const [providerToDelete, setProviderToDelete] = useState(null);
  const [remitoToDelete, setRemitoToDelete] = useState(null);
  
  const { toast } = useToast();
  const { ready: firebaseReady } = useFirebaseReadiness();

  useEffect(() => {
    if (!firebaseReady) return;
    setLoading(true);
    const unsubscribe = listenToProviders((updatedProviders) => {
      setProviders(updatedProviders);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [firebaseReady]);

  useEffect(() => {
    if (selectedProvider && firebaseReady) {
      setRemitosLoading(true);
      const unsubscribe = listenToRemitos(selectedProvider.id, (updatedRemitos) => {
        setRemitos(updatedRemitos);
        setRemitosLoading(false);
      });

      return () => unsubscribe();
    } else {
      setRemitos([]);
    }
  }, [selectedProvider, firebaseReady]);

  const handleAddProvider = () => {
    setEditingProvider(null);
    setProviderModalOpen(true);
  };

  const handleEditProvider = (provider) => {
    setEditingProvider(provider);
    setProviderModalOpen(true);
  };

  const handleSaveProvider = async (providerData) => {
    if (editingProvider) {
      await updateProvider(editingProvider.id, providerData);
    } else {
      await saveProvider(providerData);
    }
  };

  const handleDeleteProviderRequest = (provider) => {
    setProviderToDelete(provider);
  };

  const confirmDeleteProvider = async () => {
    if (!providerToDelete) return;
    try {
      await deleteProvider(providerToDelete.id);
      toast({
        title: 'Proveedor Eliminado',
        description: `${providerToDelete.nombre} ha sido eliminado correctamente.`,
        className: 'bg-green-50 border-green-200 text-green-800'
      });
      if (selectedProvider?.id === providerToDelete.id) {
        setSelectedProvider(null);
      }
      setProviderToDelete(null);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      setProviderToDelete(null);
    }
  };

  const handleSelectProvider = (provider) => {
    setSelectedProvider(provider);
  };

  const handleBackToProviders = () => {
    setSelectedProvider(null);
    setRemitos([]);
  };

  const handleAddRemito = () => {
    setEditingRemito(null);
    setRemitoModalOpen(true);
  };

  const handleEditRemito = (remito) => {
    setEditingRemito(remito);
    setRemitoModalOpen(true);
  };

  const handleSaveRemito = async (remitoData) => {
    if (editingRemito) {
      await updateRemito(selectedProvider.id, editingRemito.id, remitoData);
      return { ...remitoData, numeroRemito: editingRemito.numeroRemito || editingRemito.numero || editingRemito.id };
    } else {
      const savedResult = await saveRemito(selectedProvider.id, remitoData);
      return savedResult;
    }
  };

  const handleDeleteRemitoRequest = (remito) => {
    setRemitoToDelete(remito);
  };

  const confirmDeleteRemito = async () => {
    if (!remitoToDelete) return;
    try {
      await deleteRemito(selectedProvider.id, remitoToDelete.id);
      toast({
        title: 'Remito Eliminado',
        description: `Remito #${remitoToDelete.numeroRemito || remitoToDelete.numero || remitoToDelete.id} ha sido eliminado.`,
        className: 'bg-green-50 border-green-200 text-green-800'
      });
      setRemitoToDelete(null);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      setRemitoToDelete(null);
    }
  };

  const filteredProviders = providers.filter(provider =>
    provider.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    provider.cuit?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(provider.id).includes(searchTerm)
  );

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: 'ARS' 
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return format(new Date(dateString), 'dd/MM/yyyy');
    } catch {
      return dateString;
    }
  };

  const totalRemitosAmount = remitos.reduce((sum, remito) => sum + (remito.monto || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 h-full flex flex-col"
    >
      <AnimatePresence mode="wait">
        {!selectedProvider ? (
          <motion.div
            key="providers-list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col h-full"
          >
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                  <Building2 className="w-8 h-8 text-primary" />
                  Gestión de Proveedores
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Administra proveedores y sus remitos de compra
                </p>
              </div>
              <Button onClick={handleAddProvider}>
                <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
              </Button>
            </div>

            <Card className="flex-1 flex flex-col">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Proveedores Registrados</CardTitle>
                    <CardDescription>
                      {providers.length} {providers.length === 1 ? 'proveedor' : 'proveedores'} en total
                    </CardDescription>
                  </div>
                  <div className="relative w-80">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por ID, nombre o CUIT..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 text-gray-900"
                    />
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full">
                  {loading ? (
                    <div className="flex justify-center items-center h-64">
                      <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    </div>
                  ) : filteredProviders.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Package className="w-16 h-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">No hay proveedores registrados</p>
                      <p className="text-sm mt-2">Comienza agregando un nuevo proveedor</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="font-semibold w-[80px]">ID</TableHead>
                          <TableHead className="font-semibold">Nombre</TableHead>
                          <TableHead className="font-semibold">Teléfono</TableHead>
                          <TableHead className="font-semibold">Email</TableHead>
                          <TableHead className="font-semibold">CUIT</TableHead>
                          <TableHead className="text-right font-semibold">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProviders.map((provider) => (
                          <TableRow 
                            key={provider.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleSelectProvider(provider)}
                          >
                            <TableCell className="font-mono text-primary font-semibold">
                              #{provider.id}
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-primary" />
                                {provider.nombre}
                              </div>
                            </TableCell>
                            <TableCell>
                              {provider.telefono ? (
                                <div className="flex items-center gap-1 text-sm">
                                  <Phone className="w-3 h-3" />
                                  {provider.telefono}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {provider.email ? (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail className="w-3 h-3" />
                                  {provider.email}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{provider.cuit || '-'}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditProvider(provider);
                                  }}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteProviderRequest(provider);
                                  }}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="remitos-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex flex-col h-full"
          >
            <div className="mb-6">
              <Button variant="outline" onClick={handleBackToProviders} className="mb-4">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver a Proveedores
              </Button>
              
              <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                <CardContent className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <Badge variant="secondary" className="text-lg px-3 py-1 font-mono">
                          ID: {selectedProvider.id}
                        </Badge>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                          <Building2 className="w-7 h-7 text-primary" />
                          {selectedProvider.nombre}
                        </h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {selectedProvider.telefono && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">{selectedProvider.telefono}</span>
                          </div>
                        )}
                        {selectedProvider.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">{selectedProvider.email}</span>
                          </div>
                        )}
                        {selectedProvider.direccion && (
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">{selectedProvider.direccion}</span>
                          </div>
                        )}
                        {selectedProvider.cuit && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">CUIT:</span>
                            <span className="text-sm">{selectedProvider.cuit}</span>
                          </div>
                        )}
                      </div>
                      {selectedProvider.notas && (
                        <div className="mt-4 p-3 bg-white/60 rounded-lg">
                          <p className="text-sm text-muted-foreground font-medium mb-1">Notas:</p>
                          <p className="text-sm">{selectedProvider.notas}</p>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="mb-2">
                        {remitos.length} {remitos.length === 1 ? 'remito' : 'remitos'}
                      </Badge>
                      <div className="text-sm text-muted-foreground">Total:</div>
                      <div className="text-2xl font-bold text-primary">
                        {formatCurrency(totalRemitosAmount)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="flex-1 flex flex-col">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Remitos
                    </CardTitle>
                    <CardDescription>
                      Historial de remitos y facturas del proveedor
                    </CardDescription>
                  </div>
                  <Button onClick={handleAddRemito}>
                    <Plus className="mr-2 h-4 w-4" /> Nuevo Remito
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full">
                  {remitosLoading ? (
                    <div className="flex justify-center items-center h-64">
                      <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    </div>
                  ) : remitos.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-medium">No hay remitos registrados</p>
                      <p className="text-sm mt-2">Agrega el primer remito para este proveedor</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="font-semibold">Número</TableHead>
                          <TableHead className="font-semibold">Fecha</TableHead>
                          <TableHead className="font-semibold">Descripción</TableHead>
                          <TableHead className="font-semibold text-center">Items</TableHead>
                          <TableHead className="font-semibold text-right">Monto</TableHead>
                          <TableHead className="text-right font-semibold">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {remitos.map((remito) => (
                          <TableRow key={remito.id} className="hover:bg-muted/50">
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-primary" />
                                #{remito.numeroRemito || remito.numero || remito.id}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1 text-sm">
                                <Calendar className="w-3 h-3" />
                                {formatDate(remito.fecha)}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm max-w-xs truncate">
                              {remito.descripcion || '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="ghost" className="h-8 p-0" title="Ver items">
                                    <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
                                      {remito.items?.length || 0}
                                    </Badge>
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 p-4">
                                  <div className="space-y-3">
                                    <h4 className="font-semibold text-sm border-b pb-2 text-primary">Items del Remito</h4>
                                    {remito.items && remito.items.length > 0 ? (
                                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {remito.items.map((item, idx) => (
                                          <div key={idx} className="text-sm flex flex-col pb-2 border-b last:border-0 last:pb-0">
                                            <div className="flex justify-between items-start font-medium text-gray-900">
                                              <span className="flex-1 break-words mr-2">{item.descripcion}</span>
                                            </div>
                                            <div className="flex justify-between text-muted-foreground mt-1">
                                              <span>{item.cantidad} und. x {formatCurrency(item.precioUnitario)}</span>
                                              <span className="font-medium text-gray-700">{formatCurrency((item.cantidad || 0) * (item.precioUnitario || 0))}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground italic">Sin items especificados.</p>
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-primary">
                              {formatCurrency(remito.monto)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditRemito(remito)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteRemitoRequest(remito)}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <ProviderFormModal
        isOpen={isProviderModalOpen}
        onClose={() => {
          setProviderModalOpen(false);
          setEditingProvider(null);
        }}
        onSave={handleSaveProvider}
        editingProvider={editingProvider}
      />

      <RemitoFormModal
        isOpen={isRemitoModalOpen}
        onClose={() => {
          setRemitoModalOpen(false);
          setEditingRemito(null);
        }}
        onSave={handleSaveRemito}
        editingRemito={editingRemito}
        providerName={selectedProvider?.nombre}
        providerId={selectedProvider?.id}
      />

      <ConfirmationDialog
        isOpen={!!providerToDelete}
        onClose={() => setProviderToDelete(null)}
        onConfirm={confirmDeleteProvider}
        title={`¿Eliminar proveedor "${providerToDelete?.nombre}"?`}
        description="Esta acción eliminará el proveedor y todos sus remitos asociados. Esta acción no se puede deshacer."
      />

      <ConfirmationDialog
        isOpen={!!remitoToDelete}
        onClose={() => setRemitoToDelete(null)}
        onConfirm={confirmDeleteRemito}
        title={`¿Eliminar remito #${remitoToDelete?.numeroRemito || remitoToDelete?.numero || remitoToDelete?.id}?`}
        description="Esta acción eliminará permanentemente el remito. No se puede deshacer."
      />
    </motion.div>
  );
}

export default ProvidersPage;
