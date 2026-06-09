import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShoppingCart, Hash, Store, Truck } from 'lucide-react';

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
};

const formatSaleId = (sale) => {
  if (sale.type === 'Mostrador') {
    return `M${sale.id}`;
  }
  if (sale.type === 'Delivery') {
    return `D${sale.id}`;
  }
  return sale.id;
};

const CashRegisterSales = ({ sales }) => {
  return (
    <Card className="flex-grow flex flex-col">
      <CardHeader><CardTitle>Ventas Realizadas</CardTitle></CardHeader>
      <CardContent className="flex-grow relative">
        <ScrollArea className="absolute inset-0 pr-4">
          <div className="border rounded-lg">
            <div className="grid grid-cols-6 bg-gray-50 p-2 font-bold text-sm text-gray-600 sticky top-0 z-10">
              <div>Hora</div>
              <div>Tipo</div>
              <div>Nº Pedido</div>
              <div>Forma de Pago</div>
              <div>Estado</div>
              <div className="text-right">Total</div>
            </div>
            {sales.length > 0 ? (
              sales.map(sale => (
                <div key={`${sale.type}-${sale.id}`} className="grid grid-cols-6 p-2 border-t items-center hover:bg-orange-50/50">
                  <div>{sale.hora}</div>
                  <div>
                    {sale.type === 'Mostrador' ?
                      <Store className="inline h-4 w-4 text-blue-500" title="Mostrador" /> :
                      <Truck className="inline h-4 w-4 text-green-500" title="Delivery" />}
                  </div>
                  <div><Hash className="inline h-3 w-3" />{formatSaleId(sale)}</div>
                  <div>{(sale.payments || []).map(p => p.method).join(' / ')}</div>
                  <div className={`font-semibold ${sale.status === 'CANCELADO' ? 'text-red-500' : ''}`}>
                    {sale.status}
                  </div>
                  <div className="text-right font-semibold">{formatCurrency(sale.total)}</div>
                </div>
              ))
            ) : (
              <div className="text-center py-10 text-gray-500">
                <ShoppingCart className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                <p>No hay ventas registradas para este turno.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default CashRegisterSales;