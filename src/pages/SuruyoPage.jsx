import React from 'react';
import { motion } from 'framer-motion';
import { HardHat } from 'lucide-react';

const SuruyoPage = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col items-center justify-center h-full text-center"
    >
      <HardHat className="w-24 h-24 text-orange-500 mb-4" />
      <h1 className="text-3xl font-bold text-gray-800">Página en Construcción</h1>
      <p className="mt-2 text-lg text-gray-600">
        Esta sección ha sido renombrada a "Gastos".
      </p>
    </motion.div>
  );
};

export default SuruyoPage;