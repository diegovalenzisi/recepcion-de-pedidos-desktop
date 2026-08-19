import { useState, useRef, useCallback } from 'react';
import { ref, get } from 'firebase/database';
import { getCurrentDatabaseOrThrow, getCurrentLocalId } from '@/lib/firebase/core';
import { fetchLimiteCorte, fetchAlarmaPagoVerificable } from '@/lib/api/settingsApi';
import { rutaTotales, contabilidadActiva, leerAcumuladores } from '@/lib/api/comisionMovimiento';
import {
  ESTADO_SESION, evaluarInicioConLecturas, estadoDeSesion,
  valorLeido, valorNoVerificable, liberaTrasPago,
} from '@/lib/api/comisionCorte';

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
      // Dormido no hay deuda que controlar: el corte no aplica todavía.
      if (!contabilidadActiva(totales)) {
        yaEvaluadoRef.current = true;
        setEvaluacion(null);
        setEstado(ESTADO_SESION.AUTORIZADA);
        return;
      }
      saldo = valorLeido(leerAcumuladores(totales).saldoPendienteCentavos);
    } catch (e) {
      saldo = valorNoVerificable(e?.message || 'no se pudo leer el saldo');
    }

    const [alarma, limite] = await Promise.all([fetchAlarmaPagoVerificable(), fetchLimiteCorte()]);
    const ev = evaluarInicioConLecturas({ saldo, alarma, limite });
    const nuevo = estadoDeSesion(ev);

    setEvaluacion(ev);
    setEstado(nuevo);
    // Solo se "fija" la decisión si la sesión quedó habilitada. Un bloqueo o un
    // error tienen que poder reintentarse o resolverse con un pago.
    if (nuevo === ESTADO_SESION.AUTORIZADA) yaEvaluadoRef.current = true;
  }, []);

  /**
   * Tras un pago hecho desde la pantalla de bloqueo: UNA relectura del saldo.
   * Si quedó por debajo del límite, la sesión se habilita y no se vuelve a
   * evaluar el corte durante ese turno.
   */
  const reevaluarTrasPago = useCallback(async () => {
    const localId = getCurrentLocalId();
    if (!localId) return false;
    try {
      const db = getCurrentDatabaseOrThrow(localId);
      const totales = (await get(ref(db, rutaTotales(localId)))).val();
      const saldoDespues = leerAcumuladores(totales).saldoPendienteCentavos;
      const limite = await fetchLimiteCorte();
      if (!limite.ok) return false;   // no se pudo verificar: no se libera
      if (liberaTrasPago({ saldoCentavosDespues: saldoDespues, limiteCortePesos: limite.pesos })) {
        yaEvaluadoRef.current = true;      // desde acá, definitiva
        setEstado(ESTADO_SESION.AUTORIZADA);
        return true;
      }
      // Sigue por encima: se refresca el importe que se muestra.
      setEvaluacion((prev) => (prev ? { ...prev, saldoCentavos: saldoDespues } : prev));
      return false;
    } catch {
      return false;
    }
  }, []);

  return { estado, evaluacion, evaluar, reevaluarTrasPago, yaAutorizada: yaEvaluadoRef };
};
