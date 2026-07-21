import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DataTable from '@/components/management/DataTable.jsx';
import FormModal from '@/components/management/FormModal.jsx';
import ConfirmationDialog from '@/components/management/ConfirmationDialog.jsx';
import PriceUpdateModal from '@/components/management/PriceUpdateModal.jsx';
import TachoReportModal from '@/components/management/TachoReportModal.jsx';
import StockHeader from '@/components/management/StockHeader.jsx';
import StockActions from '@/components/management/StockActions.jsx';
import OutOfStockModal from '@/components/management/OutOfStockModal.jsx';
import StockStatusBadge from '@/components/management/StockStatusBadge.jsx';
import OptionalExportButton from '@/components/management/OptionalExportButton.jsx';
import OptionalImportModal from '@/components/management/OptionalImportModal.jsx';
import StockDeliveryAutomationStatus from '@/components/management/StockDeliveryAutomationStatus.jsx';
import { useStockStatusContext } from '@/hooks/useStockStatus.js';
import { useAuth } from '@/hooks/useAuth.jsx';
import { 
  saveData, 
  deleteData, 
  updateTachoStock,
  updateArticleControlStock,
  listenToManagementData
} from '@/lib/api/managementApi.js';
import { allTabsConfig } from '@/components/management/stockTabsConfig.js';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

/**
 * Detecta el tipo de stock de un artículo con compatibilidad hacia atrás.
 * Soporta: stockType en stock, stockType en raíz, campos legacy (receta, heredadoDe, propio).
 */
export const getTipoStockArticulo = (articulo) => {
  const stock = articulo?.stock || {};

  // stockType explícito (nuevo formato)
  const raw =
    stock.stockType ||
    articulo?.stockType ||
    articulo?.tipoStock ||
    articulo?.stockConfig?.stockType ||
    articulo?.stockConfig?.tipo;

  if (raw === 'receta') return 'receta';
  if (raw === 'heredado') return 'heredado';
  if (raw === 'propio' || raw === 'stock_propio') return 'propio';

  // Detección legacy por presencia de campos
  if (stock.receta && typeof stock.receta === 'object' && Object.keys(stock.receta).length > 0) return 'receta';
  if (stock.heredadoDe && typeof stock.heredadoDe === 'string' && stock.heredadoDe.length > 0) return 'heredado';
  if (stock.propio !== undefined && stock.propio !== null) return 'propio';
  if (articulo?.receta) return 'receta';
  if (articulo?.heredaStock || articulo?.stockHeredadoDe) return 'heredado';

  return 'desconocido';
};

const getMaxIdFromData = (data, prefix) => {
  if (!data || data.length === 0) return 0;
  return data.reduce((max, item) => {
      const numericId = parseInt((item.codigo || '').toString().replace(prefix, ''), 10);
      return !isNaN(numericId) && numericId > max ? numericId : max;
  }, 0);
};

function StockPage({ userPermissions, userRole }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({ department: 'all', stockType: 'all' });
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [showPriceUpdateModal, setShowPriceUpdateModal] = useState(false);
  const [showTachoReportModal, setShowTachoReportModal] = useState(false);
  const [showOutOfStockModal, setShowOutOfStockModal] = useState(false);
  const [showOptionalImportModal, setShowOptionalImportModal] = useState(false);
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [mainView, setMainView] = useState('stock'); // 'stock' or 'automation'
  const { ready: firebaseReady } = useFirebaseReadiness();

  const { 
    outOfStockCount, lowStockCount,
    outOfStockArticles, lowStockArticles,
    outOfStockRawMaterials, lowStockRawMaterials,
    localId: stockLocalId
  } = useStockStatusContext();

  const [data, setData] = useState({
    articulos: [],
    'materia-prima': [],
    'grupos-opcionales': [],
    opcionales: [],
    departamentos: [],
    tachos: []
  });

  const visibleTabs = useMemo(() => {
    if (userRole === 'dueño') return allTabsConfig;
    return allTabsConfig.filter(tab => userPermissions[tab.permission]);
  }, [userPermissions, userRole]);
  
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.find(t => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    } else if (visibleTabs.length === 0) {
      setActiveTab('');
    }
  }, [visibleTabs, activeTab]);

  useEffect(() => {
    if (!firebaseReady) {
        return undefined;
    }

    setIsLoading(true);
    const unsubs = allTabsConfig.map(tab => {
        return listenToManagementData(tab.id, (updatedData) => {
            setData(prevData => ({
                ...prevData,
                [tab.id]: updatedData
            }));
            setIsLoading(false);
        }, (error) => {
            console.error(`Error listening to ${tab.label}:`, error);
            toast({
                variant: "destructive",
                title: `Error de Sincronización (${tab.label})`,
                description: `No se pudo conectar a la base de datos en tiempo real.`,
            });
            setIsLoading(false);
        });
    });

    return () => {
        unsubs.forEach(unsub => unsub());
    };
  }, [toast, firebaseReady]);

  const hasFullAccessToCurrentTab = useMemo(() => {
      if (userRole === 'dueño' || userPermissions.stock) return true;
      const currentTabPermission = allTabsConfig.find(t => t.id === activeTab)?.permission;
      return userPermissions[currentTabPermission];
  }, [userRole, userPermissions, activeTab]);
  
  const canModifyTachoStockPermission = userRole === 'dueño' || userPermissions?.tachos_modificar_stock;

  const getNextId = (tabId) => {
    const tabConfig = allTabsConfig.find(t => t.id === tabId);
    if (!tabConfig) return '';
    const currentData = data[tabId] || [];
    const maxId = getMaxIdFromData(currentData, tabConfig.idPrefix);
    return `${maxId + 1}${tabConfig.idPrefix}`;
  };

  const handleAdd = () => {
    const newItem = { codigo: getNextId(activeTab) };
    setEditingItem(newItem);
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleDuplicate = (item) => {
    const duplicatedItem = { ...item };
    duplicatedItem.codigo = getNextId(activeTab);
    delete duplicatedItem.id;
    duplicatedItem.nombre = `${item.nombre} (Copia)`;
    
    setEditingItem(duplicatedItem);
    setShowForm(true);
  };

  const handleDeleteRequest = (item) => {
    setItemToDelete(item);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsLoading(true);
    try {
      await deleteData(activeTab, itemToDelete);
      toast({
        title: "¡Eliminado!",
        description: `El elemento "${itemToDelete.nombre}" ha sido eliminado.`,
      });
      setItemToDelete(null);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al eliminar",
        description: `No se pudo eliminar "${itemToDelete.nombre}".`,
      });
       setItemToDelete(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (formData) => {
    setIsLoading(true);
    const isEditing = !!(editingItem && editingItem.id);

    try {
        if (!isEditing) {
            const idExists = (data[activeTab] || []).some(item => item.codigo === formData.codigo);
            if (idExists) {
                toast({
                    variant: "destructive",
                    title: "Error: ID Duplicado",
                    description: `El código "${formData.codigo}" ya existe. Por favor, elija uno diferente.`,
                });
                setIsLoading(false);
                return;
            }
        }

        const savedItem = await saveData(activeTab, formData, isEditing, data);

        toast({
            title: isEditing ? "¡Actualizado!" : "¡Agregado!",
            description: `El elemento "${savedItem.nombre}" se guardó con el código ${savedItem.codigo}.`,
        });
        setShowForm(false);
        setEditingItem(null);
    } catch (error) {
        toast({
            variant: "destructive",
            title: "Error al guardar",
            description: `No se pudo guardar "${formData.nombre}". ${error.message}`,
        });
    } finally {
        setIsLoading(false);
    }
  };

  const handleToggleStatus = async (item, newStatus) => {
    const updatedItem = { ...item, activo: newStatus };

    if (activeTab === 'articulos') {
        if (newStatus === false) { 
            updatedItem.previousActivoDelivery = item.activoDelivery;
            updatedItem.previousActivoMostrador = item.activoMostrador;
            updatedItem.activoDelivery = false;
            updatedItem.activoMostrador = false;
        } else { 
            updatedItem.activoDelivery = item.previousActivoDelivery === undefined ? true : item.previousActivoDelivery;
            updatedItem.activoMostrador = item.previousActivoMostrador === undefined ? true : item.previousActivoMostrador;
        }
    }
    
    setIsLoading(true);
    try {
      await saveData(activeTab, updatedItem, true, data);
      toast({
        title: "Estado actualizado",
        description: `"${item.nombre}" ahora está ${newStatus ? 'activo' : 'inactivo'}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al actualizar",
        description: `No se pudo cambiar el estado de "${item.nombre}".`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleControlStock = async (item, newStatus) => {
    if (activeTab !== 'articulos') return;
    
    setIsLoading(true);
    try {
      await updateArticleControlStock(item.codigo, newStatus);
      toast({
        title: "Control de Stock Actualizado",
        description: `El control de stock para "${item.nombre}" ha sido ${newStatus ? 'activado' : 'desactivado'}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al actualizar",
        description: `No se pudo cambiar el control de stock de "${item.nombre}".`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTachoStockChange = async (item, amount) => {
      const currentStock = Number(item.stock) || 0;
      const newStock = Math.max(0, currentStock + amount);
      const originalStock = item.stock;

      setData(prevData => ({
          ...prevData,
          tachos: prevData.tachos.map(t => 
              t.codigo === item.codigo ? { ...t, stock: newStock } : t
          )
      }));

      try {
          await updateTachoStock(item.codigo, newStock);
      } catch (error) {
          setData(prevData => ({
              ...prevData,
              tachos: prevData.tachos.map(t => 
                  t.codigo === item.codigo ? { ...t, stock: originalStock } : t
              )
          }));
          toast({
              variant: "destructive",
              title: "Error de Stock",
              description: `No se pudo actualizar el stock para "${item.nombre}".`
          });
      }
  };
  
  const handleToggleDestacado = async (item, newStatus) => {
    if (activeTab !== 'articulos') return;
    const updatedItem = { ...item, destacado: newStatus };
    setIsLoading(true);
    try {
      await saveData(activeTab, updatedItem, true, data);
      toast({
        title: "Artículo actualizado",
        description: `"${item.nombre}" ahora está ${newStatus ? 'destacado' : 'no destacado'}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al actualizar",
        description: `No se pudo cambiar el estado de destacado de "${item.nombre}".`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    let currentData = [...(data[activeTab] || [])];

    if (activeTab === 'articulos' && filters.department !== 'all') {
      currentData = currentData.filter(item => item.departamento === filters.department);
    }

    if (activeTab === 'articulos' && filters.stockType !== 'all') {
      currentData = currentData.filter(item => getTipoStockArticulo(item) === filters.stockType);
    }

    if (searchTerm) {
      currentData = currentData.filter(item =>
        (item.nombre && item.nombre.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.codigo && String(item.codigo).toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    return currentData.sort((a, b) => {
      if (activeTab === 'tachos') {
        return String(a.codigo || '').localeCompare(String(b.codigo || ''), undefined, { numeric: true, sensitivity: 'base' });
      }
      if (['articulos', 'opcionales', 'departamentos'].includes(activeTab)) {
        return (a.nombre || '').localeCompare(b.nombre || '');
      }
      return 0;
    });
  }, [data, activeTab, searchTerm, filters]);

  const tachosForReport = useMemo(() => {
      const list = activeTab === 'tachos' ? filteredData : (data.tachos || []);
      return [...list].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  }, [activeTab, filteredData, data.tachos]);

  return (
    <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 h-full flex flex-col overflow-hidden">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2 flex-shrink-0">
        <div className="flex-grow w-full sm:w-auto flex items-center gap-4">
          <StockHeader 
            visibleTabs={visibleTabs}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />
          <StockStatusBadge 
            outOfStockCount={outOfStockCount} 
            lowStockCount={lowStockCount} 
            onClick={() => setShowOutOfStockModal(true)}
          />
        </div>
      </div>
      
      <Tabs value={mainView} onValueChange={setMainView} className="flex-1 flex flex-col min-h-0">
        <TabsContent value="stock" className="flex-1 flex flex-col min-h-0 mt-0 data-[state=inactive]:hidden">
          {hasFullAccessToCurrentTab && (
            <div className="flex flex-col gap-2 flex-shrink-0 mb-4">
              {activeTab === 'opcionales' && (
                <div className="flex justify-end gap-2 w-full mb-2">
                  <OptionalExportButton optionals={data.opcionales} groups={data['grupos-opcionales']} />
                  <Button 
                    variant="outline" 
                    onClick={() => setShowOptionalImportModal(true)}
                    className="gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Importar
                  </Button>
                </div>
              )}
              <StockActions
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                onAdd={handleAdd}
                onPriceUpdate={() => setShowPriceUpdateModal(true)}
                onSendTachoReport={() => setShowTachoReportModal(true)}
                activeTab={activeTab}
                filters={filters}
                setFilters={setFilters}
                departments={data.departamentos || []}
              />
            </div>
          )}
          
          <div className="flex-1 min-h-0 overflow-auto relative border border-gray-200 rounded-lg shadow-sm bg-white">
            {isLoading && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-20">
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
              </div>
            )}
            {activeTab ? (
                <DataTable
                  activeTab={activeTab}
                  data={filteredData}
                  allData={data}
                  onEdit={handleEdit}
                  onDelete={handleDeleteRequest}
                  onDuplicate={handleDuplicate}
                  onToggleStatus={handleToggleStatus}
                  onToggleControlStock={handleToggleControlStock}
                  onToggleDestacado={handleToggleDestacado}
                  onTachoStockChange={handleTachoStockChange}
                  canModifyTachoStock={canModifyTachoStockPermission}
                  hasFullAccess={hasFullAccessToCurrentTab}
                />
            ) : (
                 <div className="text-center py-12 text-gray-500 flex items-center justify-center h-full">
                    <p>No tiene permisos para ver ninguna sección de Stock.</p>
                 </div>
            )}
          </div>
        </TabsContent>

      </Tabs>

      {showForm && (
        <FormModal
          showForm={showForm}
          setShowForm={setShowForm}
          editingItem={editingItem}
          activeTab={activeTab}
          tabs={allTabsConfig}
          onSave={handleSave}
          allData={data}
        />
      )}

      {showPriceUpdateModal && (
        <PriceUpdateModal
          isOpen={showPriceUpdateModal}
          onClose={() => setShowPriceUpdateModal(false)}
          user={user}
          articles={data.articulos}
        />
      )}

      {showTachoReportModal && (
        <TachoReportModal
          isOpen={showTachoReportModal}
          onClose={() => setShowTachoReportModal(false)}
          tachos={tachosForReport}
        />
      )}

      {showOutOfStockModal && (
        <OutOfStockModal
          isOpen={showOutOfStockModal}
          onClose={() => setShowOutOfStockModal(false)}
          outOfStockArticles={outOfStockArticles}
          outOfStockRawMaterials={outOfStockRawMaterials}
          lowStockArticles={lowStockArticles}
          lowStockRawMaterials={lowStockRawMaterials}
          departments={data.departamentos || []}
          localId={stockLocalId}
        />
      )}

      {showOptionalImportModal && (
        <OptionalImportModal
          isOpen={showOptionalImportModal}
          onClose={() => setShowOptionalImportModal(false)}
          groups={data['grupos-opcionales'] || []}
          existingOptionals={data.opcionales || []}
          onSuccess={() => {
            // Realtime listeners handles data update automatically
          }}
        />
      )}
      
      <ConfirmationDialog
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar "${itemToDelete?.nombre}"?`}
        description="Esta acción es permanente y no se puede deshacer."
      />
    </div>
  );
}

export default StockPage;