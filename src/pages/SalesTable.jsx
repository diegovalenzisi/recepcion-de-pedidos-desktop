import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

const SalesTable = ({ data, onPrint, tableType }) => {
  const formatCurrency = (value) => {
    const numberValue = Number(value);
    if (isNaN(numberValue)) {
        return '$ 0,00';
    }
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(numberValue);
  };

  const showModoColumn = tableType !== 'invoices';

  const totalAmount = data.reduce((sum, item) => sum + (Number(item.importe) || 0), 0);

  return (
    <div className="flex flex-col h-full space-y-4">
      <ScrollArea className="flex-1 rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-gray-50 z-10">
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Hora</TableHead>
              <TableHead>N° Comprobante</TableHead>
              {showModoColumn && <TableHead>Modo</TableHead>}
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="text-center">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length > 0 ? (
              data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.fecha}</TableCell>
                  <TableCell>{item.hora}</TableCell>
                  <TableCell className="font-medium">{item.numeroFactura}</TableCell>
                  {showModoColumn && <TableCell>{item.modo}</TableCell>}
                  <TableCell className="text-right font-semibold">{formatCurrency(item.importe)}</TableCell>
                  <TableCell className="text-center">
                     <Button variant="ghost" size="icon" onClick={() => onPrint(item)}>
                          <Printer className="h-4 w-4 text-slate-600" />
                      </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={showModoColumn ? 6 : 5} className="text-center h-24 text-slate-500">
                  No se encontraron registros para este período.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>
      <div className="bg-slate-50 p-4 rounded-lg border flex justify-between items-center shadow-sm">
        <span className="font-semibold text-slate-700">Total de Registros: {data.length}</span>
        <div className="text-right">
          <span className="text-sm text-slate-500 mr-2">Importe Total:</span>
          <span className="text-xl font-bold text-slate-800">{formatCurrency(totalAmount)}</span>
        </div>
      </div>
    </div>
  );
};

export default SalesTable;