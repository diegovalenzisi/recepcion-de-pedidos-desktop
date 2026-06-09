import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Edit3, Trash2, CheckCircle2 } from 'lucide-react';
import { useWhatsAppMessageStorage } from '@/hooks/useWhatsAppMessageStorage';
import WhatsAppMessageEditorModal from './WhatsAppMessageEditorModal';
import { generateDeliveryWhatsAppMessage } from '@/lib/whatsapp/delivery';

export default function WhatsAppMessageManager({ delivererId, delivererName, sampleOrder }) {
  const { lastMessage, loading, saveMessage, clearMessage } = useWhatsAppMessageStorage(delivererId);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  if (!delivererId) return null;

  const handleGenerateSample = () => {
    // We generate a dummy message if no sample order is provided just to show the format
    if (sampleOrder) {
      return generateDeliveryWhatsAppMessage(sampleOrder, [], null, null, null);
    }
    return `Hola soy ${delivererName || 'tu repartidor'}, estoy en camino con tu pedido! 🛵\nGracias por elegirnos.`;
  };

  return (
    <Card className="mb-4 bg-primary/5 border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-primary-foreground text-sm">
              Mensaje WhatsApp para {delivererName || 'Repartidor'}
            </h3>
          </div>
          {lastMessage && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              Usando mensaje guardado
            </span>
          )}
        </div>

        {loading ? (
          <div className="animate-pulse flex space-x-4">
            <div className="h-4 bg-primary/20 rounded w-3/4"></div>
          </div>
        ) : lastMessage ? (
          <div className="space-y-3">
            <div className="bg-white p-3 rounded-md border text-sm text-gray-700 whitespace-pre-wrap">
              {lastMessage}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setIsEditorOpen(true)}>
                <Edit3 className="w-4 h-4 mr-2" />
                Editar Mensaje
              </Button>
              <Button size="sm" variant="ghost" onClick={clearMessage} className="text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              No hay un mensaje personalizado guardado. Se usará el mensaje automático por defecto.
            </p>
            <Button size="sm" onClick={() => setIsEditorOpen(true)}>
              Crear Mensaje Personalizado
            </Button>
          </div>
        )}

        <WhatsAppMessageEditorModal 
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          initialMessage={lastMessage || handleGenerateSample()}
          onSave={saveMessage}
          onGenerateNew={handleGenerateSample}
        />
      </CardContent>
    </Card>
  );
}