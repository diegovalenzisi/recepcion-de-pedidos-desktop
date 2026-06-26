import React, { useState, useRef, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import {
  Upload, FileCheck, Loader2, FolderOpen,
  AlertTriangle, RotateCcw, Link, CheckCircle2,
} from 'lucide-react';
import { uploadUpdateInstaller } from '@/lib/firebase/storage';
import { saveUpdateMetadata } from '@/lib/api/settingsApi';

// ─── helpers ────────────────────────────────────────────────────────────────

const extractVersion = (filename) => {
  const m = filename.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : '';
};

const fmtMB   = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const fmtSpeed = (bps)  => {
  if (bps <= 0) return '';
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bps / 1024).toFixed(0)} KB/s`;
};

// ─── fases del upload ────────────────────────────────────────────────────────
// idle → uploading → processing → saving → done  (o error en cualquier punto)

const PHASE_LABEL = {
  idle:       '',
  uploading:  'Subiendo archivo...',
  processing: 'Procesando...',
  saving:     'Guardando en Firebase...',
  done:       'Actualización lista',
  error:      'Error al subir',
};

// ─── componente ─────────────────────────────────────────────────────────────

const UpdateUploader = () => {
  const [file, setFile]           = useState(null);
  const [version, setVersion]     = useState('');
  const [obligatoria, setObligatoria] = useState(true);

  // progreso
  const [phase, setPhase]         = useState('idle');
  const [pct, setPct]             = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal]         = useState(0);
  const [speed, setSpeed]         = useState(0);

  // resultado
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [errorMsg, setErrorMsg]   = useState(null);

  const fileInputRef = useRef(null);
  const { toast } = useToast();

  const isActive = phase === 'uploading' || phase === 'processing' || phase === 'saving';

  // ── selección de archivo ──────────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.exe')) {
      toast({ variant: 'destructive', title: 'Archivo inválido', description: 'Solo se aceptan archivos .exe' });
      e.target.value = '';
      return;
    }
    setFile(f);
    setPhase('idle');
    setDownloadUrl(null);
    setErrorMsg(null);
    setPct(0);
    setTransferred(0);
    setTotal(f.size);
    setSpeed(0);
    setVersion(extractVersion(f.name));
  };

  // ── upload ───────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!file) {
      toast({ variant: 'destructive', title: 'Sin archivo', description: 'Seleccioná un instalador .exe primero.' });
      return;
    }
    if (!version.trim()) {
      toast({ variant: 'destructive', title: 'Sin versión', description: 'Ingresá el número de versión (ej: 1.2.0).' });
      return;
    }

    setPhase('uploading');
    setDownloadUrl(null);
    setErrorMsg(null);
    setPct(0);
    setTransferred(0);
    setTotal(file.size);
    setSpeed(0);

    try {
      const url = await uploadUpdateInstaller(file, (info) => {
        setPct(info.pct);
        setTransferred(info.bytesTransferred);
        setTotal(info.totalBytes);
        setSpeed(info.speedBps);
        // Al llegar a 100% el storage pasa a "procesar" internamente
        if (info.pct >= 100) setPhase('processing');
      });

      setPhase('saving');
      await saveUpdateMetadata({
        version:       version.trim(),
        url,
        nombreArchivo: file.name,
        fecha:         new Date().toISOString().split('T')[0],
        obligatoria,
      });

      setDownloadUrl(url);
      setPhase('done');
    } catch (err) {
      console.error('[update-uploader]', err);
      setErrorMsg(err.message || 'No se pudo subir el instalador.');
      setPhase('error');
    }
  }, [file, version, obligatoria, toast]);

  // ── copiar URL ────────────────────────────────────────────────────────────
  const copyUrl = () => {
    if (!downloadUrl) return;
    navigator.clipboard.writeText(downloadUrl).then(() =>
      toast({ title: 'URL copiada' })
    );
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="pt-4 border-t border-primary/20 space-y-4">
      <Label className="font-semibold flex items-center gap-2">
        <Upload className="h-4 w-4" /> Cargar Actualización
      </Label>

      <div className="space-y-3">
        {/* Selector de archivo */}
        <input ref={fileInputRef} type="file" accept=".exe" onChange={handleFileSelect} className="hidden" />
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isActive}
            className="shrink-0"
          >
            <FolderOpen className="h-4 w-4 mr-1.5" /> Examinar...
          </Button>
          <span className="text-sm truncate max-w-[260px] text-gray-700" title={file?.name}>
            {file
              ? <>{file.name} <span className="text-gray-400">({fmtMB(file.size)} MB)</span></>
              : <span className="text-muted-foreground">Sin archivo seleccionado</span>}
          </span>
        </div>

        {/* Versión + obligatoria */}
        <div className="flex items-center gap-3 flex-wrap">
          <Label className="shrink-0 text-sm font-medium">Versión:</Label>
          <Input
            type="text" value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Ej: 1.2.0"
            className="bg-white text-gray-800 w-28"
            disabled={isActive}
          />
          <div className="flex items-center gap-1.5 ml-2">
            <Switch
              id="obligatoria"
              checked={obligatoria}
              onCheckedChange={setObligatoria}
              disabled={isActive}
            />
            <Label htmlFor="obligatoria" className="text-sm cursor-pointer">Obligatoria</Label>
          </div>
        </div>

        {/* Aviso activo */}
        {isActive && (
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Subiendo actualización — no cierre la app hasta que termine
          </div>
        )}

        {/* Barra de progreso */}
        {(isActive || phase === 'done' || phase === 'error') && phase !== 'idle' && (
          <div className="space-y-1.5">
            <Progress value={pct} className="h-3" />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium text-gray-700">{PHASE_LABEL[phase]}</span>

              {phase === 'uploading' && total > 0 && (
                <span>
                  {fmtMB(transferred)} / {fmtMB(total)} MB
                  {speed > 0 && <> · <span className="text-blue-600">{fmtSpeed(speed)}</span></>}
                </span>
              )}
              {phase !== 'uploading' && (
                <span>{pct}%</span>
              )}
            </div>
          </div>
        )}

        {/* Éxito */}
        {phase === 'done' && downloadUrl && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 space-y-2">
            <div className="flex items-center gap-2 text-green-800 font-medium text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Versión <strong>{version}</strong> publicada — los equipos la recibirán al iniciar
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-mono truncate flex-1" title={downloadUrl}>
                {downloadUrl}
              </span>
              <Button size="sm" variant="outline" className="shrink-0 h-6 text-xs" onClick={copyUrl}>
                <Link className="h-3 w-3 mr-1" /> Copiar URL
              </Button>
            </div>
            {obligatoria && (
              <p className="text-xs text-amber-700">Marcada como obligatoria — los clientes no podrán saltarla</p>
            )}
          </div>
        )}

        {/* Error */}
        {phase === 'error' && errorMsg && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 space-y-2">
            <p className="text-sm text-red-700 font-medium">Error al subir</p>
            <p className="text-xs text-red-600">{errorMsg}</p>
          </div>
        )}

        {/* Botones */}
        <div className="flex gap-2">
          {/* Reintentar (visible solo en error, sin re-seleccionar archivo) */}
          {phase === 'error' && file && (
            <Button variant="outline" onClick={handleUpload} className="flex-1">
              <RotateCcw className="h-4 w-4 mr-2" /> Reintentar
            </Button>
          )}

          {/* Subir / Subiendo */}
          {phase !== 'error' && (
            <Button
              onClick={handleUpload}
              disabled={isActive || !file}
              className="flex-1"
            >
              {isActive ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {PHASE_LABEL[phase]} {phase === 'uploading' && pct > 0 ? `${pct}%` : ''}
                </>
              ) : phase === 'done' ? (
                <>
                  <FileCheck className="h-4 w-4 mr-2" /> Subir nueva versión
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" /> Subir actualización
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateUploader;
