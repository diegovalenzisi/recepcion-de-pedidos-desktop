import React from 'react';
import { motion } from 'framer-motion';
import { HardHat } from 'lucide-react';

const HRAccountsTab = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col items-center justify-center h-full text-center bg-white rounded-xl shadow-xl"
    >
      <HardHat className="w-24 h-24 text-orange-500 mb-4" />
      <h1 className="text-3xl font-bold text-gray-800">Página en Construcción</h1>
      <p className="mt-2 text-lg text-gray-600">
        La sección de Cuentas de Empleados se encuentra actualmente en desarrollo.
      </p>
      <p className="mt-1 text-gray-500">
        Pronto podrás dar de alta y gestionar las cuentas de tu personal aquí.
      </p>
    </motion.div>
  );
};

export default HRAccountsTab;