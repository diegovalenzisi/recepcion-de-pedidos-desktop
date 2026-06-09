import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import * as api from '@/lib/api/priceUpdateApi';
import { fetchPriceHistoryByDateRange, deletePriceHistoryRecord } from '@/lib/api/PriceHistoryApi';

export const usePriceUpdates = (user) => {
  const [articles, setArticles] = useState([]);
  const [scheduledUpdates, setScheduledUpdates] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const loadArticles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.fetchAllArticles();
      setArticles(data);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los artículos' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadScheduledUpdates = useCallback(async () => {
    try {
      const data = await api.fetchScheduledUpdates();
      setScheduledUpdates(data);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las actualizaciones programadas' });
    }
  }, [toast]);

  const loadPriceHistory = useCallback(async (start, end) => {
    try {
      const data = await fetchPriceHistoryByDateRange(start, end);
      setPriceHistory(data);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar el historial' });
    }
  }, [toast]);

  const handleImmediateUpdate = async (articlesToUpdate) => {
    setLoading(true);
    try {
      await api.updateArticlePrices(articlesToUpdate, user?.nombre, 'inmediato');
      toast({ title: 'Éxito', description: `Se actualizaron ${articlesToUpdate.length} precios correctamente` });
      await loadArticles();
      await loadPriceHistory();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron actualizar los precios' });
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleUpdate = async (updateData) => {
    setLoading(true);
    try {
      // Guardar también en historial como programado
      await api.saveScheduledUpdate({ ...updateData, createdBy: user?.nombre });
      
      const { changes, date } = updateData;
      const historyEntries = changes.map(c => ({
        codigo: c.codigo,
        nombre: c.nombre,
        departamento: c.departamento || '',
        precio_anterior: c.valor,
        precio_nuevo: c.newPrice || c.precio_nuevo,
        fecha: date.split('T')[0],
        hora: date.split('T')[1] || '',
        usuario: user?.nombre || 'Sistema',
        tipo: 'programado'
      }));
      
      const { savePriceHistory } = await import('@/lib/api/PriceHistoryApi');
      await savePriceHistory(historyEntries);

      toast({ title: 'Éxito', description: 'Actualización programada correctamente y registrada en historial' });
      await loadScheduledUpdates();
      await loadPriceHistory();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo programar la actualización' });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelScheduled = async (id) => {
    try {
      await api.cancelScheduledUpdate(id);
      toast({ title: 'Cancelada', description: 'La actualización programada fue cancelada' });
      await loadScheduledUpdates();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cancelar la actualización' });
    }
  };

  const handleDeleteHistory = async (id) => {
    try {
      await deletePriceHistoryRecord(id);
      toast({ title: 'Eliminado', description: 'Registro de historial eliminado' });
      await loadPriceHistory();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar el registro' });
    }
  };

  return {
    articles,
    scheduledUpdates,
    priceHistory,
    loading,
    loadArticles,
    loadScheduledUpdates,
    loadPriceHistory,
    handleImmediateUpdate,
    handleScheduleUpdate,
    handleCancelScheduled,
    handleDeleteHistory
  };
};