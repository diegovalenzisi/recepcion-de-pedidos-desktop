import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, Building, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getFirebaseUrl } from '@/lib/firebase/core';

const ACCESS_KEY = "MoniDiego2908";

function LocalIdSetup({ onSetupComplete }) {
  const [step, setStep] = useState('localId'); // 'localId' or 'password'
  const [localId, setLocalId] = useState('');
  const [password, setPassword] = useState('');
  const [verifiedLocalName, setVerifiedLocalName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLocalIdSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d+$/.test(localId)) {
      setError('El número de local solo debe contener dígitos.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${getFirebaseUrl()}/LOCALES/${localId}.json`);
      if (!response.ok) {
        throw new Error('Error de red al verificar el local.');
      }
      const data = await response.json();

      if (data) {
        setVerifiedLocalName(data);
        setStep('password');
      } else {
        setError('ERROR AL INTENTAR ABRIR LOCAL');
      }
    } catch (err) {
      setError(err.message || 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Simulating a check
    setTimeout(() => {
      if (password === ACCESS_KEY) {
        onSetupComplete(localId, verifiedLocalName);
      } else {
        setError('Clave de acceso incorrecta.');
        setLoading(false);
      }
    }, 500);
  };

  const formVariants = {
    hidden: { opacity: 0, x: -50 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 50 },
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 to-gray-700 text-white">
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 100, duration: 0.5 }}
        className="w-full max-w-md p-8 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 overflow-hidden"
      >
        <AnimatePresence mode="wait">
          {step === 'localId' && (
            <motion.div
              key="localId"
              variants={formVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-8">
                <Building className="mx-auto h-16 w-16 text-orange-400 mb-4" />
                <h1 className="text-3xl font-bold">Configuración Inicial</h1>
                <p className="text-white/80 mt-2">Por favor, ingrese el número de su local para comenzar.</p>
              </div>
              <form onSubmit={handleLocalIdSubmit} className="space-y-6">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-orange-300" />
                  <Input
                    type="text"
                    value={localId}
                    onChange={(e) => setLocalId(e.target.value)}
                    placeholder="Número de Local"
                    className="pl-10 h-12 text-lg bg-white/10 text-white placeholder-white/50 border-white/30 focus:ring-orange-500 focus:border-orange-500"
                    autoFocus
                  />
                </div>
                {error && <p className="text-red-400 text-sm text-center font-bold">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 text-lg font-bold bg-orange-500 hover:bg-orange-600 transition-all duration-300 shadow-lg"
                >
                  {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'Verificar Local'}
                </Button>
              </form>
            </motion.div>
          )}

          {step === 'password' && (
            <motion.div
              key="password"
              variants={formVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-8">
                <Lock className="mx-auto h-16 w-16 text-orange-400 mb-4" />
                <h1 className="text-3xl font-bold">Clave de Acceso</h1>
                <p className="text-white/80 mt-2">Local: <span className="font-bold">{verifiedLocalName}</span></p>
              </div>
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-orange-300" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Clave de Acceso"
                    className="pl-10 h-12 text-lg bg-white/10 text-white placeholder-white/50 border-white/30 focus:ring-orange-500 focus:border-orange-500"
                    autoFocus
                  />
                </div>
                {error && <p className="text-red-400 text-sm text-center font-bold">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 text-lg font-bold bg-orange-500 hover:bg-orange-600 transition-all duration-300 shadow-lg"
                >
                  {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'Ingresar'}
                </Button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default LocalIdSetup;