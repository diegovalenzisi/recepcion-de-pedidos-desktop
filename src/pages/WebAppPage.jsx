import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { Globe, Loader2, ExternalLink, Settings2, AlertCircle } from 'lucide-react';
import { fetchSettings } from '@/lib/api/settingsApi';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export default function WebAppPage() {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    
    const loadSettings = async () => {
      try {
        setLoading(true);
        const settings = await fetchSettings();
        if (isMounted) {
          // Normalize URL: ensure it starts with http:// or https:// if present
          let rawUrl = settings?.web?.webOrderUrl;
          if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
            rawUrl = 'https://' + rawUrl;
          }
          setUrl(rawUrl || null);
        }
      } catch (error) {
        console.error('Error fetching web settings:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    
    loadSettings();
    return () => { isMounted = false; };
  }, []);

  const handleIframeError = () => {
    setIframeError(true);
  };

  return (
    <>
      <Helmet>
        <title>App Web - DLV Sistemas</title>
        <meta name="description" content="Visualización de la aplicación web de pedidos." />
      </Helmet>
      
      {/* Container: Full height available, flex layout */}
      <div className="max-w-6xl mx-auto h-[calc(100vh-8rem)] flex flex-col animate-in fade-in duration-500">
        
        {/* Header Section */}
        <div className="mb-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 flex-shrink-0">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
              <Globe className="h-8 w-8 text-cyan-600" />
              App Web
            </h1>
            <p className="text-gray-500 mt-1 text-lg">
              Visualiza y prueba tu aplicación de pedidos en tiempo real.
            </p>
          </div>
          
          {url && (
            <Button asChild variant="outline" className="gap-2 bg-white shadow-sm border-gray-200 hover:bg-gray-50 text-gray-700">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Abrir en nueva pestaña <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>

        {/* Main Content Area: Flex-1 to fill remaining space */}
        <div className="flex-1 min-h-[400px] relative rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-cyan-500" />
              <p className="text-sm font-medium">Cargando aplicación web...</p>
            </div>
          ) : !url ? (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-gray-50/50">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-5 shadow-inner">
                <Globe className="h-10 w-10 text-gray-400" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">No hay dirección web configurada</h3>
              <p className="text-gray-500 max-w-md mb-8 text-base">
                Para visualizar tu plataforma de pedidos en esta sección, primero debes ingresar la "Dirección Web de Pedidos" (URL) en los ajustes del sistema.
              </p>
              <Button asChild className="bg-cyan-600 hover:bg-cyan-700 text-white shadow-md">
                <Link to="/configuracion">
                  <Settings2 className="h-5 w-5 mr-2" />
                  Ir a Configuración
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {iframeError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm p-6 text-center">
                  <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
                  <h3 className="text-xl font-bold text-gray-800 mb-2">No se pudo cargar la página</h3>
                  <p className="text-gray-600 max-w-md mb-6">
                    Es posible que la URL configurada ({url}) no permita ser incrustada, no exista, o requiera abrirse en una nueva pestaña.
                  </p>
                  <Button asChild variant="default" className="bg-cyan-600 hover:bg-cyan-700">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      Abrir aplicación en nueva pestaña <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                </div>
              )}
              
              <iframe 
                src={url} 
                title="App Web de Pedidos"
                className="w-full h-full border-0 bg-gray-50 flex-1"
                allow="geolocation; microphone; camera; fullscreen"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                onError={handleIframeError}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}