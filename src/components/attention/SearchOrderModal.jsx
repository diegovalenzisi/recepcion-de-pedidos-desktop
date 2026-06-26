import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Package, MapPin, User, Calendar, Clock, CreditCard, Receipt, Database } from 'lucide-react';
import { findOrderGlobal } from '@/lib/api/ordersApi';
import { cn } from '@/lib/utils';
import { getOrdersFromCache } from '@/lib/cache/cacheManager';

const SearchOrderModal = ({ isOpen, onOpenChange }) => {
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [searchSource, setSearchSource] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!orderId) return;

    setLoading(true);
    setError('');
    setResult(null);
    setSearchSource('');

    try {
      // Step 1: Fast local cache search
      const cachedOrders = await getOrdersFromCache();
      const localMatch = cachedOrders.find(o => String(o.id) === String(orderId));
      
      if (localMatch) {
          setResult({ ...localMatch, source: 'ACTIVO (Caché)' });
          setSearchSource('cache');
          setLoading(false); // Stop loading early if found locally
          return;
      }

      // Step 2: Fallback to global database search if not in cache
      setSearchSource('database');
      const foundOrder = await findOrderGlobal(orderId);

      if (foundOrder) {
        setResult(foundOrder);
      } else {
        setError(`No se encontró el pedido #${orderId} en activos ni en el historial reciente (últimos 90 días).`);
      }
    } catch (err) {
      console.error(err);
      setError('Ocurrió un error durante la búsqueda.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOrderId('');
    setResult(null);
    setError('');
    setSearchSource('');
    onOpenChange(false);
  };

  const formatCurrency = (val) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val || 0);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-6xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0 bg-white shadow-xl overflow-hidden">
        {/* Header Section */}
        <DialogHeader className="px-6 py-4 bg-white border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                    <Search className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                    <DialogTitle className="text-xl font-bold text-gray-900">Buscar Pedido</DialogTitle>
                    <DialogDescription className="text-gray-500 hidden md:block">
                        Búsqueda rápida en caché local y base de datos histórica.
                    </DialogDescription>
                </div>
            </div>
            
            {/* Inline Search Form for larger screens */}
            <form onSubmit={handleSearch} className="flex gap-2 items-center w-full md:w-auto">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                    <Input
                        id="search-id"
                        placeholder="N° Pedido..."
                        type="number"
                        value={orderId}
                        onChange={(e) => setOrderId(e.target.value)}
                        autoFocus
                        className="pl-9 w-32 md:w-48 font-semibold bg-gray-50 focus:bg-white transition-colors"
                    />
                </div>
                <Button type="submit" disabled={loading || !orderId} className="bg-blue-600 hover:bg-blue-700 font-bold min-w-[100px]">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                    {loading ? '...' : 'Buscar'}
                </Button>
            </form>
          </div>
          {error && <p className="text-sm text-red-600 font-bold mt-2 bg-red-50 p-2 rounded border border-red-100 text-center">{error}</p>}
        </DialogHeader>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden bg-gray-50/30 p-6">
            {!result ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-4">
                    <div className="bg-gray-100 p-6 rounded-full relative">
                        <Search className="h-12 w-12 text-gray-300" />
                        {loading && <Database className="h-6 w-6 text-blue-400 absolute bottom-4 right-4 animate-pulse" />}
                    </div>
                    <div className="text-center max-w-md">
                        <h3 className="text-lg font-semibold text-gray-600">Esperando búsqueda</h3>
                        <p className="text-sm">Ingrese el número de pedido arriba. Primero se buscará localmente para mayor velocidad.</p>
                    </div>
                </div>
            ) : (
                <div className="h-full grid grid-cols-1 md:grid-cols-12 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Left Column: Meta Information (Client, Payment, Status) */}
                    <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-4 overflow-y-auto pr-2 pb-4">
                        
                        {/* Status Card */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                                    <Receipt className="w-5 h-5 text-gray-500" />
                                    Pedido #{result.id}
                                </h3>
                                <div className="flex flex-col items-end">
                                    <span className={cn(
                                        "text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide",
                                        result.source.includes('ACTIVO') ? "bg-green-100 text-green-700 border border-green-200" : "bg-orange-100 text-orange-700 border border-orange-200"
                                    )}>
                                        {result.source.replace(' (Caché)', '')}
                                    </span>
                                    {searchSource === 'cache' && <span className="text-[10px] text-gray-400 mt-1">Cargado desde caché</span>}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100">
                                <div className="text-center p-2 bg-gray-50 rounded-lg">
                                    <span className="text-xs text-gray-500 font-semibold block uppercase mb-1">Fecha</span>
                                    <p className="text-sm font-bold text-gray-900 flex items-center justify-center gap-1">
                                        <Calendar className="h-3 w-3" /> {result.date}
                                    </p>
                                </div>
                                <div className="text-center p-2 bg-gray-50 rounded-lg">
                                    <span className="text-xs text-gray-500 font-semibold block uppercase mb-1">Hora</span>
                                    <p className="text-sm font-bold text-gray-900 flex items-center justify-center gap-1">
                                        <Clock className="h-3 w-3" /> {result.hora || result.times?.ingress || '--:--'}
                                    </p>
                                </div>
                            </div>
                             <div className="mt-3 p-2 bg-blue-50 border border-blue-100 rounded-lg text-center">
                                <span className="text-xs text-blue-600 font-bold uppercase tracking-wider">Estado Actual</span>
                                <div className="text-sm font-black text-blue-900 uppercase">
                                    {result.status?.main}
                                    {result.status?.sub && <span className="text-blue-700 font-bold block text-xs mt-0.5">{result.status.sub}</span>}
                                </div>
                            </div>
                        </div>

                        {/* Client Card */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex-1">
                            <h4 className="text-sm font-black text-gray-400 uppercase flex items-center gap-2 mb-3 tracking-wider">
                                <User className="h-4 w-4" /> Datos del Cliente
                            </h4>
                            <div className="space-y-3">
                                <div>
                                    <p className="font-black text-lg text-gray-900">{result.client?.name || 'Mostrador'}</p>
                                    <p className="text-sm text-gray-600 flex items-start gap-1.5 mt-1">
                                       <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" /> 
                                       <span className="font-medium">{result.client?.address || 'Sin dirección'}</span>
                                    </p>
                                </div>
                                {result.client?.details && (
                                    <div className="bg-orange-50 p-3 rounded-lg border border-orange-100 text-xs text-orange-800 italic font-medium">
                                        "{result.client.details}"
                                    </div>
                                )}
                                {result.client?.phone && (
                                    <div className="flex items-center gap-2 text-sm font-bold text-gray-700 bg-gray-50 p-2 rounded">
                                        <span>Teléfono:</span>
                                        <a href={`tel:${result.client.phone}`} className="text-blue-600 hover:underline">{result.client.phone}</a>
                                    </div>
                                )}
                            </div>
                        </div>

                         {/* Payment Card */}
                         <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                            <h4 className="text-sm font-black text-gray-400 uppercase flex items-center gap-2 mb-3 tracking-wider">
                                <CreditCard className="h-4 w-4" /> Pago
                            </h4>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center p-2 rounded bg-gray-50">
                                    <span className="text-sm font-bold text-gray-600">Método</span>
                                    <span className="text-sm font-black text-gray-900 uppercase">{result.payment?.method || 'Efectivo'}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 rounded bg-green-50 border border-green-100">
                                    <span className="text-sm font-bold text-green-700">Total</span>
                                    <span className="text-lg font-black text-green-700">{formatCurrency(result.payment?.total || result.payment?.amount)}</span>
                                </div>
                                {result.payment?.change > 0 && (
                                    <div className="flex justify-between items-center px-2 py-1">
                                        <span className="text-xs font-bold text-gray-500">Vuelto requerido</span>
                                        <span className="text-xs font-bold text-orange-600">{formatCurrency(result.payment.change)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Order Items List */}
                    <div className="md:col-span-7 lg:col-span-8 flex flex-col h-full overflow-hidden bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div className="p-4 border-b bg-gray-50/80 flex justify-between items-center shrink-0">
                            <h4 className="font-bold text-gray-700 flex items-center gap-2">
                                <Package className="w-5 h-5 text-blue-500"/> 
                                Detalle de Productos
                            </h4>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider bg-white px-2 py-1 rounded border">
                                {result.items?.length || 0} ítems
                            </span>
                        </div>
                        
                        <ScrollArea className="flex-1 p-0">
                            <div className="divide-y divide-gray-100">
                                {result.items?.map((item, idx) => (
                                    <div key={idx} className="p-4 hover:bg-gray-50 transition-colors">
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex items-start gap-3">
                                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm shrink-0 mt-0.5">
                                                    {item.cantidad}
                                                </div>
                                                <div>
                                                    <span className="font-bold text-gray-900 text-base block">{item.nombre}</span>
                                                    {item.gustos && (
                                                        <p className="text-sm text-gray-500 italic mt-0.5">
                                                            {item.gustos}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="font-black text-gray-700 whitespace-nowrap ml-4">
                                                {formatCurrency(item.valor || item.precio)}
                                            </span>
                                        </div>

                                        {item.promoItems && item.promoItems.length > 0 && (
                                            <div className="mt-2 ml-11 bg-orange-50/50 rounded-lg p-3 border border-orange-100">
                                                <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-2">Contenido de la Promo:</p>
                                                <div className="space-y-2">
                                                    {item.promoItems.map((pi, pidx) => (
                                                        <div key={pidx} className="text-sm">
                                                            <div className="font-bold text-gray-700 flex items-center gap-2">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                                                                {pi.cantidad}x {pi.nombre}
                                                            </div>
                                                            {pi.selectedOptionals && Object.keys(pi.selectedOptionals).length > 0 && (
                                                                <div className="pl-4 mt-1 space-y-0.5">
                                                                    {Object.entries(pi.selectedOptionals).map(([cat, opts]) => (
                                                                        <div key={cat} className="text-xs text-gray-500">
                                                                            <span className="font-medium text-gray-400">{cat}:</span> {opts.map(o => o.name).join(', ')}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                        
                        <div className="p-4 bg-gray-50 border-t shrink-0 flex justify-end">
                            <div className="text-right">
                                <p className="text-xs text-gray-500 font-bold uppercase">Total del Pedido</p>
                                <p className="text-2xl font-black text-gray-900">{formatCurrency(result.payment?.total || result.payment?.amount)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>

        <DialogFooter className="p-4 bg-white border-t flex items-center justify-end shrink-0">
          <Button variant="outline" onClick={handleClose} className="font-bold min-w-[120px]">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SearchOrderModal;