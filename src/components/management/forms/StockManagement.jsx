
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusCircle, Trash2, Info, CheckCircle2, XCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';

const StockManagement = ({ stock, onStockChange, allArticles, allRawMaterials, allDepartments, formData, isPromo }) => {
  const getInitialStockType = () => {
    if (stock && stock.stockType) return stock.stockType;
    if (stock && stock.receta !== null && typeof stock.receta === 'object') {
      return 'receta';
    }
    if (stock && stock.heredadoDe !== null && typeof stock.heredadoDe === 'string' && stock.heredadoDe.length > 0) {
      return 'heredado';
    }
    return 'propio';
  };

  const [stockType, setStockType] = useState(getInitialStockType);

  useEffect(() => {
    setStockType(getInitialStockType());
  }, [stock]);

  const handleTypeChange = (newType) => {
    setStockType(newType);
    let newStockData = {};
    if (newType === 'propio') {
      newStockData = { propio: 0, heredadoDe: null, receta: null, stockType: 'propio' };
    } else if (newType === 'heredado') {
      newStockData = { heredadoDe: '', propio: null, receta: null, stockType: 'heredado' };
    } else if (newType === 'receta') {
      newStockData = { receta: {}, propio: null, heredadoDe: null, stockType: 'receta' };
    }
    onStockChange(newStockData);
  };

  const handleStockValueChange = (field, value) => {
    let newStockData = { ...stock, stockType };
    if (stockType === 'propio') {
      newStockData = { ...newStockData, propio: parseFloat(value) || 0 };
    } else if (stockType === 'heredado') {
      newStockData = { ...newStockData, heredadoDe: value };
      
      const parentArticle = allArticles?.find(a => a.id === value || a.codigo === value);
      if (parentArticle) {
        newStockData.parentCostoTotalReceta = parentArticle.costoTotalReceta || 0;
      }
    }
    onStockChange(newStockData);
  };

  const handleRecetaChange = (index, field, value) => {
    const currentRecetaArray = Object.entries(stock.receta || {});
    const newStockData = { ...stock, stockType: 'receta' };
    
    if (field === 'codigo') {
      const oldCodigo = currentRecetaArray[index][0];
      const cantidad = currentRecetaArray[index][1];
      const newReceta = {};
      currentRecetaArray.forEach(([key, val], i) => {
        if (i === index) {
          newReceta[value] = cantidad;
        } else if (key !== oldCodigo) {
          newReceta[key] = val;
        }
      });
      newStockData.receta = newReceta;
      onStockChange(newStockData);
    } else { 
      const codigo = currentRecetaArray[index][0];
      newStockData.receta = {
        ...newStockData.receta,
        [codigo]: parseFloat(value) || 0,
      };
      onStockChange(newStockData);
    }
  };

  const addRecetaItem = () => {
    const newKey = `new_${Date.now()}`;
    const newStockData = {
      ...stock,
      stockType: 'receta',
      receta: {
        ...(stock.receta || {}),
        [newKey]: 0,
      },
    };
    onStockChange(newStockData);
  };

  const removeRecetaItem = (codigo) => {
    const newReceta = { ...(stock.receta || {}) };
    delete newReceta[codigo];
    const newStockData = { ...stock, receta: newReceta, stockType: 'receta' };
    onStockChange(newStockData);
  };

  const recetaItems = Object.entries(stock?.receta || {});

  const sortedArticles = (allArticles || []).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const calculateTotalRecipeCost = () => {
    if (!stock?.receta) return 0;
    const total = Object.entries(stock.receta).reduce((sum, [codigo, qty]) => {
      const mp = allRawMaterials?.find(m => m.id === codigo || m.codigo === codigo);
      const unitCost = Math.round(Number(mp?.costoUnitario || 0) * 1000) / 1000;
      const lineTotal = Math.round((unitCost * (parseFloat(qty) || 0)) * 1000) / 1000;
      return sum + lineTotal;
    }, 0);
    return Math.round(total * 1000) / 1000;
  };

  const showAutomationStatus = stockType === 'propio';
  const hadDeliveryEnabled = formData?.hadDeliveryEnabled === true;
  const currentStock = stock?.propio || 0;
  const isStockDepleted = currentStock === 0;
  const descuentaPorArticulo = stock?.descuentaPorArticulo === true;

  const handleDescuentaPorArticuloChange = (checked) => {
    onStockChange({ ...(stock || {}), descuentaPorArticulo: checked });
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 mt-4">
      <Label className="block text-sm font-bold text-gray-800 mb-2">Gestión de Stock</Label>

      {isPromo && (
        <div className="flex items-center justify-between gap-3 p-3 mb-3 bg-white border border-gray-200 rounded-lg">
          <div>
            <Label htmlFor="descuentaPorArticulo" className="font-medium">Descuenta stock según artículo</Label>
            <p className="text-xs text-gray-500 mt-1">
              Si está activado, la promoción no usa stock propio: al venderse, se descuenta el stock real
              de cada artículo que la compone (incluyendo grupos a elección, stock heredado y recetas), y la
              promoción solo estará disponible si esos artículos tienen stock.
            </p>
          </div>
          <Switch id="descuentaPorArticulo" checked={descuentaPorArticulo} onCheckedChange={handleDescuentaPorArticuloChange} />
        </div>
      )}

      {!descuentaPorArticulo && (
      <>
      <Select onValueChange={handleTypeChange} value={stockType}>
        <SelectTrigger>
          <SelectValue placeholder="Seleccione tipo de stock" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="propio">Stock Propio</SelectItem>
          <SelectItem value="heredado">Heredar Stock de otro Artículo</SelectItem>
          <SelectItem value="receta">Stock por Receta</SelectItem>
        </SelectContent>
      </Select>

      {showAutomationStatus && (
        <Alert className={`mt-3 ${hadDeliveryEnabled ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'}`}>
          <Info className={`h-4 w-4 ${hadDeliveryEnabled ? 'text-yellow-600' : 'text-blue-600'}`} />
          <AlertDescription className={hadDeliveryEnabled ? 'text-yellow-800' : 'text-blue-800'}>
            <div className="flex items-center justify-between">
              <div>
                <strong>Automatización de Delivery:</strong>
                <div className="text-sm mt-1">
                  {hadDeliveryEnabled ? (
                    <span className="flex items-center gap-1">
                      <XCircle className="w-3 h-3" />
                      Delivery deshabilitado automáticamente (stock agotado)
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Se habilitará automáticamente al reponer stock
                    </span>
                  )}
                </div>
              </div>
              <Badge variant={hadDeliveryEnabled ? 'destructive' : 'secondary'}>
                {hadDeliveryEnabled ? 'Inactivo' : 'Normal'}
              </Badge>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={stockType}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.2 }}
          className="mt-3"
        >
          {stockType === 'propio' && (
            <div>
              <Label className="block text-sm font-medium text-gray-700 mb-1">Cantidad de Stock</Label>
              <Input
                type="number"
                placeholder="0"
                value={stock?.propio !== undefined ? stock.propio : ''}
                onChange={(e) => handleStockValueChange('propio', e.target.value)}
              />
              {isStockDepleted && (
                <p className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Stock en 0 - el delivery se deshabilitará automáticamente al guardar
                </p>
              )}
            </div>
          )}
          {stockType === 'heredado' && (
            <div>
              <Label className="block text-sm font-medium text-gray-700 mb-1">Artículo de Origen</Label>
              <Select
                onValueChange={(value) => handleStockValueChange('heredadoDe', value)}
                value={stock?.heredadoDe || ''}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un artículo..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="h-72">
                    {sortedArticles.map(a => {
                      const department = (allDepartments || []).find(d => d.id === a.departamento);
                      const departmentName = department ? department.nombre : 'Sin Depto.';
                      return (
                        <SelectItem key={a.id} value={a.id}>
                          <span>{a.nombre} - <span className="text-gray-500">{departmentName}</span></span>
                        </SelectItem>
                      );
                    })}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>
          )}
          {stockType === 'receta' && (
            <div className="space-y-4">
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-2">Composición y Costos de la Receta</Label>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-100 text-gray-700 border-b border-gray-200">
                        <tr>
                          <th className="p-3 font-semibold">Materia Prima</th>
                          <th className="p-3 w-28 text-right font-semibold">Costo Unit.</th>
                          <th className="p-3 w-32 font-semibold">Cantidad</th>
                          <th className="p-3 w-28 text-right font-semibold">Total Línea</th>
                          <th className="p-3 w-12 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {recetaItems.length === 0 && (
                          <tr>
                            <td colSpan="5" className="p-6 text-center text-gray-400">
                              No hay ingredientes en la receta.
                            </td>
                          </tr>
                        )}
                        {recetaItems.map(([codigo, cantidad], index) => {
                          const mp = allRawMaterials?.find(m => m.id === codigo || m.codigo === codigo);
                          const unitCost = Math.round(Number(mp?.costoUnitario || 0) * 1000) / 1000;
                          const unit = mp?.unidadMedida || mp?.unidad || 'u.';
                          const isNew = codigo.startsWith('new_');
                          const lineTotal = Math.round((unitCost * (parseFloat(cantidad) || 0)) * 1000) / 1000;

                          return (
                            <tr key={codigo} className="hover:bg-gray-50">
                              <td className="p-2">
                                <Select value={isNew ? '' : codigo} onValueChange={(val) => handleRecetaChange(index, 'codigo', val)}>
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Seleccionar ingrediente..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <ScrollArea className="h-64">
                                      {allRawMaterials?.map(m => (
                                        <SelectItem key={m.id} value={m.id}>{m.nombre}</SelectItem>
                                      ))}
                                    </ScrollArea>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2 text-right text-gray-500 font-mono text-sm">
                                ${unitCost.toFixed(3)}
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-1">
                                  <Input 
                                    type="number" 
                                    min="0"
                                    step="0.01"
                                    value={cantidad} 
                                    onChange={e => handleRecetaChange(index, 'cantidad', e.target.value)} 
                                    className="h-9 text-right font-mono" 
                                  />
                                  <span className="text-xs text-gray-500 w-6">{unit}</span>
                                </div>
                              </td>
                              <td className="p-2 text-right font-mono font-medium text-gray-700">
                                ${lineTotal.toFixed(3)}
                              </td>
                              <td className="p-2 text-center">
                                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => removeRecetaItem(codigo)}>
                                  <Trash2 className="h-4 w-4"/>
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-3">
                  <Button type="button" onClick={addRecetaItem} className="flex items-center text-sm font-medium" variant="outline" size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" /> Agregar Ingrediente
                  </Button>
                  
                  <div className="bg-primary/10 px-4 py-2 rounded-lg border border-primary/20 flex items-center gap-3">
                    <span className="text-sm font-medium text-primary">Costo Total Receta:</span>
                    <span className="text-lg font-bold text-primary">${calculateTotalRecipeCost().toFixed(3)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      </>
      )}
    </div>
  );
};

export default StockManagement;
