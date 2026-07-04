import React from 'react';
import { Loader2, Download, AlertTriangle, RefreshCw, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/**
 * Pantalla del bootstrap de dependencias de facturación (primer inicio en PC nueva).
 * status: 'checking' | 'installing' | 'error'
 */
const DepsBootstrapScreen = ({ status, label = '', pct = null, error = '', onRetry, onContinue }) => {
  const isChecking = status === 'checking';
  const isInstalling = status === 'installing';
  const isError = status === 'error';

  return (
    <div className="fixed inset-0 bg-gray-900/95 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-10 max-w-md w-full mx-4 text-center space-y-6">
        <div className="flex justify-center">
          {isError ? (
            <AlertTriangle className="h-16 w-16 text-red-500" />
          ) : (
            <div className="relative h-16 w-16">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Download className="h-8 w-8 text-primary" />
              </div>
              <Loader2 className="absolute inset-0 h-16 w-16 text-primary animate-spin" />
            </div>
          )}
        </div>

        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {isChecking && 'Verificando sistema de facturación...'}
            {isInstalling && 'Preparando sistema de facturación'}
            {isError && 'No se pudo preparar la facturación'}
          </h2>
          {isChecking && <p className="text-gray-400 text-sm">Un momento...</p>}
          {isInstalling && (
            <p className="text-gray-500 text-sm">
              Descargando e instalando componentes. Esto puede tardar unos minutos.
              No cierres la aplicación.
            </p>
          )}
          {isError && (
            <p className="text-gray-500 text-sm">
              {error || 'Verificá la conexión a internet e intentá de nuevo.'}
            </p>
          )}
        </div>

        {isInstalling && (
          <div className="space-y-2 w-full">
            {label && <p className="text-sm font-medium text-gray-600">{label}</p>}
            {typeof pct === 'number' && (
              <>
                <Progress value={pct} className="h-3" />
                <p className="text-sm font-semibold text-primary">{pct}%</p>
              </>
            )}
          </div>
        )}

        {isError && (
          <div className="flex gap-3 justify-center">
            {onRetry && (
              <Button onClick={onRetry} className="bg-primary text-white">
                <RefreshCw className="h-4 w-4 mr-2" /> Reintentar
              </Button>
            )}
            {onContinue && (
              <Button variant="outline" onClick={onContinue}>
                <LogIn className="h-4 w-4 mr-2" /> Continuar sin facturación
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400">DLV Sistemas</p>
      </div>
    </div>
  );
};

export default DepsBootstrapScreen;
