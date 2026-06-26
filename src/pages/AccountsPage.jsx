import React, { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { saveAccount, deleteAccount, setFavoriteAccount, fetchAccounts } from '@/lib/api/accountsApi';
import { savePrepaymentForApp } from '@/lib/api/prepaymentApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Edit, Trash2, Loader2, CreditCard, User, AtSign, Star, History, AlertCircle, RefreshCw } from 'lucide-react';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import { cn, getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import PrepaymentHistoryModal from '@/components/prepayment/PrepaymentHistoryModal';
import { useDataLoader } from '@/hooks/useDataLoader';
import ErrorBoundary from '@/components/ErrorBoundary';

const ACCOUNT_NAMES = [
  "Transferencia",
  "Transferencia 2",
  "Transferencia 3",
  "Mercado Pago",
  "Cuenta DNI",
  "Banco 1",
  "Banco 2",
  "PREPAGO PEDIDOSYA",
  "PREPAGO RAPPI"
];

const defaultAccountData = { nombre: '', aNombreDe: '', alias: '', imprimeFactura: false, isFavorite: false };

function AccountsPageContent() {
  const { toast } = useToast();
  
  // Use new useDataLoader hook
  const { 
    data: accounts, 
    setData: setAccounts, 
    loading, 
    error, 
    loadData: reloadAccounts 
  } = useDataLoader(fetchAccounts, { 
    initialData: [],
    componentName: 'AccountsPage'
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountData, setAccountData] = useState(defaultAccountData);
  const [isSaving, setIsSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isPrepaymentModalOpen, setIsPrepaymentModalOpen] = useState(false);
  const [prepaymentAmount, setPrepaymentAmount] = useState('');
  const [selectedPrepaymentType, setSelectedPrepaymentType] = useState('');

  // Initial load
  React.useEffect(() => {
    reloadAccounts();
  }, [reloadAccounts]);

  const handleSetFavorite = useCallback(async (accountId) => {
    try {
      await setFavoriteAccount(accountId, accounts);
      
      // Optimistic UI update
      setAccounts(prev => prev.map(acc => ({
        ...acc,
        isFavorite: acc.id === accountId
      })));

      const account = accounts.find(acc => acc.id === accountId);
      if (account) {
        toast({
          title: "Favorita actualizada",
          description: `${account.nombre} es ahora la cuenta favorita.`,
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo actualizar la cuenta favorita.",
      });
    }
  }, [accounts, toast, setAccounts]);

  const handleOpenModal = useCallback((account = null) => {
    setEditingAccount(account);
    setAccountData(account ? { 
        nombre: account.nombre || '', 
        aNombreDe: account.aNombreDe || '', 
        alias: account.alias || '',
        imprimeFactura: account.imprimeFactura || false,
        isFavorite: account.isFavorite || false,
    } : defaultAccountData);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingAccount(null);
    setAccountData(defaultAccountData);
  }, []);

  const handleInputChange = useCallback((e) => {
    const { id, value } = e.target;
    setAccountData(prev => ({ ...prev, [id]: value }));
  }, []);

  const handleSelectChange = useCallback((value) => {
    setAccountData(prev => ({ ...prev, nombre: value }));
    if (value === 'PREPAGO PEDIDOSYA' || value === 'PREPAGO RAPPI') {
      setSelectedPrepaymentType(value);
      setPrepaymentAmount('');
      setIsPrepaymentModalOpen(true);
    }
  }, []);
  
  const handleSwitchChange = useCallback((checked) => {
    setAccountData(prev => ({...prev, imprimeFactura: checked}));
  }, []);

  const handleSavePrepayment = useCallback(async (e) => {
    e.preventDefault();
    if (!prepaymentAmount || isNaN(prepaymentAmount) || Number(prepaymentAmount) <= 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Ingrese un monto válido mayor a 0.' });
      return;
    }
    
    setIsSaving(true);
    try {
      const appType = selectedPrepaymentType.replace('PREPAGO ', '').trim();
      const currentShiftDate = formatDateForFirebase(getOperationalDate());
      
      await savePrepaymentForApp(appType, prepaymentAmount, currentShiftDate);
      
      toast({ 
        title: "Prepago Guardado", 
        description: `Se registró prepago de ${appType} por $${prepaymentAmount}.` 
      });
      
      setIsPrepaymentModalOpen(false);
      
      if (!editingAccount) {
        handleCloseModal();
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo guardar el prepago." });
    } finally {
      setIsSaving(false);
    }
  }, [prepaymentAmount, selectedPrepaymentType, editingAccount, handleCloseModal, toast]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!accountData.nombre || !accountData.nombre.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'El nombre de la cuenta no puede estar vacío.' });
      return;
    }
    setIsSaving(true);
    try {
      const dataToSave = { ...editingAccount, ...accountData };
      if (!editingAccount && accounts.length === 0) {
        dataToSave.isFavorite = true;
      }
      await saveAccount(dataToSave);
      toast({ title: "Éxito", description: `Cuenta "${accountData.nombre}" guardada correctamente.` });
      handleCloseModal();
      reloadAccounts(); // Reload to get fresh data
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo guardar la cuenta." });
    } finally {
      setIsSaving(false);
    }
  }, [accountData, editingAccount, accounts.length, handleCloseModal, toast, reloadAccounts]);

  const handleDelete = useCallback(async () => {
    if (!itemToDelete) return;
    setIsSaving(true);
    try {
      await deleteAccount(itemToDelete.id);
      toast({ title: "Éxito", description: `Cuenta "${itemToDelete.nombre}" eliminada.` });
      
      if (itemToDelete.isFavorite) {
        const otherAccounts = accounts.filter(a => a.id !== itemToDelete.id);
        if (otherAccounts.length > 0) {
            await setFavoriteAccount(otherAccounts[0].id, otherAccounts);
        }
      }
      setItemToDelete(null);
      reloadAccounts(); // Reload to get fresh data
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "No se pudo eliminar la cuenta." });
    } finally {
      setIsSaving(false);
    }
  }, [itemToDelete, accounts, toast, reloadAccounts]);

  const sortedAccounts = useMemo(() => {
      if (!Array.isArray(accounts)) return [];
      return [...accounts].sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return (a.nombre || '').localeCompare(b.nombre || '');
      });
  }, [accounts]);

  if (loading && accounts.length === 0) {
    return (
        <div className="flex flex-col justify-center items-center h-[50vh] space-y-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">Cargando cuentas...</p>
        </div>
    );
  }

  if (error && accounts.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-[50vh] space-y-4 text-center px-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-bold text-gray-800">Error al cargar</h2>
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => reloadAccounts()} variant="outline" className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" /> Reintentar
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="p-1"
    >
      <Card className="shadow-xl rounded-xl">
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
             <CreditCard className="w-8 h-8 text-primary" />
             <CardTitle className="text-2xl font-bold">Gestión de Cuentas</CardTitle>
             {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full sm:w-auto">
            <Button onClick={() => reloadAccounts()} variant="ghost" size="icon" title="Recargar cuentas">
                <RefreshCw className={cn("h-5 w-5", loading && "animate-spin")} />
            </Button>
            <Button onClick={() => setIsHistoryOpen(true)} variant="outline" className="w-full sm:w-auto border-primary text-primary hover:bg-primary/10">
              <History className="mr-2 h-4 w-4" /> Historial Prepago
            </Button>
            <Button onClick={() => handleOpenModal()} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground">
              <PlusCircle className="mr-2 h-4 w-4" /> Nueva Cuenta
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedAccounts.map((account) => {
              const isFavorite = account.isFavorite;
              return (
              <motion.div 
                key={account.id} 
                layout 
                className={cn(
                  "relative p-4 rounded-lg border transition-all duration-300",
                  isFavorite ? 'bg-primary/5 border-primary shadow-md' : 'bg-card hover:shadow-md border-gray-200'
                )}
              >
                <div className="flex flex-col pr-24">
                  <p className="font-bold text-lg text-gray-800 truncate" title={account.nombre}>{account.nombre}</p>
                  {account.aNombreDe && <p className="text-sm flex items-center mt-1 text-gray-600 truncate" title={account.aNombreDe}><User size={14} className="mr-2 opacity-70 flex-shrink-0"/>{account.aNombreDe}</p>}
                  {account.alias && <p className="text-sm flex items-center text-gray-600 truncate" title={account.alias}><AtSign size={14} className="mr-2 opacity-70 flex-shrink-0"/>{account.alias}</p>}
                </div>
                <div className="absolute top-3 right-3 flex items-center space-x-1 bg-white/80 rounded-md backdrop-blur-sm p-1">
                  <Button variant="ghost" size="icon" onClick={() => handleSetFavorite(account.id)} className={cn("h-8 w-8 transition-colors", isFavorite ? 'text-yellow-500 hover:text-yellow-600' : 'text-gray-300 hover:text-yellow-400')}>
                    <Star className={cn("h-5 w-5", isFavorite && "fill-current")} />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleOpenModal(account)} className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setItemToDelete(account)} className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )})}
             {sortedAccounts.length === 0 && !loading && !error && (
                <div className="col-span-full text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">No hay cuentas configuradas.</p>
                    <p className="text-gray-400 text-sm mt-1">¡Agrega tu primera cuenta para empezar!</p>
                    <Button onClick={() => handleOpenModal()} variant="outline" className="mt-4">
                        <PlusCircle className="mr-2 h-4 w-4" /> Agregar Cuenta
                    </Button>
                </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleCloseModal()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Editar Cuenta' : 'Nueva Cuenta'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre de la Cuenta <span className="text-red-500">*</span></Label>
                <Select onValueChange={handleSelectChange} value={accountData.nombre}>
                  <SelectTrigger id="nombre" className={cn(!accountData.nombre && "text-muted-foreground")}>
                    <SelectValue placeholder="Seleccione un nombre de cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_NAMES.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="aNombreDe">A nombre de (Opcional)</Label>
                <Input
                  id="aNombreDe"
                  value={accountData.aNombreDe}
                  onChange={handleInputChange}
                  placeholder="Ej: Juan Pérez"
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="alias">Alias / CBU (Opcional)</Label>
                <Input
                  id="alias"
                  value={accountData.alias}
                  onChange={handleInputChange}
                  placeholder="Ej: juan.perez.mp"
                  maxLength={100}
                />
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="imprimeFactura"
                  checked={accountData.imprimeFactura}
                  onCheckedChange={handleSwitchChange}
                />
                <Label htmlFor="imprimeFactura" className="cursor-pointer">Imprime Factura</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={handleCloseModal}>Cancelar</Button>
              <Button type="submit" disabled={isSaving || !accountData.nombre || !accountData.nombre.trim()}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isPrepaymentModalOpen} onOpenChange={setIsPrepaymentModalOpen}>
        <DialogContent className="sm:max-w-[425px] z-[60]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Registrar {selectedPrepaymentType}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSavePrepayment}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Fecha y Hora</Label>
                <Input disabled value={new Date().toLocaleString('es-AR')} className="bg-muted text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monto">Monto del Prepago <span className="text-red-500">*</span></Label>
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                    <Input
                        id="monto"
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="pl-7 text-gray-900 font-bold text-lg"
                        value={prepaymentAmount}
                        onChange={(e) => setPrepaymentAmount(e.target.value)}
                        placeholder="Ej: 15000"
                        autoFocus
                        required
                    />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setIsPrepaymentModalOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isSaving || !prepaymentAmount}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Registrar Prepago
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isHistoryOpen && (
          <PrepaymentHistoryModal 
            isOpen={isHistoryOpen} 
            onClose={() => setIsHistoryOpen(false)} 
          />
      )}

      <ConfirmationDialog
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleDelete}
        title={`¿Eliminar "${itemToDelete?.nombre}"?`}
        description="Esta acción no se puede deshacer. Se eliminará permanentemente la cuenta de la lista."
        confirmText="Eliminar Cuenta"
        isDestructive={true}
        isLoading={isSaving}
      />
    </motion.div>
  );
}

export default function AccountsPage() {
  return (
    <ErrorBoundary componentName="AccountsPage">
      <AccountsPageContent />
    </ErrorBoundary>
  );
}