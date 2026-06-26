
import React, { useState, useEffect } from 'react';
import { getLocalId } from '@/lib/firebase/core';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Copy, Fingerprint, Save } from 'lucide-react';

const LocalIdManager = () => {
  const [editedLocalId, setEditedLocalId] = useState('');
  const { toast } = useToast();
  const { changeLocalId } = useAuth();

  useEffect(() => {
    const currentId = getLocalId();
    if (currentId) {
      setEditedLocalId(currentId);
    }
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(editedLocalId);
    toast({
      title: "ID Local Copiado",
      description: "El ID ha sido copiado al portapapeles.",
      className: "bg-blue-500 text-white"
    });
  };

  const handleSave = () => {
    if (!editedLocalId || editedLocalId.trim() === '') {
        toast({
            variant: "destructive",
            title: "Error",
            description: "El ID del Local no puede estar vacío."
        });
        return;
    }
    
    changeLocalId(editedLocalId.trim());

    toast({
        title: "ID Local Guardado",
        description: "El nuevo ID ha sido guardado. La aplicación se reiniciará.",
        className: "bg-green-500 text-white"
    });
  };

  return (
    <div className="pt-4 border-t border-primary/20">
      <Label className="font-semibold flex items-center mb-2"><Fingerprint className="mr-2 h-4 w-4" /> ID del Local</Label>
      <div className="flex items-center space-x-2">
        <Input 
          type="text" 
          value={editedLocalId}
          onChange={(e) => setEditedLocalId(e.target.value)} 
          className="font-mono text-sm" 
        />
        <Button variant="outline" size="icon" onClick={handleCopy} aria-label="Copiar ID del Local">
          <Copy className="h-4 w-4" />
        </Button>
        <Button size="icon" onClick={handleSave} aria-label="Guardar ID del Local">
          <Save className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default LocalIdManager;
