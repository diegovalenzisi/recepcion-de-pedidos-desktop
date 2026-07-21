'use strict';

// Pruebas del servicio de caché de imágenes (proceso principal).
// Usa fs REAL contra un directorio temporal (asserts reales de archivos y
// manifiesto) e inyecta un httpGet FAKE para simular la red sin salir a
// internet. Correr con: node electron/lib/__tests__/imageCacheService.test.js

const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  createImageCacheService,
  normalizeObjectPath,
  makeStableKey,
  compareVersion,
  looksLikeImage,
  validateDownload,
  validateDownloadUrl,
  assertRedirectAllowed,
  isPrivateOrLocalHost,
  versionTag,
  md5Base64,
  DEFAULT_MAX_BYTES,
} = require('../imageCacheService.js');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e && e.stack ? e.stack : e}`);
    process.exitCode = 1;
  }
}

// ---- Imágenes fake con magic bytes reales ----
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const JPEG_V2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7, 7, 7]);
const HTML_ERROR = Buffer.from('<!DOCTYPE html><html>error</html>');
const JSON_ERROR = Buffer.from('{"error":{"code":403}}');

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'imgcache-test-'));
}

// httpGet fake configurable por URL.
function makeHttpGet(routes) {
  return async (url) => {
    const r = routes[url];
    if (!r) return { status: 404, buffer: Buffer.from('not found'), contentType: 'text/plain' };
    if (typeof r === 'function') return r();
    return r;
  };
}

(async () => {
  console.log('Helpers puros:');
  await check('normalizeObjectPath rechaza traversal (..)', () => {
    assert.throws(() => normalizeObjectPath('40508022/../otro/x.png'), /traversal/);
  });
  await check('normalizeObjectPath quita barras iniciales y dobles', () => {
    assert.strictEqual(normalizeObjectPath('//40508022///articulos//a.png'), '40508022/articulos/a.png');
  });
  await check('makeStableKey es estable e ignora el token de la URL', () => {
    const k1 = makeStableKey('proj-a.appspot.com', '40508022/articulos/a.png');
    const k2 = makeStableKey('proj-a.appspot.com', '40508022/articulos/a.png');
    assert.strictEqual(k1, k2);
    assert.match(k1, /^[a-f0-9]{40}$/);
  });
  await check('makeStableKey distingue por bucket y por path', () => {
    const base = makeStableKey('proj-a.appspot.com', '40508022/articulos/a.png');
    assert.notStrictEqual(base, makeStableKey('proj-b.appspot.com', '40508022/articulos/a.png'));
    assert.notStrictEqual(base, makeStableKey('proj-a.appspot.com', '40508022/articulos/b.png'));
  });

  console.log('\ncompareVersion (prioridad generation → md5 → size/updated):');
  await check('metadata remota ausente => NO cambia (offline no invalida)', () => {
    assert.strictEqual(compareVersion({ generation: '1' }, null).changed, false);
  });
  await check('generation distinta => cambia', () => {
    assert.strictEqual(compareVersion({ generation: '1' }, { generation: '2' }).changed, true);
  });
  await check('misma generation, distinto md5/token => NO cambia (token no cuenta)', () => {
    const r = compareVersion({ generation: '5', md5Hash: 'AAA' }, { generation: '5', md5Hash: 'ZZZ' });
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.reason, 'generation');
  });
  await check('sin generation, md5 distinto => cambia', () => {
    assert.strictEqual(compareVersion({ md5Hash: 'AAA' }, { md5Hash: 'BBB' }).changed, true);
  });
  await check('sin generation ni md5, size distinto => cambia', () => {
    assert.strictEqual(compareVersion({ size: 100 }, { size: 200 }).changed, true);
  });
  await check('metadata insuficiente en ambos => NO cambia', () => {
    assert.strictEqual(compareVersion({}, {}).changed, false);
  });

  console.log('\nvalidateDownload / looksLikeImage:');
  await check('acepta PNG/JPEG reales', () => {
    assert.ok(looksLikeImage(PNG));
    assert.ok(looksLikeImage(JPEG));
  });
  await check('rechaza HTML y JSON de error', () => {
    assert.ok(!looksLikeImage(HTML_ERROR));
    assert.ok(!looksLikeImage(JSON_ERROR));
  });
  await check('401/403 => URL_EXPIRED', () => {
    assert.strictEqual(validateDownload({ status: 401, buffer: PNG, maxBytes: DEFAULT_MAX_BYTES, allowedContentTypes: new Set(['image/png']) }).code, 'URL_EXPIRED');
    assert.strictEqual(validateDownload({ status: 403, buffer: PNG, maxBytes: DEFAULT_MAX_BYTES, allowedContentTypes: new Set(['image/png']) }).code, 'URL_EXPIRED');
  });
  await check('tamaño máximo excedido => TOO_LARGE', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(50)]);
    assert.strictEqual(validateDownload({ status: 200, buffer: big, contentType: 'image/png', maxBytes: 10, allowedContentTypes: new Set(['image/png']) }).code, 'TOO_LARGE');
  });
  await check('content-type no imagen => BAD_CONTENT_TYPE', () => {
    assert.strictEqual(validateDownload({ status: 200, buffer: PNG, contentType: 'text/html', maxBytes: DEFAULT_MAX_BYTES, allowedContentTypes: new Set(['image/png']) }).code, 'BAD_CONTENT_TYPE');
  });
  await check('md5 esperado que no coincide => MD5_MISMATCH', () => {
    assert.strictEqual(validateDownload({ status: 200, buffer: PNG, contentType: 'image/png', expectedMd5: 'no-coincide', maxBytes: DEFAULT_MAX_BYTES, allowedContentTypes: new Set(['image/png']) }).code, 'MD5_MISMATCH');
  });

  // =====================================================================
  // Servicio con I/O real
  // =====================================================================
  const BUCKET = 'proj-a.appspot.com';
  const OBJ = '40508022/articulos/a.png';
  const URL_A = 'https://firebasestorage.googleapis.com/o/a.png?token=t1';

  console.log('\n1. Primera descarga guarda archivo local + manifiesto:');
  await check('descarga escribe el archivo y registra la entrada', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    const r = await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1', md5Hash: md5Base64(PNG), size: PNG.length } });
    assert.strictEqual(r.protocolUrl, `dlvimg://40508022/${key}?v=g1`);
    const onDisk = await fsp.readFile(path.join(root, '40508022', key));
    assert.ok(onDisk.equals(PNG));
    const manifest = JSON.parse(await fsp.readFile(path.join(root, '40508022', 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest[key].generation, '1');
    assert.strictEqual(manifest[key].objectPath, OBJ);
  });

  console.log('\n2. Segundo inicio usa la copia local sin re-descargar:');
  await check('resolveLocal devuelve cached=true sin tocar httpGet', async () => {
    const root = mkTmpRoot();
    let hits = 0;
    const httpGet = async (u) => { hits++; return { status: 200, buffer: PNG, contentType: 'image/png' }; };
    const svc = createImageCacheService({ root, httpGet });
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    const hitsAfterDownload = hits;
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ);
    assert.strictEqual(local.cached, true);
    assert.strictEqual(hits, hitsAfterDownload, 'resolveLocal no debe descargar');
  });

  console.log('\n3. Imagen remota modificada (generation nueva) => descarga y reemplaza:');
  await check('nueva generation reemplaza el archivo y conserva atomicidad', async () => {
    const root = mkTmpRoot();
    const routes = { [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } };
    const URL_A2 = 'https://firebasestorage.googleapis.com/o/a.png?token=t2';
    routes[URL_A2] = { status: 200, buffer: JPEG_V2, contentType: 'image/jpeg' };
    const svc = createImageCacheService({ root, httpGet: makeHttpGet(routes) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ);
    const cmp = compareVersion(local.entry, { generation: '2' });
    assert.strictEqual(cmp.changed, true);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A2, remoteMeta: { generation: '2' } });
    const onDisk = await fsp.readFile(path.join(root, '40508022', key));
    assert.ok(onDisk.equals(JPEG_V2), 'debe ser la versión nueva');
  });

  console.log('\n4. Token distinto con la MISMA generation => NO descarga:');
  await check('mismo generation, URL con token nuevo => compareVersion no cambia', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '9' } });
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ);
    assert.strictEqual(compareVersion(local.entry, { generation: '9' }).changed, false);
    // recordMetadataCheck actualiza el token sin re-descargar
    await svc.recordMetadataCheck('40508022', BUCKET, OBJ, { generation: '9' }, 'https://.../o/a.png?token=NUEVO');
    const local2 = await svc.resolveLocal('40508022', BUCKET, OBJ);
    assert.strictEqual(local2.entry.downloadUrl, 'https://.../o/a.png?token=NUEVO');
  });

  console.log('\n5. Falla de actualización conserva la copia anterior:');
  await check('descarga corrupta (HTML) no pisa el archivo válido previo', async () => {
    const root = mkTmpRoot();
    const URL_BAD = 'https://firebasestorage.googleapis.com/o/a.png?token=bad';
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({
      [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' },
      // content-type dice imagen pero los bytes son HTML: debe caer en el guard
      // de magic bytes (NOT_IMAGE), no en el de content-type.
      [URL_BAD]: { status: 200, buffer: HTML_ERROR, contentType: 'image/png' },
    }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    await assert.rejects(
      svc.download('40508022', BUCKET, OBJ, { url: URL_BAD, remoteMeta: { generation: '2' } }),
      (e) => e.code === 'NOT_IMAGE'
    );
    const onDisk = await fsp.readFile(path.join(root, '40508022', key));
    assert.ok(onDisk.equals(PNG), 'la copia anterior debe conservarse intacta');
  });

  console.log('\n6. 401/403 con reintento único (downloadWithRefresh):');
  await check('URL_EXPIRED => pide URL fresca y reintenta UNA vez, sin bucle', async () => {
    const root = mkTmpRoot();
    const URL_OLD = 'https://fb/o/a.png?token=viejo';
    const URL_NEW = 'https://fb/o/a.png?token=fresco';
    let getFreshCalls = 0;
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({
      [URL_OLD]: { status: 403, buffer: JSON_ERROR, contentType: 'application/json' },
      [URL_NEW]: { status: 200, buffer: PNG, contentType: 'image/png' },
    }) });
    const r = await svc.downloadWithRefresh('40508022', BUCKET, OBJ, {
      url: URL_OLD, remoteMeta: { generation: '1' },
      getFreshUrl: async () => { getFreshCalls++; return URL_NEW; },
    });
    assert.ok(r.protocolUrl);
    assert.strictEqual(getFreshCalls, 1, 'debe pedir URL fresca exactamente una vez');
  });
  await check('URL_EXPIRED persistente tras refresh => lanza, NO entra en bucle', async () => {
    const root = mkTmpRoot();
    const URL_OLD = 'https://fb/o/a.png?token=viejo';
    const URL_NEW = 'https://fb/o/a.png?token=igual-de-vencido';
    let getFreshCalls = 0;
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({
      [URL_OLD]: { status: 401, buffer: JSON_ERROR, contentType: 'application/json' },
      [URL_NEW]: { status: 401, buffer: JSON_ERROR, contentType: 'application/json' },
    }) });
    await assert.rejects(
      svc.downloadWithRefresh('40508022', BUCKET, OBJ, { url: URL_OLD, getFreshUrl: async () => { getFreshCalls++; return URL_NEW; } }),
      (e) => e.code === 'URL_EXPIRED'
    );
    assert.strictEqual(getFreshCalls, 1, 'un solo reintento, sin bucle');
  });

  console.log('\n7. Dos solicitudes simultáneas de la misma imagen => una sola descarga:');
  await check('dedupe: httpGet se llama una vez para dos download() concurrentes', async () => {
    const root = mkTmpRoot();
    let hits = 0;
    let resolveGate;
    const gate = new Promise((res) => { resolveGate = res; });
    const httpGet = async () => { hits++; await gate; return { status: 200, buffer: PNG, contentType: 'image/png' }; };
    const svc = createImageCacheService({ root, httpGet });
    const p1 = svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    const p2 = svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    resolveGate();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(hits, 1, 'una sola descarga real');
    assert.strictEqual(r1.protocolUrl, r2.protocolUrl);
    // Tras terminar, inFlight quedó limpio (finally)
    assert.strictEqual(svc.__internals.inFlightDownloads.size, 0);
  });
  await check('una descarga fallida limpia su entrada de inFlight (finally)', async () => {
    const root = mkTmpRoot();
    const URL_ERR = 'https://fb/o/a.png?token=err';
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_ERR]: { status: 500, buffer: Buffer.from('err'), contentType: 'text/plain' } }) });
    await assert.rejects(svc.download('40508022', BUCKET, OBJ, { url: URL_ERR }));
    assert.strictEqual(svc.__internals.inFlightDownloads.size, 0);
  });

  console.log('\n8. Aislamiento por local (misma key, distinto local):');
  await check('dos locales con el MISMO objectPath no comparten archivo ni manifiesto', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({
      'https://fb/A': { status: 200, buffer: PNG, contentType: 'image/png' },
      'https://fb/B': { status: 200, buffer: JPEG, contentType: 'image/jpeg' },
    }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: 'https://fb/A', remoteMeta: { generation: '1' } });
    await svc.download('99999999', BUCKET, OBJ, { url: 'https://fb/B', remoteMeta: { generation: '1' } });
    const a = await fsp.readFile(path.join(root, '40508022', key));
    const b = await fsp.readFile(path.join(root, '99999999', key));
    assert.ok(a.equals(PNG));
    assert.ok(b.equals(JPEG));
    assert.ok(!a.equals(b), 'archivos físicamente separados por carpeta de local');
  });

  console.log('\n9. Protocolo dlvimg:// — seguridad (traversal / keys / locales):');
  await check('resuelve una key válida registrada', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    const r = await svc.resolveProtocolPath('40508022', key);
    assert.ok(r.path.endsWith(key));
    assert.strictEqual(r.contentType, 'image/png');
  });
  await check('rechaza traversal en la key (..)', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({}) });
    await assert.rejects(svc.resolveProtocolPath('40508022', '../../secret'), (e) => e.code === 'INVALID_KEY');
    await assert.rejects(svc.resolveProtocolPath('40508022', 'a/b'), (e) => e.code === 'INVALID_KEY');
  });
  await check('rechaza localId inválido (traversal en carpeta)', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({}) });
    await assert.rejects(svc.resolveProtocolPath('..\\..\\x', 'a'.repeat(40)), (e) => e.code === 'INVALID_LOCAL');
  });
  await check('rechaza key con formato válido pero NO registrada en el manifiesto', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({}) });
    await fsp.mkdir(path.join(root, '40508022'), { recursive: true });
    await assert.rejects(svc.resolveProtocolPath('40508022', 'b'.repeat(40)), (e) => e.code === 'UNKNOWN_KEY');
  });

  console.log('\n10. Manifiesto: escritura atómica y concurrencia:');
  await check('dos escrituras simultáneas del manifiesto no lo corrompen', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({
      'https://fb/1': { status: 200, buffer: PNG, contentType: 'image/png' },
      'https://fb/2': { status: 200, buffer: JPEG, contentType: 'image/jpeg' },
    }) });
    await Promise.all([
      svc.download('40508022', BUCKET, '40508022/articulos/uno.png', { url: 'https://fb/1', remoteMeta: { generation: '1' } }),
      svc.download('40508022', BUCKET, '40508022/articulos/dos.png', { url: 'https://fb/2', remoteMeta: { generation: '1' } }),
    ]);
    const manifest = JSON.parse(await fsp.readFile(path.join(root, '40508022', 'manifest.json'), 'utf8'));
    assert.strictEqual(Object.keys(manifest).length, 2, 'ambas entradas presentes, manifiesto íntegro');
  });
  await check('manifiesto corrupto se respalda y se reinicia (recuperación)', async () => {
    const root = mkTmpRoot();
    const dir = path.join(root, '40508022');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'manifest.json'), '{ esto no es json válido ');
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    // No debe lanzar: se recupera con manifiesto vacío
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ);
    assert.strictEqual(local.cached, false);
    const backups = (await fsp.readdir(dir)).filter((f) => f.includes('corrupt'));
    assert.ok(backups.length >= 1, 'debe existir un respaldo del manifiesto corrupto');
  });

  console.log('\n11. Archivo local faltante aunque figure en el manifiesto:');
  await check('resolveLocal devuelve cached=false si el archivo no está en disco', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    await fsp.unlink(path.join(root, '40508022', key)); // se borra el archivo, queda la entrada
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ);
    assert.strictEqual(local.cached, false);
    assert.ok(local.entry, 'la entrada del manifiesto sigue disponible para recuperar metadata');
  });

  console.log('\n12. sweepOrphans — nunca borra con catálogo incompleto:');
  await check('catalogComplete=false => no borra NADA', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    const r = await svc.sweepOrphans('40508022', new Set(), { catalogComplete: false });
    assert.strictEqual(r.skipped, true);
    assert.ok(fs.existsSync(path.join(root, '40508022', key)), 'no debe borrar con catálogo incompleto');
  });
  await check('huérfano dentro del período de gracia NO se borra', async () => {
    const root = mkTmpRoot();
    let clock = 1_000_000;
    const svc = createImageCacheService({ root, now: () => clock, orphanGraceMs: 10_000, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    clock += 5_000; // menos que la gracia
    const r = await svc.sweepOrphans('40508022', new Set(['otra-key']), { catalogComplete: true });
    assert.strictEqual(r.deleted, 0);
    assert.ok(fs.existsSync(path.join(root, '40508022', key)));
  });
  await check('huérfano fuera de gracia SÍ se borra; el catálogo válido se conserva', async () => {
    const root = mkTmpRoot();
    let clock = 1_000_000;
    const svc = createImageCacheService({ root, now: () => clock, orphanGraceMs: 10_000, httpGet: makeHttpGet({
      'https://fb/keep': { status: 200, buffer: PNG, contentType: 'image/png' },
      'https://fb/orphan': { status: 200, buffer: JPEG, contentType: 'image/jpeg' },
    }) });
    const keepKey = makeStableKey(BUCKET, '40508022/articulos/keep.png');
    const orphanKey = makeStableKey(BUCKET, '40508022/articulos/orphan.png');
    await svc.download('40508022', BUCKET, '40508022/articulos/keep.png', { url: 'https://fb/keep', remoteMeta: { generation: '1' } });
    await svc.download('40508022', BUCKET, '40508022/articulos/orphan.png', { url: 'https://fb/orphan', remoteMeta: { generation: '1' } });
    clock += 20_000; // supera la gracia
    const r = await svc.sweepOrphans('40508022', new Set([keepKey]), { catalogComplete: true });
    assert.strictEqual(r.deleted, 1);
    assert.ok(fs.existsSync(path.join(root, '40508022', keepKey)), 'el válido se conserva');
    assert.ok(!fs.existsSync(path.join(root, '40508022', orphanKey)), 'el huérfano se borró');
  });
  await check('sweepOrphans limpia archivos .part sueltos y no toca otros locales', async () => {
    const root = mkTmpRoot();
    let clock = 1_000_000;
    const svc = createImageCacheService({ root, now: () => clock, orphanGraceMs: 10_000, httpGet: makeHttpGet({ 'https://fb/x': { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    await svc.download('40508022', BUCKET, OBJ, { url: 'https://fb/x', remoteMeta: { generation: '1' } });
    // Local vecino intacto
    await svc.download('99999999', BUCKET, OBJ, { url: 'https://fb/x', remoteMeta: { generation: '1' } });
    const dir = path.join(root, '40508022');
    await fsp.writeFile(path.join(dir, 'algo.part'), 'incompleto');
    const otherKey = makeStableKey(BUCKET, OBJ);
    clock += 20_000;
    await svc.sweepOrphans('40508022', new Set([makeStableKey(BUCKET, OBJ)]), { catalogComplete: true });
    assert.ok(!fs.existsSync(path.join(dir, 'algo.part')), '.part suelto borrado');
    assert.ok(fs.existsSync(path.join(root, '99999999', otherKey)), 'el otro local no se toca');
  });

  console.log('\n13. Intervalo mínimo entre chequeos de metadata (shouldCheckMetadata):');
  await check('no re-chequea dentro del intervalo; sí lo hace pasado el intervalo o con force', async () => {
    const root = mkTmpRoot();
    let clock = 1_000_000;
    const svc = createImageCacheService({ root, now: () => clock, minCheckIntervalMs: 60_000, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ);
    assert.strictEqual(svc.shouldCheckMetadata(local.entry), false, 'recién descargado: no chequear');
    assert.strictEqual(svc.shouldCheckMetadata(local.entry, { force: true }), true, 'force ignora el intervalo');
    clock += 61_000;
    assert.strictEqual(svc.shouldCheckMetadata(local.entry), true, 'pasado el intervalo: sí chequear');
    assert.strictEqual(svc.shouldCheckMetadata(null), true, 'sin entrada: siempre chequear');
  });

  console.log('\n14. Artículo sin foto / ruta problemática Windows:');
  await check('objectPath con caracteres se normaliza sin romper la key', () => {
    const k = makeStableKey(BUCKET, '40508022/articulos/año & café (1).png');
    assert.match(k, /^[a-f0-9]{40}$/);
  });

  console.log('\n15. URL versionada (?v=) — cambio visual al reemplazar bytes:');
  await check('primera descarga da ?v=g100; nueva generation da ?v=g101 (src diferente)', async () => {
    const root = mkTmpRoot();
    const URL_100 = 'https://firebasestorage.googleapis.com/v0/b/proj-a.appspot.com/o/40508022%2Farticulos%2Fa.png?token=t1';
    const URL_101 = 'https://firebasestorage.googleapis.com/v0/b/proj-a.appspot.com/o/40508022%2Farticulos%2Fa.png?token=t2';
    const OBJ2 = '40508022/articulos/a.png';
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({
      [URL_100]: { status: 200, buffer: PNG, contentType: 'image/png' },
      [URL_101]: { status: 200, buffer: JPEG_V2, contentType: 'image/jpeg' },
    }) });
    const r100 = await svc.download('40508022', BUCKET, OBJ2, { url: URL_100, remoteMeta: { generation: '100' } });
    assert.ok(r100.protocolUrl.endsWith('?v=g100'), `esperaba ?v=g100, fue ${r100.protocolUrl}`);
    const local = await svc.resolveLocal('40508022', BUCKET, OBJ2);
    assert.ok(local.protocolUrl.endsWith('?v=g100'));
    const r101 = await svc.download('40508022', BUCKET, OBJ2, { url: URL_101, remoteMeta: { generation: '101' } });
    assert.ok(r101.protocolUrl.endsWith('?v=g101'), `esperaba ?v=g101, fue ${r101.protocolUrl}`);
    assert.notStrictEqual(r100.protocolUrl, r101.protocolUrl, 'el src debe cambiar');
  });
  await check('versionTag prioriza generation, luego md5, luego size', () => {
    assert.strictEqual(versionTag({ generation: '77' }), 'g77');
    assert.ok(versionTag({ md5Hash: 'abc' }).startsWith('m'));
    assert.strictEqual(versionTag({ size: 123 }), 's123');
    assert.strictEqual(versionTag(null), '0');
  });

  console.log('\n16. Validación de URL de descarga (anti descargador arbitrario):');
  const OBJ_URL = '40508022/articulos/a.png';
  const GOOD = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(OBJ_URL)}?alt=media&token=x`;
  await check('acepta una URL de Firebase legítima con bucket+objectPath coincidentes', () => {
    assert.strictEqual(validateDownloadUrl(GOOD, { bucket: BUCKET, objectPath: OBJ_URL }).ok, true);
  });
  await check('rechaza http://localhost', () => {
    assert.strictEqual(validateDownloadUrl('http://localhost/x', {}).code, 'URL_NOT_HTTPS');
  });
  await check('rechaza https://localhost (host local aunque sea https)', () => {
    assert.strictEqual(validateDownloadUrl('https://localhost/x', {}).code, 'URL_LOCAL_OR_PRIVATE');
  });
  await check('rechaza https://127.0.0.1', () => {
    assert.strictEqual(validateDownloadUrl('https://127.0.0.1/x', {}).code, 'URL_LOCAL_OR_PRIVATE');
  });
  await check('rechaza IP privada 192.168.x', () => {
    assert.strictEqual(validateDownloadUrl('https://192.168.1.5/x', {}).code, 'URL_LOCAL_OR_PRIVATE');
  });
  await check('rechaza dominio externo', () => {
    assert.strictEqual(validateDownloadUrl('https://evil.example.com/v0/b/x/o/y', {}).code, 'URL_HOST_NOT_ALLOWED');
  });
  await check('rechaza URL Firebase cuyo objectPath NO coincide con el declarado', () => {
    assert.strictEqual(validateDownloadUrl(GOOD, { bucket: BUCKET, objectPath: '40508022/articulos/OTRO.png' }).code, 'URL_OBJECT_MISMATCH');
  });
  await check('rechaza URL Firebase cuyo bucket NO coincide', () => {
    assert.strictEqual(validateDownloadUrl(GOOD, { bucket: 'otro-bucket.appspot.com', objectPath: OBJ_URL }).code, 'URL_BUCKET_MISMATCH');
  });
  await check('rechaza protocolo file:', () => {
    assert.strictEqual(validateDownloadUrl('file:///etc/passwd', {}).code, 'URL_NOT_HTTPS');
  });
  await check('isPrivateOrLocalHost detecta rangos privados y loopback', () => {
    assert.ok(isPrivateOrLocalHost('10.0.0.1'));
    assert.ok(isPrivateOrLocalHost('172.16.0.1'));
    assert.ok(isPrivateOrLocalHost('::1'));
    assert.ok(!isPrivateOrLocalHost('firebasestorage.googleapis.com'));
  });
  await check('assertRedirectAllowed rechaza redirect a host no permitido y a no-https', () => {
    assert.throws(() => assertRedirectAllowed('https://evil.example.com/x', GOOD), (e) => e.code === 'REDIRECT_HOST_NOT_ALLOWED');
    assert.throws(() => assertRedirectAllowed('http://firebasestorage.googleapis.com/x', GOOD), (e) => e.code === 'REDIRECT_NOT_HTTPS');
    // Redirect legítimo dentro de hosts permitidos: no lanza.
    assert.doesNotThrow(() => assertRedirectAllowed('https://storage.googleapis.com/x', GOOD));
  });
  await check('download() rechaza una URL no permitida SIN pedirla (httpGet no se llama)', async () => {
    const root = mkTmpRoot();
    let hits = 0;
    const svc = createImageCacheService({ root, httpGet: async () => { hits++; return { status: 200, buffer: PNG, contentType: 'image/png' }; } });
    await assert.rejects(
      svc.download('40508022', BUCKET, OBJ_URL, { url: 'https://127.0.0.1/x' }),
      (e) => e.code === 'URL_LOCAL_OR_PRIVATE'
    );
    assert.strictEqual(hits, 0, 'no debe intentar la descarga de una URL rechazada');
  });

  console.log('\n17. Archivo local manipulado externamente (verificación al servir):');
  await check('rechaza servir si el tamaño en disco NO coincide con el manifiesto', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1', size: PNG.length } });
    // Manipular el archivo en disco (agregar bytes) → tamaño incoherente.
    await fsp.appendFile(path.join(root, '40508022', key), Buffer.from([9, 9, 9, 9]));
    await assert.rejects(svc.resolveProtocolPath('40508022', key), (e) => e.code === 'SIZE_MISMATCH');
  });
  await check('rechaza servir si el archivo fue borrado externamente', async () => {
    const root = mkTmpRoot();
    const svc = createImageCacheService({ root, httpGet: makeHttpGet({ [URL_A]: { status: 200, buffer: PNG, contentType: 'image/png' } }) });
    const key = makeStableKey(BUCKET, OBJ);
    await svc.download('40508022', BUCKET, OBJ, { url: URL_A, remoteMeta: { generation: '1' } });
    await fsp.unlink(path.join(root, '40508022', key));
    await assert.rejects(svc.resolveProtocolPath('40508022', key), (e) => e.code === 'FILE_MISSING');
  });

  console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
})();
