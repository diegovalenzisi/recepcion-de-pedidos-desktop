import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, AlertTriangle, CheckCircle2, RotateCcw, Package, Clock } from 'lucide-react';
import { fetchAffectedArticles, manualOverrideDelivery } from '@/lib/api/stockDeliveryAutomation';
import { listenToManagementData } from '@/lib/api/managementApi';

const StockDeliveryAutomationStatus = ({ departments = [] }) => {
  const [affectedArticles, setAffectedArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overriding, setOverriding] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAffectedArticles();
    
    // Listen to real-time article updates
    const unsubscribe = listenToManagementData('articulos', () => {
      loadAffectedArticles();
    }, (error) => {
      console.error('Error listening to articles:', error);
    });
    
    return () => unsubscribe();
  }, []);

  const loadAffectedArticles = async () => {
    setLoading(true);
    try {
      const articles = await fetchAffectedArticles();
      setAffectedArticles(articles);
    } catch (error) {
      console.error('Error loading affected articles:', error);
      toast({
        variant: 'destructive',
        title: 'Error de Carga',
        description: 'No se pudieron cargar los artículos afectados.'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManualOverride = async (articleId, currentDeliveryStatus) => {
    setOverriding(articleId);
    try {
      const newStatus = !currentDeliveryStatus;
      await manualOverrideDelivery(articleId, newStatus);
      
      toast({
        title: 'Anulación Manual',
        description: `Delivery ${newStatus ? 'habilitado' : 'deshabilitado'} manualmente.`,
        className: 'bg-blue-50 border-blue-200 text-blue-800'
      });
      
      // Reload affected articles
      await loadAffectedArticles();
    } catch (error) {
      console.error('Error during manual override:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo aplicar la anulación manual.'
      });
    } finally {
      setOverriding(null);
    }
  };

  const getDepartmentName = (departmentId) => {
    const dept = departments.find(d => d.id === departmentId || d.codigo === departmentId);
    return dept ? dept.nombre : 'Sin Departamento';
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Estado de Automatización de Delivery
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          Estado de Automatización de Delivery
        </CardTitle>
        <CardDescription>
          Artículos con delivery deshabilitado automáticamente por falta de stock
        </CardDescription>
      </CardHeader>
      <CardContent>
        {affectedArticles.length === 0 ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              No hay artículos afectados actualmente. Todos los artículos con stock 0 tienen delivery correctamente deshabilitado.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert className="mb-4 bg-yellow-50 border-yellow-200">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800">
                <strong>{affectedArticles.length}</strong> artículo(s) con delivery deshabilitado por stock agotado
              </AlertDescription>
            </Alert>

            <ScrollArea className="h-[400px] border rounded-lg">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="font-semibold">Artículo</TableHead>
                    <TableHead className="font-semibold">Departamento</TableHead>
                    <TableHead className="font-semibold text-center">Stock Actual</TableHead>
                    <TableHead className="font-semibold text-center">Estado Delivery</TableHead>
                    <TableHead className="font-semibold">Último Cambio</TableHead>
                    <TableHead className="font-semibold text-center">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {affectedArticles.map(article => (
                    <TableRow key={article.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">
                        <div>
                          <div>{article.nombre}</div>
                          <div className="text-xs text-muted-foreground">ID: {article.codigo}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getDepartmentName(article.departamento)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="destructive" className="gap-1">
                          <Package className="w-3 h-3" />
                          {article.stock}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge 
                          variant={article.activoDelivery ? 'default' : 'secondary'}
                          className={article.activoDelivery ? 'bg-green-600' : 'bg-gray-400'}
                        >
                          {article.activoDelivery ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(article.lastAutoToggle)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {article.autoToggleReason === 'stock_depleted' && 'Stock agotado'}
                          {article.autoToggleReason === 'manual_override' && 'Anulación manual'}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleManualOverride(article.id, article.activoDelivery)}
                          disabled={overriding === article.id}
                          className="gap-1 text-xs"
                        >
                          {overriding === article.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          {article.activoDelivery ? 'Deshabilitar' : 'Habilitar'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Nota:</strong> El sistema habilitará automáticamente el delivery cuando se repongan estos artículos (stock {'>'} 0).
                Use la anulación manual solo si necesita forzar un estado específico.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StockDeliveryAutomationStatus;