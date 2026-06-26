/**
 * Cargador de variables de entorno.
 * Este módulo DEBE ser el primer import de server.js para que las variables
 * estén disponibles antes de que firebase.js (y otros módulos) las lean.
 *
 * - Desarrollo: carga backend/.env (ubicado en el directorio padre de src/)
 * - Producción (Electron): las vars ya vienen pre-seteadas por el proceso
 *   principal de Electron; este módulo actúa como respaldo sin sobrescribir.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// Intentar cargar desde DOTENV_CONFIG_PATH si está definido (Electron prod)
if (process.env.DOTENV_CONFIG_PATH) {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH });
}

// Siempre intentar cargar desde backend/.env como fallback (desarrollo)
// dotenv.config() no sobreescribe variables ya definidas, así que esto es seguro.
dotenv.config({ path: join(__dir, '..', '.env') });
