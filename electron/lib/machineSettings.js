'use strict';

const path = require('node:path');
const fsReal = require('node:fs');

// ---------------------------------------------------------------------------
// PREFERENCIA LOCAL POR MÁQUINA — machine-settings.json
//
// Vive en userData, NUNCA en el directorio de instalación: userData no se
// toca al actualizar la app (un instalador nuevo reemplaza el programa, no
// los datos del usuario), así que esta preferencia sobrevive a cada versión.
//
// Hoy sólo guarda `facturacionAutoStartEnabled` — si esta PC debe arrancar
// sola sus motores fiscales al iniciar la app. Es una preferencia DE ESTA
// INSTALACIÓN puntual, no de una cuenta fiscal ni de un local: una PC
// administrativa que se usa para entrar a varios locales (nunca para
// facturar) la pone en `false` una vez y punto — no depende de qué local esté
// activo, no depende de FACTURACION_OWNERS, no se sincroniza por Firebase.
//
// DEFAULT: TRUE. Ausente (instalación nueva, o una versión anterior que
// todavía no conocía este archivo) es EXACTAMENTE "toda PC factura por
// defecto" — el comportamiento de siempre (ver decidirArranqueFacturacion.js).
// Sólo un `false` explícito, escrito una vez en ESA máquina, la excluye.
//
// Módulo puro salvo lectura/escritura de disco, que recibe `fs` inyectable
// para poder probarse sin tocar el filesystem real.
// ---------------------------------------------------------------------------

const MACHINE_SETTINGS_FILE = 'machine-settings.json';

/** Ruta de machine-settings.json dentro de userData. */
function machineSettingsPath(userDataDir) {
  return path.join(userDataDir, MACHINE_SETTINGS_FILE);
}

/**
 * Lee machine-settings.json. Nunca lanza: archivo ausente, corrupto o con
 * JSON que no es un objeto se tratan igual — "sin preferencias guardadas"
 * (objeto vacío), que es lo mismo que decir "esta PC nunca configuró nada acá
 * todavía". Un archivo roto no puede tumbar el arranque de la app.
 *
 * @param {string} userDataDir  app.getPath('userData')
 * @param {object} [opts]
 * @param {object} [opts.fs]    inyección de fs para tests (default: fs real)
 * @returns {object}
 */
function leerMachineSettings(userDataDir, { fs = fsReal } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(machineSettingsPath(userDataDir), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Escribe machine-settings.json completo (mezclar antes de llamar si hace
 * falta conservar otras claves — ver setFacturacionAutoStartEnabled).
 */
function escribirMachineSettings(userDataDir, settings, { fs = fsReal } = {}) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(machineSettingsPath(userDataDir), JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * ¿El autoarranque de facturación está habilitado en ESTA instalación?
 *
 * Función PURA: recibe lo que ya devolvió `leerMachineSettings` (o cualquier
 * objeto de prueba), no toca disco. Único criterio: `false` explícito excluye;
 * cualquier otra cosa (ausente, `true`, `undefined`, un objeto vacío) permite.
 *
 * @param {object} settings
 * @returns {boolean}
 */
function facturacionAutoStartHabilitado(settings) {
  return settings?.facturacionAutoStartEnabled !== false;
}

/**
 * Persiste el switch de autoarranque de ESTA máquina. Sólo la llama una
 * acción explícita (nunca el autoarranque en sí, que sólo LEE).
 */
function setFacturacionAutoStartEnabled(userDataDir, enabled, { fs = fsReal } = {}) {
  const actuales = leerMachineSettings(userDataDir, { fs });
  escribirMachineSettings(userDataDir, { ...actuales, facturacionAutoStartEnabled: enabled === true }, { fs });
}

module.exports = {
  MACHINE_SETTINGS_FILE,
  machineSettingsPath,
  leerMachineSettings,
  escribirMachineSettings,
  facturacionAutoStartHabilitado,
  setFacturacionAutoStartEnabled,
};
