import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { User, MapPin, Phone, CreditCard, Save, X, Package, FileText, Banknote, Trophy, Gift, ThumbsDown, Info, Loader2, MessageSquare, Database, Snowflake, AlertCircle } from 'lucide-react';
import { fetchEmployees, fetchCategories } from '@/lib/api/hrApi';
import { QRCodeSVG } from 'qrcode.react';

const OrderDetailModal = ({ 
  isOpen, 
  onOpenChange, 
  orderData, 
  onConfirm, 
  allowedPaymentMethods = [],
  currentShift 
}) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    client: { name: '', address: '', phone: '', details: '', entrecalle1: '', entrecalle2: '' },
    payment: { method: 'Efectivo', amount: 0, montoAbonado: 0, change: 0 },
    observation: '',
    type: 'Delivery',
    specialDiscount: { type: null, responsible: null },
    heladera: 'NO',
    status: 'ACEPTADO'
  });

  const [prevHeladera, setPrevHeladera] = useState('NO');
  const [specialType, setSpecialType] = useState(null);
  const [responsibleId, setResponsibleId] = useState('');
  const [originalPayment, setOriginalPayment] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // State for HR data
  const [allEmployees, setAllEmployees] = useState([]);
  const [vendorEmployees, setVendorEmployees] = useState([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);

  useEffect(() => {
    const loadHrData = async () => {
        setIsLoadingEmployees(true);
        try {
            const [emps, cats] = await Promise.all([fetchEmployees(), fetchCategories()]);
            
            // Normalize employees and resolve category names
            const formattedEmployees = emps.map(e => {
                let catName = e.categoriaNombre;
                
                if (!catName) {
                    if (e.categoria) {
                        const match = cats.find(c => c.id === e.categoria);
                        if (match) {
                            catName = match.nombre;
                        } else if (typeof e.categoria === 'string') {
                            catName = e.categoria;
                        }
                    }
                }

                return {
                    ...e,
                    id: e.id || e.legajo,
                    fullName: `${e.nombre} ${e.apellido}`,
                    categoriaNombre: catName || ''
                };
            });

            setAllEmployees(formattedEmployees);

            const filtered = formattedEmployees.filter(e => 
                e.categoriaNombre && e.categoriaNombre.toUpperCase() === 'VENDEDOR'
            );
            
            setVendorEmployees(filtered);
        } catch (error) {
            console.error("Error loading employees for modal:", error);
            toast({
                variant: "destructive",
                title: "Error de carga",
                description: "No se pudieron cargar los empleados. Intente nuevamente."
            });
        } finally {
            setIsLoadingEmployees(false);
        }
    };

    if (isOpen) {
        loadHrData();
    }
  }, [isOpen, toast]);

  useEffect(() => {
    if (orderData && isOpen) {
        const totalAmount = orderData.payment?.amount || orderData.payment?.total || 0;
        const change = orderData.payment?.change || 0;
        
        const montoAbonado = orderData.payment?.montoAbonado !== undefined 
            ? orderData.payment?.montoAbonado 
            : (orderData.payment?.payWith || (change > 0 ? totalAmount + change : totalAmount));

        const existingSpecialType = orderData.specialDiscount?.type || null;
        const existingResponsible = orderData.specialDiscount?.responsible?.id || orderData.specialDiscount?.responsible || '';

        const initialPaymentState = {
            method: orderData.payment?.method || 'Efectivo',
            amount: totalAmount,
            montoAbonado: montoAbonado,
            change: change
        };

        const initialHeladera = orderData.heladera === true || orderData.heladera === 'YES' || orderData.heladera === 'SI' ? 'SI' : 'NO';

        setFormData({
            client: {
                name: orderData.client?.name || '',
                address: orderData.client?.address || '',
                phone: orderData.client?.phone || '',
                details: orderData.client?.details || '',
                entrecalle1: orderData.client?.entrecalle1 || orderData.client?.entrecalles || '',
                entrecalle2: orderData.client?.entrecalle2 || ''
            },
            payment: initialPaymentState,
            observation: orderData.observation || '',
            type: orderData.type || 'Delivery',
            specialDiscount: orderData.specialDiscount || { type: null, responsible: null },
            heladera: initialHeladera,
            status: orderData.status?.main || 'ACEPTADO'
        });

        setPrevHeladera(initialHeladera);
        setOriginalPayment(initialPaymentState);
        setSpecialType(existingSpecialType);
        setResponsibleId(existingResponsible);
        setIsSaving(false);
    }
  }, [orderData, isOpen]);

  // RETIRO orders can be delivered without going through EN DELIVERY (no deliverer required).
  // ENVIO orders still require EN DELIVERY (i.e. an assigned deliverer) before ENTREGADO.
  const canMarkDelivered = () => orderData?.status?.main === 'EN DELIVERY' || formData.type === 'RETIRO';

  const handleDeliveryModeChange = (newType) => {
    setFormData(prev => ({ ...prev, type: newType }));
  };

  const handleChange = (section, field, value) => {
    setFormData(prev => {
        const updatedSection = { ...prev[section], [field]: value };
        
        if (section === 'payment') {
            if (field === 'amount' || field === 'montoAbonado') {
                const amount = field === 'amount' ? Number(value) : Number(prev.payment.amount);
                const abonado = field === 'montoAbonado' ? Number(value) : Number(prev.payment.montoAbonado);
                updatedSection.change = Math.max(0, abonado - amount);
            }
        }

        return {
            ...prev,
            [section]: updatedSection
        };
    });
  };

  const handleStatusChange = (newStatus) => {
      if (newStatus === 'ENTREGADO' && !canMarkDelivered()) {
          return; // Pre-flight validation (RETIRO bypasses EN DELIVERY requirement)
      }
      
      setFormData(prev => {
          let newHeladera = prev.heladera;

          // Track previous state so we can restore it if they switch back to COMANDADO before saving
          if (prev.status === 'COMANDADO' && newStatus !== 'COMANDADO') {
              setPrevHeladera(prev.heladera);
              newHeladera = 'NO';
          } else if (prev.status !== 'COMANDADO' && newStatus === 'COMANDADO') {
              newHeladera = prevHeladera;
          }

          return {
              ...prev,
              status: newStatus,
              heladera: newHeladera
          };
      });
  };

  const toggleHeladera = () => {
      if (formData.status !== 'COMANDADO') return;
      setFormData(prev => ({
          ...prev,
          heladera: prev.heladera === 'SI' ? 'NO' : 'SI'
      }));
  };

  const handleSpecialTypeToggle = (type) => {
    const isSelecting = specialType !== type;
    
    if (isSelecting) {
        setSpecialType(type);
        setFormData(prev => ({
            ...prev,
            payment: {
                ...prev.payment,
                amount: 0,
                montoAbonado: 0,
                change: 0,
                method: type
            }
        }));
    } else {
        setSpecialType(null);
        setResponsibleId('');
        if (originalPayment) {
             setFormData(prev => ({
                ...prev,
                payment: {
                    ...prev.payment,
                    amount: originalPayment.amount,
                    montoAbonado: originalPayment.montoAbonado,
                    change: originalPayment.change,
                    method: originalPayment.method
                }
             }));
        }
    }
  };

  const handleSave = async () => {
    if (specialType && !responsibleId) {
        toast({
            variant: "destructive",
            title: "Falta Responsable",
            description: `Para guardar como ${specialType}, es obligatorio seleccionar un empleado responsable.`
        });
        return;
    }
    
    if (formData.status === 'ENTREGADO' && !canMarkDelivered()) {
        toast({
            variant: "destructive",
            title: "Error de estado",
            description: `Solo los pedidos EN DELIVERY pueden marcarse como ENTREGADO.`
        });
        return;
    }

    let finalSpecialDiscount = null;
    if (specialType) {
        const selectedEmployee = allEmployees.find(e => e.id === responsibleId) || { id: responsibleId, name: 'Desconocido' };
        finalSpecialDiscount = {
            type: specialType,
            responsible: {
                id: selectedEmployee.id,
                name: selectedEmployee.nombre || selectedEmployee.name,
                lastName: selectedEmployee.apellido || selectedEmployee.lastName || '',
                legajo: selectedEmployee.legajo
            }
        };
    }

    const dataToSave = {
        ...formData,
        payment: {
            ...formData.payment,
            paysWith: formData.payment.montoAbonado,
            method: specialType || formData.payment.method
        },
        specialDiscount: finalSpecialDiscount,
        // Double security measure: enforce NO if status is not COMANDADO
        heladera: formData.status === 'COMANDADO' ? formData.heladera : 'NO',
        status: {
            main: formData.status,
            sub: formData.status === 'COMANDADO' ? 'Esperando confirmación' : orderData.status?.sub
        }
    };

    setIsSaving(true);
    try {
        await onConfirm(dataToSave);
    } catch (error) {
        console.error("Error al guardar:", error);
    } finally {
        setIsSaving(false);
    }
  };

  const formatCurrency = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);

  if (!orderData) return null;

  const specialOptions = [
    { id: 'Sorteo', label: 'Sorteo', icon: Trophy, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
    { id: 'Regalo', label: 'Regalo', icon: Gift, color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-200' },
    { id: 'Mal Armado', label: 'Mal Armado', icon: ThumbsDown, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] h-[90vh] p-0 gap-0 flex flex-col bg-white overflow-hidden shadow-2xl border-none">
        <DialogHeader className="px-4 py-3 border-b bg-white shrink-0">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div>
                        <DialogTitle className="flex items-center gap-2 text-lg text-gray-900">
                            <FileText className="w-5 h-5 text-blue-600"/>
                            Editar Pedido #{orderData.id}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            <Database className="w-3 h-3"/> Caché y sincronización activada
                        </DialogDescription>
                    </div>
                    <div className="hidden sm:flex bg-white p-1 rounded-md border border-gray-200 shadow-sm items-center justify-center">
                       <QRCodeSVG value={String(orderData.id)} size={36} />
                    </div>
                </div>
                
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleHeladera}
                        disabled={formData.status !== 'COMANDADO'}
                        className={`h-9 px-3 border-2 transition-all ${
                            formData.status === 'COMANDADO' && formData.heladera === 'SI'
                            ? 'bg-cyan-50 border-cyan-300 text-cyan-700 hover:bg-cyan-100 shadow-inner'
                            : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                        } ${formData.status !== 'COMANDADO' ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                        title={formData.status !== 'COMANDADO' ? "Solo disponible para pedidos COMANDADOS" : "Guardar en heladera"}
                    >
                        <Snowflake className={`w-4 h-4 mr-1.5 ${formData.status === 'COMANDADO' && formData.heladera === 'SI' ? 'text-cyan-500 fill-cyan-200' : 'text-gray-400'}`} />
                        <span className="text-xs font-bold">En Heladera</span>
                    </Button>

                    <div className="flex flex-col items-end">
                        <Select value={formData.status} onValueChange={handleStatusChange}>
                            <SelectTrigger className="h-9 w-40 text-xs font-bold uppercase bg-gray-50 border-gray-200 focus:ring-offset-0 focus:ring-1 focus:ring-blue-400">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ACEPTADO">ACEPTADO</SelectItem>
                                <SelectItem value="COMANDADO">COMANDADO</SelectItem>
                                <SelectItem value="EN DELIVERY">EN DELIVERY</SelectItem>
                                <SelectItem
                                  value="ENTREGADO"
                                  disabled={!canMarkDelivered()}
                                  className={!canMarkDelivered() ? 'opacity-50 cursor-not-allowed' : ''}
                                >
                                  ENTREGADO
                                </SelectItem>
                                <SelectItem value="CANCELADO">CANCELADO</SelectItem>
                            </SelectContent>
                        </Select>
                        {formData.status === 'COMANDADO' && (
                            <span className="text-[10px] text-orange-600 lowercase normal-case mt-0.5 font-medium flex items-center gap-1 bg-orange-50 px-1.5 py-0.5 rounded-md">
                                Esperando confirmación
                            </span>
                        )}
                        {!canMarkDelivered() && formData.status !== 'COMANDADO' && (
                            <span className="text-[10px] text-gray-400 normal-case mt-0.5 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> Solo EN DELIVERY a ENTREGADO
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 h-full divide-x divide-gray-200">
                {/* Left Column: Client Data - Scrollable */}
                <div className="p-4 overflow-y-auto bg-white flex flex-col gap-6">
                    <div>
                        <h3 className="font-bold text-sm text-gray-800 mb-4 flex items-center gap-2 pb-2 border-b">
                            <User className="w-4 h-4 text-blue-500"/> Datos del Cliente
                        </h3>
                        
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="clientName" className="text-xs font-bold text-gray-700">Nombre del Cliente</Label>
                                <Input
                                    id="clientName"
                                    value={formData.client.name}
                                    onChange={(e) => handleChange('client', 'name', e.target.value)}
                                    className="h-9 text-sm bg-gray-50 border-gray-200 focus:bg-white transition-colors"
                                />
                            </div>

                            {/* Modo de entrega: permite cambiar entre Envío (delivery) y Retiro en local */}
                            <div className="space-y-1.5">
                                <Label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5 text-blue-500" /> Modo de entrega
                                </Label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleDeliveryModeChange('ENVIO')}
                                        className={`h-9 rounded-md border-2 text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                                            formData.type !== 'RETIRO'
                                                ? 'bg-blue-50 border-blue-400 text-blue-700 shadow-sm'
                                                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                                        }`}
                                    >
                                        <MapPin className="w-4 h-4" /> Envío
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDeliveryModeChange('RETIRO')}
                                        className={`h-9 rounded-md border-2 text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
                                            formData.type === 'RETIRO'
                                                ? 'bg-green-50 border-green-400 text-green-700 shadow-sm'
                                                : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                                        }`}
                                    >
                                        <Package className="w-4 h-4" /> Retiro en local
                                    </button>
                                </div>
                                {formData.type === 'RETIRO' && (
                                    <p className="text-[10px] text-green-600 flex items-center gap-1">
                                        <Info className="w-3 h-3" /> Retiro en local: no requiere repartidor para marcar ENTREGADO.
                                    </p>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="clientAddress" className="text-xs font-bold text-gray-700">Dirección de Entrega</Label>
                                <div className="relative">
                                    <MapPin className="absolute left-2.5 top-2.5 h-4 w-4 text-orange-500" />
                                    <Input 
                                        id="clientAddress" 
                                        value={formData.client.address} 
                                        onChange={(e) => handleChange('client', 'address', e.target.value)}
                                        className="pl-9 h-9 text-sm font-medium bg-gray-50 border-gray-200 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Added Entrecalle 1 Field */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="clientEntrecalle1" className="text-xs font-bold text-gray-700 flex justify-between">
                                        <span>Entrecalle 1</span>
                                        <span className={`text-[10px] ${formData.client.entrecalle1?.length > 500 ? 'text-red-500' : 'text-gray-400'}`}>
                                            {formData.client.entrecalle1?.length || 0}/500
                                        </span>
                                    </Label>
                                    <div className="relative">
                                        <MessageSquare className="absolute left-2.5 top-2.5 h-4 w-4 text-purple-500" />
                                        <Textarea 
                                            id="clientEntrecalle1" 
                                            value={formData.client.entrecalle1} 
                                            onChange={(e) => {
                                                if (e.target.value.length <= 500) {
                                                    handleChange('client', 'entrecalle1', e.target.value);
                                                }
                                            }}
                                            className="pl-9 min-h-[50px] text-sm bg-purple-50/30 border-purple-100 focus:bg-white focus:border-purple-300 resize-none transition-colors"
                                            placeholder="Ej: San Martin..."
                                        />
                                    </div>
                                </div>

                                {/* Added Entrecalle 2 Field */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="clientEntrecalle2" className="text-xs font-bold text-gray-700 flex justify-between">
                                        <span>Entrecalle 2</span>
                                        <span className={`text-[10px] ${formData.client.entrecalle2?.length > 500 ? 'text-red-500' : 'text-gray-400'}`}>
                                            {formData.client.entrecalle2?.length || 0}/500
                                        </span>
                                    </Label>
                                    <div className="relative">
                                        <MessageSquare className="absolute left-2.5 top-2.5 h-4 w-4 text-purple-500" />
                                        <Textarea 
                                            id="clientEntrecalle2" 
                                            value={formData.client.entrecalle2} 
                                            onChange={(e) => {
                                                if (e.target.value.length <= 500) {
                                                    handleChange('client', 'entrecalle2', e.target.value);
                                                }
                                            }}
                                            className="pl-9 min-h-[50px] text-sm bg-purple-50/30 border-purple-100 focus:bg-white focus:border-purple-300 resize-none transition-colors"
                                            placeholder="Ej: Belgrano..."
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="clientPhone" className="text-xs font-bold text-gray-700">Teléfono / Celular</Label>
                                <div className="relative">
                                    <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-green-600" />
                                    <Input 
                                        id="clientPhone" 
                                        value={formData.client.phone} 
                                        onChange={(e) => handleChange('client', 'phone', e.target.value)}
                                        className="pl-9 h-9 text-sm bg-gray-50 border-gray-200 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="clientDetails" className="text-xs font-bold text-gray-700">Notas de Dirección / Timbre</Label>
                                <Textarea 
                                    id="clientDetails" 
                                    value={formData.client.details} 
                                    onChange={(e) => handleChange('client', 'details', e.target.value)}
                                    className="resize-none h-16 text-sm bg-yellow-50/50 border-yellow-100 focus:bg-yellow-50 focus:border-yellow-200"
                                    placeholder="Ej: Timbre no funciona, dejar en portería..."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-bold text-xs text-gray-500 uppercase tracking-wider">Categoría Especial</h3>
                            <div className="flex items-center text-[10px] text-gray-400 gap-1 bg-gray-50 px-2 py-1 rounded-md">
                                <Info className="w-3 h-3" />
                                <span>Requiere responsable</span>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 gap-2">
                            {specialOptions.map((opt) => (
                                <div 
                                    key={opt.id}
                                    onClick={() => handleSpecialTypeToggle(opt.id)}
                                    className={`
                                        flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all
                                        ${specialType === opt.id 
                                            ? `${opt.bg} ${opt.border} shadow-sm ring-1 ring-offset-0 ring-${opt.color.split('-')[1]}-300` 
                                            : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'}
                                    `}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded-lg ${specialType === opt.id ? 'bg-white shadow-sm' : 'bg-slate-200/50'}`}>
                                            <opt.icon className={`w-4 h-4 ${opt.color}`} />
                                        </div>
                                        <Label className="font-bold text-slate-700 cursor-pointer text-sm">{opt.label}</Label>
                                    </div>
                                    <Checkbox 
                                        checked={specialType === opt.id}
                                        onCheckedChange={() => handleSpecialTypeToggle(opt.id)}
                                        className="h-5 w-5 rounded-full data-[state=checked]:bg-slate-900 data-[state=checked]:border-slate-900"
                                    />
                                </div>
                            ))}
                        </div>

                        {specialType && (
                             <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-200 p-3 bg-red-50 rounded-lg border border-red-100">
                                <Label className="text-xs font-bold text-red-700 mb-1.5 block flex items-center gap-1">
                                    Responsable (Empleado) <span className="text-red-600">*</span>
                                </Label>
                                <Select value={responsibleId} onValueChange={setResponsibleId} disabled={isLoadingEmployees}>
                                    <SelectTrigger className="h-9 bg-white border-red-200 focus:ring-red-200">
                                        <SelectValue placeholder={isLoadingEmployees ? "Cargando..." : "Seleccionar empleado..."} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {vendorEmployees.map(emp => (
                                            <SelectItem key={emp.id} value={emp.id}>{emp.fullName}</SelectItem>
                                        ))}
                                        {vendorEmployees.length === 0 && !isLoadingEmployees && (
                                            <div className="p-2 text-xs text-gray-500 text-center">No hay vendedores disponibles</div>
                                        )}
                                    </SelectContent>
                                </Select>
                                <p className="text-[10px] text-red-500 mt-2 flex items-center gap-1.5">
                                    <Info className="w-3 h-3" />
                                    Al guardar, el precio se establecerá en $0. Deseleccione la opción para restaurar el precio original.
                                </p>
                             </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Order Details & Payment - Fixed Layout */}
                <div className="flex flex-col h-full bg-gray-50/50 overflow-hidden relative">
                    
                    {/* Top Section: Items (Grow, Scrollable) */}
                    <div className="flex-1 min-h-0 p-4 pb-2 flex flex-col overflow-hidden">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col flex-1 overflow-hidden">
                            <div className="px-3 py-2 bg-gray-100 border-b border-gray-200 shrink-0 flex justify-between items-center">
                                <h3 className="font-bold text-xs text-gray-700 flex items-center gap-2 uppercase tracking-wide">
                                    <Package className="w-3.5 h-3.5"/> Ítems ({orderData.items?.length || 0})
                                </h3>
                            </div>
                            
                            {/* Scrollable list container */}
                            <div className="flex-1 overflow-y-auto p-0">
                                <div className="divide-y divide-gray-100">
                                    {orderData.items?.map((item, idx) => (
                                        <div key={idx} className="p-3 hover:bg-gray-50 text-sm transition-colors">
                                            <div className="flex justify-between items-start mb-0.5">
                                                <div className="flex gap-2 items-start">
                                                    <span className="font-bold text-blue-600 bg-blue-50 px-1.5 rounded text-xs py-0.5 h-fit">{item.cantidad}x</span>
                                                    <span className="font-bold text-gray-800 leading-tight">{item.nombre}</span>
                                                </div>
                                                <span className="font-semibold text-gray-900 whitespace-nowrap ml-2">{formatCurrency(item.valor || item.precio)}</span>
                                            </div>
                                            {item.gustos && <p className="text-xs text-gray-500 mt-1 pl-8 italic leading-relaxed">{item.gustos}</p>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Section: Payment Details (Fixed, No Shrink) */}
                    <div className="shrink-0 p-4 pt-0 z-10">
                        <div className={`p-4 rounded-xl border shadow-sm transition-colors ${specialType ? 'bg-slate-50 border-slate-200 opacity-80' : 'bg-white border-gray-200'}`}>
                            <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2 mb-3 pb-2 border-b">
                                <CreditCard className="w-4 h-4 text-green-600"/> Detalles de Pago
                            </h3>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold text-gray-600">Método de Pago</Label>
                                    <Select 
                                        value={formData.payment.method} 
                                        onValueChange={(val) => handleChange('payment', 'method', val)}
                                        disabled={!!specialType}
                                    >
                                        <SelectTrigger className="h-9 text-sm font-medium">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {allowedPaymentMethods.map(m => (
                                                <SelectItem key={m} value={m}>{m}</SelectItem>
                                            ))}
                                            {specialType && <SelectItem value={specialType}>{specialType}</SelectItem>}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold text-gray-600">Total a Cobrar</Label>
                                    <Input 
                                        type="number" 
                                        value={formData.payment.amount} 
                                        onChange={(e) => handleChange('payment', 'amount', Number(e.target.value))}
                                        className="h-9 text-sm font-black text-right text-gray-900"
                                        disabled={!!specialType}
                                    />
                                </div>
                                
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold text-gray-600 flex items-center gap-1">
                                        <Banknote className="w-3 h-3 text-gray-400" />
                                        Paga con (Abonado)
                                    </Label>
                                    <Input 
                                        type="number" 
                                        value={formData.payment.montoAbonado} 
                                        onChange={(e) => handleChange('payment', 'montoAbonado', Number(e.target.value))}
                                        className="h-9 text-sm font-bold text-right text-blue-600 border-blue-100 bg-blue-50/30 focus:bg-white"
                                        placeholder="0"
                                        disabled={!!specialType}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-bold text-gray-600">Vuelto (Cambio)</Label>
                                    <div className="h-9 flex items-center justify-end px-3 rounded-md border border-gray-200 bg-gray-100 text-sm font-black text-gray-700">
                                        {formatCurrency(formData.payment.change)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t bg-white shrink-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving} className="h-9 text-sm font-medium text-gray-500 hover:text-gray-700">
                <X className="w-4 h-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving || (formData.status === 'ENTREGADO' && !canMarkDelivered())} className="h-9 text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm px-6">
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {isSaving ? "Guardando..." : "Guardar Cambios"}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OrderDetailModal;