
import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, UploadCloud, Users } from 'lucide-react';

const ClientImporter = ({ importClients }) => {
  const [isImporting, setIsImporting] = useState(false);
  const importClientsInputRef = useRef(null);
  const { toast } = useToast();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        processData(data);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error al leer el archivo",
          description: "El formato del archivo es inválido.",
        });
        setIsImporting(false);
      }
    };
    reader.onerror = () => {
      toast({
        variant: "destructive",
        title: "Error de archivo",
        description: "No se pudo leer el archivo seleccionado.",
      });
      setIsImporting(false);
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const processData = async (data) => {
    if (!data || data.length < 1) {
      toast({ variant: "destructive", title: "Archivo vacío", description: "El archivo de Excel no contiene datos." });
      setIsImporting(false);
      return;
    }

    const clients = data
      .slice(1) // Skip header row
      .map(row => ({
        phone: String(row[0] || '').trim(),
        address: String(row[1] || '').trim(),
        name: String(row[2] || '').trim(),
      }))
      .filter(client => client.phone);

    if (clients.length === 0) {
      toast({ variant: "destructive", title: "Sin datos válidos", description: "No se encontraron clientes con teléfono." });
      setIsImporting(false);
      return;
    }

    try {
      await importClients(clients);
      toast({
        title: "¡Importación exitosa!",
        description: `${clients.length} clientes han sido importados/actualizados.`,
        className: "bg-green-500 text-white",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error en la importación",
        description: "Ocurrió un error al guardar los clientes.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="pt-4 border-t border-primary/20">
      <Label className="font-semibold flex items-center mb-2"><Users className="mr-2 h-4 w-4" /> Importar Clientes</Label>
      <div className="flex items-center space-x-2">
        <Input
          type="file"
          ref={importClientsInputRef}
          className="hidden"
          accept=".xlsx, .xls"
          onChange={handleFileChange}
        />
        <Button
          variant="outline"
          onClick={() => importClientsInputRef.current.click()}
          disabled={isImporting}
        >
          {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
          {isImporting ? 'Importando...' : 'Seleccionar Excel'}
        </Button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        El archivo debe tener 3 columnas: Teléfono, Dirección, Nombre. La primera fila se ignora.
      </p>
    </div>
  );
};

export default ClientImporter;
