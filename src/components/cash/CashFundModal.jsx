import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DollarSign, Loader2, Send, Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { formatDateForFirebase, getOperationalDate } from '@/lib/utils';

function CashFundModal({ isOpen, onFundSet, shift, isEditable, onClose, isInitialSetup = false }) {
  const [amount, setAmount] = useState('');
  // Capa 3: fecha de negocio (corte 2 AM), no calendario cruda. Un turno abierto entre 00:00 y
  // 01:59 debe quedar bajo la fecha del día anterior, igual que ventas/backup/pantalla de Cajas.
  const [date, setDate] = useState(() => getOperationalDate(new Date()));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isEditable && shift && shift.fondoInicial !== undefined && shift.fondoInicial !== null) {
      setAmount(shift.fondoInicial.toString());
    } else {
      setAmount('');
    }
    if (isInitialSetup) {
      setDate(getOperationalDate(new Date()));
    }
  }, [shift, isOpen, isEditable, isInitialSetup]);

  const handleSave = async (e) => {
    e.preventDefault();
    const fundAmount = parseFloat(amount);
    if (isNaN(fundAmount) || fundAmount < 0) {
      toast({
        variant: "destructive",
        title: "Monto inválido",
        description: "Por favor, ingresa un fondo de caja válido (puede ser 0).",
      });
      return;
    }
    setSaving(true);
    try {
      if (isInitialSetup) {
        await onFundSet(fundAmount, date);
        toast({
          title: `¡Nuevo turno iniciado!`,
          description: `El fondo para el nuevo turno es ${fundAmount.toFixed(2)}.`,
          className: "bg-green-500 text-white",
        });
      } else {
        await onFundSet(fundAmount);
        toast({
          title: `¡Fondo de caja actualizado!`,
          description: `El fondo para el turno #${shift?.id} es ahora ${fundAmount.toFixed(2)}.`,
          className: "bg-green-500 text-white",
        });
      }
      if (onClose) {
        onClose();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudo completar la operación. Inténtalo de nuevo.",
      });
    } finally {
      setSaving(false);
    }
  };
  
  const handleOverlayClick = (e) => {
    if (!isInitialSetup && onClose) {
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={handleOverlayClick}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-8">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-orange-100 rounded-full mx-auto flex items-center justify-center mb-4">
                  <DollarSign className="w-8 h-8 text-orange-500" />
                </div>
                <h2 className="text-3xl font-bold text-gray-800">{isInitialSetup ? 'Iniciar Nuevo Turno' : 'Gestionar Fondo de Caja'}</h2>
                <p className="text-gray-500 mt-2">
                  {isInitialSetup
                    ? `No hay un turno activo. Ingresa el fondo inicial para comenzar uno nuevo.`
                    : `Modifica el fondo de caja para el turno #${shift?.id}.`}
                </p>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                {isInitialSetup && (
                  <div className="space-y-2">
                    <Label htmlFor="shift-date" className="text-lg font-semibold text-gray-700">Fecha del Turno</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className="w-full justify-start text-left font-normal h-14 text-lg"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {date ? formatDateForFirebase(date) : <span>Seleccione una fecha</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={date}
                          onSelect={setDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="cash-fund" className="text-lg font-semibold text-gray-700">Monto</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <Input
                      id="cash-fund"
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pl-10 pr-4 py-3 text-2xl h-auto text-center font-bold bg-gray-50"
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  {!isInitialSetup && onClose && (
                    <Button type="button" variant="outline" onClick={onClose} className="w-full h-14 text-xl font-bold">
                        Cancelar
                    </Button>
                  )}
                  <Button type="submit" disabled={saving} className="w-full h-14 text-xl font-bold bg-green-500 hover:bg-green-600 text-white">
                    {saving ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <Send className="mr-3 h-6 w-6" />}
                    {saving ? 'Guardando...' : 'Confirmar'}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default CashFundModal;