import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Loader2, Download } from 'lucide-react';
import { fetchPrepayments } from '@/lib/api/prepaymentApi';
import * as XLSX from 'xlsx';

const PrepaymentHistoryModal = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('PREPAGO PEDIDOSYA');
  const [records, setRecords] = useState([]);

  useEffect(() => {
    if (isOpen) {
      loadData(activeTab);
    }
  }, [isOpen, activeTab]);

  const loadData = async (type) => {
    setLoading(true);
    try {
      const data = await fetchPrepayments(type);
      setRecords(data);
    } catch (error) {
      console.error("Error loading prepayments:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (records.length === 0) return;
    const exportData = records.map(r => ({
      App: r.type || activeTab.replace('PREPAGO ', ''),
      Número: r.numero || 'N/A',
      Fecha: r.fecha,
      Hora: r.hora,
      Monto: r.monto,
      ID: r.id
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Historial");
    XLSX.writeFile(wb, `Historial_${activeTab.replace(' ', '_')}.xls`, { bookType: 'biff8' });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Historial de Prepagos</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="PREPAGO PEDIDOSYA">PedidosYa</TabsTrigger>
            <TabsTrigger value="PREPAGO RAPPI">Rappi</TabsTrigger>
            {/* El `value` es el nombre de la cuenta (deriva la clave del nodo);
                la etiqueta visible sigue siendo la marca "M.PAGO". Los dos
                nombres resuelven al mismo nodo PREPAGO_MPAGO. */}
            <TabsTrigger value="PREPAGO MPAGO">M.LIBRE</TabsTrigger>
          </TabsList>
          
          <div className="flex justify-end mt-4">
            <Button onClick={handleExport} variant="outline" size="sm" disabled={records.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Exportar a Excel (.xls)
            </Button>
          </div>

          <div className="mt-4 border rounded-md h-[400px] overflow-auto relative bg-white">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/50">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : records.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                No hay registros para este tipo.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>App Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-semibold text-gray-700">
                        {record.numero ? `#${record.numero}` : '-'}
                      </TableCell>
                      <TableCell>{record.fecha}</TableCell>
                      <TableCell>{record.hora}</TableCell>
                      <TableCell className="font-bold text-gray-900">
                        {formatCurrency(record.monto)}
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${activeTab.includes('PEDIDOSYA') ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {record.type || activeTab.replace('PREPAGO ', '')}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default PrepaymentHistoryModal;