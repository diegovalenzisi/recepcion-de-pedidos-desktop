import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { PlusCircle, Users, Loader2, MinusCircle, Trash2, BadgeCheck, BadgeAlert, Building2, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AddExpenseModal from '@/components/cash/AddExpenseModal';
import HRPaymentFormModal from '@/pages/hr/HRPaymentFormModal';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import ProvidersPage from '@/pages/ProvidersPage';
import { listenToShiftExpenses, addExpenseToShift, deleteExpenseFromShift } from '@/lib/api/expensesApi';
import { fetchEmployees, saveHRPayment, fetchCategories } from '@/lib/api/hrApi';

function ExpensesPage({ currentShift, userPermissions }) {
  const [activeTab, setActiveTab] = useState('expenses');
  const [isExpenseModalOpen, setExpenseModalOpen] = useState(false);
  const [isHRPaymentModalOpen, setHRPaymentModalOpen] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const { toast } = useToast();

  const canRegisterExpense = userPermissions.gastos_registrar_gasto;
  const canManageHRPayments = userPermissions.gastos_pagos_empleados;
  const canAccessProviders = userPermissions.gastos_proveedores || userPermissions.stock;

  useEffect(() => {
    if (activeTab === 'expenses' && currentShift) {
      setLoading(true);
      const unsubscribe = listenToShiftExpenses(currentShift, (newExpenses) => {
        setExpenses(newExpenses);
        setLoading(false);
      });
      
      const loadHRData = async () => {
        try {
          const [employeesData, categoriesData] = await Promise.all([
            fetchEmployees(),
            fetchCategories()
          ]);
          setEmployees(employeesData);
          setCategories(categoriesData);
        } catch (err) {
          console.error("Failed to fetch HR data", err);
        }
      };

      if (canManageHRPayments || canRegisterExpense) {
        loadHRData();
      }

      return () => unsubscribe();
    }
  }, [currentShift, canManageHRPayments, canRegisterExpense, activeTab]);

  const handleAddGeneralExpense = async (expenseData) => {
    try {
      const expenseToSave = {
        ...expenseData,
        origen: 'GASTOS_GENERALES',
        status: 'Pagado',
      };
      await addExpenseToShift(currentShift, expenseToSave);
      toast({ title: "Gasto Registrado", description: `${expenseData.concepto} por ${expenseData.monto.toFixed(2)} ha sido registrado.` });
      setExpenseModalOpen(false);
    } catch(error) {
      toast({ variant: "destructive", title: "Error al registrar gasto", description: error.message });
      throw error;
    }
  };

  const handleAddHRPayment = async (paymentData, isEditing, allEmployees) => {
    try {
      await saveHRPayment(paymentData, isEditing, currentShift, allEmployees);
      toast({ title: 'Pago a empleado registrado', description: 'El pago se ha registrado como un gasto en el turno activo.' });
    } catch (error) {
      toast({ variant: "destructive", title: 'Error', description: 'No se pudieron guardar los datos del pago.' });
    }
  };
  
  const handleDeleteRequest = (expense) => {
    setExpenseToDelete(expense);
  };
  
  const confirmDelete = async () => {
    if (!expenseToDelete) return;
    try {
      await deleteExpenseFromShift(currentShift, expenseToDelete.id);
      toast({ title: 'Gasto eliminado', description: 'El gasto ha sido eliminado correctamente.' });
      setExpenseToDelete(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: `No se pudo eliminar el gasto. ${error.message}` });
      setExpenseToDelete(null);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
  };
  
  const renderPaymentMethod = (expense) => {
    if (expense.status === 'A Pagar') {
      return <span className="text-gray-500 italic">N/A</span>;
    }
    return expense.paymentMethod === 'efectivo' ? 'Efectivo' : 'Electrónico';
  };

  const renderStatus = (status) => {
    if (status === 'A Pagar') {
      return <span className="flex items-center gap-1.5 text-orange-600 font-semibold"><BadgeAlert size={14} /> A Pagar</span>;
    }
    return <span className="flex items-center gap-1.5 text-green-600 font-semibold"><BadgeCheck size={14} /> Pagado</span>;
  };

  const renderExpensesTab = () => {
    if (!currentShift || currentShift.estado !== 'abierto') {
      return (
        <div className="flex items-center justify-center h-full text-center">
          <div>
            <h2 className="text-2xl font-bold mb-2">No hay un turno activo</h2>
            <p className="text-gray-600">Por favor, abre un turno en la sección de Cajas para registrar gastos.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
              <Receipt className="w-8 h-8 text-primary" />
              Gastos del Turno #{currentShift?.id}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Registra y gestiona los gastos del turno activo
            </p>
          </div>
          <div className="flex items-center gap-4">
            {canManageHRPayments && (
              <Button onClick={() => setHRPaymentModalOpen(true)}>
                <Users className="mr-2 h-4 w-4" /> Nuevo Pago a Empleado
              </Button>
            )}
            {canRegisterExpense && (
              <Button onClick={() => setExpenseModalOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Registrar Gasto General
              </Button>
            )}
          </div>
        </div>
        
        <Card className="shadow-xl rounded-xl flex-grow flex flex-col h-full bg-white">
          <CardContent className="flex-grow overflow-auto p-4">
            {loading ? (
              <div className="flex justify-center items-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
            ) : expenses.length === 0 ? (
              <div className="text-center py-10 text-gray-500">
                <MinusCircle size={48} className="mx-auto mb-4" />
                <p>No hay gastos registrados para este turno.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha Caja</TableHead>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Método de Pago</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((expense) => (
                    <TableRow key={expense.id} className={expense.status === 'A Pagar' ? 'bg-orange-50' : ''}>
                      <TableCell>{expense.fechaCaja || new Date(expense.fecha).toLocaleDateString('es-ES')}</TableCell>
                      <TableCell>{expense.empleado || 'N/A'}</TableCell>
                      <TableCell className="font-medium">{expense.concepto}</TableCell>
                      <TableCell>{expense.origen === 'RRHH' ? 'Pago a Empleado' : 'Gasto General'}</TableCell>
                      <TableCell>{renderStatus(expense.status)}</TableCell>
                      <TableCell>{renderPaymentMethod(expense)}</TableCell>
                      <TableCell className={`text-right font-semibold ${expense.status === 'A Pagar' ? 'text-orange-600' : ''}`}>{formatCurrency(expense.monto)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteRequest(expense)}>
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
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-1 h-full flex flex-col"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-4">
          <TabsTrigger value="expenses" className="flex items-center gap-2">
            <Receipt className="w-4 h-4" />
            Gastos del Turno
          </TabsTrigger>
          {canAccessProviders && (
            <TabsTrigger value="providers" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Proveedores
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="expenses" className="flex-1 mt-0">
          {renderExpensesTab()}
        </TabsContent>

        {canAccessProviders && (
          <TabsContent value="providers" className="flex-1 mt-0">
            <ProvidersPage />
          </TabsContent>
        )}
      </Tabs>

      <AddExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        onExpenseAdded={handleAddGeneralExpense}
        currentShift={currentShift}
        employees={employees}
        categories={categories}
      />
      
      <HRPaymentFormModal
        isOpen={isHRPaymentModalOpen}
        onOpenChange={setHRPaymentModalOpen}
        employees={employees}
        onSave={handleAddHRPayment}
        currentShift={currentShift}
      />

      <ConfirmationDialog
        isOpen={!!expenseToDelete}
        onClose={() => setExpenseToDelete(null)}
        onConfirm={confirmDelete}
        title="¿Eliminar gasto?"
        description="Esta acción eliminará permanentemente el registro del gasto del turno actual. No se puede deshacer."
      />
    </motion.div>
  );
}

export default ExpensesPage;