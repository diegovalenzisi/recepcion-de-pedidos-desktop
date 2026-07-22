import React, { useState, useEffect } from 'react';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  tienePrecio,
  obtenerPrecioOpcional,
  precioOpcionalInvalido,
  calcularSubtotalLinea,
} from '@/lib/api/optionalsPricing';

const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

const OrderItem = ({ item, onUpdateQuantity, onRemove, onUpdatePrice }) => {
  const [price, setPrice] = useState(parseFloat(item.valor || 0).toFixed(2));

  useEffect(() => {
    setPrice(parseFloat(item.valor || 0).toFixed(2));
  }, [item.valor]);

  const handlePriceChange = (e) => {
    setPrice(e.target.value);
  };

  const handlePriceBlur = () => {
    const newPrice = parseFloat(price);
    if (!isNaN(newPrice) && newPrice !== parseFloat(item.valor)) {
      onUpdatePrice(item.uniqueId, newPrice);
    } else {
      // Revert to original price if input is invalid
      setPrice(parseFloat(item.valor || 0).toFixed(2));
    }
  };

  return (
    <div className="flex flex-col p-2 bg-white rounded-md mb-2 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex-grow">
          {/* UPDATED: Reduced font size by 40% (from text-sm to text-xs) */}
          <p className="font-semibold text-xs text-slate-800">
            {item.nombre}
            {/* Etiqueta de unidad: cada unidad configurada es su propia línea. */}
            {item.unidadTotal > 1 && (
              <span className="ml-1 font-bold text-[0.6rem] text-orange-700">
                — Unidad {item.unidadIndice} de {item.unidadTotal}
              </span>
            )}
          </p>
          <div className="flex items-center">
            {/* UPDATED: Reduced price font size by 40% (text-xs to even smaller) */}
            <span className="text-[0.65rem] text-slate-500 mr-1">$</span>
            <Input
              type="number"
              value={price}
              onChange={handlePriceChange}
              onBlur={handlePriceBlur}
              className="h-5 text-[0.65rem] text-slate-500 w-16 p-1"
              step="0.01"
            />
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={() => onUpdateQuantity(item.uniqueId, -1)} className="p-1 rounded-full bg-slate-200 hover:bg-red-500 hover:text-white transition-colors"><Minus size={12} /></button>
          <span className="font-bold w-6 text-center text-xs">{item.quantity}</span>
          <button onClick={() => onUpdateQuantity(item.uniqueId, 1)} className="p-1 rounded-full bg-slate-200 hover:bg-green-500 hover:text-white transition-colors"><Plus size={12} /></button>
          <button onClick={() => onRemove(item.uniqueId)} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
        </div>
      </div>
      {item.selectedOptionals && Object.keys(item.selectedOptionals).length > 0 && (
        <div className="mt-2 pl-4 border-l-2 border-orange-200">
          {Object.values(item.selectedOptionals).flatMap((group, gi) =>
            (Array.isArray(group) ? group : []).map((op, oi) => op && (
              /* UPDATED: Reduced optional text size by 40% (from text-xs to text-[0.65rem]) */
              <p key={`${op.id || op.nombre}-${gi}-${oi}`} className="text-[0.65rem] text-slate-600 flex justify-between gap-2">
                <span className="truncate">
                  - {op.nombre} {op.quantity > 1 ? `(x${op.quantity})` : ''}
                </span>
                {/* Importe SOLO si es > 0; nunca "+$0". Precio inválido se marca. */}
                {tienePrecio(op) && (
                  <span className="font-semibold text-emerald-700 shrink-0">
                    +{formatCurrency(obtenerPrecioOpcional(op) * (Number(op.quantity) || 1))}
                  </span>
                )}
                {precioOpcionalInvalido(op) && (
                  <span className="font-semibold text-red-600 shrink-0">precio inválido</span>
                )}
              </p>
            ))
          )}
          {/* Subtotal de la línea (base × cantidad + opcionales), solo si hay adicional. */}
          {calcularSubtotalLinea(item).totalOpcionales > 0 && (
            <p className="text-[0.65rem] font-bold text-slate-800 flex justify-between gap-2 mt-1 border-t border-orange-200 pt-1">
              <span>Subtotal</span>
              <span>{formatCurrency(calcularSubtotalLinea(item).subtotal)}</span>
            </p>
          )}
        </div>
      )}
      {item.promoDetails && item.promoDetails.length > 0 && (
          <div className="mt-2 pl-4 border-l-2 border-blue-200">
              {item.promoDetails.map((promoItem, index) => (
                  /* UPDATED: Reduced promo details text size by 40% */
                  <div key={index} className="text-[0.65rem] text-slate-600">
                      <p className="font-medium">{promoItem.nombre} (x{promoItem.cantidad})</p>
                      {promoItem.selectedOptionals && Object.keys(promoItem.selectedOptionals).length > 0 && (
                           <div className="pl-2">
                              {Object.values(promoItem.selectedOptionals).flatMap(group => 
                                  (Array.isArray(group) ? group : []).map(op => op && (
                                      <p key={`${op.id}-${Math.random()}`}>- {op.nombre}</p>
                                  ))
                              )}
                          </div>
                      )}
                  </div>
              ))}
          </div>
      )}
    </div>
  );
};

export default OrderItem;