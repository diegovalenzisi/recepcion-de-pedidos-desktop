import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePriceUpdates } from '@/hooks/usePriceUpdates';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { History, FileUp } from 'lucide-react';
import ImmediatePriceUpdateTab from '@/components/management/ImmediatePriceUpdateTab';
import ScheduledPriceUpdateTab from '@/components/management/ScheduledPriceUpdateTab';
import PriceHistoryModal from '@/components/management/PriceHistoryModal';
import CSVImportModal from '@/components/management/CSVImportModal';
import { useToast } from '@/components/ui/use-toast';

export default function PriceUpdatePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    articles, scheduledUpdates, priceHistory, loading,
    loadArticles, loadScheduledUpdates, loadPriceHistory,
    handleImmediateUpdate, handleScheduleUpdate, handleCancelScheduled
  } = usePriceUpdates(user);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCSVOpen, setIsCSVOpen] = useState(false);

  useEffect(() => {
    loadArticles();
    loadScheduledUpdates();
  }, [loadArticles, loadScheduledUpdates]);

  const handleCSVImport = async (parsedData) => {
    const changes = parsedData.map(item => {
      const match = articles.find(a => a.nombre.toLowerCase() === item.nombre.toLowerCase());
      if(match) return { ...match, newPrice: item.newPrice };
      return null;
    }).filter(Boolean);

    if (changes.length > 0) {
      await handleImmediateUpdate(changes);
      toast({ title: 'Importación Completa', description: `Se actualizaron ${changes.length} artículos` });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'No se encontraron coincidencias de artículos' });
    }
  };

  return (
    <div className="p-6 space-y-6 bg-background rounded-lg shadow-sm m-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground">Actualización de Precios</h1>
        <div className="space-x-2">
          <Button variant="outline" onClick={() => setIsCSVOpen(true)}>
            <FileUp className="w-4 h-4 mr-2" /> Importar CSV
          </Button>
          <Button variant="outline" onClick={() => setIsHistoryOpen(true)}>
            <History className="w-4 h-4 mr-2" /> Historial
          </Button>
        </div>
      </div>

      <Tabs defaultValue="immediate">
        <TabsList>
          <TabsTrigger value="immediate">Inmediata</TabsTrigger>
          <TabsTrigger value="scheduled">Programada</TabsTrigger>
        </TabsList>
        
        <TabsContent value="immediate" className="mt-4">
          <ImmediatePriceUpdateTab 
            articles={articles} 
            onUpdate={handleImmediateUpdate}
            loading={loading}
          />
        </TabsContent>
        
        <TabsContent value="scheduled" className="mt-4">
          <ScheduledPriceUpdateTab 
            articles={articles}
            scheduledUpdates={scheduledUpdates}
            onSchedule={handleScheduleUpdate}
            onCancel={handleCancelScheduled}
            loading={loading}
          />
        </TabsContent>
      </Tabs>

      <PriceHistoryModal 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)}
        history={priceHistory}
        loadHistory={loadPriceHistory}
      />
      <CSVImportModal 
        isOpen={isCSVOpen}
        onClose={() => setIsCSVOpen(false)}
        onImport={handleCSVImport}
      />
    </div>
  );
}