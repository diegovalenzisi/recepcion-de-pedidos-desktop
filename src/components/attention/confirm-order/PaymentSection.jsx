import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Trophy, Gift, ThumbsDown, DollarSign } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import PaymentMethodSlider from '@/components/attention/PaymentMethodSlider';

const PaymentSection = ({
  total, totalPaid, change, setChange, remainingBalance,
  payments, setPayments,
  specialDiscountType, handleSpecialDiscountChange, responsibleEmployee,
  allowedPaymentMethods,
  formatCurrency,
  isCounterMode = false,
}) => {
  const [montoAbonado, setMontoAbonado] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');
  const { toast } = useToast();
  const montoAbonadoInputRef = useRef(null);

  // Mostrador + Efectivo: foco automático en "Paga con" apenas se selecciona
  // Efectivo, para poder escribir el monto sin otro clic. No aplica a
  // Delivery ni a otros medios de pago.
  useEffect(() => {
    if (isCounterMode && selectedPaymentMethod === 'Efectivo' && !specialDiscountType) {
      montoAbonadoInputRef.current?.focus();
    }
  }, [isCounterMode, selectedPaymentMethod, specialDiscountType]);

  const isInitialized = useRef(false);

  // 1. SYNC FROM PROPS
  useEffect(() => {
    if (payments && payments.length > 0) {
      const externalMethod = payments[0].method;
      if (externalMethod && externalMethod !== selectedPaymentMethod) {
         setSelectedPaymentMethod(externalMethod);
         isInitialized.current = true;
      }
      
      // Sync montoAbonado if it's Efectivo
      if (externalMethod === 'Efectivo') {
           const existingMonto = payments[0].montoAbonado;
           if (existingMonto !== undefined && existingMonto !== null) {
               setMontoAbonado(existingMonto.toString());
           } else if (payments[0].paysWith) {
               // Fallback for backward compatibility
               setMontoAbonado(payments[0].paysWith.toString());
           }
      }
    }
  }, [payments]); 

  // 2. INITIALIZATION / DEFAULTS
  useEffect(() => {
    if (!isInitialized.current && (!payments || payments.length === 0) && allowedPaymentMethods.length > 0) {
      if (!selectedPaymentMethod) {
          const defaultMethod = allowedPaymentMethods.includes('Efectivo') ? 'Efectivo' : allowedPaymentMethods[0];
          setSelectedPaymentMethod(defaultMethod);

          const defaultPayment = { amount: total, method: defaultMethod };
          // Mostrador + Efectivo: "Paga con" arranca VACÍO a propósito (no se
          // precarga con el total) — es lo que permite exigir que el cajero lo
          // escriba (ver handleConfirm/isConfirmDisabled en ConfirmOrderModal.jsx).
          // Delivery y cualquier otro medio conservan el comportamiento de
          // siempre: precargado con el total.
          if (!(isCounterMode && defaultMethod === 'Efectivo')) {
            defaultPayment.montoAbonado = total;
            defaultPayment.paysWith = total;
          }
          setPayments([defaultPayment]);
          isInitialized.current = true;
      }
    }
  }, [allowedPaymentMethods, payments, total, setPayments, isCounterMode]);

  // 3. HANDLE TOTAL UPDATES
  useEffect(() => {
      if (payments && payments.length > 0 && !specialDiscountType) {
          const currentPayment = payments[0];
          if (Math.abs(currentPayment.amount - total) > 0.01) {
              const updatedPayment = { ...currentPayment, amount: total };

              if (currentPayment.method === 'Efectivo') {
                   // If total changes, we might want to keep the custom montoAbonado if it was manually entered
                   // or reset it to total if it was just equal to the old total.
                   // For safety in this context, let's keep the manual value if valid, or default to new total.
                   const currentMonto = parseFloat(montoAbonado);
                   if (montoAbonado && !isNaN(currentMonto)) {
                       updatedPayment.montoAbonado = currentMonto;
                       updatedPayment.paysWith = currentMonto;
                   } else if (!isCounterMode) {
                       updatedPayment.montoAbonado = total;
                       updatedPayment.paysWith = total;
                       setMontoAbonado(total.toString());
                   } else {
                       // Mostrador con el campo todavía vacío: NO autocompletar
                       // con el total — seguimos exigiendo que el cajero lo
                       // escriba, aunque el total del pedido haya cambiado.
                       delete updatedPayment.montoAbonado;
                       delete updatedPayment.paysWith;
                   }
              }
              setPayments([updatedPayment]);

              if (currentPayment.method === 'Efectivo') {
                 const pVal = updatedPayment.montoAbonado;
                 setChange(pVal && pVal > total ? pVal - total : 0);
              }
          }
      }
  }, [total, payments, setPayments, specialDiscountType, montoAbonado, setChange, isCounterMode]);

  // 4. HANDLERS
  const handleSelectPaymentMethod = (method) => {
    setSelectedPaymentMethod(method);

    const newPayment = {
      amount: total,
      method: method,
      montoAbonado: total, // Default to exact amount for non-cash
      paysWith: total
    };

    if (method !== 'Efectivo') {
       setMontoAbonado('');
       setChange(0);
       // Remove cash-specific fields for cleanliness, though keeping them as equal to total is also safe
       delete newPayment.montoAbonado;
       delete newPayment.paysWith;
    } else {
       setMontoAbonado(''); // Reset display input for user to type
       if (isCounterMode) {
          // Mostrador: NO precargar con el total — el campo queda vacío a
          // propósito hasta que el cajero escriba el monto real (obligatorio).
          delete newPayment.montoAbonado;
          delete newPayment.paysWith;
          setChange(0);
       } else {
          // Delivery y cualquier otro contexto: mismo comportamiento de siempre.
          newPayment.montoAbonado = total;
          newPayment.paysWith = total;
       }
    }

    setPayments([newPayment]);
  };

  const handleMontoAbonadoChange = (e) => {
    const val = e.target.value;
    
    // Prevent negative numbers
    if (val && parseFloat(val) < 0) return;
    
    setMontoAbonado(val);
    
    const montoVal = parseFloat(val);
    
    if (selectedPaymentMethod === 'Efectivo') {
      const validMonto = isNaN(montoVal) ? 0 : montoVal;
      
      if (validMonto >= total) {
          setChange(validMonto - total);
      } else {
          setChange(0);
      }
      
      if (payments.length > 0) {
          const updated = { 
              ...payments[0], 
              montoAbonado: validMonto,
              paysWith: validMonto // Maintain compatibility
          };
          setPayments([updated]);
      }
    } else {
      setChange(0);
      // For non-cash methods, typically amount paid equals total, but if this input is used:
      if (payments.length > 0) {
          const updated = { 
            ...payments[0], 
            montoAbonado: montoVal || 0, 
            paysWith: montoVal || 0 
          };
          setPayments([updated]);
      }
    }
  };
  
  const specialDiscountOptions = [
    { id: 'Sorteo', label: 'Sorteo', icon: Trophy },
    { id: 'Regalo', label: 'Regalo', icon: Gift },
    { id: 'Mal Armado', label: 'Mal Armado', icon: ThumbsDown },
  ];

  return (
    <div className="col-span-1 space-y-3">
        {/* Total Display */}
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-1">
              <span className="font-bold text-gray-700 text-lg">Total a Pagar</span>
              <span className="font-extrabold text-primary text-2xl">{formatCurrency(total)}</span>
            </div>
            {selectedPaymentMethod === 'Efectivo' && !specialDiscountType && (
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
                <span className="font-medium text-gray-600">Vuelto a entregar:</span>
                <span className={`font-bold text-lg ${change > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {formatCurrency(change)}
                </span>
              </div>
            )}
        </div>

        {/* Special Discount Section */}
        <div className="p-3 rounded-lg bg-white border border-gray-200 space-y-2">
            <h4 className="font-semibold text-gray-700 text-sm">Descuento Especial</h4>
            <div className="flex justify-around">
                {specialDiscountOptions.map(option => (
                     <div key={option.id} className="flex items-center space-x-2">
                         <Checkbox id={option.id} checked={specialDiscountType === option.id} onCheckedChange={() => handleSpecialDiscountChange(option.id)} />
                         <Label htmlFor={option.id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                            <option.icon className="w-4 h-4" />
                            {option.label}
                          </Label>
                     </div>
                ))}
            </div>
            {specialDiscountType && responsibleEmployee && (
              <div className="text-center text-xs text-green-700 p-1 bg-green-100 rounded">
                Responsable: {responsibleEmployee.nombre} {responsibleEmployee.apellido}
              </div>
            )}
        </div>
      
        {/* Payment Methods */}
        <div className="space-y-4">
          <PaymentMethodSlider 
            methods={allowedPaymentMethods} 
            onSelect={handleSelectPaymentMethod} 
            selectedMethod={selectedPaymentMethod} 
          />
          
          {selectedPaymentMethod === 'Efectivo' && !specialDiscountType && (
              <div className="bg-white p-4 rounded-lg border-2 border-primary/20 shadow-sm">
                  <Label htmlFor="montoAbonado" className="flex items-center gap-2 text-base font-bold text-gray-800 mb-2">
                      <DollarSign className="w-5 h-5 text-green-600" />
                      Paga con{isCounterMode ? ' *' : ''}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                    <Input
                        id="montoAbonado"
                        ref={montoAbonadoInputRef}
                        type="number"
                        min="0"
                        value={montoAbonado}
                        onChange={handleMontoAbonadoChange}
                        className="pl-8 h-12 text-lg font-bold bg-white"
                        placeholder="Ingrese cuánto abona el cliente..."
                        disabled={!!specialDiscountType}
                    />
                  </div>
                  {isCounterMode && !montoAbonado && (
                      <p className="text-amber-600 text-xs font-bold mt-1 text-right">
                          Obligatorio: ingresá con cuánto paga el cliente.
                      </p>
                  )}
                  {montoAbonado && parseFloat(montoAbonado) < total && (
                      <p className="text-red-500 text-xs font-bold mt-1 text-right">
                          Faltan: {formatCurrency(total - parseFloat(montoAbonado))}
                      </p>
                  )}
              </div>
          )}
        </div>
    </div>
  );
};

export default PaymentSection;