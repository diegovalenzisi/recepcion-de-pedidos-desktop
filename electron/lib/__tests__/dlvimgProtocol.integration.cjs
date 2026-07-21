'use strict';

// Prueba de INTEGRACIÓN real con el runtime de Electron: registra el protocolo
// dlvimg:// EXACTAMENTE como main.js, abre una BrowserWindow oculta, carga un
// <img src="dlvimg://..."> y confirma naturalWidth/naturalHeight > 0. Prueba el
// protocolo Y la carga del elemento <img>, no solo Response/resolveProtocolPath.
//
// Modo diagnóstico: si se pasa DLV_REAL_CACHE=<root> y DLV_REAL_LOCAL/DLV_REAL_KEY/
// DLV_REAL_VER, usa esa entrada real del caché en vez de crear una temporal.
//
// Correr:  (con ELECTRON_RUN_AS_NODE desactivado)
//   npx electron electron/lib/__tests__/dlvimgProtocol.integration.cjs

const { app, protocol, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createImageCacheService } = require('../imageCacheService.js');

// PNG 2x2 válido (magic bytes reales).
const PNG_2x2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF8FAGmQBg9E4B8kAAAAAElFTkSuQmCC',
  'base64'
);

function log(tag, obj) { console.log(`[dlvimg-int] ${tag}`, obj !== undefined ? JSON.stringify(obj) : ''); }
function finish(code, tag) { log(tag); try { app.quit(); } catch {} process.exit(code); }

// Estabilidad en entornos headless/CI (deben ir ANTES de app.ready).
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');

protocol.registerSchemesAsPrivileged([
  { scheme: 'dlvimg', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: true } },
]);

(async () => {
  await app.whenReady().catch((e) => finish(1, 'WHENREADY_ERR ' + e.message));

  // --- Elegir origen: caché real (diagnóstico) o temporal (autónomo) ---
  const realRoot = process.env.DLV_REAL_CACHE;
  let root, localId, key, ver, service;

  if (realRoot && process.env.DLV_REAL_KEY) {
    root = realRoot;
    localId = process.env.DLV_REAL_LOCAL;
    key = process.env.DLV_REAL_KEY;
    ver = process.env.DLV_REAL_VER || '0';
    service = createImageCacheService({ root, httpGet: async () => ({}) });
    log('MODE', { mode: 'real-cache', root, localId, key: key.slice(0, 12), ver });
  } else {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dlvimg-int-'));
    localId = '40508022';
    service = createImageCacheService({ root, httpGet: async () => ({ status: 200, buffer: PNG_2x2, contentType: 'image/png' }) });
    const OBJ = '40508022/articulos/test.png';
    const url = `https://firebasestorage.googleapis.com/v0/b/achava3703.firebasestorage.app/o/${encodeURIComponent(OBJ)}?token=x`;
    const dl = await service.download(localId, 'achava3703.firebasestorage.app', OBJ, { url, remoteMeta: { generation: '100', size: PNG_2x2.length } });
    key = dl.key;
    ver = 'g100';
    log('MODE', { mode: 'temp-cache', root, key: key.slice(0, 12) });
  }

  // --- Registrar el handler EXACTAMENTE como main.js (usa parseProtocolUrl) ---
  protocol.handle('dlvimg', async (request) => {
    try {
      const { localId: lId, key: k } = service.parseProtocolUrl(request.url);
      log('HANDLER_REQ', { url: request.url, localId: lId, key: k.slice(0, 12) });
      const { path: filePath, contentType } = await service.resolveProtocolPath(lId, k);
      const data = await fs.promises.readFile(filePath);
      log('HANDLER_OK', { contentType, bytes: data.length });
      return new Response(data, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store, no-cache, must-revalidate' } });
    } catch (e) {
      log('HANDLER_ERR', { code: e.code, message: e.message });
      return new Response('', { status: 404, headers: { 'cache-control': 'no-store' } });
    }
  });

  // Usa el MISMO constructor de URL que el servicio (localId en el path).
  const src = service.buildProtocolUrl(localId, key, { generation: String(ver).replace(/^g/, '') });
  log('IMG_SRC', { src: src.replace(key, key.slice(0, 12) + '...') });

  const win = new BrowserWindow({ show: false, width: 420, height: 340, backgroundColor: '#ffffff', webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: true } });

  const html = `<!doctype html><html><body style="margin:0;background:#fff;font-family:sans-serif">
    <div style="padding:12px">
      <div style="font-size:13px;color:#333;margin-bottom:8px">dlvimg:// integration — imagen real del caché (naturalSize se muestra abajo)</div>
      <img id="t" src="${src}" style="max-width:360px;border:1px solid #ccc;border-radius:8px">
      <div id="d" style="font-size:12px;color:#555;margin-top:8px"></div>
    </div></body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const capture = async (w, h) => {
    try {
      await win.webContents.executeJavaScript(`document.getElementById('d').textContent='dlvimg OK · naturalSize=${w}x${h}';`);
      const img = await win.capturePage();
      const outDir = path.join(process.cwd(), 'diagnostics');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'dlvimg-proof.png'), img.toPNG());
      log('SCREENSHOT_SAVED', { file: 'diagnostics/dlvimg-proof.png' });
    } catch (e) { log('SCREENSHOT_ERR', { message: e.message }); }
  };

  // Poll del estado real del <img> vía executeJavaScript (no depende de GPU).
  const started = Date.now();
  const poll = async () => {
    try {
      const r = await win.webContents.executeJavaScript(`(() => {
        const i = document.getElementById('t');
        return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight };
      })()`);
      if (r.complete) {
        if (r.w > 0 && r.h > 0) { await capture(r.w, r.h); return finish(0, `IMG_OK naturalSize=${r.w}x${r.h}`); }
        return finish(1, `IMG_ERROR complete pero naturalSize=${r.w}x${r.h} (el <img> no decodificó dlvimg://)`);
      }
    } catch (e) { /* renderer aún no listo */ }
    if (Date.now() - started > 12000) return finish(1, 'TIMEOUT esperando el <img>');
    setTimeout(poll, 300);
  };
  poll();
})();
