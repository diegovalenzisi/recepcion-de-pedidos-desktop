import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { CameraOff, Loader2, QrCode, MessageCircle, Clock, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { playBeep } from '@/lib/audio/beepSound';
import { useToast } from '@/components/ui/use-toast';

export default function QROrderScannerForDelivery({ 
  onScan, 
  isProcessing, 
  scannerState = 'scanning', 
  onResumeScanning,
  onClose 
}) {
  const [cameraError, setCameraError] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [scanFeedback, setScanFeedback] = useState(null); 
  const { toast } = useToast();
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const requestRef = useRef(null);
  const inputRef = useRef(null);
  const feedbackTimeout = useRef(null);

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

    if (isProcessing || scanFeedback || scannerState !== 'scanning') {
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
        handleCodeDetected(code.data);
      }
    }
    
    requestRef.current = requestAnimationFrame(tick);
  }, [isProcessing, scanFeedback, scannerState]);

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
    if (scannerState === 'scanning') {
      startCamera();
    } else {
      stopCamera();
    }
    const timer = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 100);
    return () => {
      clearTimeout(timer);
      stopCamera();
    };
  }, [scannerState, startCamera, stopCamera]);

  const handleCodeDetected = async (codeData) => {
    const id = codeData.trim();
    if (!id || scannerState !== 'scanning') return;

    try {
      playBeep();
      // Delegamos TODO el flujo (incluido WhatsApp) al componente padre para centralizar la lógica
      await onScan(id);
      showFeedback('success');
    } catch (error) {
      if (error.message && error.message.includes('EN DELIVERY')) {
        toast({ variant: 'destructive', title: 'Error de Validación', description: error.message });
      }
      showFeedback('error');
    }
  };

  const showFeedback = (type) => {
    setScanFeedback(type);
    if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
    feedbackTimeout.current = setTimeout(() => {
      setScanFeedback(null);
      if (inputRef.current && scannerState === 'scanning') inputRef.current.focus();
    }, 1500);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCodeDetected(inputValue);
      setInputValue('');
    }
  };

  const getBorderClass = () => {
    switch (scannerState) {
      case 'opening_whatsapp': return 'scanner-state-whatsapp';
      case 'waiting_return': return 'scanner-state-waiting';
      default: return 'scanner-state-scanning';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-4 w-full relative">
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute -top-12 right-0 rounded-full bg-white/10 hover:bg-white/20 text-gray-500 hover:text-gray-700 h-8 w-8 z-50 transition-colors"
          title="Cerrar escáner"
        >
          <X className="h-5 w-5" />
        </Button>
      )}

      <div className={`relative w-full aspect-square max-w-[280px] bg-gray-900 rounded-lg overflow-hidden border-4 shadow-inner flex items-center justify-center transition-all duration-500 ${getBorderClass()}`}>
        {cameraError && scannerState === 'scanning' ? (
          <div className="flex flex-col items-center justify-center text-gray-400 p-4 text-center">
            <CameraOff className="w-12 h-12 mb-2 opacity-50" />
            <p className="text-sm font-medium">Sin acceso a la cámara</p>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef}
              className={`w-full h-full object-cover ${scannerState !== 'scanning' ? 'opacity-20 blur-sm' : ''}`}
              playsInline
            />
            <canvas ref={canvasRef} className="hidden" />
            
            {!isProcessing && !scanFeedback && scannerState === 'scanning' && (
              <motion.div 
                className="absolute top-0 left-0 w-full h-0.5 bg-blue-500 shadow-[0_0_8px_2px_rgba(59,130,246,0.8)]"
                animate={{ y: [0, 280, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
            )}

            <AnimatePresence>
              {isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white backdrop-blur-sm"
                >
                  <Loader2 className="w-10 h-10 animate-spin mb-2" />
                  <span className="text-sm font-semibold">Procesando...</span>
                </motion.div>
              )}
              
              {scannerState === 'opening_whatsapp' && !isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-state-whatsapp flex flex-col items-center justify-center text-white backdrop-blur-sm z-10"
                >
                  <MessageCircle className="w-12 h-12 animate-pulse mb-3" />
                  <span className="text-lg font-bold text-center px-4">Abriendo WhatsApp...</span>
                </motion.div>
              )}

              {scannerState === 'waiting_return' && !isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-state-waiting flex flex-col items-center justify-center text-white backdrop-blur-sm z-10 cursor-pointer"
                  onClick={onResumeScanning}
                >
                  <Clock className="w-12 h-12 mb-3 opacity-80" />
                  <span className="text-lg font-bold text-center px-4 mb-2">Esperando retorno</span>
                  <span className="text-xs bg-white/20 px-3 py-1 rounded-full">Tocar para escanear otro</span>
                </motion.div>
              )}

              {scanFeedback === 'success' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-green-500/90 flex flex-col items-center justify-center text-white backdrop-blur-sm z-20"
                >
                  <span className="text-lg font-bold">¡Asignado!</span>
                </motion.div>
              )}
              {scanFeedback === 'error' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-red-500/90 flex flex-col items-center justify-center text-white backdrop-blur-sm z-20"
                >
                  <span className="text-lg font-bold">Error</span>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      <div className="relative w-full max-w-[280px]">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <QrCode className="w-5 h-5 text-gray-400" />
        </div>
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isProcessing || scannerState !== 'scanning'}
          placeholder="Ingresar # de pedido..."
          className="pl-10 h-12 text-center font-medium bg-white border-2 focus-visible:ring-blue-500 shadow-sm"
          autoComplete="off"
        />
      </div>
    </div>
  );
}