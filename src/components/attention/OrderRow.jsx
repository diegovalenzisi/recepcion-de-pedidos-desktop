import React, { memo } from 'react';
import { Home, Smartphone, Phone, Bike, Loader2, MessageSquare, Snowflake } from 'lucide-react';
import { useDeliveryOrderColors } from '@/hooks/useDeliveryOrderColors';
import { extractDelivererName } from '@/lib/firebase/fieldMapping';

const OrderRow = memo(({ order, isSelected, onSelect, onDoubleClick, isAlarming, useBlackText = false, colorMode = 'pastel', isLoading = false }) => {
  const { getRowStyles } = useDeliveryOrderColors(colorMode);
  
  // SAFE ACCESS: order?.status?.main with fallback to 'PENDIENTE'
  const currentStatus = order?.status?.main || 'PENDIENTE';
  const { bgClass, textClass, decorationClass } = getRowStyles(currentStatus, useBlackText);
  
  const selectedClass = isSelected ? 'ring-2 ring-offset-2 ring-orange-500 z-20 relative' : 'hover:bg-opacity-80';
  const alarmingClass = isAlarming ? 'animate-pulse-bg' : '';
  const loadingClass = isLoading ? 'opacity-70 pointer-events-none' : '';
  
  // SAFE ACCESS: Conditionally render heladera icon only if it's 'SI' or true AND order status is COMANDADO
  const isHeladera = currentStatus === 'COMANDADO' && (order?.heladera === 'SI' || order?.heladera === true || order?.heladera === 'YES');

  const delivererName = extractDelivererName(order, 'OrderRow');

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (onDoubleClick && order?.id) {
      onDoubleClick(order.id);
    }
  };

  const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value || 0);

  const displayAmount = order?.specialDiscount && ['Sorteo', 'Regalo', 'Mal Armado'].includes(order.specialDiscount.type)
    ? formatCurrency(0)
    : formatCurrency(order?.payment?.amount);
    
  const deliveryTime = order?.hora || '';

  // Explicit black separator line (border-bottom)
  const cellClass = `px-4 py-1 border-b border-black ${textClass} ${decorationClass}`;

  if (!order) return null;

  return (
    <tr 
      className={`cursor-pointer transition-all duration-300 ${bgClass} ${textClass} ${decorationClass} ${selectedClass} ${alarmingClass} ${loadingClass}`}
      onClick={() => onSelect(order.id)}
      onDoubleClick={handleDoubleClick}
    >
      <td className={`px-2 py-1 border-b border-black text-center relative ${textClass} ${decorationClass}`}>
        {isSelected && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0 h-0 border-t-8 border-t-transparent border-l-8 border-l-orange-500 border-b-8 border-b-transparent"></div>}
        <span className="font-bold inline-flex items-center gap-1">
          {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          D{order.id}
        </span>
      </td>
      <td className={cellClass}>
        <div className="text-sm">
          <p className="font-bold flex items-center">
            <Home size={12} className={`mr-1 ${textClass}`} />
            {order.client?.address} 
            <span className="font-medium ml-1 text-xs opacity-90">
              ({order.client?.details || ''})
            </span>
          </p>
          
          {order.client?.entrecalles && (
            <p 
              className="flex items-start font-medium text-xs text-purple-700/80 mt-0.5 italic cursor-help"
              title={order.client.entrecalles}
            >
              <MessageSquare size={12} className="mr-1 mt-0.5 flex-shrink-0" />
              <span className="truncate max-w-[200px]">{order.client.entrecalles}</span>
            </p>
          )}

          <p className="flex items-center font-medium mt-0.5"><Smartphone size={12} className={`mr-1 ${textClass}`} />{order.client?.name}</p>
          <p className="flex items-center font-medium"><Phone size={12} className={`mr-1 ${textClass}`} />{order.client?.phone}</p>
        </div>
      </td>
      <td className={`${cellClass} text-sm font-bold text-center`}>{order.type}</td>
      <td className={`${cellClass} text-sm text-center font-medium`}>{order.date}</td>
      <td className={`${cellClass} text-sm`}>
        <p><span className="font-bold">Ingreso:</span> {order.times?.ingress}</p>
        <p><span className="font-bold">Entrega:</span> {deliveryTime}</p>
      </td>
      <td className={`${cellClass} text-sm`}>
        <p><span className="font-bold">Importe:</span> {displayAmount}</p>
        <p><span className="font-bold">Vuelto:</span> {formatCurrency(order.payment?.change)}</p>
        <p className="font-bold">{order.payment?.method}</p>
      </td>
      <td className={`${cellClass} text-sm text-center font-bold relative`}>
        {isHeladera && (
          <div className="absolute top-1 right-1" title="En Heladera">
            <Snowflake className="w-5 h-5 text-cyan-500 drop-shadow-md" />
          </div>
        )}
        <div className="rounded-md p-1">
            <p className="font-black uppercase">{currentStatus}</p>
            {currentStatus === 'EN DELIVERY' ? (
              <div className="flex flex-col items-center mt-1">
                <span className="text-[10px] bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full flex items-center font-black uppercase whitespace-nowrap shadow-sm border border-orange-200">
                  <Bike size={12} className="mr-1"/>
                  {delivererName}
                </span>
              </div>
            ) : (
              <p className="font-bold text-xs flex items-center justify-center">
                {order.status?.sub || ''}
              </p>
            )}
        </div>
      </td>
    </tr>
  );
});

OrderRow.displayName = 'OrderRow';

export default OrderRow;