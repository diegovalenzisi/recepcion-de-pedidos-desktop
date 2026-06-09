import React, { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import { fetchAllArticles } from '@/lib/api/priceUpdateApi';
import { useToast } from '@/hooks/use-toast';
import { generatePriceExportFilename, formatPriceDataForExport } from '@/lib/export/priceExportUtils';
import { getCurrentLocalId } from '@/lib/firebase/core';

export default function PriceHistoryModal({ history, loadHistory, onDelete }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteId, setDeleteId] = useState(null);
  const [initialPrices, setInitialPrices] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const fetchInitial = async () => {
      setLoadingInitial(true);
      try {
        const articles = await fetchAllArticles();
        const formatted = articles.map(a => ({
          id: `init-${a.id}`,
          codigo: a.codigo,
          nombre: a.nombre,
          departamento: a.departamento || 'Sin Departamento',
          precio_anterior: '-',
          precio_nuevo: a.valor || 0,
          fecha: new Date().toISOString().split('T')[0],
          hora: '-',
          usuario: 'Sistema',
          tipo: 'Inicial'
        }));
        setInitialPrices(formatted);
      } catch (error) {
        console.error("Error fetching initial articles:", error);
      } finally {
        setLoadingInitial(false);
      }
    };

    if (history.length === 0) {
      fetchInitial();
    } else {
      setInitialPrices([]);
    }
  }, [history]);

  const isInitialLoad = history.length === 0;
  const displayData = isInitialLoad ? initialPrices : history;

  const filteredData = displayData.filter(h => 
    h.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    h.codigo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    h.departamento?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExport = () => {
    const hasMissingDepts = filteredData.some(h => !h.departamento || h.departamento === 'Sin Departamento');
    
    if (hasMissingDepts) {
      const confirmExport = window.confirm("Algunos registros no tienen un departamento asignado ('Sin Departamento'). ¿Desea continuar con la exportación?");
      if (!confirmExport) return;
    }

    const rawExportData = filteredData.map(h => ({
      codigo: h.codigo,
      nombre: h.nombre,
      departamento: h.departamento,
      nuevo_precio: h.precio_nuevo
    }));

    const formattedData = formatPriceDataForExport(rawExportData);

    const ws = XLSX.utils.json_to_sheet(formattedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isInitialLoad ? "Precios Iniciales" : "Historial");
    
    const localId = getCurrentLocalId();
    const fileName = generatePriceExportFilename(localId, 'precios');
    
    XLSX.writeFile(wb, fileName);
    
    toast({
      title: "Exportación Exitosa",
      description: `El historial se ha exportado correctamente como ${fileName}`,
      className: "bg-green-50 border-green-200 text-green-800"
    });
  };

  const confirmDelete = () => {
    if (deleteId) {
      onDelete(deleteId);
      setDeleteId(null);
    }
  };

  const hasMissingDepts = filteredData.some(h => !h.departamento || h.departamento === 'Sin Departamento');

  return (
    <div className="space-y-4 flex flex-col h-full">
      <div className="flex justify-between items-center">
        <Input 
          placeholder="Buscar por nombre, código o departamento..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-md"
        />
        <Button onClick={handleExport} variant="outline" className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200">
          <Download className="w-4 h-4 mr-2" /> Exportar a Excel (.xlsx)
        </Button>
      </div>

      {hasMissingDepts && (
        <div className="flex items-center text-sm text-amber-700 bg-amber-50 p-2 rounded-md">
          <AlertTriangle className="w-4 h-4 mr-2" />
          Hay artículos en el historial sin departamento asignado.
        </div>
      )}

      {isInitialLoad && initialPrices.length > 0 && (
        <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm">
          <strong>Carga Inicial:</strong> No se encontraron registros en el historial de precios. Se muestran los precios actuales de los artículos.
        </div>
      )}

      <div className="border rounded-md flex-1 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Dpto.</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Precio Ant.</TableHead>
              <TableHead>Precio Nuevo</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingInitial && isInitialLoad ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <div className="flex items-center justify-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Cargando precios iniciales...
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredData.length > 0 ? (
              filteredData.map(item => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.codigo}</TableCell>
                  <TableCell className={item.departamento === 'Sin Departamento' ? 'text-amber-600' : ''}>
                    {item.departamento}
                  </TableCell>
                  <TableCell>{item.nombre}</TableCell>
                  <TableCell>{item.precio_anterior === '-' ? '-' : `$${item.precio_anterior}`}</TableCell>
                  <TableCell className="text-green-600 font-bold">${item.precio_nuevo}</TableCell>
                  <TableCell>{item.fecha} {item.hora !== '-' && <span className="text-muted-foreground text-xs ml-1">{item.hora}</span>}</TableCell>
                  <TableCell>{item.usuario}</TableCell>
                  <TableCell className="capitalize">{item.tipo}</TableCell>
                  <TableCell>
                    {item.tipo !== 'Inicial' && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(item.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No se encontraron registros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmationDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="¿Eliminar registro?"
        description="Esta acción eliminará el registro del historial de precios permanentemente."
      />
    </div>
  );
}