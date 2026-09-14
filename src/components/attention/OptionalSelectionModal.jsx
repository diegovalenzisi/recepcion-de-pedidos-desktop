import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Plus, Minus, Search, Loader2, LayoutGrid, Save, X as XIcon } from 'lucide-react';
// Posicionamiento manual 2D de sabores/opcionales: LOCAL por PC (nunca
// Firebase), POR local y POR grupo. Ver src/lib/api/localOptionalGridApi.js
// (storage vía IPC) y src/lib/api/optionalesGrid.js (combinar con el
// catálogo vigente + operaciones del editor: mover/intercambiar, cambiar
// filas/columnas, títulos de columna). Reemplaza al orden lineal viejo
// (localOptionalOrderApi.js), que queda sin usarse acá.
import { fetchAllOptionalGrids, saveOptionalGrid } from '@/lib/api/localOptionalGridApi';
import {
  combinarGridConVigentes,
  conDimensionesAjustadas,
  conPosicionesIntercambiadas,
  conTituloDeColumna,
  grillaPorDefecto,
} from '@/lib/api/optionalesGrid';
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
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);
  const { toast } = useToast();
  const scrollRef = useRef(null);
  const optionalRefs = useRef({});
  const searchInputRef = useRef(null);

  // Posicionamiento manual 2D: `gridsByGroup[groupId]` es la GridConfig ya
  // combinada con el catálogo vigente (ver combinarGridConVigentes) — se usa
  // por igual para pintar la grilla en modo normal y como estado de trabajo
  // del editor (modo edición muta esto en memoria; "Guardar distribución"
  // recién ahí lo persiste a disco).
  const [gridsByGroup, setGridsByGroup] = useState({});
  const [isEditMode, setIsEditMode] = useState(false);
  const [savingGrid, setSavingGrid] = useState(false);
  const [gridDraggedItem, setGridDraggedItem] = useState(null); // { groupId, optionalId }
  const [gridDragOverCell, setGridDragOverCell] = useState(null); // { groupId, row, column }

  // Touch tracking for distinguishing drag from tap (editor, mismo umbral que antes)
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

  /** Carga (o recarga) las grillas de todos los grupos, combinadas con el catálogo vigente. Descarta ediciones sin guardar. */
  const cargarGrids = useCallback(async () => {
    if (getArticleOptionalGroupConfig.length === 0) return;
    setIsLoadingGrid(true);
    try {
      const savedGrids = await fetchAllOptionalGrids();
      const merged = {};
      const avisos = [];

      getArticleOptionalGroupConfig.forEach(groupConfig => {
        const groupId = groupConfig.id;
        // Solo ids que resuelven a un opcional REAL de este grupo — un id
        // huérfano en opcionalesConfig (borrado, mal migrado) nunca debe
        // reservar una celda fantasma que después no se pinta en ningún lado.
        const idsVigentes = (groupConfig.opcionales || []).filter(
          id => (allOptionals || []).some(op => op.id === id && op.grupo === groupId)
        );
        const combinada = combinarGridConVigentes(savedGrids?.[groupId] || null, idsVigentes);
        merged[groupId] = combinada;
        if (combinada.filasAgregadas > 0) {
          const groupInfo = allOptionalGroups?.find(g => g.id === groupId);
          avisos.push(`"${groupInfo?.nombre || groupId}": se agregaron ${combinada.filasAgregadas} fila(s) porque no entraban todos los sabores.`);
        }
      });

      setGridsByGroup(merged);
      if (avisos.length > 0) {
        toast({
          title: 'Distribución ampliada automáticamente',
          description: avisos.join(' '),
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('[OptionalSelectionModal] Error loading optional grids:', error);
    } finally {
      setIsLoadingGrid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getArticleOptionalGroupConfig, allOptionalGroups, allOptionals]);

  useEffect(() => {
    if (isOpen) cargarGrids();
  }, [isOpen, cargarGrids]);

  // Lista PLANA en orden visual (fila, columna) — reemplaza al viejo orden
  // lineal para navegación con flechas y para el buscador F2. Nunca decide
  // posiciones: solo lee las que ya están en gridsByGroup.
  const allVisibleOptionals = useMemo(() => {
    return getArticleOptionalGroupConfig.flatMap(groupConfig => {
      const groupId = groupConfig.id;
      const grid = gridsByGroup[groupId];
      if (!grid) return [];

      return Object.entries(grid.positions)
        .map(([optionalId, pos]) => {
          const op = (allOptionals || []).find(o => o.id === optionalId && o.grupo === groupId);
          return op ? { ...op, groupId, optionalId, row: pos.row, column: pos.column } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.row - b.row) || (a.column - b.column));
    });
  }, [getArticleOptionalGroupConfig, allOptionals, gridsByGroup]);

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
      setIsEditMode(false);
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
    if (isEditMode) return; // en modo edición, F2/flechas no interfieren con el editor
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
  }, [focusedOptional, selectedOptionals, allVisibleOptionals, isEditMode]);

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

  // ---------------------------------------------------------------------------
  // Editor de distribución (modo edición)
  // ---------------------------------------------------------------------------
  const handleToggleEditMode = () => {
    if (isEditMode) {
      // Salir sin guardar: descarta cualquier movimiento no persistido.
      cargarGrids();
      setIsEditMode(false);
    } else {
      setIsEditMode(true);
    }
  };

  const handleGuardarDistribucion = async () => {
    setSavingGrid(true);
    try {
      for (const groupConfig of getArticleOptionalGroupConfig) {
        const groupId = groupConfig.id;
        const grid = gridsByGroup[groupId];
        if (grid) {
          // eslint-disable-next-line no-await-in-loop
          await saveOptionalGrid(groupId, grid);
        }
      }
      toast({ title: 'Distribución guardada', className: 'bg-green-500 text-white' });
      setIsEditMode(false);
    } catch (error) {
      console.error('[OptionalSelectionModal] Error saving grid:', error);
      toast({ variant: 'destructive', title: 'No se pudo guardar la distribución', description: error.message });
    } finally {
      setSavingGrid(false);
    }
  };

  const handleTituloColumnaChange = (groupId, columnIndex, titulo) => {
    setGridsByGroup(prev => ({
      ...prev,
      [groupId]: conTituloDeColumna(prev[groupId] || grillaPorDefecto(), columnIndex, titulo),
    }));
  };

  const handleDimensionesChange = (groupId, nuevasFilas, nuevasColumnas) => {
    setGridsByGroup(prev => {
      const actual = prev[groupId] || grillaPorDefecto();
      const ajustada = conDimensionesAjustadas(actual, nuevasFilas, nuevasColumnas);
      if (ajustada.reubicados.length > 0) {
        toast({
          title: 'Sabores reubicados',
          description: `${ajustada.reubicados.length} sabor(es) se movieron automáticamente porque su celda ya no existe en la nueva distribución.`,
        });
      }
      return { ...prev, [groupId]: ajustada };
    });
  };

  const moverOIntercambiar = (groupId, optionalId, celdaDestino) => {
    setGridsByGroup(prev => {
      const actual = prev[groupId];
      if (!actual) return prev;
      return { ...prev, [groupId]: conPosicionesIntercambiadas(actual, optionalId, celdaDestino) };
    });
  };

  const handleGridDragStart = (e, groupId, optionalId) => {
    e.stopPropagation();
    setGridDraggedItem({ groupId, optionalId });
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };

  const handleGridDragOverCell = (e, groupId, row, column) => {
    e.preventDefault();
    e.stopPropagation();
    if (gridDraggedItem && gridDraggedItem.groupId === groupId) {
      setGridDragOverCell({ groupId, row, column });
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleGridDrop = (e, groupId, row, column) => {
    e.preventDefault();
    e.stopPropagation();
    if (gridDraggedItem && gridDraggedItem.groupId === groupId) {
      moverOIntercambiar(groupId, gridDraggedItem.optionalId, { row, column });
    }
    setGridDraggedItem(null);
    setGridDragOverCell(null);
  };

  const handleGridDragEnd = () => {
    setGridDraggedItem(null);
    setGridDragOverCell(null);
  };

  const handleGridTouchStart = (e, groupId, optionalId) => {
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };
    touchMoveDistance.current = 0;
    setGridDraggedItem({ groupId, optionalId });
  };

  const handleGridTouchMove = (e) => {
    if (!gridDraggedItem || !touchStartPos.current) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartPos.current.x;
    const deltaY = touch.clientY - touchStartPos.current.y;
    touchMoveDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (touchMoveDistance.current > DRAG_THRESHOLD) {
      const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);
      if (elementAtPoint) {
        const cellElement = elementAtPoint.closest('[data-grid-cell]');
        if (cellElement) {
          const row = Number(cellElement.getAttribute('data-row'));
          const column = Number(cellElement.getAttribute('data-column'));
          const groupId = cellElement.getAttribute('data-group-id');
          if (groupId === gridDraggedItem.groupId) {
            setGridDragOverCell({ groupId, row, column });
          }
        }
      }
    }
  };

  const handleGridTouchEnd = () => {
    if (touchMoveDistance.current >= DRAG_THRESHOLD && gridDraggedItem && gridDragOverCell && gridDraggedItem.groupId === gridDragOverCell.groupId) {
      moverOIntercambiar(gridDraggedItem.groupId, gridDraggedItem.optionalId, { row: gridDragOverCell.row, column: gridDragOverCell.column });
    }
    setGridDraggedItem(null);
    setGridDragOverCell(null);
    touchStartPos.current = null;
    touchMoveDistance.current = 0;
  };

  const handleOptionalClick = (e, groupId, optionalId, isDisabled) => {
    if (isEditMode) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isDisabled) {
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

    finalSelection.selectedOptionals = selectedWithDetails;
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

          {!isEditMode && (
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
          )}
          {isEditMode && (
            <div className="flex-1 text-center">
              <span className="text-xs font-bold uppercase tracking-wide text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-3 py-1">
                Editando distribución — arrastrá los sabores a la celda que quieras
              </span>
            </div>
          )}

          <div className="flex items-center space-x-2 flex-shrink-0">
            {!isEditMode && (
              <Button
                variant="outline"
                onClick={handleToggleEditMode}
                className="border-orange-300 text-orange-700 h-9 px-3 text-sm font-semibold hover:bg-orange-50"
              >
                <LayoutGrid className="h-4 w-4 mr-1.5" />
                Editar distribución
              </Button>
            )}
            {isEditMode && (
              <>
                <Button
                  variant="outline"
                  onClick={handleToggleEditMode}
                  disabled={savingGrid}
                  className="border-gray-300 text-gray-700 h-9 px-3 text-sm font-semibold hover:bg-gray-100"
                >
                  <XIcon className="h-4 w-4 mr-1.5" />
                  Salir sin guardar
                </Button>
                <Button
                  onClick={handleGuardarDistribucion}
                  disabled={savingGrid}
                  className="bg-orange-600 hover:bg-orange-700 text-white h-9 px-4 text-sm font-bold shadow-sm"
                >
                  {savingGrid ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                  Guardar distribución
                </Button>
              </>
            )}
            {!isEditMode && (
              <>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="border-gray-300 text-gray-700 h-9 px-4 text-sm font-semibold hover:bg-gray-100"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={isLoadingGrid}
                  className="bg-green-600 hover:bg-green-700 text-white h-9 px-6 text-sm font-bold shadow-sm"
                >
                  {isLoadingGrid ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cargando...
                    </>
                  ) : (
                    isPromoItem ? (promoItemIndex < promoTotalItems - 1 ? 'Siguiente' : 'Finalizar Promo') : 'Confirmar'
                  )}
                </Button>
              </>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoadingGrid ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <span className="ml-3 text-slate-600">Cargando distribución guardada...</span>
            </div>
          ) : (
            getArticleOptionalGroupConfig.map(groupConfig => {
              const groupId = groupConfig.id;
              const groupInfo = allOptionalGroups?.find(g => g.id === groupId);
              const grid = gridsByGroup[groupId] || grillaPorDefecto();

              const groupName = groupInfo ? groupInfo.nombre : `Grupo ${groupId}`;
              const currentTotal = Object.values(selectedOptionals[groupId] || {}).reduce((sum, qty) => sum + qty, 0);

              const idsEnGrupo = Object.keys(grid.positions);
              if (!isEditMode && idsEnGrupo.length === 0) return null;

              const columnasArray = Array.from({ length: grid.columns }, (_, i) => i + 1);
              const filasArray = Array.from({ length: grid.rows }, (_, i) => i + 1);
              const hayAlgunTitulo = columnasArray.some(c => !!grid.columnTitles[c]);

              // Mapa celda -> optionalId, para no hacer .find() por celda.
              const celdaAOptionalId = {};
              for (const [id, pos] of Object.entries(grid.positions)) {
                celdaAOptionalId[`${pos.row}:${pos.column}`] = id;
              }

              const renderTarjeta = (opcional) => {
                const isDisabled = opcional.activo === false || opcional.status === false;
                const isFocused = focusedOptional?.optionalId === opcional.id && !isDisabled && !isEditMode;
                const qty = selectedOptionals[groupId]?.[opcional.id] || 0;
                const isSelected = qty > 0;
                const isBeingDragged = isEditMode && gridDraggedItem?.optionalId === opcional.id && gridDraggedItem?.groupId === groupId;

                return (
                  <div
                    key={opcional.id}
                    ref={el => optionalRefs.current[opcional.id] = el}
                    data-optional-id={opcional.id}
                    data-group-id={groupId}
                    draggable={isEditMode && !isDisabled}
                    onDragStart={(e) => isEditMode && !isDisabled && handleGridDragStart(e, groupId, opcional.id)}
                    onDragEnd={handleGridDragEnd}
                    onTouchStart={(e) => isEditMode && !isDisabled && handleGridTouchStart(e, groupId, opcional.id)}
                    onTouchMove={isEditMode ? handleGridTouchMove : undefined}
                    onTouchEnd={isEditMode ? handleGridTouchEnd : undefined}
                    className={`relative flex flex-row items-center justify-between px-1.5 py-0.5 h-[32px] rounded border transition-all duration-150 ${
                      isDisabled ? 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed grayscale' :
                      isBeingDragged ? 'opacity-50 shadow-lg scale-105 cursor-grabbing' :
                      isFocused ? 'ring-1 ring-orange-500 border-orange-500 bg-orange-50/50 shadow-sm cursor-grab' :
                      isSelected ? 'border-orange-400 bg-orange-50/80' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                    } ${isEditMode && !isDisabled ? 'cursor-grab' : ''}`}
                    style={{
                      gridRow: opcional.__row,
                      gridColumn: opcional.__column,
                      transform: isBeingDragged ? 'rotate(2deg)' : 'none',
                      boxShadow: isBeingDragged ? '0 8px 16px rgba(0,0,0,0.2)' : undefined,
                      touchAction: 'manipulation',
                      WebkitTouchCallout: 'none',
                      WebkitUserSelect: 'none',
                      userSelect: 'none'
                    }}
                    title={isDisabled ? `${opcional.nombre} (Sin Stock/Inactivo)` : opcional.nombre}
                  >
                    <div
                      onClick={(e) => handleOptionalClick(e, groupId, opcional.id, isDisabled)}
                      className={`flex items-center h-full flex-1 pr-1 select-none overflow-hidden ${
                        isDisabled ? 'text-gray-400' :
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
                        disabled={isDisabled || isEditMode}
                        className={`h-6 w-6 shrink-0 rounded-sm border-gray-300 hover:bg-gray-100 ${isSelected ? 'bg-white' : 'bg-gray-50'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isDisabled || isEditMode) e.preventDefault();
                          else handleQuantityChange(groupId, opcional.id, -1);
                        }}
                        style={{ touchAction: 'manipulation' }}
                      >
                        <Minus className="h-3 w-3 text-slate-700" />
                      </Button>
                      <span className={`text-xs font-black w-4 text-center tabular-nums ${
                        isDisabled ? 'text-gray-400' :
                        isSelected ? 'text-orange-600' : 'text-slate-800'
                      }`}>
                        {qty}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={isDisabled || isEditMode}
                        className={`h-6 w-6 shrink-0 rounded-sm border-gray-300 hover:bg-gray-100 ${isSelected ? 'bg-white' : 'bg-gray-50'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isDisabled || isEditMode) e.preventDefault();
                          else handleQuantityChange(groupId, opcional.id, 1);
                        }}
                        style={{ touchAction: 'manipulation' }}
                      >
                        <Plus className="h-3 w-3 text-slate-700" />
                      </Button>
                    </div>
                  </div>
                );
              };

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
                      </div>
                      <div className="bg-white px-2 py-0.5 rounded border shadow-sm flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500 uppercase">Selec:</span>
                        <span className="text-sm font-black text-orange-600">
                            {currentTotal} / {groupConfig.max}
                        </span>
                      </div>
                  </div>

                  {isEditMode && (
                    <div className="flex items-center gap-3 mb-2 bg-orange-50 border border-orange-200 rounded px-3 py-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-orange-800">
                        Filas
                        <Input
                          type="number"
                          min={1}
                          value={grid.rows}
                          onChange={(e) => handleDimensionesChange(groupId, Number(e.target.value) || 1, grid.columns)}
                          className="h-7 w-16 text-xs bg-white"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-orange-800">
                        Columnas
                        <Input
                          type="number"
                          min={1}
                          value={grid.columns}
                          onChange={(e) => handleDimensionesChange(groupId, grid.rows, Number(e.target.value) || 1)}
                          className="h-7 w-16 text-xs bg-white"
                        />
                      </label>
                      <span className="text-[11px] text-orange-700">
                        Arrastrá un sabor a otra celda para moverlo o intercambiarlo. Las celdas vacías quedan vacías.
                      </span>
                    </div>
                  )}

                  {(isEditMode || hayAlgunTitulo) && (
                    <div className="grid gap-1.5 mb-1" style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0,1fr))` }}>
                      {columnasArray.map(col => (
                        isEditMode ? (
                          <input
                            key={col}
                            type="text"
                            value={grid.columnTitles[col] || ''}
                            onChange={(e) => handleTituloColumnaChange(groupId, col, e.target.value)}
                            placeholder={`Columna ${col}`}
                            className="text-[11px] font-bold uppercase text-center border border-dashed border-orange-300 rounded px-1 py-1 bg-white text-orange-700 placeholder:text-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-400"
                          />
                        ) : (
                          <div key={col} className="text-[11px] font-black uppercase text-center text-slate-500 tracking-wide truncate">
                            {grid.columnTitles[col] || ''}
                          </div>
                        )
                      ))}
                    </div>
                  )}

                  <div
                    className="grid gap-1.5"
                    style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0,1fr))`, gridAutoRows: '32px' }}
                  >
                    {isEditMode
                      // Modo edición: se recorre TODA la cuadrícula (incluidas las
                      // celdas vacías) para que sean blancos de drop visibles.
                      ? filasArray.flatMap(row => columnasArray.map(column => {
                          const optionalId = celdaAOptionalId[`${row}:${column}`];
                          const opcional = optionalId ? (allOptionals || []).find(op => op.id === optionalId && op.grupo === groupId) : null;
                          const isDragOverAqui = gridDragOverCell?.groupId === groupId && gridDragOverCell?.row === row && gridDragOverCell?.column === column;

                          if (opcional) {
                            return renderTarjeta({ ...opcional, __row: row, __column: column });
                          }
                          return (
                            <div
                              key={`empty-${row}-${column}`}
                              data-grid-cell
                              data-row={row}
                              data-column={column}
                              data-group-id={groupId}
                              onDragOver={(e) => handleGridDragOverCell(e, groupId, row, column)}
                              onDrop={(e) => handleGridDrop(e, groupId, row, column)}
                              style={{ gridRow: row, gridColumn: column }}
                              className={`h-[32px] rounded border border-dashed ${
                                isDragOverAqui ? 'border-orange-500 bg-orange-100' : 'border-gray-200 bg-gray-50/50'
                              }`}
                            />
                          );
                        }))
                      // Modo normal: solo se pintan las celdas OCUPADAS, cada una
                      // con su posición explícita — nunca se dejan huecos rellenados.
                      : Object.entries(grid.positions).map(([optionalId, pos]) => {
                          const opcional = (allOptionals || []).find(op => op.id === optionalId && op.grupo === groupId);
                          if (!opcional) return null;
                          return renderTarjeta({ ...opcional, __row: pos.row, __column: pos.column });
                        })
                    }
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
