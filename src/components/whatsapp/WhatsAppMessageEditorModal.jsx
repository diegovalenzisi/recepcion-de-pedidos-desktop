import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Save, Loader2, Sparkles } from 'lucide-react';

export default function WhatsAppMessageEditorModal({ isOpen, onClose, initialMessage, onSave, onGenerateNew }) {
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMessage(initialMessage || '');
    }
  }, [isOpen, initialMessage]);

  const handleSave = async () => {
    if (!message.trim()) return;
    setIsSaving(true);
    try {
      await onSave(message);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerate = () => {
    if (onGenerateNew) {
      const generated = onGenerateNew();
      if (generated) setMessage(generated);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            Editar Mensaje de WhatsApp
          </DialogTitle>
          <DialogDescription>
            Personaliza el mensaje que se enviará cuando se asigne este repartidor.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <Textarea 
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escribe aquí tu mensaje de WhatsApp..."
            className="min-h-[150px] resize-none focus-visible:ring-primary"
          />
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>{message.length} caracteres</span>
            <Button variant="ghost" size="sm" onClick={handleGenerate} className="text-primary hover:text-primary/80">
              <Sparkles className="w-4 h-4 mr-2" />
              Generar Automático
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!message.trim() || isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Guardar Mensaje
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}