import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { RefreshCw, Bell } from 'lucide-react';

const UpdateNotification = ({ show, onUpdate }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.3 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.9 }}
          transition={{ duration: 0.5, type: 'spring' }}
          className="fixed bottom-4 right-4 z-[100]"
        >
          <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-2xl flex items-center space-x-4 border border-gray-200 dark:border-gray-700">
            <div className="flex-shrink-0">
              <Bell className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-gray-900 dark:text-white">¡Actualización disponible!</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Hay una nueva versión de la aplicación lista.</p>
            </div>
            <Button onClick={onUpdate}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Recargar
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UpdateNotification;