import React from 'react';
import OrderItem from './OrderItem';

const OrderSummary = ({ orderItems, total, onUpdateQuantity, onRemoveItem, onUpdatePrice }) => {
  return (
    <div className="col-span-4 bg-slate-100 rounded-lg flex flex-col p-4">
      <h2 className="text-xl font-bold mb-4 text-slate-800 border-b border-slate-300 pb-2">Resumen del Pedido</h2>
      <div className="flex-grow overflow-y-auto pr-2">
        {orderItems.length === 0 ? (
          <p className="text-center text-slate-500 mt-10">Seleccione artículos para comenzar.</p>
        ) : (
          orderItems.map(item => (
            <OrderItem 
              key={item.uniqueId} 
              item={item} 
              onUpdateQuantity={onUpdateQuantity}
              onRemove={onRemoveItem}
              onUpdatePrice={onUpdatePrice}
            />
          ))
        )}
      </div>
      <div className="mt-4 border-t border-slate-300 pt-4">
        <div className="flex justify-between items-center text-2xl font-bold text-slate-800">
          <span>TOTAL:</span>
          <span>{total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</span>
        </div>
      </div>
    </div>
  );
};

export default OrderSummary;