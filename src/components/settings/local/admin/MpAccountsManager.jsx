import React, { useState, useEffect, useCallback } from 'react';
import { useMpAccounts, maskToken } from '@/hooks/useMpAccounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  CreditCard, Plus, Pencil, Trash2, Check, RefreshCw, FlaskConical, Loader2,
  ChevronDown, ChevronUp, Search, AlertTriangle, CheckCircle2, XCircle, Wrench,
} from 'lucide-react';
import { createTestMercadoPagoPayment } from '@/lib/api/paymentAlertsApi';
import { useToast } from '@/components/ui/use-toast';
import { getLocalId, getLocationSpecificDatabaseURL, getLocationSpecificProjectId } from '@/lib/firebase/core.js';

// Completa el backend.env del local activo con las variables base (URL Firebase del local,
// LOCAL_ID, ruta pagos y opcionalmente el token). Evita el crash "Can't determine Firebase Database URL".
async function ensureBackendEnvForLocal(extra = {}) {
  const id = getLocalId();
  if (!id || !window.electronAPI?.backend?.ensureEnv) return null;
  try {
    return await window.electronAPI.backend.ensureEnv({
      databaseURL:  getLocationSpecificDatabaseURL(id),
      projectId:    getLocationSpecificProjectId(id),
      paymentsPath: `${id}/PAGOS_CONFIRMADOS`,
      ...extra,
    });
  } catch { return null; }
}

const EMPTY_FORM = {
  nombreCuenta: '',
  accessTokenMercadoPago: '',
  firebasePathPagos: '',
  localId: '',
};

const AccountForm = ({ initial = EMPTY_FORM, onSave, onCancel, existingNames = [] }) => {
  const [form, setForm] = useState(initial);
  const [showToken, setShowToken] = useState(false);

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  // Autocompletar firebasePathPagos cuando cambia localId
  const handleLocalIdChange = (v) => {
    set('localId', v);
    if (!form.firebasePathPagos || form.firebasePathPagos === `${form.localId}/PAGOS_CONFIRMADOS`) {
      set('firebasePathPagos', v ? `${v}/PAGOS_CONFIRMADOS` : '');
    }
  };

  const isNew = !initial.nombreCuenta;
  const isDuplicateName = isNew && existingNames.includes(form.nombreCuenta.trim());

  const canSave =
    form.nombreCuenta.trim() &&
    form.accessTokenMercadoPago.trim() &&
    form.localId.trim() &&
    form.firebasePathPagos.trim() &&
    !isDuplicateName;

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre de la cuenta *</label>
          <Input
            value={form.nombreCuenta}
            onChange={(e) => set('nombreCuenta', e.target.value)}
            placeholder="Ej: Achaval"
            disabled={!isNew}
          />
          {isDuplicateName && (
            <p className="text-xs text-red-500 mt-1">Ya existe una cuenta con ese nombre</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Local ID *</label>
          <Input
            value={form.localId}
            onChange={(e) => handleLocalIdChange(e.target.value)}
            placeholder="Ej: 40508022"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Access Token Mercado Pago *
        </label>
        <div className="flex gap-2">
          <Input
            type={showToken ? 'text' : 'password'}
            value={form.accessTokenMercadoPago}
            onChange={(e) => set('accessTokenMercadoPago', e.target.value)}
            placeholder="APP_USR-..."
            className="font-mono text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowToken((s) => !s)}
            className="shrink-0"
          >
            {showToken ? 'Ocultar' : 'Ver'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">No se muestra en pantalla. Solo se guarda en AppData.</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Ruta de pagos Firebase *</label>
        <Input
          value={form.firebasePathPagos}
          onChange={(e) => set('firebasePathPagos', e.target.value)}
          placeholder="Ej: 40508022/PAGOS_CONFIRMADOS"
          className="font-mono text-sm"
        />
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={!canSave} onClick={() => onSave(form)}>
          <Check className="h-4 w-4 mr-1" />
          {isNew ? 'Agregar cuenta' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  );
};

// Panel de diagnóstico del backend (inline, sin depender del hook global)
function BackendDiagPanel({ diag, onRefresh }) {
  if (!diag) return null;
  const Item = ({ label, ok, detail }) => (
    <div className="flex items-start gap-1.5 text-xs">
      {ok === true  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-px flex-shrink-0" />
       : ok === false ? <XCircle      className="h-3.5 w-3.5 text-red-500   mt-px flex-shrink-0" />
       : <span className="h-3.5 w-3.5 mt-px flex-shrink-0 text-gray-400">·</span>}
      <span className={`font-medium ${ok === false ? 'text-red-700' : 'text-gray-700'}`}>{label}</span>
      {detail && <span className="text-gray-400 font-mono truncate ml-1" title={detail}>{detail}</span>}
    </div>
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-700 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          Diagnóstico del backend
        </p>
        <Button variant="ghost" size="sm" className="h-5 text-xs px-2" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" /> Actualizar
        </Button>
      </div>
      <div className="space-y-0.5 bg-white rounded p-2 border border-slate-100">
        <Item label="backend.env" ok={diag.backendEnvExists} detail={diag.backendEnvPath?.replace(/.*[/\\]/, '…/')} />
        <Item label="Credenciales Firebase (env vars)" ok={diag.hasEnvVarCreds} />
        <Item label="URL Firebase (DB)" ok={diag.firebaseDbUrlPresente} detail={diag.firebaseDbUrl?.replace(/^https?:\/\//, '') || undefined} />
        <Item label="serviceAccountKey.json" ok={diag.serviceAccountExists} detail={diag.serviceAccountKeyOk === false ? '⚠ private_key inválida' : undefined} />
        <Item label="Token Mercado Pago" ok={diag.tokenPresente} />
        <Item label="Local ID" ok={diag.localIdPresente} detail={diag.localId || undefined} />
        <Item label="Ruta de pagos" ok={diag.rutaPagosPresente} />
        <Item label="mp-accounts.json" ok={diag.mpAccountsExists} detail={diag.activeAccountName || undefined} />
        <Item label="Archivo backend (server.js)" ok={diag.backendEntryExists} />
        {diag.googleAppCredentials && (
          <Item
            label="GOOGLE_APPLICATION_CREDENTIALS"
            ok={!!diag.googleAppCredentialsResolved}
            detail={diag.googleAppCredentials}
          />
        )}
      </div>
      {diag.crashFast && (
        <div className="bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-0.5">
          <p className="font-semibold text-red-700">Backend crasheó al iniciar</p>
          {diag.lastError && (
            <p className="font-mono text-red-600 break-all">{diag.lastError}</p>
          )}
          {!diag.firebaseCredsPresente && (
            <p className="text-red-700 mt-1">
              <strong>Solución:</strong> Faltan credenciales Firebase en <code>backend.env</code>.
              Si tenés AFIP configurado, usá <em>Generar backend.env desde AFIP</em> en el panel de salud.
              Si no, pedile a Diego el archivo.
            </p>
          )}
          {diag.firebaseCredsPresente && !diag.tokenPresente && (
            <p className="text-red-700 mt-1">
              <strong>Solución:</strong> Falta el token de Mercado Pago. Ingresalo arriba o en el panel de salud.
            </p>
          )}
        </div>
      )}
      {!diag.crashFast && diag.lastError && (
        <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1 font-mono text-amber-800 break-all">
          Último error: {diag.lastError}
        </div>
      )}
    </div>
  );
}

const MpAccountsManager = () => {
  const { accounts, activeAccount, loading, addAccount, updateAccount, deleteAccount, setActiveAccount, restartBackend } = useMpAccounts();
  const activePaymentPath = activeAccount?.firebasePathPagos ?? null;
  const { toast } = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState(null);
  const [testing, setTesting] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [mpQuery, setMpQuery] = useState(null);
  const [querying, setQuerying] = useState(false);
  const [diag, setDiag] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState(null);

  const loadDiag = useCallback(async () => {
    if (!window.electronAPI?.mpBackendDiag) return;
    try { setDiag(await window.electronAPI.mpBackendDiag()); } catch {}
  }, []);

  // Al entrar a la pantalla: crear/reparar backend.env del local con su URL de Firebase,
  // luego mostrar el diagnóstico ya actualizado.
  useEffect(() => {
    (async () => { await ensureBackendEnvForLocal(); await loadDiag(); })();
  }, [loadDiag]);

  const handleAdd = async (form) => {
    await addAccount(form);
    // Completar backend.env con la ruta de pagos + token de la cuenta recién creada
    await ensureBackendEnvForLocal({ paymentsPath: form.firebasePathPagos, token: form.accessTokenMercadoPago });
    setShowAddForm(false);
    toast({ title: `Cuenta "${form.nombreCuenta}" agregada` });
    await loadDiag();
  };

  const handleEdit = async (form) => {
    await updateAccount(editingName, form);
    await ensureBackendEnvForLocal({ paymentsPath: form.firebasePathPagos, token: form.accessTokenMercadoPago });
    setEditingName(null);
    toast({ title: `Cuenta "${editingName}" actualizada` });
    await loadDiag();
  };

  const handleDelete = async (nombre) => {
    if (!window.confirm(`¿Eliminar la cuenta "${nombre}"?`)) return;
    await deleteAccount(nombre);
    toast({ title: `Cuenta "${nombre}" eliminada`, variant: 'destructive' });
  };

  const handleSelect = async (nombre) => {
    await setActiveAccount(nombre);
    toast({ title: `Cuenta activa cambiada a "${nombre}"`, description: 'Reiniciá el backend para aplicar el cambio.' });
  };

  const handleRestart = async () => {
    setRestarting(true);
    setRestartError(null);
    try {
      const result = await restartBackend();
      if (result && !result.ok) {
        const errMsg = result.error || 'El backend se cerró inmediatamente al iniciar.';
        setRestartError(errMsg);
        toast({ title: 'Backend no inició', description: errMsg, variant: 'destructive' });
        await loadDiag();
      } else {
        toast({ title: 'Backend reiniciado', description: activeAccount ? `Usando cuenta: ${activeAccount.nombreCuenta}` : '' });
        setRestartError(null);
      }
    } catch (e) {
      const errMsg = e.message || 'Error desconocido al reiniciar backend.';
      setRestartError(errMsg);
      toast({ title: 'Error al reiniciar backend', description: errMsg, variant: 'destructive' });
    } finally {
      setTimeout(() => setRestarting(false), 500);
    }
  };

  const handleTestPayment = async () => {
    if (!activePaymentPath && !activeAccount?.firebasePathPagos) {
      toast({ title: 'No hay cuenta activa', description: 'Configurá una cuenta primero.', variant: 'destructive' });
      return;
    }
    setTesting(true);
    try {
      const path = activePaymentPath || activeAccount?.firebasePathPagos;
      await createTestMercadoPagoPayment(path);
      toast({ title: 'Pago de prueba creado', description: `La app debería anunciar el pago por voz. Ruta: ${path}` });
    } catch (e) {
      toast({ title: 'Error al crear pago de prueba', description: e.message, variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleRepair = async () => {
    if (!window.electronAPI?.mpRepair) {
      toast({ title: 'Solo disponible en la app de escritorio', variant: 'destructive' });
      return;
    }
    setRepairing(true);
    setRepairResult(null);
    setRestartError(null);
    try {
      const result = await window.electronAPI.mpRepair();
      setRepairResult(result);
      if (result.ok) {
        toast({ title: '✓ Backend Mercado Pago activo', description: 'Backend reiniciado correctamente.' });
        await loadDiag();
      } else {
        const errMsg = result.error || 'Error desconocido durante la reparación.';
        toast({ title: 'Reparación fallida', description: errMsg, variant: 'destructive' });
      }
    } catch (e) {
      const errMsg = e.message || 'Error al ejecutar reparación.';
      setRepairResult({ ok: false, error: errMsg });
      toast({ title: 'Error en reparación', description: errMsg, variant: 'destructive' });
    } finally {
      setRepairing(false);
    }
  };

  const handleQueryRealMp = async () => {
    if (!window.electronAPI?.mpRecentPayments) {
      toast({ title: 'Solo disponible en la app de escritorio', variant: 'destructive' });
      return;
    }
    setQuerying(true);
    setMpQuery(null);
    try {
      const result = await window.electronAPI.mpRecentPayments(6);
      setMpQuery(result);
      if (!result.ok) {
        toast({ title: 'Error consultando MP', description: result.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setQuerying(false);
    }
  };

  const existingNames = accounts.map((a) => a.nombreCuenta);

  return (
    <Card className="border-pink-200">
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-pink-600" />
            <CardTitle className="text-base">Cuenta Mercado Pago</CardTitle>
            {activeAccount && (
              <Badge variant="outline" className="border-pink-400 text-pink-700 text-xs">
                {activeAccount.nombreCuenta}
              </Badge>
            )}
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {/* Estado actual */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm font-mono">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${activeAccount ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-muted-foreground">Backend Mercado Pago:</span>
              <span className={activeAccount ? 'text-green-600 font-semibold' : 'text-gray-500'}>
                {activeAccount ? 'configurado' : 'sin cuenta activa'}
              </span>
            </div>
            {activeAccount && (
              <>
                <div><span className="text-muted-foreground">Cuenta activa: </span><span className="font-semibold">{activeAccount.nombreCuenta}</span></div>
                <div><span className="text-muted-foreground">Ruta pagos: </span><span>{activeAccount.firebasePathPagos}</span></div>
                <div><span className="text-muted-foreground">Token: </span><span>{maskToken(activeAccount.accessTokenMercadoPago)}</span></div>
                <div><span className="text-muted-foreground">Escuchando: </span><span>{activePaymentPath || activeAccount.firebasePathPagos}</span></div>
              </>
            )}
          </div>

          {/* Acciones globales */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestart}
              disabled={restarting || !activeAccount}
              title="Reinicia el backend para que use la cuenta activa"
            >
              {restarting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Reiniciar backend
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestPayment}
              disabled={testing || !activeAccount}
              className="border-orange-300 text-orange-700 hover:bg-orange-50"
              title="Crea un pago de prueba en la ruta activa y la app lo anuncia por voz"
            >
              {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-1" />}
              Probar cuenta activa
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleQueryRealMp}
              disabled={querying}
              className="border-blue-300 text-blue-700 hover:bg-blue-50"
              title="Consulta la API real de Mercado Pago (últimas 6 horas). No crea pagos de prueba."
            >
              {querying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Consultar MP real
            </Button>
          </div>

          {/* Error de último restart */}
          {restartError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs space-y-1">
              <p className="font-semibold text-red-700 flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> El backend no pudo iniciar
              </p>
              <p className="font-mono text-red-600 break-all">{restartError}</p>
            </div>
          )}

          {/* Panel de diagnóstico (se muestra solo cuando hay problema) */}
          {diag && (diag.crashFast || !diag.tokenPresente || !diag.firebaseCredsPresente || !diag.backendEnvExists) && (
            <BackendDiagPanel diag={diag} onRefresh={loadDiag} />
          )}

          {/* Botón Reiniciar backend MP — siempre visible en Electron */}
          {window.electronAPI?.mpRepair && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-violet-800 flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5" />
                Reiniciar backend Mercado Pago
              </p>
              <p className="text-xs text-violet-700">
                Repara <code>private_key</code> si está malformada, crea <code>mp-accounts.json</code> si falta, y reinicia el backend.
              </p>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-white h-7 text-xs"
                onClick={handleRepair}
                disabled={repairing}
              >
                {repairing
                  ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Reiniciando…</>
                  : <><RefreshCw className="h-3 w-3 mr-1.5" />Reiniciar backend MP</>}
              </Button>
              {repairResult && (
                <div className={`text-xs rounded px-2 py-1.5 space-y-0.5 ${repairResult.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                  {repairResult.ok
                    ? <p>✓ Backend activo</p>
                    : <p className="font-mono break-all">✗ {repairResult.error}</p>}
                  {repairResult.diagnostics?.saKeyRepaired && <p>· private_key del serviceAccountKey reparada</p>}
                  {repairResult.diagnostics?.backendEnvRepaired && <p>· backend.env reparado (private_key truncada)</p>}
                  {repairResult.diagnostics?.mpAccountsCreated && <p>· mp-accounts.json creado automáticamente</p>}
                  {repairResult.diagnostics?.saKeyError && <p className="font-mono">! serviceAccount: {repairResult.diagnostics.saKeyError}</p>}
                </div>
              )}
            </div>
          )}

          {/* Resultado de "Consultar MP real" */}
          {mpQuery && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs space-y-2">
              {!mpQuery.ok ? (
                <p className="text-red-700 font-medium">Error: {mpQuery.error}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-blue-900">
                      Últimas 6h en MP real — {mpQuery.total_mp ?? 0} pago{mpQuery.total_mp !== 1 ? 's' : ''} en ventana
                    </p>
                    <span className="text-muted-foreground font-mono">{mpQuery.consultado_en ? new Date(mpQuery.consultado_en).toLocaleTimeString('es-AR') : ''}</span>
                  </div>
                  {mpQuery.sync_state && (
                    <div className="font-mono text-blue-800 bg-blue-100 rounded px-2 py-1">
                      <span className="font-sans font-medium">Último sync: </span>
                      {mpQuery.sync_state.lastDateCreated ? new Date(mpQuery.sync_state.lastDateCreated).toLocaleString('es-AR') : '—'}
                      {mpQuery.sync_state.lastPaymentId && <span className="ml-2">id={mpQuery.sync_state.lastPaymentId}</span>}
                    </div>
                  )}
                  {(!mpQuery.pagos || mpQuery.pagos.length === 0) ? (
                    <p className="text-muted-foreground">Sin pagos en las últimas 6 horas.</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {mpQuery.pagos.map((p) => (
                        <div
                          key={p.id}
                          className={`rounded px-2 py-1 font-mono ${p.status === 'approved' ? 'bg-green-100 text-green-900' : 'bg-gray-100 text-gray-600'}`}
                        >
                          <span className="font-sans font-semibold">${p.transaction_amount}</span>
                          {' · '}
                          <span className={p.status === 'approved' ? 'text-green-700 font-bold' : 'text-gray-500'}>{p.status}</span>
                          {' · '}{p.payment_type_id}
                          {p.payer_name && <span className="text-muted-foreground"> · {p.payer_name}</span>}
                          <span className="ml-1 text-gray-400 text-xs">{p.date_created ? new Date(p.date_created).toLocaleTimeString('es-AR') : ''}</span>
                          <span className="ml-1 text-gray-400 text-xs">id={p.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <Separator />

          {/* Lista de cuentas */}
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando cuentas...
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cuentas configuradas. Agregá la primera.</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) =>
                editingName === account.nombreCuenta ? (
                  <AccountForm
                    key={account.nombreCuenta}
                    initial={account}
                    onSave={handleEdit}
                    onCancel={() => setEditingName(null)}
                    existingNames={[]}
                  />
                ) : (
                  <div
                    key={account.nombreCuenta}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      account.activo ? 'border-pink-400 bg-pink-50' : 'border-border bg-background'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`h-3 w-3 rounded-full shrink-0 ${account.activo ? 'bg-pink-500' : 'bg-gray-300'}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{account.nombreCuenta}</span>
                          {account.activo && <Badge className="bg-pink-500 text-white text-xs py-0 h-5">Activa</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {account.firebasePathPagos} · {maskToken(account.accessTokenMercadoPago)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {!account.activo && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-pink-700 hover:bg-pink-100"
                          onClick={() => handleSelect(account.nombreCuenta)}
                          title="Seleccionar como cuenta activa"
                        >
                          Activar
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditingName(account.nombreCuenta)}
                        title="Editar cuenta"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:bg-red-50"
                        onClick={() => handleDelete(account.nombreCuenta)}
                        title="Eliminar cuenta"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {/* Formulario agregar */}
          {showAddForm ? (
            <AccountForm
              onSave={handleAdd}
              onCancel={() => setShowAddForm(false)}
              existingNames={existingNames}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Agregar cuenta de Mercado Pago
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
};


export default MpAccountsManager;
