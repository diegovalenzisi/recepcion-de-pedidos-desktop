import React from 'react';
import {
  Volume2, VolumeX, PlayCircle, Unlock, Stethoscope, CreditCard,
  Wifi, WifiOff, AlertTriangle, Loader2, RefreshCw, Server, ServerOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AUTO_VOICE_VALUE } from '@/hooks/useVoicePaymentAlerts';

// ── Watcher (Firebase listener) ─────────────────────────────────────────────
const WATCHER_CONFIG = {
  activo:     { label: 'Activo',      icon: Wifi,          color: 'text-green-600',  bg: 'bg-green-50 border-green-200' },
  conectando: { label: 'Conectando…', icon: Loader2,        color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200' },
  error:      { label: 'Error',       icon: AlertTriangle,  color: 'text-red-600',    bg: 'bg-red-50 border-red-200' },
  inactivo:   { label: 'Inactivo',    icon: WifiOff,        color: 'text-gray-400',   bg: 'bg-gray-50 border-gray-200' },
};

// ── Backend MP (poller real) ─────────────────────────────────────────────────
function backendConfig(backendStatus) {
  if (!backendStatus || !window.electronAPI?.mpBackendHealth) {
    // No Electron → no mostrar backend status
    return null;
  }
  if (!backendStatus.reachable) {
    return { label: 'Detenido',    icon: ServerOff,      color: 'text-gray-400',  bg: 'bg-gray-50 border-gray-200' };
  }
  if (!backendStatus.tokenPresente) {
    return { label: 'Sin token MP', icon: AlertTriangle,  color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' };
  }
  if (backendStatus.lastError) {
    return { label: 'Error MP',     icon: AlertTriangle,  color: 'text-red-600',   bg: 'bg-red-50 border-red-200' };
  }
  return { label: 'Poller activo', icon: Server,          color: 'text-green-600', bg: 'bg-green-50 border-green-200' };
}

function fmtTime(val) {
  if (!val) return '—';
  const d = val instanceof Date ? val : new Date(val);
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtUptime(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Punto de estado (bolita) ─────────────────────────────────────────────────
function StatusDot({ watcher, backend }) {
  // Verde: watcher activo; Amarillo: watcher activo pero backend sin token/error; Rojo: error watcher
  if (watcher === 'error') return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />;
  if (watcher === 'activo' && backend?.reachable && backend?.tokenPresente && !backend?.lastError) {
    return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-500" />;
  }
  if (watcher === 'activo') {
    return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />;
  }
  if (watcher === 'conectando') return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />;
  return <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-gray-300" />;
}

const VoicePaymentAlertWidget = ({
  isEnabled,
  isSoundUnlocked,
  lastAnnouncedPayment,
  availableVoices,
  selectedVoiceURI,
  diagnosisResult,
  watcherStatus = 'inactivo',
  lastPaymentDetectedAt,
  lastWatcherError,
  lastCheckAt,
  enableSound,
  testVoice,
  testMercadoPago,
  runDiagnosis,
  toggleEnabled,
  selectVoice,
  // Estado del backend MP (de useMpBackendStatus)
  backendStatus,
  backendLoading,
  refreshBackend,
}) => {
  const wc = WATCHER_CONFIG[watcherStatus] ?? WATCHER_CONFIG.inactivo;
  const WatcherIcon = wc.icon;
  const bc = backendConfig(backendStatus);
  const BackendIcon = bc?.icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-md transition-colors relative"
          title="Estado MP y avisos por voz"
        >
          {isEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          <StatusDot watcher={watcherStatus} backend={backendStatus} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 space-y-3">

        {/* ── Estado: Firebase Listener ── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Firebase Listener</p>
          <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium ${wc.bg} ${wc.color}`}>
            <WatcherIcon size={13} className={watcherStatus === 'conectando' ? 'animate-spin' : ''} />
            <span>{wc.label}</span>
            {lastCheckAt && <span className="ml-auto text-xs opacity-70">{fmtTime(lastCheckAt)}</span>}
          </div>
          {watcherStatus === 'error' && lastWatcherError && (
            <p className="mt-1 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 break-words">
              {lastWatcherError}
            </p>
          )}
        </div>

        {/* ── Estado: Backend MP (poller real) ── */}
        {bc && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground">Backend Mercado Pago</p>
              <button
                onClick={refreshBackend}
                disabled={backendLoading}
                className="text-muted-foreground hover:text-foreground"
                title="Actualizar estado del backend"
              >
                <RefreshCw size={11} className={backendLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium ${bc.bg} ${bc.color}`}>
              <BackendIcon size={13} />
              <span>{bc.label}</span>
              {backendStatus?.uptimeS != null && (
                <span className="ml-auto text-xs opacity-70">uptime {fmtUptime(backendStatus.uptimeS)}</span>
              )}
            </div>

            {/* Sub-detalles del backend */}
            {backendStatus?.reachable && (
              <div className="mt-1.5 text-xs text-muted-foreground space-y-0.5 font-mono bg-muted/30 rounded px-2 py-1.5">
                <p>
                  <span className="font-sans font-medium text-foreground/70">Token: </span>
                  {backendStatus.tokenPresente ? '✓ presente' : '✗ no configurado'}
                </p>
                {backendStatus.localId && (
                  <p><span className="font-sans font-medium text-foreground/70">Local ID: </span>{backendStatus.localId}</p>
                )}
                {backendStatus.rutaFirebase && (
                  <p><span className="font-sans font-medium text-foreground/70">Ruta: </span>{backendStatus.rutaFirebase}</p>
                )}
                {backendStatus.pollingIntervalS != null && (
                  <p><span className="font-sans font-medium text-foreground/70">Polling: </span>cada {backendStatus.pollingIntervalS}s</p>
                )}
                {backendStatus.lastPollTime && (
                  <p><span className="font-sans font-medium text-foreground/70">Último poll: </span>{fmtTime(backendStatus.lastPollTime)} ({backendStatus.lastPollTotal ?? 0} pagos en ventana)</p>
                )}
                {backendStatus.lastWriteTime && (
                  <p><span className="font-sans font-medium text-foreground/70">Último guardado: </span>{fmtTime(backendStatus.lastWriteTime)} id={backendStatus.lastWriteId}</p>
                )}
                <p>
                  <span className="font-sans font-medium text-foreground/70">Email watcher: </span>
                  {backendStatus.emailWatcherEnabled === true
                    ? '✓ activo'
                    : backendStatus.emailWatcherEnabled === false
                      ? <span className="text-amber-600">desactivado (sin config IMAP)</span>
                      : '—'}
                </p>
                {backendStatus.lastError && (
                  <p className="text-red-600"><span className="font-sans font-medium">Error MP: </span>{backendStatus.lastError}</p>
                )}
              </div>
            )}

            {/* Aviso: backend alcanzable pero sin token */}
            {backendStatus?.reachable && !backendStatus?.tokenPresente && (
              <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                El backend corre pero no tiene token MP. Configuralo en <strong>Configuración → Cuenta Mercado Pago</strong>.
              </p>
            )}
            {/* Aviso: backend no responde */}
            {!backendStatus?.reachable && (
              <div className="mt-1.5 space-y-1">
                {backendStatus?.crashFast && backendStatus?.lastError ? (
                  <div className="text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-0.5">
                    <p className="font-semibold text-red-700">Error al iniciar el backend:</p>
                    <p className="font-mono text-red-600 break-all">{backendStatus.lastError}</p>
                    {!backendStatus.firebaseCredsPresente && (
                      <p className="text-red-700 mt-1 font-sans">
                        <strong>Causa:</strong> Faltan credenciales Firebase en <code>backend.env</code>. Pedile el archivo a Diego o generalo desde AFIP.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                    El backend no responde. Los pagos reales de MP no se escribirán en Firebase hasta que se inicie.
                  </p>
                )}
                {backendStatus?.diagAvailable && !backendStatus?.firebaseCredsPresente && !backendStatus?.crashFast && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    Faltan credenciales Firebase en <code>backend.env</code>.
                  </p>
                )}
                {backendStatus?.diagAvailable && !backendStatus?.tokenPresente && backendStatus?.firebaseCredsPresente && !backendStatus?.crashFast && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    Falta el token de Mercado Pago. Configuralo en <strong>Configuración → Cuenta MP</strong>.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Toggle avisos por voz ── */}
        <div className="flex items-center justify-between border-t pt-2">
          <Label htmlFor="voice-alerts-toggle" className="text-sm font-medium">
            Avisos por voz
          </Label>
          <Switch
            id="voice-alerts-toggle"
            checked={isEnabled}
            onCheckedChange={toggleEnabled}
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={enableSound} className="flex-1">
            <Unlock className="mr-2 h-4 w-4" />
            Activar sonido
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={testVoice} className="flex-1">
            <PlayCircle className="mr-2 h-4 w-4" />
            Probar voz
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={testMercadoPago}
          className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
        >
          <CreditCard className="mr-2 h-4 w-4" />
          Probar pago MP real (sin cliente)
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={runDiagnosis} className="w-full">
          <Stethoscope className="mr-2 h-4 w-4" />
          Diagnóstico Firebase
        </Button>

        {diagnosisResult && (
          <div className="text-xs bg-muted rounded p-2 space-y-0.5">
            {diagnosisResult.error ? (
              <p className="text-destructive font-medium">Error: {diagnosisResult.error}</p>
            ) : (
              <>
                <p className="font-medium">Diagnóstico Firebase</p>
                <p>Ruta: <span className="font-mono break-all">{diagnosisResult.ruta}</span></p>
                <p>Total pagos: <span className="font-semibold">{diagnosisResult.total}</span></p>
                <p>
                  No leídos:{' '}
                  <span className={`font-semibold ${diagnosisResult.noLeidos > 0 ? 'text-orange-600' : ''}`}>
                    {diagnosisResult.noLeidos}
                  </span>
                </p>
                <p>Leídos: <span className="font-semibold">{diagnosisResult.leidos}</span></p>
                {diagnosisResult.ultimoNoLeido && (
                  <p className="text-muted-foreground">
                    Último pendiente: ${diagnosisResult.ultimoNoLeido.monto} — {diagnosisResult.ultimoNoLeido.medio} ({diagnosisResult.ultimoNoLeido.fecha})
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {!isSoundUnlocked && (
          <p className="text-xs text-muted-foreground">
            Hacé clic en "Activar sonido" una vez para habilitar los avisos.
          </p>
        )}

        {/* Selector de voz */}
        <div className="space-y-1">
          <Label htmlFor="voice-alerts-voice-select" className="text-sm font-medium">
            Voz para los avisos
          </Label>
          <Select value={selectedVoiceURI} onValueChange={selectVoice}>
            <SelectTrigger id="voice-alerts-voice-select" className="h-9 text-xs">
              <SelectValue placeholder="Automática" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_VOICE_VALUE}>Automática (recomendada)</SelectItem>
              {availableVoices.map((voice) => (
                <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Panel de actividad */}
        <div className="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
          <p>
            <span className="font-medium">Último aviso: </span>
            {lastAnnouncedPayment
              ? `${lastAnnouncedPayment.cliente || lastAnnouncedPayment.medio || 'MP'} — $${lastAnnouncedPayment.monto}`
              : '—'}
          </p>
          <p>
            <span className="font-medium">Último pago detectado: </span>
            {fmtTime(lastPaymentDetectedAt)}
          </p>
          <p>
            <span className="font-medium">Último chequeo Firebase: </span>
            {fmtTime(lastCheckAt)}
          </p>
        </div>

      </PopoverContent>
    </Popover>
  );
};

export default VoicePaymentAlertWidget;
