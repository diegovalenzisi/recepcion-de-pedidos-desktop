'use strict';

// Verifica, usando el RUNTIME DE ELECTRON (no `node` a secas), que los globals
// de los que depende el handler del protocolo dlvimg:// existen realmente en la
// versión de Node embebida en Electron 32.3.3, y que se puede construir la
// Response del protocolo. Esto descarta el riesgo de depender de un global que
// exista en el Node de desarrollo pero no en el runtime empaquetado (requisito 6).
//
// Correr con:  npx electron electron/lib/__tests__/electronRuntimeGlobals.cjs
// Sale 0 si todo OK, 1 si falta algún global o falla la Response.

const electron = require('electron');
const app = electron.app;

function finish(code, tag) {
  console.log(tag);
  try { if (app && app.quit) app.quit(); } catch { /* noop */ }
  process.exit(code);
}

function run() {
  const checks = {
    Response: typeof Response,
    Request: typeof Request,
    URL: typeof URL,
    URLSearchParams: typeof URLSearchParams,
    Buffer: typeof Buffer,
    fetch: typeof fetch,
  };
  let responseOk = false;
  try {
    const r = new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    responseOk = r.status === 200 && r.headers.get('content-type') === 'image/png';
  } catch (e) { responseOk = false; }

  const mustBeFn = ['Response', 'URL', 'URLSearchParams', 'Buffer'];
  const missing = mustBeFn.filter((k) => checks[k] !== 'function');

  console.log('[electron-globals]', JSON.stringify(checks),
    'responseOk=', responseOk,
    'node=', process.versions.node,
    'electron=', process.versions.electron);

  if (missing.length === 0 && responseOk) finish(0, 'ELECTRON_GLOBALS_OK');
  else finish(1, `ELECTRON_GLOBALS_FAIL missing=${missing.join(',')} responseOk=${responseOk}`);
}

if (app && typeof app.whenReady === 'function') {
  app.disableHardwareAcceleration();
  app.whenReady().then(run).catch((e) => finish(1, 'ELECTRON_GLOBALS_ERR ' + (e && e.message)));
} else {
  // No se está ejecutando bajo Electron.
  finish(1, 'NOT_RUNNING_UNDER_ELECTRON');
}
