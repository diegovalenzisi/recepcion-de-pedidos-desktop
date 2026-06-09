import React from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ScannedSaleItem({ sale }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-3 mb-2 rounded-lg border-2 border-success bg-success-light flex justify-between items-center shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 animate-checkmark-pop">
          <CheckCircle2 className="w-6 h-6 text-success-dark" />
        </div>
        <div>
          <div className="font-bold text-gray-900">Pedido #{sale.id}</div>
          <div className="text-sm text-gray-700">{sale.client?.name || 'Cliente sin nombre'}</div>
          <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
            <Clock className="w-3 h-3" />
            {new Date(sale.scannedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-bold text-lg text-success-dark">
          ${sale.payment?.total || sale.payment?.amount || 0}
        </div>
        <div className="text-xs font-medium text-success-dark uppercase tracking-wider">
          Entregado
        </div>
      </div>
    </motion.div>
  );
}