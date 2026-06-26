import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updatePromotionArticles } from '@/lib/api/promotionsApi';
import { getDatabase, ref, get } from 'firebase/database';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { Loader2, ArrowRightLeft, ArrowRight, Filter } from 'lucide-react';

export default function ManagePromotionArticlesModal({ isOpen, onClose, promotion, onSuccess }) {
  const [activeArticles, setActiveArticles] = useState([]);
  const [inactiveArticles, setInactiveArticles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  
  const [selectedDeactivate, setSelectedDeactivate] = useState(new Set());
  const [selectedActivate, setSelectedActivate] = useState(new Set());
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && promotion) {
      setSelectedDeactivate(new Set(promotion.articlesDeactivate || []));
      setSelectedActivate(new Set(promotion.articlesActivate || []));
      setSelectedDepartment('all');
      fetchData();
    }
  }, [isOpen, promotion]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const db = getDatabase();
      const localId = getCurrentLocalId();
      
      const [articlesSnap, deptsSnap] = await Promise.all([
        get(ref(db, `${localId}/ARTICULOS`)),
        get(ref(db, `${localId}/DEPARTAMENTOS`))
      ]);

      const deptsData = deptsSnap.exists() ? deptsSnap.val() : {};
      
      if (articlesSnap.exists()) {
        const data = articlesSnap.val();
        const uniqueDepts = new Set();
        
        const articlesList = Object.keys(data).map(key => {
          const article = data[key];
          const deptName = deptsData[article.departamento]?.nombre || article.departamento || 'Sin Departamento';
          uniqueDepts.add(deptName);
          
          return {
            id: key,
            ...article,
            departmentName: deptName
          };
        });
        
        setDepartments(Array.from(uniqueDepts).sort());
        
        // Split into active and inactive based on the 'activo' flag
        const active = articlesList.filter(a => a.activo !== false);
        const inactive = articlesList.filter(a => a.activo === false);
        
        setActiveArticles(active.length > 0 ? active : articlesList);
        setInactiveArticles(inactive.length > 0 ? inactive : articlesList);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los artículos y departamentos.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleDeactivate = (articleId) => {
    setSelectedDeactivate(prev => {
      const newSet = new Set(prev);
      if (newSet.has(articleId)) newSet.delete(articleId);
      else newSet.add(articleId);
      return newSet;
    });
  };

  const handleToggleActivate = (articleId) => {
    setSelectedActivate(prev => {
      const newSet = new Set(prev);
      if (newSet.has(articleId)) newSet.delete(articleId);
      else newSet.add(articleId);
      return newSet;
    });
  };

  const handleSave = async () => {
    if (selectedDeactivate.size !== selectedActivate.size) {
      toast({ 
        variant: 'destructive', 
        title: 'Error de validación', 
        description: 'La cantidad de artículos a desactivar debe ser igual a la cantidad a activar.' 
      });
      return;
    }

    setIsSaving(true);
    try {
      await updatePromotionArticles(
        promotion.id, 
        Array.from(selectedDeactivate), 
        Array.from(selectedActivate)
      );
      toast({ title: 'Éxito', description: 'Artículos actualizados correctamente.' });
      onSuccess();
      onClose();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'No se pudieron guardar los artículos.' });
    } finally {
      setIsSaving(false);
    }
  };

  const isCountMatching = selectedDeactivate.size === selectedActivate.size;
  const showSummary = isCountMatching && selectedDeactivate.size > 0;

  const filteredActiveArticles = selectedDepartment === 'all' 
    ? activeArticles 
    : activeArticles.filter(a => a.departmentName === selectedDepartment);

  const filteredInactiveArticles = selectedDepartment === 'all'
    ? inactiveArticles
    : inactiveArticles.filter(a => a.departmentName === selectedDepartment);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col bg-gray-50">
        <DialogHeader>
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-xl">Gestionar Artículos en Promoción</DialogTitle>
              <DialogDescription>
                {promotion?.name} - Selecciona los artículos a intercambiar directamente desde las listas.
              </DialogDescription>
            </div>
            
            {/* Department Filter */}
            <div className="flex items-center gap-2 bg-white p-1.5 rounded-md border shadow-sm">
              <Filter className="w-4 h-4 text-gray-500 ml-2" />
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="w-[200px] border-0 focus:ring-0 h-8 text-sm">
                  <SelectValue placeholder="Filtrar departamento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los departamentos</SelectItem>
                  {departments.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 flex flex-col md:flex-row min-h-0 gap-4 py-2">
          {/* Left Column: Deactivate */}
          <div className="flex-1 flex flex-col bg-white rounded-lg border shadow-sm overflow-hidden h-64 md:h-auto">
            <div className="p-3 bg-red-50 border-b flex justify-between items-center sticky top-0 z-10">
              <span className="font-semibold text-red-700">Artículos a DESACTIVAR</span>
              <span className="bg-red-200 text-red-800 text-xs px-2 py-1 rounded-full font-bold">
                {selectedDeactivate.size} seleccionados
              </span>
            </div>
            <ScrollArea className="flex-1 p-2">
              {isLoading ? (
                <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : (
                <div className="space-y-1">
                  {filteredActiveArticles.map(article => (
                    <label 
                      key={article.id} 
                      className="flex items-center space-x-3 p-2 hover:bg-red-50/50 rounded-md cursor-pointer border border-transparent hover:border-red-100 transition-colors"
                    >
                      <Checkbox 
                        checked={selectedDeactivate.has(article.id)}
                        onCheckedChange={() => handleToggleDeactivate(article.id)}
                      />
                      <span className="text-sm font-medium text-gray-700 select-none">
                        {article.nombre} <span className="text-gray-400 font-normal text-xs ml-1 bg-gray-100 px-1.5 py-0.5 rounded">({article.departmentName})</span>
                      </span>
                    </label>
                  ))}
                  {filteredActiveArticles.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">
                      {selectedDepartment === 'all' ? 'No hay artículos activos disponibles.' : 'No hay artículos activos en este departamento.'}
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="hidden md:flex items-center justify-center">
            <ArrowRightLeft className={`w-8 h-8 ${isCountMatching ? 'text-green-500' : 'text-gray-300'}`} />
          </div>

          {/* Right Column: Activate */}
          <div className="flex-1 flex flex-col bg-white rounded-lg border shadow-sm overflow-hidden h-64 md:h-auto">
            <div className="p-3 bg-green-50 border-b flex justify-between items-center sticky top-0 z-10">
              <span className="font-semibold text-green-700">Artículos a ACTIVAR</span>
              <span className="bg-green-200 text-green-800 text-xs px-2 py-1 rounded-full font-bold">
                {selectedActivate.size} seleccionados
              </span>
            </div>
            <ScrollArea className="flex-1 p-2">
              {isLoading ? (
                <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : (
                <div className="space-y-1">
                  {filteredInactiveArticles.map(article => (
                    <label 
                      key={article.id} 
                      className="flex items-center space-x-3 p-2 hover:bg-green-50/50 rounded-md cursor-pointer border border-transparent hover:border-green-100 transition-colors"
                    >
                      <Checkbox 
                        checked={selectedActivate.has(article.id)}
                        onCheckedChange={() => handleToggleActivate(article.id)}
                      />
                      <span className="text-sm font-medium text-gray-700 select-none">
                        {article.nombre} <span className="text-gray-400 font-normal text-xs ml-1 bg-gray-100 px-1.5 py-0.5 rounded">({article.departmentName})</span>
                      </span>
                    </label>
                  ))}
                  {filteredInactiveArticles.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">
                      {selectedDepartment === 'all' ? 'No hay artículos inactivos disponibles.' : 'No hay artículos inactivos en este departamento.'}
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Validation Error */}
        {!isCountMatching && (
          <div className="bg-red-50 border border-red-200 p-3 rounded-md text-sm text-red-600 font-medium flex items-center justify-center">
            ⚠️ Debes seleccionar la misma cantidad de artículos en ambas columnas (Desactivar: {selectedDeactivate.size} vs Activar: {selectedActivate.size}).
          </div>
        )}

        {/* Swap Summary */}
        {showSummary && (
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-md mt-2">
            <h4 className="font-semibold text-blue-800 mb-3 text-sm flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" /> Resumen del intercambio
            </h4>
            <ScrollArea className="max-h-32">
              <div className="space-y-2 pr-4">
                {Array.from(selectedDeactivate).map((deactId, index) => {
                  const actId = Array.from(selectedActivate)[index];
                  const deactArt = activeArticles.find(a => a.id === deactId);
                  const actArt = inactiveArticles.find(a => a.id === actId);
                  
                  return (
                    <div key={index} className="flex items-center text-sm bg-white p-2 rounded border border-blue-100 shadow-sm">
                      <span className="text-red-600 line-through truncate flex-1" title={deactArt?.nombre}>
                        {deactArt?.nombre || 'Desconocido'}
                      </span>
                      <ArrowRight className="w-4 h-4 mx-3 text-blue-400 shrink-0" />
                      <span className="text-green-600 font-medium truncate flex-1 text-right" title={actArt?.nombre}>
                        {actArt?.nombre || 'Desconocido'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="pt-4 border-t mt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || !isCountMatching || selectedActivate.size === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}