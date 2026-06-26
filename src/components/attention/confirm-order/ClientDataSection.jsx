import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { User, Phone, Home, MessageSquare, MapPin, FileText, Bike, Store, Loader2, Edit, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { fetchClientByPhone, saveClient } from '@/lib/api/clientsApi';

const ClientDataSection = ({
  customerPhone, setCustomerPhone,
  customerName, setCustomerName,
  customerAddress, setCustomerAddress,
  customerEntrecalle1, setCustomerEntrecalle1,
  customerEntrecalle2, setCustomerEntrecalle2,
  observation, setObservation,
  orderType, setOrderType,
  emiteFactura, setEmiteFactura,
  isEditingClientData
}) => {
  const { toast } = useToast();
  const debounceTimeout = useRef(null);
  const phoneInputRef = useRef(null);
  const [isSearchingClient, setIsSearchingClient] = useState(false);
  const [isPhoneEditable, setIsPhoneEditable] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [originalPhone, setOriginalPhone] = useState('');
  
  // Track if update is internal (typing) or external (prop change)
  const isInternalUpdate = useRef(false);

  // Initialize/Reset editable state based on phone content
  useEffect(() => {
    if (!isInternalUpdate.current) {
        // External update (load order, reset, etc.)
        if (customerPhone && customerPhone.length > 0) {
            setIsPhoneEditable(false);
            setOriginalPhone(''); // Reset original phone context on new external load
        } else {
            setIsPhoneEditable(true);
            setOriginalPhone('');
        }
    }
    // Reset flag
    isInternalUpdate.current = false;
  }, [customerPhone]);

  const searchClient = useCallback(async (phone) => {
    if (phone.length < 7) return;
    setIsSearchingClient(true);
    try {
      const clientData = await fetchClientByPhone(phone);
      if (clientData) {
        setCustomerName(clientData.nombre || '');
        setCustomerAddress(clientData.direccion || '');
        setCustomerEntrecalle1(clientData.entrecalle1 || '');
        setCustomerEntrecalle2(clientData.entrecalle2 || '');
        toast({
          title: "Cliente encontrado",
          description: `Datos de ${clientData.nombre} cargados.`,
        });
      } else {
        // Only clear if we really didn't find anything and we are in a "fresh" search
        // For editing flow, we might want to keep existing data?
        // Current logic: clear it.
        setCustomerName('');
        setCustomerAddress('');
        setCustomerEntrecalle1('');
        setCustomerEntrecalle2('');
      }
    } catch (error) {
      console.error("Error searching client:", error);
    } finally {
      setIsSearchingClient(false);
    }
  }, [toast, setCustomerName, setCustomerAddress, setCustomerEntrecalle1, setCustomerEntrecalle2]);

  const handlePhoneChange = (e) => {
    isInternalUpdate.current = true; // Mark as internal typing
    const phone = e.target.value;
    setCustomerPhone(phone);
    
    // When editing manually with existing data (explicit edit mode), preserve the form data
    if (originalPhone && customerName && customerName.trim().length > 0) {
        return;
    }

    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    debounceTimeout.current = setTimeout(() => {
      searchClient(phone);
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);

  const enablePhoneEditing = (e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    setOriginalPhone(customerPhone);
    setIsPhoneEditable(true);
    // Slight delay to allow render to switch from readOnly state before focusing
    setTimeout(() => {
      if (phoneInputRef.current) {
        phoneInputRef.current.focus();
      }
    }, 50);
  };

  const cancelPhoneEditing = () => {
      // Restore original phone
      setCustomerPhone(originalPhone);
      setOriginalPhone(''); // Clear context
      setIsPhoneEditable(false);
  };

  const savePhoneChange = async () => {
      if (!customerPhone || customerPhone.length < 4) {
          toast({ variant: "destructive", title: "Teléfono inválido", description: "Ingrese un número válido." });
          return;
      }
      
      setIsSavingClient(true);
      try {
          await saveClient({
              phone: customerPhone,
              nombre: customerName,
              direccion: customerAddress,
              entrecalle1: customerEntrecalle1,
              entrecalle2: customerEntrecalle2
          });
          toast({ title: "Guardado", description: "Teléfono actualizado correctamente." });
          setIsPhoneEditable(false);
          setOriginalPhone(''); // Clear context after save
      } catch (error) {
          console.error(error);
          toast({ variant: "destructive", title: "Error", description: "No se pudo guardar el cliente." });
      } finally {
          setIsSavingClient(false);
      }
  };

  // Determine if input should look editable
  const isInputActive = isPhoneEditable;
  // Show Save/Cancel controls ONLY if we are in explicit edit mode (have original phone)
  // If we are just typing a new number from scratch, we don't show these buttons.
  const showEditControls = isPhoneEditable && originalPhone;

  return (
    <div className="col-span-1 space-y-3 p-3 border rounded-lg bg-slate-50">
      <h3 className="text-md font-semibold text-slate-700">Datos del Cliente</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="relative flex items-center gap-2 col-span-1">
           <div className="relative flex-grow">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                id="phone" 
                ref={phoneInputRef}
                placeholder="Teléfono" 
                value={customerPhone} 
                onChange={handlePhoneChange} 
                className={`pl-9 h-9 transition-colors duration-200 ${!isInputActive ? 'bg-gray-100 text-gray-500 cursor-not-allowed border-dashed' : 'bg-white border-solid'}`}
                readOnly={!isInputActive}
                onKeyDown={(e) => {
                    if(e.key === 'Enter') {
                        if (showEditControls) savePhoneChange();
                    }
                }}
              />
              {isSearchingClient && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />}
           </div>
           
           {!isInputActive && customerPhone && customerPhone.length > 0 ? (
               <Button 
                 type="button"
                 variant="ghost" 
                 size="icon" 
                 className="h-9 w-9 shrink-0 text-gray-500 hover:text-primary hover:bg-gray-200"
                 onClick={enablePhoneEditing}
                 title="Editar teléfono"
               >
                 <Edit className="h-4 w-4" />
               </Button>
           ) : showEditControls ? (
               <div className="flex gap-1">
                   <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="h-9 w-9 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-100"
                     onClick={savePhoneChange}
                     disabled={isSavingClient}
                     title="Guardar cambio"
                   >
                     {isSavingClient ? <Loader2 className="h-4 w-4 animate-spin"/> : <Check className="h-4 w-4" />}
                   </Button>
                   <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="h-9 w-9 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-100"
                     onClick={cancelPhoneEditing}
                     disabled={isSavingClient}
                     title="Cancelar"
                   >
                     <X className="h-4 w-4" />
                   </Button>
               </div>
           ) : null}
        </div>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input id="name" placeholder="Nombre" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="pl-9 h-9" />
        </div>
      </div>
      <AnimatePresence>
        {orderType === 'ENVIO' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden space-y-3"
          >
            <div className="relative">
              <Home className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input id="address" placeholder="Dirección" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="entrecalle1" placeholder="Entrecalle 1" value={customerEntrecalle1} onChange={(e) => setCustomerEntrecalle1(e.target.value)} className="pl-9 h-9" />
              </div>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input id="entrecalle2" placeholder="Entrecalle 2" value={customerEntrecalle2} onChange={(e) => setCustomerEntrecalle2(e.target.value)} className="pl-9 h-9" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative">
        <MessageSquare className="absolute left-3 top-2 h-4 w-4 text-slate-400" />
        <Textarea id="observation" placeholder="Observaciones..." value={observation} onChange={(e) => setObservation(e.target.value)} className="pl-9 text-sm" rows={2}/>
      </div>
      <div className="flex items-center space-x-2 p-1.5 bg-blue-50 border border-blue-200 rounded-lg">
          <Checkbox id="emiteFactura" checked={emiteFactura} onCheckedChange={setEmiteFactura} />
          <Label htmlFor="emiteFactura" className="font-medium text-blue-800 text-sm flex items-center gap-2 cursor-pointer">
            <FileText className="w-4 h-4" />
            Emite Factura
          </Label>
      </div>
      {!isEditingClientData && (
        <div className="flex justify-center">
          <div className="inline-flex rounded-md shadow-sm bg-gray-100 p-1">
            <Button
              variant={orderType === 'ENVIO' ? 'default' : 'ghost'}
              size="sm"
              className={`rounded-md px-4 py-1 transition-all duration-200 ${orderType === 'ENVIO' ? 'bg-primary text-primary-foreground shadow-md' : 'text-gray-600'}`}
              onClick={() => setOrderType('ENVIO')}
            >
              <Bike className="mr-2 h-4 w-4" />
              Delivery
            </Button>
            <Button
              variant={orderType === 'RETIRO' ? 'default' : 'ghost'}
              size="sm"
              className={`rounded-md px-4 py-1 transition-all duration-200 ${orderType === 'RETIRO' ? 'bg-primary text-primary-foreground shadow-md' : 'text-gray-600'}`}
              onClick={() => setOrderType('RETIRO')}
            >
              <Store className="mr-2 h-4 w-4" />
              Retiro en Local
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDataSection;