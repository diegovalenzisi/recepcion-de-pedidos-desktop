import React, { useState, useMemo, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { validatePriceData, formatPriceChangeSummary, fetchAndMapDepartmentNames, getDepartmentName } from '@/lib/api/priceUpdateUtils';
import { Trash2, AlertCircle, Save, CalendarClock, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { generatePriceExportFilename, formatPriceDataForExport } from '@/lib/export/priceExportUtils';
import { getCurrentLocalId } from '@/lib/firebase/core';

export default function ScheduledPriceUpdateTab({ articles, scheduledUpdates, onSchedule, onCancel, loading }) {
  const [scheduleDate, setScheduleDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [edits, setEdits] = useState({});
  const [departmentMap, setDepartmentMap] = useState({});
  const { toast } = useToast();

  useEffect(() => {
    const loadDepartments = async () => {
      const map = await fetchAndMapDepartmentNames();
      setDepartmentMap(map);
    };
    loadDepartments();
  }, []);

  const mappedArticles = useMemo(() => {
    return articles.map(a => ({
      ...a,
      mappedDeptName: getDepartmentName(a.departamentoId || a.departamento, departmentMap)
    }));
  }, [articles, departmentMap]);

  const departments = useMemo(() => {
    const depts = new Set(mappedArticles.map(a => a.mappedDeptName).filter(d => d && d !== '-'));
    return Array.from(depts).sort();
  }, [mappedArticles]);

  const filteredArticles = mappedArticles.filter(a => {
    const matchesSearch = a.nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          a.codigo?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDept = deptFilter === 'all' || a.mappedDeptName === deptFilter;
    return matchesSearch && matchesDept;
  });

  const handlePriceChange = (id, value) => {
    if (value === '') {
      const newEdits = { ...edits };
      delete newEdits[id];
      setEdits(newEdits);
      return;
    }
    setEdits(prev => ({ ...prev, [id]: value }));
  };

  const handleExportScheduled = () => {
    if (!scheduledUpdates || scheduledUpdates.length === 0) return;

    const rawExportData = [];
    scheduledUpdates.forEach(update => {
      update.changes.forEach(change => {
        rawExportData.push({
          codigo: change.codigo,
          nombre: change.nombre,
          departamento: change.departamento,
          nuevo_precio: change.precio_nuevo
        });
      });
    });

    const formattedData = formatPriceDataForExport(rawExportData);

    const ws = XLSX.utils.json_to_sheet(formattedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Programados");
    
    const localId = getCurrentLocalId();
    const fileName = generatePriceExportFilename(localId, 'precios');
    
    XLSX.writeFile(wb, fileName);
    
    toast({
      title: "Exportación Exitosa",
      description: "Los precios programados se han exportado a .xlsx correctamente.",
      className: "bg-green-50 text-green-800 border-green-200"
    });
  };

  const handleSchedule = async () => {
    if (!scheduleDate) {
      toast({ title: "Atención", description: "Seleccione una fecha y hora para la programación.", variant: "destructive" });
      return;
    }
    
    const changes = Object.keys(edits)
      .map(id => {
        const article = mappedArticles.find(a => a.id === id);
        return { ...article, precio_nuevo: edits[id], departamento: article.mappedDeptName };
      });
      
    if (changes.length === 0) return;

    for (const change of changes) {
      const validation = validatePriceData(change.precio_nuevo, change.codigo, change.mappedDeptName);
      if (!validation.isValid) {
        toast({
          title: "Error de Validación",
          description: `Artículo ${change.codigo}: ${validation.errors[0]}`,
          variant: "destructive"
        });
        return;
      }
    }

    const summary = formatPriceChangeSummary(changes);
    const dateFormatted = new Date(scheduleDate).toLocaleString();

    if(window.confirm(`Programación para: ${dateFormatted}\n\n${summary}\n\n¿Guardar cambios programados?`)) {
      try {
        await onSchedule({ date: scheduleDate, changes });
        toast({
          title: "¡Programado!",
          description: `Se programó la actualización de ${changes.length} artículos para el ${dateFormatted}.`,
          className: "bg-green-50 border-green-200 text-green-800"
        });
        setEdits({});
        setScheduleDate('');
      } catch (error) {
        toast({
          title: "Error al programar",
          description: error.message,
          variant: "destructive"
        });
      }
    }
  };

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          Programar Nueva Actualización
        </h3>
        
        <div className="flex gap-4 items-center flex-wrap bg-muted/30 p-4 rounded-lg border border-dashed">
          <div>
            <label className="text-sm block mb-1 font-medium">Fecha y hora de ejecución</label>
            <Input 
              type="datetime-local" 
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
          </div>
          <div className="flex-1"></div>
          {hasEdits && (
            <Button onClick={handleSchedule} disabled={loading || !scheduleDate} size="lg" className="bg-primary text-primary-foreground">
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          )}
        </div>

        <div className="flex gap-4 items-center">
          <Input 
            placeholder="Buscar por código o nombre..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todos los departamentos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los departamentos</SelectItem>
              {departments.map(dept => (
                <SelectItem key={dept} value={dept}>{dept}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border rounded-md max-h-64 overflow-y-auto bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Artículo</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Precio Actual</TableHead>
                <TableHead>Nuevo Precio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredArticles.slice(0, 100).map(article => {
                const isMissingDept = !article.mappedDeptName || article.mappedDeptName === '-';
                const currentEdit = edits[article.id];
                const isEdited = currentEdit !== undefined;

                return (
                  <TableRow key={article.id} className={isEdited ? "bg-muted/50" : ""}>
                    <TableCell className="font-medium">{article.codigo}</TableCell>
                    <TableCell>
                      {article.nombre}
                      {isMissingDept && (
                        <span className="flex items-center text-xs text-amber-600 mt-1">
                          <AlertCircle className="w-3 h-3 mr-1" /> Sin dpto.
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{article.mappedDeptName}</TableCell>
                    <TableCell>${article.valor || 0}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={currentEdit !== undefined ? currentEdit : ''}
                        onChange={(e) => handlePriceChange(article.id, e.target.value)}
                        placeholder={article.valor}
                        className={`w-32 ${isEdited ? "border-primary" : ""}`}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
              {filteredArticles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No se encontraron artículos.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Actualizaciones Pendientes</h3>
          {scheduledUpdates.length > 0 && (
            <Button onClick={handleExportScheduled} variant="outline" size="sm" className="text-green-700 border-green-200 hover:bg-green-50">
              <Download className="w-4 h-4 mr-2" /> Exportar (.xlsx)
            </Button>
          )}
        </div>
        <div className="border rounded-md bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha Programada</TableHead>
                <TableHead>Artículos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scheduledUpdates.map(update => (
                <TableRow key={update.id}>
                  <TableCell className="font-medium">{new Date(update.date).toLocaleString()}</TableCell>
                  <TableCell>{update.changes?.length || 0} artículos</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                      {update.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => onCancel(update.id)} title="Cancelar programación">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {scheduledUpdates.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No hay tareas programadas</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}