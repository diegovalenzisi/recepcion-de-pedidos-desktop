import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function GroupProductSelectionModal({ isOpen, choice, currentIndex, totalChoices, onSelect }) {
  if (!choice) return null;

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

export default GroupProductSelectionModal;
