import React from 'react';
import { Package } from 'lucide-react';
import { usePromotionMinimumStock } from '@/hooks/usePromotionMinimumStock';
import { normalizarStock } from '@/lib/api/ventaUtils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const StockStatusBadge = ({ outOfStockCount = 0, lowStockCount = 0, onClick, item = null }) => {
  // CRITICAL: Call the hook at the top level, outside any conditional blocks
  // to comply with React's Rules of Hooks.
  const isPromo = Boolean(item && item.isPromo);
  const { minimumStock, limitedBy, details, loading, error } = usePromotionMinimumStock(isPromo ? item : null);

  // Case 1: Handle Promotion Item Display
  if (isPromo) {
    if (loading) {
      return (
        <div className='flex items-center gap-2' title="Calculando stock de promoción">
          <Package size={14} className="text-gray-400 animate-pulse"/>
          <span className="text-xs text-gray-500">Calculando...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className='flex items-center gap-2' title="Error calculando stock">
          <Package size={14} className="text-red-500"/>
          <span className="text-xs text-red-500">Error</span>
        </div>
      );
    }

    const statusColor = minimumStock > 10 ? 'green' : minimumStock >= 5 ? 'amber' : 'red';

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='flex items-center gap-2 cursor-help'>
              <Package size={14} className={`text-${statusColor}-500`} />
              <span className={`px-2 py-1 rounded-full text-xs font-medium bg-${statusColor}-100 text-${statusColor}-800`}>
                {minimumStock} (limitado por: {limitedBy || 'N/A'})
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-2">
              <p className="font-semibold text-sm border-b pb-1">Detalles de Stock</p>
              {details && details.length > 0 ? (
                details.map((d, i) => (
                  <div key={i} className="flex justify-between text-xs gap-4">
                    <span className="truncate max-w-[150px]">{d.name} ({d.type === 'article' ? 'Art' : 'MP'})</span>
                    {/* d.stock puede llegar como objeto { stockType, receta } en artículos por
                        receta; normalizarStock garantiza un número y evita el React #31 (renderizar
                        un objeto como texto). */}
                    <span className="font-mono">{normalizarStock(d.stock)} / {d.required} = {d.possible}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No hay detalles disponibles</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Case 2: Original Header Badge implementation (e.g. for global alerts)
  if (outOfStockCount === 0 && lowStockCount === 0) return null;

  const title = `⚠️ ${outOfStockCount} Faltantes, ${lowStockCount} Bajos - Click para ver detalles`;

  return (
    <div 
      className="inline-flex items-center justify-center gap-1.5"
      onClick={onClick}
      title={title}
      role="button"
      aria-label={title}
    >
      {outOfStockCount > 0 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 bg-red-500 text-white font-bold text-[10px] cursor-pointer hover:bg-red-600 hover:scale-110 shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse border border-white">
          {outOfStockCount > 99 ? '99+' : outOfStockCount}
        </div>
      )}
      {lowStockCount > 0 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 bg-amber-500 text-white font-bold text-[10px] cursor-pointer hover:bg-amber-600 hover:scale-110 shadow-[0_0_8px_rgba(245,158,11,0.6)] border border-white">
          {lowStockCount > 99 ? '99+' : lowStockCount}
        </div>
      )}
    </div>
  );
};

export default StockStatusBadge;