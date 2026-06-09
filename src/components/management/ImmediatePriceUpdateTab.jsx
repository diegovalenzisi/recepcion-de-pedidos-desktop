import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { validatePriceData, formatPriceChangeSummary, fetchAndMapDepartmentNames, getDepartmentName } from '@/lib/api/priceUpdateUtils';
import { AlertCircle, Save, Download, Upload, X, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { generatePriceExportFilename, formatPriceDataForExport } from '@/lib/export/priceExportUtils';
import { getCurrentLocalId } from '@/lib/firebase/core';
import ErrorPreviewModal from '@/components/management/ErrorPreviewModal';

export default function ImmediatePriceUpdateTab({ articles, onUpdate, loading }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [edits, setEdits] = useState({});
  const [departmentMap, setDepartmentMap] = useState({});
  
  // Import States
  const [importPreviewData, setImportPreviewData] = useState(null);
  const [importErrors, setImportErrors] = useState([]);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const fileInputRef = useRef(null);

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

  const handleExport = () => {
    if (filteredArticles.length === 0) return;

    const rawExportData = filteredArticles.map(a => ({
       codigo: a.codigo,
       nombre: a.nombre,
       departamento: a.mappedDeptName,
       nuevo_precio: edits[a.id] !== undefined ? edits[a.id] : a.valor
    }));

    const formattedData = formatPriceDataForExport(rawExportData);

    const ws = XLSX.utils.json_to_sheet(formattedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Actualización");
    
    const localId = getCurrentLocalId();
    const fileName = generatePriceExportFilename(localId, 'precios');
    
    XLSX.writeFile(wb, fileName);
    
    toast({
      title: "Exportación Exitosa",
      description: "Los datos se han exportado a .xlsx correctamente.",
      className: "bg-green-50 text-green-800 border-green-200"
    });
  };

  const normalizeRow = (row) => {
    const norm = {};
    Object.keys(row).forEach(k => {
      norm[k.toLowerCase().trim().replace(/\s+/g, '_')] = row[k];
    });
    return norm;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const bstr = event.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        processImportData(data);
      } catch (err) {
        toast({ title: "Error al leer archivo", description: "Formato inválido o archivo corrupto.", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = null; // Reset input
  };

  const processImportData = (data) => {
    const errors = [];
    const validatedRows = [];
    const seenCodes = new Set();
    const validDepts = new Set(Object.values(departmentMap).map(d => String(d).toLowerCase().trim()));

    data.forEach((rawRow, index) => {
      const row = normalizeRow(rawRow);
      const rowNum = index + 2; // Assuming header is row 1
      const rowErrors = [];

      const codigo = String(row.codigo || '').trim();
      const nombre = String(row.nombre || '').trim();
      const departamento = String(row.departamento || '').trim();
      const nuevo_precio = row.nuevo_precio !== undefined ? row.nuevo_precio : row.precio_nuevo;

      // 1. Missing required columns / empty fields
      if (!codigo) rowErrors.push({ column: 'codigo', value: codigo, msg: 'Código vacío o columna faltante' });
      if (!nombre) rowErrors.push({ column: 'nombre', value: nombre, msg: 'Nombre vacío o columna faltante' });
      if (!departamento) rowErrors.push({ column: 'departamento', value: departamento, msg: 'Departamento vacío o columna faltante' });
      if (nuevo_precio === undefined || nuevo_precio === '') rowErrors.push({ column: 'nuevo_precio', value: nuevo_precio, msg: 'Precio vacío o columna faltante' });

      // 2. Invalid data types / negative prices
      const priceNum = Number(nuevo_precio);
      if (nuevo_precio !== undefined && nuevo_precio !== '' && (isNaN(priceNum) || priceNum < 0)) {
        rowErrors.push({ column: 'nuevo_precio', value: nuevo_precio, msg: 'Precio debe ser 0 o positivo' });
      }

      // 3. Duplicate codes within the file
      if (codigo && seenCodes.has(codigo)) {
        rowErrors.push({ column: 'codigo', value: codigo, msg: 'Código duplicado en este mismo archivo' });
      } else if (codigo) {
        seenCodes.add(codigo);
      }

      // 4. Non-existent departments in Firebase
      if (departamento && !validDepts.has(departamento.toLowerCase()) && departamento !== 'Sin Departamento') {
        rowErrors.push({ column: 'departamento', value: departamento, msg: `Fila ${rowNum}: Departamento '${departamento}' no existe en Firebase` });
      }

      // 5. Existing article check
      const existingArticle = mappedArticles.find(a => String(a.codigo) === codigo);
      if (codigo && !existingArticle && rowErrors.filter(e => e.column === 'codigo').length === 0) {
        rowErrors.push({ column: 'codigo', value: codigo, msg: 'El artículo no existe en la base de datos' });
      }

      if (rowErrors.length > 0) {
        rowErrors.forEach(err => {
          errors.push({
            rowNumber: rowNum,
            column: err.column,
            value: err.value,
            errorMessage: err.msg
          });
        });
      }

      validatedRows.push({
        rowNumber: rowNum,
        codigo,
        nombre,
        departamento,
        nuevo_precio: isNaN(priceNum) ? nuevo_precio : priceNum,
        isValid: rowErrors.length === 0,
        errors: rowErrors,
        articleId: existingArticle ? existingArticle.id : null,
        precio_anterior: existingArticle ? existingArticle.valor : 0
      });
    });

    setImportPreviewData(validatedRows);
    setImportErrors(errors);
    
    if (errors.length > 0) {
      setShowErrorModal(true);
    } else {
      toast({
        title: "Archivo validado",
        description: `Se detectaron ${validatedRows.length} artículos listos para procesar.`,
        className: "bg-green-50 border-green-200 text-green-800"
      });
    }
  };

  const handleCloseModalCorregir = () => {
    setShowErrorModal(false);
    setImportPreviewData(null);
    setImportErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  const handleCancelImport = () => {
    setShowErrorModal(false);
    setImportPreviewData(null);
    setImportErrors([]);
  };

  const handleImportValidOnly = () => {
    setImportPreviewData(prev => prev.filter(r => r.isValid));
    setShowErrorModal(false);
    toast({
      title: "Filas filtradas",
      description: "Se han removido las filas con errores. Revise la vista previa y guarde.",
    });
  };

  const handleSaveImported = async () => {
    if (!importPreviewData) return;
    
    const validRows = importPreviewData.filter(r => r.isValid);
    if (validRows.length === 0) return;

    const changes = validRows.map(row => {
      const article = mappedArticles.find(a => a.id === row.articleId);
      return { 
        ...article, 
        precio_nuevo: row.nuevo_precio, 
        departamento: row.departamento 
      };
    });

    const summary = formatPriceChangeSummary(changes);
    
    if (window.confirm(`${summary}\n\n¿Desea guardar estos cambios importados inmediatamente?`)) {
      try {
        await onUpdate(changes);
        toast({
          title: "¡Importación Exitosa!",
          description: `Se actualizaron los precios de ${changes.length} artículos correctamente.`,
          className: "bg-green-50 border-green-200 text-green-800"
        });
        setImportPreviewData(null);
        setImportErrors([]);
      } catch (error) {
        toast({
          title: "Error al guardar importación",
          description: error.message,
          variant: "destructive"
        });
      }
    }
  };

  const handleSaveManualEdits = async () => {
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
    
    if (window.confirm(`${summary}\n\n¿Desea guardar estos cambios inmediatamente?`)) {
      try {
        await onUpdate(changes);
        toast({
          title: "¡Éxito!",
          description: `Se actualizaron los precios de ${changes.length} artículos correctamente.`,
          className: "bg-green-50 border-green-200 text-green-800"
        });
        setEdits({});
      } catch (error) {
        toast({
          title: "Error al guardar",
          description: error.message,
          variant: "destructive"
        });
      }
    }
  };

  const hasEdits = Object.keys(edits).length > 0;
  const validImportCount = importPreviewData ? importPreviewData.filter(r => r.isValid).length : 0;

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex gap-4 items-center flex-wrap">
        {!importPreviewData && (
          <>
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
          </>
        )}
        
        <div className="flex-1" />
        
        {!importPreviewData && (
          <>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".csv, .xlsx, .xls" 
              onChange={handleFileUpload} 
            />
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="text-blue-700 border-blue-200 hover:bg-blue-50">
              <Upload className="w-4 h-4 mr-2" />
              Importar (.xlsx)
            </Button>
            
            <Button onClick={handleExport} variant="outline" className="text-green-700 border-green-200 hover:bg-green-50">
              <Download className="w-4 h-4 mr-2" />
              Exportar (.xlsx)
            </Button>
            
            {hasEdits && (
              <Button onClick={handleSaveManualEdits} disabled={loading} className="bg-primary text-primary-foreground shadow-sm">
                <Save className="w-4 h-4 mr-2" />
                {loading ? 'Guardando...' : 'Guardar Cambios'}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Main Content Area */}
      {importPreviewData ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex justify-between items-center bg-blue-50/80 p-4 rounded-lg border border-blue-200 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-full">
                <Upload className="w-5 h-5 text-blue-700" />
              </div>
              <div>
                <h3 className="font-bold text-blue-900">Modo Vista Previa de Importación</h3>
                <p className="text-sm text-blue-700 font-medium">Revisa los datos antes de guardarlos permanentemente.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancelImport} className="border-blue-300 text-blue-800 hover:bg-blue-100">
                <X className="w-4 h-4 mr-2" /> Cancelar
              </Button>
              <Button 
                onClick={handleSaveImported} 
                disabled={loading || validImportCount === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              >
                <Save className="w-4 h-4 mr-2" />
                Guardar {validImportCount} Cambios
              </Button>
            </div>
          </div>

          <div className="border rounded-md max-h-[60vh] overflow-auto bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-20 font-semibold text-center">Fila</TableHead>
                  <TableHead className="font-semibold">Código</TableHead>
                  <TableHead className="font-semibold">Artículo</TableHead>
                  <TableHead className="font-semibold">Departamento</TableHead>
                  <TableHead className="font-semibold">Precio Actual</TableHead>
                  <TableHead className="font-semibold">Nuevo Precio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importPreviewData.map((row, i) => (
                  <TableRow 
                    key={i} 
                    className={row.isValid ? 'hover:bg-muted/30 transition-colors' : 'bg-destructive/5 border-y border-destructive/20'}
                  >
                    <TableCell className="text-center font-medium">
                      <div className="flex items-center justify-center gap-2">
                        <span className={row.isValid ? "text-muted-foreground" : "text-destructive font-bold"}>
                          {row.rowNumber}
                        </span>
                        {!row.isValid && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help p-1 hover:bg-destructive/10 rounded-full transition-colors">
                                  <AlertCircle className="w-4 h-4 text-destructive" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="bg-destructive text-destructive-foreground font-medium border-none shadow-md">
                                <ul className="list-disc pl-4 text-sm space-y-1">
                                  {row.errors.map((e, idx) => <li key={idx}>{e.msg}</li>)}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {row.isValid && (
                          <CheckCircle2 className="w-4 h-4 text-green-500 opacity-70" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={row.errors.some(e=>e.column==='codigo') ? 'text-destructive font-bold' : 'font-medium'}>
                      {row.codigo || '-'}
                    </TableCell>
                    <TableCell className={row.errors.some(e=>e.column==='nombre') ? 'text-destructive font-bold' : ''}>
                      {row.nombre || '-'}
                    </TableCell>
                    <TableCell className={row.errors.some(e=>e.column==='departamento') ? 'text-destructive font-bold' : ''}>
                      {row.departamento || '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      ${row.precio_anterior}
                    </TableCell>
                    <TableCell className={row.errors.some(e=>e.column==='nuevo_precio') ? 'text-destructive font-bold' : 'text-green-600 font-bold'}>
                      ${row.nuevo_precio !== undefined ? row.nuevo_precio : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="border rounded-md max-h-[60vh] overflow-auto bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Código</TableHead>
                <TableHead className="font-semibold">Artículo</TableHead>
                <TableHead className="font-semibold">Departamento</TableHead>
                <TableHead className="font-semibold">Precio Actual</TableHead>
                <TableHead className="font-semibold">Nuevo Precio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredArticles.map(article => {
                const isMissingDept = !article.mappedDeptName || article.mappedDeptName === '-';
                const currentEdit = edits[article.id];
                const isEdited = currentEdit !== undefined;
                
                return (
                  <TableRow key={article.id} className={isEdited ? "bg-primary/5 transition-colors" : "hover:bg-muted/30 transition-colors"}>
                    <TableCell className="font-medium text-foreground">{article.codigo}</TableCell>
                    <TableCell>
                      {article.nombre}
                      {isMissingDept && (
                        <span className="flex items-center text-xs text-amber-600 mt-1 font-medium bg-amber-50 w-fit px-1.5 py-0.5 rounded">
                          <AlertCircle className="w-3 h-3 mr-1" /> Sin dpto. asignado
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{article.mappedDeptName}</TableCell>
                    <TableCell className="text-muted-foreground font-medium">${article.valor || 0}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={currentEdit !== undefined ? currentEdit : ''}
                        onChange={(e) => handlePriceChange(article.id, e.target.value)}
                        placeholder={article.valor}
                        className={`w-32 transition-all ${isEdited ? "border-primary ring-1 ring-primary/20 bg-background" : "bg-muted/30"}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredArticles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground font-medium">
                    No se encontraron artículos con esos filtros.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Error Modal */}
      <ErrorPreviewModal 
        isOpen={showErrorModal}
        errors={importErrors}
        validCount={validImportCount}
        onClose={handleCloseModalCorregir}
        onCancel={handleCancelImport}
        onImportValid={handleImportValidOnly}
      />
    </div>
  );
}