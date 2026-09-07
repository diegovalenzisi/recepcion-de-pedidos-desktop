import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/use-toast';
import { Settings, HeartHandshake, Loader2, Warehouse, CreditCard, Archive, Users as UsersIcon, LogOut, Receipt, FileText, FileSpreadsheet, Smartphone, PieChart, DatabaseZap, Globe } from 'lucide-react';
import { permissionsList } from '@/config/permissions.js';
import { useAuth } from '@/hooks/useAuth.jsx';
import { getLocalId, setLocalId as saveLocalId, setFirebaseLocalId, initializeFirebaseApp, ensureFirebaseAppSync, getCurrentDatabaseOrThrow, markFirebaseSwitching, markFirebaseReady, markFirebaseError, getFirebaseUrl, getLocationSpecificDatabaseURL, getLocationSpecificProjectId } from '@/lib/firebase/core.js';
import { ref, onValue, off } from 'firebase/database';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness.js';
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
import { reconciliarTodasLasMateriasPrimas } from '@/lib/api/stockDeliveryAutomation';
import StockStatusBadge from '@/components/management/StockStatusBadge.jsx';
import OutOfStockModal from '@/components/management/OutOfStockModal.jsx';
import { clearSafeLocalCache } from '@/lib/cache/cacheManager.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ErrorBoundary from '@/components/ErrorBoundary.jsx';
import { perfMonitor } from '@/lib/performanceMonitor';
import InstallPrompt from '@/components/InstallPrompt.jsx';
import { useCommissionAlarm } from '@/hooks/useCommissionAlarm.js';
import CommissionAlarmModal from '@/components/CommissionAlarmModal.jsx';
import { useCommissionTotal } from '@/hooks/useCommissionTotal.js';
import { useGateComision } from '@/hooks/useGateComision.js';
import { ESTADO_SESION } from '@/lib/api/comisionCorte.js';
import CommissionBlockScreen from '@/components/CommissionBlockScreen.jsx';
import { useImpresionFiscalPendiente } from '@/hooks/useImpresionFiscalPendiente.js';
import { recalcularTotalComisionAPagar } from '@/lib/api/myAccountApi.js';
import { registrarDispositivo } from '@/lib/api/deviceIdentity.js';
import { asegurarDepartamentosCanonicos } from '@/lib/api/departamentosCanonicosApi.js';
import UpdateScreen from '@/components/UpdateScreen.jsx';
import DepsBootstrapScreen from '@/components/DepsBootstrapScreen.jsx';

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

// Se muestra durante un cambio de local EN VIVO (ya hubo una carga exitosa
// antes) — distinto del spinner genérico de LoadingFallback, que es para la
// primera carga. Mientras esta pantalla está activa, Firebase está entre
// "borrar la app del local anterior" y "crear/confirmar la del nuevo": ningún
// listener ni acción de usuario puede leer/escribir (getCurrentDatabaseOrThrow
// lo rechaza), así que no tiene sentido mostrar la app operativa todavía.
const SwitchingLocalScreen = () => (
    <div className="flex flex-col items-center justify-center h-screen w-full bg-background gap-4">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
        <p className="text-lg font-medium text-muted-foreground">Cambiando de local…</p>
    </div>
);

// Pantalla recuperable si initializeFirebaseApp() falla (sin red, config
// inválida, etc.) — nunca se deja la app a medio cargar ni se muestra la UI
// operativa sin Firebase listo.
const FirebaseRetryScreen = ({ message, onRetry }) => (
    <div className="flex flex-col items-center justify-center h-screen w-full bg-background gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-red-600">No se pudo conectar con el local</p>
        <p className="text-sm text-muted-foreground max-w-md">{message}</p>
        <button
          onClick={onRetry}
          className="mt-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
        >
          Reintentar
        </button>
    </div>
);

// sessionStorage (no localStorage): flag de un solo uso para mostrar el aviso
// de éxito DESPUÉS del window.location.reload() que dispara "Limpiar Caché
// Local". Vive en sessionStorage porque solo importa para este reinicio, en
// esta pestaña/ventana — no debe sobrevivir a un cierre real de la app.
const CACHE_CLEAR_SUCCESS_FLAG = 'cacheClearSuccess';

function AppContent() {
  const [localId, setLocalId] = useState(() => getLocalId());
  const [loading, setLoading] = useState(true);
  // Estado central de Firebase (ver core.js): switching/ready/error. Distinto
  // de `loading` -- éste último abarca TODA la carga inicial (settings,
  // turno, etc.), firebaseReadiness es específicamente "¿la app/database del
  // local actual están listas para usarse?".
  const firebaseReadiness = useFirebaseReadiness();
  const hasBeenReadyOnceRef = useRef(false);
  useEffect(() => {
    if (firebaseReadiness.ready) hasBeenReadyOnceRef.current = true;
  }, [firebaseReadiness.ready]);
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
  const [clearCacheConfirmOpen, setClearCacheConfirmOpen] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);

  // ÚNICA instancia de useStockStatus en toda la app. Se comparte por contexto
  // (StockStatusContext) para que StockPage NO vuelva a montar el hook ni duplique
  // los listeners de ARTICULOS/MATERIA_PRIMA.
  const stockStatus = useStockStatus(localId);
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

  // Badge de comisión pendiente (tiempo real) — única fuente de verdad para el saldo de
  // comisión a pagar, compartida entre el indicador del footer y el aviso al entrar al local.
  const commissionPending = useCommissionTotal(!!user && !!localId);

  // Gate de inicio por limite de corte: evaluacion UNICA por sesion real.
  const gateComision = useGateComision();

  // IMPRESIÓN AUTOMÁTICA DE COMPROBANTES FISCALES.
  //
  // Vive acá y no en la pantalla de mostrador porque la factura puede salir
  // mucho después de la venta: el motor AFIP emite cuando puede, y para
  // entonces el cajero ya cambió de pantalla o cerró y volvió a abrir la app.
  // El estado es persistente (/{localId}/IMPRESION), así que cualquier terminal
  // abierta recupera lo pendiente y una transacción garantiza una sola copia.
  useImpresionFiscalPendiente(!!user && !!localId);

  // El aviso usa exactamente el mismo saldo (commissionPending) que el indicador de abajo,
  // en vez de calcularlo por su cuenta, para que ambos muestren siempre el mismo número.
  const { showModal: showAlarmModal, dismiss: dismissAlarm } = useCommissionAlarm(
    settings?.alarmaPago,
    !!user,
    commissionPending
  );
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

  // Aviso de éxito de "Limpiar Caché Local" — se muestra una sola vez, en el
  // primer render DESPUÉS del reinicio que dispara ese botón (el toast de antes
  // del reload se pierde con la página; este se lee de sessionStorage y se borra
  // al mostrarse, así no vuelve a aparecer en reinicios posteriores).
  useEffect(() => {
    if (sessionStorage.getItem(CACHE_CLEAR_SUCCESS_FLAG) === '1') {
      sessionStorage.removeItem(CACHE_CLEAR_SUCCESS_FLAG);
      toast({
        title: 'Aplicación actualizada',
        description: 'Se borraron los archivos temporales y se reinició la aplicación. No se vieron afectados los pedidos ni la configuración.',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Marca el inicio de la ventana de "cambiando de local": desde acá hasta
    // markFirebaseReady()/markFirebaseError(), getCurrentDatabaseOrThrow()
    // (usado por los listeners persistentes y por acciones como "Actualizar
    // aplicación") rechaza cualquier lectura/escritura — nunca contra el
    // local anterior ni contra uno a medio inicializar.
    markFirebaseSwitching();
    try {
        perfMonitor.startTimer('initial-data-load');
        setFirebaseLocalId(id);
        setAccountsLocalId(id);
        // Crear la app Firebase '[DEFAULT]' PRIMERO, de forma sincrónica, antes de
        // cualquier await no relacionado con Firebase (IPC de Electron, etc.). Antes
        // initializeFirebaseApp() (async) se llamaba último, después de dos awaits de
        // IPC — dejaba una ventana real en la que localId ya estaba seteado pero la
        // app default todavía no existía: cualquier componente montado en ese momento
        // (ej. LocalStatusIndicator, que escucha .info/connected sin esperar a
        // "loading") podía llamar getDatabase() y explotar con "No Firebase App
        // '[DEFAULT]' has been created". ensureFirebaseAppSync() es sincrónico
        // (initializeApp() en sí no requiere await) y cierra esa ventana por completo.
        ensureFirebaseAppSync(id);
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
        // Sigue existiendo: maneja además el caso de CAMBIAR de local (borra la app
        // anterior si la config difiere). Con la app ya creada arriba, acá normalmente
        // solo la devuelve sin trabajo adicional.
        const app = await initializeFirebaseApp();
        if (!app) {
          // Pantalla de Reintentar (ver render más abajo) — no sigue con
          // settings/turno de una Firebase que no terminó de inicializar.
          markFirebaseError(new Error('No se pudo inicializar Firebase para este local. Verificá la conexión e intentá de nuevo.'));
          return;
        }
        markFirebaseReady();

        // Garantiza los tres departamentos canónicos (PEDIDOSYA/RAPPI/M.LIBRE) de
        // ESTE local: adapta cualquier variante ya escrita (reusa su id, nunca
        // duplica) o los crea si faltan. En segundo plano y best-effort — no
        // bloquea el arranque ni rompe nada si falla (se reintenta solo, la
        // próxima vez que la app abra este local). Sin hardcodear ningún
        // localId: cubre igual a cualquier local nuevo que se dé de alta.
        asegurarDepartamentosCanonicos().catch((e) =>
          console.warn('[App] No se pudo asegurar los departamentos canónicos:', e?.message || e)
        );

        const fetchedSettings = await fetchSettings();
        if (fetchedSettings) {
          applySettings(fetchedSettings);
        }

        const shiftData = await checkOpenShift();
        setCurrentShift(shiftData);
        setNeedsNewShift(!shiftData);
        // Sincronizar TotalComisionAPagar con totalCommission al iniciar
        recalcularTotalComisionAPagar().catch(() => {});

        // REGISTRO DEL EQUIPO, en el arranque real y no al abrir una pantalla.
        // Deja constancia de qué dispositivo, de qué tipo y con qué versión está
        // trabajando en este local — lo que hace falta para verificar adopción
        // antes de activar la contabilidad nueva. No bloquea nada y no lanza.
        registrarDispositivo({
          localId: id, firebaseUrl: getFirebaseUrl(),
          deviceType: 'desktop',
          // Version REAL del paquete, inyectada por Vite desde package.json.
          clientVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'desconocida',
        }).catch(() => {});
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
    // firebaseReadiness.ready en las deps: al cambiar de local esto pasa por
    // false (se desuscribe YA, antes de que la app vieja se borre) y vuelve a
    // true recién cuando el nuevo local está confirmado (se suscribe de
    // nuevo ahí, nunca contra el local anterior).
    if (localId && user && firebaseReadiness.ready) {
        const unsubscribe = listenToChanges('CONFIGURACION', (newSettings) => {
            if (newSettings) {
                applySettings(newSettings);
            }
        });
        return () => unsubscribe();
    }
  }, [localId, user, applySettings, firebaseReadiness.ready]);

  // GATE DE COMISIÓN — se evalúa cuando hay sesión y Firebase confirmado.
  //
  // `evaluar()` es idempotente: si la sesión ya quedó AUTORIZADA no vuelve a
  // leer nada, así que este efecto puede re-ejecutarse sin riesgo de que una
  // sesión en curso se bloquee. Al cambiar de local el estado se reevalúa, que
  // es lo correcto: es otro comercio, con su propia deuda y su propio límite.
  useEffect(() => {
    if (localId && user && firebaseReadiness.ready) {
      gateComision.evaluar();
    }
  }, [localId, user, firebaseReadiness.ready, gateComision.evaluar]);

  // Reconciliación de MATERIA_PRIMA/{id}/activoDelivery al cargar / cambiar de
  // local: corrige materias primas con stock <= 0 que hayan quedado en
  // activoDelivery=true (datos existentes) y restaura las que corresponda.
  // Idempotente y acotada al local actual. No modifica otros locales.
  useEffect(() => {
    if (localId && user && firebaseReadiness.ready) {
      reconciliarTodasLasMateriasPrimas().catch((e) =>
        console.warn('[MP Delivery] Reconciliación inicial falló:', e?.message || e));
    }
  }, [localId, user, firebaseReadiness.ready]);

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

  // Confirma la conexión REAL con Firebase antes de recargar. navigator.onLine
  // no alcanza (puede dar true con la red local activa aunque RTDB no responda
  // — ej. wifi conectado pero sin salida a internet, o el servidor caído), así
  // que además se pregunta el estado real vía .info/connected. Este proyecto
  // no tiene un contador de escrituras pendientes (se buscó explícitamente:
  // no existe ninguna cola de "operaciones offline" — las escrituras van
  // directo al SDK de RTDB, que las retiene en memoria mientras no hay red);
  // no se inventa uno acá. Ante cualquier duda (sin red, sin respuesta del
  // servidor, o sin poder determinar el estado) se cancela.
  const checkFirebaseReallyConnected = () => new Promise((resolve) => {
    let db;
    try {
      // getCurrentDatabaseOrThrow() usa la app/database del local ACTUAL
      // (nunca la de un local anterior) y falla rápido si Firebase está
      // cambiando de local o todavía no está listo.
      db = getCurrentDatabaseOrThrow();
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const connectedRef = ref(db, '.info/connected');
    const finish = (value) => {
      if (settled) return;
      settled = true;
      off(connectedRef, 'value', listener);
      resolve(value);
    };

    const timer = setTimeout(() => finish(false), 4000);
    const listener = onValue(
      connectedRef,
      (snap) => { clearTimeout(timer); finish(snap.val() === true); },
      () => { clearTimeout(timer); finish(false); }
    );
  });

  // Pide confirmación antes de actualizar. Se cancela (sin abrir el diálogo)
  // si no se puede confirmar la conexión real con el servidor.
  const requestClearCache = async () => {
    if (!navigator.onLine) {
      toast({
        variant: 'destructive',
        title: 'Sin conexión',
        description: 'No se pudo confirmar la conexión con el servidor. Para evitar perder cambios pendientes, la actualización fue cancelada.',
      });
      return;
    }
    setCheckingConnection(true);
    const reallyConnected = await checkFirebaseReallyConnected();
    setCheckingConnection(false);
    if (!reallyConnected) {
      toast({
        variant: 'destructive',
        title: 'Sin conexión',
        description: 'No se pudo confirmar la conexión con el servidor. Para evitar perder cambios pendientes, la actualización fue cancelada.',
      });
      return;
    }
    setClearCacheConfirmOpen(true);
  };

  // Borra SOLO datos temporales reconstruibles (ver clearSafeLocalCache) y reinicia.
  // No toca localId, configuración del local, sesión, pedidos ni facturación.
  const handleClearCache = async () => {
    setClearCacheConfirmOpen(false);
    setClearingCache(true);
    try {
      await clearSafeLocalCache();
      // Se lee una sola vez después del reinicio (ver useEffect más abajo) para
      // mostrar el mensaje de éxito ya con la app recargada, no antes de perderla.
      sessionStorage.setItem(CACHE_CLEAR_SUCCESS_FLAG, '1');
    } catch (error) {
      console.error('Error al limpiar la caché local:', error);
      setClearingCache(false);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo actualizar la aplicación. Probá de nuevo.' });
      return;
    }
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

  // Firebase falló al inicializar (sin red, config inválida, etc.): pantalla
  // recuperable con Reintentar — nunca se sigue a una UI operativa a medias.
  if (firebaseReadiness.error && localId) {
    return (
      <FirebaseRetryScreen
        message={firebaseReadiness.error}
        onRetry={() => loadInitialData(localId)}
      />
    );
  }

  if (loading || authLoading || (localId && firebaseReadiness.switching)) {
    // "Cambiando de local…" solo si ya hubo una carga exitosa antes (esto es
    // un cambio en vivo); si no, es la primera carga y alcanza con el spinner
    // genérico — mostrar "cambiando de local" ahí sería confuso/incorrecto.
    if (hasBeenReadyOnceRef.current) {
      return <SwitchingLocalScreen />;
    }
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

  // -------------------------------------------------------------------------
  // GATE DE INICIO POR LÍMITE DE CORTE.
  //
  // Va DESPUÉS del login (hace falta saber qué local es) y ANTES del área
  // operativa. Se evalúa UNA sola vez, con una lectura puntual: no hay listener,
  // así que una sesión ya autorizada no puede volver a bloquearse aunque la
  // deuda supere el límite durante el turno. El límite se vuelve a mirar recién
  // en el próximo inicio real.
  //
  // ERROR_DE_VERIFICACION no es un bloqueo por corte: es "no sabemos", con
  // REINTENTAR / SALIR. Un fallo de red nunca se toma como corte desactivado.
  // -------------------------------------------------------------------------
  if (gateComision.estado === ESTADO_SESION.BLOQUEADA
      || gateComision.estado === ESTADO_SESION.ERROR
      || gateComision.estado === ESTADO_SESION.VERIFICANDO) {
    return (
      <CommissionBlockScreen
        estado={gateComision.estado}
        evaluacion={gateComision.evaluacion}
        onReintentar={gateComision.evaluar}
        onSalir={logout}
      />
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
                    {/* Botón superior de "Actualizar aplicación" (icono DatabaseZap)
                        ocultado a pedido. requestClearCache/handleClearCache y el
                        diálogo de confirmación se conservan (quedan inactivos al no
                        tener disparador visible). */}
                    <AlertDialog open={clearCacheConfirmOpen} onOpenChange={setClearCacheConfirmOpen}>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Actualizar aplicación?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminarán archivos temporales y se volverá a cargar la aplicación.
                            No se eliminarán pedidos, usuarios ni configuraciones.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={handleClearCache}>Actualizar y reiniciar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
        alarmAmount={commissionPending}
        cutoffLimit={settings?.limiteCorte}
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