import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QrCode, CheckCircle2, XCircle, Keyboard, CameraOff, Loader2, Trash2, CheckSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { playBeep } from '@/lib/audio/beepSound';
import { updateOrder } from '@/lib/api/ordersApi';
import jsQR from 'jsqr';
import ScannedSaleItem from './ScannedSaleItem';
import ScannedSalesSummary from './ScannedSalesSummary';

function QRScannerModal({ 
  isOpen, 
  onClose, 
  deliveryOrders = [], 
  onOrderDelivered, 
  onScanRaw, 
  customTitle, 
  customDescription, 
  hideRightPane 
}) {
  const [inputValue, setInputValue] = useState('');
  const [scanStatus, setScanStatus] = useState('idle'); // 'idle', 'success', 'error', 'processing'
  const [statusMessage, setStatusMessage] = useState('');
  const [cameraError, setCameraError] = useState(false);
  
  // State for session tracking
  const [scannedSales, setScannedSales] = useState([]);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const requestRef = useRef(null);
  const inputRef = useRef(null);
  const statusTimeout = useRef(null);
  
  const { toast } = useToast();

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      requestRef.current = requestAnimationFrame(tick);
      return;
    }

    if (scanStatus !== 'idle') {
      requestRef.current = requestAnimationFrame(tick);
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (canvas && video) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });

      if (code && code.data) {
        processQRCode(code.data);
      }
    }
    
    requestRef.current = requestAnimationFrame(tick);
  }, [scanStatus]);

  const startCamera = useCallback(async () => {
    setCameraError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", true);
        videoRef.current.play();
        requestRef.current = requestAnimationFrame(tick);
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setCameraError(true);
    }
  }, [tick]);

  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setScanStatus('idle');
      setStatusMessage('');
      if (!sessionStartTime) setSessionStartTime(Date.now());
      startCamera();
      
      const timer = setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 100);
      return () => clearTimeout(timer);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, startCamera, stopCamera]);

  const showFeedback = (status, message) => {
    setScanStatus(status);
    setStatusMessage(message);
    
    if (statusTimeout.current) {
      clearTimeout(statusTimeout.current);
    }
    
    // Auto-reset to idle to allow next scan without closing
    statusTimeout.current = setTimeout(() => {
      setScanStatus('idle');
      setStatusMessage('');
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 1500); 
  };

  const processQRCode = async (scannedId) => {
    if (!scannedId) return;
    const id = scannedId.trim();
    
    if (onScanRaw) {
      setInputValue('');
      setScanStatus('processing');
      setStatusMessage('Procesando...');
      try {
        await onScanRaw(id);
        playBeep();
        showFeedback('success', `Exito: ${id}`);
      } catch (err) {
        showFeedback('error', err.message || 'Error al procesar');
      }
      return;
    }
    
    setInputValue(''); 
    setScanStatus('processing');
    setStatusMessage('Procesando...');

    // Check if already scanned in this session
    if (scannedSales.some(sale => String(sale.id) === id)) {
      showFeedback('error', `Pedido #${id} ya fue escaneado en esta sesión.`);
      toast({
        variant: "destructive",
        title: "Duplicado",
        description: `El pedido #${id} ya está en la lista de rendición actual.`
      });
      return;
    }

    const order = deliveryOrders.find(o => String(o.id) === id);

    if (order) {
      if (order.status?.main === 'ENTREGADO') {
         showFeedback('error', `Pedido #${id} ya figura como ENTREGADO en el sistema.`);
         toast({
           variant: "destructive",
           title: "Ya entregado",
           description: `El pedido #${id} ya fue marcado como entregado previamente.`
         });
         return;
      }

      if (order.status?.main === 'EN DELIVERY') {
        try {
          playBeep();
          
          await updateOrder(order.id, { status: { main: 'ENTREGADO' } });
          
          if (onOrderDelivered) {
             await onOrderDelivered(order, false); 
          }

          setScannedSales(prev => [{ ...order, scannedAt: Date.now() }, ...prev]);
          
          showFeedback('success', `Pedido #${id} entregado con éxito.`);
          toast({
            title: "¡Éxito!",
            description: `Pedido #${id} marcado como Entregado.`,
            className: "bg-green-50 border-green-200 text-green-800"
          });
        } catch (error) {
          showFeedback('error', `Error al actualizar pedido #${id}.`);
          toast({
            variant: "destructive",
            title: "Error",
            description: "Hubo un problema al actualizar el estado en la base de datos."
          });
        }
      } else {
        console.warn(`[Audit] QRScanner: Attempted to deliver order ${id} from status ${order.status?.main}`);
        showFeedback('error', `Solo pedidos EN DELIVERY pueden marcarse como ENTREGADO. Estado actual: ${order.status?.main}`);
        toast({
          variant: "destructive",
          title: "Estado incorrecto",
          description: `Solo pedidos EN DELIVERY pueden marcarse como ENTREGADO. El pedido #${id} está en estado "${order.status?.main || 'Desconocido'}".`
        });
      }
    } else {
      showFeedback('error', `Pedido #${id} no encontrado o no está EN DELIVERY.`);
      toast({
        variant: "destructive",
        title: "Pedido no encontrado",
        description: `No se encontró el pedido #${id} en los repartos activos en estado EN DELIVERY.`
      });
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processQRCode(inputValue);
    }
  };

  const handleContainerClick = () => {
    if (inputRef.current && scanStatus === 'idle') {
      inputRef.current.focus();
    }
  };

  const clearList = () => {
    if (window.confirm('¿Está seguro de limpiar la lista de rendiciones de esta sesión?')) {
      setScannedSales([]);
      setSessionStartTime(Date.now());
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const finishSession = () => {
    setScannedSales([]);
    setSessionStartTime(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && finishSession()}>
      <DialogContent className={`${hideRightPane ? 'sm:max-w-md' : 'sm:max-w-4xl'} p-0 overflow-hidden`} onClick={handleContainerClick}>
        <div className={`flex flex-col ${hideRightPane ? '' : 'lg:flex-row h-[85vh] lg:h-[600px]'}`}>
          
          {/* Left Column: Scanner */}
          <div className={`flex-1 p-6 bg-gray-50 flex flex-col ${hideRightPane ? 'h-[500px]' : 'border-b lg:border-b-0 lg:border-r'} border-gray-200`}>
            <DialogHeader className="mb-6">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <QrCode className="w-6 h-6 text-primary" />
                {customTitle || 'Rendición Continua'}
              </DialogTitle>
              <DialogDescription>
                {customDescription || 'Escanee códigos QR sin cerrar esta ventana.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 flex flex-col items-center justify-center space-y-6">
              <div className="relative w-full aspect-square max-w-[280px] bg-gray-900 rounded-lg overflow-hidden border-4 shadow-inner flex items-center justify-center">
                {cameraError ? (
                  <div className="flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                    <CameraOff className="w-12 h-12 mb-2 opacity-50" />
                    <p className="text-sm font-medium">Sin acceso a la cámara</p>
                    <p className="text-xs mt-1 opacity-70">Use el lector manual debajo</p>
                  </div>
                ) : (
                  <>
                    <video 
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      playsInline
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    
                    {scanStatus === 'idle' && (
                      <motion.div 
                        className="absolute top-0 left-0 w-full h-0.5 bg-primary/70 shadow-[0_0_8px_2px_rgba(234,88,12,0.6)]"
                        animate={{ y: [0, 280, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      />
                    )}
                    
                    <AnimatePresence>
                      {scanStatus === 'success' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-green-500/90 flex flex-col items-center justify-center text-white backdrop-blur-sm"
                        >
                          <motion.div
                            initial={{ scale: 0.5 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring" }}
                          >
                            <CheckCircle2 className="w-20 h-20 mb-3 drop-shadow-md" />
                          </motion.div>
                          <span className="font-bold text-center px-4 text-lg drop-shadow-sm">{statusMessage}</span>
                        </motion.div>
                      )}
                      {scanStatus === 'error' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-red-500/90 flex flex-col items-center justify-center text-white backdrop-blur-sm"
                        >
                          <motion.div
                            initial={{ scale: 0.5 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring" }}
                          >
                            <XCircle className="w-20 h-20 mb-3 drop-shadow-md" />
                          </motion.div>
                          <span className="font-bold text-center px-4 text-sm drop-shadow-sm">{statusMessage}</span>
                        </motion.div>
                      )}
                      {scanStatus === 'processing' && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white backdrop-blur-sm"
                        >
                          <Loader2 className="w-12 h-12 mb-3 animate-spin" />
                          <span className="font-bold text-center px-4 text-sm">{statusMessage}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </div>

              <div className="relative w-full max-w-xs">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <Keyboard className="w-5 h-5 text-gray-400" />
                </div>
                <Input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={scanStatus === 'processing'}
                  placeholder="Ingreso manual..."
                  className="pl-10 h-12 text-lg text-center font-medium bg-white border-2 border-primary/20 focus-visible:border-primary focus-visible:ring-primary shadow-sm"
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          {/* Right Column: List and Summary */}
          {!hideRightPane && (
            <div className="flex-1 flex flex-col bg-white">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
                <h3 className="font-semibold text-gray-800">Rendiciones Exitosas</h3>
                <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full">
                  {scannedSales.length} items
                </span>
              </div>
              
              <ScrollArea className="flex-1 p-4 bg-gray-100/50">
                {scannedSales.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 py-10">
                    <CheckSquare className="w-12 h-12 mb-3 opacity-20" />
                    <p>No hay pedidos escaneados en esta sesión.</p>
                    <p className="text-sm mt-1">Escanee un QR para comenzar.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <AnimatePresence>
                      {scannedSales.map(sale => (
                        <ScannedSaleItem key={sale.id} sale={sale} />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </ScrollArea>

              <div className="p-4 border-t border-gray-200 bg-white">
                <ScannedSalesSummary scannedSales={scannedSales} sessionStartTime={sessionStartTime} />
                
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <Button variant="outline" onClick={clearList} disabled={scannedSales.length === 0} className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Limpiar Lista
                  </Button>
                  <Button onClick={finishSession} className="w-full bg-primary hover:bg-primary/90 text-white">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Finalizar Sesión
                  </Button>
                </div>
              </div>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QRScannerModal;