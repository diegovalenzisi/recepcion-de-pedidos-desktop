import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Banknote, ShieldAlert } from 'lucide-react';
import { calcularRetiroPendiente, confirmarRetiroEfectivo } from '@/lib/api/cash';
import { printRetiroTicket } from '@/lib/print.js';
import { esRolAutorizadoRetiroEfectivo } from '@/lib/roleUtils';
import { resolverRolReal } from '@/lib/rolReal';

const formatMoney = (n) => `$ ${new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)}`;

/**
 * RETIRO DE EFECTIVO — corte administrativo entre grupos de tiradas, NO un
 * movimiento contable. Solo lee tiradas (CAJAFUERTE) ya existentes y anota,
 * en RETIROS_EFECTIVO, cuáles quedaron comprendidas. No toca Caja Fuerte, no
 * descuenta nada y no modifica ningún total de la pantalla CAJAS.
 */
const RetiroEfectivoModal = ({ isOpen, onClose, user }) => {
    const [rolReal, setRolReal] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(true);
    const [pendiente, setPendiente] = useState(null); // { candidatas, total, cantidad }
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorCarga, setErrorCarga] = useState(null);
    const { toast } = useToast();
    // Protege contra doble click / reintento incluso si dos handlers llegaran a
    // dispararse antes de que isProcessing termine de propagarse al render.
    const procesandoRef = useRef(false);

    useEffect(() => {
        if (!isOpen) {
            setPendiente(null);
            setErrorCarga(null);
            setRolReal(null);
            setLoadingPreview(true);
            setIsProcessing(false);
            procesandoRef.current = false;
            return;
        }

        let vigente = true;
        const cargar = async () => {
            setLoadingPreview(true);
            setErrorCarga(null);
            try {
                const rol = await resolverRolReal(user);
                if (!vigente) return;
                setRolReal(rol);

                if (!esRolAutorizadoRetiroEfectivo(rol)) {
                    // El botón que abre este modal ya está oculto para roles no
                    // autorizados; esta es la segunda barrera, en la función que
                    // realmente ejecuta el retiro.
                    setLoadingPreview(false);
                    return;
                }

                const resultado = await calcularRetiroPendiente();
                if (!vigente) return;
                setPendiente(resultado);
            } catch (error) {
                console.error('[RetiroEfectivo] Error al calcular tiradas pendientes:', error);
                if (vigente) setErrorCarga(error?.message || 'No se pudieron calcular las tiradas pendientes.');
            } finally {
                if (vigente) setLoadingPreview(false);
            }
        };

        cargar();
        return () => { vigente = false; };
    }, [isOpen, user]);

    const autorizado = esRolAutorizadoRetiroEfectivo(rolReal);

    const handleConfirmar = async () => {
        if (procesandoRef.current) return; // doble click / reintento: ignorar
        procesandoRef.current = true;
        setIsProcessing(true);
        try {
            // Vuelve a consultar tiradas pendientes y persiste en el mismo paso
            // (confirmarRetiroEfectivo recalcula internamente, no confía en la
            // preview que ya se mostró en pantalla).
            const resultado = await confirmarRetiroEfectivo({ user, rolReal });

            if (resultado.sinTiradas) {
                toast({ title: 'Sin tiradas pendientes', description: 'No hay tiradas pendientes de retiro.' });
                onClose();
                return;
            }

            const { retiro } = resultado;
            toast({ title: 'Retiro registrado', description: `Retiro #${retiro.retiroId} guardado correctamente.` });

            // El retiro YA quedó guardado. Un fallo de impresión desde acá en
            // adelante no debe borrar el retiro ni volver a liberar las tiradas
            // (punto 24) — por eso se avisa aparte y se conservan todos los datos
            // para una futura reimpresión.
            try {
                await printRetiroTicket({
                    retiroId: retiro.retiroId,
                    fecha: retiro.fecha,
                    hora: retiro.hora,
                    responsableNombre: retiro.responsable.nombre,
                    responsableRol: retiro.responsable.rol,
                    tiradas: Object.values(retiro.tiradas).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
                    cantidad: retiro.cantidadTiradas,
                    total: retiro.totalTiradas,
                });
            } catch (printError) {
                console.error('[RetiroEfectivo] Error al imprimir el ticket:', printError);
                toast({
                    variant: 'destructive',
                    title: 'Retiro guardado, pero no se pudo imprimir',
                    description: `El retiro #${retiro.retiroId} quedó registrado correctamente. Reintentá la impresión desde el ticket térmico.`,
                    duration: 15000,
                });
            }

            onClose();
        } catch (error) {
            console.error('[RetiroEfectivo] Error al confirmar el retiro:', error);
            toast({ variant: 'destructive', title: 'No se pudo registrar el retiro', description: error?.message || 'Error desconocido.' });
        } finally {
            procesandoRef.current = false;
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center"><Banknote className="mr-2" />Retiro de Efectivo</DialogTitle>
                </DialogHeader>

                {loadingPreview ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                        <p className="text-sm text-gray-500">Calculando tiradas pendientes...</p>
                    </div>
                ) : !autorizado ? (
                    <div className="py-6 flex flex-col items-center justify-center text-center gap-2">
                        <ShieldAlert className="h-12 w-12 text-red-500" />
                        <p className="font-semibold">No tenés permisos para realizar un Retiro de Efectivo.</p>
                        <p className="text-sm text-gray-500">Esta acción está reservada a Dueño y Encargado.</p>
                    </div>
                ) : errorCarga ? (
                    <div className="py-6 text-center text-red-600 text-sm">{errorCarga}</div>
                ) : pendiente && pendiente.cantidad === 0 ? (
                    <div className="py-6 text-center text-gray-600">No hay tiradas pendientes de retiro.</div>
                ) : pendiente ? (
                    <div className="py-4 space-y-4">
                        <p>¿Está seguro de que desea realizar un retiro de efectivo de Caja Fuerte?</p>
                        <div className="rounded-md border bg-gray-50 p-3 space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span>Tiradas pendientes:</span>
                                <span className="font-semibold">{pendiente.cantidad}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Total a retirar:</span>
                                <span className="font-bold text-lg">{formatMoney(pendiente.total)}</span>
                            </div>
                        </div>
                    </div>
                ) : null}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isProcessing}>Cancelar</Button>
                    {autorizado && !loadingPreview && !errorCarga && pendiente && pendiente.cantidad > 0 && (
                        <Button onClick={handleConfirmar} disabled={isProcessing}>
                            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirmar Retiro
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RetiroEfectivoModal;
