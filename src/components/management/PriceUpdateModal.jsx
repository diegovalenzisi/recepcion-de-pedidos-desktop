import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePriceUpdates } from '@/hooks/usePriceUpdates';
import ImmediatePriceUpdateTab from '@/components/management/ImmediatePriceUpdateTab';
import ScheduledPriceUpdateTab from '@/components/management/ScheduledPriceUpdateTab';
import CSVImportModal from '@/components/management/CSVImportModal';
import PriceHistoryModal from '@/components/management/PriceHistoryModal';

const PriceUpdateModal = ({ isOpen, onClose, user, articles: stockArticles }) => {
  const {
    scheduledUpdates, priceHistory, loading,
    loadScheduledUpdates, loadPriceHistory,
    handleImmediateUpdate, handleScheduleUpdate, handleCancelScheduled, handleDeleteHistory
  } = usePriceUpdates(user);

  const [activeTab, setActiveTab] = useState('immediate');

  useEffect(() => {
    if (isOpen) {
      loadScheduledUpdates();
      if (activeTab === 'history') {
        loadPriceHistory();
      }
    }
  }, [isOpen, activeTab, loadScheduledUpdates, loadPriceHistory]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl">Gestión de Precios</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="immediate">Inmediata</TabsTrigger>
            <TabsTrigger value="scheduled">Programada</TabsTrigger>
            <TabsTrigger value="csv">Importar CSV</TabsTrigger>
            <TabsTrigger value="history">Historial</TabsTrigger>
          </TabsList>
          
          <div className="flex-1 overflow-y-auto mt-4 p-1">
            <TabsContent value="immediate" className="m-0 h-full">
              <ImmediatePriceUpdateTab 
                articles={stockArticles} 
                onUpdate={handleImmediateUpdate}
                loading={loading}
              />
            </TabsContent>
            
            <TabsContent value="scheduled" className="m-0 h-full">
              <ScheduledPriceUpdateTab 
                articles={stockArticles}
                scheduledUpdates={scheduledUpdates}
                onSchedule={handleScheduleUpdate}
                onCancel={handleCancelScheduled}
                loading={loading}
              />
            </TabsContent>

            <TabsContent value="csv" className="m-0 h-full">
              <CSVImportModal 
                articles={stockArticles}
                onImport={handleImmediateUpdate}
                loading={loading}
              />
            </TabsContent>

            <TabsContent value="history" className="m-0 h-full">
              <PriceHistoryModal 
                history={priceHistory}
                loadHistory={loadPriceHistory}
                onDelete={handleDeleteHistory}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default PriceUpdateModal;