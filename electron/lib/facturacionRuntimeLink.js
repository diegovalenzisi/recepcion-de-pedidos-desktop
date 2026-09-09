'use strict';

const path = require('node:path');
const fsReal = require('node:fs');
const { pathToFileURL } = require('node:url');

// ---------------------------------------------------------------------------
// NODE_MODULES COMPARTIDO DEL MOTOR DE FACTURACIÓN — junction, no copia.
//
// El problema real (confirmado en Lepo Lepo y Joao): los motores son ESM y
// viven en
//
//     facturacion/locales/{localId}/ri/index.mjs
//     facturacion/locales/{localId}/mono/{cuentaId}/index.mjs
//
// y hacen `import 'dotenv'` (y firebase-admin, moment, pdfkit, qrcode, soap).
// Node resuelve un import ESM buscando `node_modules` SUBIENDO el árbol desde
// el archivo que importa. El runtime real vive en
//
//     facturacion-runtime/node_modules
//
// que es HERMANO de `facturacion/`, nunca ancestro de
// `facturacion/locales/{id}/ri/` — así que ese node_modules real jamás
// aparece en la búsqueda, sin importar cuánto se suba. `deps-ok` y las
// pantallas de diagnóstico daban por buena la instalación (comprobaban que
// existiera EN ALGÚN LADO), pero eso nunca implicó que fuera resoluble desde
// donde el motor realmente corre.
//
// La solución (la misma que ya probamos a mano y funcionó): un junction de
// Windows en `facturacion/node_modules` que apunte a
// `facturacion-runtime/node_modules`. Node lo atraviesa igual que una carpeta
// real al buscar node_modules subiendo el árbol, y no duplica un solo byte:
// sigue habiendo un único runtime compartido por PC.
//
// Módulo mayormente puro: `decidirAccionNodeModules` no toca disco. El resto
// sí (fs real, inyectable para tests) porque un junction es, por definición,
// una operación de filesystem.
// ---------------------------------------------------------------------------

// Dependencias REALES del motor (resources/facturacion/package.json +
// imports reales de monotributo/, responsable-inscripto/ y lib/ — no una
// lista supuesta). Node built-ins (fs, https, child_process) no cuentan.
const REQUIRED_PACKAGES = ['dotenv', 'firebase-admin', 'moment', 'pdfkit', 'qrcode', 'soap'];

/**
 * Decide qué hacer con `facturacion/node_modules` a partir del estado YA
 * LEÍDO del disco. No hace ningún I/O — por eso es fácil de probar cada
 * combinación sin tocar el filesystem real.
 *
 * @param {object} estado
 * @param {boolean} estado.runtimeExists         ¿existe facturacion-runtime/node_modules?
 * @param {'none'|'link'|'real-dir'} estado.linkKind  qué es HOY facturacion/node_modules
 * @param {string|null} estado.linkTargetReal    destino real (resuelto) del link, o null si está roto/no es link
 * @param {string|null} estado.runtimeRealPath   ruta real (resuelta) del runtime, o null si no existe
 * @returns {{ accion: 'nada'|'crear'|'reparar'|'respetar-copia-real'|'sin-runtime', motivo: string }}
 */
function decidirAccionNodeModules({ runtimeExists, linkKind, linkTargetReal, runtimeRealPath } = {}) {
  if (linkKind === 'real-dir') {
    return {
      accion: 'respetar-copia-real',
      motivo: 'facturacion/node_modules ya es una carpeta real (copia local existente, p. ej. de facturacion:install-deps); no se reemplaza por un junction',
    };
  }
  if (!runtimeExists) {
    return { accion: 'sin-runtime', motivo: 'facturacion-runtime/node_modules todavía no existe (runtime no instalado)' };
  }
  if (linkKind === 'link' && linkTargetReal && runtimeRealPath && linkTargetReal === runtimeRealPath) {
    return { accion: 'nada', motivo: 'el junction ya apunta al runtime correcto' };
  }
  if (linkKind === 'link') {
    return { accion: 'reparar', motivo: `el junction apunta a ${linkTargetReal || '(roto)'} en vez de ${runtimeRealPath}` };
  }
  return { accion: 'crear', motivo: 'no existe facturacion/node_modules' };
}

/** Lee del disco lo que decidirAccionNodeModules() necesita. Solo lectura. */
function inspeccionarEstado(fs, linkPath, runtimeModulesDir) {
  const runtimeExists = fs.existsSync(runtimeModulesDir);
  let linkKind = 'none';
  let linkTargetReal = null;

  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      linkKind = 'link';
      try { linkTargetReal = fs.realpathSync(linkPath); } catch { linkTargetReal = null; } // reparse point roto
    } else if (st.isDirectory()) {
      linkKind = 'real-dir';
    }
  } catch { /* no existe todavía */ }

  let runtimeRealPath = null;
  if (runtimeExists) {
    try { runtimeRealPath = fs.realpathSync(runtimeModulesDir); } catch { runtimeRealPath = null; }
  }

  return { runtimeExists, linkKind, linkTargetReal, runtimeRealPath };
}

/**
 * Garantiza `facturacion/node_modules` como junction hacia
 * `facturacion-runtime/node_modules`. Idempotente y segura de llamar en cada
 * arranque de la app y antes de cada spawn de un motor:
 *
 *   - falta el junction, existe el runtime   → lo crea
 *   - junction ya correcto                    → no hace nada
 *   - junction roto o apuntando a otro lado    → lo reemplaza
 *   - ya hay una carpeta REAL (copia legacy)   → se respeta, no se toca
 *   - no existe el runtime todavía             → no hace nada (se reintenta solo)
 *
 * @param {object} opts
 * @param {string} opts.facturacionDir      userData/facturacion
 * @param {string} opts.runtimeModulesDir   userData/facturacion-runtime/node_modules
 * @param {object} [opts.fs]                inyección de fs para tests (default: fs real)
 * @param {(msg:string)=>void} [opts.log]
 * @param {(msg:string)=>void} [opts.logError]
 * @returns {{ ok: boolean, accion: string, motivo?: string, error?: string }}
 */
function ensureFacturacionNodeModulesLink({
  facturacionDir,
  runtimeModulesDir,
  fs = fsReal,
  log = console.log,
  logError = console.error,
} = {}) {
  const linkPath = path.join(facturacionDir, 'node_modules');
  try {
    fs.mkdirSync(facturacionDir, { recursive: true });
    const estado = inspeccionarEstado(fs, linkPath, runtimeModulesDir);
    const { accion, motivo } = decidirAccionNodeModules(estado);

    if (accion === 'nada') {
      log('[Facturación Runtime] node_modules compartido OK');
      return { ok: true, accion };
    }
    if (accion === 'respetar-copia-real') {
      log('[Facturación Runtime] node_modules compartido OK (copia local existente, no se reemplaza)');
      return { ok: true, accion };
    }
    if (accion === 'sin-runtime') {
      // No es un error: el runtime todavía no se instaló/descargó. El próximo
      // arranque (o el próximo spawn, que llama a esta misma función) lo
      // resuelve solo apenas el runtime aparezca.
      return { ok: false, accion, motivo };
    }

    if (accion === 'reparar') {
      fs.rmSync(linkPath, { force: true });
    }
    fs.symlinkSync(runtimeModulesDir, linkPath, 'junction');
    log(
      `[Facturación Runtime] Junction ${accion === 'reparar' ? 'reparado' : 'creado'}:\n` +
      `  ${linkPath}\n  -> ${runtimeModulesDir}`
    );
    return { ok: true, accion };
  } catch (e) {
    logError(`[Facturación Runtime] ERROR preparando dependencias: ${e.message}`);
    return { ok: false, accion: 'error', error: e.message };
  }
}

/**
 * Verificación REAL (no supuesta): importa de verdad, vía ESM dinámico, cada
 * paquete de REQUIRED_PACKAGES desde un archivo .mjs descartable ubicado a la
 * MISMA profundidad que un motor real (`facturacion/locales/.../index.mjs`),
 * para probar exactamente el camino de resolución que usa un motor real —
 * no `require.resolve` desde otro lado, que podría dar un falso OK.
 *
 * @param {string} facturacionDir  userData/facturacion
 * @param {string[]} [packages]
 * @param {object} [opts]
 * @param {object} [opts.fs]
 * @returns {Promise<{ ok: boolean, faltantes: string[], resultados: Record<string, {ok:boolean, error?:string}> }>}
 */
async function verificarPaquetesResolubles(facturacionDir, packages = REQUIRED_PACKAGES, { fs = fsReal } = {}) {
  const probeDir = path.join(facturacionDir, 'locales', '.verificacion-runtime');
  const resultados = {};
  try {
    fs.mkdirSync(probeDir, { recursive: true });
  } catch (e) {
    for (const pkg of packages) resultados[pkg] = { ok: false, error: `no se pudo crear el directorio de prueba: ${e.message}` };
    return { ok: false, faltantes: [...packages], resultados };
  }

  for (const pkg of packages) {
    const probeFile = path.join(probeDir, `probe-${pkg.replace(/[^a-zA-Z0-9]/g, '_')}-${process.pid}.mjs`);
    try {
      fs.writeFileSync(probeFile, `import ${JSON.stringify(pkg)};\n`, 'utf-8');
      await import(pathToFileURL(probeFile).href);
      resultados[pkg] = { ok: true };
    } catch (e) {
      resultados[pkg] = { ok: false, error: e.message };
    } finally {
      try { fs.rmSync(probeFile, { force: true }); } catch { /* best-effort */ }
    }
  }
  try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  const faltantes = Object.entries(resultados).filter(([, r]) => !r.ok).map(([pkg]) => pkg);
  return { ok: faltantes.length === 0, faltantes, resultados };
}

module.exports = {
  REQUIRED_PACKAGES,
  decidirAccionNodeModules,
  inspeccionarEstado,
  ensureFacturacionNodeModulesLink,
  verificarPaquetesResolubles,
};
