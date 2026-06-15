import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/use-toast';
import { Settings, HeartHandshake, Loader2, Warehouse, CreditCard, Archive, Users as UsersIcon, LogOut, Receipt, FileText, FileSpreadsheet, Smartphone, PieChart, DatabaseZap, Globe } from 'lucide-react';
import { permissionsList } from '@/config/permissions.js';
import { useAuth } from '@/hooks/useAuth.jsx';
import { getLocalId, setLocalId as saveLocalId, setFirebaseLocalId, initializeFirebaseApp } from '@/lib/firebase/core.js';
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
import VoicePaymentAlertWidget from '@/components/VoicePaymentAlertWidget.jsx';
import { useStockStatus } from '@/hooks/useStockStatus.js';
import StockStatusBadge from '@/components/management/StockStatusBadge.jsx';
import OutOfStockModal from '@/components/management/OutOfStockModal.jsx';
import { clearCache } from '@/lib/cache/cacheManager.js';
import ErrorBoundary from '@/components/ErrorBoundary.jsx';
import { perfMonitor } from '@/lib/performanceMonitor';
import InstallPrompt from '@/components/InstallPrompt.jsx';

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
  const {
    isEnabled: isVoiceAlertsEnabled,
    isSoundUnlocked: isVoiceSoundUnlocked,
    lastAnnouncedPayment,
    availableVoices,
    selectedVoiceURI,
    enableSound: enableVoiceSound,
    testVoice,
    toggleEnabled: toggleVoiceAlerts,
    selectVoice,
  } = useVoicePaymentAlerts(!!user);
  const [clearingCache, setClearingCache] = useState(false);
  
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
  } = useStockStatus();
  
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);

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
        await initializeFirebaseApp();

        const fetchedSettings = await fetchSettings();
        if (fetchedSettings) {
          applySettings(fetchedSettings);
        }
        
        const shiftData = await checkOpenShift();
        setCurrentShift(shiftData);
        setNeedsNewShift(!shiftData);
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
  
  if (loading || authLoading) {
    return <LoadingFallback />;
  }
  
  if (!localId) {
    return <Suspense fallback={<LoadingFallback />}><LocalIdSetup onSetupComplete={handleSetupComplete} /></Suspense>;
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
    <>
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
                        enableSound={enableVoiceSound}
                        testVoice={testVoice}
                        toggleEnabled={toggleVoiceAlerts}
                        selectVoice={selectVoice}
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

        <main className="flex-grow container mx-auto p-4 overflow-y-auto">
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
            <div>
              <span>{formatDateForFirebase(new Date())} {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
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
      <Toaster />
    </>
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