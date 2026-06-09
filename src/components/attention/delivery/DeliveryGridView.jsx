import React, { memo, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDeliveryOrderColors } from '@/hooks/useDeliveryOrderColors';
import { Loader2, MapPin, Phone, DollarSign, Wallet, CreditCard, Truck, Snowflake, Bike } from 'lucide-react';
import { fetchGridViewSettings } from '@/lib/api/settingsApi';
import { extractDelivererName } from '@/lib/firebase/fieldMapping';

const DeliveryGridView = memo(({ orders, selectedOrderId, processingOrderId, onSelectOrder, onDoubleClickOrder, alarmingOrderIds = [], useBlackText = false, colorMode = 'pastel', settings }) => {
  const { getRowStyles } = useDeliveryOrderColors(colorMode);
  const [gridPrefs, setGridPrefs] = useState({
    showAddress: false,
    showPhone: false,
    showAmount: false,
    showChange: false,
    showPaymentType: false,
    showDeliverer: false,
    gridColumns: 5,
    gridRows: 4
  });

  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      try {
        const fetchedPrefs = await fetchGridViewSettings();
        if (isMounted) {
          setGridPrefs({
            ...gridPrefs,
            ...settings?.gridViewSettings,
            ...fetchedPrefs
          });
        }
      } catch (error) {
        if (isMounted) {
          setGridPrefs(prev => ({
            ...prev,
            ...settings?.gridViewSettings
          }));
        }
      }
    };
    loadSettings();
    return () => { isMounted = false; };
  }, [settings?.gridViewSettings]);

  if (orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-10 bg-white rounded-lg border border-gray-200">
        <span className="font-bold text-gray-500">No hay pedidos para mostrar.</span>
      </div>
    );
  }

  const columns = gridPrefs.gridColumns || 5;
  const rows = gridPrefs.gridRows || 4;

  const scaleFactor = Math.min(5 / columns, 4 / rows);

  return (
    <div 
      className="bg-white p-4 rounded-lg min-h-full border border-gray-200 shadow-sm"
      style={{ '--grid-scale': scaleFactor }}
    >
      <div 
        className="grid gap-4"
        style={{ 
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: rows > 0 ? `minmax(0, 1fr)` : 'auto'
        }}
      >
        {orders.map(order => {
          const isSelected = selectedOrderId === order.id;
          const isLoading = processingOrderId === order.id;
          const isAlarming = alarmingOrderIds.includes(order.id);
          
          // Conditionally render heladera icon only if it's 'SI' or true AND order status is COMANDADO
          const isHeladera = order.status?.main === 'COMANDADO' && (order.heladera === 'SI' || order.heladera === true || order.heladera === 'YES');
          
          const delivererName = extractDelivererName(order, 'DeliveryGridView');

          const { bgClass, textClass: styleTextClass, decorationClass } = getRowStyles(order.status?.main || 'default', useBlackText);
          const textClass = useBlackText ? 'text-black' : styleTextClass;

          const totalAmount = order.payment?.total || order.total || 0;
          const paidAmount = order.payment?.paysWith || order.payment?.montoAbonado || 0;
          const change = paidAmount > totalAmount ? paidAmount - totalAmount : 0;
          const paymentType = order.payment?.method || 'No definido';

          return (
            <div
              key={order.id}
              onClick={() => onSelectOrder(order.id)}
              onDoubleClick={() => onDoubleClickOrder && onDoubleClickOrder(order.id)}
              className={cn(
                "cursor-pointer flex flex-col p-2.5 rounded-xl border-2 transition-all duration-200 shadow-sm hover:shadow-md h-full relative",
                "border-b-black", 
                isSelected ? "border-primary shadow-md ring-2 ring-primary/40 scale-[1.02] z-10" : "border-transparent hover:border-primary/40",
                isLoading && "opacity-70 pointer-events-none",
                isAlarming && "animate-pulse-bg ring-4 ring-red-400/80 shadow-lg",
                bgClass,
                decorationClass,
                textClass
              )}
            >
              {isHeladera && (
                <div className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-md border border-cyan-200 z-20" title="En Heladera">
                  <Snowflake className="w-5 h-5 text-cyan-500 drop-shadow-sm" />
                </div>
              )}
              {isLoading ? (
                <div className="flex items-center justify-center flex-1 py-4">
                  <Loader2 className="w-8 h-8 animate-spin text-primary opacity-80" />
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center w-full mb-2">
                    <span className="dynamic-text-base font-semibold opacity-80 uppercase tracking-wider leading-none mb-1 text-center">
                      {order.status?.main}
                    </span>
                    {order.status?.main === 'EN DELIVERY' && delivererName !== 'Sin asignar' && (
                      <span className="text-[10px] bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full flex items-center font-black uppercase whitespace-nowrap mb-1 shadow-sm border border-orange-200">
                        <Bike className="w-3 h-3 mr-1" />
                        {delivererName}
                      </span>
                    )}
                    <span className="dynamic-text-lg font-bold leading-none">
                      {order.numeroPedido || order.id.toString().slice(-4)}
                    </span>
                  </div>
                  
                  <div className="flex flex-col gap-1 mt-auto w-full bg-white/50 p-2 rounded-lg border border-white/30 backdrop-blur-sm shadow-inner">
                    {gridPrefs.showAddress && order.client?.address && (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 opacity-70 shrink-0" style={{ transform: `scale(${scaleFactor})` }} />
                        <span className="line-clamp-2 leading-tight font-medium dynamic-text-sm">{order.client.address}</span>
                      </div>
                    )}
                    {gridPrefs.showPhone && order.client?.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 opacity-70 shrink-0" style={{ transform: `scale(${scaleFactor})` }} />
                        <span className="truncate font-medium dynamic-text-sm">{order.client.phone}</span>
                      </div>
                    )}
                    {gridPrefs.showAmount && (
                      <div className="flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 opacity-70 shrink-0" style={{ transform: `scale(${scaleFactor})` }} />
                        <span className="truncate font-medium dynamic-text-sm font-bold">Total: ${totalAmount}</span>
                      </div>
                    )}
                    {gridPrefs.showChange && change > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 opacity-70 shrink-0" style={{ transform: `scale(${scaleFactor})` }} />
                        <span className="truncate font-medium text-emerald-800 dynamic-text-sm font-bold">Vuelto: ${change}</span>
                      </div>
                    )}
                    {gridPrefs.showPaymentType && (
                      <div className="flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 opacity-70 shrink-0" style={{ transform: `scale(${scaleFactor})` }} />
                        <span className="truncate font-medium dynamic-text-sm">{paymentType}</span>
                      </div>
                    )}
                    {gridPrefs.showDeliverer && order.status?.main !== 'EN DELIVERY' && (
                      <div className="flex items-center gap-1.5">
                        <Truck className={`w-3.5 h-3.5 opacity-70 shrink-0 ${delivererName !== 'Sin asignar' ? 'text-orange-700' : ''}`} style={{ transform: `scale(${scaleFactor})` }} />
                        <span className={`truncate font-medium dynamic-text-sm ${delivererName !== 'Sin asignar' ? 'text-orange-800 uppercase font-black bg-white/60 px-1 rounded shadow-sm' : ''}`}>{delivererName}</span>
                      </div>
                    )}
                    {!gridPrefs.showAddress && !gridPrefs.showPhone && !gridPrefs.showAmount && !gridPrefs.showChange && !gridPrefs.showPaymentType && !gridPrefs.showDeliverer && order.status?.main !== 'EN DELIVERY' && (
                       <div className="text-center opacity-50 dynamic-text-xs py-0.5 font-medium">Detalles ocultos</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

DeliveryGridView.displayName = 'DeliveryGridView';
export default DeliveryGridView;