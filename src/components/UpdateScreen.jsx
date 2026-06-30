import React from 'react';
import { Loader2, Download, RefreshCw, AlertTriangle, ArrowDownCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const UpdateScreen = ({ status, info, mandatory = false, downloadProgress = 0, onUpdate, onSkip, onRetry }) => {
  const isChecking = status === 'checking';
  const isAvailable = status === 'available';
  const isDownloading = status === 'downloading';
  const isError = status === 'error';

  return (
    <div className="fixed inset-0 bg-gray-900/95 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-10 max-w-md w-full mx-4 text-center space-y-6">

        {/* Ícono animado */}
        <div className="flex justify-center">
          {isError ? (
            <AlertTriangle className="h-16 w-16 text-red-500" />
          ) : isAvailable ? (
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <ArrowDownCircle className="h-9 w-9 text-primary" />
            </div>
          ) : (
            <div className="relative h-16 w-16">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                {isChecking
                  ? <RefreshCw className="h-8 w-8 text-primary" />
                  : <Download className="h-8 w-8 text-primary" />
                }
              </div>
              <Loader2 className="absolute inset-0 h-16 w-16 text-primary animate-spin" />
            </div>
          )}
        </div>

        {/* Título y descripción */}
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            {isChecking && 'Buscando actualizaciones...'}
            {isAvailable && (mandatory ? 'Actualización obligatoria' : 'Actualización disponible')}
            {isDownloading && 'Descargando actualización'}
            {isError && 'Error al actualizar'}
          </h2>

          {isChecking && (
            <p className="text-gray-400 text-sm">Un momento...</p>
          )}

          {isAvailable && (
            <p className="text-gray-500 text-sm">
              {mandatory
                ? 'Hay una actualización obligatoria disponible. Debés actualizar para continuar.'
                : `Hay una nueva versión disponible${info?.version ? ` (${info.version})` : ''}. Podés actualizar ahora o continuar sin actualizar.`}
            </p>
          )}

          {isDownloading && info?.version && (
            <p className="text-gray-500 text-sm">
              Versión {info.version} disponible. La aplicación se cerrará y se instalará automáticamente.
            </p>
          )}

          {isError && (
            <p className="text-gray-500 text-sm">
              No se pudo descargar la actualización. Verificá la conexión a internet.
            </p>
          )}
        </div>

        {/* Barra de progreso de descarga */}
        {isDownloading && (
          <div className="space-y-2 w-full">
            <Progress value={downloadProgress} className="h-3" />
            <p className="text-sm font-semibold text-primary">{downloadProgress}%</p>
          </div>
        )}

        {/* Botones cuando hay una actualización disponible (antes del login) */}
        {isAvailable && (
          <div className="flex gap-3 justify-center">
            {onUpdate && (
              <Button onClick={onUpdate} className="bg-primary text-white">
                <Download className="h-4 w-4 mr-2" /> Actualizar ahora
              </Button>
            )}
            {!mandatory && onSkip && (
              <Button variant="outline" onClick={onSkip}>
                Continuar sin actualizar
              </Button>
            )}
          </div>
        )}

        {/* Botones en caso de error */}
        {isError && (
          <div className="flex gap-3 justify-center">
            {onRetry && (
              <Button onClick={onRetry} className="bg-primary text-white">
                <RefreshCw className="h-4 w-4 mr-2" /> Reintentar
              </Button>
            )}
            {!mandatory && onSkip && (
              <Button variant="outline" onClick={onSkip}>
                Continuar sin actualizar
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400">DLV Sistemas</p>
      </div>
    </div>
  );
};

export default UpdateScreen;
