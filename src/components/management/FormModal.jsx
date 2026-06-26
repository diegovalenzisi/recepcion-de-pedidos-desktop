
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import ArticleFormFields from './forms/ArticleFormFields';
import RawMaterialFormFields from './forms/RawMaterialFormFields';
import OptionalFormFields from './forms/OptionalFormFields';
import DepartmentFormFields from './forms/DepartmentFormFields';
import TachoFormFields from './forms/TachoFormFields';
import ProductGroupFormFields from './forms/ProductGroupFormFields';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

const FormModal = ({ showForm, setShowForm, editingItem, activeTab, tabs, onSave, allData }) => {
  const [formData, setFormData] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();

  // [FIX] Usar ref para allData: evita que cambios en allData (updates de Firebase
  // en tiempo real para otros tabs) recreen loadInitialData y re-disparen el
  // useEffect, lo que estaba reseteando el formulario y borrando promoItems.
  const allDataRef = useRef(allData);
  useEffect(() => { allDataRef.current = allData; }, [allData]);

  const loadInitialData = useCallback(() => {
    const defaultData = { 
      nombre: '',
      activo: true,
      permiteVentaEfectivo: true,
      permiteVentaElectronica: true,
      activoDelivery: true,
      activoMostrador: true,
      ordenWeb: 0,
      ordenLocal: 0,
    };
  
    if (editingItem) {
      setIsEditing(!!editingItem.id);
      let initialData = { ...editingItem };
      
      if (!isEditing) {
        switch (activeTab) {
          case 'articulos':
            initialData.descripcion = initialData.descripcion || '';
            initialData.departamento = initialData.departamento || '';
            initialData.valor = initialData.valor || 0;
            initialData.costoTotalReceta = initialData.costoTotalReceta || 0;
            initialData.stockMinimo = initialData.stockMinimo || 0;
            initialData.opcionalesConfig = initialData.opcionalesConfig || {};
            initialData.stock = initialData.stock || { stockType: 'propio', propio: 0, receta: null, heredadoDe: null };
            initialData.foto = initialData.foto || '';
            initialData.isPromo = initialData.isPromo || false;
            initialData.promoItems = initialData.promoItems || [];
            initialData.destacado = initialData.destacado || false;
            initialData.controlStock = initialData.controlStock !== false;
            break;
          case 'materia-prima':
            initialData.stock = initialData.stock || 0;
            initialData.minimo = initialData.minimo || 0;
            initialData.unidadMedida = initialData.unidadMedida || initialData.unidad || 'unidad';
            initialData.precioBulto = initialData.precioBulto || 0;
            initialData.unidadesPorBulto = initialData.unidadesPorBulto || 1;
            initialData.costoUnitario = initialData.costoUnitario || 0;
            break;
          case 'tachos':
            initialData.stock = initialData.stock || 0;
            initialData.minimo = initialData.minimo || 0;
            break;
          case 'opcionales':
            initialData.grupo = initialData.grupo || '';
            initialData.precio = initialData.precio || 0;
            initialData.descripcion = initialData.descripcion || '';
            break;
          case 'grupos-productos':
            initialData.articulos = initialData.articulos || [];
            break;
          default:
            break;
        }
      } else {
         if (activeTab === 'articulos') {
            initialData.controlStock = initialData.controlStock !== false;
            if (initialData.stock?.stockType === 'heredado' && initialData.stock?.heredadoDe) {
               // [FIX] Usar allDataRef.current en lugar de allData (ref no causa re-renders)
               const parentArticle = allDataRef.current?.articulos?.find(a => a.id === initialData.stock.heredadoDe || a.codigo === initialData.stock.heredadoDe);
               if (parentArticle) {
                   initialData.costoTotalReceta = parentArticle.costoTotalReceta || 0;
               }
            }
         }
         if (activeTab === 'materia-prima') {
            initialData.unidadMedida = initialData.unidadMedida || initialData.unidad || 'unidad';
            initialData.precioBulto = initialData.precioBulto || 0;
            initialData.unidadesPorBulto = initialData.unidadesPorBulto || 1;
            initialData.costoUnitario = initialData.costoUnitario || 0;
         }
      }
      
      const finalData = { ...defaultData, ...initialData };

      if (activeTab === 'articulos') {
        if (finalData.activo === false) {
          finalData.activoDelivery = false;
          finalData.activoMostrador = false;
        }
      }

      // [DIAG] Log para ver qué promoItems llega de Firebase al abrir el formulario
      if (activeTab === 'articulos' && finalData.isPromo) {
        console.log('[PROMO DIAG] loadInitialData - promoItems leído de Firebase:', {
          isEditing: !!editingItem?.id,
          promoItems: finalData.promoItems,
          stock: finalData.stock,
        });
      }
      setFormData(finalData);
    }
  // [FIX] allData eliminado de las dependencias: sus cambios (updates de Firebase
  // en otros tabs) ya no recrean loadInitialData ni re-disparan el useEffect.
  // El valor siempre accesible via allDataRef.current (se sincroniza separado).
  }, [editingItem, activeTab, isEditing]);

  useEffect(() => {
    if (showForm) {
      loadInitialData();
    }
  }, [showForm, loadInitialData]);

  const handleFieldChange = (field, value) => {
    setFormData(prev => {
        const newState = { ...prev, [field]: value };
        
        if (activeTab === 'articulos' && field === 'activo') {
            if (value === false) {
                newState.previousActivoDelivery = prev.activoDelivery;
                newState.previousActivoMostrador = prev.activoMostrador;
                newState.activoDelivery = false;
                newState.activoMostrador = false;
            } else {
                if (prev.previousActivoDelivery !== undefined) {
                    newState.activoDelivery = prev.previousActivoDelivery;
                }
                if (prev.previousActivoMostrador !== undefined) {
                    newState.activoMostrador = prev.previousActivoMostrador;
                }
            }
        }

        if (activeTab === 'materia-prima') {
           if (field === 'precioBulto' || field === 'unidadesPorBulto') {
              const precio = field === 'precioBulto' ? Number(value) : Number(prev.precioBulto || 0);
              const unidades = field === 'unidadesPorBulto' ? Number(value) : Number(prev.unidadesPorBulto || 1);
              newState.costoUnitario = Math.round((unidades > 0 ? precio / unidades : 0) * 1000) / 1000;
           }
        }
        
        return newState;
    });
  };

  const handlePromoItemsChange = (items) => {
    setFormData(prev => ({ ...prev, promoItems: items }));
  };

  const handleStockChange = (stockData) => {
    setFormData(prev => {
      const newState = { ...prev, stock: stockData };
      if (stockData.stockType === 'heredado' && stockData.parentCostoTotalReceta !== undefined) {
        newState.costoTotalReceta = stockData.parentCostoTotalReceta;
      }
      return newState;
    });
  };

  const handleOpcionalesConfigChange = (config) => {
    setFormData(prev => ({ ...prev, opcionalesConfig: config }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const dataToSave = { ...formData };
    
    if (activeTab === 'articulos') {
      dataToSave.activoDelivery = Boolean(dataToSave.activoDelivery);
      dataToSave.activoMostrador = Boolean(dataToSave.activoMostrador);
      
      const effectiveStockType = dataToSave.stock?.stockType || (dataToSave.stock?.heredadoDe ? 'heredado' : (dataToSave.stock?.receta ? 'receta' : 'propio'));
      
      console.log('[FormModal] Submit - effectiveStockType:', effectiveStockType, 'receta object:', dataToSave.stock?.receta);

      if (effectiveStockType === 'receta' && dataToSave.stock?.receta) {
        let totalCost = 0;
        const composition = [];
        Object.entries(dataToSave.stock.receta).forEach(([mpId, qty]) => {
          const mp = allData['materia-prima']?.find(m => m.id === mpId || m.codigo === mpId);
          if (mp) {
            const unitCost = Math.round(Number(mp.costoUnitario || 0) * 1000) / 1000;
            const lineTotal = Math.round((unitCost * Number(qty)) * 1000) / 1000;
            totalCost = Math.round((totalCost + lineTotal) * 1000) / 1000;
            composition.push({
              rawMaterialId: mp.codigo || mp.id,
              rawMaterialName: mp.nombre,
              quantity: Number(qty),
              unit: mp.unidadMedida || mp.unidad || 'u.',
              unitCost: unitCost,
              totalCost: lineTotal
            });
          }
        });
        dataToSave.composition = composition;
        dataToSave.costoTotalReceta = Math.round(totalCost * 1000) / 1000;
        
        if (dataToSave.stock) {
           dataToSave.stock.stockType = 'receta';
        }
        console.log('[FormModal] Submit - calculated totalCost:', totalCost, 'composition:', composition);
      } else if (effectiveStockType === 'propio' || effectiveStockType === 'heredado') {
        dataToSave.composition = [];
        if (effectiveStockType === 'heredado') {
          const parentArticle = allData.articulos?.find(a => a.id === dataToSave.stock?.heredadoDe || a.codigo === dataToSave.stock?.heredadoDe);
          dataToSave.costoTotalReceta = Math.round(Number(parentArticle?.costoTotalReceta || formData.costoTotalReceta || 0) * 1000) / 1000;
        } else {
          dataToSave.costoTotalReceta = Math.round(Number(formData.costoTotalReceta || 0) * 1000) / 1000;
        }
      } else {
        dataToSave.composition = [];
        dataToSave.costoTotalReceta = 0;
      }
    }
    
    // [DIAG] Toast visible mostrando qué se enviará a guardar
    if (activeTab === 'articulos' && dataToSave.isPromo) {
      const grupos = (dataToSave.promoItems || []).filter(i => i.tipo === 'grupo');
      const fijos = (dataToSave.promoItems || []).filter(i => i.tipo !== 'grupo');
      toast({
        title: `[DIAG] Guardando promo: "${dataToSave.nombre}"`,
        description: `promoItems: ${(dataToSave.promoItems || []).length} total | ${grupos.length} grupo(s) | ${fijos.length} fijo(s) | descuentaPorArticulo=${dataToSave.stock?.descuentaPorArticulo}`,
      });
    }
    onSave(dataToSave);
  };

  const renderFormFields = () => {
    const commonProps = {
        formData: formData,
        handleChange: (e) => handleFieldChange(e.target.name, e.target.type === 'checkbox' ? e.target.checked : e.target.value)
    };
    switch (activeTab) {
      case 'articulos':
        return <ArticleFormFields 
                  formData={formData} 
                  onFieldChange={handleFieldChange}
                  onPromoItemsChange={handlePromoItemsChange}
                  onStockChange={handleStockChange}
                  onOpcionalesConfigChange={handleOpcionalesConfigChange}
                  allData={allData}
                />;
      case 'materia-prima':
        return <RawMaterialFormFields 
                  formData={formData} 
                  onFieldChange={handleFieldChange} 
                />;
      case 'grupos-opcionales':
        return <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                    <input name="nombre" type="text" className="input-field" value={formData.nombre || ''} onChange={(e) => handleFieldChange(e.target.name, e.target.value)} />
                  </div>
               </div>;
      case 'grupos-productos':
        return <ProductGroupFormFields
                  formData={formData}
                  onFieldChange={handleFieldChange}
                  allData={allData}
                />;
      case 'opcionales':
        return <OptionalFormFields {...commonProps} allData={allData} />;
      case 'departamentos':
        return <DepartmentFormFields {...commonProps} />;
      case 'tachos':
          return <TachoFormFields {...commonProps} />;
      default:
        return null;
    }
  };

  const showActivoSwitch = ['articulos', 'departamentos', 'opcionales'].includes(activeTab);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-xl p-8 w-full max-w-4xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-h-[90vh] overflow-y-auto pr-4">
          <h3 className="text-2xl font-bold mb-6 text-gray-800">
            {isEditing ? 'Editar' : 'Agregar'} {tabs.find(t => t.id === activeTab)?.label}
          </h3>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código</label>
              <input 
                name="codigo" 
                type="text" 
                className={`input-field ${isEditing ? 'bg-gray-100' : ''}`}
                value={formData.codigo || ''} 
                onChange={(e) => handleFieldChange('codigo', e.target.value)}
                readOnly={isEditing}
                disabled={isEditing}
              />
            </div>
            
            {renderFormFields()}

            {showActivoSwitch && (
              <div className="flex items-center pt-4">
                <Switch 
                  id="activo" 
                  checked={formData.activo} 
                  onCheckedChange={(checked) => handleFieldChange('activo', checked)}
                />
                <Label htmlFor="activo" className="ml-2">Activo</Label>
              </div>
            )}

            <div className="flex justify-end space-x-4 pt-6">
              <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </motion.button>
              <motion.button type="submit" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="btn-primary">
                {isEditing ? 'Guardar Cambios' : 'Crear'}
              </motion.button>
            </div>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default FormModal;
