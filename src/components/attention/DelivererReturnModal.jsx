import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, RotateCcw, Package, Wallet } from 'lucide-react';
import { useDelivererReturn } from '@/hooks/useDelivererReturn';
import DelivererReturnSummary from '@/components/attention/DelivererReturnSummary';
import { cn } from '@/lib/utils';

const DelivererReturnModal = ({ isOpen, onOpenChange, orders, deliverers, currentShift }) => {
  
  const handleClose = () => {
    onOpenChange(false);
  };

  const {
    selectedDelivererId,
    setSelectedDelivererId,
    pendingOrders,
    selectedOrderIds,
    toggleOrderSelection,
    totals,
    confirmReturn,
    isProcessing,
    selectAll,
    deselectAll
  } = useDelivererReturn(orders, deliverers, currentShift, handleClose);

  const formatCurrency = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 bg-white border-none shadow-2xl overflow-hidden">
        <DialogHeader className="px-6 py-4 bg-white border-b sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-orange-100 rounded-lg">
                <RotateCcw className="w-6 h-6 text-orange-600" />
             </div>
             <div>
                <DialogTitle className="text-xl font-bold text-gray-900">Regreso de Repartidor</DialogTitle>
                <DialogDescription className="text-gray-500">
                  Seleccione el repartidor y marque los pedidos que rinde en este momento.
                </DialogDescription>
             </div>
          </div>
        </DialogHeader>

        {/* Main Content Area - changed overflow handling to prevent clipping */}
        <div className="p-6 flex-1 overflow-y-auto bg-white">
            {/* Removed fixed max-height on grid to allow content to dictate height */}
            <div className="grid grid-cols-12 gap-6">
                
                {/* Left Column: Select and List */}
                <div className="col-span-12 md:col-span-8 flex flex-col gap-4">
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 shrink-0">
                        <label className="text-sm font-semibold text-gray-700 mb-2 block">Repartidor en Servicio</label>
                        <Select value={selectedDelivererId} onValueChange={setSelectedDelivererId}>
                          <SelectTrigger className="w-full h-11 text-base bg-white border-gray-300">
                              <SelectValue placeholder="Seleccione un repartidor para ver sus pedidos..." />
                          </SelectTrigger>
                          <SelectContent>
                              {deliverers.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                  {d.nombre} {d.apellido}
                              </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                    </div>

                    {selectedDelivererId && (
                        <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden shadow-sm">
                            <div className="p-3 border-b bg-gray-50/50 flex justify-between items-center shrink-0">
                                <h4 className="font-semibold text-gray-700 flex items-center gap-2">
                                    <Package className="w-4 h-4 text-orange-500"/> 
                                    Pedidos en Camino ({pendingOrders.length})
                                </h4>
                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="sm" onClick={selectAll} className="h-8 text-xs font-medium hover:bg-gray-200">Seleccionar Todos</Button>
                                    <span className="text-gray-300">|</span>
                                    <Button variant="ghost" size="sm" onClick={deselectAll} className="h-8 text-xs font-medium hover:bg-gray-200">Limpiar</Button>
                                </div>
                            </div>
                            
                            {/* ScrollArea with fixed height of 400px as requested for better scrolling */}
                            <ScrollArea className="h-[400px] w-full bg-white pr-2.5">
                                {pendingOrders.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                                        <Package className="w-12 h-12 opacity-20" />
                                        <p className="font-medium text-sm text-center px-4">No hay pedidos pendientes para este repartidor.</p>
                                    </div>
                                ) : (
                                    <div className="p-3 space-y-2">
                                        {pendingOrders.map(order => {
                                            const isSelected = selectedOrderIds.includes(order.id);
                                            const isCash = order.payment?.method === 'Efectivo';
                                            const orderTotal = order.payment?.total || 0;
                                            const orderChange = order.payment?.change || 0;
                                            
                                            return (
                                                <div 
                                                    key={order.id} 
                                                    className={cn(
                                                        "flex items-center p-4 rounded-xl border transition-all cursor-pointer group",
                                                        isSelected 
                                                          ? "border-green-500 bg-green-50/50 ring-1 ring-green-500" 
                                                          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50"
                                                    )}
                                                    onClick={() => toggleOrderSelection(order.id)}
                                                >
                                                    <div className="mr-4">
                                                      <Checkbox 
                                                          checked={isSelected} 
                                                          onCheckedChange={() => toggleOrderSelection(order.id)}
                                                          className="w-5 h-5 border-gray-300 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                                                      />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <div className="flex items-center gap-2">
                                                              <span className="font-bold text-gray-900">#{order.id}</span>
                                                              <span className={cn(
                                                                  "text-[10px] px-2 py-0.5 rounded-full font-bold border uppercase tracking-wider",
                                                                  isCash ? "bg-green-100 text-green-700 border-green-200" : "bg-blue-100 text-blue-700 border-blue-200"
                                                              )}>
                                                                  {order.payment?.method || 'N/A'}
                                                              </span>
                                                            </div>
                                                            <div className="text-right">
                                                              <div className="font-bold text-gray-900">{formatCurrency(orderTotal)}</div>
                                                              {orderChange > 0 && isCash && (
                                                                <div className="text-[11px] font-semibold text-orange-600 bg-orange-50 px-1.5 rounded mt-0.5">
                                                                  Vuelto: {formatCurrency(orderChange)}
                                                                </div>
                                                              )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center text-xs text-gray-500 gap-1 italic truncate">
                                                            <span className="font-medium">Dirección:</span> 
                                                            {order.client?.address} {order.client?.entrecalle1 ? `(${order.client.entrecalle1})` : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    )}
                </div>

                {/* Right Column: Summary & Actions */}
                <div className="col-span-12 md:col-span-4 flex flex-col gap-4 overflow-hidden shrink-0">
                    <DelivererReturnSummary totals={totals} />
                    
                    <div className="mt-auto space-y-3">
                         <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-[11px] text-blue-800 shadow-sm">
                            <p className="font-bold mb-2 flex items-center gap-2 text-blue-900 text-xs">
                              <Wallet className="w-4 h-4"/> 
                              Información de Proceso
                            </p>
                            <ul className="space-y-1.5 list-disc pl-4 opacity-90">
                              <li>Los pedidos seleccionados se marcarán como <strong>ENTREGADO</strong>.</li>
                              <li>Se registrará el ingreso de dinero en el turno actual.</li>
                              <li>El stock de los productos se descontará automáticamente.</li>
                            </ul>
                         </div>
                    </div>
                </div>
            </div>
        </div>

        <DialogFooter className="p-4 bg-gray-50 border-t flex items-center justify-end gap-3 shrink-0">
          <Button 
            variant="outline" 
            onClick={handleClose} 
            disabled={isProcessing}
            className="h-11 px-6 font-semibold border-gray-300 text-gray-700 bg-white"
          >
            Cancelar
          </Button>
          <Button 
            className="bg-green-600 hover:bg-green-700 h-11 px-8 font-bold shadow-md transition-all active:scale-95" 
            onClick={confirmReturn}
            disabled={isProcessing || selectedOrderIds.length === 0}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin"/> 
                Procesando...
              </>
            ) : (
              <>
                <RotateCcw className="w-5 h-5 mr-2" />
                Confirmar Rendición ({selectedOrderIds.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DelivererReturnModal;