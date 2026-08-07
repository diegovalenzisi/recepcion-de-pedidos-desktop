import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Play, Square, RotateCcw, Plus, Trash2, Save, FileText,
  Receipt, FolderOpen, Download, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, Cloud, CloudOff, RefreshCw,
  Stethoscope, XCircle, ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getCurrentLocalId } from '@/lib/firebase/core';
import { uploadAfipFile } from '@/lib/firebase/storage';
import { saveAfipConfigToFirebase, fetchAfipConfigFromFirebase } from '@/lib/api/afipConfigApi';
import { useFacturacionOwnership } from '@/hooks/useFacturacionOwnership';
import ColasFiscalesPanel from '@/components/settings/local/admin/ColasFiscalesPanel';
import { normalizeFirebaseDatabaseURL } from '@/lib/utils/firebaseUrl';
import {
  facturacionActivaEnEstaPC,
  aplicarSwitchFacturacion,
  clavesDeProceso,
} from '@/lib/api/switchFacturacion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fAPI = () => window.electronAPI?.facturacion;
const ts   = () => new Date().toLocaleTimeString('es-AR');

const DEFAULT_FIELDS = (condIVA) => ({
  nombre: '', cuit: '', cuitFormat: '', razonSocial: '', fantasia: '',
  domicilio: '', inicioActividades: '', iibb: '', condIVA,
  ptoVta: '', logAlias: '', firebaseDb: '', firebasePath: '', firebaseHistorial: '',
  opensslBin: '',
  certFile: null, keyFile: null, serviceAccountFile: null,
  certStoragePath: null, keyStoragePath: null, serviceAccountStoragePath: null,
  certDownloadUrl: null, keyDownloadUrl: null, serviceAccountDownloadUrl: null,
  initialized: false, activo: false,
});

const DEFAULT_CONFIG = {
  tipo: 'responsable_inscripto',
  autoStart: false,
  ri: { id: 'ri', ...DEFAULT_FIELDS('Responsable Inscripto') },
  monotributo: { cuentas: [] },
};

const DEFAULT_CUENTA = (id) => ({ id, ...DEFAULT_FIELDS('Monotributista') });

function buildEnvData(fields, tipo, machineId) {
  return {
    CUIT:                          fields.cuit                || '',
    PTO_VTA:                       fields.ptoVta              || '',
    CERT:                          './cert/certificado.crt',
    KEY:                           './cert/clave.key',
    FIREBASE_DB:                   fields.firebaseDb          || '',
    FIREBASE_PATH:                 fields.firebasePath        || '',
    FIREBASE_HISTORIAL:            fields.firebaseHistorial   || '',
    GOOGLE_APPLICATION_CREDENTIALS: './serviceAccount.json',
    EMISOR_RAZON_SOCIAL:           fields.razonSocial         || '',
    EMISOR_FANTASIA:               fields.fantasia            || '',
    EMISOR_CUIT_FORMAT:            fields.cuitFormat          || '',
    EMISOR_DOMICILIO:              fields.domicilio           || '',
    EMISOR_COND_IVA:               fields.condIVA             || '',
    EMISOR_INICIO_ACTIVIDADES:     fields.inicioActividades   || '',
    EMISOR_IIBB:                   fields.iibb                || '',
    OPENSSL_BIN:                   fields.opensslBin          || '',
    LOG_ALIAS:                     fields.logAlias || fields.nombre || '',
    MACHINE_ID:                    machineId                  || '',
  };
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------
function StatusBadge({ status }) {
  if (status === 'running')
    return <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">● Activo</span>;
  if (status === 'error')
    return <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold">● Error</span>;
  return <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold">○ Detenido</span>;
}

// ---------------------------------------------------------------------------
// LogsPanel
// ---------------------------------------------------------------------------
function LogsPanel({ processKey }) {
  const [logs, setLogs] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    fAPI()?.getLogs(processKey).then(l => setLogs(l || []));
    const cleanup = fAPI()?.onLog?.(({ key, lines }) => {
      if (key !== processKey) return;
      setLogs(prev => [...prev, ...lines].slice(-300));
    });
    return () => typeof cleanup === 'function' && cleanup();
  }, [processKey]);

  // Scroll solo dentro del contenedor — nunca afecta el viewport de la página
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="mt-2">
      <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
        <FileText className="h-3 w-3" /> Logs
      </p>
      <div
        ref={scrollRef}
        className="rounded border border-gray-700 bg-gray-950 h-28 overflow-y-auto p-2 font-mono text-xs text-gray-200 leading-tight"
      >
        {logs.length === 0
          ? <span className="text-gray-500">Sin actividad...</span>
          : logs.map((l, i) => <div key={i}>{l}</div>)
        }
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProcessControls
// ---------------------------------------------------------------------------
function ProcessControls({ processKey, accountDir, status, onStatusChange }) {
  const { toast } = useToast();

  const handle = async (action) => {
    const f = fAPI();
    if (!f || !accountDir) return;
    try {
      if (action === 'start') {
        await f.start(processKey, accountDir);
        onStatusChange(processKey, 'running');
        toast({ title: 'Facturación iniciada', className: 'bg-green-500 text-white' });
      } else if (action === 'stop') {
        await f.stop(processKey);
        onStatusChange(processKey, 'stopped');
      } else if (action === 'restart') {
        await f.restart(processKey, accountDir);
        onStatusChange(processKey, 'running');
        toast({ title: 'Reiniciada', className: 'bg-green-500 text-white' });
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <StatusBadge status={status} />
      <Button size="sm" variant="outline" onClick={() => handle('start')} disabled={status === 'running'}>
        <Play className="h-3 w-3 mr-1" /> Iniciar
      </Button>
      <Button size="sm" variant="outline" onClick={() => handle('stop')} disabled={status !== 'running'}>
        <Square className="h-3 w-3 mr-1" /> Detener
      </Button>
      <Button size="sm" variant="outline" onClick={() => handle('restart')}>
        <RotateCcw className="h-3 w-3 mr-1" /> Reiniciar
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilePicker
// ---------------------------------------------------------------------------
function FilePicker({ label, value, onChange, filters, placeholder, downloadUrl, onDownload }) {
  const pick = async () => {
    const p = await fAPI()?.pickFile(filters);
    if (p) onChange(p);
  };

  const hasStorage = !!downloadUrl;

  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-500">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value || (hasStorage ? '(guardado en Storage)' : '')}
          readOnly
          placeholder={placeholder || 'Sin seleccionar...'}
          className="font-mono text-xs bg-gray-50 flex-1"
        />
        <Button size="sm" variant="outline" type="button" onClick={pick}>
          <FolderOpen className="h-3 w-3 mr-1" /> Examinar
        </Button>
        {hasStorage && onDownload && (
          <Button size="sm" variant="ghost" type="button" onClick={onDownload} title="Descargar desde Storage">
            <Download className="h-3 w-3" />
          </Button>
        )}
      </div>
      {hasStorage && <p className="text-xs text-green-600">✓ Guardado en Firebase Storage</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DepsPanel — Estado del sistema AFIP + preparación de módulos
// ---------------------------------------------------------------------------
function DepsPanel({ depsOk, onInstalled }) {
  const [installing, setInstalling] = useState(false);
  const [log, setLog]               = useState([]);
  const [nodeInfo, setNodeInfo]     = useState(null);
  const scrollRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    fAPI()?.nodeVersion?.().then(info => setNodeInfo(info)).catch(() => {});
    const cleanup = fAPI()?.onInstallLog?.((line) => {
      setLog(prev => [...prev, line.trimEnd()].slice(-200));
    });
    return () => typeof cleanup === 'function' && cleanup();
  }, []);

  // Scroll interno del log — no arrastra el viewport
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const prepare = async () => {
    setInstalling(true);
    setLog([`[${ts()}] Preparando módulos AFIP...`]);
    try {
      await fAPI().installDeps();
      toast({ title: 'Módulos AFIP listos', className: 'bg-green-500 text-white' });
      fAPI()?.nodeVersion?.().then(info => setNodeInfo(info)).catch(() => {});
      onInstalled();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al preparar módulos', description: e.message });
    } finally {
      setInstalling(false);
    }
  };

  const StatusRow = ({ label, ok, detail }) => (
    <div className="flex items-center gap-2 text-xs py-0.5">
      {ok
        ? <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
        : <XCircle      className="h-3 w-3 text-red-500  flex-shrink-0" />}
      <span className={`font-medium w-40 flex-shrink-0 ${ok ? 'text-gray-700' : 'text-red-700'}`}>{label}</span>
      {detail && <span className="text-gray-500 font-mono text-xs truncate">{detail}</span>}
    </div>
  );

  return (
    <div className={`p-3 rounded-lg border space-y-2 ${depsOk ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>

      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {depsOk
            ? <CheckCircle2 className="h-4 w-4 text-green-600" />
            : <AlertCircle  className="h-4 w-4 text-amber-600" />}
          <span className="text-sm font-medium">
            {depsOk ? 'Sistema AFIP listo' : 'Módulos AFIP no preparados'}
          </span>
        </div>
        <Button size="sm" onClick={prepare} disabled={installing} variant={depsOk ? 'outline' : 'default'}>
          <Download className="h-3 w-3 mr-1" />
          {installing ? 'Preparando...' : depsOk ? 'Reinstalar' : 'Preparar módulos'}
        </Button>
      </div>

      {/* Estado del sistema visible */}
      <div className="bg-white/60 rounded p-2 space-y-0.5">
        <StatusRow
          label="Node.js incluido"
          ok={nodeInfo?.ok ?? false}
          detail={nodeInfo?.ok ? nodeInfo.version : (nodeInfo ? 'No encontrado' : 'Verificando...')}
        />
        <StatusRow
          label="Módulos AFIP"
          ok={depsOk}
          detail={depsOk ? 'firebase-admin, soap, pdfkit, qrcode' : 'Falta preparar'}
        />
      </div>

      {!depsOk && (
        <p className="text-xs text-amber-700">
          Hacé clic en "Preparar módulos". Se copian desde el instalador — no requiere internet ni Node externo.
        </p>
      )}

      {/* Log de instalación */}
      {log.length > 0 && (
        <div
          ref={scrollRef}
          className="rounded border border-gray-700 bg-gray-950 h-20 overflow-y-auto p-2 font-mono text-xs text-gray-200 leading-tight"
        >
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiagnosticPanel
// ---------------------------------------------------------------------------
function DiagnosticPanel({ tipo, cuentaId }) {
  const [diag, setDiag]       = useState(null);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    const f = fAPI();
    if (!f) return;
    setRunning(true);
    try {
      const result = await f.diagnose(tipo, cuentaId);
      setDiag(result);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al diagnosticar', description: e.message });
    } finally {
      setRunning(false);
    }
  };

  const openLog = async () => {
    const f = fAPI();
    if (!f) return;
    const p = await f.openLog();
    toast({ title: 'Log abierto', description: p });
  };

  const FileRow = ({ label, info }) => (
    <div className="flex items-center gap-2 py-0.5">
      {info.exists
        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
        : <XCircle     className="h-3.5 w-3.5 text-red-500  flex-shrink-0" />}
      <span className={`text-xs font-medium w-32 flex-shrink-0 ${info.exists ? 'text-gray-700' : 'text-red-700'}`}>
        {label}
      </span>
      <span className="text-xs text-gray-500 font-mono truncate" title={info.path}>
        {info.path}
      </span>
    </div>
  );

  return (
    <div className="space-y-2 pt-2 border-t border-dashed border-gray-200">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          <Stethoscope className="h-3 w-3 mr-1" />
          {running ? 'Diagnosticando...' : 'Diagnosticar archivos'}
        </Button>
        <Button size="sm" variant="ghost" onClick={openLog}>
          <ExternalLink className="h-3 w-3 mr-1" /> Ver log
        </Button>
      </div>

      {diag && (
        <div className="rounded-lg border bg-gray-950 p-3 space-y-2">
          <p className="text-xs text-gray-400">{diag.timestamp}</p>

          <div>
            <p className="text-xs text-gray-400 mb-1 font-semibold">Rutas</p>
            <p className="text-xs text-gray-300 font-mono">userData: <span className="text-yellow-300">{diag.userData}</span></p>
            <p className="text-xs text-gray-300 font-mono">accountDir: <span className="text-yellow-300">{diag.accountDir}</span></p>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1 font-semibold">Archivos</p>
            <div className="space-y-0.5">
              <FileRow label=".env"              info={diag.files.env} />
              <FileRow label="index.mjs"         info={diag.files.indexMjs} />
              <FileRow label="serviceAccount.json" info={diag.files.serviceAccount} />
              <FileRow label="certificado.crt"   info={diag.files.cert} />
              <FileRow label="clave.key"         info={diag.files.key} />
              <FileRow label="node_modules"      info={diag.files.nodeModules} />
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1 font-semibold">GOOGLE_APPLICATION_CREDENTIALS</p>
            <p className="text-xs text-gray-300 font-mono">
              En .env: <span className="text-cyan-300">{diag.gcpRaw || '(no definido)'}</span>
            </p>
            <p className="text-xs text-gray-300 font-mono">
              Ruta absoluta: <span className="text-cyan-300">{diag.gcpAbsolute || 'N/A'}</span>
            </p>
            <p className={`text-xs font-semibold ${diag.gcpExists ? 'text-green-400' : 'text-red-400'}`}>
              {diag.gcpExists ? '✓ Archivo existe' : '✗ Archivo NO encontrado en esa ruta'}
            </p>
          </div>

          {diag.logError && (
            <p className="text-xs text-red-400">Log error: {diag.logError}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FirebaseSyncBanner
// ---------------------------------------------------------------------------
function FirebaseSyncBanner({ firebaseConfig, onApply, onRefresh, syncing }) {
  if (!firebaseConfig) return null;
  const when = firebaseConfig.updatedAt
    ? new Date(firebaseConfig.updatedAt).toLocaleString('es-AR')
    : 'fecha desconocida';
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-blue-50 border-blue-200">
      <div className="flex items-center gap-2">
        <Cloud className="h-4 w-4 text-blue-600" />
        <span className="text-sm text-blue-800">
          Configuración en Firebase actualizada: <strong>{when}</strong>
        </span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={syncing}>
          <RefreshCw className={`h-3 w-3 mr-1 ${syncing ? 'animate-spin' : ''}`} /> Refrescar
        </Button>
        <Button size="sm" onClick={onApply} disabled={syncing}>
          <Download className="h-3 w-3 mr-1" /> Reconstruir local
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccountForm
// ---------------------------------------------------------------------------
function AccountForm({ tipo, fields, onChange, onSave, saving, accountDir, machineId }) {
  const isRI = tipo === 'responsable_inscripto';
  const f = (key) => ({ value: fields[key] || '', onChange: (e) => onChange(key, e.target.value) });

  const downloadCert = async (urlKey, destRelative) => {
    const url = fields[urlKey];
    if (!url || !accountDir) return;
    const dest = `${accountDir}/${destRelative}`;
    await fAPI()?.downloadFile(url, dest);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Nombre de cuenta</Label>
          <Input {...f('nombre')} placeholder={isRI ? 'Ej: Diego' : 'Ej: Lautaro'} className="bg-white" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">CUIT (sin guiones)</Label>
          <Input {...f('cuit')} placeholder="20247915886" className="bg-white font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">CUIT formateado (PDF)</Label>
          <Input {...f('cuitFormat')} placeholder="20-24791588-6" className="bg-white font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Punto de venta</Label>
          <Input {...f('ptoVta')} placeholder="1" className="bg-white font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Razón social</Label>
          <Input {...f('razonSocial')} placeholder="Juan Pérez" className="bg-white" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Nombre fantasía</Label>
          <Input {...f('fantasia')} placeholder="Mi Heladería" className="bg-white" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Domicilio</Label>
          <Input {...f('domicilio')} placeholder="Av. Siempre Viva 123" className="bg-white" />
        </div>
        {/* Inicio de actividades e Ingresos Brutos son datos del encabezado de
            CUALQUIER factura, no sólo de las de responsable inscripto. Estaban
            ocultos para monotributo y por eso ninguna cuenta monotributo los
            tenía cargados. Se imprimen sólo si están completos. */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Inicio de actividades</Label>
          <Input {...f('inicioActividades')} placeholder="01/01/2020" className="bg-white" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Ingresos Brutos</Label>
          <Input {...f('iibb')} placeholder="Ej: 901-234567-8 (vacío = no se imprime)" className="bg-white" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Alias en logs</Label>
          <Input {...f('logAlias')} placeholder="Ej: Factu-Diego" className="bg-white" />
        </div>
      </div>

      <Separator />
      <p className="text-xs font-semibold text-gray-600">Firebase AFIP</p>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Database URL</Label>
          <Input {...f('firebaseDb')} placeholder="https://mi-proyecto-rtdb.firebaseio.com" className="bg-white font-mono text-xs" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Path facturación</Label>
            <Input {...f('firebasePath')} placeholder="40508022/FACTURACION_1" className="bg-white font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">Path historial</Label>
            <Input {...f('firebaseHistorial')} placeholder="40508022/VENTAS" className="bg-white font-mono text-xs" />
          </div>
        </div>
      </div>

      <Separator />
      <p className="text-xs font-semibold text-gray-600">
        Certificados
        <span className="text-gray-400 font-normal ml-2">— se suben a Firebase Storage automáticamente al guardar</span>
      </p>
      <div className="space-y-2">
        <FilePicker
          label="Certificado AFIP (.crt)"
          value={fields.certFile}
          onChange={(p) => onChange('certFile', p)}
          filters={[{ name: 'Certificado', extensions: ['crt', 'pem'] }, { name: 'Todos', extensions: ['*'] }]}
          placeholder="Seleccionar certificado..."
          downloadUrl={fields.certDownloadUrl}
          onDownload={() => downloadCert('certDownloadUrl', 'cert/certificado.crt')}
        />
        <FilePicker
          label="Clave privada (.key)"
          value={fields.keyFile}
          onChange={(p) => onChange('keyFile', p)}
          filters={[{ name: 'Clave', extensions: ['key', 'pem'] }, { name: 'Todos', extensions: ['*'] }]}
          placeholder="Seleccionar clave..."
          downloadUrl={fields.keyDownloadUrl}
          onDownload={() => downloadCert('keyDownloadUrl', 'cert/clave.key')}
        />
        <FilePicker
          label="Service Account Firebase (.json)"
          value={fields.serviceAccountFile}
          onChange={(p) => onChange('serviceAccountFile', p)}
          filters={[{ name: 'JSON', extensions: ['json'] }]}
          placeholder="Seleccionar serviceAccount.json..."
          downloadUrl={fields.serviceAccountDownloadUrl}
          onDownload={() => downloadCert('serviceAccountDownloadUrl', 'serviceAccount.json')}
        />
      </div>

      <Separator />
      <div className="space-y-1">
        <Label className="text-xs text-gray-500">Ruta openssl.exe (dejar vacío si está en PATH)</Label>
        <Input {...f('opensslBin')} placeholder="C:\Program Files\OpenSSL-Win64\bin\openssl.exe" className="bg-white font-mono text-xs" />
      </div>

      {accountDir && <p className="text-xs text-gray-400 font-mono">Carpeta: {accountDir}</p>}
      {machineId && <p className="text-xs text-gray-400 font-mono">Machine ID: {machineId}</p>}

      <Button onClick={onSave} disabled={saving} className="w-full">
        <Save className="h-3 w-3 mr-1" />
        {saving ? 'Guardando...' : 'Guardar y subir a Firebase'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccountCard
// ---------------------------------------------------------------------------
function AccountCard({
  tipo, fields, onChange, onSave, onRemove, saving,
  processKey, accountDir, status, onStatusChange, machineId, cuentaId,
  ownershipAccount, onToggleAutoStart, ownershipBusy,
}) {
  const isOwner = !!ownershipAccount?.isOwner;
  const otherOwner = !ownershipAccount?.isOwner ? ownershipAccount?.owner : null;
  const [expanded, setExpanded] = useState(!fields.initialized);
  const isRI = tipo === 'responsable_inscripto';

  return (
    <div className="border rounded-lg bg-gray-50 overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={fields.initialized ? status : undefined} />
          <span className="text-sm font-medium">
            {fields.nombre || (isRI ? 'Responsable Inscripto' : 'Sin nombre')}
          </span>
          {fields.initialized && (
            <span className="text-xs text-gray-400 font-mono">
              CUIT {fields.cuit}{fields.ptoVta ? ` · Pto. Vta. ${fields.ptoVta}` : ''}
            </span>
          )}
          {fields.certStoragePath && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Cloud className="h-3 w-3" /> certs en Storage
            </span>
          )}
          {fields.initialized && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isOwner ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
            }`}>
              {isOwner
                ? '● Auto-inicio ON (esta PC)'
                : otherOwner
                  ? `○ Autorizada: ${otherOwner.nombrePc || 'otra PC'}`
                  : '○ Auto-inicio OFF (ninguna PC)'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isRI && (
            <Button size="sm" variant="ghost" className="text-red-500 h-6 w-6 p-0"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          <div className="pt-3">
            <AccountForm
              tipo={tipo} fields={fields} onChange={onChange}
              onSave={onSave} saving={saving} accountDir={accountDir}
              machineId={machineId}
            />
          </div>
          {fields.initialized && (
            <>
              <Separator />
              <div className="flex items-center gap-2">
                <Switch
                  id={`activo-${processKey}`}
                  checked={isOwner}
                  disabled={ownershipBusy}
                  onCheckedChange={(v) => onToggleAutoStart?.(v)}
                />
                <Label htmlFor={`activo-${processKey}`} className="text-xs cursor-pointer">
                  Inicio automático de facturación (solo esta PC)
                </Label>
                {ownershipBusy && <RefreshCw className="h-3 w-3 text-gray-400 animate-spin" />}
              </div>
              <p className="text-[11px] text-gray-400 -mt-2">
                Solo una PC puede tener esto activado por cuenta — se arbitra vía Firebase
                (dueño de facturación), no se copia igual a todas las PCs. Si otra PC ya está
                autorizada, tomar el control la desactiva automáticamente allá para evitar
                facturar el mismo pedido dos veces.
              </p>
              <ProcessControls
                processKey={processKey} accountDir={accountDir}
                status={status} onStatusChange={onStatusChange}
              />
              <LogsPanel processKey={processKey} />
              <DiagnosticPanel tipo={tipo} cuentaId={cuentaId} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// applyAccount — descarga certs desde Firebase y genera .env (helper compartido)
// ---------------------------------------------------------------------------
async function applyAccount(f, fields, tipo, cuentaId, mid) {
  const { ok, accountDir } = await f.initAccount(tipo, cuentaId);
  if (!ok) throw new Error('No se pudo crear directorio de cuenta');

  const dl = async (url, dest, nombre) => {
    if (!url) throw new Error(`${nombre}: sin URL en Firebase. ¿Se guardó la config con los archivos desde la PC principal?`);
    await f.downloadFile(url, `${accountDir}/${dest}`);
  };

  await dl(fields.certDownloadUrl,           'cert/certificado.crt', 'certificado.crt');
  await dl(fields.keyDownloadUrl,            'cert/clave.key',       'clave.key');
  await dl(fields.serviceAccountDownloadUrl, 'serviceAccount.json',  'serviceAccount.json');
  await f.writeEnv(accountDir, buildEnvData(fields, tipo, mid));
  return { ...fields, initialized: true };
}

// SEGURIDAD ANTI-DOBLE-FACTURACIÓN: fuerza que `activo` (Inicio automático de
// facturación) provenga SIEMPRE del archivo local de esta PC, nunca de Firebase.
// Cualquier `activo` que haya llegado mezclado desde `fbCfg` (config remota) se
// descarta y se reemplaza por el valor local (o `false` si esta PC nunca lo activó).
function enforceLocalActivo(candidateCfg, localSaved) {
  const localRiActivo = localSaved?.ri?.activo ?? false;
  const localCuentaActivo = (id) =>
    localSaved?.monotributo?.cuentas?.find(c => c.id === id)?.activo ?? false;

  // `facturacionAutomatica` va por el MISMO camino y por el mismo motivo: es la
  // decisión de ESTA computadora. La diferencia con `activo` es el valor cuando
  // falta: acá se deja `undefined` a propósito —no `false`— porque "el campo no
  // existe" significa ON por defecto. Ponerle false reproduciría exactamente el
  // problema que este cambio vino a arreglar.
  const localRiAuto = localSaved?.ri?.facturacionAutomatica;
  const localCuentaAuto = (id) =>
    localSaved?.monotributo?.cuentas?.find(c => c.id === id)?.facturacionAutomatica;

  const conAuto = (nodo, valor) => (
    valor === undefined
      ? (() => { const n = { ...nodo }; delete n.facturacionAutomatica; return n; })()
      : { ...nodo, facturacionAutomatica: valor }
  );

  const out = { ...candidateCfg };
  if (out.ri) out.ri = conAuto({ ...out.ri, activo: localRiActivo }, localRiAuto);
  if (out.monotributo?.cuentas) {
    out.monotributo = {
      ...out.monotributo,
      cuentas: out.monotributo.cuentas.map(c =>
        conAuto({ ...c, activo: localCuentaActivo(c.id) }, localCuentaAuto(c.id))),
    };
  }
  return out;
}

// `facturacionActivaEnEstaPC`, `aplicarSwitchFacturacion` y `clavesDeProceso`
// viven en switchFacturacion.js (módulo puro, con pruebas). Acá sólo se usan.

// ---------------------------------------------------------------------------
// FacturacionManager — componente principal
// ---------------------------------------------------------------------------
const FacturacionManager = () => {
  const [config, setConfig]           = useState(DEFAULT_CONFIG);
  const [statuses, setStatuses]       = useState({});
  const [depsOk, setDepsOk]           = useState(false);
  const [savingKey, setSavingKey]     = useState(null);
  const [globalSaving, setGlobalSaving] = useState(false);
  const [accountDirs, setAccountDirs] = useState({});
  const [machineId, setMachineId]     = useState(null);
  const [firebaseConfig, setFirebaseConfig] = useState(null);
  const [syncing, setSyncing]         = useState(false);
  const [aplicandoSwitch, setAplicandoSwitch] = useState(false);
  const { toast } = useToast();
  // Evitar doble-trigger de autostart en el mismo montaje
  const autoStartFiredRef = useRef(false);

  const isElectron = !!window.electronAPI?.facturacion;

  // Dueño de facturación (arbitraje anti-doble-facturación) — mismo hook que usa
  // el botón del footer visible para todos los usuarios.
  const ownership = useFacturacionOwnership();
  const [ownerConfirmOpen, setOwnerConfirmOpen] = useState(false);
  const [ownerConfirmData, setOwnerConfirmData] = useState(null);
  const ownerConfirmResolveRef = useRef(null);

  const askOwnerConfirm = (owner) => new Promise((resolve) => {
    setOwnerConfirmData(owner);
    ownerConfirmResolveRef.current = resolve;
    setOwnerConfirmOpen(true);
  });
  const resolveOwnerConfirm = (value) => {
    setOwnerConfirmOpen(false);
    ownerConfirmResolveRef.current?.(value);
    ownerConfirmResolveRef.current = null;
  };

  const handleToggleAutoStart = async (accountKey, wantOn) => {
    const result = await ownership.toggleAutoStart(accountKey, wantOn, { onNeedConfirm: askOwnerConfirm });
    if (!result.ok) {
      if (result.reason === 'firebase-unavailable') {
        toast({
          variant: 'destructive',
          title: 'Sin conexión con Firebase',
          description: 'No se pudo confirmar el estado de facturación. Por seguridad, no se activó.',
        });
      } else if (result.reason !== 'cancelled') {
        toast({ variant: 'destructive', title: 'No se pudo cambiar el estado de facturación automática' });
      }
      return;
    }
    toast({
      title: wantOn ? 'Inicio automático activado para esta PC' : 'Inicio automático desactivado para esta PC',
      className: wantOn ? 'bg-green-500 text-white' : undefined,
    });
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const f = fAPI();
    if (!f) return;

    (async () => {
      // Fijar el local activo en main ANTES de leer la config por local (evita races
      // si se entra a Configuración con la sesión ya iniciada).
      const activeLocalId = getCurrentLocalId();
      try { await window.electronAPI?.setActiveLocal?.(activeLocalId); } catch { /* no-op */ }

      let [saved, deps, mid, fbCfg] = await Promise.all([
        f.readConfig(),
        f.depsOk(),
        window.electronAPI.getMachineId(),
        fetchAfipConfigFromFirebase().catch(() => null),
      ]);

      setMachineId(mid);
      if (fbCfg) setFirebaseConfig(fbCfg);

      // ── Migración automática RESPONSABLE (Fase 1) ───────────────────────────
      // Si este local no tiene config propia, pero existe la config GLOBAL vieja y su
      // CUIT coincide con el CUIT de ESTE local en Firebase, migrar automáticamente.
      // Si no hay coincidencia clara → NO migrar (se mostrará "no configurado").
      if (!saved && activeLocalId) {
        try {
          const gsum = await f.globalConfigSummary?.();
          if (gsum?.exists) {
            const fbCuit = fbCfg?.ri?.cuit || fbCfg?.monotributo?.cuentas?.[0]?.cuit || null;
            const norm = (v) => String(v || '').replace(/\D/g, '');
            const sameCuit = gsum.cuit && fbCuit && norm(gsum.cuit) === norm(fbCuit);
            if (sameCuit) {
              const r = await f.migrateGlobalToLocal(activeLocalId, { cuit: gsum.cuit });
              console.log('[MIGRACION FACTURACION][UI] resultado =', r?.result);
              if (r?.result === 'migrated') {
                saved = await f.readConfig();
                toast({ title: 'Facturación migrada a este local', className: 'bg-green-500 text-white' });
              }
            } else {
              console.log('Migración de facturación omitida: no se pudo verificar que la configuración global pertenezca al local activo.');
            }
          }
        } catch (e) {
          console.error('[MIGRACION FACTURACION][UI] error:', e.message);
        }
      }

      // ── Auto-setup silencioso para PC nueva ─────────────────────────────────

      // 1. Preparar módulos AFIP si faltan (copia desde resources, no requiere internet)
      let depsReady = deps;
      if (!depsReady) {
        try {
          toast({ title: 'Preparando módulos AFIP…', description: 'Primera configuración en esta PC' });
          await f.installDeps();
          depsReady = true;
        } catch (e) {
          console.error('[AUTOSETUP] módulos AFIP:', e.message);
          toast({ variant: 'destructive', title: 'No se pudieron preparar módulos AFIP', description: e.message });
        }
      }
      setDepsOk(depsReady);

      // 2. Auto-reconstruir si Firebase tiene config con URLs y los archivos faltan en disco
      //    Chequeo ARCHIVOS REALES — no el flag initialized (puede ser true aunque falten archivos)
      let cfg = saved || (fbCfg ? { ...fbCfg, autoStart: false } : DEFAULT_CONFIG);
      if (fbCfg && depsReady) {
        try {
          let rebuilt = false;
          let newCfg  = { ...fbCfg, autoStart: cfg.autoStart ?? false };

          if (fbCfg.tipo === 'responsable_inscripto' && fbCfg.ri?.certDownloadUrl) {
            const riFilesOk = await f.filesOk('responsable_inscripto', null);
            if (!riFilesOk) {
              toast({ title: 'Configurando AFIP RI…', description: 'Descargando certificados desde Firebase' });
              const updatedRi = await applyAccount(f, fbCfg.ri, 'responsable_inscripto', null, mid);
              newCfg = { ...newCfg, ri: updatedRi };
              rebuilt = true;
            }
          } else if (fbCfg.tipo === 'monotributo' && fbCfg.monotributo?.cuentas) {
            const savedCuentas = saved?.monotributo?.cuentas || [];
            const cuentasProcesadas = await Promise.all(
              fbCfg.monotributo.cuentas.map(async (c) => {
                if (!c.certDownloadUrl) return savedCuentas.find(sc => sc.id === c.id) || c;
                const filesOk = await f.filesOk('monotributo', c.id);
                if (!filesOk) {
                  rebuilt = true;
                  return await applyAccount(f, c, 'monotributo', c.id, mid);
                }
                return savedCuentas.find(sc => sc.id === c.id) || c;
              })
            );
            newCfg = { ...newCfg, monotributo: { cuentas: cuentasProcesadas } };
          }

          if (rebuilt) {
            await f.writeConfig(newCfg);
            cfg = newCfg;
            setFirebaseConfig(fbCfg);
            toast({ title: '✓ AFIP configurado automáticamente', className: 'bg-green-500 text-white' });
          }
        } catch (e) {
          console.error('[AUTOSETUP] rebuild AFIP:', e.message);
          toast({ variant: 'destructive', title: 'Configuración AFIP incompleta', description: e.message });
        }
      }

      // SEGURIDAD ANTI-DOBLE-FACTURACIÓN: `activo` (Inicio automático de facturación)
      // es una decisión exclusiva de ESTA PC y NUNCA debe adoptarse desde Firebase
      // (aunque Firebase tenga config vieja con `activo:true` de antes de este fix).
      // Solo se respeta el valor que ya existía en el archivo local de esta PC;
      // si esta PC nunca lo configuró, arranca en `false`.
      cfg = enforceLocalActivo(cfg, saved);

      setConfig(cfg);

      // ── Cargar estatuses y dirs ──────────────────────────────────────────────
      const newStatuses = {};
      const newDirs = {};
      newStatuses['ri'] = await f.getStatus('ri');
      newDirs['ri'] = await f.getAccountDir('responsable_inscripto', null);
      for (const c of (cfg.monotributo?.cuentas || [])) {
        const key = `mono_${c.id}`;
        newStatuses[key] = await f.getStatus(key);
        newDirs[key] = await f.getAccountDir('monotributo', c.id);
      }
      setStatuses(newStatuses);
      setAccountDirs(newDirs);

      // ── Auto-start desde el renderer ────────────────────────────────────────
      // Se dispara UNA sola vez por montaje del componente.
      // Usa EXACTAMENTE la misma ruta que el botón "Iniciar" (f.start).
      // Controla solo con ri.activo / cuenta.activo — NO requiere config.autoStart.
      if (!autoStartFiredRef.current) {
        autoStartFiredRef.current = true;

        const tryStart = async (key, dir, initialized, activo, currentStatus) => {
          console.log(`[AFIP AUTOSTART] key=${key} initialized=${initialized} activo=${activo} status=${currentStatus}`);
          if (!initialized || !activo) return;
          if (currentStatus === 'running') {
            console.log(`[AFIP AUTOSTART] key=${key} ya está corriendo, no relanzar`);
            return;
          }
          console.log(`[AFIP AUTOSTART] calling f.start('${key}')`);
          try {
            await f.start(key, dir);
            setStatuses(prev => ({ ...prev, [key]: 'running' }));
            console.log(`[AFIP AUTOSTART] process started ok key=${key}`);
          } catch (e) {
            console.error(`[AFIP AUTOSTART] process failed key=${key}:`, e.message);
          }
        };

        if (cfg.tipo === 'responsable_inscripto') {
          const ri = cfg.ri || {};
          await tryStart('ri', newDirs['ri'], ri.initialized, ri.activo, newStatuses['ri']);
        } else if (cfg.tipo === 'monotributo') {
          for (const c of (cfg.monotributo?.cuentas || [])) {
            const key = `mono_${c.id}`;
            await tryStart(key, newDirs[key], c.initialized, c.activo, newStatuses[key]);
          }
        }
      }
    })();

    const cleanup = f.onStatus?.(({ key, status }) => {
      setStatuses(prev => ({ ...prev, [key]: status }));
    });
    return () => typeof cleanup === 'function' && cleanup();
  }, []);

  const handleStatusChange = useCallback((key, status) => {
    setStatuses(prev => ({ ...prev, [key]: status }));
  }, []);

  // ---------------------------------------------------------------------------
  // Refrescar config desde Firebase
  // ---------------------------------------------------------------------------
  const refreshFromFirebase = async () => {
    setSyncing(true);
    try {
      const fbCfg = await fetchAfipConfigFromFirebase();
      if (fbCfg) { setFirebaseConfig(fbCfg); toast({ title: 'Config Firebase actualizada' }); }
      else toast({ title: 'No hay config en Firebase aún' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Reconstruir local desde Firebase (descarga certs de Storage)
  // ---------------------------------------------------------------------------
  /**
   * El switch de facturación de ESTA PC.
   *
   * ON  → guarda el ON y arranca en el acto todos los motores válidos, sin
   *       esperar a reiniciar la aplicación.
   * OFF → guarda el OFF y detiene todos los motores de esta PC.
   *
   * Se persiste ANTES de tocar los procesos: si algo falla al arrancar, la
   * decisión igual quedó guardada y se respeta en el próximo arranque.
   */
  const cambiarSwitchFacturacion = async (encendido) => {
    setAplicandoSwitch(true);
    try {
      const f = fAPI();
      const nuevo = aplicarSwitchFacturacion(config, encendido);
      await f.writeConfig(nuevo);
      setConfig(nuevo);

      for (const key of clavesDeProceso(nuevo)) {
        try {
          if (encendido) {
            if (statuses[key] === 'running') continue;   // no se duplica
            await f.start(key, accountDirs[key]);
            setStatuses((prev) => ({ ...prev, [key]: 'running' }));
            console.log(`[Facturación] Switch ON → motor iniciado: ${key}`);
          } else {
            await f.stop(key);
            setStatuses((prev) => ({ ...prev, [key]: 'stopped' }));
            console.log(`[Facturación] Switch OFF → motor detenido: ${key}`);
          }
        } catch (e) {
          console.error(`[Facturación] switch ${encendido ? 'ON' : 'OFF'} falló para ${key}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[Facturación] no se pudo guardar el switch:', e.message);
    } finally {
      setAplicandoSwitch(false);
    }
  };

  const rebuildFromFirebase = async () => {
    if (!firebaseConfig) return;
    setSyncing(true);
    try {
      const f   = fAPI();
      const mid = machineId;

      let newConfig = { ...firebaseConfig, autoStart: config.autoStart };

      if (firebaseConfig.tipo === 'responsable_inscripto' && firebaseConfig.ri) {
        const updatedRi = await applyAccount(f, firebaseConfig.ri, 'responsable_inscripto', null, mid);
        newConfig = { ...newConfig, ri: updatedRi };
      } else if (firebaseConfig.tipo === 'monotributo' && firebaseConfig.monotributo?.cuentas) {
        const cuentas = await Promise.all(
          firebaseConfig.monotributo.cuentas.map(c => applyAccount(f, c, 'monotributo', c.id, mid))
        );
        newConfig = { ...newConfig, monotributo: { cuentas } };
      }

      await f.writeConfig(newConfig);
      setConfig(newConfig);

      // Recargar dirs
      const newDirs = {};
      newDirs['ri'] = await f.getAccountDir('responsable_inscripto', null);
      for (const c of (newConfig.monotributo?.cuentas || [])) {
        newDirs[`mono_${c.id}`] = await f.getAccountDir('monotributo', c.id);
      }
      setAccountDirs(newDirs);

      toast({ title: 'Configuración reconstruida desde Firebase', className: 'bg-green-500 text-white' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al reconstruir', description: e.message });
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Guardar config global
  // ---------------------------------------------------------------------------
  const saveGlobalConfig = async () => {
    const f = fAPI();
    if (!f) return;
    setGlobalSaving(true);
    try {
      // `activo` (Inicio automático) se administra en tiempo real por el sistema de
      // ownership (ver useFacturacionOwnership), no por este formulario. Se toma el
      // valor actual en disco para no pisarlo con el valor stale que quedó en el
      // estado de React desde que se cargó la pantalla.
      const onDisk = await f.readConfig();
      const configToSave = {
        ...config,
        ri: config.ri ? { ...config.ri, activo: onDisk?.ri?.activo ?? config.ri.activo } : config.ri,
        monotributo: config.monotributo
          ? {
              cuentas: (config.monotributo.cuentas || []).map((c) => ({
                ...c,
                activo: onDisk?.monotributo?.cuentas?.find((oc) => oc.id === c.id)?.activo ?? c.activo,
              })),
            }
          : config.monotributo,
      };
      await f.writeConfig(configToSave);
      await saveAfipConfigToFirebase(configToSave);
      toast({ title: 'Configuración guardada', className: 'bg-green-500 text-white' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setGlobalSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Guardar una cuenta (local + Storage + Firebase)
  // ---------------------------------------------------------------------------
  const saveAccount = async (tipo, cuentaId, rawFields) => {
    const f = fAPI();
    if (!f) return;
    const saveKey = cuentaId || 'ri';

    // Normalizar firebaseDb ANTES de escribir nada (disco local + Firebase):
    // recorta espacios y corrige el esquema (ej. "HTTPS://..." -> "https://...")
    // para que .env, el chequeo de ownership del proceso principal y el motor
    // reciban siempre una URL bien formada. Si el campo viene con datos pero
    // no es una URL http/https válida, se corta el guardado con un error
    // claro en vez de persistir un valor que rompería el arranque automático
    // (causa raíz del bug de facturación de Canadá — ver electron/main.js,
    // fetchFacturacionOwnerRemote).
    let fields = rawFields;
    if (rawFields.firebaseDb) {
      try {
        const normalized = normalizeFirebaseDatabaseURL(rawFields.firebaseDb);
        fields = { ...rawFields, firebaseDb: normalized };
      } catch (e) {
        toast({
          variant: 'destructive',
          title: 'URL de Firebase inválida',
          description: `"${rawFields.firebaseDb}" no es una URL http/https válida: ${e.message}`,
        });
        return;
      }
    }

    setSavingKey(saveKey);
    try {
      const localId = getCurrentLocalId();
      const mid = machineId;

      // 1. Init dir + index.mjs
      const { ok, accountDir, error } = await f.initAccount(tipo, cuentaId);
      if (!ok) throw new Error(error || 'No se pudo crear el directorio');

      // 2. Subir certs a Firebase Storage y copiar local
      let certStoragePath = fields.certStoragePath;
      let keyStoragePath  = fields.keyStoragePath;
      let saStoragePath   = fields.serviceAccountStoragePath;
      let certDLUrl = fields.certDownloadUrl;
      let keyDLUrl  = fields.keyDownloadUrl;
      let saDLUrl   = fields.serviceAccountDownloadUrl;

      const accountSegment = cuentaId ? `mono/${cuentaId}` : 'ri';

      const uploadErrors = [];

      const uploadFile = async (filePath, destRelative, storageName, onSuccess) => {
        const b64 = await f.readFileBase64(filePath);
        if (!b64.ok) { uploadErrors.push(`Lectura fallida: ${storageName}`); return; }
        await f.copyFile(filePath, accountDir, destRelative);
        try {
          const r = await uploadAfipFile(localId, tipo, cuentaId, storageName, b64.data);
          onSuccess(r);
        } catch (e) {
          uploadErrors.push(`${storageName}: ${e.message}`);
        }
      };

      if (fields.certFile) {
        await uploadFile(fields.certFile, 'cert/certificado.crt', 'certificado.crt', (r) => {
          certStoragePath = r.storagePath; certDLUrl = r.downloadUrl;
        });
      }
      if (fields.keyFile) {
        await uploadFile(fields.keyFile, 'cert/clave.key', 'clave.key', (r) => {
          keyStoragePath = r.storagePath; keyDLUrl = r.downloadUrl;
        });
      }
      if (fields.serviceAccountFile) {
        await uploadFile(fields.serviceAccountFile, 'serviceAccount.json', 'serviceAccount.json', (r) => {
          saStoragePath = r.storagePath; saDLUrl = r.downloadUrl;
        });
      }

      if (uploadErrors.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Archivos NO subidos a Firebase Storage',
          description: `Los archivos se copiaron localmente pero no se pudieron subir. Sincronización entre PCs NO disponible.\n\n${uploadErrors.join('\n')}`,
          duration: 12000,
        });
      }

      // 3. Escribir .env
      await f.writeEnv(accountDir, buildEnvData(fields, tipo, mid));

      // 4. Actualizar estado local
      const updatedFields = {
        ...fields,
        initialized:               true,
        certStoragePath,   certDownloadUrl:           certDLUrl,
        keyStoragePath,    keyDownloadUrl:             keyDLUrl,
        serviceAccountStoragePath: saStoragePath, serviceAccountDownloadUrl: saDLUrl,
        certFile: null, keyFile: null, serviceAccountFile: null,
      };

      // `activo` (Inicio automático) lo administra el sistema de ownership en tiempo
      // real — se preserva el valor actual en disco para no pisarlo con el stale de
      // React al guardar campos de esta cuenta (CUIT, certs, etc.).
      const onDisk = await f.readConfig();
      const onDiskActivo = tipo === 'responsable_inscripto'
        ? onDisk?.ri?.activo
        : onDisk?.monotributo?.cuentas?.find(c => c.id === cuentaId)?.activo;
      updatedFields.activo = onDiskActivo ?? updatedFields.activo;

      let newConfig;
      if (tipo === 'responsable_inscripto') {
        newConfig = { ...config, ri: updatedFields };
      } else {
        const cuentas = (config.monotributo?.cuentas || []).map(c => c.id === cuentaId ? updatedFields : c);
        newConfig = { ...config, monotributo: { ...config.monotributo, cuentas } };
      }

      await f.writeConfig(newConfig);
      setConfig(newConfig);

      setAccountDirs(prev => ({
        ...prev,
        [tipo === 'responsable_inscripto' ? 'ri' : `mono_${cuentaId}`]: accountDir,
      }));

      // 5. Guardar en Firebase
      try {
        await saveAfipConfigToFirebase(newConfig);
        setFirebaseConfig({ ...newConfig, updatedAt: new Date().toISOString() });
      } catch (e) {
        console.warn('[firebase] Error al guardar config AFIP:', e.message);
      }

      toast({ title: 'Cuenta configurada y guardada en Firebase', className: 'bg-green-500 text-white' });

    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setSavingKey(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers de update de estado local
  // ---------------------------------------------------------------------------
  const updateRi = (key, val) => setConfig(c => ({ ...c, ri: { ...c.ri, [key]: val } }));
  const updateCuenta = (id, key, val) => setConfig(c => ({
    ...c,
    monotributo: {
      ...c.monotributo,
      cuentas: (c.monotributo?.cuentas || []).map(cu => cu.id === id ? { ...cu, [key]: val } : cu),
    },
  }));
  const addCuenta = () => {
    if ((config.monotributo?.cuentas || []).length >= 5) return;
    const id = `c${Date.now()}`;
    setConfig(c => ({
      ...c,
      monotributo: { ...c.monotributo, cuentas: [...(c.monotributo?.cuentas || []), DEFAULT_CUENTA(id)] },
    }));
  };
  const removeCuenta = async (id) => {
    await fAPI()?.stop(`mono_${id}`);
    setConfig(c => ({
      ...c,
      monotributo: { ...c.monotributo, cuentas: (c.monotributo?.cuentas || []).filter(cu => cu.id !== id) },
    }));
    setStatuses(prev => { const n = { ...prev }; delete n[`mono_${id}`]; return n; });
    setAccountDirs(prev => { const n = { ...prev }; delete n[`mono_${id}`]; return n; });
  };

  if (!isElectron) {
    return (
      <div className="pt-4 border-t border-primary/20">
        <p className="text-sm text-gray-400">Requiere entorno Electron.</p>
      </div>
    );
  }

  const cuentas = config.monotributo?.cuentas || [];

  return (
    <div className="pt-4 border-t border-primary/20 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Receipt className="h-4 w-4" /> Facturación AFIP
        </h3>
        <Button size="sm" onClick={saveGlobalConfig} disabled={globalSaving} variant="outline">
          <Save className="h-3 w-3 mr-1" />
          {globalSaving ? 'Guardando...' : 'Guardar tipo/auto-start'}
        </Button>
      </div>

      {/* Tipo + Auto-start */}
      <div className="flex flex-wrap items-center gap-6 p-3 rounded-lg bg-gray-50 border">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Tipo de facturación</Label>
          <div className="flex gap-4">
            {[
              { val: 'responsable_inscripto', label: 'Responsable Inscripto (Factura B)' },
              { val: 'monotributo',           label: 'Monotributo (Factura C)' },
            ].map(({ val, label }) => (
              <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="tipoFacturacion" value={val}
                  checked={config.tipo === val}
                  onChange={() => setConfig(c => ({ ...c, tipo: val }))}
                  className="accent-primary"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </div>
        {/* EL switch de facturación de ESTA PC.
            Por defecto está en ON: toda computadora factura sin que nadie entre
            acá. Apagarlo es la única forma de que esta PC deje de facturar, y esa
            decisión queda guardada SOLO en este equipo (facturacionAutomatica
            está en LOCAL_ONLY_FIELDS). No afecta el arranque con Windows: la app
            sigue abriéndose para vender. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Switch
              id="facturacion-autostart"
              checked={facturacionActivaEnEstaPC(config)}
              disabled={aplicandoSwitch}
              onCheckedChange={cambiarSwitchFacturacion}
            />
            <Label htmlFor="facturacion-autostart" className="text-sm cursor-pointer">
              Facturación automática en esta PC
            </Label>
          </div>
          <span className="text-xs text-muted-foreground">
            {facturacionActivaEnEstaPC(config)
              ? 'ACTIVA — esta PC factura sola al abrir la aplicación.'
              : 'DETENIDA MANUALMENTE — esta PC no factura. La app sigue funcionando para vender.'}
          </span>
        </div>
      </div>

      {/* Estado real de las nueve colas: cada una es una cuenta fiscal distinta */}
      <ColasFiscalesPanel />

      {/* Banner de sincronización Firebase */}
      <FirebaseSyncBanner
        firebaseConfig={firebaseConfig}
        onApply={rebuildFromFirebase}
        onRefresh={refreshFromFirebase}
        syncing={syncing}
      />

      {/* Dependencias */}
      <DepsPanel depsOk={depsOk} onInstalled={() => setDepsOk(true)} />

      <Separator />

      {/* ── Responsable Inscripto ── */}
      {config.tipo === 'responsable_inscripto' && (
        <AccountCard
          tipo="responsable_inscripto"
          cuentaId={null}
          fields={config.ri}
          onChange={updateRi}
          onSave={() => saveAccount('responsable_inscripto', null, config.ri)}
          saving={savingKey === 'ri'}
          processKey="ri"
          accountDir={accountDirs['ri']}
          status={statuses['ri']}
          onStatusChange={handleStatusChange}
          machineId={machineId}
          ownershipAccount={ownership.accounts.find(a => a.key === 'ri')}
          onToggleAutoStart={(v) => handleToggleAutoStart('ri', v)}
          ownershipBusy={ownership.busyKey === 'ri'}
        />
      )}

      {/* ── Monotributo ── */}
      {config.tipo === 'monotributo' && (
        <div className="space-y-3">
          {cuentas.map((cuenta) => {
            const key = `mono_${cuenta.id}`;
            return (
              <AccountCard
                key={cuenta.id}
                tipo="monotributo"
                cuentaId={cuenta.id}
                fields={cuenta}
                onChange={(k, v) => updateCuenta(cuenta.id, k, v)}
                onSave={() => saveAccount('monotributo', cuenta.id, cuenta)}
                onRemove={() => removeCuenta(cuenta.id)}
                saving={savingKey === cuenta.id}
                processKey={key}
                accountDir={accountDirs[key]}
                status={statuses[key]}
                onStatusChange={handleStatusChange}
                machineId={machineId}
                ownershipAccount={ownership.accounts.find(a => a.key === key)}
                onToggleAutoStart={(v) => handleToggleAutoStart(key, v)}
                ownershipBusy={ownership.busyKey === key}
              />
            );
          })}
          {cuentas.length < 5 && (
            <Button size="sm" variant="outline" onClick={addCuenta} className="w-full">
              <Plus className="h-3 w-3 mr-1" /> Agregar cuenta ({cuentas.length}/5)
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={ownerConfirmOpen} onOpenChange={(v) => !v && resolveOwnerConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Tomar el control de la facturación automática?</AlertDialogTitle>
            <AlertDialogDescription>
              La PC <strong>{ownerConfirmData?.nombrePc || 'otra PC'}</strong> ya está autorizada para
              facturar esta cuenta{ownerConfirmData?.cuentaNombre ? ` (${ownerConfirmData.cuentaNombre})` : ''}.
              Si continuás, esa PC se desactivará automáticamente y esta PC pasará a ser la única que
              emite comprobantes para esta cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveOwnerConfirm(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveOwnerConfirm(true)} className="bg-cyan-600 hover:bg-cyan-700">
              Tomar el control
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FacturacionManager;
