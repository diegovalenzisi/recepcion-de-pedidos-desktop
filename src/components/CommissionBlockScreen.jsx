import React from 'react';
import { Loader2, ShieldAlert, RefreshCw, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ESTADO_SESION, textoDeBloqueo, textoNoVerificable } from '@/lib/api/comisionCorte';
import { cerrarAplicacion } from '@/lib/native/cerrarAplicacion';

/**
 * PANTALLA BLOQUEANTE POR LÍMITE DE COMISIÓN.
 *
 * Se muestra en lugar del área operativa cuando la sesión arrancó con la deuda
 * en el límite de corte o por encima.
 *
 * NO HAY NINGUNA ACCIÓN LOCAL QUE PERMITA CONTINUAR. Acá vivía un formulario de
 * pago (`CommissionPaymentManager`) con el que el propio local podía declarar
 * que había pagado y desbloquearse solo: ese pago escribía de verdad en
 * COMISIONES/PAGOS, bajaba el saldo y era indistinguible de un pago real. Se
 * eliminó por completo. El único botón es SALIR, que CIERRA LA APLICACIÓN sin
 * tocar el saldo.
 *
 * EL DESBLOQUEO NO OCURRE ACÁ. Ocurre cuando la administración central registra
 * el pago real y el saldo del ledger baja del límite: en el próximo arranque de
 * la aplicación el gate lo vuelve a leer y autoriza. Por eso esta pantalla no
 * tiene reintento, ni polling, ni listener.
 *
 * El importe que se muestra es `evaluacion.saldoCentavos`, EXACTAMENTE el mismo
 * número con el que se decidió el bloqueo. No se recalcula nada.
 */
const CommissionBlockScreen = ({ estado, evaluacion, onReintentar, onSalir }) => {
  // SALIR DE LA PANTALLA DE BLOQUEO CIERRA LA APLICACIÓN. Solo el de esa rama:
  // el SALIR de "no se pudo verificar" sigue siendo el cierre de sesión de
  // siempre, porque ahí el problema puede resolverse y conviene poder reintentar.
  //
  // Si el entorno no permite cerrar la aplicación (la app
  // servida en un navegador durante el desarrollo), cae al cierre de
  // sesión, para no dejar el botón muerto.
  const salir = async () => {
    const cerro = await cerrarAplicacion();
    if (!cerro && onSalir) onSalir();
  };

  // --- No se pudo verificar: NO es un bloqueo por corte ---------------------
  if (estado === ESTADO_SESION.ERROR) {
    const t = textoNoVerificable();
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-6">
        <div className="max-w-lg w-full bg-white rounded-xl shadow-2xl p-8 text-center">
          <ShieldAlert className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-800 mb-3">{t.titulo}</h1>
          <p className="text-gray-600 mb-6">{t.detalle}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={onReintentar} className="bg-primary">
              <RefreshCw className="w-4 h-4 mr-2" /> REINTENTAR
            </Button>
            <Button onClick={onSalir} variant="secondary">
              <LogOut className="w-4 h-4 mr-2" /> SALIR
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (estado === ESTADO_SESION.VERIFICANDO || !evaluacion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
        <Loader2 className="h-14 w-14 animate-spin text-primary mb-4" />
        <p className="text-gray-600">Verificando el estado de comisiones…</p>
      </div>
    );
  }

  // --- Bloqueo por corte ----------------------------------------------------
  const t = textoDeBloqueo(evaluacion);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-6">
      <div className="max-w-xl w-full bg-white rounded-xl shadow-2xl p-10 text-center">
        <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-6" />

        <h1 className="text-2xl font-bold text-red-700 mb-8">{t.titulo}</h1>

        <p className="text-lg text-gray-700">{t.pedido}</p>

        {/* El saldo real adeudado, tal como lo determinó el gate. */}
        <p className="text-5xl font-bold text-gray-900 my-6 tracking-tight">{t.importe}</p>

        <p className="text-lg text-gray-700">{t.cierre}</p>

        <p className="text-lg text-gray-600 mt-8">{t.gracias}</p>

        {/* SALIR es la ÚNICA acción, y CIERRA LA APLICACIÓN: no paga, no reintenta
            y no modifica el saldo. Al volver a abrir se evalúa el mismo límite
            contra el mismo ledger. */}
        <div className="flex justify-center mt-10">
          <Button onClick={salir} variant="secondary">
            <LogOut className="w-4 h-4 mr-2" /> SALIR
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CommissionBlockScreen;
