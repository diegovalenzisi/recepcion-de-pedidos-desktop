import React from 'react';
import { motion } from 'framer-motion';
import { Construction } from 'lucide-react';

const PlaceholderPage = ({ title }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="h-full bg-white rounded-xl shadow-xl flex flex-col items-center justify-center text-center p-8"
    >
      <Construction className="w-24 h-24 text-orange-400 mb-6" />
      <h1 className="text-4xl font-bold text-gray-800 mb-2">{title}</h1>
      <p className="text-lg text-gray-600">Esta sección está en construcción.</p>
      <p className="text-gray-500 mt-1">¡Vuelve pronto para ver las novedades!</p>
    </motion.div>
  );
};

export default PlaceholderPage;