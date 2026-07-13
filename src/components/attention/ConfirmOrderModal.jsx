import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, Edit, Wallet, Calendar as CalendarIcon, AlertCircle, MessageSquare } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { fetchEmployees, fetchCategories } from '@/lib/api/hrApi';
import { saveClient } from '@/lib/api/clientsApi';
import ResponsibleEmployeeModal from './ResponsibleEmployeeModal';
import ClientDataSection from './confirm-order/ClientDataSection';
import PaymentSection from './confirm-order/PaymentSection';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PaymentMethodSlider from '@/components/attention/PaymentMethodSlider';
import { QRCodeSVG } from 'qrcode.react';
import { openWhatsAppWithMessage } from '@/lib/whatsapp/whatsappHandler';
import { resolvePaymentWhatsAppMessage, isCashOnlyOrder, getOrderPaymentMethods } from '@/lib/whatsapp/paymentMessage';
import { findAccountByExactPaymentMethod } from '@/lib/api/accountsApi';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { saveInvoiceForCashPayment } from '@/lib/api/invoiceApi';
import { formatInvoiceData } from '@/lib/api/ordersApi';

function ConfirmOrderModal({ 
  isOpen, 
  onOpenChange, 
  total: initialTotal, 
  orderItems, 
  onBack, 
  onConfirm,
  isEditingClientData = false,
  orderData,
  allowedPaymentMethods = [],
  currentShift,
  settings
}) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerEntrecalle1, setCustomerEntrecalle1] = useState('');
  const [customerEntrecalle2, setCustomerEntrecalle2] = useState('');
  const [customerRut, setCustomerRut] = useState('');
  const [observation, setObservation] = useState('');
  const [orderType, setOrderType] = useState('ENVIO');
  
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState('Efectivo');
  
  const [payments, setPayments] = useState([]);
  const [change, setChange] = useState(0);

  const [isSaving, setIsSaving] = useState(false);
  const [total, setTotal] = useState(initialTotal || 0);
  const { toast } = useToast();

  const [specialDiscountType, setSpecialDiscountType] = useState(null);
  const [responsibleEmployee, setResponsibleEmployee] = useState(null);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [emiteFactura, setEmiteFactura] = useState(false);

  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const remainingBalance = useMemo(() => total - totalPaid, [total, totalPaid]);
  const originalTotal = useMemo(() => initialTotal, [initialTotal]);
  
  const isFutureOrder = useMemo(() => {
     let comparisonDate = new Date().toISOString().split('T')[0];
     if (currentShift?.fechaCaja) {
         const [d, m, y] = currentShift.fechaCaja.split('-');
         comparisonDate = `${y}-${m}-${d}`;
     }
     
     return deliveryDate !== comparisonDate;
  }, [deliveryDate, currentShift]);

  const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

  useEffect(() => {
    if (!isEditingClientData) {
        if (specialDiscountType) {
          setTotal(0);
          setPayments([{ amount: 0, method: specialDiscountType }]);
        } else {
          setTotal(originalTotal);
        }
    } else if (specialDiscountType) {
        setTotal(0);
        if (payments.length === 0 || payments[0].method !== specialDiscountType) {
             setPayments([{ amount: 0, method: specialDiscountType }]);
        }
    }
  }, [specialDiscountType, originalTotal, isEditingClientData]); 

  const loadHrData = useCallback(async () => {
    try {
      const [emp, cat] = await Promise.all([fetchEmployees(), fetchCategories()]);
      setEmployees(emp);
      setCategories(cat);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error de RRHH', description: 'No se pudieron cargar empleados o categorías.' });
    }
  }, [toast]);
  
  useEffect(() => {
    if (isOpen) {
      loadHrData();
    }
  }, [isOpen, loadHrData]);

  const handleSpecialDiscountChange = (type) => {
    if (specialDiscountType === type) {
      setSpecialDiscountType(null);
      setResponsibleEmployee(null);
      if (isEditingClientData && orderData) {
          setTotal(orderData.payment.total || orderData.payment.amount || 0);
          setPayments([]); 
      }
    } else {
      setSpecialDiscountType(type);
      setIsEmployeeModalOpen(true);
    }
  };

  const handleSelectResponsible = (employee) => {
    setResponsibleEmployee(employee);
    setIsEmployeeModalOpen(false);
  };

  const handleCloseEmployeeModal = () => {
    if (!responsibleEmployee) {
      setSpecialDiscountType(null);
    }
    setIsEmployeeModalOpen(false);
  };

  const resetState = useCallback(() => {
    if (isEditingClientData && orderData) {
      setCustomerName(orderData.client.name || '');
      setCustomerPhone(orderData.client.phone || '');
      setCustomerAddress(orderData.client.address || '');
      setCustomerEntrecalle1(orderData.client.entrecalle1 || '');
      setCustomerEntrecalle2(orderData.client.entrecalle2 || '');
      setCustomerRut(orderData.client.rut || '');
      setObservation(orderData.observation || '');
      
      const currentTotal = orderData.payment.total !== undefined ? orderData.payment.total : (orderData.payment.amount || 0);
      setTotal(currentTotal);
      
      let existingPayments = [];
      if (orderData.payment.payments && Array.isArray(orderData.payment.payments) && orderData.payment.payments.length > 0) {
        existingPayments = orderData.payment.payments;
      } else if (orderData.payment.method) {
        existingPayments = [{ 
            method: orderData.payment.method, 
            amount: currentTotal,
            paysWith: orderData.payment.paysWith || currentTotal,
            montoAbonado: orderData.payment.montoAbonado || orderData.payment.paysWith || currentTotal
        }];
      }
      
      setPayments(existingPayments);
      
      setChange(orderData.payment.change || 0);
      setOrderType(orderData.type || 'ENVIO');
      setSpecialDiscountType(orderData.specialDiscount?.type || null);
      setResponsibleEmployee(orderData.specialDiscount?.responsible || null);
      setEmiteFactura(orderData.emiteFactura || false);
      
      if (orderData.fechacaja) {
          const parts = orderData.fechacaja.split('-');
          if (parts.length === 3) {
              setDeliveryDate(`${parts[2]}-${parts[1]}-${parts[0]}`);
          }
      } else {
          setDeliveryDate(new Date().toISOString().split('T')[0]);
      }
      
      setDepositAmount('');
      setDepositMethod('Efectivo');

    } else {
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerEntrecalle1('');
      setCustomerEntrecalle2('');
      setCustomerRut('');
      setObservation('');
      setPayments([]);
      setTotal(initialTotal || 0);
      setChange(0);
      setOrderType('ENVIO');
      setSpecialDiscountType(null);
      setResponsibleEmployee(null);
      setEmiteFactura(false);
      
      if (currentShift && currentShift.fechaCaja) {
          const [d, m, y] = currentShift.fechaCaja.split('-');
          setDeliveryDate(`${y}-${m}-${d}`);
      } else {
          setDeliveryDate(new Date().toISOString().split('T')[0]);
      }
      
      setDepositAmount('');
      setDepositMethod('Efectivo');
    }
  }, [isEditingClientData, orderData, initialTotal, currentShift]);

  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // Misma función centralizada que usa el botón WhatsApp de Delivery (resolvePaymentWhatsAppMessage
  // en paymentMessage.js): decide el mensaje de efectivo o electrónico según el medio de pago real
  // del pedido, para no tener una lógica distinta en cada pantalla.
  const handleSendWhatsApp = async () => {
    if (!orderData || !orderData.id) return;
    const localId = getCurrentLocalId();
    const clientName = customerName || orderData.client?.name || 'Cliente';
    const phone = customerPhone || orderData.client?.phone;

    if (!phone) {
       toast({ variant: "destructive", title: "Atención", description: "El cliente no tiene teléfono registrado." });
       return;
    }

    try {
       // Alias/titular solo hacen falta si el mensaje termina siendo el electrónico. Se busca la
       // cuenta que coincide EXACTAMENTE con el medio de pago real del pedido (igual que antes),
       // no una cuenta "favorita" genérica.
       let alias = null;
       let titular = null;
       if (!isCashOnlyOrder(orderData)) {
          const [electronicMethod] = getOrderPaymentMethods(orderData);
          if (electronicMethod) {
            const account = await findAccountByExactPaymentMethod(localId, electronicMethod);
            if (account) {
              alias = account.alias;
              titular = account.aNombreDe;
            }
          }
       }

       const orderForMessage = { ...orderData, client: { ...orderData.client, name: clientName, phone } };
       const message = resolvePaymentWhatsAppMessage({
          order: orderForMessage,
          templateElectronico: settings?.web?.whatsappMessage || '',
          templateEfectivo: settings?.web?.whatsappMessageEfectivo || '',
          alias,
          titular,
       });

       const pref = settings?.whatsappPreference || 'web';
       await openWhatsAppWithMessage(phone, message, pref);
    } catch (error) {
       console.error("Error in WhatsApp integration", error);
       toast({ variant: "destructive", title: "Error", description: "No se pudo enviar el mensaje." });
    }
  };

  const handleConfirm = async () => {
    if (specialDiscountType && !responsibleEmployee) {
      toast({ variant: "destructive", title: "Falta Responsable", description: "Debe seleccionar un empleado responsable para el descuento especial." });
      setIsEmployeeModalOpen(true);
      return;
    }

    if (!isFutureOrder && payments.length === 0 && !specialDiscountType) {
      toast({ variant: "destructive", title: "Sin pago", description: "Seleccione un método de pago para confirmar." });
      return;
    }

    if (isFutureOrder && depositAmount && parseFloat(depositAmount) > total) {
       toast({ variant: "destructive", title: "Seña Inválida", description: "La seña no puede ser mayor al total." });
       return;
    }

    setIsSaving(true);
    
    const finalName = customerName || 'Consumidor Final';
    const finalAddress = customerAddress || 'Sin Datos';

    if (customerPhone && finalName !== 'Consumidor Final') {
      try {
        await saveClient({
          phone: customerPhone,
          nombre: finalName,
          direccion: finalAddress,
          entrecalle1: customerEntrecalle1,
          entrecalle2: customerEntrecalle2,
        });
      } catch (error) {
        console.error("Could not save client data", error);
      }
    }
    
    let paymentData;

    if (isFutureOrder) {
        const depAmount = parseFloat(depositAmount) || 0;
        paymentData = {
            amount: total, 
            total: total,
            method: 'Pendiente', 
            payments: [], 
            deposit: depAmount > 0 ? {
                amount: depAmount,
                method: depositMethod,
                date: new Date().toLocaleDateString('es-ES') 
            } : null,
            change: 0,
            paysWith: 0,
            montoAbonado: 0
        };
    } else {
        const finalTotal = specialDiscountType ? 0 : total;
        
        const mainPayment = payments.length > 0 ? payments[0] : null;
        
        let paysWithAmount = finalTotal;
        let montoAbonadoValue = finalTotal;
        let finalChange = 0;
        
        if (mainPayment && mainPayment.method === 'Efectivo') {
             montoAbonadoValue = mainPayment.montoAbonado !== undefined ? mainPayment.montoAbonado : (mainPayment.paysWith || finalTotal);
             paysWithAmount = montoAbonadoValue;
             finalChange = paysWithAmount > finalTotal ? paysWithAmount - finalTotal : 0;
        }

        const effectiveMethod = specialDiscountType || (mainPayment ? mainPayment.method : 'N/A');

        paymentData = {
            amount: finalTotal,
            total: isEditingClientData && orderData ? (orderData.payment.total || orderData.payment.amount) : originalTotal, 
            payments: payments,
            method: effectiveMethod,
            change: finalChange, 
            paysWith: paysWithAmount,
            montoAbonado: montoAbonadoValue 
        };
    }
    
    const [y, m, d] = deliveryDate.split('-');
    const formattedDeliveryDate = `${d}-${m}-${y}`;

    let orderDataToConfirm;
    
    if (isEditingClientData) {
        orderDataToConfirm = {
            client: {
                name: finalName,
                phone: customerPhone,
                address: finalAddress,
                entrecalle1: customerEntrecalle1,
                entrecalle2: customerEntrecalle2,
                rut: customerRut,
                details: orderData.client.details || '',
            },
            payment: {
                ...orderData.payment,
                ...paymentData
            },
            observation: observation,
            type: orderType,
            specialDiscount: specialDiscountType ? { type: specialDiscountType, responsible: responsibleEmployee } : null,
            emiteFactura: emiteFactura,
            fechacaja: formattedDeliveryDate
        }
    } else {
        orderDataToConfirm = {
            client: {
                name: finalName,
                phone: customerPhone,
                address: orderType === 'ENVIO' ? finalAddress : '',
                entrecalle1: orderType === 'ENVIO' ? customerEntrecalle1 : '',
                entrecalle2: orderType === 'ENVIO' ? customerEntrecalle2 : '',
                rut: customerRut,
                details: '',
            },
            observation: observation,
            type: orderType,
            date: formattedDeliveryDate,
            times: {
                ingress: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                delivery: '',
            },
            payment: paymentData,
            items: orderItems,
            specialDiscount: specialDiscountType ? { type: specialDiscountType, responsible: responsibleEmployee } : null,
            emiteFactura: emiteFactura,
            fechacaja: formattedDeliveryDate
        };
    }

    // Task: Process specific cash invoice directly to Firebase if ticked
    const mainMethodForInvoice = isFutureOrder ? depositMethod : (payments.length > 0 ? payments[0].method : null);
    if (emiteFactura && mainMethodForInvoice === 'Efectivo') {
        const invoiceObj = formatInvoiceData({
             ...orderDataToConfirm,
             seller: currentShift?.user?.nombre || 'Vendedor'
        });
        try {
            await saveInvoiceForCashPayment(getCurrentLocalId(), invoiceObj);
            toast({ title: 'Factura generada', description: 'La factura en efectivo se guardó correctamente.' });
        } catch (error) {
            console.error('Failed saving cash invoice', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo generar la factura en efectivo.' });
            // Continue with the normal sale confirmation flow despite invoice error
        }
    }
    
    await onConfirm(orderDataToConfirm);
    setIsSaving(false);
  };

  const isConfirmDisabled = isSaving || (!isFutureOrder && payments.length === 0 && !specialDiscountType);
  const isEfectivoSelected = isFutureOrder ? depositMethod === 'Efectivo' : (payments.length > 0 && payments[0].method === 'Efectivo');

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[85vh] p-0 flex flex-col overflow-hidden bg-white sm:rounded-xl">
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-white relative">
          <DialogTitle className="text-xl font-bold text-slate-800 flex items-center pr-16">
             {isEditingClientData ? <Edit className="mr-2 h-5 w-5 text-primary" /> : <Wallet className="mr-2 h-5 w-5 text-primary" />}
             {isEditingClientData ? `Editando Pedido #${orderData?.id}` : 'Finalizar Pedido'}
          </DialogTitle>
          {isEditingClientData && orderData?.id && (
             <div className="absolute right-6 top-1/2 -translate-y-1/2 hidden sm:flex bg-white p-1 border border-gray-200 rounded-md shadow-sm">
                <QRCodeSVG value={String(orderData.id)} size={36} />
             </div>
          )}
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
            {/* LEFT COLUMN: Client Data (Takes 7/12 width on large screens) */}
            <div className="lg:col-span-7 flex flex-col h-full space-y-4">
               <ClientDataSection
                  customerPhone={customerPhone}
                  setCustomerPhone={setCustomerPhone}
                  customerName={customerName}
                  setCustomerName={setCustomerName}
                  customerAddress={customerAddress}
                  setCustomerAddress={setCustomerAddress}
                  customerEntrecalle1={customerEntrecalle1}
                  setCustomerEntrecalle1={setCustomerEntrecalle1}
                  customerEntrecalle2={customerEntrecalle2}
                  setCustomerEntrecalle2={setCustomerEntrecalle2}
                  observation={observation}
                  setObservation={setObservation}
                  orderType={orderType}
                  setOrderType={setOrderType}
                  emiteFactura={emiteFactura}
                  setEmiteFactura={setEmiteFactura}
                  isEditingClientData={isEditingClientData}
                  showOrderTypeSelector={!isEditingClientData}
                />
                
                 {isEditingClientData && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                        <span className="text-sm font-semibold text-blue-800">Tipo de Pedido</span>
                        <div className="flex items-center space-x-4 mt-2">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="orderType"
                                    value="ENVIO"
                                    checked={orderType === 'ENVIO'}
                                    onChange={(e) => setOrderType(e.target.value)}
                                    className="form-radio h-4 w-4 text-primary focus:ring-primary"
                                />
                                <span className="text-sm">Envío</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="orderType"
                                    value="RETIRO"
                                    checked={orderType === 'RETIRO'}
                                    onChange={(e) => setOrderType(e.target.value)}
                                    className="form-radio h-4 w-4 text-primary focus:ring-primary"
                                />
                                <span className="text-sm">Retiro</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>
            
            {/* RIGHT COLUMN: Payment Data (Takes 5/12 width on large screens) */}
            <div className="lg:col-span-5 flex flex-col space-y-4">
               <div className="p-3 bg-white border rounded-lg shadow-sm">
                  <Label htmlFor="deliveryDate" className="mb-2 block font-semibold text-slate-700 flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4"/> Fecha de Entrega / Caja
                  </Label>
                  <Input 
                      id="deliveryDate" 
                      type="date" 
                      value={deliveryDate} 
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      className="bg-white"
                  />
                  {isFutureOrder && (
                      <p className="text-xs text-orange-600 mt-2 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3"/> Pedido programado para fecha futura
                      </p>
                  )}
              </div>

              {isFutureOrder ? (
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-4 flex-grow">
                      <h4 className="font-bold text-orange-800 flex items-center gap-2">
                          <Wallet className="w-4 h-4"/> Seña / Adelanto
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <Label htmlFor="depositAmount" className="text-xs font-bold text-gray-600">Monto Seña</Label>
                              <Input 
                                  id="depositAmount" 
                                  type="number" 
                                  placeholder="0.00" 
                                  value={depositAmount}
                                  onChange={(e) => setDepositAmount(e.target.value)}
                                  className="mt-1"
                              />
                          </div>
                          <div>
                              <Label className="text-xs font-bold text-gray-600 block mb-1">Resto a Pagar</Label>
                              <div className="h-10 px-3 py-2 bg-white border rounded-md font-bold text-slate-700 flex items-center">
                                  {formatCurrency(total - (parseFloat(depositAmount) || 0))}
                              </div>
                          </div>
                      </div>

                      <div>
                           <Label className="text-xs font-bold text-gray-600 mb-2 block">Método de pago de la seña</Label>
                           <PaymentMethodSlider 
                                methods={['Efectivo', 'Transferencia']}
                                selectedMethod={depositMethod}
                                onSelect={setDepositMethod}
                           />
                           <p className="text-[10px] text-gray-500 mt-1">* La seña ingresará en la caja de HOY.</p>
                      </div>
                      
                      <div className="pt-2 border-t border-orange-200 flex justify-between items-center mt-auto">
                          <span className="font-bold text-gray-700">Total Pedido:</span>
                          <span className="font-bold text-xl text-primary">{formatCurrency(total)}</span>
                      </div>
                  </div>
              ) : (
                  <PaymentSection
                    total={total}
                    totalPaid={totalPaid}
                    change={change}
                    setChange={setChange}
                    remainingBalance={remainingBalance}
                    payments={payments}
                    setPayments={setPayments}
                    specialDiscountType={specialDiscountType}
                    handleSpecialDiscountChange={handleSpecialDiscountChange}
                    responsibleEmployee={responsibleEmployee}
                    allowedPaymentMethods={allowedPaymentMethods}
                    formatCurrency={formatCurrency}
                  />
              )}

              {isEfectivoSelected && (
                  <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm space-y-3">
                      <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                              type="checkbox"
                              checked={emiteFactura}
                              onChange={(e) => setEmiteFactura(e.target.checked)}
                              className="form-checkbox h-4 w-4 text-primary focus:ring-primary rounded border-gray-300"
                          />
                          <span className="font-semibold text-slate-700">Emitir Factura (Efectivo)</span>
                      </label>
                      {emiteFactura && (
                          <div className="mt-2">
                              <Label htmlFor="customerRut" className="text-xs font-bold text-gray-600">RUT / DNI del Cliente</Label>
                              <Input
                                  id="customerRut"
                                  value={customerRut}
                                  onChange={(e) => setCustomerRut(e.target.value)}
                                  placeholder="Ingrese RUT o DNI"
                                  className="mt-1"
                              />
                          </div>
                      )}
                  </div>
              )}
            </div>
          </div>
        </div>
        
        <DialogFooter className="px-6 py-4 border-t shrink-0 bg-gray-50 flex items-center justify-between sm:justify-end gap-3">
          {isEditingClientData && orderData?.id && (
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleSendWhatsApp} 
              className="mr-auto text-green-700 border-green-300 hover:bg-green-50 shadow-sm"
            >
              <MessageSquare className="w-4 h-4 mr-2"/> Notificar Pago
            </Button>
          )}
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onBack} disabled={isSaving} className="w-24">
              {isEditingClientData ? 'Cancelar' : 'Volver'}
            </Button>
            <Button className="bg-green-600 hover:bg-green-700 w-40" onClick={handleConfirm} disabled={isConfirmDisabled}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              {isSaving ? 'Guardando...' : 'Confirmar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ResponsibleEmployeeModal
        isOpen={isEmployeeModalOpen}
        onClose={handleCloseEmployeeModal}
        onSelect={handleSelectResponsible}
        employees={employees}
        categories={categories}
      />
    </>
  );
}

export default ConfirmOrderModal;