import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

const isElectron = () => !!window.electronAPI?.systemCheck;

// Orden y labels del panel de estado
const CHECK_ORDER = [
  { key: 'nodeBundled',   emoji: '⚙️', critical: true  },
  { key: 'afipModules',   emoji: '📦', critical: true  },
  { key: 'afipRI',        emoji: '🧾', critical: false },
  { key: 'backendEngine', emoji: '🔧', critical: true  },
  { key: 'backendEnv',    emoji: '🌐', critical: false },
  { key: 'mpToken',       emoji: '💳', critical: false },
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
      // Auto-expand si hay algo mal
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

          {/* Deps pack manual — solo muestra si falta Node o módulos AFIP */}
          {meta && (meta.nodeMissing || meta.afipModulesMissing) && (
            <div className="rounded-lg bg-orange-50 border border-orange-300 p-3 space-y-2">
              <p className="text-xs text-orange-900 font-semibold">
                📦 Deps pack no encontrado — copiarlo manualmente (1 vez por PC)
              </p>
              <div className="space-y-1 font-mono text-xs text-orange-800 bg-orange-100 rounded p-2">
                {meta.nodeMissing && (
                  <div>
                    <span className="text-red-600">✗ node.exe</span>
                    <span className="text-gray-600"> → </span>
                    <span className="break-all">{meta.depsPackPaths?.nodeExe}</span>
                  </div>
                )}
                {meta.afipModulesMissing && (
                  <div>
                    <span className="text-red-600">✗ node_modules\</span>
                    <span className="text-gray-600"> → </span>
                    <span className="break-all">{meta.depsPackPaths?.nodeModules}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-orange-700">
                Copiá estas carpetas desde otra PC o desde el deps pack por USB/red.
                Después hacé clic en "Verificar".
              </p>
            </div>
          )}

          {/* Auto-reparación */}
          <div className="space-y-2">
            {/* backend.env falta pero tenemos serviceAccount → auto-generar */}
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

            {/* Token MP falta */}
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
  );
};

export default SystemHealthPanel;
