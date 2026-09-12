import React, { useState, useEffect, Suspense } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';
import { fetchSettings, saveSettings, fetchAudioSetting } from '@/lib/api/settingsApi.js';
import { reloadPrintSettings } from '@/lib/print.js';
import { DEFAULT_WHATSAPP_MESSAGE, DEFAULT_ASSIGN_DELIVERER_MESSAGE } from '@/lib/whatsapp/paymentMessage';
import { Loader2, Building, Globe, MapPin, ShieldCheck } from 'lucide-react';
import { useAuth, ADMIN_USERNAME } from '@/hooks/useAuth';

const LocalSettings = React.lazy(() => import('@/components/settings/LocalSettings.jsx'));
const WebSettings   = React.lazy(() => import('@/components/settings/WebSettings.jsx'));
const MapsSettings  = React.lazy(() => import('@/components/settings/maps/MapsSettings.jsx'));
const AdminSettings = React.lazy(() => import('@/components/settings/AdminSettings.jsx'));

const SettingsTab = ({ to, icon: Icon, label }) => {
    const location = useLocation();
    const isActive = location.pathname === to;
    return (
        <Link
            to={to}
            className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors duration-200 ${
                isActive
                ? 'border-primary text-primary-dark'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
        >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
        </Link>
    );
};

function SettingsPage({ applySettings }) {
  const location = useLocation();
  const { user } = useAuth();
  const esDiegoL = user && user.usuario === ADMIN_USERNAME;
  const [settings, setSettings] = useState({
    razonSocial: '',
    nombreFantasia: '',
    cuit: '',
    direccion: '',
    localidad: '',
    mail: '',
    fuente: 'sans',
    fuenteImpresion: 'sans-serif',
    fontSize: 16,
    printTone: 5,
    printFontSize: 16,
    formasDePago: ['Efectivo'],
    ticketHeader: '',
    ticketFooter: '',
    showOptionalsInCounter: true,
    forceDepartmentPaymentMethod: false,
    printCounterCommand: false,
    newOrderSound: null,
    orderSoundVolume: 100,
    themeColor: 'orange',
    deliveryViewMode: 'table',
    printHorizontalOffset: 0,
    printFiscalHorizontalOffset: 0,
    web: {
        destacar: '',
        whatsappMessage: '',
        assignDelivererMessage: '',
        horarios: {},
        showOptionalsInDelivery: true,
        requireCrossStreets: false,
    }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      setLoading(true);
      console.log("[SettingsPage] Loading settings data...");
      
      try {
        const [fetchedSettings, fetchedAudio] = await Promise.all([
          fetchSettings(),
          fetchAudioSetting()
        ]);
        
        if (!isMounted) return;

        console.log("[SettingsPage] Settings data fetched successfully.");

        // Define base defaults to ensure all keys exist
        const defaults = {
            razonSocial: '', nombreFantasia: '', cuit: '', direccion: '', localidad: '', mail: '',
            fuente: 'sans', fuenteImpresion: 'sans-serif', fontSize: 16, printTone: 5, printFontSize: 16,
            formasDePago: [], ticketHeader: '', ticketFooter: '', showOptionalsInCounter: true,
            forceDepartmentPaymentMethod: false, printCounterCommand: false, themeColor: 'orange',
            orderSoundVolume: 100,
            deliveryViewMode: 'table',
            printHorizontalOffset: 0,
            printFiscalHorizontalOffset: 0,
            web: { destacar: '', whatsappMessage: DEFAULT_WHATSAPP_MESSAGE, assignDelivererMessage: DEFAULT_ASSIGN_DELIVERER_MESSAGE, horarios: {}, showOptionalsInDelivery: true, requireCrossStreets: false }
        };

        if (fetchedSettings) {
            const nextSettings = {
                ...defaults,
                ...fetchedSettings,
                fuente: fetchedSettings.fuente || 'sans',
                fuenteImpresion: fetchedSettings.fuenteImpresion || 'sans-serif',
                fontSize: fetchedSettings.fontSize || 16,
                printTone: fetchedSettings.printTone || 5,
                printFontSize: fetchedSettings.printFontSize || 16,
                formasDePago: fetchedSettings.formasDePago || ['Efectivo'],
                ticketHeader: fetchedSettings.ticketHeader || '',
                ticketFooter: fetchedSettings.ticketFooter || '',
                showOptionalsInCounter: fetchedSettings.showOptionalsInCounter !== false,
                forceDepartmentPaymentMethod: fetchedSettings.forceDepartmentPaymentMethod === true,
                printCounterCommand: fetchedSettings.printCounterCommand === true,
                orderSoundVolume: typeof fetchedSettings.orderSoundVolume === 'number' ? fetchedSettings.orderSoundVolume : 100,
                themeColor: fetchedSettings.themeColor || 'orange',
                deliveryViewMode: fetchedSettings.deliveryViewMode || fetchedSettings.deliveryScreenType || 'table',
                printHorizontalOffset: typeof fetchedSettings.printHorizontalOffset === 'number' ? fetchedSettings.printHorizontalOffset : 0,
                printFiscalHorizontalOffset: typeof fetchedSettings.printFiscalHorizontalOffset === 'number' ? fetchedSettings.printFiscalHorizontalOffset : 0,
                web: {
                    ...defaults.web,
                    ...(fetchedSettings.web || {}),
                    destacar: fetchedSettings.DESTACAR || '',
                    horarios: fetchedSettings.web?.horarios || {},
                    showOptionalsInDelivery: fetchedSettings.web?.showOptionalsInDelivery !== false,
                    requireCrossStreets: fetchedSettings.web?.requireCrossStreets === true,
                    // Si no hay mensaje personalizado guardado, precargar el predeterminado
                    // (editable/guardable desde Config web). NO pisa un mensaje existente.
                    whatsappMessage: (fetchedSettings.web?.whatsappMessage || '').trim()
                        ? fetchedSettings.web.whatsappMessage
                        : DEFAULT_WHATSAPP_MESSAGE,
                    assignDelivererMessage: (fetchedSettings.web?.assignDelivererMessage || '').trim()
                        ? fetchedSettings.web.assignDelivererMessage
                        : DEFAULT_ASSIGN_DELIVERER_MESSAGE,
                },
                newOrderSound: fetchedAudio,
            };
            
            setSettings(nextSettings);
            applySettings(nextSettings);
        } else {
             setSettings({
                ...defaults,
                formasDePago: ['Efectivo'],
                newOrderSound: fetchedAudio,
             });
        }
      } catch (error) {
        console.error("[SettingsPage] Error loading settings:", error);
        if (!isMounted) return;
        toast({
          variant: "destructive",
          title: "Error al cargar configuración",
          description: "No se pudo obtener la configuración desde la base de datos.",
        });
      } finally {
        if (isMounted) {
            setLoading(false);
            console.log("[SettingsPage] Loading state cleared.");
        }
      }
    };

    loadSettings();

    return () => {
      isMounted = false;
      console.log("[SettingsPage] Unmounting, clearing listeners/state.");
    };
  }, [toast, applySettings]); // Removed 'settings' from dependency array to prevent infinite loops

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);
      await reloadPrintSettings();
      toast({
        title: "¡Configuración guardada!",
        description: "Tus cambios se han guardado correctamente.",
        className: "bg-green-500 text-white",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudieron guardar los cambios. Inténtalo de nuevo.",
      });
    } finally {
      setSaving(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-gray-500 font-medium">Cargando configuración...</p>
      </div>
    );
  }

  // ANCHO POR PESTAÑA.
  //
  // "Configuración del Local" tiene formularios con columnas e interruptores que
  // no entraban en `max-w-6xl` (1152 px) y quedaban cortados a la derecha. Se le
  // da casi todo el ancho disponible, con tope para no deformarlo en monitores
  // muy anchos. Las otras dos pestañas (Configuración Web y Zonas de Delivery)
  // conservan exactamente el ancho que tenían.
  const enLocal = location.pathname.endsWith('/local') || location.pathname === '/configuracion';
  const enAdmin = location.pathname.endsWith('/admin');
  const anchoPestana = (enLocal || enAdmin) ? 'w-[96vw] max-w-[1600px]' : 'max-w-6xl';

  return (
    <div className={`${anchoPestana} mx-auto h-full flex flex-col`}>
        <div className="border-b border-gray-200 flex-shrink-0">
            <nav className="-mb-px flex space-x-4" aria-label="Tabs">
                <SettingsTab to="/configuracion/local" icon={Building} label="Configuración del Local" />
                <SettingsTab to="/configuracion/web" icon={Globe} label="Configuración Web" />
                <SettingsTab to="/configuracion/maps" icon={MapPin} label="Zonas de Delivery" />
                {/* Solapa EXCLUSIVA de DiegoL: ni el link se renderiza para otro
                    usuario (no solo el contenido) — así no queda ni la pestaña
                    visible ni la ruta "descubrible" desde la navegación. */}
                {esDiegoL && (
                    <SettingsTab to="/configuracion/admin" icon={ShieldCheck} label="Administrador" />
                )}
            </nav>
        </div>

        <div className="flex-grow overflow-y-auto">
            <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}>
                <Routes>
                    <Route path="/" element={<Navigate to="local" replace />} />
                    <Route
                        path="local"
                        element={
                            <LocalSettings
                                settings={settings}
                                onSettingsChange={setSettings}
                                onSave={handleSave}
                                saving={saving}
                                applySettings={applySettings}
                            />
                        }
                    />
                    <Route
                        path="web"
                        element={
                            <WebSettings
                                settings={settings}
                                onSettingsChange={setSettings}
                                onSave={handleSave}
                                saving={saving}
                            />
                        }
                    />
                    <Route
                        path="maps"
                        element={<MapsSettings />}
                    />
                    {esDiegoL && (
                        <Route
                            path="admin"
                            element={
                                <AdminSettings
                                    settings={settings}
                                    onSettingsChange={setSettings}
                                    applySettings={applySettings}
                                />
                            }
                        />
                    )}
                </Routes>
            </Suspense>
        </div>
    </div>
  );
}

export default SettingsPage;