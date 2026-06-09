import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShoppingCart, Hash, Clock, CreditCard, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
};

const CounterSalesList = ({ sales, onCancelSale }) => {
  const [expandedSaleId, setExpandedSaleId] = useState(null);
  const [saleToCancel, setSaleToCancel] = useState(null);

  const toggleExpand = (saleId) => {
    setExpandedSaleId(expandedSaleId === saleId ? null : saleId);
  };

  const handleCancelRequest = (sale) => {
    setSaleToCancel(sale);
  };

  const confirmCancellation = () => {
    if (saleToCancel) {
      onCancelSale(saleToCancel);
      setSaleToCancel(null);
    }
  };

  return (
    <>
      <Card className="flex-grow flex flex-col">
        <CardContent className="flex-grow relative p-0">
          <ScrollArea className="h-full">
            <div className="border rounded-lg">
              <div className="grid grid-cols-5 bg-gray-50 p-2 font-bold text-sm text-black sticky top-0 z-10">
                <div className="col-span-1"><Clock className="inline h-4 w-4 mr-1 text-black" />Hora</div>
                <div className="col-span-1"><Hash className="inline h-4 w-4 mr-1 text-black" />Nº Venta</div>
                <div className="col-span-2"><CreditCard className="inline h-4 w-4 mr-1 text-black" />Forma de Pago</div>
                <div className="text-right col-span-1">Total</div>
              </div>
              {sales.length > 0 ? (
                sales.map(sale => (
                  <React.Fragment key={sale.id}>
                    <div 
                      className={`grid grid-cols-5 p-2 border-t items-center hover:bg-orange-50/50 cursor-pointer text-black ${sale.status === 'CANCELADO' ? 'bg-red-50 text-gray-500 line-through' : ''}`}
                      onClick={() => toggleExpand(sale.id)}
                    >
                      <div className="col-span-1 font-medium">{sale.hora}</div>
                      <div className="col-span-1 font-medium">M{sale.id}</div>
                      <div className="col-span-2 font-medium">{(sale.payments || []).map(p => p.method).join(' / ')}</div>
                      <div className="text-right font-bold col-span-1 flex justify-end items-center">
                        {formatCurrency(sale.total)}
                        {expandedSaleId === sale.id ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
                      </div>
                    </div>
                    <AnimatePresence>
                      {expandedSaleId === sale.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="bg-gray-50 overflow-hidden"
                        >
                          <div className="p-2 pl-4 border-t text-black">
                            <h4 className="font-bold text-sm mb-1">Artículos:</h4>
                            <ul className="list-disc list-inside text-sm font-medium">
                              {(sale.items || []).map((item, index) => (
                                <li key={`${item.id}-${index}`}>
                                  {item.quantity} x {item.nombre} - {formatCurrency((item.valor || 0) * item.quantity)}
                                </li>
                              ))}
                            </ul>
                            {sale.status !== 'CANCELADO' && (
                              <div className="mt-2 text-right">
                                <Button variant="destructive" size="sm" onClick={() => handleCancelRequest(sale)}>
                                  <XCircle className="mr-2 h-4 w-4" />
                                  Cancelar Venta
                                </Button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))
              ) : (
                <div className="text-center py-10 text-gray-500">
                  <ShoppingCart className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>No hay ventas de mostrador registradas para este turno.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <ConfirmationDialog
        isOpen={!!saleToCancel}
        onClose={() => setSaleToCancel(null)}
        onConfirm={confirmCancellation}
        title={`¿Cancelar Venta N° M${saleToCancel?.id}?`}
        description="Esta acción restaurará el stock y creará una nota de crédito en los gastos. Esta acción no se puede deshacer."
      />
    </>
  );
};

export default CounterSalesList;