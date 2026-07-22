import React, { memo, useState } from 'react';
import { 
  PlusCircle, RefreshCw, Edit, MessageSquare, Edit3, Send,
  BookUser, QrCode, RotateCcw, Truck, Search, 
  DivideSquare, Loader2, Snowflake
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import QROptionsModal from '@/components/attention/QROptionsModal';
import DeliveryQRFlowManager from '@/components/attention/DeliveryQRFlowManager';
import { useToast } from '@/components/ui/use-toast';
import { useThemeButtonColors } from '@/hooks/useThemeButtonColors';

const actionButtons = [
  { label: 'Pedido nuevo', icon: PlusCircle, id: 'new_order' },
  { label: 'Actualizar', icon: RefreshCw, id: 'refresh' },
  { label: 'Modif. Pedido', icon: Edit, id: 'edit_order' },
  { label: 'Whatsapp', icon: MessageSquare, id: 'whatsapp' },
  { label: 'Modif. Estado', icon: Edit3, id: 'edit_status' },
  { label: 'Comandar', icon: Send, id: 'command' },
  { label: 'Asignar Rep.', icon: BookUser, id: 'assign_deliverer' },
  { label: 'Leer QR', icon: QrCode, id: 'read_qr' },
  { label: 'Regresa Rep.', icon: RotateCcw, id: 'deliverer_returns' },
  { label: 'Entregado', icon: Truck, id: 'delivered' },
  { label: 'Buscar #', icon: Search, id: 'search' },
  { label: 'Div. For. Pag.', icon: DivideSquare, id: 'split_payment' },
];

const DeliveryActionBar = memo(({ 
  onActionClick, 
  onToggleHeladera,
  onAssignDeliverer,
  onDelivererReturn,
  onQRScannerOpen,
  onQRAssignDeliverer,
  processingAction = 'none', 
  selectedOrderId,
  selectedOrder,
  currentShift,
  hasDeliverers = false,
  viewMode = 'table',
  onViewModeChange,
  optimisticUpdate,
  settings
}) => {
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isQRAssignmentFlowOpen, setIsQRAssignmentFlowOpen] = useState(false);
  const [selectedDelivererForQR, setSelectedDelivererForQR] = useState(null);
  const { toast } = useToast();
  
  // Use the hook to get theme-aware button styling
  const { getButtonClass, getBgClass } = useThemeButtonColors();
  
  const hasSelection = !!selectedOrderId;
  const isShiftOpen = currentShift?.estado === 'abierto';
  const isHeladera = selectedOrder?.heladera === 'SI';

  const isEnabled = (id) => {
    switch (id) {
      case 'new_order': 
        return isShiftOpen;
      case 'refresh': 
        return true;
      case 'search': 
        return true;
      case 'deliverer_returns': 
        return isShiftOpen;
      case 'read_qr':
        return isShiftOpen;
      case 'assign_deliverer': 
        return isShiftOpen && hasSelection && hasDeliverers;
      case 'whatsapp':
        return hasSelection;
      case 'fridge':
        return isShiftOpen && hasSelection;
      default: 
        return isShiftOpen && hasSelection; 
    }
  };

  const handleQRSelect = (action, data = null) => {
    setIsQRModalOpen(false);
    if (action === 'assign') {
      setSelectedDelivererForQR(data);
      setIsQRAssignmentFlowOpen(true);
    } else if (action === 'deliver') {
      onQRScannerOpen();
    }
  };

  const handleReopenSelectDeliverer = () => {
    setIsQRAssignmentFlowOpen(false);
    setIsQRModalOpen(true);
  };

  const handleActionClickInternal = (btnId) => {
    if (btnId === 'read_qr') {
      setIsQRModalOpen(true);
      return;
    }
    
    onActionClick(btnId);
  };

  return (
    <>
      <div className="w-52 flex-shrink-0 bg-gray-50 p-2 rounded-lg border border-gray-200 flex flex-col transition-all duration-200 h-full">
        <div className="grid grid-cols-2 gap-2 flex-grow-0 mb-3">
          {actionButtons.map(btn => {
            const isLoading = processingAction === btn.id;
            const enabled = isEnabled(btn.id);
            
            // Get theme-aware button class from the hook
            // This now dynamically uses the current theme's primary color
            const buttonClass = getButtonClass(enabled, false);
            
            return (
              <Button 
                key={btn.id} 
                variant="outline"
                onClick={() => enabled && handleActionClickInternal(btn.id)}
                disabled={isLoading} 
                className={cn(
                  "flex flex-col items-center justify-center h-auto min-h-[4rem] p-1.5 space-y-1",
                  "shadow-sm transition-colors duration-200",
                  buttonClass,
                  isLoading && "opacity-70 cursor-not-allowed"
                )}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <btn.icon className="h-5 w-5 flex-shrink-0" />
                )}
                <span className="text-[11px] font-medium text-center leading-3 w-full break-words whitespace-normal">
                  {btn.label}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="mb-3">
          <Button
            variant={isHeladera ? "default" : "outline"}
            onClick={() => isEnabled('fridge') && onToggleHeladera(selectedOrderId)}
            disabled={!isEnabled('fridge')}
            className={cn(
              "w-full flex items-center justify-center gap-2 h-10 py-2 px-4 font-bold text-xs uppercase tracking-wide transition-all duration-200",
              !isEnabled('fridge') 
                ? "bg-gray-300 text-gray-500 cursor-not-allowed border-gray-200"
                : isHeladera
                  ? "bg-cyan-500 hover:bg-cyan-600 text-white shadow-md hover:shadow-lg border-cyan-600 ring-2 ring-cyan-300 ring-offset-1"
                  : "bg-white hover:bg-cyan-50 text-cyan-600 border-cyan-200 shadow-sm"
            )}
          >
            <Snowflake className={cn("h-4 w-4", isHeladera && "animate-pulse")} />
            EN HELADERA
          </Button>
        </div>

        {/* Pie "Gestión de Envíos" (separador decorativo + texto) ocultado a pedido. */}
      </div>

      <QROptionsModal 
        isOpen={isQRModalOpen}
        onOpenChange={setIsQRModalOpen}
        onAssignDeliverer={(deliverer) => handleQRSelect('assign', deliverer)}
        onQRScannerOpen={() => handleQRSelect('deliver')}
      />

      <DeliveryQRFlowManager 
        isOpen={isQRAssignmentFlowOpen}
        onClose={() => setIsQRAssignmentFlowOpen(false)}
        currentShift={currentShift}
        optimisticUpdate={optimisticUpdate}
        initialDeliverer={selectedDelivererForQR}
        onChangeDeliverer={handleReopenSelectDeliverer}
        settings={settings}
      />
    </>
  );
});

DeliveryActionBar.displayName = 'DeliveryActionBar';

export default DeliveryActionBar;