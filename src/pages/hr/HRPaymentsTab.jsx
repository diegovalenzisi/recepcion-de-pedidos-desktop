import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchHRPayments, saveHRPayment, deleteHRPayment, fetchEmployees } from '@/lib/api/hrApi';
import { Loader2, PlusCircle, Edit, Trash2, DollarSign, Clock } from 'lucide-react';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import HRPaymentFormModal from '@/pages/hr/HRPaymentFormModal';

function HRPaymentsTab({ currentShift }) {
  const [payments, setPayments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPayment, setEditingPayment] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState(null);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [paymentsData, employeesData] = await Promise.all([
        fetchHRPayments(),
        fetchEmployees(),
      ]);
      
      const employeesMap = employeesData.reduce((acc, emp) => {
        acc[emp.legajo] = `${emp.nombre} ${emp.apellido}`;
        return acc;
      }, {});

      const enrichedPayments = paymentsData.map(p => ({
        ...p,
        employeeName: employeesMap[p.employeeId] || 'Empleado no encontrado',
      }));

      setPayments(enrichedPayments);
      setEmployees(employeesData);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos de pagos.' });
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAdd = () => {
    setEditingPayment(null);
    setIsModalOpen(true);
  };

  const handleEdit = (payment) => {
    setEditingPayment(payment);
    setIsModalOpen(true);
  };

  const handleDeleteRequest = (payment) => {
    setPaymentToDelete(payment);
  };

  const confirmDelete = async () => {
    if (!paymentToDelete) return;
    try {
      await deleteHRPayment(paymentToDelete.id);
      toast({ title: 'Pago eliminado', description: `El registro del pago ha sido eliminado.` });
      setPaymentToDelete(null);
      loadData();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar el pago.' });
      setPaymentToDelete(null);
    }
  };

  const handleSave = async (paymentData, isEditing) => {
    try {
      await saveHRPayment(paymentData, isEditing, currentShift);
      toast({ title: `Pago ${isEditing ? 'actualizado' : 'registrado'}`, description: 'Los datos se guardaron correctamente.' });
      if (currentShift && currentShift.estado === 'abierto') {
        toast({ title: "Gasto de Turno Registrado", description: "El pago se ha registrado como un gasto en el turno activo." });
      }
      loadData();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron guardar los datos del pago.' });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col"
    >
      <Card className="shadow-xl rounded-xl flex-grow flex flex-col h-full bg-white">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl font-bold">Gestión de Pagos a Empleados</CardTitle>
          <Button onClick={handleAdd}>
            <PlusCircle className="mr-2 h-4 w-4" /> Nuevo Pago
          </Button>
        </CardHeader>
        <CardContent className="flex-grow overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="h-12 w-12 animate-spin text-orange-500" /></div>
          ) : payments.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <DollarSign size={48} className="mx-auto mb-4" />
              <p>No hay pagos registrados.</p>
              <p className="text-sm mt-2">Haz clic en "Nuevo Pago" para empezar.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-center">Horas</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{new Date(payment.fecha).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium">{payment.employeeName}</TableCell>
                    <TableCell>{payment.concepto}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Clock size={14} />
                        <span>{payment.totalHoras?.toFixed(2) || 'N/A'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">${payment.monto.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(payment)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteRequest(payment)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <HRPaymentFormModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        payment={editingPayment}
        employees={employees}
        onSave={handleSave}
        currentShift={currentShift}
      />
      <ConfirmationDialog
        isOpen={!!paymentToDelete}
        onClose={() => setPaymentToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar registro de pago?`}
        description="Esta acción eliminará permanentemente el registro del pago."
      />
    </motion.div>
  );
}

export default HRPaymentsTab;