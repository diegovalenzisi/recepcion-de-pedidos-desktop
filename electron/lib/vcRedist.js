'use strict';

const path = require('node:path');
const fsReal = require('node:fs');
const { spawnSync: spawnSyncReal } = require('node:child_process');

// ---------------------------------------------------------------------------
// MICROSOFT VISUAL C++ REDISTRIBUTABLE (VCRUNTIME140.dll)
//
// El OpenSSL que se descarga como componente (ver installComponents() en
// electron/main.js, destino userData/tools/openssl) está compilado con MSVC y
// necesita el runtime de Visual C++ instalado en Windows. En una PC nueva que
// nunca tuvo otro software que lo trajera, openssl.exe no puede ni arrancar:
// falta VCRUNTIME140.dll.
//
// LA REGLA:
//   1. Nunca se asume que falta — se COMPRUEBA ejecutando `openssl version`
//      de verdad. Si ya funciona (caso normal: casi toda PC con Windows 10/11
//      ya tiene el runtime de alguna otra app), no se toca nada, no hay UAC.
//   2. Solo si esa verificación falla se instala el redistribuible oficial de
//      Microsoft, YA incluido como recurso de la app (getVcRedistResourcePath)
//      — nunca se descarga de Internet en este paso.
//   3. La instalación es silenciosa (`/install /quiet /norestart`) y eleva
//      ÚNICAMENTE ese proceso hijo vía PowerShell `Start-Process -Verb RunAs`:
//      la app en sí sigue sin admin.
//   4. Se vuelve a verificar `openssl version` después de instalar, y se
//      devuelve/loguea el motivo REAL en cada paso — nunca se oculta detrás
//      de un "no funciona" genérico.
//
// Módulo con efectos reales (ejecuta procesos), pero con `spawnSyncFn`/
// `existsSyncFn` inyectables para poder probarlo con fakes, sin tocar el
// sistema real en los tests.
// ---------------------------------------------------------------------------

/**
 * Códigos de salida del instalador oficial de Microsoft que NO son un error:
 *   0    = instalado correctamente
 *   3010 = instalado correctamente, pero requiere reiniciar Windows
 *   1638 = ya hay instalada una versión igual o más nueva (nada que hacer)
 */
const CODIGOS_EXITO_VCREDIST = new Set([0, 3010, 1638]);

function vcRedistExitoso(codigo) {
  const n = Number(codigo);
  return Number.isFinite(n) && codigo !== null && CODIGOS_EXITO_VCREDIST.has(n);
}

/**
 * ¿El OpenSSL bundled corre? Se comprueba ejecutándolo de verdad — no se
 * adivina mirando el registro de Windows: si falta VCRUNTIME140.dll,
 * `spawnSync` lo refleja solo (en `error` o en `status`).
 */
function verificarOpenssl(opensslExePath, { spawnSyncFn = spawnSyncReal } = {}) {
  if (!opensslExePath) return { ok: false, motivo: 'sin-ruta' };
  const r = spawnSyncFn(opensslExePath, ['version'], {
    encoding: 'utf-8',
    timeout: 10000,
    windowsHide: true,
  });
  if (r.error) return { ok: false, motivo: r.error.message || String(r.error) };
  if (typeof r.status === 'number' && r.status !== 0) {
    return { ok: false, motivo: `exit ${r.status}`, stderr: r.stderr || '' };
  }
  return { ok: true, stdout: (r.stdout || '').trim() };
}

/**
 * Instala el runtime de Visual C++ en silencio, elevando SOLO este proceso
 * hijo (no la app entera) vía `Start-Process -Verb RunAs`. `vcRedistExePath`
 * tiene que ser el instalador oficial YA incluido como recurso de la app
 * (ver getVcRedistResourcePath): esta función nunca descarga nada.
 */
function instalarVcRedist(vcRedistExePath, { spawnSyncFn = spawnSyncReal, existsSyncFn = fsReal.existsSync } = {}) {
  if (!vcRedistExePath || !existsSyncFn(vcRedistExePath)) {
    return { ok: false, motivo: 'instalador-no-encontrado' };
  }

  // Un solo argumento -Command: evita problemas de escapado de comillas entre
  // cmd.exe -> powershell.exe -> el propio Start-Process.
  const rutaEscapada = vcRedistExePath.replace(/'/g, "''");
  const comandoPS =
    `$p = Start-Process -FilePath '${rutaEscapada}' -ArgumentList '/install','/quiet','/norestart' `
    + `-Verb RunAs -Wait -PassThru; exit $p.ExitCode`;

  const r = spawnSyncFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comandoPS], {
    encoding: 'utf-8',
    timeout: 5 * 60 * 1000,
    windowsHide: true,
  });

  if (r.error) return { ok: false, motivo: r.error.message || String(r.error) };
  const codigo = typeof r.status === 'number' ? r.status : null;
  return {
    ok: vcRedistExitoso(codigo),
    codigo,
    motivo: vcRedistExitoso(codigo) ? null : `exit ${codigo}`,
  };
}

/**
 * Orquesta todo el flujo, con logging real en cada paso (nunca se traga el
 * motivo). `log` es inyectado por el caller: en electron/main.js es
 * `console.log`/`entry.logs.push` según el punto de uso, para que el error
 * real quede visible (en el panel de Facturación o en la consola) ANTES de
 * intentar arrancar el motor.
 *
 * @returns {{ ok: boolean, instalado: boolean, version?: string, motivo?: string, reinicioRequerido?: boolean }}
 */
function asegurarVcRedistSiHaceFalta({
  opensslExePath,
  vcRedistExePath,
  log = () => {},
  spawnSyncFn,
  existsSyncFn,
} = {}) {
  const antes = verificarOpenssl(opensslExePath, { spawnSyncFn });
  if (antes.ok) {
    log(`OpenSSL ya funciona (${antes.stdout || 'version OK'}). No se instala nada.`);
    return { ok: true, instalado: false, version: antes.stdout };
  }

  log(`OpenSSL no pudo arrancar (${antes.motivo}). Instalando Microsoft Visual C++ Redistributable (x64)...`);
  const instalacion = instalarVcRedist(vcRedistExePath, { spawnSyncFn, existsSyncFn });
  if (!instalacion.ok) {
    log(`No se pudo instalar el runtime de Visual C++: ${instalacion.motivo}`);
    return { ok: false, instalado: false, motivo: instalacion.motivo, errorOpenssl: antes.motivo };
  }
  log(`Runtime de Visual C++ instalado (código de salida ${instalacion.codigo}).`);

  const despues = verificarOpenssl(opensslExePath, { spawnSyncFn });
  const reinicioRequerido = instalacion.codigo === 3010;
  if (despues.ok) {
    log(`OpenSSL verificado OK después de instalar el runtime (${despues.stdout}).`);
    return { ok: true, instalado: true, version: despues.stdout, reinicioRequerido };
  }
  log(`OpenSSL SIGUE sin poder arrancar después de instalar el runtime: ${despues.motivo}`);
  return { ok: false, instalado: true, motivo: despues.motivo, reinicioRequerido };
}

/** Ruta del instalador oficial bundled (nunca se descarga de Internet). */
function getVcRedistResourcePath({ isPackaged, resourcesPath, repoRoot } = {}) {
  return isPackaged
    ? path.join(resourcesPath, 'vcredist', 'vc_redist.x64.exe')
    : path.join(repoRoot, 'resources', 'vcredist', 'vc_redist.x64.exe');
}

module.exports = {
  CODIGOS_EXITO_VCREDIST,
  vcRedistExitoso,
  verificarOpenssl,
  instalarVcRedist,
  asegurarVcRedistSiHaceFalta,
  getVcRedistResourcePath,
};
