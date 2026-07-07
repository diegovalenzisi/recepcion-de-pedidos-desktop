import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/use-toast';
import { Settings, HeartHandshake, Loader2, Warehouse, CreditCard, Archive, Users as UsersIcon, LogOut, Receipt, FileText, FileSpreadsheet, Smartphone, PieChart, DatabaseZap, Globe } from 'lucide-react';
import { permissionsList } from '@/config/permissions.js';
import { useAuth } from '@/hooks/useAuth.jsx';
import { getLocalId, setLocalId as saveLocalId, setFirebaseLocalId, initializeFirebaseApp, getFirebaseUrl, getLocationSpecificDatabaseURL, getLocationSpecificProjectId } from '@/lib/firebase/core.js';
import { fetchSettings, listenToChanges } from '@/lib/api/settingsApi.js';
import { checkOpenShift, createNewShift } from '@/lib/api/cash/index.js';
import UpdateNotification from '@/components/UpdateNotification.jsx';
import { useServiceWorker } from '@/hooks/useServiceWorker.js';
import LocalStatusIndicator from '@/components/LocalStatusIndicator.jsx';
import ShiftSummaryUpdater from '@/components/cash/ShiftSummaryUpdater.jsx';
import { formatDateForFirebase } from '@/lib/utils.js';
import { useAccounts } from '@/contexts/AccountsContext.jsx';
import { useOrderAlarm } from '@/hooks/useOrderAlarm.js';
import { useVoicePaymentAlerts } from '@/hooks/useVoicePaymentAlerts.js';
import { useMpBackendStatus } from '@/hooks/useMpBackendStatus.js';
import { useMpAccounts } from '@/hooks/useMpAccounts.js';
import VoicePaymentAlertWidget from '@/components/VoicePaymentAlertWidget.jsx';
import { useStockStatus, StockStatusContext } from '@/hooks/useStockStatus.js';
import StockStatusBadge from '@/components/management/StockStatusBadge.jsx';
import OutOfStockModal from '@/components/management/OutOfStockModal.jsx';
import { clearCache } from '@/lib/cache/cacheManager.js';
import ErrorBoundary from '@/components/ErrorBoundary.jsx';
import { perfMonitor } from '@/lib/performanceMonitor';
import InstallPrompt from '@/components/InstallPrompt.jsx';
import { useCommissionAlarm } from '@/hooks/useCommissionAlarm.js';
import CommissionAlarmModal from '@/components/CommissionAlarmModal.jsx';
import { useCommissionTotal } from '@/hooks/useCommissionTotal.js';
import { recalcularTotalComisionAPagar } from '@/lib/api/myAccountApi.js';
import UpdateScreen from '@/components/UpdateScreen.jsx';
import DepsBootstrapScreen from '@/components/DepsBootstrapScreen.jsx';
import FacturacionAutoStartWidget from '@/components/FacturacionAutoStartWidget.jsx';

const AttentionPage = React.lazy(() => import('@/pages/AttentionPage.jsx'));
const StockPage = React.lazy(() => import('@/pages/StockPage.jsx'));
const SettingsPage = React.lazy(() => import('@/pages/SettingsPage.jsx'));
const CashRegisterPage = React.lazy(() => import('@/pages/CashRegisterPage.jsx'));
const HumanResourcesPage = React.lazy(() => import('@/pages/HumanResourcesPage.jsx'));
const UsersPage = React.lazy(() => import('@/pages/UsersPage.jsx'));
const LoginPage = React.lazy(() => import('@/pages/LoginPage.jsx'));
const AccountsPage = React.lazy(() => import('@/pages/AccountsPage.jsx'));
const ExpensesPage = React.lazy(() => import('@/pages/ExpensesPage.jsx'));
const SalesPage = React.lazy(() => import('@/pages/SalesPage.jsx'));
const SalesExcelReportPage = React.lazy(() => import('@/pages/SalesExcelReportPage.jsx'));
const SalesByAppsPage = React.lazy(() => import('@/pages/SalesByAppsPage.jsx'));
const PrepaymentReportPage = React.lazy(() => import('@/pages/PrepaymentReportPage.jsx'));
const CashFundModal = React.lazy(() => import('@/components/cash/CashFundModal.jsx'));
const LocalIdSetup = React.lazy(() => import('@/components/setup/LocalIdSetup.jsx'));
const WebAppPage = React.lazy(() => import('@/pages/WebAppPage.jsx'));

const NavLink = ({ to, icon: Icon, label, userPermissions, userRole, permissionPath, badge }) => {
  const location = useLocation();
  const isActive = location.pathname.startsWith(to);
  
  const checkPath = permissionPath || to;
  const permissionGroup = permissionsList.find(p => p.navPath === checkPath);
  
  let hasAccess = false;
  
  if (permissionGroup) {
      const permissionId = permissionGroup.id;
      hasAccess = userPermissions[permissionId];
  }

  if (to === '/stock') {
    const stockPermissions = permissionGroup?.items?.map(item => item.id) || [];
    hasAccess = stockPermissions.some(p => userPermissions[p]);
  }
  if (to === '/cajas') {
    hasAccess = userPermissions.cajas || userPermissions.cajas_gestionar_fondo || userPermissions.cajas_cerrar_turno;
  }
  if (to === '/rrhh') {
      hasAccess = userPermissions.rrhh;
  }
  if (to === '/gastos') {
      hasAccess = userPermissions.gastos || userPermissions.gastos_pagos_empleados || userPermissions.gastos_registrar_gasto;
  }
  if (to === '/ventas' || to === '/ventas-apps' || to === '/reporte-excel' || to === '/reportes-prepago') {
      hasAccess = userPermissions.ventas_facturacion || userPermissions.ventas_remitos;
  }
  if (to === '/app-web') {
      hasAccess = userPermissions.configuracion || userPermissions.ventas_facturacion;
  }
  
  if (userRole === 'dueño') {
      hasAccess = true;
  }

  if (!hasAccess) return null;
  
  const activeClasses = 'bg-primary text-primary-foreground';
  const inactiveClasses = 'text-gray-600 hover:bg-primary/20 hover:text-primary-dark';

  return (
    <Link
      to={to}
      className={`px-3 py-2 text-sm font-medium flex items-center space-x-1.5 rounded-t-md transition-colors duration-200 ${
        isActive ? activeClasses : inactiveClasses
      }`}
    >
      {badge}
      {!badge && <Icon size={16} className="flex-shrink-0" />}
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
};

const ProtectedRoute = ({ children, permissions = [], userPermissions, userRole, name }) => {
    if (userRole === 'dueño') return <ErrorBoundary componentName={`Route-${name}`}>{children}</ErrorBoundary>;
    const hasAccess = permissions.some(p => userPermissions[p]);
    if (!hasAccess) {
        return <Navigate to="/atencion" replace />;
    }
    return <ErrorBoundary componentName={`Route-${name}`}>{children}</ErrorBoundary>;
};

const LoadingFallback = () => (
    <div className="flex items-center justify-center h-screen w-full bg-background/50 backdrop-blur-sm">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
    </div>
);

function AppContent() {
  const [localId, setLocalId] = useState(() => getLocalId());
  const [loading, setLoading] = useState(true);
  const [font, setFont] = useState('font-sans');
  const [settings, setSettings] = useState(null);
  const [needsNewShift, setNeedsNewShift] = useState(false);
  const [currentShift, setCurrentShift] = useState(null);
  const { user, loading: authLoading, login, logout } = useAuth();
  const { toast } = useToast();
  const [themeColor, setThemeColor] = useState('orange');
  const location = useLocation();
  const navigate = useNavigate();
  const { showUpdateNotification, reloadPage } = useServiceWorker();
  const { setAccountsLocalId } = useAccounts();
  const { alarmingOrderIds, acknowledgeOrder, AlarmAudio } = useOrderAlarm(!!user);
  const { activeAccount: activeMpAccount } = useMpAccounts();
  const {
    isEnabled: isVoiceAlertsEnabled,
    isSoundUnlocked: isVoiceSoundUnlocked,
    lastAnnouncedPayment,
    availableVoices,
    selectedVoiceURI,
    diagnosisResult,
    watcherStatus: mpWatcherStatus,
    lastPaymentDetectedAt: mpLastPaymentAt,
    lastWatcherError: mpWatcherError,
    lastCheckAt: mpLastCheckAt,
    enableSound: enableVoiceSound,
    testVoice,
    testMercadoPago,
    runDiagnosis,
    toggleEnabled: toggleVoiceAlerts,
    selectVoice,
  } = useVoicePaymentAlerts(!!user, activeMpAccount?.firebasePathPagos ?? null);

  const {
    loading: mpBackendLoading,
    refresh: refreshMpBackend,
    ...mpBackendStatus
  } = useMpBackendStatus();

  const [clearingCache, setClearingCache] = useState(false);
  
  // ÚNICA instancia de useStockStatus en toda la app. Se comparte por contexto
  // (StockStatusContext) para que StockPage NO vuelva a montar el hook ni duplique
  // los listeners de ARTICULOS/MATERIA_PRIMA.
  const stockStatus = useStockStatus();
  const {
    hasOutOfStock,
    hasLowStock,
    outOfStockCount,
    lowStockCount,
    outOfStockArticles,
    lowStockArticles,
    outOfStockRawMaterials,
    lowStockRawMaterials,
    localId: stockLocalId
  } = stockStatus;
  
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const { showModal: showAlarmModal, dismiss: dismissAlarm, pendingAmount: commissionAlarmAmount } = useCommissionAlarm(
    settings?.alarmaPago,
    !!user
  );

  // Badge de comisión pendiente (tiempo real)
  const commissionPending = useCommissionTotal(!!user && !!localId);
  const formatCommission = (v) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0);

  // Sistema de actualizaciones automáticas vía Firebase (chequeo antes del login)
  const [updateStatus, setUpdateStatus] = useState(() => {
    // Solo en Electron y si hay un local configurado. Arranca en 'checking' para que
    // la pantalla "Buscando actualizaciones..." aparezca antes del login sin parpadeos.
    if (!window.electronAPI || !localStorage.getItem('localId')) return 'done';
    return 'checking';
  });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // ── Bootstrap de dependencias de facturación (primer inicio en PC nueva) ──────
  const [depsStatus, setDepsStatus] = useState(() => {
    // Solo en Electron empaquetado. En web/dev arranca en 'done' (no bloquea).
    if (!window.electronAPI?.components?.bootstrap) return 'done';
    return 'checking';
  });
  const [depsLabel, setDepsLabel] = useState('');
  const [depsPct, setDepsPct] = useState(null);
  const [depsError, setDepsError] = useState('');

  // Listener de progreso de descarga (IPC → renderer)
  useEffect(() => {
    if (!window.electronAPI?.onDownloadProgress) return;
    const cleanup = window.electronAPI.onDownloadProgress((data) => {
      setDownloadProgress(data?.pct ?? 0);
    });
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, []);

  // Ejecuta la verificación/instalación automática de dependencias de facturación.
  // Reutiliza EXACTAMENTE la misma descarga desde Firebase que usa el instalador
  // manual (components:bootstrap → installComponents en main.js). Idempotente:
  // si ya está todo, resuelve al instante sin demorar el arranque.
  const runDepsBootstrap = useCallback(async () => {
    const comp = window.electronAPI?.components;
    if (!comp?.bootstrap) { setDepsStatus('done'); return; }

    setDepsError('');
    setDepsPct(null);
    setDepsLabel('');
    setDepsStatus('checking');

    try {
      const res = await comp.bootstrap();

      if (res?.ok && res.alreadyInstalled) {
        setDepsStatus('done');           // ruta rápida: ya estaba todo
        return;
      }

      if (res?.ok && res.installed) {
        // Se instaló correctamente. Reiniciar UNA sola vez para arrancar limpio.
        let flags = { depsBootstrapped: false };
        try { flags = await window.electronAPI.getBootFlags?.() || flags; } catch { /* noop */ }
        if (!flags.depsBootstrapped && window.electronAPI.relaunchApp) {
          await window.electronAPI.relaunchApp();  // main hace app.relaunch + exit
          return;                                   // la app se está reiniciando
        }
        setDepsStatus('done');           // ya venía de un reinicio: continuar
        return;
      }

      // Otra instancia está instalando (lock activo): esperar y reintentar.
      if (res?.busy) {
        setDepsStatus('installing');
        setDepsLabel('Otra ventana ya está instalando dependencias. Esperando...');
        setDepsPct(null);
        setTimeout(() => { runDepsBootstrap(); }, 4000);
        return;
      }

      // No se pudo dejar todo instalado
      const faltan = (res?.missing || []).join(', ');
      setDepsError(
        (res?.errors && res.errors.length ? res.errors.join(' · ') : '') ||
        (faltan ? `Faltan componentes: ${faltan}.` : 'No se pudo completar la instalación.')
      );
      setDepsStatus('error');
    } catch (e) {
      console.error('[deps-bootstrap]', e);
      setDepsError('No hay conexión o falló la descarga. Verificá internet y reintentá.');
      setDepsStatus('error');
    }
  }, []);

  // Corre el bootstrap una sola vez al montar, y escucha el progreso de instalación.
  const didDepsBootstrap = useRef(false);
  useEffect(() => {
    const comp = window.electronAPI?.components;
    if (!comp?.onProgress) return undefined;
    const cleanup = comp.onProgress((p) => {
      if (!p) return;
      setDepsStatus('installing');
      const name = p.label || p.component || '';
      const stepTxt = p.step === 'download' ? 'Descargando'
        : p.step === 'validate' ? 'Verificando'
        : p.step === 'extract' ? 'Extrayendo'
        : p.step === 'install' ? 'Instalando'
        : p.step === 'manifest' ? 'Preparando' : '';
      setDepsLabel([stepTxt, name].filter(Boolean).join(': '));
      setDepsPct(typeof p.pct === 'number' ? p.pct : null);
    });
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, []);

  useEffect(() => {
    if (didDepsBootstrap.current) return;
    didDepsBootstrap.current = true;
    runDepsBootstrap();
  }, [runDepsBootstrap]);

  // ── PreLoginUpdateCheck ───────────────────────────────────────────────────
  // Chequeo de actualizaciones UNA sola vez al arrancar, ANTES del login.
  // Consulta latest.json (Firebase Storage) vía IPC 'check-updates-now' y respeta
  // el flag `mandatory`. Nunca bloquea: si no hay internet o Firebase no responde
  // (o tarda demasiado), continúa al login tras un timeout de seguridad.
  const didStartupCheck = useRef(false);
  useEffect(() => {
    if (didStartupCheck.current) return;
    didStartupCheck.current = true;

    const storedLocalId = localStorage.getItem('localId');
    // Solo en Electron y con un local ya configurado (si no, el estado inicial ya es 'done')
    if (!window.electronAPI?.checkUpdatesNow || !storedLocalId) { setUpdateStatus('done'); return; }

    let settled = false;
    // Red de seguridad: si el chequeo tarda demasiado, ir al login igual.
    const timeoutId = setTimeout(() => {
      if (!settled) { settled = true; setUpdateStatus('done'); }
    }, 9000);

    (async () => {
      try {
        const res = await window.electronAPI.checkUpdatesNow();
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (res?.hasUpdate && res.installerUrl) {
          setUpdateInfo({
            version: res.version,
            url: res.installerUrl,
            sha256: res.sha256 || null,
            nombreArchivo: res.fileName || `Recepcion-de-Pedidos-Setup-${res.version}.exe`,
            mandatory: res.mandatory === true,
          });
          setUpdateStatus('available');
        } else {
          setUpdateStatus('done');
        }
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        console.error('[PreLoginUpdateCheck]', e);
        setUpdateStatus('done'); // No bloquear: continuar al login
      }
    })();

    return () => { clearTimeout(timeoutId); };
  }, []);

  // Descarga + instala cuando el usuario elige actualizar (o si es obligatoria).
  // La verificación SHA256 la hace main.js antes de ejecutar el instalador.
  const startUpdateDownload = useCallback(async () => {
    if (!updateInfo?.url) return;
    setDownloadProgress(0);
    setUpdateStatus('downloading');
    try {
      await window.electronAPI.downloadAndInstall(
        updateInfo.url,
        updateInfo.nombreArchivo,
        updateInfo.sha256 || null
      );
      // main.js cierra la app para que el instalador reemplace el ejecutable;
      // si llegamos acá sin haberse cerrado, lo damos por terminado.
      setUpdateStatus('done');
    } catch (e) {
      console.error('[update:download]', e);
      setUpdateStatus('error');
    }
  }, [updateInfo]);

  useEffect(() => {
    perfMonitor.startTimer('app-load');
    return () => perfMonitor.endTimer('app-load');
  }, []);

  const applySettings = useCallback((newSettings) => {
    if (!newSettings) return;
    setSettings(prevSettings => ({ ...prevSettings, ...newSettings }));
    const fontClass = newSettings?.fuente ? `font-${newSettings.fuente}` : 'font-sans';
    document.documentElement.className = fontClass;
    setFont(fontClass);

    if (newSettings?.fontSize) {
      document.documentElement.style.fontSize = `${newSettings.fontSize}px`;
    } else {
      document.documentElement.style.fontSize = '16px'; 
    }

    const color = newSettings?.themeColor || 'orange';
    setThemeColor(color);
    document.body.setAttribute('data-theme', color);
  }, []);

  const loadInitialData = useCallback(async (id) => {
    if (!id) {
        setLoading(false);
        return;
    }
    setLoading(true);
    try {
        perfMonitor.startTimer('initial-data-load');
        setFirebaseLocalId(id);
        setAccountsLocalId(id);
        // Fija el local activo en el proceso principal ANTES de cualquier lectura de
        // facturación por local (así main lee/escribe userData/facturacion/locales/{id}).
        try { await window.electronAPI?.setActiveLocal?.(id); } catch { /* no-electron o error transitorio */ }
        // Completar el backend.env de Mercado Pago del local con SU URL de Firebase (core.js).
        // Imprescindible: sin FIREBASE_DATABASE_URL el backend MP crashea con
        // "Can't determine Firebase Database URL". Idempotente: solo rellena lo que falta.
        try {
          await window.electronAPI?.backend?.ensureEnv?.({
            databaseURL: getLocationSpecificDatabaseURL(id),
            projectId:   getLocationSpecificProjectId(id),
            paymentsPath: `${id}/PAGOS_CONFIRMADOS`,
          });
        } catch { /* no-electron o error transitorio */ }
        await initializeFirebaseApp();

        const fetchedSettings = await fetchSettings();
        if (fetchedSettings) {
          applySettings(fetchedSettings);
        }
        
        const shiftData = await checkOpenShift();
        setCurrentShift(shiftData);
        setNeedsNewShift(!shiftData);
        // Sincronizar TotalComisionAPagar con totalCommission al iniciar
        recalcularTotalComisionAPagar().catch(() => {});
        perfMonitor.endTimer('initial-data-load');
    } catch (error) {
        console.error("Error loading initial data:", error);
        toast({ variant: 'destructive', title: 'Error de Carga', description: 'No se pudieron cargar los datos iniciales. Verifique la conexión.' });
    } finally {
        setLoading(false);
    }
  }, [applySettings, toast, setAccountsLocalId]);
  
  useEffect(() => {
    if (localId) {
        loadInitialData(localId);
    } else {
        setLoading(false);
    }
  }, [localId, loadInitialData]);

  useEffect(() => {
    if (localId && user) {
        const unsubscribe = listenToChanges('CONFIGURACION', (newSettings) => {
            if (newSettings) {
                applySettings(newSettings);
            }
        });
        return () => unsubscribe();
    }
  }, [localId, user, applySettings]);

  const handleSetupComplete = (newLocalId, localName) => {
    saveLocalId(newLocalId);
    setLocalId(newLocalId);
    toast({
        title: "¡Éxito!",
        description: `Bienvenido, ${localName}. Ahora inicie sesión.`,
        variant: "default",
    });
  };

  const handleNewShiftCreation = async (amount, date) => {
    if (!localId) return;
    try {
        const newShift = await createNewShift(amount, date);
        setCurrentShift(newShift);
        setNeedsNewShift(false);
    } catch (error) {
        console.error("Failed to create new shift:", error);
        toast({ variant: "destructive", title: "Error", description: "No se pudo crear el nuevo turno." });
        setNeedsNewShift(true);
    }
  };

  const handleShiftChange = (newShift) => {
    setCurrentShift(newShift);
    setNeedsNewShift(!newShift);
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    await clearCache();
    toast({ title: 'Caché limpiada', description: 'La memoria caché local ha sido vaciada.' });
    setClearingCache(false);
    window.location.reload();
  };
  
  // Bootstrap de dependencias de facturación: PRIMERO de todo, antes de iniciar
  // la app normal. En PC nueva descarga/instala desde Firebase y reinicia una vez.
  if (['checking', 'installing', 'error'].includes(depsStatus)) {
    return (
      <DepsBootstrapScreen
        status={depsStatus}
        label={depsLabel}
        pct={depsPct}
        error={depsError}
        onRetry={runDepsBootstrap}
        onContinue={() => {
          try { window.electronAPI?.components?.markNotReady?.(); } catch { /* noop */ }
          console.warn('[deps-bootstrap] Continuar sin facturación: dependencias no instaladas en esta PC.');
          setDepsStatus('done');
        }}
      />
    );
  }

  if (loading || authLoading) {
    return <LoadingFallback />;
  }

  if (!localId) {
    return <Suspense fallback={<LoadingFallback />}><LocalIdSetup onSetupComplete={handleSetupComplete} /></Suspense>;
  }

  if (['checking', 'available', 'downloading', 'error'].includes(updateStatus)) {
    const isMandatory = updateInfo?.mandatory === true;
    return (
      <UpdateScreen
        status={updateStatus}
        info={updateInfo}
        mandatory={isMandatory}
        downloadProgress={downloadProgress}
        onUpdate={startUpdateDownload}
        onSkip={isMandatory ? undefined : () => setUpdateStatus('done')}
        onRetry={() => { setDownloadProgress(0); setUpdateStatus(updateInfo ? 'available' : 'done'); }}
      />
    );
  }

  if (!user) {
     return (
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage onLogin={login} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      );
  }

  const userPermissions = user.permissions || {};
  const userRole = user.rol;
  const backgroundLocation = location.state?.backgroundLocation;

  return (
    <StockStatusContext.Provider value={stockStatus}>
      <Helmet>
        <title>DLV Sistemas</title>
        <meta name="description" content="Sistema de gestión integral para tu negocio." />
      </Helmet>
      <AlarmAudio />
      <InstallPrompt />
      <UpdateNotification show={showUpdateNotification} onUpdate={reloadPage} />
      <Suspense fallback={<div />}>
        {user && needsNewShift && (
          <CashFundModal 
            isOpen={true} 
            onFundSet={handleNewShiftCreation} 
            isInitialSetup={true} 
          />
        )}
      </Suspense>
      {user && currentShift && <ShiftSummaryUpdater currentShift={currentShift} />}
      <div className={`flex flex-col h-screen bg-gray-200 ${font}`}>
        <nav className="bg-white shadow-md z-10 flex-shrink-0">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1 overflow-x-auto scrollbar-hide">
                  <NavLink to="/atencion" icon={HeartHandshake} label="Atención" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink 
                    to="/stock" 
                    permissionPath="/stock" 
                    icon={Warehouse} 
                    label="Stock" 
                    userPermissions={userPermissions} 
                    userRole={userRole}
                    badge={
                      <div className="flex items-center gap-1.5" onClick={(e) => {
                        if (hasOutOfStock || hasLowStock) {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsStockModalOpen(true);
                        }
                      }}>
                        <Warehouse size={16} className="flex-shrink-0" />
                        <StockStatusBadge outOfStockCount={outOfStockCount} lowStockCount={lowStockCount} />
                      </div>
                    }
                  />
                  <NavLink to="/cajas" icon={Archive} label="Cajas" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/gastos" icon={Receipt} label="Gastos" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/ventas" icon={FileText} label="Ventas" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/app-web" icon={Globe} label="App Web" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/reporte-excel" icon={FileSpreadsheet} label="Reporte Excel" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/reportes-prepago" icon={PieChart} label="Reportes Prepago" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/cuentas" icon={CreditCard} label="Cuentas" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/rrhh" icon={UsersIcon} label="RRHH" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/usuarios" icon={UsersIcon} label="Usuarios" userPermissions={userPermissions} userRole={userRole} />
                  <NavLink to="/configuracion" icon={Settings} label="Configuración" userPermissions={userPermissions} userRole={userRole} />
                  <div className="flex items-center ml-2 border-l pl-2">
                    <LocalStatusIndicator settings={settings} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                    <VoicePaymentAlertWidget
                        isEnabled={isVoiceAlertsEnabled}
                        isSoundUnlocked={isVoiceSoundUnlocked}
                        lastAnnouncedPayment={lastAnnouncedPayment}
                        availableVoices={availableVoices}
                        selectedVoiceURI={selectedVoiceURI}
                        diagnosisResult={diagnosisResult}
                        watcherStatus={mpWatcherStatus}
                        lastPaymentDetectedAt={mpLastPaymentAt}
                        lastWatcherError={mpWatcherError}
                        lastCheckAt={mpLastCheckAt}
                        enableSound={enableVoiceSound}
                        testVoice={testVoice}
                        testMercadoPago={testMercadoPago}
                        runDiagnosis={runDiagnosis}
                        toggleEnabled={toggleVoiceAlerts}
                        selectVoice={selectVoice}
                        backendStatus={mpBackendStatus}
                        backendLoading={mpBackendLoading}
                        refreshBackend={refreshMpBackend}
                    />
                    <button
                        onClick={handleClearCache}
                        disabled={clearingCache}
                        className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors"
                        title="Limpiar Caché Local"
                    >
                        {clearingCache ? <Loader2 size={16} className="animate-spin"/> : <DatabaseZap size={16} />}
                    </button>
                    <button
                      onClick={logout}
                      className="px-3 py-2 text-sm font-medium flex items-center space-x-1.5 rounded-md transition-colors duration-200 text-gray-600 hover:bg-red-500/20 hover:text-red-600 flex-shrink-0"
                    >
                      <LogOut size={16} />
                      <span className="hidden sm:inline">Salir</span>
                    </button>
                </div>
            </div>
          </div>
        </nav>

        <main className={`flex-grow min-h-0 ${location.pathname.startsWith('/atencion') ? 'flex flex-col overflow-hidden p-2' : 'container mx-auto p-4 overflow-y-auto'}`}>
          <Suspense fallback={<LoadingFallback />}>
            <Routes location={backgroundLocation || location}>
              <Route path="/" element={<Navigate to="/atencion" replace />} />
              <Route path="/atencion/*" element={<ProtectedRoute name="Attention" permissions={['atencion']} userPermissions={userPermissions} userRole={userRole}><AttentionPage currentShift={currentShift} userPermissions={userPermissions} settings={settings} alarmingOrderIds={alarmingOrderIds} acknowledgeOrder={acknowledgeOrder} /></ProtectedRoute>} />
              <Route path="/stock" element={<ProtectedRoute name="Stock" permissions={['stock', 'articulos', 'materiaPrima', 'gruposOpcionales', 'opcionales', 'departamentos', 'tachos', 'tachos_modificar_stock']} userPermissions={userPermissions} userRole={userRole}><StockPage userPermissions={userPermissions} userRole={userRole} /></ProtectedRoute>} />
              <Route path="/configuracion/*" element={<ProtectedRoute name="Settings" permissions={['configuracion']} userPermissions={userPermissions} userRole={userRole}><SettingsPage applySettings={applySettings} /></ProtectedRoute>} />
              <Route path="/cajas" element={<ProtectedRoute name="CashRegister" permissions={['cajas', 'cajas_gestionar_fondo', 'cajas_cerrar_turno']} userPermissions={userPermissions} userRole={userRole}><CashRegisterPage user={user} currentShift={currentShift} onShiftChange={handleShiftChange} userPermissions={userPermissions} settings={settings} isModal={false} /></ProtectedRoute>} />
              <Route path="/gastos" element={<ProtectedRoute name="Expenses" permissions={['gastos', 'gastos_pagos_empleados', 'gastos_registrar_gasto']} userPermissions={userPermissions} userRole={userRole}><ExpensesPage currentShift={currentShift} userPermissions={userPermissions} onShiftChange={handleShiftChange}/></ProtectedRoute>} />
              <Route path="/ventas" element={<ProtectedRoute name="Sales" permissions={['ventas_facturacion', 'ventas_remitos']} userPermissions={userPermissions} userRole={userRole}><SalesPage /></ProtectedRoute>} />
              <Route path="/app-web" element={<ProtectedRoute name="WebApp" permissions={['configuracion', 'ventas_facturacion']} userPermissions={userPermissions} userRole={userRole}><WebAppPage /></ProtectedRoute>} />
              <Route path="/ventas-apps" element={<ProtectedRoute name="SalesApps" permissions={['ventas_facturacion', 'ventas_remitos']} userPermissions={userPermissions} userRole={userRole}><SalesByAppsPage /></ProtectedRoute>} />
              <Route path="/reporte-excel" element={<ProtectedRoute name="Reports" permissions={['ventas_facturacion', 'ventas_remitos']} userPermissions={userPermissions} userRole={userRole}><SalesExcelReportPage /></ProtectedRoute>} />
              <Route path="/reportes-prepago" element={<ProtectedRoute name="Prepayments" permissions={['ventas_facturacion', 'ventas_remitos']} userPermissions={userPermissions} userRole={userRole}><PrepaymentReportPage /></ProtectedRoute>} />
              <Route path="/cuentas" element={<ProtectedRoute name="Accounts" permissions={['cuentas']} userPermissions={userPermissions} userRole={userRole}><AccountsPage /></ProtectedRoute>} />
              <Route path="/rrhh" element={<ProtectedRoute name="HR" permissions={['rrhh']} userPermissions={userPermissions} userRole={userRole}><HumanResourcesPage /></ProtectedRoute>} />
              <Route path="/usuarios" element={<ProtectedRoute name="Users" permissions={['usuarios']} userPermissions={userPermissions} userRole={userRole}><UsersPage /></ProtectedRoute>} />
              <Route path="/login" element={<Navigate to="/" replace />} />
            </Routes>
            {backgroundLocation && (
              <Routes>
                <Route path="/cajas" element={
                  <ProtectedRoute name="CashModal" permissions={['cajas', 'cajas_gestionar_fondo', 'cajas_cerrar_turno']} userPermissions={userPermissions} userRole={userRole}>
                    <CashRegisterPage 
                      user={user} 
                      currentShift={currentShift} 
                      onShiftChange={handleShiftChange} 
                      userPermissions={userPermissions} 
                      settings={settings} 
                      isModal={true}
                      onClose={() => navigate(backgroundLocation)}
                    />
                  </ProtectedRoute>
                } />
              </Routes>
            )}
          </Suspense>
        </main>
        
        <footer className="bg-white shadow-inner py-2 px-4 text-xs text-gray-600 flex-shrink-0">
          <div className="container mx-auto flex justify-between items-center">
            <div className="flex space-x-4">
              <span>Usuario: {user.nombre} ({user.rol})</span>
              {currentShift && <span>Turno: #{currentShift.id}</span>}
              {user.rol === 'dueño' && <span>ID Local: {localId}</span>}
            </div>
            <div className="font-semibold text-primary-dark hidden md:block">
              DLV SISTEMAS
            </div>
            {/* Comisión a pagar: visible para TODOS los usuarios logueados (no solo dueño). */}
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-md bg-gray-800 border border-fuchsia-500/40 whitespace-nowrap">
              <span className="text-gray-300 font-medium">Comisión a Pagar:</span>
              <span className={`font-bold ${commissionPending > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                {formatCommission(commissionPending)}
              </span>
            </div>
            <FacturacionAutoStartWidget />
            <div className="flex items-center gap-3">
              <span>{formatDateForFirebase(new Date())} {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-gray-400 select-none" title={`Build: ${typeof __BUILD_TIME__ !== 'undefined' ? new Date(__BUILD_TIME__).toLocaleString('es-AR') : 'dev'}`}>
                v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'}
              </span>
            </div>
          </div>
        </footer>
      </div>

      <OutOfStockModal
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        outOfStockArticles={outOfStockArticles}
        outOfStockRawMaterials={outOfStockRawMaterials}
        lowStockArticles={lowStockArticles}
        lowStockRawMaterials={lowStockRawMaterials}
        departments={[]}
        localId={stockLocalId}
      />
      <CommissionAlarmModal
        isOpen={showAlarmModal}
        alarmAmount={commissionAlarmAmount}
        onAccept={dismissAlarm}
      />
      <Toaster />
    </StockStatusContext.Provider>
  );
}

function App() {
  return (
    <ErrorBoundary componentName="AppRoot">
      <AppContent />
    </ErrorBoundary>
  );
}

export default App;