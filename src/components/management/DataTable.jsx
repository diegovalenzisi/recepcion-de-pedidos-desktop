
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Edit, Trash2, ImageOff, Link2, BookText, Copy, PlusCircle, MinusCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useParentArticleStock } from '@/hooks/useParentArticleStock.js';
import { normalizarStock, normalizarCosto } from '@/lib/api/ventaUtils';
import { getAvailableUnits } from '@/lib/api/stockAvailability';
import StockStatusBadge from './StockStatusBadge';

const TableRow = React.memo(({ item, index, activeTab, onEdit, onDelete, onDuplicate, allData, onToggleStatus, onToggleControlStock, onTachoStockChange, canModifyTachoStock, hasFullAccess, gruposOpcionalesMap, articlesById, materiaPrimaById }) => {

  const heredadoDeId = (item.stock?.stockType === 'heredado' || item.stock?.heredadoDe) ? item.stock?.heredadoDe : null;
  const { stock: parentStock, loading: parentLoading, parentExists } = useParentArticleStock(heredadoDeId);

  const getStockDisplay = () => {
    if (activeTab !== 'articulos') return null;

    if (item.isPromo) {
        return <StockStatusBadge item={item} />;
    }

    if (!item.stock) return null;

    const { stockType, propio, heredadoDe, receta } = item.stock;
    const effectiveStockType = stockType || (heredadoDe ? 'heredado' : (receta ? 'receta' : 'propio'));

    switch (effectiveStockType) {
      case 'propio':
        const stockValue = propio || 0;
        const stockMin = item.stockMinimo || 0;
        const stockStatus = stockValue <= 0 ? 'red' : stockValue <= stockMin ? 'amber' : 'green';
        return (
           <div className='flex items-center gap-2'>
            <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${stockStatus}-100 text-${stockStatus}-800`}>
              {stockValue} u. (Mín: {stockMin})
            </span>
           </div>
        );
      case 'heredado':
        const ownStock = propio !== undefined ? propio : 0;

        if (parentLoading) {
           return (
             <div className='flex items-center gap-2' title={`Hereda de: ${heredadoDe}`}>
               <Link2 size={14} className="text-blue-500"/>
               <span className="text-xs text-gray-500">Cargando...</span>
             </div>
           );
        }

        if (!parentExists) {
           return (
             <div className='flex items-center gap-2' title={`Hereda de: ${heredadoDe}`}>
               <Link2 size={14} className="text-blue-500"/>
               <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                 {ownStock} (hereda de {heredadoDe}: no disponible)
               </span>
             </div>
           );
        }

        const pStockStatus = parentStock <= 0 ? 'red' : 'green';
        return (
          <div className='flex items-center gap-2' title={`Hereda de: ${heredadoDe}`}>
            <Link2 size={14} className="text-blue-500"/>
            <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${pStockStatus}-100 text-${pStockStatus}-800`}>
              {ownStock} (hereda de {heredadoDe}: {parentStock})
            </span>
          </div>
        );
      case 'receta': {
        if (!receta) {
             return <span className="text-xs text-gray-500">N/A</span>;
        }
        // Misma función que usa el cálculo de disponibilidad de promociones
        // (usePromotionMinimumStock): única fuente de verdad para "cuántas unidades se pueden
        // fabricar", resolviendo materia prima, artículos anidados y recetas anidadas.
        const calculatedStock = getAvailableUnits(item.codigo, articlesById, materiaPrimaById);
        const isUnlimited = calculatedStock === Infinity;
        const rStockMin = item.stockMinimo || 0;
        const recipeStockStatus = isUnlimited ? 'green' : calculatedStock <= 0 ? 'red' : calculatedStock <= rStockMin ? 'amber' : 'green';
        return (
          <div className='flex items-center gap-2' title="Stock por receta">
            <BookText size={14} className="text-purple-500"/>
            <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${recipeStockStatus}-100 text-${recipeStockStatus}-800`}>
             {isUnlimited ? 'Ilimitado' : calculatedStock} u. (Mín: {rStockMin})
            </span>
          </div>
        );
      }
      default:
        const defaultStockValue = propio || 0;
        const defStockMin = item.stockMinimo || 0;
        const defaultStockStatus = defaultStockValue <= 0 ? 'red' : defaultStockValue <= defStockMin ? 'amber' : 'green';
        return (
           <div className='flex items-center gap-2'>
            <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${defaultStockStatus}-100 text-${defaultStockStatus}-800`}>
              {defaultStockValue} u. (Mín: {defStockMin})
            </span>
           </div>
        );
    }
  };

  const content = {
    articulos: () => {
      const departamento = allData.departamentos?.find(d => d.codigo === item.departamento);
      const effectiveStockType = item.stock?.stockType || (item.stock?.heredadoDe ? 'heredado' : (item.stock?.receta ? 'receta' : 'propio'));
      const isCostDisplayable = ['propio', 'receta', 'heredado'].includes(effectiveStockType);
      
      return (
        <>
          <td className="py-2 px-4 whitespace-nowrap">
            {item.foto ? (
              <img src={item.foto} alt={item.nombre} className="h-10 w-10 rounded-md object-cover bg-gray-200" />
            ) : (
              <div className="h-10 w-10 rounded-md bg-gray-100 flex items-center justify-center">
                <ImageOff size={20} className="text-gray-400" />
              </div>
            )}
          </td>
          <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
          <td className="py-3 px-4 font-medium min-w-[200px]">{item.nombre}</td>
          <td className="py-3 px-4 whitespace-nowrap">{departamento ? departamento.nombre : 'N/A'}</td>
          <td className="py-3 px-4 font-semibold text-green-600 whitespace-nowrap">${normalizarCosto(item.valor)}</td>
          <td className="py-3 px-4 font-semibold text-blue-600 whitespace-nowrap">
            {isCostDisplayable ? (
              <div className="flex items-center gap-1" title={effectiveStockType === 'heredado' ? 'Costo heredado del artículo padre' : (effectiveStockType === 'receta' ? 'Calculado automáticamente de la receta' : '')}>
                {effectiveStockType === 'heredado' && <Link2 size={14} className="text-blue-400" />}
                {effectiveStockType === 'receta' && <BookText size={14} className="text-purple-500" />}
                <span className={effectiveStockType === 'heredado' ? 'text-blue-400 italic' : (effectiveStockType === 'receta' ? 'text-purple-600 font-medium' : '')}>
                  ${Number(item.costoTotalReceta || 0).toFixed(3)}
                </span>
              </div>
            ) : '—'}
          </td>
          <td className="py-3 px-4 whitespace-nowrap">{getStockDisplay()}</td>
          <td className="py-3 px-4 whitespace-nowrap text-center">
            <Switch
              checked={item.controlStock !== false}
              onCheckedChange={(checked) => onToggleControlStock(item, checked)}
              aria-label="Controlar stock de artículo"
            />
          </td>
          <td className="py-3 px-4 whitespace-nowrap text-center">
            <Switch
              checked={item.activo}
              onCheckedChange={(checked) => onToggleStatus(item, checked)}
              aria-label="Activar o desactivar artículo"
            />
          </td>
        </>
      );
    },
    'materia-prima': () => {
      const minVal = item.minimo || 0;
      // stock puede venir como número o (por datos migrados/erróneos) como objeto de
      // configuración { stockType, propio, receta... }; normalizarStock evita renderizar
      // el objeto (React error #31) y devuelve siempre un número seguro.
      const stockNum = normalizarStock(item.stock);
      const status = stockNum <= 0 ? 'red' : stockNum <= minVal ? 'amber' : 'green';
      const unidadLabel = item.unidadMedida || item.unidad || 'u.';
      return (
        <>
          <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
          <td className="py-3 px-4 font-medium min-w-[200px]">{item.nombre}</td>
          <td className="py-3 px-4 whitespace-nowrap capitalize">{unidadLabel}</td>
          <td className="py-3 px-4 whitespace-nowrap">
             <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${status}-100 text-${status}-800`}>
              {stockNum} {unidadLabel}
             </span>
          </td>
          <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{item.minimo} {unidadLabel}</td>
          <td className="py-3 px-4 font-medium whitespace-nowrap">
             ${Number(item.costoUnitario || 0).toFixed(2)} / {unidadLabel}
          </td>
        </>
      );
    },
    'grupos-opcionales': () => {
        return (
          <>
            <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
            <td className="py-3 px-4 font-medium w-full">{item.nombre}</td>
          </>
        );
    },
    'grupos-productos': () => {
        const count = (item.articulos || []).length;
        return (
          <>
            <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
            <td className="py-3 px-4 font-medium w-full">{item.nombre}</td>
            <td className="py-3 px-4 text-center whitespace-nowrap">{count} producto{count === 1 ? '' : 's'}</td>
          </>
        );
    },
    opcionales: () => {
      // Fase B: lookup O(1) por Map en vez de un find lineal por fila (allData['grupos-opcionales']).
      // Fallback al find solo por seguridad si el Map no llegara. Mismo resultado visual.
      const grupo = gruposOpcionalesMap
        ? gruposOpcionalesMap.get(item.grupo)
        : allData['grupos-opcionales']?.find(g => g.codigo === item.grupo);
      return (
        <>
          <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
          <td className="py-3 px-4 font-medium min-w-[200px]">{item.nombre}</td>
          <td className="py-3 px-4 whitespace-nowrap">{grupo ? grupo.nombre : 'N/A'}</td>
          <td className="py-3 px-4 font-semibold text-green-600 whitespace-nowrap">${item.precio}</td>
          <td className="py-3 px-4 whitespace-nowrap text-center">
            <Switch
              checked={item.activo}
              onCheckedChange={(checked) => onToggleStatus(item, checked)}
              aria-label="Activar/Desactivar en todos los canales"
              title="Afecta mostrador y delivery"
            />
          </td>
        </>
      );
    },
    departamentos: () => {
      return (
        <>
          <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
          <td className="py-3 px-4 font-medium min-w-[200px]">{item.nombre}</td>
          <td className="py-3 px-4 text-center whitespace-nowrap">{item.ordenWeb}</td>
          <td className="py-3 px-4 text-center whitespace-nowrap">{item.ordenLocal}</td>
          <td className="py-3 px-4 text-center whitespace-nowrap">
            <Switch
              checked={item.activo}
              onCheckedChange={(checked) => onToggleStatus(item, checked)}
              aria-label="Activar o desactivar departamento"
            />
          </td>
        </>
      );
    },
    tachos: () => {
      const status = item.stock > 1 ? 'green' : item.stock > 0 ? 'amber' : 'red';
      return (
        <>
          <td className="py-3 px-4 font-mono text-sm whitespace-nowrap">{item.codigo}</td>
          <td className="py-3 px-4 text-center whitespace-nowrap">{item.orden || 0}</td>
          <td className="py-3 px-4 font-medium min-w-[200px]">{item.nombre}</td>
          <td className="py-3 px-4 text-gray-600 text-center whitespace-nowrap">{item.deberiaHaber || 0}</td>
          <td className="py-3 px-4 text-center whitespace-nowrap">
             <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${status}-100 text-${status}-800`}>
              {item.stock || 0}
             </span>
          </td>
        </>
      );
    },
  };

  const renderActions = () => {
    if (activeTab === 'tachos') {
      const fractionalButtonClass = "p-1 text-xs h-8 w-8 flex items-center justify-center font-bold text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
      return (
        <td className="py-3 px-4 whitespace-nowrap">
          <div className="flex items-center space-x-1 justify-end">
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onTachoStockChange(item, 1)} disabled={!canModifyTachoStock} className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Añadir 1">
              <PlusCircle size={24} />
            </motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onTachoStockChange(item, -1)} disabled={!canModifyTachoStock} className="p-2 text-yellow-600 hover:bg-yellow-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Sacar 1">
              <MinusCircle size={24} />
            </motion.button>
            
            <div className="h-8 w-px bg-gray-300 mx-1"></div>

            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onTachoStockChange(item, 0.25)} disabled={!canModifyTachoStock} className={fractionalButtonClass} title="Añadir 1/4">
              +¼
            </motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onTachoStockChange(item, 0.50)} disabled={!canModifyTachoStock} className={fractionalButtonClass} title="Añadir 1/2">
              +½
            </motion.button>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onTachoStockChange(item, 0.75)} disabled={!canModifyTachoStock} className={fractionalButtonClass} title="Añadir 3/4">
              +¾
            </motion.button>

            {hasFullAccess && (
              <>
                <div className="h-8 w-px bg-gray-300 mx-1"></div>
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onEdit(item)} className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors" title="Editar">
                  <Edit size={16} />
                </motion.button>
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onDelete(item)} className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors" title="Eliminar">
                  <Trash2 size={16} />
                </motion.button>
              </>
            )}
          </div>
        </td>
      );
    }

    return (
      <td className="py-3 px-4 whitespace-nowrap text-right">
        <div className="flex space-x-2 justify-end">
          {activeTab === 'articulos' && (
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onDuplicate(item)} className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors" title="Duplicar">
              <Copy size={16} />
            </motion.button>
          )}
          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onEdit(item)} className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors" title="Editar">
            <Edit size={16} />
          </motion.button>
          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onDelete(item)} className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors" title="Eliminar">
            <Trash2 size={16} />
          </motion.button>
        </div>
      </td>
    );
  };
  
  return (
    <motion.tr
      key={item.codigo}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ delay: index * 0.05 }}
      className="border-b border-gray-100 hover:bg-slate-50 transition-colors"
    >
      {content[activeTab] ? content[activeTab]() : null}
      {renderActions()}
    </motion.tr>
  );
});

const DataTable = React.memo(({ activeTab, data, onEdit, onDelete, onDuplicate, allData, onToggleStatus, onToggleControlStock, onTachoStockChange, canModifyTachoStock, hasFullAccess }) => {
  // Fase B: índice codigo→grupo construido UNA sola vez (no por fila). Evita el find lineal
  // repetido en cada opcional al renderizar la pestaña Opcionales. Solo lectura, sin cambios
  // de datos ni visuales.
  const gruposOpcionalesMap = React.useMemo(() => {
    const map = new Map();
    (allData['grupos-opcionales'] || []).forEach(g => { if (g && g.codigo != null) map.set(g.codigo, g); });
    return map;
  }, [allData['grupos-opcionales']]);

  // Índices codigo→artículo/materia-prima construidos UNA sola vez (no por fila ni por render).
  // getAvailableUnits (stockAvailability.js) espera objetos { [codigo]: item }, igual que los
  // datos crudos de Firebase; allData.articulos/'materia-prima' son arrays, así que se indexan
  // acá para no repetir esta conversión en cada fila de la pestaña Artículos.
  const articlesById = React.useMemo(() => {
    const map = {};
    (allData.articulos || []).forEach(a => { if (a && a.codigo != null) map[a.codigo] = a; });
    return map;
  }, [allData.articulos]);

  const materiaPrimaById = React.useMemo(() => {
    const map = {};
    (allData['materia-prima'] || []).forEach(m => { if (m && m.codigo != null) map[m.codigo] = m; });
    return map;
  }, [allData['materia-prima']]);

  const headers = {
    articulos: ['Foto', 'Código', 'Nombre', 'Departamento', 'Valor', 'Costo Total', 'Stock', 'Control Stock', 'Activo', 'Acciones'],
    'materia-prima': ['Código', 'Nombre', 'Unidad', 'Stock', 'Mínimo', 'Costo Unit.', 'Acciones'],
    'grupos-opcionales': ['Código', 'Nombre', 'Acciones'],
    'grupos-productos': ['Código', 'Nombre', 'Productos', 'Acciones'],
    opcionales: ['Código', 'Nombre', 'Grupo', 'Precio', 'Activo', 'Acciones'],
    departamentos: ['Código', 'Nombre', 'Orden Web', 'Orden Local', 'Activo', 'Acciones'],
    tachos: ['Código', 'Orden', 'Nombre', 'Debería Haber', 'Stock Actual', 'Acciones'],
  };

  return (
    <div className="w-full">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b-2 border-gray-200 shadow-sm">
            {(headers[activeTab] || []).map((header, index) => {
              const isActions = header === 'Acciones';
              const isCenter = ['Orden Web', 'Orden Local', 'Debería Haber', 'Stock Actual', 'Activo', 'Control Stock', 'Productos'].includes(header);
              
              return (
                <th 
                  key={`${header}-${index}`} 
                  className={`py-3 px-4 font-semibold text-gray-700 uppercase tracking-wider bg-gray-100 ${
                    isActions ? 'text-right' : isCenter ? 'text-center' : 'text-left'
                  } whitespace-nowrap`}
                >
                  {header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {data.length > 0 ? (
              data.map((item, index) => (
                <TableRow key={item.codigo} item={item} index={index} activeTab={activeTab} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} allData={allData} onToggleStatus={onToggleStatus} onToggleControlStock={onToggleControlStock} onTachoStockChange={onTachoStockChange} canModifyTachoStock={canModifyTachoStock} hasFullAccess={hasFullAccess} gruposOpcionalesMap={gruposOpcionalesMap} articlesById={articlesById} materiaPrimaById={materiaPrimaById} />
              ))
            ) : (
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{delay: 0.2}}
              >
                <td colSpan={headers[activeTab]?.length || 1} className="text-center py-12">
                   <div className="text-gray-400 mb-4">
                    <Package size={48} className="mx-auto" />
                  </div>
                  <p className="text-gray-500 text-lg">No se encontraron resultados</p>
                  <p className="text-gray-400">Intenta con otros términos de búsqueda o agrega un nuevo elemento.</p>
                </td>
              </motion.tr>
            )}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
});

export default DataTable;
