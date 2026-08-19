import React from 'react';
import { Loader2, ShieldAlert, RefreshCw, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ESTADO_SESION, textoDeBloqueo, textoNoVerificable } from '@/lib/api/comisionCorte';
import { processCommissionPayment } from '@/lib/api/settingsApi';
import CommissionPaymentManager from '@/components/settings/local/admin/CommissionPaymentManager';
import { aPesos } from '@/lib/api/comisionMovimiento';

/**
 * PANTALLA BLOQUEANTE POR LÍMITE DE COMISIÓN.
 *
 * Se muestra en lugar del área operativa cuando la sesión arrancó con la deuda
 * por encima del límite de corte. No hay forma de entrar a trabajar desde acá:
 * o se paga hasta bajar del límite, o se sale.
 *
 * EL PAGO ES EL MISMO CIRCUITO DE SIEMPRE. Se reutiliza
 * `CommissionPaymentManager` y `processCommissionPayment` en vez de escribir un
 * segundo mecanismo de pago: un cobro que ocurre en una pantalla distinta no
 * puede tener otra idempotencia, otra validación ni otro camino contable.
 *
 * Tras un pago exitoso el contenedor hace UNA relectura del saldo; si quedó por
 * debajo del límite la sesión se habilita y ya no se vuelve a evaluar el corte
 * durante ese turno.
 */
const CommissionBlockScreen = ({ estado, evaluacion, onPagoExitoso, onReintentar, onSalir, balance }) => {
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
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-2xl p-8">
        <div className="text-center mb-6">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-red-700">{t.titulo}</h1>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-5 mb-6 space-y-2">
          <div className="flex justify-between text-lg">
            <span className="text-gray-700">Comisión pendiente:</span>
            <span className="font-bold text-red-700">
              ${aPesos(evaluacion.saldoCentavos).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-lg">
            <span className="text-gray-700">Límite permitido:</span>
            <span className="font-bold text-gray-800">
              ${aPesos(evaluacion.limiteCentavos).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <p className="text-gray-600 text-center mb-6">{t.detalle}</p>

        {/* MISMO circuito de pago que el panel de Configuración: mismo idPago
            persistente, misma validación y el mismo update() atómico. */}
        <div className="border-t pt-4">
          <CommissionPaymentManager
            accountTotals={{
              totalCommission: balance?.totalGenerated ?? 0,
              totalPagado: balance?.totalPaid ?? 0,
              aPagar: aPesos(evaluacion.saldoCentavos),
            }}
            onProcessPayment={processCommissionPayment}
            onPaymentSuccess={onPagoExitoso}
          />
        </div>

        <div className="flex justify-center mt-6">
          <Button onClick={onSalir} variant="secondary">
            <LogOut className="w-4 h-4 mr-2" /> SALIR
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CommissionBlockScreen;
