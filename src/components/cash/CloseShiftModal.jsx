
import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { closeShift, generateShiftReportData } from '@/lib/api/cash';
import { saveShiftSummaryToPath } from '@/lib/api/cash/summary.js';
import { getCurrentLocalId } from '@/lib/firebase/core.js';
import { Loader2, ShieldAlert } from 'lucide-react';
import { fetchVendorsByCategory } from '@/lib/api/hrApi';
import { fetchUsers } from '@/lib/api/usersApi';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';

/** Rol comparable: sin tildes, sin espacios sobrantes, en minúsculas. */
const normalizarRol = (rol) =>
  String(rol ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/**
 * Roles que NO deben elegir un "Vendedor Responsable": ellos mismos son el
 * responsable del cierre.
 *
 * OJO con la estructura real: los roles que se pueden asignar en Usuarios son
 * `empleado`, `encargado` y `dueño` — NO existe un rol `vendedor`. Los
 * "vendedores" del selector salen de RRHH (categoría VENDEDOR), que es otra
 * cosa. Por eso la condición se escribe por exclusión: cualquiera que no tenga
 * un rol jerárquico debe seguir eligiendo responsable, y un rol desconocido cae
 * del lado seguro (sigue pidiéndolo).
 */
const ROLES_SIN_SELECTOR = ['dueno', 'encargado', 'admin', 'administrador', 'gerente'];

const CloseShiftModal = ({ isOpen, onClose, shiftData, sales, onShiftClosed, settings, user, totalCost }) => {
  const [cashCount, setCashCount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [authorizedUsers, setAuthorizedUsers] = useState([]);
  const [selectedResponsible, setSelectedResponsible] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  useEffect(() => {
    if (isOpen) {
      const loadAuthorizedUsers = async () => {
        try {
          const vendors = await fetchVendorsByCategory();
          setAuthorizedUsers(vendors);
        } catch (error) {
          console.error("Error loading vendors:", error);
          toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los vendedores autorizados.' });
        }
      };

      loadAuthorizedUsers();
    }
  }, [isOpen, toast]);

  // ROL REAL DEL USUARIO LOGUEADO.
  //
  // La sesión ya trae `rol`, pero se guarda en sessionStorage al iniciar sesión:
  // si a ese usuario le cambiaron el rol después, el valor queda viejo. Por eso
  // se lo busca en los USUARIOS del local activo por su clave/usuario, y recién
  // si no aparece se usa el rol de la sesión. No se asume que haya un solo dueño
  // ni que el primero de la lista sea el logueado.
  //
  // DiegoL es la excepción: es el administrador del sistema y NO está en
  // USUARIOS, así que se resuelve sin consultar nada.
  const [rolReal, setRolReal] = useState(null);

  useEffect(() => {
    if (!isOpen || !user) { setRolReal(null); return; }

    let vigente = true;
    const resolverRol = async () => {
      if (user.usuario === 'DiegoL') { if (vigente) setRolReal('administrador'); return; }
      try {
        const usuarios = await fetchUsers();
        const encontrado = usuarios.find((u) =>
          (user.id !== undefined && String(u.id) === String(user.id))
          || (user.usuario && u.usuario === user.usuario));
        if (vigente) setRolReal(encontrado?.rol ?? user.rol ?? null);
      } catch (error) {
        // Sin lectura no se inventa un rol: se usa el de la sesión.
        console.warn('[cierre] no se pudieron leer los usuarios del local, se usa el rol de la sesión:', error?.message || error);
        if (vigente) setRolReal(user.rol ?? null);
      }
    };
    resolverRol();
    return () => { vigente = false; };
  }, [isOpen, user]);

  /**
   * ¿Hay que pedir "Vendedor Responsable"? Solo cuando quien cierra no tiene un
   * rol jerárquico. Antes el selector se mostraba SIEMPRE, sin mirar el rol.
   */
  const requiereVendedorResponsable = useMemo(() => {
    if (user?.usuario === 'DiegoL') return false;
    const rol = normalizarRol(rolReal ?? user?.rol);
    if (!rol) return true;                      // rol desconocido: se sigue pidiendo
    return !ROLES_SIN_SELECTOR.includes(rol);
  }, [user, rolReal]);

  /** Quién queda registrado como responsable cuando no se elige vendedor. */
  const responsablePropio = useMemo(() => {
    if (!user) return '';
    return String(user.nombre || user.usuario || '').trim();
  }, [user]);

  const canSeeDetails = useMemo(() => {
    if (!user) return false;
    if (user.usuario === 'DiegoL') return true;
    const userRole = (user.rol || '').toLowerCase();
    return ['dueño', 'encargado', 'admin', 'gerente'].includes(userRole);
  }, [user]);

  const reportData = useMemo(() => {
    if (!shiftData || !sales || !settings) return null;
    return generateShiftReportData(shiftData, sales, parseFloat(cashCount || 0), settings);
  }, [shiftData, sales, cashCount, settings]);

  const handleProgressUpdate = (message) => {
    setProgressMessage(message);
  };

  const handleCloseShift = async () => {
    if (cashCount === '' || isNaN(parseFloat(cashCount))) {
      toast({ variant: 'destructive', title: 'Error', description: 'Por favor, ingrese un monto de efectivo válido.' });
      return;
    }
    // El vendedor responsable solo se exige —y se valida— cuando el selector se
    // muestra. Para un dueño, encargado o el administrador, el responsable del
    // cierre es él mismo: no se pide, y NUNCA se elige un vendedor automático ni
    // se guarda vacío.
    let responsableDelCierre = responsablePropio;

    if (requiereVendedorResponsable) {
      if (!selectedResponsible) {
        toast({ variant: 'destructive', title: 'Error', description: 'Por favor, seleccione un responsable.' });
        return;
      }

      // Validate that the selected user actually exists and is a VENDEDOR
      const responsibleUser = authorizedUsers.find(u => `${u.nombre} ${u.apellido}`.trim() === selectedResponsible);
      if (!responsibleUser || responsibleUser.categoriaNombre?.toUpperCase() !== 'VENDEDOR') {
          toast({ variant: 'destructive', title: 'Error', description: 'El usuario seleccionado no es válido o no pertenece a la categoría VENDEDOR.' });
          return;
      }
      responsableDelCierre = selectedResponsible;
    } else if (!responsableDelCierre) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo identificar al usuario que cierra el turno.' });
      return;
    }

    setIsLoading(true);
    setProgressMessage('Iniciando cierre...');
    try {
      const shiftDataToSave = {
        ...shiftData,
        costoTotal: totalCost !== undefined ? totalCost : 0
      };

      // Quién EJECUTÓ el cierre, siempre: es independiente de quién figure como
      // responsable. `cierreResponsable` conserva su significado de siempre.
      const ejecutadoPor = {
        id: user?.id ?? user?.usuario ?? null,
        usuario: user?.usuario ?? null,
        nombre: user?.nombre ?? null,
        rol: rolReal ?? user?.rol ?? null,
        fecha: new Date().toISOString(),
        eligioVendedor: requiereVendedorResponsable,
      };

      await closeShift(shiftDataToSave, parseFloat(cashCount), sales, null, responsableDelCierre, handleProgressUpdate, ejecutadoPor);
      
      // Calculate and save shift summary data to Firebase CAJAS path
      setProgressMessage('Guardando resumen del turno...');
      const localId = getCurrentLocalId();
      const calculatedTotalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
      const expensesArray = Object.values(shiftDataToSave.gastos || {});
      const calculatedTotalExpenses = expensesArray.reduce((sum, exp) => sum + (exp?.monto || 0), 0);
      const safeEntries = Object.values(shiftDataToSave.CAJAFUERTE || {}).filter(Boolean);
      const calculatedTotalSafe = safeEntries.reduce((sum, entry) => sum + (entry.valor || 0), 0);
      const calculatedGanancia = calculatedTotalSales - calculatedTotalExpenses - (totalCost || 0);

      const summaryData = {
          ventasTotales: calculatedTotalSales,
          gastosTotales: calculatedTotalExpenses,
          cajaFuerte: calculatedTotalSafe,
          costoTotal: totalCost || 0,
          ganancia: Math.round(calculatedGanancia * 1000) / 1000,
          fondoInicial: shiftDataToSave.fondoInicial || 0
      };

      await saveShiftSummaryToPath(localId, shiftDataToSave.date, shiftDataToSave.id, summaryData);

      toast({ title: 'Turno Cerrado', description: `El turno #${shiftData.id} ha sido cerrado exitosamente.` });
      onShiftClosed(null);
      onClose();
    } catch (error) {
      // UN ERROR DE CIERRE TIENE QUE DECIR DOS COSAS: qué falló y en qué punto
      // quedó. El mensaje viejo ("No se pudo cerrar el turno.") ocultó durante
      // todo un turno que los pedidos YA se habían respaldado y borrado: la
      // caja mostraba $0 y nadie sabía por qué.
      console.error("Error closing shift:", error, {
        fase: error?.faseCierre, pedidosYaMovidos: error?.pedidosYaMovidos,
      });
      const detalle = error?.message || 'Error desconocido.';
      const estado = error?.pedidosYaMovidos
        ? 'ATENCIÓN: los pedidos del turno ya fueron respaldados y sacados de las pantallas. NO reintentes el cierre sin revisarlo o el turno quedará guardado con ventas en cero.'
        : 'No se movió ningún pedido y el turno sigue abierto: se puede reintentar.';
      toast({
        variant: 'destructive',
        title: 'No se pudo cerrar el turno',
        description: `${detalle} ${estado}`,
        duration: 20000,
      });
    } finally {
      setIsLoading(false);
      setProgressMessage('');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount || 0);
  };

  const formatCostCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amount || 0);
  };

  useEffect(() => {
    if (!isOpen) {
      setCashCount('');
      setSelectedResponsible('');
      setIsLoading(false);
      setProgressMessage('');
    }
  }, [isOpen]);

  if (!shiftData || !reportData) return null;

  const { summary } = reportData;
  const { difference } = summary;

  // ÚNICA CONDICIÓN QUE HABILITA EL CIERRE.
  //
  // Antes el `disabled` del botón repetía por su cuenta `|| !selectedResponsible`
  // sin mirar el rol. Como a un dueño, encargado o administrador ya no se le
  // muestra el selector, `selectedResponsible` se quedaba vacío para siempre y el
  // botón no se habilitaba nunca: no podían cerrar el turno.
  //
  // Ahora los tres puntos —el render del selector, esta habilitación y la
  // validación de `handleCloseShift`— derivan de `requiereVendedorResponsable`,
  // así que no pueden volver a desincronizarse.
  const montoValido = cashCount !== '' && !isNaN(parseFloat(cashCount));
  const faltaResponsable = requiereVendedorResponsable
    ? !selectedResponsible     // empleado / rol desconocido: tiene que elegirlo
    : !responsablePropio;      // jerárquico: cierra a su nombre
  const puedeConfirmar = !isLoading && montoValido && !faltaResponsable;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cerrar Turno #{shiftData.id}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <p className="text-lg font-semibold text-gray-700">Procesando cierre de turno...</p>
            <div className="w-full max-w-md">
              <Progress value={100} className="h-2 animate-pulse" />
              <p className="text-sm text-center mt-2 text-gray-500">{progressMessage}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
              {canSeeDetails ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <p>Fecha de Caja:</p><p className="font-semibold text-right">{shiftData.date}</p>
                    <p>Hora de Cierre:</p><p className="font-semibold text-right">{new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                    <p>Número de Turno:</p><p className="font-semibold text-right">#{shiftData.id}</p>
                    <p>Fondo Inicial:</p><p className="font-semibold text-right">{formatCurrency(summary.fondoInicial)}</p>
                    <p>Ventas en Efectivo:</p><p className="font-semibold text-right">{formatCurrency(summary.totalCashSales)}</p>
                    <p>Ventas Electrónicas:</p><p className="font-semibold text-right">{formatCurrency(summary.totalElectronicSales)}</p>
                    <p>Gastos en Efectivo:</p><p className="font-semibold text-right text-red-500">-{formatCurrency(summary.totalCashExpenses)}</p>
                    <p>Gastos Electrónicos:</p><p className="font-semibold text-right text-red-500">-{formatCurrency(summary.totalElectronicExpenses)}</p>
                    <p>Monto en Resguardo:</p><p className="font-semibold text-right text-blue-500">-{formatCurrency(summary.totalSafe)}</p>
                    <p>Costo Total:</p><p className="font-semibold text-right text-orange-500">{formatCostCurrency(totalCost)}</p>
                    <p className="font-bold border-t pt-2">Efectivo Esperado:</p><p className="font-bold border-t pt-2 text-right">{formatCurrency(summary.cashInBox)}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center bg-gray-50 p-4 rounded-lg">
                    <ShieldAlert className="w-16 h-16 text-orange-500 mb-4" />
                    <h3 className="text-lg font-semibold text-center">Cierre de Turno de Empleado</h3>
                    <p className="text-sm text-gray-600 text-center mt-2">
                        Por favor, ingrese el monto total de efectivo contado en la caja y seleccione el vendedor responsable del cierre.
                    </p>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cash-count">Efectivo Contado en Caja</Label>
                  <Input
                    id="cash-count"
                    type="number"
                    placeholder="Ingrese el monto contado"
                    value={cashCount}
                    onChange={(e) => setCashCount(e.target.value)}
                    className="text-lg"
                  />
                </div>

                {canSeeDetails && (
                  <div className={`p-2 rounded-md text-center font-bold ${difference === 0 ? 'bg-gray-100' : difference > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    Diferencia: {formatCurrency(difference)}
                  </div>
                )}

                {/* El selector solo aparece para quien NO tiene rol jerárquico.
                    Un dueño, un encargado o el administrador cierran a su propio
                    nombre y no tienen por qué elegir un vendedor. */}
                {!requiereVendedorResponsable ? (
                  <div className="space-y-2">
                    <Label>Responsable del Cierre</Label>
                    <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm">
                      <span className="font-semibold">{responsablePropio || '—'}</span>
                      {(rolReal ?? user?.rol) && (
                        <span className="text-muted-foreground"> ({rolReal ?? user?.rol})</span>
                      )}
                    </div>
                  </div>
                ) : (
                <div className="space-y-2">
                  <Label htmlFor="responsible">Vendedor Responsable</Label>
                  <Select onValueChange={setSelectedResponsible} value={selectedResponsible}>
                    <SelectTrigger id="responsible">
                      <SelectValue placeholder="Seleccione un vendedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {authorizedUsers.length === 0 ? (
                        <SelectItem value="none" disabled>No hay vendedores disponibles</SelectItem>
                      ) : (
                        authorizedUsers.map(emp => {
                          const fullName = `${emp.nombre || ''} ${emp.apellido || ''}`.trim();
                          return (
                            <SelectItem key={emp.legajo || fullName} value={fullName}>
                              <div className="flex justify-between items-center w-full gap-4">
                                <span>{fullName}</span>
                                <span className="text-xs text-muted-foreground uppercase">VENDEDOR</span>
                              </div>
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>
                )}
              </div>
            </div>
            <DialogFooter className="justify-end">
              <div className="flex gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="secondary" disabled={isLoading}>Cancelar</Button>
                </DialogClose>
                <Button onClick={handleCloseShift} disabled={!puedeConfirmar}>
                  Confirmar y Cerrar Turno
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CloseShiftModal;
