import { useState, useRef, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { getCurrentDatabaseOrThrow, getCurrentLocalId } from '@/lib/firebase/core';
import { fetchLimiteCorte, fetchAlarmaPagoVerificable } from '@/lib/api/settingsApi';
import { rutaTotales, contabilidadActiva, leerAcumuladores } from '@/lib/api/comisionMovimiento';
import { calcularSaldoLegadoCentavos } from '@/hooks/useCommissionTotal';
import {
  ESTADO_SESION, evaluarInicioConLecturas, estadoDeSesion,
  valorLeido, valorNoVerificable,
} from '@/lib/api/comisionCorte';

/**
 * La deuda según el ledger que funciona HOY: Σ COMISIONES/REGISTRO válidos −
 * Σ COMISIONES/PAGOS aprobados, con piso en 0.
 *
 * Se usa mientras `migracionVersion` esté ausente o en 0, que es el estado de
 * todos los locales. Antes el corte se auto-autorizaba en ese caso y por lo
 * tanto NUNCA bloqueaba: quedaba atado a una migración que todavía no ocurrió.
 *
 * La cuenta NO se reimplementa acá: sale de `calcularSaldoLegadoCentavos`, la
 * misma función que usa el aviso y el footer. Si viviera en dos lados, el aviso
 * y el bloqueo podrían mostrar deudas distintas.
 *
 * No toca acumuladores, no migra nada y no usa la contabilidad nueva.
 */
const leerSaldoLegado = async (db, localId) => {
  const [reg, pag] = await Promise.all([
    get(ref(db, `${localId}/COMISIONES/REGISTRO`)),
    get(ref(db, `${localId}/COMISIONES/PAGOS`)),
  ]);
  return calcularSaldoLegadoCentavos(reg.val(), pag.val());
};

/**
 * GATE DE INICIO POR LÍMITE DE CORTE.
 *
 * Se evalúa UNA SOLA VEZ por sesión real, con una LECTURA PUNTUAL. No hay
 * listener: por construcción no existe ningún camino por el que una venta
 * posterior convierta una sesión autorizada en bloqueada. Esa es la garantía
 * estructural del requisito "el corte se controla solamente al iniciar".
 *
 * Cuatro estados:
 *
 *     VERIFICANDO_COMISION    leyendo saldo, alarma y límite
 *     AUTORIZADA              se puede trabajar (con o sin aviso)
 *     BLOQUEADA_POR_CORTE     la deuda alcanzó el límite
 *     ERROR_DE_VERIFICACION   no se pudo leer: NO se asume nada
 *
 * Un error de Firebase NUNCA se interpreta como "corte desactivado": sería la
 * forma de saltarse el límite justo cuando no se pudo comprobar.
 *
 * `yaEvaluadoRef` es lo que hace que la decisión sea definitiva: una vez que la
 * sesión quedó AUTORIZADA, ninguna re-ejecución vuelve a mirar el saldo.
 */
export const useGateComision = () => {
  const [estado, setEstado] = useState(ESTADO_SESION.VERIFICANDO);
  const [evaluacion, setEvaluacion] = useState(null);
  const yaEvaluadoRef = useRef(false);

  /**
   * Evalúa el arranque. Idempotente: si la sesión ya quedó autorizada, no
   * vuelve a leer nada ni puede cambiar de estado.
   */
  const evaluar = useCallback(async () => {
    if (yaEvaluadoRef.current) return;

    setEstado(ESTADO_SESION.VERIFICANDO);
    const localId = getCurrentLocalId();
    if (!localId) return;

    // Las tres lecturas, cada una distinguiendo "ausente" de "no se pudo leer".
    let saldo;
    try {
      const db = getCurrentDatabaseOrThrow(localId);
      const snap = await get(ref(db, rutaTotales(localId)));
      const totales = snap.val();
      saldo = contabilidadActiva(totales)
        ? valorLeido(leerAcumuladores(totales).saldoPendienteCentavos)
        : valorLeido(await leerSaldoLegado(db, localId));
    } catch (e) {
      saldo = valorNoVerificable(e?.message || 'no se pudo leer el saldo');
    }

    const [alarma, limite] = await Promise.all([fetchAlarmaPagoVerificable(), fetchLimiteCorte()]);
    const ev = evaluarInicioConLecturas({ saldo, alarma, limite });
    const nuevo = estadoDeSesion(ev);

    setEvaluacion(ev);
    setEstado(nuevo);
    // Solo se "fija" la decisión si la sesión quedó habilitada. Un bloqueo o un
    // error NO se fijan: el próximo arranque los vuelve a evaluar.
    if (nuevo === ESTADO_SESION.AUTORIZADA) yaEvaluadoRef.current = true;
  }, []);

  // NO HAY DESBLOQUEO DESDE LA APLICACIÓN.
  //
  // Acá vivía `reevaluarTrasPago`: tras un pago hecho en la propia pantalla de
  // bloqueo releía el saldo y, si había bajado del límite, habilitaba la sesión
  // en el acto. Junto con el formulario de pago de esa pantalla, le daba al
  // local una forma de desbloquearse solo — el pago se escribía de verdad en
  // COMISIONES/PAGOS y era indistinguible de un pago real.
  //
  // Se eliminó. La única salida del bloqueo es que la administración central
  // registre el pago y el saldo del ledger baje del límite: en el próximo
  // arranque `evaluar()` lo lee y autoriza. Sin polling, sin listener y sin
  // reintento automático, a propósito.

  return { estado, evaluacion, evaluar, yaAutorizada: yaEvaluadoRef };
};
