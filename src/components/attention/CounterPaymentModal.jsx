import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Loader2, CheckCircle, Wallet, Gift, ThumbsDown, Trophy, FileText, Calculator } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { fetchAccounts } from '@/lib/api/accountsApi';
import { fetchEmployees, fetchCategories } from '@/lib/api/hrApi';
import { fetchData } from '@/lib/api/firebaseApi';
import { resolverMediosDePago } from '@/lib/api/mediosDePagoMostrador';
import PaymentMethodSlider from '@/components/attention/PaymentMethodSlider';
import ResponsibleEmployeeModal from './ResponsibleEmployeeModal';

// "PAGA CON" OBLIGATORIO + VUELTO — SOLO acá, nunca en Delivery/Web.
//
// Esta pantalla ("Cobrar Venta") es la ÚNICA fuente real de identificación de
// Mostrador que hace falta: es un componente exclusivo del flujo de Mostrador
// —se monta solamente desde CounterPage.jsx/CounterTab.jsx, sobre una venta ya
// creada por counterApi.js (saveCounterSale)—, nunca se importa ni se
// renderiza desde Delivery, Pedido Web ni ningún otro canal (el pago dividido
// de ESE otro flujo es PaymentSection.jsx/ConfirmOrderModal.jsx, gateado por
// su propio flag de modo Mostrador — ver pagaConMostradorEfectivo.test.js—,
// una pantalla completamente distinta que esta corrección no toca). Por eso
// no hace falta —ni se agrega— un booleano
// `esMostrador` nuevo: la condición real es "estamos en CounterPaymentModal",
// que ya es verdad para el 100% de los casos en los que este archivo corre.
const CounterPaymentModal = ({ isOpen, onClose, orderTotal, orderItems, onConfirmPayment, currentShift }) => {
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState('');
  const [paysWith, setPaysWith] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('Efectivo');
  // Foco automático en "Paga con" al elegir/quedar en Efectivo (punto 3).
  const paysWithInputRef = useRef(null);
  // Ingredientes crudos para resolverMediosDePago(): el departamento real de
  // cada artículo del carrito y los medios normales del local. La lista FINAL
  // (`availablePaymentMethods` más abajo) se deriva de esto + el estado del
  // pago (payments/remainingBalance) — nunca se guarda como estado propio,
  // para que un pago parcial la recalcule sola.
  const [itemDepartments, setItemDepartments] = useState([]);
  const [mediosDelLocal, setMediosDelLocal] = useState(['Efectivo']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  
  const [specialDiscountType, setSpecialDiscountType] = useState(null);
  const [responsibleEmployee, setResponsibleEmployee] = useState(null);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [emiteFactura, setEmiteFactura] = useState(false);

  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const currentTotal = useMemo(() => specialDiscountType ? 0 : orderTotal, [specialDiscountType, orderTotal]);
  const remainingBalance = useMemo(() => currentTotal - totalPaid, [currentTotal, totalPaid]);
  
  const loadPaymentMethods = useCallback(async () => {
    try {
        const [accountsData, emp, cat, departamentos] = await Promise.all([
          fetchAccounts(),
          fetchEmployees(),
          fetchCategories(),
          fetchData('departamentos'),
        ]);
        const electronicPaymentMethods = (accountsData || []).map(acc => acc.nombre).filter(Boolean);

        // MISMA función que NewOrderModal.jsx/ConfirmOrderModal (Delivery) —
        // ver mediosDePagoMostrador.js. `orderItems` ya trae el id real del
        // departamento de cada artículo (`item.departamento`, congelado desde
        // el catálogo al agregarlo al carrito); acá se resuelve contra el
        // DEPARTAMENTOS actual del local para tener nombre + flags reales.
        // Sólo se guardan los INGREDIENTES: la lista final se deriva más abajo
        // (useMemo `availablePaymentMethods`), que también mira el pago en curso.
        const resueltos = (orderItems || [])
          .map((item) => departamentos.find((d) => d.id === item?.departamento))
          .filter(Boolean);
        setItemDepartments(resueltos);
        setMediosDelLocal(['Efectivo', ...new Set(electronicPaymentMethods)]);
        setEmployees(emp);
        setCategories(cat);
    } catch(error) {
        toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos necesarios.' });
    }
  }, [toast, orderItems]);

  // ÚNICA fuente de verdad de los medios a ofrecer — misma función que
  // NewOrderModal.jsx. Para una venta de PLATAFORMA (PEDIDOSYA/RAPPI/M.LIBRE)
  // el resultado NUNCA cambia por un pago parcial (2 opciones fijas). Para una
  // venta COMÚN: sin pagos respeta la restricción del departamento (ej.
  // efectivo-only); con un pago en Efectivo ya registrado y saldo pendiente,
  // habilita el resto de las cuentas normales del local para completar la
  // diferencia — nunca ningún PREPAGO de plataforma (filtrarPrepagosDePlataforma
  // dentro de resolverMediosDePago se encarga, no hay comparación paralela).
  const availablePaymentMethods = useMemo(
    () => resolverMediosDePago(itemDepartments, mediosDelLocal, { payments, remainingBalance }).medios,
    [itemDepartments, mediosDelLocal, payments, remainingBalance]
  );

  // Si el medio seleccionado deja de estar disponible (o todavía no hay
  // ninguno elegido y ya sabemos cuáles corresponden), cae al primero de la
  // lista — mismo criterio que tenía el fetch antes de este cambio.
  useEffect(() => {
    if (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(selectedPaymentMethod)) {
      setSelectedPaymentMethod(availablePaymentMethods[0]);
    }
  }, [availablePaymentMethods, selectedPaymentMethod]);

  useEffect(() => {
    if (isOpen) {
      setPayments([]);
      setSpecialDiscountType(null);
      setResponsibleEmployee(null);
      setEmiteFactura(false);
      setIsSubmitting(false);
      setPaysWith('');
      loadPaymentMethods();
    }
  }, [isOpen]);

  useEffect(() => {
    if (specialDiscountType) {
      setPayments([{ amount: 0, method: specialDiscountType }]);
    } else {
      setPayments([]);
    }
  }, [specialDiscountType, orderTotal]);

  useEffect(() => {
    if (isOpen && remainingBalance > 0 && !specialDiscountType) {
        setAmount(remainingBalance.toFixed(2));
    } else {
        setAmount('');
    }
  }, [remainingBalance, isOpen, specialDiscountType]);

  // Al cambiar de método de pago, "Paga con"/vuelto quedan limpios — así un
  // valor tipeado en Efectivo nunca queda pegado si se pasa a Transferencia u
  // otro medio y se vuelve (punto 14). Foco automático en "Paga con" cuando el
  // método QUEDA en Efectivo (incluye la selección inicial al abrir el modal,
  // que ya arranca en Efectivo) — nunca hace falta clickear a mano (punto 3).
  useEffect(() => {
    setPaysWith('');
    if (selectedPaymentMethod === 'Efectivo') {
      paysWithInputRef.current?.focus();
      paysWithInputRef.current?.select();
    }
  }, [selectedPaymentMethod]);

  const handleSpecialDiscountChange = (type) => {
    if (specialDiscountType === type) {
      setSpecialDiscountType(null);
      setResponsibleEmployee(null);
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

  const handleAddPayment = () => {
    if (specialDiscountType) return;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({ variant: 'destructive', title: 'Monto inválido', description: 'Por favor, ingrese un monto válido.' });
      return;
    }
    if (parsedAmount > remainingBalance + 0.001) {
        toast({ variant: 'destructive', title: 'Monto excede el saldo', description: 'El monto ingresado es mayor que el saldo pendiente.' });
        return;
    }
    if (!selectedPaymentMethod) {
      toast({ variant: 'destructive', title: 'Método no seleccionado', description: 'Por favor, elija un método de pago.' });
      return;
    }

    let nuevoPago = { amount: parsedAmount, method: selectedPaymentMethod };

    // "Paga con" es SOLO para Efectivo (esta pantalla es de Mostrador siempre
    // — ver comentario junto al componente). Se revalida acá, no solo con el
    // `disabled` del botón, para que un bypass del botón (ej. Enter en el
    // input) no cuele un pago con un importe insuficiente.
    //
    // Regla vigente:
    //   campo VACÍO ("", null, undefined)  -> paga justo: pagaCon = monto, vuelto = 0
    //   pagaCon == monto                    -> válido, vuelto = 0
    //   pagaCon > monto                     -> válido, vuelto = pagaCon - monto
    //   pagaCon < monto (escrito a mano)    -> inválido, se bloquea
    // Un "0" escrito a mano NO es "vacío": se trata como un importe
    // insuficiente y se bloquea igual que cualquier otro valor menor.
    if (selectedPaymentMethod === 'Efectivo') {
      const paysWithVacio = paysWith === '' || paysWith === null || paysWith === undefined;
      let parsedPaysWith;
      if (paysWithVacio) {
        parsedPaysWith = parsedAmount; // no informado -> paga justo
      } else {
        parsedPaysWith = parseFloat(paysWith);
        if (isNaN(parsedPaysWith) || parsedPaysWith < parsedAmount) {
          toast({ variant: 'destructive', title: 'Importe inválido', description: "El importe de 'Paga con' no puede ser menor al monto a cobrar." });
          return;
        }
      }
      // pagaCon/vuelto son METADATA del pago en efectivo: el monto que se
      // aplica a la venta sigue siendo `parsedAmount` (Total Pagado nunca usa
      // pagaCon) — punto 8 y 11. Campos aditivos: un pago histórico sin ellos
      // sigue funcionando igual (ver render de "Pagos Registrados" más abajo).
      nuevoPago = { ...nuevoPago, pagaCon: parsedPaysWith, vuelto: parsedPaysWith - parsedAmount };
    }

    setPayments([...payments, nuevoPago]);
    setPaysWith('');
  };
  
  const removePayment = (index) => {
    if (specialDiscountType) return;
    setPayments(payments.filter((_, i) => i !== index));
  };

  const handleConfirmPayment = async () => {
    if (isSubmitting) return; 
    
    if (specialDiscountType && !responsibleEmployee) {
      toast({ variant: "destructive", title: "Falta Responsable", description: "Debe seleccionar un empleado responsable." });
      setIsEmployeeModalOpen(true);
      return;
    }
    if (remainingBalance > 0.009 && !specialDiscountType) {
      toast({ variant: "destructive", title: "Saldo pendiente", description: `Aún falta abonar ${formatCurrency(remainingBalance)}.` });
      return;
    }
    if (payments.length === 0 && !specialDiscountType) {
        toast({ variant: "destructive", title: "Sin pagos", description: "Agregue al menos un pago para confirmar." });
        return;
    }

    setIsSubmitting(true);
    try {
        const specialDiscount = specialDiscountType ? { type: specialDiscountType, responsible: responsibleEmployee } : null;
        // Los prepagos PEDIDOSYA/RAPPI se guardan dentro de saveCounterSale (background).
        // No duplicar aquí.
        await onConfirmPayment(payments.filter(p => p.amount > 0), specialDiscount, emiteFactura, currentTotal);
    } catch (e) {
        toast({ variant: "destructive", title: "Error", description: "Ocurrió un error al procesar el pago." });
    } finally {
        // SIEMPRE se libera el botón, por cualquier salida.
        //
        // Antes sólo se limpiaba en el `catch`, y el camino de éxito dependía de
        // que el padre cerrara el modal. Como `handlePaymentConfirm` atrapa sus
        // propios errores y NO relanza, cualquier salida que no terminara en
        // cierre (error al guardar, cola fiscal mal configurada, factura
        // demorada, error de ARCA, cancelación de la pregunta) dejaba el botón
        // girando para siempre.
        setIsSubmitting(false);
    }
  };

  const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

  const calculateChange = useMemo(() => {
    const payValue = parseFloat(paysWith);
    const amountValue = parseFloat(amount);
    if (!isNaN(payValue) && !isNaN(amountValue) && payValue >= amountValue) {
      return payValue - amountValue;
    }
    return 0;
  }, [paysWith, amount]);

  // Campo VACÍO ("", null, undefined) = paga justo -> siempre válido, nunca
  // deshabilita "Añadir Pago". Un valor ESCRITO solo es inválido si es menor
  // al monto a cobrar (igual ya es válido: vuelto 0). handleAddPayment
  // revalida esto mismo por si se dispara el submit sin pasar por el botón.
  const paysWithInvalido = useMemo(() => {
    if (paysWith === '' || paysWith === null || paysWith === undefined) return false;
    const payValue = parseFloat(paysWith);
    const amountValue = parseFloat(amount);
    return isNaN(payValue) || isNaN(amountValue) || payValue < amountValue;
  }, [paysWith, amount]);

  const specialDiscountOptions = [
    { id: 'Sorteo', label: 'Sorteo', icon: Trophy },
    { id: 'Regalo', label: 'Regalo', icon: Gift },
    { id: 'Mal Armado', label: 'Mal Armado', icon: ThumbsDown },
  ];

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-4xl bg-gray-50">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center"><Wallet className="mr-2 text-primary"/>Cobrar Venta</DialogTitle>
          <DialogDescription>
            Divida el pago del pedido. Total: {formatCurrency(orderTotal)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-6 py-4">
          <div className="col-span-1 flex flex-col gap-4">
            <div className="p-4 rounded-lg bg-white shadow border border-gray-200">
              <div className="flex justify-between items-center text-lg">
                <span className="font-medium text-gray-600">Total Pagado:</span>
                <span className="font-bold text-green-600">{formatCurrency(totalPaid)}</span>
              </div>
              <div className="flex justify-between items-center text-xl mt-1">
                <span className="font-bold text-gray-800">Saldo Pendiente:</span>
                <span className="font-extrabold text-red-600">{formatCurrency(remainingBalance)}</span>
              </div>
            </div>
            
            {/* VENTA YA PAGADA POR COMPLETO: no se ofrece iniciar otro pago.
                Antes, con el saldo en cero, elegir otro medio volvía a mostrar
                "Monto a Cobrar / Paga con / Añadir Pago" —un cobro que no
                correspondía y que sólo podía confundir—. Con saldo cero quedan
                a la vista únicamente los pagos registrados y Confirmar Venta.
                El descuento especial mantiene su propio flujo. */}
            {(remainingBalance > 0.009 || specialDiscountType) && (
              <div className="space-y-4">
                <PaymentMethodSlider methods={availablePaymentMethods} onSelect={setSelectedPaymentMethod} selectedMethod={selectedPaymentMethod}/>
              </div>
            )}

            {remainingBalance <= 0.009 && !specialDiscountType ? null
              : selectedPaymentMethod === 'Efectivo' && !specialDiscountType ? (
                <div className="space-y-3 p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="amount" className="text-xs font-semibold text-gray-600 mb-1 block">Monto a Cobrar</Label>
                            <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 text-lg font-bold" placeholder="0.00" />
                        </div>
                        <div>
                            <Label htmlFor="paysWith" className="text-xs font-semibold text-gray-600 mb-1 block">Paga con</Label>
                            <Input
                                id="paysWith"
                                type="number"
                                ref={paysWithInputRef}
                                value={paysWith}
                                onChange={(e) => setPaysWith(e.target.value)}
                                className="h-10 text-lg"
                                placeholder="0.00"
                            />
                        </div>
                    </div>
                    {paysWith && !paysWithInvalido && (
                        <div className="flex justify-between items-center bg-white p-2 rounded border border-green-200 shadow-sm">
                            <span className="text-sm font-medium text-green-800 flex items-center gap-2">
                                <Calculator className="w-4 h-4"/> Vuelto:
                            </span>
                            <span className="text-2xl font-bold text-green-600">{formatCurrency(calculateChange)}</span>
                        </div>
                    )}
                    {paysWith && paysWithInvalido && (
                        <p className="text-xs font-medium text-red-600">
                          El importe de 'Paga con' no puede ser menor al monto a cobrar.
                        </p>
                    )}
                     <Button className="w-full h-10 text-base" onClick={handleAddPayment} disabled={!amount || remainingBalance <= 0 || paysWithInvalido}>
                          <Plus className="mr-2 h-4 w-4"/> Añadir Pago
                     </Button>
                </div>
            ) : (
                <div className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-8">
                    <Label htmlFor="amount" className="text-xs font-semibold text-gray-600 mb-1 block">Monto</Label>
                    <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg" placeholder="0.00" disabled={!!specialDiscountType} />
                  </div>
                  <div className="col-span-4">
                      <Button className="w-full h-12 text-base" onClick={handleAddPayment} disabled={!amount || remainingBalance <= 0 || !!specialDiscountType}>
                          <Plus className="mr-2 h-4 w-4"/> Añadir
                      </Button>
                  </div>
                </div>
            )}

            <div className="p-4 rounded-lg bg-white shadow-sm border border-gray-200 space-y-3">
                <h4 className="font-semibold text-gray-700">Descuento Especial</h4>
                <div className="flex justify-around">
                    {specialDiscountOptions.map(option => (
                          <div key={option.id} className="flex items-center space-x-2">
                              <Checkbox id={`counter-${option.id}`} checked={specialDiscountType === option.id} onCheckedChange={() => handleSpecialDiscountChange(option.id)} />
                              <Label htmlFor={`counter-${option.id}`} className="flex items-center gap-1.5 cursor-pointer">
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
          </div>
          <div className="col-span-1">
            <h4 className="font-semibold text-gray-700 mb-2">Pagos Registrados:</h4>
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-2 bg-white p-2 rounded-lg border">
              <AnimatePresence>
                {payments.length > 0 ? payments.map((p, i) => (
                  p.amount > 0 && <motion.div
                    key={i}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
                    className="p-3 bg-gray-100 rounded-lg"
                  >
                    {/* Efectivo de Mostrador con pagaCon guardado: desglose
                        Total/Paga con/Vuelto (punto 9). Cualquier otro pago
                        (otro método, o un histórico sin estos campos aditivos)
                        conserva exactamente la línea única de siempre — punto 10. */}
                    {p.method === 'Efectivo' && p.pagaCon !== undefined ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-800">Efectivo</span>
                          <Button variant="ghost" size="icon" onClick={() => removePayment(i)} className="text-red-500 hover:bg-red-100 hover:text-red-600 h-8 w-8" disabled={!!specialDiscountType}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex justify-between items-center text-sm text-gray-600">
                          <span>Total:</span>
                          <span className="font-bold text-gray-900">{formatCurrency(p.amount)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm text-gray-600">
                          <span>Paga con:</span>
                          <span>{formatCurrency(p.pagaCon)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm text-gray-600">
                          <span>Vuelto:</span>
                          <span>{formatCurrency(p.vuelto)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{p.method}</span>
                        <div className="flex items-center gap-4">
                          <span className="font-bold text-gray-900">{formatCurrency(p.amount)}</span>
                          <Button variant="ghost" size="icon" onClick={() => removePayment(i)} className="text-red-500 hover:bg-red-100 hover:text-red-600" disabled={!!specialDiscountType}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )) : (
                  <p className="text-center text-gray-500 py-4">Aún no se han registrado pagos.</p>
                )}
              </AnimatePresence>
            </div>
            <div className="flex items-center space-x-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mt-4">
                <Checkbox id="emiteFacturaCounter" checked={emiteFactura} onCheckedChange={setEmiteFactura} />
                <Label htmlFor="emiteFacturaCounter" className="font-medium text-blue-800 flex items-center gap-2 cursor-pointer">
                  <FileText className="w-4 h-4" />
                  Emite Factura
                </Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
          <Button 
            type="button" 
            onClick={handleConfirmPayment} 
            disabled={isSubmitting || (remainingBalance > 0.01 && !specialDiscountType)}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            Confirmar Venta
          </Button>
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
};

export default CounterPaymentModal;