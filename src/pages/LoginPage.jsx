import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, KeyRound, User, Calendar, Info } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { getOperationalDate, formatDateForFirebase, parseDateString } from '@/lib/utils';
import { checkOpenShift } from '@/lib/api/cash/shift';
import { getLatestCashRegisterDate, fetchCashRegisterData } from '@/lib/api/cash/data';

const LoginPage = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [shiftStatus, setShiftStatus] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    const initCashRegisterDate = async () => {
      try {
        // 1. Get current date
        const today = getOperationalDate(new Date());
        const todayStr = formatDateForFirebase(today);
        
        // 2. Fetch open shift data and extract its date
        const openShift = await checkOpenShift().catch(() => null); // catch in case not authenticated yet
        const latestCashDate = await getLatestCashRegisterDate().catch(() => null);
        
        let displayDate = todayStr;
        let cashData = null;
        let isToday = false;
        
        if (openShift) {
           // 3. Compare open shift date with current system date
           if (openShift.date === todayStr) {
             displayDate = todayStr;
             isToday = true;
             // If open shift exists and its date equals today, fetch cash register for today
             cashData = await fetchCashRegisterData(today, openShift.id, true).catch(() => null);
           } else {
             displayDate = openShift.date;
             // Edge case: if shift is open today but cash register is from yesterday, fetch that specific register data
             cashData = await fetchCashRegisterData(parseDateString(openShift.date), openShift.id, true).catch(() => null);
           }
        } else {
           // Verify that the returned cash register date matches today's date
           if (latestCashDate === todayStr) {
              displayDate = todayStr;
           } else {
              displayDate = todayStr; // Always sync with today when no shift is explicitly open
           }
        }

        setShiftStatus({
           isOpen: !!openShift,
           isToday: isToday,
           date: displayDate,
           shiftId: openShift ? openShift.id : null,
           text: openShift 
            ? `Caja abierta (${displayDate}) - Turno ${openShift.id}` 
            : `Sistema listo (Fecha: ${displayDate})`
        });
      } catch (error) {
         console.error("Error checking cash register date:", error);
      }
    };
    
    initCashRegisterDate();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      toast({
        variant: 'destructive',
        title: 'Campos requeridos',
        description: 'Por favor, ingrese su usuario y contraseña.',
      });
      return;
    }
    setIsLoading(true);
    const success = await onLogin(username, password);
    if (!success) {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-200">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm p-8 space-y-6 bg-white rounded-2xl shadow-xl"
      >
        <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center bg-orange-500 rounded-full p-4 mb-2">
                 <span className="text-white font-bold text-4xl">DLV</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Iniciar Sesión</h1>
            <p className="text-gray-500">Bienvenido al sistema de gestión</p>
        </div>

        {shiftStatus && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`px-3 py-2.5 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${
              shiftStatus.isOpen 
                ? (shiftStatus.isToday ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200')
                : 'bg-blue-50 text-blue-800 border-blue-200'
            }`}
          >
            {shiftStatus.isOpen && !shiftStatus.isToday ? <Info className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
            {shiftStatus.text}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20}/>
              <Input
                id="username"
                type="text"
                placeholder="Usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-10"
                required
                autoComplete="off"
              />
            </div>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20}/>
              <Input
                id="password"
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10"
                required
                autoComplete="off"
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Ingresando...
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
        </form>
      </motion.div>
    </div>
  );
};

export default LoginPage;