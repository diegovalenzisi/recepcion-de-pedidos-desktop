import React, { useState, useEffect, useCallback } from 'react';
import { 
  Package, 
  Layers, 
  Settings, 
  ShoppingCart, 
  Plus, 
  Search,
  Filter,
  Download,
  Upload,
  Loader2,
  FolderTree,
  Trash2 as Trash
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import DataTable from '@/components/management/DataTable';
import FormModal from '@/components/management/FormModal';
import ConfirmationDialog from '@/components/management/ConfirmationDialog';
import { fetchAllManagementData, saveData, deleteData, updateTachoStock } from '@/lib/api/managementApi';
import { useAuth } from '@/hooks/useAuth';

function ManagementPage({ userPermissions, userRole }) {
  const [activeTab, setActiveTab] = useState('articulos');
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();
  
  const hasFullAccess = user && user.rol === 'dueño';
  const canModifyTachoStock = hasFullAccess || (user && user.permissions && user.permissions.tachos_modificar_stock);


  const [data, setData] = useState({
    articulos: [],
    'materia-prima': [],
    'grupos-opcionales': [],
    opcionales: [],
    departamentos: [],
    tachos: []
  });

  const tabs = [
    { id: 'articulos', label: 'Artículos', icon: Package },
    { id: 'materia-prima', label: 'Materia Prima', icon: Layers },
    { id: 'grupos-opcionales', label: 'Grupos Opcionales', icon: FolderTree },
    { id: 'opcionales', label: 'Opcionales', icon: ShoppingCart },
    { id: 'departamentos', label: 'Departamentos', icon: Settings },
    { id: 'tachos', label: 'Tachos', icon: Trash }
  ];

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
        const allData = await fetchAllManagementData(tabs);
        setData(allData);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error de Carga",
        description: `No se pudieron cargar todos los datos. ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleAdd = () => {
    setEditingItem(null);
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleDuplicate = async (item) => {
    const duplicatedItem = { ...item };
    delete duplicatedItem.codigo;
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
      
      // Show appropriate message based on item type
      let description = `El elemento "${itemToDelete.nombre}" ha sido eliminado.`;
      if (activeTab === 'opcionales') {
        description = `El opcional "${itemToDelete.nombre}" ha sido eliminado y removido de todos los artículos asociados.`;
      }
      
      toast({
        title: "¡Eliminado!",
        description,
      });
      setItemToDelete(null);
      await loadAllData();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al eliminar",
        description: `No se pudo eliminar "${itemToDelete.nombre}". ${error.message}`,
      });
       setItemToDelete(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (formData) => {
    setIsLoading(true);
    const isNew = !editingItem || !editingItem.codigo;

    try {
      const savedItem = await saveData(activeTab, formData, !isNew, data);
      
      // Show appropriate success message based on item type
      let description = `El elemento "${formData.nombre}" se guardó con el código ${savedItem.codigo}.`;
      if (activeTab === 'opcionales') {
        description = `El opcional "${formData.nombre}" se guardó y sincronizó automáticamente con todos los artículos del grupo.`;
      }
      
      toast({
        title: isNew ? "¡Agregado!" : "¡Actualizado!",
        description,
      });
      setShowForm(false);
      setEditingItem(null);
      await loadAllData();
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
    
    if (activeTab === 'articulos' || activeTab === 'opcionales') {
        updatedItem.activoDelivery = newStatus;
        updatedItem.activoMostrador = newStatus;
    }

    setIsLoading(true);
    try {
      await saveData(activeTab, updatedItem, true, data);
      toast({
        title: "Estado actualizado",
        description: `"${item.nombre}" ahora está ${newStatus ? 'activo' : 'inactivo'}.`,
      });
      await loadAllData();
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

  const handleTachoStockChange = async (item, amount) => {
      const newStock = (item.stock || 0) + amount;
      
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
                  t.codigo === item.codigo ? { ...t, stock: item.stock } : t
              )
          }));
          toast({
              variant: "destructive",
              title: "Error de Stock",
              description: `No se pudo actualizar el stock para "${item.nombre}".`
          });
      }
  };
  
  const filteredData = (data[activeTab] || [])
    .filter(item =>
      (item.nombre && item.nombre.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.codigo && String(item.codigo).toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => {
      if (['articulos', 'opcionales', 'departamentos', 'tachos'].includes(activeTab)) {
        return (a.nombre || '').localeCompare(b.nombre || '');
      }
      return 0;
    });

  return (
    <div className="bg-white rounded-xl shadow-xl p-6 h-full flex flex-col">
      <nav className="mb-6">
        <div className="flex space-x-1 p-1 bg-gray-200 rounded-lg">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md font-medium text-sm ${
                  activeTab === tab.id
                    ? 'bg-white text-orange-600 shadow'
                    : 'text-gray-600 hover:bg-white/60'
                }`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 space-y-4 md:space-y-0">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <button
            onClick={() => toast({ description: "🚧 This feature isn't implemented yet—but don't worry! You can request it in your next prompt! 🚀" })}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <Filter size={16} />
            <span>Filtros</span>
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button onClick={() => toast({ description: "🚧 This feature isn't implemented yet—but don't worry! You can request it in your next prompt! 🚀" })} className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            <Download size={16} />
            <span>Exportar</span>
          </button>
          <button onClick={() => toast({ description: "🚧 This feature isn't implemented yet—but don't worry! You can request it in your next prompt! 🚀" })} className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
            <Upload size={16} />
            <span>Importar</span>
          </button>
          <button onClick={handleAdd} className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 shadow-lg">
            <Plus size={16} />
            <span>Agregar</span>
          </button>
        </div>
      </div>
      
      <div className="flex-grow overflow-auto relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
          </div>
        )}
        <DataTable
          activeTab={activeTab}
          data={filteredData}
          allData={data}
          onEdit={handleEdit}
          onDelete={handleDeleteRequest}
          onDuplicate={handleDuplicate}
          onToggleStatus={handleToggleStatus}
          onTachoStockChange={handleTachoStockChange}
          canModifyTachoStock={canModifyTachoStock}
          hasFullAccess={hasFullAccess}
        />
      </div>

      {showForm && (
        <FormModal
          showForm={showForm}
          setShowForm={setShowForm}
          editingItem={editingItem}
          activeTab={activeTab}
          tabs={tabs}
          onSave={handleSave}
          allData={data}
        />
      )}
      
      <ConfirmationDialog
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={confirmDelete}
        title={`¿Eliminar "${itemToDelete?.nombre}"?`}
        description={
          activeTab === 'opcionales' 
            ? "Este opcional será eliminado y removido automáticamente de todos los artículos que lo usan. Esta acción no se puede deshacer."
            : "Esta acción es permanente y no se puede deshacer."
        }
      />
    </div>
  );
}

export default ManagementPage;