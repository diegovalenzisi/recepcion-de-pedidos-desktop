// ---------------------------------------------------------------------------
// DEPARTAMENTOS CANÓNICOS — WRITER
//
// Único punto que efectivamente ESCRIBE en Firebase para garantizar que un
// local tenga sus tres departamentos PEDIDOSYA / RAPPI / M.LIBRE, reusando
// (adaptando) cualquier variante ya existente en vez de duplicarla. Toda la
// decisión de QUÉ escribir vive en `departamentosCanonicos.js` (puro,
// testeado); esto sólo lee, llama al plan, y aplica el `update()` resultante.
//
// NO se llama todavía desde ningún punto de arranque de la app — la
// integración (correrlo "al iniciar/configurar un local") se hace en un paso
// aparte, después de revisar el plan real de los locales existentes.
// ---------------------------------------------------------------------------

import { ref, get, update } from 'firebase/database';
import { getCurrentDatabasePath, beginFirebaseOperation } from '@/lib/firebase/core';
import { planDepartamentosCanonicos, construirUpdatesDesdePlan } from '@/lib/api/departamentosCanonicos';

/**
 * Lee `/{localId}/DEPARTAMENTOS`, calcula el plan y lo aplica si hace falta
 * algún cambio. Idempotente: si ya está todo canónico, no escribe nada.
 *
 * @returns {Promise<{ aplicado: boolean, plan: Array }>}
 */
export async function asegurarDepartamentosCanonicos() {
  const op = beginFirebaseOperation();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = op.getDatabaseOrAbort();

  const snap = await get(ref(db, `${LOCAL_ID}/DEPARTAMENTOS`));
  const actuales = snap.exists() ? snap.val() : {};

  const plan = planDepartamentosCanonicos(actuales);
  const updates = construirUpdatesDesdePlan(plan, LOCAL_ID);

  if (Object.keys(updates).length === 0) {
    return { aplicado: false, plan };
  }

  // Revalida antes de escribir: el get() de arriba fue un await real y el
  // local activo pudo haber cambiado mientras tanto.
  await update(ref(op.getDatabaseOrAbort()), updates);
  return { aplicado: true, plan };
}

/**
 * Igual que `asegurarDepartamentosCanonicos()`, pero SOLO LEE y devuelve el
 * plan — no escribe nada. Sirve para mostrar "qué haría" antes de aplicarlo
 * (por local, o contra el emulador).
 *
 * @returns {Promise<Array>} el plan de `planDepartamentosCanonicos()`
 */
export async function calcularPlanDepartamentosCanonicos() {
  const op = beginFirebaseOperation();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = op.getDatabaseOrAbort();

  const snap = await get(ref(db, `${LOCAL_ID}/DEPARTAMENTOS`));
  const actuales = snap.exists() ? snap.val() : {};
  return planDepartamentosCanonicos(actuales);
}
