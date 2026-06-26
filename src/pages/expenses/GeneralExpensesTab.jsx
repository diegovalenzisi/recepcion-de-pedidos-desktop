import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Trash2, MinusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';

function GeneralExpensesTab({ refreshKey }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const { toast } = useToast();

  const handleDeleteRequest = (expense) => {
    setExpenseToDelete(expense);
  };

  const confirmDelete = async () => {
    if (!expenseToDelete) return;
    try {
      toast({ title: 'Gasto eliminado', description: 'El gasto ha sido eliminado correctamente.' });
      setExpenseToDelete(null);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar el gasto.' });
      setExpenseToDelete(null);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col"
    >
      <Card className="shadow-xl rounded-xl flex-grow flex flex-col h-full bg-white">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Historial de Gastos Generales</CardTitle>
        </CardHeader>
        <CardContent className="flex-grow overflow-auto p-4">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="h-12 w-12 animate-spin text-orange-500" /></div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <MinusCircle size={48} className="mx-auto mb-4" />
              <p>No hay gastos generales registrados.</p>
              <p className="text-sm mt-2">Haz clic en "Registrar Gasto" para empezar.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Método de Pago</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>{new Date(expense.fecha).toLocaleString('es-ES')}</TableCell>
                    <TableCell className="font-medium">{expense.concepto}</TableCell>
                    <TableCell>{expense.paymentMethod === 'efectivo' ? 'Efectivo' : 'Electrónico'}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(expense.monto)}</TableCell>
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
      
      <ConfirmationDialog
        isOpen={!!expenseToDelete}
        onClose={() => setExpenseToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar gasto?`}
        description="Esta acción eliminará permanentemente el registro del gasto. No se puede deshacer."
      />
    </motion.div>
  );
}

export default GeneralExpensesTab;