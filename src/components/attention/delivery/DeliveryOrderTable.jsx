import React, { memo } from 'react';
import OrderRow from '@/components/attention/OrderRow';

const DeliveryOrderTable = memo(({ orders, selectedOrderId, processingOrderId, onSelectOrder, onDoubleClickOrder, alarmingOrderIds = [], useBlackText = false, colorMode = 'pastel' }) => {
  const headerClass = useBlackText ? "text-black" : "text-gray-600";
  
  return (
    <div className="flex-grow flex flex-col bg-white rounded-lg shadow-sm border border-gray-200">
      <table className="w-full table-auto">
        <thead className="bg-gray-100 sticky top-0 z-10">
          <tr>
            <th className={`w-[6%] px-2 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>N°</th>
            <th className={`w-[34%] px-4 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>Cliente</th>
            <th className={`w-[10%] px-4 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>Tipo</th>
            <th className={`w-[10%] px-4 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>Fecha</th>
            <th className={`w-[15%] px-4 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>Horarios</th>
            <th className={`w-[15%] px-4 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>Pago</th>
            <th className={`w-[15%] px-4 py-1 text-left text-xs font-black uppercase tracking-wider ${headerClass}`}>Estado</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {orders.length === 0 ? (
            <tr>
              <td colSpan="7" className={`text-center py-10 font-bold ${useBlackText ? 'text-black' : 'text-gray-500'}`}>No hay pedidos para esta fecha.</td>
            </tr>
          ) : (
            orders.map(order => (
              <OrderRow
                key={order.id}
                order={order}
                isSelected={selectedOrderId === order.id}
                isLoading={processingOrderId === order.id}
                onSelect={onSelectOrder}
                onDoubleClick={onDoubleClickOrder}
                isAlarming={alarmingOrderIds.includes(order.id)}
                useBlackText={useBlackText}
                colorMode={colorMode}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
});

DeliveryOrderTable.displayName = 'DeliveryOrderTable';

export default DeliveryOrderTable;