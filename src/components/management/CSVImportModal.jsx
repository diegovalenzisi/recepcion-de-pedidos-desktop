import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, FileUp, Save, XCircle } from 'lucide-react';
import { formatPriceChangeSummary, fetchAndMapDepartmentNames } from '@/lib/api/priceUpdateUtils';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';

export default function CSVImportModal({ articles, onImport, loading }) {
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState([]);
  const [globalErrors, setGlobalErrors] = useState([]);
  const [departmentMap, setDepartmentMap] = useState({});
  const { toast } = useToast();

  const EXPECTED_COLUMNS = ['codigo', 'nombre', 'departamento', 'precio_nuevo'];

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const map = await fetchAndMapDepartmentNames();
        setDepartmentMap(map);
      } catch (error) {
        console.error("Error al cargar departamentos:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron cargar los departamentos para validación."
        });
      }
    };
    loadDepartments();
  }, [toast]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    resetState();
    
    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
        toast({
          variant: "destructive",
          title: "Archivo Inválido",
          description: "Por favor, selecciona un archivo .xlsx válido"
        });
        setGlobalErrors(['Por favor, selecciona un archivo .xlsx válido']);
        return;
      }
      parseAndValidateXLSX(selectedFile);
    }
  };

  const resetState = () => {
    setPreviewData([]);
    setGlobalErrors([]);
  }

  const cancelImport = () => {
    setFile(null);
    resetState();
  }

  const parseAndValidateXLSX = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to array of arrays
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        // Filter out completely empty rows
        const rows = rawData.filter(row => row.some(cell => String(cell).trim() !== ''));
        
        if (rows.length < 2) {
          setGlobalErrors(['El archivo .xlsx está vacío o no tiene datos válidos.']);
          return;
        }

        // Normalize rows to strings and filter empty header cells
        const normalizedRows = rows.map(row => row.map(cell => String(cell).trim()));
        const headers = normalizedRows[0].map(h => h.toLowerCase()).filter(Boolean);

        // Strict 4 column validation
        if (headers.length !== 4) {
          setGlobalErrors([`El archivo debe tener exactamente 4 columnas. Se encontraron ${headers.length}.`]);
          return;
        }

        const missingColumns = EXPECTED_COLUMNS.filter(col => !headers.includes(col));
        if (missingColumns.length > 0) {
          setGlobalErrors([`Faltan las siguientes columnas o el nombre es incorrecto: ${missingColumns.join(', ')}`]);
          return;
        }

        const colIndexes = {
          codigo: headers.indexOf('codigo'),
          nombre: headers.indexOf('nombre'),
          departamento: headers.indexOf('departamento'),
          precio_nuevo: headers.indexOf('precio_nuevo')
        };

        const parsed = [];
        const validDeptNamesToLower = Object.values(departmentMap).map(n => n.toLowerCase());

        normalizedRows.slice(1).forEach((row, index) => {
          // If the row doesn't have at least the required cells, fill with empty to validate properly
          const itemCodigo = row[colIndexes.codigo] || '';
          const itemNombre = row[colIndexes.nombre] || '';
          const itemDeptNameRaw = row[colIndexes.departamento] || '';
          const itemPrecioNuevo = row[colIndexes.precio_nuevo] || '';

          const rowErrors = [];

          if (!itemCodigo) rowErrors.push('El código no puede estar vacío');
          if (!itemNombre) rowErrors.push('El nombre no puede estar vacío');
          
          let correctDeptName = itemDeptNameRaw;
          if (!itemDeptNameRaw) {
            rowErrors.push('El departamento no puede estar vacío');
          } else if (!validDeptNamesToLower.includes(itemDeptNameRaw.toLowerCase())) {
            rowErrors.push(`El departamento '${itemDeptNameRaw}' no existe en Firebase`);
          } else {
            correctDeptName = Object.values(departmentMap).find(n => n.toLowerCase() === itemDeptNameRaw.toLowerCase());
          }

          const priceNum = Number(itemPrecioNuevo);
          if (itemPrecioNuevo === '' || itemPrecioNuevo === undefined || isNaN(priceNum) || priceNum < 0) {
            rowErrors.push('Precio debe ser 0 o positivo');
          }

          const articleMatch = articles.find(a => String(a.codigo) === String(itemCodigo));
          if (!articleMatch && itemCodigo) {
            rowErrors.push('El código no existe en la base de datos de artículos');
          }

          parsed.push({
            rowNum: index + 2,
            id: articleMatch?.id,
            codigo: itemCodigo,
            nombre: itemNombre,
            departamento: correctDeptName,
            precio_nuevo: priceNum || itemPrecioNuevo,
            valor: articleMatch?.valor || 0,
            errors: rowErrors
          });
        });

        setPreviewData(parsed);

      } catch (err) {
        setGlobalErrors(['Error al leer el archivo. Por favor, asegúrate de que sea un archivo Excel válido (.xlsx).']);
        console.error("XLSX Parse Error:", err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    const errorCount = previewData.filter(r => r.errors.length > 0).length;
    if (errorCount > 0) return;

    if (previewData.length > 0) {
      const validData = previewData.map(({ rowNum, errors, ...data }) => data);
      const summary = formatPriceChangeSummary(validData);
      
      if (!window.confirm(`${summary}\n\n¿Confirma que desea guardar estos cambios?`)) return;
      
      try {
        await onImport(validData);
        toast({
          title: "Importación Exitosa",
          description: `${validData.length} precios actualizados exitosamente.`,
          className: "bg-green-50 border-green-200 text-green-800"
        });
        cancelImport();
      } catch (error) {
         toast({
          title: "Error en la importación",
          description: error.message,
          variant: "destructive"
        });
      }
    }
  };

  const errorCount = previewData.filter(r => r.errors.length > 0).length;
  const isValidToImport = previewData.length > 0 && errorCount === 0 && globalErrors.length === 0;

  return (
    <div className="space-y-4">
      {!previewData.length && globalErrors.length === 0 && (
        <div className="p-6 border border-dashed rounded-lg bg-muted/30 text-center space-y-4">
          <FileUp className="w-12 h-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-medium">Importar Precios desde Excel (.xlsx)</h3>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>El archivo debe tener <strong>EXACTAMENTE 4 columnas</strong>:</p>
            <p className="font-mono bg-muted inline-block px-2 py-1 rounded">codigo, nombre, departamento, precio_nuevo</p>
          </div>
          <div className="max-w-md mx-auto">
            <Input 
              type="file" 
              accept=".xlsx" 
              onChange={handleFileChange} 
              className="mb-4"
            />
          </div>
        </div>
      )}

      {globalErrors.length > 0 && (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Errores de Estructura Excel</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5 mt-2 text-sm">
                {globalErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
          <Button onClick={cancelImport} variant="outline" className="w-full">
            Seleccionar otro archivo
          </Button>
        </div>
      )}

      {previewData.length > 0 && globalErrors.length === 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
          {errorCount === 0 ? (
            <div className="flex justify-between items-center bg-green-50 text-green-800 p-3 rounded-md border border-green-200">
               <h4 className="font-medium flex items-center">
                 <Save className="w-5 h-5 mr-2" />
                 ✓ Validación exitosa. {previewData.length} artículos listos para importar.
               </h4>
               <span className="text-sm opacity-80">Revisa la tabla antes de guardar.</span>
            </div>
          ) : (
            <div className="flex justify-between items-center bg-red-50 text-red-800 p-3 rounded-md border border-red-200">
               <h4 className="font-medium flex items-center">
                 <AlertCircle className="w-5 h-5 mr-2" />
                 Se encontraron {errorCount} filas con errores.
               </h4>
               <span className="text-sm opacity-80">Corrige el archivo y vuelve a subirlo.</span>
            </div>
          )}
          
          <div className="border rounded-md max-h-[60vh] overflow-y-auto bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Fila</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Precio Anterior</TableHead>
                  <TableHead>Precio Nuevo</TableHead>
                  <TableHead>Estado / Errores</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.map((item, idx) => (
                  <TableRow key={idx} className={item.errors.length > 0 ? "bg-red-50/50" : ""}>
                    <TableCell className="text-muted-foreground">{item.rowNum}</TableCell>
                    <TableCell className="font-medium">{item.codigo}</TableCell>
                    <TableCell>{item.nombre}</TableCell>
                    <TableCell>{item.departamento}</TableCell>
                    <TableCell>${item.valor || 0}</TableCell>
                    <TableCell className="font-bold text-green-600">${item.precio_nuevo}</TableCell>
                    <TableCell>
                      {item.errors.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          {item.errors.map((e, i) => (
                            <span key={i} className="text-xs text-red-600 font-medium flex items-center">
                              • {e}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-green-600 font-medium">Válido</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex gap-4 pt-2">
            <Button onClick={cancelImport} variant="outline" className="flex-1" disabled={loading}>
              <XCircle className="w-4 h-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={handleImport} disabled={!isValidToImport || loading} className="flex-1 bg-primary text-primary-foreground">
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Guardando Historial...' : 'Guardar Cambios'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}