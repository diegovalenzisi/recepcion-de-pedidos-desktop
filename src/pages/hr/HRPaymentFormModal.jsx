import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Receipt, PiggyBank } from 'lucide-react';
import { accumulateHRPayment, fetchAccumulatedDataForEmployee, savePaymentHistory } from '@/lib/api/hrApi';
import PaymentTypeSelector from '@/pages/hr/payment-form/PaymentTypeSelector';
import EmployeeSelector from '@/pages/hr/payment-form/EmployeeSelector';
import HoursPaymentFields from '@/pages/hr/payment-form/HoursPaymentFields';
import OtherPaymentFields from '@/pages/hr/payment-form/OtherPaymentFields';
import ShiftPaymentFields from '@/pages/hr/payment-form/ShiftPaymentFields';
import AccumulatedPaymentFields from '@/pages/hr/payment-form/AccumulatedPaymentFields';
import PaymentMethodSelector from '@/pages/hr/payment-form/PaymentMethodSelector';
import { calculatePayment, prepareSaveData, generateWhatsAppMessage } from '@/pages/hr/payment-form/paymentUtils';
import { fetchAccounts } from '@/lib/api/accountsApi'; // Import fetchAccounts

const HRPaymentFormModal = ({ isOpen, onOpenChange, payment, employees, onSave, currentShift }) => {
  const [paymentType, setPaymentType] = useState('horas');
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [formData, setFormData] = useState({
    employeeId: '',
    turno1Desde: '',
    turno1Hasta: '',
    turno2Desde: '',
    turno2Hasta: '',
    conceptoManual: '',
    montoManual: '',
    turnos: {
        manana: false,
        tarde: false,
        noche: false,
    },
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const { toast } = useToast();
  const [accumulatedData, setAccumulatedData] = useState(null);
  const [loadingAccumulated, setLoadingAccumulated] = useState(false);
  const [accounts, setAccounts] = useState([]); // State for accounts

  const selectedEmployee = useMemo(() => {
    return employees.find(e => e.legajo === formData.employeeId);
  }, [formData.employeeId, employees]);

  useEffect(() => {
    const loadAccumulated = async () => {
      if (paymentType === 'pago_acumulado' && formData.employeeId) {
        setLoadingAccumulated(true);
        const data = await fetchAccumulatedDataForEmployee(formData.employeeId, employees);
        setAccumulatedData(data);
        setLoadingAccumulated(false);
      } else {
        setAccumulatedData(null);
      }
    };
    loadAccumulated();
  }, [paymentType, formData.employeeId, employees]);

  const { totalHours, totalPayment, totalShiftPayment } = calculatePayment(formData, selectedEmployee);

  useEffect(() => {
    const defaultState = { 
        id: null,
        employeeId: '', 
        turno1Desde: '', 
        turno1Hasta: '', 
        turno2Desde: '', 
        turno2Hasta: '',
        conceptoManual: '',
        montoManual: '',
        turnos: { manana: false, tarde: false, noche: false }
    };

    if (payment) {
      setFormData({
        ...defaultState,
        id: payment.id,
        employeeId: payment.employeeId || '',
        turno1Desde: payment.turno1Desde || '',
        turno1Hasta: payment.turno1Hasta || '',
        turno2Desde: payment.turno2Desde || '',
        turno2Hasta: payment.turno2Hasta || '',
        conceptoManual: payment.conceptoManual || '',
        montoManual: payment.montoManual || '',
        turnos: payment.turnos || { manana: false, tarde: false, noche: false },
      });
      setPaymentType(payment.type || (payment.totalHoras !== undefined ? 'horas' : 'otro'));
      setPaymentMethod(payment.paymentMethod || null);
    } else {
      setFormData(defaultState);
      setPaymentType('horas');
      setPaymentMethod(null);
    }
    setErrors({});
  }, [payment, isOpen]);

  // Load accounts when modal opens
  useEffect(() => {
    const loadAccounts = async () => {
      if (isOpen) {
        try {
          const fetchedAccounts = await fetchAccounts();
          setAccounts(fetchedAccounts);
        } catch (error) {
          console.error("Error loading accounts:", error);
          toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar las cuentas bancarias." });
        }
      }
    };
    loadAccounts();
  }, [isOpen, toast]);

  const validate = (isAccumulating = false) => {
    const newErrors = {};
    if (!formData.employeeId) newErrors.employeeId = 'Debe seleccionar un empleado.';
    
    if (paymentType === 'horas') {
      if (totalHours <= 0) newErrors.hours = 'Debe ingresar al menos un turno con horas válidas.';
    } else if (paymentType === 'otro') {
      if (!formData.conceptoManual.trim()) newErrors.conceptoManual = 'El concepto es obligatorio.';
      const monto = parseFloat(formData.montoManual);
      if (isNaN(monto) || monto <= 0) newErrors.montoManual = 'El monto debe ser un número positivo.';
    } else if (paymentType === 'turno') {
        if (!formData.turnos.manana && !formData.turnos.tarde && !formData.turnos.noche) {
            newErrors.shifts = 'Debe seleccionar al menos un turno.';
        }
    } else if (paymentType === 'pago_acumulado') {
        if (!accumulatedData || !accumulatedData.totalAcumulado || accumulatedData.totalAcumulado <= 0) {
            newErrors.accumulated = 'Este empleado no tiene un monto acumulado para pagar.';
        }
    }

    if (!isAccumulating && !paymentMethod) newErrors.paymentMethod = 'Debe seleccionar un método de pago.';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast({ variant: "destructive", title: "Error de validación", description: "Por favor, corrija los errores en el formulario." });
      return;
    }
    setIsSaving(true);
    
    const dataToSave = prepareSaveData({
      paymentType,
      formData,
      totalHours,
      totalPayment,
      totalShiftPayment,
      accumulatedData,
      selectedEmployee,
      paymentMethod,
      paymentId: payment?.id,
      isAccumulating: false,
    });
    
    await onSave(dataToSave, !!payment, employees);

    if (paymentType === 'pago_acumulado' && selectedEmployee) {
      if (selectedEmployee.telefono) {
          const message = generateWhatsAppMessage(selectedEmployee, accumulatedData, paymentMethod, accounts);
          const phoneNumber = `+549${selectedEmployee.telefono.replace(/\D/g, '')}`;
          window.open(`whatsapp://send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`, '_blank');
      }

      try {
        const employeeFullName = `${selectedEmployee.nombre} ${selectedEmployee.apellido}`;
        await savePaymentHistory(employeeFullName, accumulatedData, paymentMethod, currentShift.date);
        toast({ title: 'Historial Guardado', description: 'El detalle del pago se ha guardado en el historial.' });
      } catch (error) {
        console.error("Error saving payment history:", error);
        toast({ variant: "destructive", title: "Error de Historial", description: "No se pudo guardar el detalle del pago." });
      }
    }
    
    setIsSaving(false);
    onOpenChange(false);
  };

  const handleAccumulate = async () => {
    if (!validate(true)) {
        toast({ variant: "destructive", title: "Error de validación", description: "Por favor, corrija los errores en el formulario." });
        return;
    }
    setIsSaving(true);
    const dataToSave = prepareSaveData({
      paymentType,
      formData,
      totalHours,
      totalPayment,
      totalShiftPayment,
      selectedEmployee,
      isAccumulating: true,
    });
    const employeeName = `${selectedEmployee.nombre} ${selectedEmployee.apellido}`;
    try {
        await accumulateHRPayment(dataToSave, employeeName, currentShift);
        toast({ title: "Pago Acumulado", description: "El pago se ha guardado para liquidar en el futuro y se ha registrado como pendiente en el turno actual." });
        onOpenChange(false);
    } catch (error) {
        console.error("Accumulation error:", error);
        toast({ variant: "destructive", title: "Error", description: "No se pudo acumular el pago." });
    } finally {
        setIsSaving(false);
    }
  };

  const handleChange = (id, value) => {
    setFormData(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      const newErrors = { ...errors };
      delete newErrors[id];
      setErrors(newErrors);
    }
  };
  
  const handleShiftChange = (shiftName) => {
    setFormData(prev => ({
        ...prev,
        turnos: {
            ...prev.turnos,
            [shiftName]: !prev.turnos[shiftName]
        }
    }));
  };

  let finalAmount = 0;
  if (paymentType === 'horas') finalAmount = totalPayment;
  else if (paymentType === 'turno') finalAmount = totalShiftPayment;
  else if (paymentType === 'otro') finalAmount = parseFloat(formData.montoManual) || 0;
  else if (paymentType === 'pago_acumulado') finalAmount = accumulatedData?.totalAcumulado || 0;

  const isSaveDisabled = isSaving || !formData.employeeId || finalAmount <= 0 || !paymentMethod;
  const canAccumulate = (paymentType === 'horas' || paymentType === 'otro' || paymentType === 'turno') && currentShift && currentShift.estado === 'abierto';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{payment ? 'Editar Pago' : 'Registrar Nuevo Pago'}</DialogTitle>
          <DialogDescription>Selecciona el tipo de pago, el empleado y completa los datos.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          <PaymentTypeSelector paymentType={paymentType} setPaymentType={setPaymentType} />
          
          <EmployeeSelector 
            employeeId={formData.employeeId} 
            employees={employees} 
            selectedEmployee={selectedEmployee}
            error={errors.employeeId}
            onChange={(value) => handleChange('employeeId', value)}
          />

          {paymentType === 'horas' && (
            <HoursPaymentFields 
              formData={formData}
              handleChange={handleChange}
              totalHours={totalHours}
              totalPayment={totalPayment}
              error={errors.hours}
            />
          )}

          {paymentType === 'turno' && (
            <ShiftPaymentFields
              formData={formData}
              handleShiftChange={handleShiftChange}
              totalShiftPayment={totalShiftPayment}
              error={errors.shifts}
              employee={selectedEmployee}
            />
          )}

          {paymentType === 'otro' && (
            <OtherPaymentFields
              formData={formData}
              handleChange={handleChange}
              errors={errors}
            />
          )}

          {paymentType === 'pago_acumulado' && (
            <AccumulatedPaymentFields
              loading={loadingAccumulated}
              data={accumulatedData}
              employee={selectedEmployee}
              error={errors.accumulated}
            />
          )}

          <PaymentMethodSelector
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            error={errors.paymentMethod}
          />
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-2 mt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2">
              {canAccumulate && (
                <Button onClick={handleAccumulate} disabled={isSaving || !formData.employeeId || finalAmount <= 0} variant="secondary">
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <PiggyBank className="mr-2 h-4 w-4" />
                    Acumular Pago
                </Button>
              )}
              <Button onClick={handleSave} disabled={isSaveDisabled} className="bg-green-600 hover:bg-green-700">
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Receipt className="mr-2 h-4 w-4" />
                  Registrar Gasto (${finalAmount.toFixed(2)})
              </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HRPaymentFormModal;