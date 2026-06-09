import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

const ActionButton = ({ label, icon: Icon, onClick, disabled }) => (
  <motion.button
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.9 }}
    onClick={onClick}
    disabled={disabled}
    className="flex flex-col items-center justify-center space-y-1 text-center disabled:opacity-50 disabled:cursor-not-allowed w-full h-full"
  >
    <div className="w-10 h-10 bg-gray-100 border rounded-lg flex items-center justify-center text-gray-700 shadow-sm hover:bg-primary hover:text-primary-foreground transition-colors group">
      {disabled ? <Loader2 size={20} className="animate-spin" /> : <Icon size={20} className="transition-transform group-hover:scale-110" />}
    </div>
    <span className="text-[10px] font-semibold text-gray-600 leading-tight px-1">{label}</span>
  </motion.button>
);

export default ActionButton;