import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

const isElectron = () => !!window.electronAPI?.systemCheck;

// Orden y labels del panel de estado del sistema
const CHECK_ORDER = [
  { key: 'nodeBundled',   emoji: '⚙️', critical: true  },
  { key: 'afipModules',   emoji: '📦', critical: true  },
  { key: 'afipRI',        emoji: '🧾', critical: false },
  { key: 'backendEngine', emoji: '🔧', critical: true  },
  { key: 'backendEnv',    emoji: '🌐', critical: false },
  { key: 'mpToken',       emoji: '💳', critical: false },
];

// Componentes descargables
const COMP_ORDER = [
  { key: 'nodeAfip',           emoji: '⚙️', label: 'Node AFIP v16'           },
  { key: 'openssl',            emoji: '🔐', label: 'OpenSSL Win64'            },
  { key: 'facturacionRuntime', emoji: '📦', label: 'Runtime Facturación AFIP' },
];

function StatusRow({ icon, label, ok, detail, loading }) {
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 mt-0.5 flex-shrink-0" />
        : ok
          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 flex-shrink-0" />
          : <XCircle      className="h-3.5 w-3.5 text-red-500  mt-0.5 flex-shrink-0" />}
      <span className={`font-medium flex-shrink-0 w-48 ${ok ? 'text-gray-700' : 'text-red-700'}`}>
        {icon} {label}
      </span>
      {detail && (
        <span className="text-gray-400 font-mono text-xs truncate" title={detail}>{detail}</span>
      )}
    </div>
  );
}

// ─── Panel de componentes descargables ───────────────────────────────────────
function ComponentsPanel() {
  const [compState, setCompState]   = useState(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress]     = useState([]);
  const [loadingComp, setLoadingComp] = useState(false);
  const { toast } = useToast();
  const cleanupRef = useRef(null);

  const checkComps = async (silent = false) => {
    if (!silent) setLoadingComp(true);
    try {
      const state = await window.electronAPI.components.check();
      setCompState(state);
    } catch (e) {
      console.error('[components:check]', e);
    } finally {
      if (!silent) setLoadingComp(false);
    }
  };

  useEffect(() => {
    checkComps(true);
  }, []);

  const allCompOk = compState && COMP_ORDER.every(c => compState[c.key]?.ok);
  const missingKeys = compState ? COMP_ORDER.filter(c => !compState[c.key]?.ok).map(c => c.key) : [];

  const handleInstall = async () => {
    setInstalling(true);
    setProgress([]);

    const cleanup = window.electronAPI.components.onProgress((data) => {
      setProgress(prev => {
        const msgs = [...prev];
        if (data.step === 'manifest') {
          msgs.push({ text: data.msg, type: 'info' });
        } else if (data.step === 'download') {
          const last = msgs[msgs.length - 1];
          const text = `Descargando ${data.label}… ${data.pct}%`;
          if (last?.downloading === data.component) {
            msgs[msgs.length - 1] = { ...last, text };
          } else {
            msgs.push({ text, type: 'info', downloading: data.component });
          }
        } else if (data.step === 'validate') {
          msgs.push({ text: `Validando ${data.label}…`, type: 'info' });
        } else if (data.step === 'extract') {
          msgs.push({ text: `Extrayendo ${data.label}…`, type: 'info' });
        } else if (data.step === 'install') {
          msgs.push({ text: `Instalando ${data.label}…`, type: 'info' });
        } else if (data.step === 'done') {
          msgs.push({ text: `✓ ${data.label} instalado`, type: 'ok' });
        } else if (data.step === 'error') {
          msgs.push({ text: `✗ ${data.label}: ${data.error}`, type: 'error' });
        }
        return msgs.slice(-40);
      });
    });
    cleanupRef.current = cleanup;

    try {
      const result = await window.electronAPI.components.install(missingKeys);
      if (result.ok) {
        toast({ title: '✓ Componentes instalados', description: 'Todos los componentes están listos.', className: 'bg-green-500 text-white' });
      } else {
        toast({ variant: 'destructive', title: 'Errores al instalar', description: result.errors?.join('\n') || 'Error desconocido' });
      }
      await checkComps(true);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error de instalación', description: e.message });
    } finally {
      setInstalling(false);
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    }
  };

  if (!compState && loadingComp) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando componentes…
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${allCompOk ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">
          {allCompOk ? '✓ Componentes AFIP listos' : '⚠ Componentes faltantes'}
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-gray-500" onClick={() => checkComps(false)} disabled={loadingComp || installing}>
          <RefreshCw className={`h-3 w-3 ${loadingComp ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Estado de cada componente */}
      <div className="bg-white/70 rounded p-2 space-y-0.5">
        {COMP_ORDER.map(({ key, emoji, label }) => {
          const c = compState?.[key];
          return (
            <StatusRow
              key={key}
              icon={emoji}
              label={label}
              ok={!!c?.ok}
              detail={c?.version || (c?.ok ? 'instalado' : 'faltante')}
              loading={!compState}
            />
          );
        })}
      </div>

      {/* Botón de instalación */}
      {!allCompOk && !installing && (
        <Button
          size="sm"
          className="w-full h-8 text-xs gap-2 bg-orange-600 hover:bg-orange-700 text-white"
          onClick={handleInstall}
        >
          <Download className="h-3.5 w-3.5" />
          Instalar componentes necesarios (~46 MB)
        </Button>
      )}

      {/* Log de progreso */}
      {installing && (
        <div className="bg-gray-900 rounded p-2 max-h-36 overflow-y-auto font-mono text-xs space-y-0.5">
          {progress.length === 0 && (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Iniciando descarga…
            </div>
          )}
          {progress.map((p, i) => (
            <div key={i} className={
              p.type === 'ok'    ? 'text-green-400' :
              p.type === 'error' ? 'text-red-400'   : 'text-gray-300'
            }>{p.text}</div>
          ))}
        </div>
      )}

      {!allCompOk && !installing && (
        <p className="text-xs text-orange-700">
          Los componentes se descargan una sola vez desde el servidor y quedan en esta PC.
          No se suben ni sincronizan datos reales.
        </p>
      )}
    </div>
  );
}

// ─── Panel principal de salud del sistema ────────────────────────────────────
const SystemHealthPanel = () => {
  const [checks, setChecks]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [expanded, setExpanded]       = useState(false);
  const [fixing, setFixing]           = useState(false);
  const [mpToken, setMpToken]         = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const { toast } = useToast();
  const ranOnce = useRef(false);

  if (!isElectron()) return null;

  const runCheck = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await window.electronAPI.systemCheck();
      setChecks(result);
      const anyFail = CHECK_ORDER.some(c => !result[c.key]?.ok);
      if (anyFail) setExpanded(true);
    } catch (e) {
      console.error('[health-check]', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    runCheck(true);
  }, []);

  const handleGenEnv = async () => {
    setFixing(true);
    try {
      const result = await window.electronAPI.backend.genEnvFromSA(mpToken || undefined);
      if (result.ok) {
        toast({ title: '✓ backend.env generado', description: `Proyecto: ${result.project}. ${result.localId ? 'Local ID: ' + result.localId : 'Ingresá el MP token.'}`, className: 'bg-green-500 text-white' });
        setShowTokenInput(!mpToken);
        await runCheck(true);
      } else {
        toast({ variant: 'destructive', title: 'Error al generar backend.env', description: result.error });
      }
    } finally {
      setFixing(false);
    }
  };

  const handleSaveToken = async () => {
    if (!mpToken.trim()) return;
    setFixing(true);
    try {
      const result = await window.electronAPI.backend.setMpToken(mpToken.trim());
      if (result.ok) {
        toast({ title: '✓ Token MP guardado', description: 'Reiniciá el backend para aplicar.', className: 'bg-green-500 text-white' });
        setShowTokenInput(false);
        setMpToken('');
        await window.electronAPI.backendRestart?.();
        await runCheck(true);
      } else {
        toast({ variant: 'destructive', title: 'Error al guardar token', description: result.error });
      }
    } finally {
      setFixing(false);
    }
  };

  const allOk     = checks && CHECK_ORDER.every(c => checks[c.key]?.ok);
  const meta      = checks?._meta;
  const anyFail   = checks && CHECK_ORDER.some(c => !checks[c.key]?.ok);
  const canGenEnv = meta?.riSaExists && !checks?.backendEnv?.ok;

  return (
    <div className="space-y-3">
      {/* Panel de componentes descargables */}
      <ComponentsPanel />

      {/* Panel de salud del sistema */}
      <div className={`rounded-lg border text-sm ${allOk ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
        {/* Cabecera colapsable */}
        <div
          className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex items-center gap-2">
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              : allOk
                ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                : <AlertCircle  className="h-4 w-4 text-amber-600" />}
            <span className="font-semibold">
              {loading && !checks
                ? 'Verificando sistema…'
                : allOk
                  ? 'Sistema OK'
                  : 'Atención requerida'}
            </span>
            {!loading && anyFail && (
              <span className="text-xs text-amber-700 font-normal">
                — {CHECK_ORDER.filter(c => !checks[c.key]?.ok).length} ítem{CHECK_ORDER.filter(c => !checks[c.key]?.ok).length > 1 ? 's' : ''} pendiente{CHECK_ORDER.filter(c => !checks[c.key]?.ok).length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs gap-1 text-gray-600"
              onClick={() => runCheck(false)}
              disabled={loading}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Verificar
            </Button>
            {expanded
              ? <ChevronUp   className="h-4 w-4 text-gray-400" />
              : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </div>
        </div>

        {expanded && checks && (
          <div className="px-4 pb-4 space-y-3 border-t border-current border-opacity-10 pt-3">
            {/* Status grid */}
            <div className="bg-white/70 rounded-lg p-3 space-y-0.5">
              {CHECK_ORDER.map(({ key, emoji }) => {
                const c = checks[key];
                if (!c) return null;
                return (
                  <StatusRow
                    key={key}
                    icon={emoji}
                    label={c.label}
                    ok={c.ok}
                    detail={c.detail}
                    loading={false}
                  />
                );
              })}
            </div>

            {/* Auto-reparación */}
            <div className="space-y-2">
              {canGenEnv && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
                  <p className="text-xs text-blue-800 font-medium">
                    💡 Se detectó el serviceAccount de AFIP — se puede generar backend.env automáticamente.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant="default"
                      className="bg-blue-600 hover:bg-blue-700 h-7 text-xs"
                      onClick={handleGenEnv}
                      disabled={fixing}
                    >
                      {fixing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Generar backend.env desde AFIP
                    </Button>
                  </div>
                </div>
              )}

              {checks.mpToken && !checks.mpToken.ok && (
                <div className="rounded-lg bg-pink-50 border border-pink-200 p-3 space-y-2">
                  <p className="text-xs text-pink-800 font-medium">
                    💳 Falta el Access Token de Mercado Pago. Ingresalo aquí (solo necesario 1 vez por PC).
                  </p>
                  {!showTokenInput ? (
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs border-pink-400 text-pink-700"
                      onClick={() => setShowTokenInput(true)}
                    >
                      Ingresar token
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="APP_USR-..."
                        value={mpToken}
                        onChange={e => setMpToken(e.target.value)}
                        className="h-7 text-xs font-mono flex-1"
                      />
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleSaveToken}
                        disabled={!mpToken.trim() || fixing}
                      >
                        {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => { setShowTokenInput(false); setMpToken(''); }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemHealthPanel;
