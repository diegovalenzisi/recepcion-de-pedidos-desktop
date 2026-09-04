import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Database, DatabaseBackup, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { crearImagen, inspeccionarImagen, restaurarImagen } from '@/lib/api/imagenLocalApi';
import { useAuth } from '@/hooks/useAuth';

/**
 * IMAGEN PARA PERÍODO DE PRUEBA.
 *
 * Dos acciones, y el concepto es literal:
 *
 *   CREAR IMAGEN      copia el local COMPLETO a BACKUP/{localId}/IMAGEN.
 *                     Solo lee: no modifica un dato del comercio.
 *   FINALIZAR PRUEBAS devuelve el local COMPLETO a esa copia.
 *                     Lo que existía al sacar la imagen vuelve; lo que apareció
 *                     después desaparece.
 *
 * No hay clasificación de ramas ni restauración selectiva: la imagen es la
 * verdad.
 */
const PeriodoPruebaManager = () => {
  const [info, setInfo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [confirmarCrear, setConfirmarCrear] = useState(false);
  const [paso1, setPaso1] = useState(false);
  const [paso2, setPaso2] = useState(false);
  const [palabra, setPalabra] = useState('');
  const [restaurando, setRestaurando] = useState(false);
  const [avance, setAvance] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();

  const refrescar = useCallback(async () => {
    setCargando(true);
    try {
      setInfo(await inspeccionarImagen());
    } catch (e) {
      console.error('[IMAGEN] No se pudo leer:', e);
      setInfo(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { refrescar(); }, [refrescar]);

  const versionApp = async () =>
    (window.electronAPI ? await window.electronAPI.getAppVersion?.() : '') || '';

  const crear = async () => {
    setConfirmarCrear(false);
    setCreando(true);
    try {
      const { metadata, reemplazo } = await crearImagen({
        versionSistema: await versionApp(),
        creadaPor: user?.usuario || '',
      });
      toast({
        title: reemplazo ? 'Imagen reemplazada' : 'Imagen creada',
        description: `${metadata.cantidadRamas} ramas · ${(metadata.bytes / 1024 / 1024).toFixed(1)} MB`,
      });
      await refrescar();
    } catch (e) {
      console.error('[IMAGEN] Error al crear:', e);
      toast({ variant: 'destructive', title: 'No se pudo crear la imagen', description: e.message });
    } finally {
      setCreando(false);
    }
  };

  const restaurar = async () => {
    setPaso2(false);
    setRestaurando(true);
    setAvance('Comenzando…');
    try {
      const r = await restaurarImagen({
        onPaso: setAvance,
        ejecutadoPor: user?.usuario || '',
      });
      if (r.ok) {
        toast({
          title: 'La base de datos volvió al estado de la imagen',
          description: 'El comercio está listo para comenzar a trabajar.',
        });
      } else {
        // La verificación no cerró: NO se dice que salió bien.
        toast({
          variant: 'destructive',
          title: 'La restauración terminó con observaciones',
          description: r.validacion.fallas.slice(0, 3).join(' · '),
        });
      }
      setPalabra('');
      await refrescar();
    } catch (e) {
      console.error('[RESTAURAR] Error:', e);
      toast({ variant: 'destructive', title: 'No se pudo restaurar', description: e.message });
    } finally {
      setRestaurando(false);
      setAvance('');
    }
  };

  const existe = info?.existe;
  const valida = info?.validacion?.ok;
  const meta = info?.metadata;
  const resumen = info?.resumen;

  const fecha = meta?.creadaEn
    ? new Date(meta.creadaEn).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" /> Imagen para período de prueba
          </CardTitle>
          <CardDescription>
            Una copia completa de la base de datos del comercio. Al finalizar las pruebas, todo
            vuelve exactamente al estado que tenía cuando se creó la imagen.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {cargando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Leyendo la imagen…
            </div>
          ) : !existe ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <DatabaseBackup className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                No hay una imagen de la base de datos creada. Creala cuando el comercio esté
                completamente configurado y antes de que el cliente empiece a probar.
              </span>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {valida
                  ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />}
                <span className="font-semibold">Imagen creada: {fecha}</span>
              </div>

              <p className="text-muted-foreground pl-6">
                {meta?.cantidadRamas ?? 0} ramas · {((meta?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MB
                {meta?.creadaPor ? ` · por ${meta.creadaPor}` : ''}
                {meta?.versionSistema ? ` · v${meta.versionSistema}` : ''}
              </p>

              {!valida && (
                <ul className="pl-6 text-red-700 list-disc list-inside">
                  {info.validacion.problemas.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}

              {valida && resumen && (
                <p className="text-muted-foreground pl-6">
                  {resumen.ramasQueSeBorran > 0
                    ? `Desde la imagen aparecieron ${resumen.ramasQueSeBorran} rama(s) nueva(s), que se eliminarían.`
                    : 'No aparecieron ramas nuevas desde que se creó la imagen.'}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant={existe ? 'outline' : 'default'}
              onClick={() => setConfirmarCrear(true)}
              disabled={creando || cargando || restaurando}
            >
              {creando
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creando…</>
                : <><Database className="h-4 w-4 mr-2" />
                    {existe ? 'Recrear imagen de base de datos' : 'Crear imagen de base de datos'}</>}
            </Button>

            {existe && valida && (
              <Button
                variant="destructive"
                onClick={() => setPaso1(true)}
                disabled={creando || cargando || restaurando}
              >
                {restaurando
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {avance}</>
                  : <><RotateCcw className="h-4 w-4 mr-2" /> Finalizar pruebas</>}
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Crear la imagen no modifica ningún dato del comercio: solo lo copia. La copia se guarda
            fuera del local, así que restaurar nunca la borra.
          </p>
        </CardContent>
      </Card>

      {/* Crear / reemplazar */}
      <AlertDialog open={confirmarCrear} onOpenChange={setConfirmarCrear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {existe ? '¿Reemplazar la imagen existente?' : '¿Crear la imagen de la base de datos?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {existe
                ? `Ya existe una imagen de esta base de datos, del ${fecha}. ¿Desea reemplazarla por el estado actual? La imagen anterior se pierde.`
                : 'Se va a copiar la base de datos completa del comercio. No se modifica ningún dato.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={crear}>{existe ? 'Reemplazar' : 'Crear'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restaurar — paso 1: la advertencia */}
      <AlertDialog open={paso1} onOpenChange={setPaso1}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Finalizar pruebas</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-semibold">
                La base de datos completa volverá exactamente al estado que tenía cuando se creó la
                imagen. Todos los cambios realizados después serán eliminados.
              </span>
              <span className="block">Imagen del {fecha}.</span>
              {resumen?.ramasQueSeBorran > 0 && (
                <span className="block">
                  Se eliminarán {resumen.ramasQueSeBorran} rama(s) que no existían entonces:{' '}
                  {resumen.nombresQueSeBorran.slice(0, 8).join(', ')}
                  {resumen.nombresQueSeBorran.length > 8 ? '…' : ''}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => { setPaso1(false); setPalabra(''); setPaso2(true); }}
            >
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restaurar — paso 2: escribir RESTAURAR */}
      <AlertDialog open={paso2} onOpenChange={setPaso2}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Confirmación final</AlertDialogTitle>
            <AlertDialogDescription>
              Para confirmar, escribí <strong>RESTAURAR</strong> en el campo de abajo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={palabra}
            onChange={(e) => setPalabra(e.target.value)}
            placeholder="RESTAURAR"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPalabra('')}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={palabra !== 'RESTAURAR'}
              onClick={restaurar}
            >
              Restaurar la base de datos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PeriodoPruebaManager;
