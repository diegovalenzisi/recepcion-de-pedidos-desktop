'use strict';

// ---------------------------------------------------------------------------
// POLÍTICA DE ARRANQUE DE LA FACTURACIÓN AUTOMÁTICA
//
// TODA PC FACTURA POR DEFECTO. Antes hacía falta entrar a Configuración y
// apretar "Iniciar": la decisión colgaba de un `activo` que nacía en `false`, así
// que una PC recién instalada —o una que nadie tocó nunca— no facturaba aunque
// tuviera todo lo necesario. Ahora la condición es al revés:
//
//     facturacionAutomatica !== false   →   ARRANCA
//
// Es decir, se arranca SALVO que alguien haya apagado el switch a propósito en
// ESA computadora. Ese OFF vive solo en el archivo local (nunca se sincroniza
// por Firebase) y se respeta en todos los arranques siguientes: nada lo vuelve a
// encender solo.
//
// Lo que NO interviene, a propósito:
//   · el rol del usuario logueado (dueño / encargado / empleado);
//   · si alguien entró alguna vez a Configuración;
//   · el flag `initialized`, que en las PCs viejas quedaba en false aunque los
//     archivos estuvieran completos — los archivos son la verdad;
//   · el concepto de "PC dueña", que quedó eliminado. Que dos PCs no facturen el
//     mismo pedido lo garantiza el claim atómico por pedido del motor, no quién
//     arranca.
//
// Módulo puro: sin Electron, sin Firebase, sin filesystem. Recibe el estado ya
// leído y devuelve la decisión, para que sea verificable con pruebas reales.
// ---------------------------------------------------------------------------

/**
 * Versión de la política guardada en `facturacion-config.json`.
 *   ausente | 1 → política vieja (había que encender a mano)
 *   2            → política nueva (toda PC factura salvo OFF expreso)
 */
const BILLING_AUTOSTART_POLICY_VERSION = 2;

/** Cuentas de un config, sin importar si es RI o monotributo. */
function cuentasDeConfig(config) {
  const c = config && typeof config === 'object' ? config : {};
  const lista = [];
  if (c.ri && typeof c.ri === 'object') lista.push(c.ri);
  for (const cuenta of (c.monotributo && c.monotributo.cuentas) || []) {
    if (cuenta && typeof cuenta === 'object') lista.push(cuenta);
  }
  return lista;
}

/**
 * MIGRACIÓN DE UNA SOLA VEZ a la política 2.
 *
 * El problema que resuelve: en las PCs ya instaladas hay `activo:false` que NO
 * significa "lo apagué a propósito", sino que nadie entró nunca a encenderlo. Si
 * esos false se leyeran como decisión del usuario, las PCs existentes seguirían
 * sin facturar — que es justo lo que hay que arreglar.
 *
 * Por eso la migración ignora los `activo` históricos y deja la facturación
 * habilitada, PERO solo donde el campo nuevo todavía no existe: si alguien ya se
 * expresó con el switch nuevo, esa decisión no se pisa.
 *
 * @param {object} config  nodo de facturacion-config.json (se MUTA)
 * @returns {{ migrado: boolean, cuentasTocadas: number }}
 */
function migrarPoliticaAutoStart(config) {
  if (!config || typeof config !== 'object') return { migrado: false, cuentasTocadas: 0 };
  if (Number(config.billingAutoStartPolicyVersion) >= BILLING_AUTOSTART_POLICY_VERSION) {
    return { migrado: false, cuentasTocadas: 0 };
  }

  let cuentasTocadas = 0;
  for (const cuenta of cuentasDeConfig(config)) {
    if (cuenta.facturacionAutomatica === undefined) {
      cuenta.facturacionAutomatica = true;
      cuentasTocadas += 1;
    }
  }

  config.billingAutoStartPolicyVersion = BILLING_AUTOSTART_POLICY_VERSION;
  return { migrado: true, cuentasTocadas };
}

/** ¿El switch de esta PC habilita facturar con esta cuenta? Por defecto, SÍ. */
function facturacionHabilitada(cuenta) {
  return !(cuenta && cuenta.facturacionAutomatica === false);
}

/** Requisitos de archivo que el motor necesita sí o sí para poder emitir. */
const REQUISITOS = ['env', 'cert', 'key', 'serviceAccount', 'engine', 'firebaseUrl', 'firebasePath'];

/**
 * ¿Esta PC debe arrancar el motor para ESTA cuenta?
 *
 * @param {object} params
 * @param {object} params.cuenta      nodo de la cuenta (ri o monotributo[i])
 * @param {object} params.requisitos  { env, cert, key, serviceAccount, engine, firebaseUrl, firebasePath } en booleanos
 * @param {boolean} params.yaCorriendo ¿ya hay un proceso vivo para esta cuenta?
 * @returns {{ arranca: boolean, motivo: string, faltantes: string[] }}
 */
function decidirArranqueCuenta({ cuenta, requisitos = {}, yaCorriendo = false } = {}) {
  if (!facturacionHabilitada(cuenta)) {
    return { arranca: false, motivo: 'detenida-manualmente', faltantes: [] };
  }

  const faltantes = REQUISITOS.filter((k) => !requisitos[k]);
  if (faltantes.length > 0) {
    return { arranca: false, motivo: 'falta-configuracion-fiscal', faltantes };
  }

  // No se duplica un proceso que ya está vivo: ni por un re-render, ni por una
  // reconexión de Firebase, ni por volver a entrar a Configuración.
  if (yaCorriendo) {
    return { arranca: false, motivo: 'ya-corriendo', faltantes: [] };
  }

  return { arranca: true, motivo: 'habilitada', faltantes: [] };
}

/**
 * Nombre de la cola de una cuenta a partir de su FIREBASE_PATH
 * ("{localId}/FACTURACION_N"). Nada hardcodeado: si mañana existe
 * FACTURACION_7, sale de acá sin tocar una línea de código.
 */
function colaDesdeFirebasePath(firebasePath) {
  const partes = String(firebasePath || '').split('/').filter(Boolean);
  return partes.length ? partes[partes.length - 1] : null;
}

module.exports = {
  BILLING_AUTOSTART_POLICY_VERSION,
  REQUISITOS,
  cuentasDeConfig,
  migrarPoliticaAutoStart,
  facturacionHabilitada,
  decidirArranqueCuenta,
  colaDesdeFirebasePath,
};
