
import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ArrowRightLeft, Building2, CheckCircle2 } from 'lucide-react';
import { migrateProvidersToSequentialIds } from '@/lib/api/providerIdUtils';

const ProviderMigrationManager = () => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const { toast } = useToast();

  const handleMigration = async () => {
    if (!window.confirm('¿Está seguro de que desea migrar todos los proveedores a IDs correlativos? Esta acción actualizará también los remitos y no se puede deshacer.')) {
      return;
    }

    setIsMigrating(true);
    setMigrationResult(null);

    try {
      const result = await migrateProvidersToSequentialIds();
      setMigrationResult(result);
      
      if (result.migrated > 0) {
        toast({
          title: "Migración Exitosa",
          description: result.message,
          className: "bg-green-50 border-green-200 text-green-800"
        });
      } else {
        toast({
          title: "Aviso de Migración",
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error during migration:', error);
      toast({
        variant: "destructive",
        title: "Error en la migración",
        description: error.message || "Ocurrió un error inesperado al migrar los proveedores."
      });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          Migración de IDs de Proveedores
        </CardTitle>
        <CardDescription>
          Convierte los IDs aleatorios de proveedores (Firebase keys) en IDs numéricos correlativos (1, 2, 3...). También actualiza automáticamente las referencias en los remitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {!migrationResult && (
          <div className="bg-amber-50 text-amber-800 p-4 rounded-md text-sm">
            <p className="font-semibold mb-1">¡Atención!</p>
            <p>Asegúrese de que nadie esté creando o editando proveedores o remitos durante este proceso.</p>
          </div>
        )}

        {migrationResult && migrationResult.migrated > 0 && (
          <div className="bg-green-50 text-green-800 p-4 rounded-md flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 mt-0.5 text-green-600 shrink-0" />
            <div>
              <p className="font-semibold">¡Migración Completada!</p>
              <p className="text-sm mt-1">{migrationResult.message}</p>
              <div className="mt-2 text-xs opacity-80 max-h-32 overflow-y-auto">
                {Object.entries(migrationResult.mapping).map(([oldId, newId]) => (
                  <div key={oldId} className="flex gap-2">
                    <span className="truncate w-32">{oldId}</span>
                    <ArrowRightLeft className="w-3 h-3 mt-0.5" />
                    <span className="font-mono font-bold">{newId}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {migrationResult && migrationResult.migrated === 0 && (
          <div className="bg-blue-50 text-blue-800 p-4 rounded-md">
            <p>{migrationResult.message}</p>
          </div>
        )}

        <Button 
          onClick={handleMigration} 
          disabled={isMigrating}
          className="w-full sm:w-auto"
        >
          {isMigrating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Migrando...
            </>
          ) : (
            <>
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Migrar Proveedores a IDs Correlativos
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ProviderMigrationManager;
