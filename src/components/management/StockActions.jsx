import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Plus, 
  Search,
  Filter,
  Download,
  Upload,
  DollarSign,
  Send,
  X
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const StockActions = ({ searchTerm, setSearchTerm, onAdd, onPriceUpdate, onSendTachoReport, activeTab, filters, setFilters, departments }) => {
  const { toast } = useToast();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const handleDepartmentChange = (value) => {
    setFilters(prev => ({ ...prev, department: value }));
  };

  const handleStockTypeChange = (value) => {
    setFilters(prev => ({ ...prev, stockType: value }));
  };

  const resetFilters = () => {
    setFilters({ department: 'all', stockType: 'all' });
    setIsPopoverOpen(false);
  };

  const hasActiveFilters = filters.department !== 'all' || (filters.stockType && filters.stockType !== 'all');

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 space-y-4 md:space-y-0">
      <div className="flex items-center space-x-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Buscar por nombre o código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 w-64"
          />
        </div>
        
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`relative flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors ${hasActiveFilters ? 'ring-2 ring-orange-500' : ''}`}
            >
              <Filter size={16} />
              <span>Filtros</span>
              {hasActiveFilters && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white"></span>
              )}
            </motion.button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Filtros Avanzados</h4>
                <p className="text-sm text-muted-foreground">
                  Refina tu búsqueda de artículos.
                </p>
              </div>
              <div className="grid gap-2">
                {activeTab === 'articulos' && (
                  <>
                    <div className="grid grid-cols-3 items-center gap-4">
                      <Label htmlFor="department">Departamento</Label>
                      <Select onValueChange={handleDepartmentChange} value={filters.department}>
                        <SelectTrigger id="department" className="col-span-2 h-8">
                          <SelectValue placeholder="Seleccionar departamento" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          {departments.map(dep => (
                            <SelectItem key={dep.codigo} value={dep.codigo}>{dep.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                      <Label htmlFor="stockType">Tipo de stock</Label>
                      <Select onValueChange={handleStockTypeChange} value={filters.stockType || 'all'}>
                        <SelectTrigger id="stockType" className="col-span-2 h-8">
                          <SelectValue placeholder="Tipo de stock" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="propio">Stock propio</SelectItem>
                          <SelectItem value="heredado">Stock heredado</SelectItem>
                          <SelectItem value="receta">Por receta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                {activeTab !== 'articulos' && (
                  <p className="text-sm text-center text-gray-500 py-4">No hay filtros disponibles para esta sección.</p>
                )}
              </div>
              {hasActiveFilters && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={resetFilters}
                  className="flex items-center justify-center space-x-2 text-sm text-red-500 hover:text-red-700"
                >
                  <X size={14} />
                  <span>Limpiar Filtros</span>
                </motion.button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center space-x-3">
        {activeTab === 'articulos' && (
          <motion.button 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            onClick={onPriceUpdate} 
            className="flex items-center space-x-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
          >
            <DollarSign size={16} />
            <span>Actualizar Precios</span>
          </motion.button>
        )}
        {activeTab === 'tachos' && (
          <motion.button 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            onClick={onSendTachoReport} 
            className="flex items-center space-x-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
          >
            <Send size={16} />
            <span>Enviar</span>
          </motion.button>
        )}
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => toast({ title: "🚧 Función no implementada" })} className="flex items-center space-x-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
          <Download size={16} />
          <span>Exportar</span>
        </motion.button>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => toast({ title: "🚧 Función no implementada" })} className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
          <Upload size={16} />
          <span>Importar</span>
        </motion.button>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onAdd} className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition-all shadow-lg">
          <Plus size={16} />
          <span>Agregar</span>
        </motion.button>
      </div>
    </div>
  );
};

export default StockActions;