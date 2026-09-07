import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mic, Unlink, Wallet } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  CUENTA_IDS,
  listenToMercadoPagoOAuthStatus,
  buildMercadoPagoOAuthStartUrl,
  disconnectMercadoPago,
  updateMercadoPagoAlias,
} from '@/lib/api/mercadoPagoOAuthApi';
import { speakTestAnnouncement } from '@/hooks/useVoicePaymentAlerts';

const ALIAS_POR_DEFECTO = { 1: 'Principal' };

// Una posición (1 a 5) de Mercado Pago de este local. Independiente de las
// demás: se conecta, se desconecta y guarda su alias sin afectar al resto.
const CuentaMercadoPagoSlot = ({ cuentaId, estado }) => {
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [alias, setAlias] = useState(estado?.alias || ALIAS_POR_DEFECTO[cuentaId] || '');
  const [guardandoAlias, setGuardandoAlias] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setAlias(estado?.alias || ALIAS_POR_DEFECTO[cuentaId] || '');
  }, [estado?.alias, cuentaId]);

  const conectado = !!estado?.conectado;

  const handleConectar = useCallback(() => {
    try {
      setConectando(true);
      const url = buildMercadoPagoOAuthStartUrl(cuentaId);
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      toast({
        title: 'Se abrió Mercado Pago',
        description: 'Iniciá sesión con la cuenta que corresponda a esta posición y autorizá a DLV. Cuando termines, volvé acá.',
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo iniciar la conexión', description: error?.message });
    } finally {
      setConectando(false);
    }
  }, [cuentaId, toast]);

  const handleProbarVoz = useCallback(() => {
    const aliasActual = (estado?.alias || '').trim();
    const texto = aliasActual
      ? `Prueba de Mercado Pago ${aliasActual}. Recibiste un pago de diez mil pesos.`
      : undefined;
    const ok = speakTestAnnouncement(texto);
    if (!ok) {
      toast({ variant: 'destructive', title: 'Sin síntesis de voz', description: 'Este equipo no tiene disponible el sistema de voz.' });
    }
  }, [estado?.alias, toast]);

  const handleDesconectar = useCallback(async () => {
    const nombre = (estado?.alias || '').trim() || `posición ${cuentaId}`;
    if (!window.confirm(`¿Seguro que querés desconectar "${nombre}"? Vas a dejar de recibir el aviso por voz de los cobros de esta cuenta hasta que la conectes de nuevo.`)) {
      return;
    }
    setDesconectando(true);
    try {
      await disconnectMercadoPago(cuentaId);
      toast({ title: 'Mercado Pago desconectado', className: 'bg-green-50 text-green-800 border-green-200' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo desconectar', description: error?.message });
    } finally {
      setDesconectando(false);
    }
  }, [cuentaId, estado?.alias, toast]);

  const handleGuardarAlias = useCallback(async () => {
    const nuevoAlias = alias.trim();
    if (nuevoAlias === (estado?.alias || '').trim()) return;
    setGuardandoAlias(true);
    try {
      await updateMercadoPagoAlias(cuentaId, nuevoAlias);
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar el nombre', description: error?.message });
    } finally {
      setGuardandoAlias(false);
    }
  }, [alias, cuentaId, estado?.alias, toast]);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{conectado ? '🟢' : '🔴'}</span>
          {conectado ? 'Conectado' : 'No conectado'}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onBlur={handleGuardarAlias}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            placeholder={`Nombre (ej. "Caja ${cuentaId}")`}
            disabled={guardandoAlias}
            className="h-8 w-44 text-sm"
          />
        </div>
      </div>

      {conectado && estado?.fechaConexion && (
        <p className="text-xs text-muted-foreground">
          Conectado desde {new Date(estado.fechaConexion).toLocaleDateString('es-AR')}
          {estado.userIdMercadoPago ? ` · cuenta MP #${estado.userIdMercadoPago}` : ''}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {conectado ? (
          <>
            <Button variant="outline" size="sm" onClick={handleProbarVoz}>
              <Mic className="w-4 h-4 mr-2" /> Probar aviso por voz
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDesconectar} disabled={desconectando}>
              {desconectando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Unlink className="w-4 h-4 mr-2" />}
              Desconectar
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={handleConectar} disabled={conectando}>
            {conectando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
            Conectar
          </Button>
        )}
      </div>
    </div>
  );
};

// Acceso: NO depende de AdminPanel.jsx (ese panel sigue siendo exclusivo de
// `DiegoL`, el superadmin técnico). El que gatea esta sección es
// LocalSettings.jsx, con el permiso puntual `configuracion_mercadopago`
// (src/config/permissions.js) — el mismo mecanismo de permisos por ítem que
// ya usa el resto de la app (ej. `cajas_gestionar_fondo`). Un admin le asigna
// ese permiso al usuario "dueño" del comercio desde Usuarios, sin darle
// acceso al resto del Panel de Administración. Este componente no repite el
// chequeo: si se está renderizando, es porque LocalSettings.jsx ya lo validó.
//
// Hasta 5 posiciones de cuenta de Mercado Pago por local (cuentaId "1" a
// "5"), cada una completamente independiente: su propio estado
// conectado/no conectado, su propio alias editable, sus propios botones
// Conectar/Desconectar.
const MercadoPagoOAuthManager = () => {
  const [estadoPorCuenta, setEstadoPorCuenta] = useState(undefined); // undefined = cargando

  useEffect(() => {
    const unsubscribe = listenToMercadoPagoOAuthStatus(
      (valor) => setEstadoPorCuenta(valor || {}),
      () => setEstadoPorCuenta({}),
    );
    return () => unsubscribe?.();
  }, []);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="w-5 h-5 text-primary" />
          Mercado Pago – Aviso de cobros por voz
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {estadoPorCuenta === undefined ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Consultando estado…
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Este local puede tener hasta {CUENTA_IDS.length} cuentas de Mercado Pago conectadas a la vez. Conectá cada una con la cuenta que corresponda y ponele un nombre para reconocerla en el aviso por voz.
            </p>
            <div className="space-y-3">
              {CUENTA_IDS.map((cuentaId) => (
                <CuentaMercadoPagoSlot
                  key={cuentaId}
                  cuentaId={cuentaId}
                  estado={estadoPorCuenta[cuentaId]}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default MercadoPagoOAuthManager;
