import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Plus, Minus, Search, Loader2 } from 'lucide-react';
// Orden manual de sabores/opcionales: LOCAL por PC (nunca Firebase), ver
// src/lib/api/localOptionalOrderApi.js. Mismas firmas que el módulo viejo
// (optionalOrderApi.js, que guardaba un único orden compartido por local).
import { fetchAllOptionalOrders, saveOptionalOrder, saveMultipleOptionalOrders } from '@/lib/api/localOptionalOrderApi';
import { tienePrecio, obtenerPrecioOpcional, precioOpcionalInvalido } from '@/lib/api/optionalsPricing';

// Mismo patrón que el resto de los modales de atención (formato local ARS).
const formatCurrency = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

function OptionalSelectionModal({ 
  isOpen, 
  onOpenChange, 
  article, 
  allOptionals, 
  allOptionalGroups, 
  onConfirm, 
  initialSelection, 
  isSubmodal = false,
  isPromoItem = false,
  promoItemIndex = 0,
  promoTotalItems = 0,
  unidadIndice = null,
  unidadTotal = null
}) {
  const [selectedOptionals, setSelectedOptionals] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [focusedOptional, setFocusedOptional] = useState(null);
  const [isLoadingOrder, setIsLoadingOrder] = useState(false);
  const [savingGroupId, setSavingGroupId] = useState(null);
  const { toast } = useToast();
  const scrollRef = useRef(null);
  const optionalRefs = useRef({});
  const searchInputRef = useRef(null);

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverItem, setDragOverItem] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [reorderedOptionals, setReorderedOptionals] = useState({});
  
  // Touch tracking for distinguishing drag from tap
  const touchStartPos = useRef(null);
  const touchMoveDistance = useRef(0);
  const DRAG_THRESHOLD = 10; // pixels - movement less than this is considered a tap

  const getArticleOptionalGroupConfig = useMemo(() => {
    if (!article || !article.opcionalesConfig) return [];
    
    return Object.entries(article.opcionalesConfig)
      .map(([key, config]) => {
        if (typeof config !== 'object' || !config.activo) return null;
        const groupId = config.id || key;
        return { id: groupId, ...config };
      })
      .filter(Boolean);
  }, [article]);

  const allVisibleOptionals = useMemo(() => {
    return getArticleOptionalGroupConfig.flatMap(groupConfig => {
      const groupId = groupConfig.id;
      const optionalsForThisConfig = groupConfig.opcionales || [];
      
      const orderedOptionalIds = reorderedOptionals[groupId] || optionalsForThisConfig;
      
      const optionalsInGroup = orderedOptionalIds
        .map(id => (allOptionals || []).find(op => op.id === id && op.grupo === groupId))
        .filter(Boolean);
      
      return optionalsInGroup.map(op => ({ ...op, groupId, optionalId: op.id }));
    });
  }, [getArticleOptionalGroupConfig, allOptionals, reorderedOptionals]);

  useEffect(() => {
    const loadSavedOrders = async () => {
      if (!isOpen || getArticleOptionalGroupConfig.length === 0) return;
      
      setIsLoadingOrder(true);
      
      try {
        const savedOrders = await fetchAllOptionalOrders();
        
        if (savedOrders && Object.keys(savedOrders).length > 0) {
          const initialReorderedOptionals = {};
          
          getArticleOptionalGroupConfig.forEach(groupConfig => {
            const groupId = groupConfig.id;
            const savedOrder = savedOrders[groupId];
            
            if (savedOrder && Array.isArray(savedOrder)) {
              const currentOptionalIds = groupConfig.opcionales || [];
              const validSavedOrder = savedOrder.filter(id => currentOptionalIds.includes(id));
              const newOptionals = currentOptionalIds.filter(id => !validSavedOrder.includes(id));
              
              if (validSavedOrder.length > 0) {
                initialReorderedOptionals[groupId] = [...validSavedOrder, ...newOptionals];
              }
            }
          });
          
          setReorderedOptionals(initialReorderedOptionals);
        }
      } catch (error) {
        console.error('[OptionalSelectionModal] Error loading saved orders:', error);
      } finally {
        setIsLoadingOrder(false);
      }
    };
    
    if (isOpen) {
      loadSavedOrders();
    }
  }, [isOpen, getArticleOptionalGroupConfig]);

  useEffect(() => {
    if (isOpen) {
      if (initialSelection) {
        setSelectedOptionals(initialSelection);
      } else {
        const initial = {};
        getArticleOptionalGroupConfig.forEach(group => {
            initial[group.id] = {};
        });
        setSelectedOptionals(initial);
      }
      setSearchTerm('');
      setFocusedOptional(null);
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen, article, getArticleOptionalGroupConfig, initialSelection]);

  const handleSearchChange = (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);

    if (term) {
      const foundOptional = allVisibleOptionals.find(op => 
        op.nombre.toLowerCase().startsWith(term) && op.activo !== false && op.status !== false
      );
      if (foundOptional) {
        setFocusedOptional({ groupId: foundOptional.groupId, optionalId: foundOptional.optionalId });
        optionalRefs.current[foundOptional.optionalId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      } else {
        setFocusedOptional(null);
      }
    } else {
      setFocusedOptional(null);
    }
  };

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      if (focusedOptional) {
        const { groupId, optionalId } = focusedOptional;
        const opInfo = allVisibleOptionals.find(o => o.optionalId === optionalId && o.groupId === groupId);
        if (opInfo?.activo === false || opInfo?.status === false) return;

        const groupSelection = selectedOptionals[groupId] || {};
        const isSelected = !!groupSelection[optionalId];
        handleQuantityChange(groupId, optionalId, isSelected ? -1 : 1);
        setSearchTerm('');
        searchInputRef.current?.focus();
      } else {
        searchInputRef.current?.focus();
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (allVisibleOptionals.length === 0) return;

      let currentIndex = -1;
      if (focusedOptional) {
        currentIndex = allVisibleOptionals.findIndex(
          op => op.groupId === focusedOptional.groupId && op.optionalId === focusedOptional.optionalId
        );
      }

      let nextIndex = currentIndex;
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      
      let count = 0;
      while (count < allVisibleOptionals.length) {
        nextIndex = (nextIndex + step + allVisibleOptionals.length) % allVisibleOptionals.length;
        const candidate = allVisibleOptionals[nextIndex];
        if (candidate.activo !== false && candidate.status !== false) {
          break;
        }
        count++;
      }

      const nextFocusedOptional = allVisibleOptionals[nextIndex];
      if (nextFocusedOptional && nextFocusedOptional.activo !== false && nextFocusedOptional.status !== false) {
        setFocusedOptional(nextFocusedOptional);
        optionalRefs.current[nextFocusedOptional.optionalId]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [focusedOptional, selectedOptionals, allVisibleOptionals]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.removeEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleQuantityChange = useCallback((groupId, optionalId, change) => {
    const opInfo = allOptionals?.find(op => op.id === optionalId);
    if (opInfo?.activo === false || opInfo?.status === false) return;

    setSelectedOptionals(prev => {
      const groupSelection = { ...(prev[groupId] || {}) };
      const groupConfig = getArticleOptionalGroupConfig.find(g => g.id === groupId);
      const maxSelections = groupConfig ? parseInt(groupConfig.max, 10) : 1;

      const currentTotal = Object.values(groupSelection).reduce((sum, qty) => sum + qty, 0);
      const newQuantity = (groupSelection[optionalId] || 0) + change;

      if (change > 0 && currentTotal >= maxSelections) {
        toast({
          variant: "destructive",
          title: "Límite alcanzado",
          description: `Solo puedes seleccionar hasta ${maxSelections} opcionales en total.`,
        });
        return prev;
      }

      if (newQuantity > 0) {
        groupSelection[optionalId] = newQuantity;
      } else {
        delete groupSelection[optionalId];
      }

      return { ...prev, [groupId]: groupSelection };
    });
  }, [allOptionals, getArticleOptionalGroupConfig, toast]);

  const handleDragStart = (e, groupId, optionalId) => {
    e.stopPropagation();
    setDraggedItem({ groupId, optionalId });
    setIsDragging(true);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragOver = (e, groupId, optionalId) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedItem && draggedItem.groupId === groupId) {
      setDragOverItem({ groupId, optionalId });
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
    }
  };

  const handleDragEnd = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedItem && dragOverItem && draggedItem.groupId === dragOverItem.groupId) {
      const groupId = draggedItem.groupId;
      
      const groupConfig = getArticleOptionalGroupConfig.find(g => g.id === groupId);
      const optionalsForThisConfig = groupConfig?.opcionales || [];
      const currentOrder = reorderedOptionals[groupId] || optionalsForThisConfig;
      
      const draggedIndex = currentOrder.indexOf(draggedItem.optionalId);
      const targetIndex = currentOrder.indexOf(dragOverItem.optionalId);
      
      if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
        const newOrder = [...currentOrder];
        [newOrder[draggedIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[draggedIndex]];
        
        setReorderedOptionals(prev => ({
          ...prev,
          [groupId]: newOrder
        }));

        setSavingGroupId(groupId);
        
        try {
          await saveOptionalOrder(groupId, newOrder);
          
          toast({
            title: "Orden guardado",
            description: "Las posiciones se intercambiaron y guardaron automáticamente.",
            duration: 2000,
          });
        } catch (error) {
          console.error('[OptionalSelectionModal] Error auto-saving order:', error);
          
          toast({
            variant: "destructive",
            title: "Error al guardar",
            description: "No se pudo guardar el orden automáticamente. Se guardará al confirmar.",
            duration: 3000,
          });
        } finally {
          setSavingGroupId(null);
        }
      }
    }
    
    setDraggedItem(null);
    setDragOverItem(null);
    setIsDragging(false);
  };

  const handleTouchStart = (e, groupId, optionalId) => {
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    touchMoveDistance.current = 0;
    setDraggedItem({ groupId, optionalId });
  };

  const handleTouchMove = (e) => {
    if (!draggedItem || !touchStartPos.current) return;
    
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartPos.current.x;
    const deltaY = touch.clientY - touchStartPos.current.y;
    touchMoveDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Only start visual dragging if moved beyond threshold
    if (touchMoveDistance.current > DRAG_THRESHOLD) {
      setIsDragging(true);
      
      const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);
      if (elementAtPoint) {
        const optionalElement = elementAtPoint.closest('[data-optional-id]');
        if (optionalElement) {
          const optionalId = optionalElement.getAttribute('data-optional-id');
          const groupId = optionalElement.getAttribute('data-group-id');
          
          if (groupId === draggedItem.groupId) {
            setDragOverItem({ groupId, optionalId });
          }
        }
      }
    }
  };

  const handleTouchEnd = (e) => {
    // If movement was less than threshold, treat as tap (not drag)
    if (touchMoveDistance.current < DRAG_THRESHOLD) {
      // This was a tap, not a drag - let the click handler fire
      setDraggedItem(null);
      setDragOverItem(null);
      setIsDragging(false);
      touchStartPos.current = null;
      touchMoveDistance.current = 0;
      return;
    }
    
    // Otherwise handle as drag end
    handleDragEnd(e);
    touchStartPos.current = null;
    touchMoveDistance.current = 0;
  };

  const handleOptionalClick = (e, groupId, optionalId, isDisabled, isGroupSaving) => {
    // Prevent click if currently dragging
    if (isDragging) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    if (isDisabled || isGroupSaving) {
      e.preventDefault();
      return;
    }
    
    handleQuantityChange(groupId, optionalId, 1);
  };

  const handleConfirm = async () => {
    const finalSelection = { ...article };
    const selectedWithDetails = {};
    let allGroupsValid = true;

    getArticleOptionalGroupConfig.forEach(groupConfig => {
        const groupId = groupConfig.id;
        const groupSelection = selectedOptionals[groupId] || {};
        const minSelections = groupConfig.obligatorio ? parseInt(groupConfig.min, 10) : 0;
        const currentTotalSelections = Object.values(groupSelection).reduce((sum, qty) => sum + qty, 0);

        if (currentTotalSelections < minSelections) {
            allGroupsValid = false;
            const groupInfo = allOptionalGroups?.find(g => g.id === groupId);
            toast({
                variant: "destructive",
                title: "Selección incompleta",
                description: `Debes seleccionar al menos ${minSelections} opcionales para el grupo "${groupInfo?.nombre || 'este grupo'}".`,
            });
        }
        
        selectedWithDetails[groupId] = Object.entries(groupSelection).map(([opId, quantity]) => {
          const optionalInfo = allOptionals?.find(op => op.id === opId);
          return { ...optionalInfo, quantity };
        });
    });

    if (!allGroupsValid) {
        return;
    }

    try {
      if (Object.keys(reorderedOptionals).length > 0) {
        await saveMultipleOptionalOrders(reorderedOptionals);
      }
    } catch (error) {
      console.error('[OptionalSelectionModal] Error saving optional orders:', error);
      toast({
        variant: "destructive",
        title: "Advertencia",
        description: "No se pudo guardar el orden de opcionales, pero la selección se ha registrado.",
      });
    }

    finalSelection.selectedOptionals = selectedWithDetails;
    finalSelection.reorderedOptionals = reorderedOptionals;
    onConfirm(finalSelection);
    // Para un ítem de promo (incluido el ÚLTIMO) el cierre del modal NO se
    // dispara acá: lo hace el `useEffect` de NewOrderModal.jsx que mira
    // `promoConfig.isFinalizing` vía `setIsOptionalModalOpen(false)` directo
    // (sin pasar por `onOpenChange`). Antes, para el último ítem, también se
    // llamaba a `onOpenChange(false)` AQUÍ, inmediatamente después de
    // `onConfirm(...)` — pero `onConfirm` (handleConfirmOptionals →
    // handlePromoItemConfigured) solo AGENDA el `setPromoConfig({
    // isFinalizing: true })`; React no lo aplica hasta el próximo render. La
    // llamada a `onOpenChange(false)` corría en el MISMO tick, así que
    // `handleOptionalModalClose` todavía veía el `promoConfig` VIEJO
    // (isFinalizing todavía en false) y disparaba el toast de "Configuración
    // de promo cancelada" aunque la promo se hubiera confirmado con éxito.
    // Para un artículo NORMAL (no promo) no existe ese efecto — ahí sigue
    // siendo este el único lugar que cierra el modal.
    if (!isPromoItem) {
      onOpenChange(false);
    }
  };
  
  if (!article) return null;

  const content = (
      <div className="flex flex-col h-full w-full bg-gray-50">
        <div className="bg-white px-4 py-2.5 border-b shadow-sm shrink-0 flex flex-row items-center justify-between gap-4">
          <div className="flex flex-col flex-shrink-0 min-w-0 max-w-[30%]">
            <DialogTitle className="text-xl font-black text-slate-800 uppercase tracking-tight truncate">
              {article.nombre}
            </DialogTitle>
            {isPromoItem && (
              <span className="text-orange-600 font-bold text-[11px] mt-0.5 truncate block">
                Promo: Configurar Artículo {promoItemIndex + 1} de {promoTotalItems}
              </span>
            )}
            {/* Configuración independiente por unidad: cada unidad elige sus
                propios grupos; no se copian las selecciones de otra unidad. */}
            {!isPromoItem && unidadTotal > 1 && (
              <span className="text-orange-600 font-bold text-[11px] mt-0.5 truncate block">
                Unidad {unidadIndice} de {unidadTotal}
              </span>
            )}
          </div>

          <div className="relative flex-1 max-w-md mx-auto min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar (F2)"
              value={searchTerm}
              onChange={handleSearchChange}
              className="pl-9 h-9 text-sm bg-gray-50 border-gray-300 focus-visible:ring-orange-500 w-full"
            />
          </div>

          <div className="flex items-center space-x-2 flex-shrink-0">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)} 
              className="border-gray-300 text-gray-700 h-9 px-4 text-sm font-semibold hover:bg-gray-100"
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleConfirm}
              disabled={isLoadingOrder}
              className="bg-green-600 hover:bg-green-700 text-white h-9 px-6 text-sm font-bold shadow-sm"
            >
              {isLoadingOrder ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando...
                </>
              ) : (
                isPromoItem ? (promoItemIndex < promoTotalItems - 1 ? 'Siguiente' : 'Finalizar Promo') : 'Confirmar'
              )}
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoadingOrder ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <span className="ml-3 text-slate-600">Cargando orden guardado...</span>
            </div>
          ) : (
            getArticleOptionalGroupConfig.map(groupConfig => {
              const groupId = groupConfig.id;
              const groupInfo = allOptionalGroups?.find(g => g.id === groupId);
              const optionalsForThisConfig = groupConfig.opcionales || [];
              
              const orderedOptionalIds = reorderedOptionals[groupId] || optionalsForThisConfig;
              
              const optionalsInGroup = orderedOptionalIds
                .map(id => (allOptionals || []).find(op => op.id === id && op.grupo === groupId))
                .filter(Boolean);

              const groupName = groupInfo ? groupInfo.nombre : `Grupo ${groupId}`;
              const currentTotal = Object.values(selectedOptionals[groupId] || {}).reduce((sum, qty) => sum + qty, 0);
              const isGroupSaving = savingGroupId === groupId;
              
              if (!optionalsInGroup.length) return null;

              return (
                <div key={groupId} className="w-full max-w-7xl mx-auto">
                  <div className="flex items-center justify-between mb-2 border-b border-gray-200 pb-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                          {groupName}
                          <span className="text-[11px] font-medium text-slate-500 normal-case bg-gray-100 px-2 py-0.5 rounded-full">
                            {groupConfig.obligatorio ? 
                            `Mín: ${groupConfig.min} | Máx: ${groupConfig.max}` :
                            `Máx: ${groupConfig.max}`
                            }
                          </span>
                        </h3>
                        {isGroupSaving && (
                          <div className="flex items-center gap-1.5 text-orange-600">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="text-[10px] font-semibold uppercase">Guardando...</span>
                          </div>
                        )}
                      </div>
                      <div className="bg-white px-2 py-0.5 rounded border shadow-sm flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase">Selec:</span>
                        <span className="text-sm font-black text-orange-600">
                            {currentTotal} / {groupConfig.max}
                        </span>
                      </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                    {optionalsInGroup.map(opcional => {
                      const isDisabled = opcional.activo === false || opcional.status === false;
                      const isFocused = focusedOptional?.optionalId === opcional.id && !isDisabled;
                      const qty = selectedOptionals[groupId]?.[opcional.id] || 0;
                      const isSelected = qty > 0;
                      const isDraggedItem = draggedItem?.optionalId === opcional.id && draggedItem?.groupId === groupId && isDragging;
                      const isDraggedOver = dragOverItem?.optionalId === opcional.id && dragOverItem?.groupId === groupId && isDragging;

                      return (
                        <div 
                          key={opcional.id} 
                          ref={el => optionalRefs.current[opcional.id] = el}
                          data-optional-id={opcional.id}
                          data-group-id={groupId}
                          draggable={!isDisabled && !isGroupSaving}
                          onDragStart={(e) => !isDisabled && !isGroupSaving && handleDragStart(e, groupId, opcional.id)}
                          onDragOver={(e) => !isDisabled && !isGroupSaving && handleDragOver(e, groupId, opcional.id)}
                          onDragEnd={handleDragEnd}
                          onTouchStart={(e) => !isDisabled && !isGroupSaving && handleTouchStart(e, groupId, opcional.id)}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={handleTouchEnd}
                          className={`relative flex flex-row items-center justify-between px-1.5 py-0.5 h-[32px] rounded border transition-all duration-150 ${
                            isDisabled ? 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed grayscale' :
                            isGroupSaving ? 'opacity-60 cursor-wait' :
                            isDraggedItem ? 'opacity-50 shadow-lg scale-105 cursor-grabbing' :
                            isDraggedOver ? 'border-orange-500 bg-orange-100 shadow-md scale-105' :
                            isFocused ? 'ring-1 ring-orange-500 border-orange-500 bg-orange-50/50 shadow-sm cursor-grab' : 
                            isSelected ? 'border-orange-400 bg-orange-50/80 cursor-grab' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm cursor-grab'
                          }`}
                          style={{
                            transform: isDraggedItem ? 'rotate(2deg)' : isDraggedOver ? 'scale(1.05)' : 'none',
                            boxShadow: isDraggedItem ? '0 8px 16px rgba(0,0,0,0.2)' : isDraggedOver ? '0 4px 8px rgba(251,146,60,0.3)' : undefined,
                            touchAction: 'manipulation',
                            WebkitTouchCallout: 'none',
                            WebkitUserSelect: 'none',
                            userSelect: 'none'
                          }}
                          title={isDisabled ? `${opcional.nombre} (Sin Stock/Inactivo)` : opcional.nombre}
                        >
                          <div 
                            onClick={(e) => handleOptionalClick(e, groupId, opcional.id, isDisabled, isGroupSaving)}
                            className={`flex items-center h-full flex-1 pr-1 select-none overflow-hidden ${
                              isDisabled ? 'text-gray-400' :
                              isGroupSaving ? 'text-gray-500' :
                              isSelected ? 'text-orange-800 cursor-pointer' : 'text-slate-700 cursor-pointer'
                            }`}
                            style={{
                              pointerEvents: 'auto',
                              touchAction: 'manipulation'
                            }}
                          >
                            <span className="text-[11px] leading-tight font-bold w-full truncate block">
                              {opcional.nombre}
                              {/* Adicional visible SOLO si el precio es > 0.
                                  Precio 0 → nada (nunca "+$0"). Precio inválido →
                                  se marca, nunca se muestra como gratuito. */}
                              {tienePrecio(opcional) && (
                                <span className="ml-1 font-extrabold text-emerald-700">
                                  (+{formatCurrency(obtenerPrecioOpcional(opcional))})
                                </span>
                              )}
                              {precioOpcionalInvalido(opcional) && (
                                <span className="ml-1 font-extrabold text-red-600" title="Precio inválido: revisar el opcional">
                                  (precio inválido)
                                </span>
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button 
                              variant="outline" 
                              size="icon" 
                              disabled={isDisabled || isGroupSaving}
                              className={`h-6 w-6 shrink-0 rounded-sm border-gray-300 hover:bg-gray-100 ${isSelected ? 'bg-white' : 'bg-gray-50'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isDisabled || isGroupSaving || isDragging) e.preventDefault();
                                else handleQuantityChange(groupId, opcional.id, -1);
                              }}
                              style={{ touchAction: 'manipulation' }}
                            >
                              <Minus className="h-3 w-3 text-slate-700" />
                            </Button>
                            <span className={`text-xs font-black w-4 text-center tabular-nums ${
                              isDisabled ? 'text-gray-400' :
                              isGroupSaving ? 'text-gray-500' :
                              isSelected ? 'text-orange-600' : 'text-slate-800'
                            }`}>
                              {qty}
                            </span>
                            <Button 
                              variant="outline" 
                              size="icon" 
                              disabled={isDisabled || isGroupSaving}
                              className={`h-6 w-6 shrink-0 rounded-sm border-gray-300 hover:bg-gray-100 ${isSelected ? 'bg-white' : 'bg-gray-50'}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isDisabled || isGroupSaving || isDragging) e.preventDefault();
                                else handleQuantityChange(groupId, opcional.id, 1);
                              }}
                              style={{ touchAction: 'manipulation' }}
                            >
                              <Plus className="h-3 w-3 text-slate-700" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className={`!max-w-[100vw] !w-[100vw] !h-[100vh] !m-0 !p-0 !rounded-none flex flex-col overflow-hidden border-0 bg-transparent ${isSubmodal ? 'z-[60]' : ''}`} 
        hideCloseButton
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}

export default OptionalSelectionModal;