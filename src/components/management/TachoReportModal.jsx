import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { sendTachoReport } from '@/lib/api/managementApi';

const TachoReportModal = ({ isOpen, onClose, tachos }) => {
  const [reportData, setReportData] = useState({
    pozo1: '',
    pozo2: '',
    delivery: '',
    heladeras: '',
  });
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setReportData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSending(true);
    try {
      await sendTachoReport(reportData, tachos);
      toast({
        title: "¡Reporte Enviado!",
        description: "El reporte de tachos se guardó correctamente.",
      });
      onClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al Enviar",
        description: `No se pudo guardar el reporte. ${error.message}`,
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: -50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: -50 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="bg-white rounded-xl shadow-2xl m-4 p-8 w-full max-w-md relative"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="ghost" size="icon" className="absolute top-4 right-4 text-gray-500 hover:text-gray-800" onClick={onClose}>
            <X className="h-6 w-6" />
          </Button>
          
          <h3 className="text-2xl font-bold mb-6 text-gray-800 text-center">Enviar Reporte de Tachos</h3>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <Label htmlFor="pozo1" className="text-gray-700 font-medium">Tachos Pozo 1:</Label>
              <Input
                id="pozo1"
                name="pozo1"
                type="text"
                value={reportData.pozo1}
                onChange={handleChange}
                className="mt-2"
                placeholder=""
              />
            </div>
            <div>
              <Label htmlFor="pozo2" className="text-gray-700 font-medium">Tachos Pozo 2:</Label>
              <Input
                id="pozo2"
                name="pozo2"
                type="text"
                value={reportData.pozo2}
                onChange={handleChange}
                className="mt-2"
                placeholder=""
              />
            </div>
            <div>
              <Label htmlFor="delivery" className="text-gray-700 font-medium">Tachos Delivery:</Label>
              <Input
                id="delivery"
                name="delivery"
                type="text"
                value={reportData.delivery}
                onChange={handleChange}
                className="mt-2"
                placeholder=""
              />
            </div>
            <div>
              <Label htmlFor="heladeras" className="text-gray-700 font-medium">Espacios Heladeras:</Label>
              <Input
                id="heladeras"
                name="heladeras"
                type="text"
                value={reportData.heladeras}
                onChange={handleChange}
                className="mt-2"
                placeholder=""
              />
            </div>
            
            <div className="flex justify-end pt-4">
              <motion.button
                type="submit"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="btn-primary flex items-center space-x-2"
                disabled={isSending}
              >
                {isSending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
                <span>{isSending ? 'Enviando...' : 'Enviar'}</span>
              </motion.button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TachoReportModal;