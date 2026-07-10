import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DollarSign, Loader2, Send, Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatDateForFirebase } from '@/lib/utils';

// Fecha LOCAL actual del sistema (calendario), a medianoche local. Es el valor por defecto al
// abrir "Iniciar Nuevo Turno". Usa getFullYear/getMonth/getDate (locales) — NO toISOString (que
// puede correr el día por zona horaria) NI el corte de 2 AM de la fecha operativa: un turno nuevo
// debe sugerir SIEMPRE el día actual del sistema (a las 00:28 del 10/07 → 10-07, no 09-07).
const getLocalTodayDate = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

function CashFundModal({ isOpen, onFundSet, shift, isEditable, onClose, isInitialSetup = false }) {
  const [amount, setAmount] = useState('');
  // Valor por defecto: fecha LOCAL actual del sistema (calendario), no la fecha operativa con
  // corte 2 AM. A las 00:28 del 10/07 debe sugerir 10-07 (no 09-07). El usuario puede cambiarla.
  const [date, setDate] = useState(() => getLocalTodayDate());
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Solo pasa a true si el usuario elige una fecha manualmente en el calendario. Mientras sea
  // false, la fecha sugerida se mantiene sincronizada con la fecha actual del sistema para que
  // NUNCA arrastre el día anterior (p. ej. si la PC quedó prendida de un día para el otro).
  const dateTouched = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isEditable && shift && shift.fondoInicial !== undefined && shift.fondoInicial !== null) {
      setAmount(shift.fondoInicial.toString());
    } else {
      setAmount('');
    }
    if (isInitialSetup && isOpen) {
      // Al abrir el modal de nuevo turno, sugerir SIEMPRE la fecha local actual del sistema.
      setDate(getLocalTodayDate());
      dateTouched.current = false;
    }
  }, [shift, isOpen, isEditable, isInitialSetup]);

  // Si el modal queda abierto y la ventana recupera el foco / vuelve a estar visible (caso típico:
  // la PC quedó prendida toda la noche), re-sincronizar la fecha sugerida con la actual del
  // sistema, salvo que el usuario ya la haya cambiado a mano.
  useEffect(() => {
    if (!isOpen || !isInitialSetup) return;
    const refresh = () => {
      if (!dateTouched.current) setDate(getLocalTodayDate());
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isOpen, isInitialSetup]);

  // Ejecuta el guardado real. Para un turno nuevo se llama SOLO después de confirmar la fecha.
  const doSave = async () => {
    const fundAmount = parseFloat(amount);
    setSaving(true);
    try {
      if (isInitialSetup) {
        await onFundSet(fundAmount, date);
        toast({
          title: `¡Nuevo turno iniciado!`,
          description: `Fecha de caja ${formatDateForFirebase(date)} · Fondo ${fundAmount.toFixed(2)}.`,
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
      setConfirmOpen(false);
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

  const handleSubmit = (e) => {
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
    if (isInitialSetup) {
      // Si el usuario no cambió la fecha manualmente, tomar la fecha local actual del sistema
      // fresca en este mismo instante (no la que quedó congelada al montar el modal). Luego
      // obligar a confirmar la fecha de caja antes de crear el turno.
      if (!dateTouched.current) setDate(getLocalTodayDate());
      setConfirmOpen(true);
      return;
    }
    doSave();
  };
  
  const handleOverlayClick = (e) => {
    if (!isInitialSetup && onClose) {
      onClose();
    }
  }

  return (
    <>
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

              <form onSubmit={handleSubmit} className="space-y-6">
                {isInitialSetup && (
                  <div className="space-y-2">
                    <Label htmlFor="shift-date" className="text-lg font-semibold text-gray-700">Fecha de caja</Label>
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
                          onSelect={(d) => { if (d) { setDate(d); dateTouched.current = true; } }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <p className="text-sm text-gray-500">
                      Por defecto es la fecha actual del sistema. Cambiala solo si necesitás abrir el turno con otra fecha.
                    </p>
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

    {/* Confirmación obligatoria de la fecha de caja antes de crear un turno nuevo. */}
    <AlertDialog open={confirmOpen} onOpenChange={(v) => { if (!v && !saving) setConfirmOpen(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar fecha de caja</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a abrir un turno nuevo con fecha de caja{' '}
            <strong>{date ? formatDateForFirebase(date) : ''}</strong>. ¿Es correcto?
            Si no, tocá "Cambiar fecha" y elegí otra en el calendario.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setConfirmOpen(false)}>
            Cambiar fecha
          </Button>
          <Button disabled={saving} onClick={doSave} className="bg-green-500 hover:bg-green-600 text-white">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {saving ? 'Abriendo...' : 'Confirmar y abrir turno'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

export default CashFundModal;