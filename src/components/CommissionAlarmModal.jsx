
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

const formatCurrency = (v) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0);

const CommissionAlarmModal = ({ isOpen, alarmAmount, cutoffLimit, onAccept }) => (
  <Dialog open={isOpen} onOpenChange={() => {}}>
    <DialogContent
      onPointerDownOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => e.preventDefault()}
      className="max-w-sm"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-orange-600">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          Aviso de Comisión
        </DialogTitle>
      </DialogHeader>
      <p className="text-sm text-gray-700 py-4 leading-relaxed">
        Por favor realice el pago de{' '}
        <span className="font-bold text-orange-700">{formatCurrency(alarmAmount)}</span>{' '}
        antes de que el sistema llegue a{' '}
        <span className="font-bold text-orange-700">{formatCurrency(cutoffLimit)}</span>{' '}
        y se bloquee, Gracias!!
      </p>
      <DialogFooter>
        <Button onClick={onAccept} className="w-full bg-orange-600 hover:bg-orange-700">
          Aceptar
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default CommissionAlarmModal;
