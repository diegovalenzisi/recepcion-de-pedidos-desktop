import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, Building, Loader2, Lock, Database, ChevronDown, ChevronUp, Save, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getFirebaseUrl,
  getLocationSpecificDatabaseURL, getLocationSpecificStorageBucket,
  getLocationSpecificDatabasePath, getLocationSpecificStorageBasePath,
  isKnownLocationConfig, applyRoutesOverride,
  setLocalId as persistLocalId, initializeFirebaseApp,
} from '@/lib/firebase/core';
import { fetchLocalRoutes, saveLocalRoutes } from '@/lib/api/localConfigApi';

const ACCESS_KEY = "MoniDiego2908";

const EMPTY_ROUTES = { databaseURL: '', databasePath: '', storageBucket: '', storageBasePath: '' };
const EMPTY_ADVANCED = { apiKey: '', projectId: '' };

function LocalIdSetup({ onSetupComplete }) {
  const [step, setStep] = useState('localId'); // 'localId' | 'password' | 'routes'
  const [localId, setLocalId] = useState('');
  const [password, setPassword] = useState('');
  const [verifiedLocalName, setVerifiedLocalName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Paso 3: rutas Firebase por local ──────────────────────────────────────
  const [routes, setRoutes] = useState(EMPTY_ROUTES);
  const [advanced, setAdvanced] = useState(EMPTY_ADVANCED);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isKnownLocal, setIsKnownLocal] = useState(false); // ya hay config (LOCATION_CONFIG o /rutas)
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [savingRoutes, setSavingRoutes] = useState(false);
  const [routesError, setRoutesError] = useState('');

  useEffect(() => {
    if (step !== 'routes') return;
    let cancelled = false;
    (async () => {
      setLoadingRoutes(true);
      setRoutesError('');
      try {
        // 1) Prioridad: lo que ya esté guardado en /rutas/{localId} (Firebase).
        const remote = await fetchLocalRoutes(localId);
        if (cancelled) return;
        if (remote.success) {
          setRoutes({
            databaseURL:     remote.data.databaseURL || '',
            databasePath:    remote.data.databasePath || '',
            storageBucket:   remote.data.storageBucket || '',
            storageBasePath: remote.data.storageBasePath || '',
          });
          setAdvanced({ apiKey: remote.data.apiKey || '', projectId: remote.data.projectId || '' });
          setIsKnownLocal(true);
          // Ya hay rutas en /rutas → aplicarlas al override para que "Continuar sin
          // cambios" (y la app default) usen esta config, no la de LOCATION_CONFIG.
          applyRoutesOverride(localId, remote.data);
          return;
        }
        // 2) Sin nada en /rutas → si es un local conocido (LOCATION_CONFIG),
        // precargar sus valores actuales. Si NO es conocido, dejar en blanco
        // (nunca mostrar el fallback de Achaval como si fuera de este local).
        const known = isKnownLocationConfig(localId);
        setIsKnownLocal(known);
        if (known) {
          setRoutes({
            databaseURL:     getLocationSpecificDatabaseURL(localId) || '',
            databasePath:    getLocationSpecificDatabasePath(localId) || localId,
            storageBucket:   getLocationSpecificStorageBucket(localId) || '',
            storageBasePath: getLocationSpecificStorageBasePath(localId) || '',
          });
        } else {
          setRoutes({ ...EMPTY_ROUTES, databasePath: localId });
          setShowAdvanced(true); // local nuevo: apiKey/projectId van a hacer falta
        }
        setAdvanced(EMPTY_ADVANCED);
      } finally {
        if (!cancelled) setLoadingRoutes(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, localId]);

  const handleLocalIdSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d+$/.test(localId)) {
      setError('El número de local solo debe contener dígitos.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${getFirebaseUrl()}/LOCALES/${localId}.json`);
      if (!response.ok) {
        throw new Error('Error de red al verificar el local.');
      }
      const data = await response.json();

      if (data) {
        setVerifiedLocalName(data);
        setStep('password');
      } else {
        setError('ERROR AL INTENTAR ABRIR LOCAL');
      }
    } catch (err) {
      setError(err.message || 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Simulating a check
    setTimeout(() => {
      if (password === ACCESS_KEY) {
        setLoading(false);
        setStep('routes');
      } else {
        setError('Clave de acceso incorrecta.');
        setLoading(false);
      }
    }, 500);
  };

  // Persiste el localId y deja la app Firebase '[DEFAULT]' inicializada con las
  // rutas ya aplicadas ANTES de avanzar. Si falla, NO avanza: muestra error y
  // deja editar las rutas. Garantiza que ningún getDatabase()/getStorage()/getAuth()
  // corra sin app default.
  const finishSetup = async () => {
    persistLocalId(localId); // localStorage, para que initializeFirebaseApp lo lea
    let app = null;
    try {
      app = await initializeFirebaseApp();
    } catch (err) {
      setRoutesError('No se pudo inicializar Firebase con estas rutas: ' + (err?.message || err));
      return false;
    }
    if (!app) {
      setRoutesError('No se pudo inicializar Firebase con estas rutas. Revisá databaseURL, apiKey y projectId, y volvé a intentar.');
      return false;
    }
    onSetupComplete(localId, verifiedLocalName);
    return true;
  };

  // ── Paso 3: guardar rutas en /rutas/{localId} (solo si el usuario confirma) ──
  const handleSaveRoutes = async (e) => {
    e.preventDefault();
    setRoutesError('');

    if (!routes.databaseURL.trim()) {
      setRoutesError('databaseURL es obligatorio.');
      return;
    }
    // apiKey/projectId solo son obligatorios cuando no se pudieron resolver
    // desde LOCATION_CONFIG (local totalmente nuevo).
    if (!isKnownLocal && (!advanced.apiKey.trim() || !advanced.projectId.trim())) {
      setRoutesError('Para un local nuevo, apiKey y projectId son obligatorios (sección Avanzado).');
      setShowAdvanced(true);
      return;
    }

    setSavingRoutes(true);
    try {
      const payload = {
        databaseURL:     routes.databaseURL.trim(),
        databasePath:    routes.databasePath.trim() || localId,
        storageBucket:   routes.storageBucket.trim(),
        storageBasePath: routes.storageBasePath.trim(),
        apiKey:          advanced.apiKey.trim(),
        projectId:       advanced.projectId.trim(),
      };
      const result = await saveLocalRoutes(localId, payload);
      if (!result.success) {
        setRoutesError(result.error || 'No se pudo guardar la configuración.');
        setSavingRoutes(false);
        return;
      }
      // Disponible sincrónicamente ANTES de inicializar Firebase.
      applyRoutesOverride(localId, payload);
      const ok = await finishSetup();
      if (!ok) setSavingRoutes(false);
    } catch (err) {
      setRoutesError(err.message || 'Ocurrió un error inesperado al guardar.');
      setSavingRoutes(false);
    }
  };

  // Continuar sin escribir nada en /rutas — usa lo que ya está funcionando
  // (LOCATION_CONFIG o un override remoto ya existente, precargado arriba).
  const handleContinueWithoutSaving = async () => {
    setSavingRoutes(true);
    const ok = await finishSetup();
    if (!ok) setSavingRoutes(false);
  };

  const formVariants = {
    hidden: { opacity: 0, x: -50 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 50 },
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-gray-900 to-gray-700 text-white">
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 100, duration: 0.5 }}
        className="w-full max-w-md p-8 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 overflow-hidden"
      >
        <AnimatePresence mode="wait">
          {step === 'localId' && (
            <motion.div
              key="localId"
              variants={formVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-8">
                <Building className="mx-auto h-16 w-16 text-orange-400 mb-4" />
                <h1 className="text-3xl font-bold">Configuración Inicial</h1>
                <p className="text-white/80 mt-2">Por favor, ingrese el número de su local para comenzar.</p>
              </div>
              <form onSubmit={handleLocalIdSubmit} className="space-y-6">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-orange-300" />
                  <Input
                    type="text"
                    value={localId}
                    onChange={(e) => setLocalId(e.target.value)}
                    placeholder="Número de Local"
                    className="pl-10 h-12 text-lg bg-white/10 text-white placeholder-white/50 border-white/30 focus:ring-orange-500 focus:border-orange-500"
                    autoFocus
                  />
                </div>
                {error && <p className="text-red-400 text-sm text-center font-bold">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 text-lg font-bold bg-orange-500 hover:bg-orange-600 transition-all duration-300 shadow-lg"
                >
                  {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'Verificar Local'}
                </Button>
              </form>
            </motion.div>
          )}

          {step === 'password' && (
            <motion.div
              key="password"
              variants={formVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-8">
                <Lock className="mx-auto h-16 w-16 text-orange-400 mb-4" />
                <h1 className="text-3xl font-bold">Clave de Acceso</h1>
                <p className="text-white/80 mt-2">Local: <span className="font-bold">{verifiedLocalName}</span></p>
              </div>
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-orange-300" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Clave de Acceso"
                    className="pl-10 h-12 text-lg bg-white/10 text-white placeholder-white/50 border-white/30 focus:ring-orange-500 focus:border-orange-500"
                    autoFocus
                  />
                </div>
                {error && <p className="text-red-400 text-sm text-center font-bold">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 text-lg font-bold bg-orange-500 hover:bg-orange-600 transition-all duration-300 shadow-lg"
                >
                  {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'Ingresar'}
                </Button>
              </form>
            </motion.div>
          )}

          {step === 'routes' && (
            <motion.div
              key="routes"
              variants={formVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.3 }}
            >
              <div className="text-center mb-6">
                <Database className="mx-auto h-16 w-16 text-orange-400 mb-4" />
                <h1 className="text-2xl font-bold">Rutas de Firebase</h1>
                <p className="text-white/80 mt-2 text-sm">
                  Local: <span className="font-bold">{verifiedLocalName}</span>
                  {isKnownLocal ? ' — configuración actual' : ' — local nuevo, completá las rutas'}
                </p>
              </div>

              {loadingRoutes ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                </div>
              ) : (
                <form onSubmit={handleSaveRoutes} className="space-y-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-white/70">Database URL</Label>
                    <Input
                      type="text"
                      value={routes.databaseURL}
                      onChange={(e) => setRoutes(r => ({ ...r, databaseURL: e.target.value }))}
                      placeholder="https://mi-proyecto-default-rtdb.firebaseio.com"
                      className="h-11 text-sm bg-white/10 text-white placeholder-white/50 border-white/30 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-white/70">Database Path</Label>
                    <Input
                      type="text"
                      value={routes.databasePath}
                      onChange={(e) => setRoutes(r => ({ ...r, databasePath: e.target.value }))}
                      placeholder={localId}
                      className="h-11 text-sm bg-white/10 text-white placeholder-white/50 border-white/30 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-white/70">Storage Bucket</Label>
                    <Input
                      type="text"
                      value={routes.storageBucket}
                      onChange={(e) => setRoutes(r => ({ ...r, storageBucket: e.target.value }))}
                      placeholder="mi-proyecto.firebasestorage.app"
                      className="h-11 text-sm bg-white/10 text-white placeholder-white/50 border-white/30 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-white/70">Storage Base Path</Label>
                    <Input
                      type="text"
                      value={routes.storageBasePath}
                      onChange={(e) => setRoutes(r => ({ ...r, storageBasePath: e.target.value }))}
                      placeholder="(opcional)"
                      className="h-11 text-sm bg-white/10 text-white placeholder-white/50 border-white/30 font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    className="flex items-center gap-1 text-xs text-white/60 hover:text-white/90"
                  >
                    {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    Avanzado (apiKey / projectId){!isKnownLocal && ' — requerido para local nuevo'}
                  </button>
                  {showAdvanced && (
                    <div className="space-y-3 pl-1 border-l-2 border-white/20 ml-1">
                      <div className="space-y-1 pl-3">
                        <Label className="text-xs text-white/70">API Key</Label>
                        <Input
                          type="text"
                          value={advanced.apiKey}
                          onChange={(e) => setAdvanced(a => ({ ...a, apiKey: e.target.value }))}
                          placeholder={isKnownLocal ? '(se resuelve automáticamente)' : 'AIza...'}
                          className="h-10 text-xs bg-white/10 text-white placeholder-white/50 border-white/30 font-mono"
                        />
                      </div>
                      <div className="space-y-1 pl-3">
                        <Label className="text-xs text-white/70">Project ID</Label>
                        <Input
                          type="text"
                          value={advanced.projectId}
                          onChange={(e) => setAdvanced(a => ({ ...a, projectId: e.target.value }))}
                          placeholder={isKnownLocal ? '(se resuelve automáticamente)' : 'mi-proyecto'}
                          className="h-10 text-xs bg-white/10 text-white placeholder-white/50 border-white/30 font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {routesError && <p className="text-red-400 text-sm text-center font-bold">{routesError}</p>}

                  <div className="flex gap-2 pt-2">
                    {isKnownLocal && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={savingRoutes}
                        onClick={handleContinueWithoutSaving}
                        className="flex-1 h-11 text-sm bg-transparent text-white border-white/30 hover:bg-white/10"
                      >
                        <ArrowRight className="mr-2 h-4 w-4" /> Continuar sin cambios
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={savingRoutes}
                      className="flex-1 h-11 text-sm font-bold bg-orange-500 hover:bg-orange-600"
                    >
                      {savingRoutes
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <Save className="mr-2 h-4 w-4" />}
                      Guardar y continuar
                    </Button>
                  </div>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default LocalIdSetup;