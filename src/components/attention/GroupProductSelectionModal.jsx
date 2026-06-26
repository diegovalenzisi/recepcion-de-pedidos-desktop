import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function GroupProductSelectionModal({ isOpen, choice, currentIndex, totalChoices, onSelect }) {
  const [selected, setSelected] = useState([]);      // single-select: string[]
  const [quantities, setQuantities] = useState({});   // multi-select: { [articleId]: number }

  useEffect(() => {
    setSelected([]);
    setQuantities({});
  }, [choice?.nombre, currentIndex]);

  if (!choice) return null;

  // ── Single-select (comportamiento original) ──────────────────────────────
  if (!choice.isMultiSelect) {
    return (
      <Dialog open={isOpen} onOpenChange={() => {}}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Elegí: {choice.nombre}
              {totalChoices > 1 && (
                <span className="block text-sm font-normal text-gray-500 mt-1">
                  Opción {currentIndex + 1} de {totalChoices}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            {choice.options.map(article => (
              <Button
                key={article.id}
                type="button"
                variant="outline"
                className="h-auto min-h-[3rem] py-3 px-4 text-base whitespace-normal text-center"
                onClick={() => onSelect(article.id)}
              >
                {article.nombre}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Multi-select con cantidades por artículo ──────────────────────────────
  // El total de unidades elegidas debe estar entre min y max.
  // Cada artículo puede elegirse 0, 1, 2... N veces (no hay límite por artículo,
  // solo el límite total del grupo). Backward compat: el output sigue siendo
  // string[] con IDs repetidos — usePromo y transactionsApi lo manejan sin cambios.
  const min = choice.minSeleccion ?? 0;
  const max = choice.maxSeleccion ?? null;
  const total = Object.values(quantities).reduce((sum, q) => sum + q, 0);
  const atMax = max !== null && total >= max;
  const canConfirm = total >= min && (max === null || total <= max);

  const increment = (articleId) => {
    if (atMax) return;
    setQuantities(prev => ({ ...prev, [articleId]: (prev[articleId] || 0) + 1 }));
  };

  const decrement = (articleId) => {
    setQuantities(prev => {
      const current = prev[articleId] || 0;
      if (current <= 0) return prev;
      return { ...prev, [articleId]: current - 1 };
    });
  };

  const handleConfirm = () => {
    // Expandir cantidades a array con IDs repetidos: { A1:2, A2:1 } → ['A1','A1','A2']
    const expanded = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .flatMap(([id, qty]) => Array.from({ length: qty }, () => id));
    onSelect(expanded);
  };

  const rangeLabel =
    min > 0 && max !== null && min === max ? `Elegí exactamente ${min} producto${min !== 1 ? 's' : ''}` :
    min > 0 && max !== null ? `Elegí entre ${min} y ${max} productos` :
    min > 0 ? `Elegí al menos ${min} producto${min !== 1 ? 's' : ''}` :
    max !== null ? `Elegí hasta ${max} producto${max !== 1 ? 's' : ''}` :
    null;

  const validationMsg =
    total > 0 && total < min
      ? `Debés elegir al menos ${min} en total para ${choice.nombre}.`
      : atMax
        ? `Máximo ${max} unidades en total. Bajá la cantidad de algún artículo para cambiar.`
        : null;

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Elegí: {choice.nombre}
            {rangeLabel && (
              <span className="block text-sm font-normal text-gray-500 mt-1">{rangeLabel}</span>
            )}
            {totalChoices > 1 && (
              <span className="block text-sm font-normal text-gray-500 mt-0.5">
                Grupo {currentIndex + 1} de {totalChoices}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-1 max-h-[50vh] overflow-y-auto pr-1">
          {choice.options.map(article => {
            const qty = quantities[article.id] || 0;
            return (
              <div
                key={article.id}
                className={`flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors
                  ${qty > 0 ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
              >
                <span className="text-sm font-medium flex-1">{article.nombre}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => decrement(article.id)}
                    disabled={qty === 0}
                    className="w-7 h-7 rounded-full border border-gray-300 text-base font-bold leading-none
                      flex items-center justify-center
                      disabled:opacity-30 disabled:cursor-not-allowed
                      hover:enabled:bg-red-50 hover:enabled:border-red-300 transition-colors"
                  >−</button>
                  <span className="w-6 text-center font-mono font-semibold text-sm">{qty}</span>
                  <button
                    type="button"
                    onClick={() => increment(article.id)}
                    disabled={atMax}
                    className="w-7 h-7 rounded-full border border-gray-300 text-base font-bold leading-none
                      flex items-center justify-center
                      disabled:opacity-30 disabled:cursor-not-allowed
                      hover:enabled:bg-green-50 hover:enabled:border-green-300 transition-colors"
                  >+</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Total elegido: <span className={`font-semibold ${canConfirm ? 'text-green-600' : 'text-gray-600'}`}>{total}</span>
              {max !== null ? ` / ${max}` : ''}
            </span>
            {min > 0 && total < min && (
              <span className="text-gray-400 text-xs">
                Falta{min - total !== 1 ? 'n' : ''} {min - total}
              </span>
            )}
          </div>

          {validationMsg && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {validationMsg}
            </p>
          )}

          <Button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            className="w-full"
          >
            Confirmar selección{canConfirm && total > 0 && ` (${total})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default GroupProductSelectionModal;
