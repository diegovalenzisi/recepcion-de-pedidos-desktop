// Prueba del CONTROLADOR del renderer (articleImageController.js) con
// dependencias inyectadas (api IPC + metadata fake), sin firebase ni window.
// Cubre: transición de versión (?v=), clasificación de metadata (ok/deleted/keep),
// reintento 401 sin bucle, objeto recreado, y decideSweep (catálogo vacío válido).
//
// Correr con: node src/lib/cache/__tests__/articleImageController.test.js
import assert from 'node:assert';
import { createArticleImageController, decideChanged, decideSweep } from '../articleImageController.js';

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.stack ? e.stack : e}`); process.exitCode = 1; }
}

const PLACEHOLDER = 'PLACEHOLDER.svg';
const IDENTITY = {
  kind: 'firebase',
  bucket: 'proj-a.appspot.com',
  objectPath: '40508022/articulos/a.png',
  url: 'https://firebasestorage.googleapis.com/v0/b/proj-a.appspot.com/o/40508022%2Farticulos%2Fa.png?token=t1',
};
// api base con spies; se sobreescribe por test.
function baseApi(over = {}) {
  return {
    resolveLocal: async () => ({ ok: true, cached: false, entry: null }),
    shouldCheck: async () => ({ ok: true, should: true }),
    recordCheck: async () => ({ ok: true }),
    markRemoteDeleted: async () => ({ ok: true }),
    download: async () => ({ ok: true, protocolUrl: 'dlvimg://L/x?v=g1' }),
    ...over,
  };
}

console.log('decideChanged:');
await check('generation 100 vs 101 => cambió', () => assert.strictEqual(decideChanged({ generation: '100' }, { generation: '101' }), true));
await check('generation igual => NO cambió', () => assert.strictEqual(decideChanged({ generation: '100' }, { generation: '100' }), false));

console.log('\nTransición ?v=g100 → ?v=g101 (imagen reemplazada):');
await check('primera resolución emite ?v=g100; tras generation 101 emite ?v=g101', async () => {
  const KEY = 'a'.repeat(40);
  let remoteGen = '100';
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: true, protocolUrl: `dlvimg://L/${KEY}?v=g100`, entry: { generation: '100' } }),
    download: async () => ({ ok: true, protocolUrl: `dlvimg://L/${KEY}?v=g${remoteGen}` }),
  });
  const emitted = [];
  const ctrl = createArticleImageController({
    api, placeholderSrc: PLACEHOLDER,
    fetchRemoteMetadata: async () => ({ status: 'ok', meta: { generation: remoteGen } }),
    fetchFreshDownloadUrl: async () => 'https://firebasestorage.googleapis.com/v0/b/proj-a.appspot.com/o/x?token=fresh',
  });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.ok(emitted.includes(`dlvimg://L/${KEY}?v=g100`), `esperaba ?v=g100, fue ${JSON.stringify(emitted)}`);
  remoteGen = '101'; emitted.length = 0;
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.ok(emitted.includes(`dlvimg://L/${KEY}?v=g101`), `esperaba ?v=g101, fue ${JSON.stringify(emitted)}`);
});

console.log('\nEliminación remota vs fallo de conexión (metadata clasificada):');
await check('metadata offline (keep) conserva la copia local, NO descarga ni placeholder', async () => {
  let downloads = 0, marked = 0;
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: true, protocolUrl: 'dlvimg://L/K?v=g1', entry: { generation: '1' } }),
    download: async () => { downloads++; return { ok: true, protocolUrl: 'x' }; },
    markRemoteDeleted: async () => { marked++; return { ok: true }; },
  });
  const emitted = [];
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'keep', reason: 'network' }), fetchFreshDownloadUrl: async () => null });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.ok(emitted.includes('dlvimg://L/K?v=g1'), 'debe emitir la copia local');
  assert.ok(!emitted.includes(PLACEHOLDER), 'NO debe mostrar placeholder por estar offline');
  assert.strictEqual(downloads, 0);
  assert.strictEqual(marked, 0);
});
await check('metadata 500 (keep) conserva la copia local', async () => {
  let downloads = 0;
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: true, protocolUrl: 'dlvimg://L/K?v=g1', entry: { generation: '1' } }),
    download: async () => { downloads++; return { ok: true, protocolUrl: 'x' }; },
  });
  const emitted = [];
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'keep', reason: 'storage/retry-limit-exceeded' }), fetchFreshDownloadUrl: async () => null });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.ok(!emitted.includes(PLACEHOLDER));
  assert.strictEqual(downloads, 0);
});
await check('metadata 404 (deleted) invalida la imagen: markRemoteDeleted + placeholder', async () => {
  let marked = 0;
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: true, protocolUrl: 'dlvimg://L/K?v=g1', entry: { generation: '1' } }),
    markRemoteDeleted: async () => { marked++; return { ok: true }; },
  });
  const emitted = [];
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'deleted' }), fetchFreshDownloadUrl: async () => null });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.strictEqual(marked, 1, 'debe marcar la entrada como eliminada');
  assert.strictEqual(emitted[emitted.length - 1], PLACEHOLDER, 'el valor final debe ser el placeholder');
});
await check('401 seguido de URL renovada válida: descarga OK, un solo refresh', async () => {
  let getFresh = 0, dlCalls = 0;
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: false, entry: null }),
    download: async ({ url }) => { dlCalls++; return url && url.includes('fresh') ? { ok: true, protocolUrl: 'dlvimg://L/K?v=g1' } : { ok: false, code: 'URL_EXPIRED' }; },
  });
  const emitted = [];
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'ok', meta: { generation: '1' } }), fetchFreshDownloadUrl: async () => { getFresh++; return 'https://firebasestorage.googleapis.com/v0/b/x/o/y?token=fresh'; } });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.strictEqual(getFresh, 1, 'un solo refresh de URL');
  assert.strictEqual(dlCalls, 2, 'intento inicial + un reintento');
  assert.ok(emitted.includes('dlvimg://L/K?v=g1'));
});
await check('401 seguido de otro 401: NO entra en bucle (un solo refresh, sin emit nuevo)', async () => {
  let getFresh = 0, dlCalls = 0;
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: false, entry: null }),
    download: async () => { dlCalls++; return { ok: false, code: 'URL_EXPIRED' }; },
  });
  const emitted = [];
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'ok', meta: { generation: '1' } }), fetchFreshDownloadUrl: async () => { getFresh++; return 'https://firebasestorage.googleapis.com/v0/b/x/o/y?token=fresh'; } });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.strictEqual(getFresh, 1, 'exactamente un refresh, sin bucle');
  assert.strictEqual(dlCalls, 2, 'inicial + un reintento, y basta');
  assert.strictEqual(emitted.length, 0, 'no hay emisión de una imagen nueva');
});
await check('objeto eliminado y luego recreado en el mismo path: vuelve a descargarse', async () => {
  let dlCalls = 0;
  const api = baseApi({
    resolveLocal: async () => ({ ok: true, cached: false, remoteDeleted: true, entry: { generation: '1', state: 'remote-deleted' } }),
    download: async () => { dlCalls++; return { ok: true, protocolUrl: 'dlvimg://L/K?v=g2' }; },
  });
  const emitted = [];
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'ok', meta: { generation: '2' } }), fetchFreshDownloadUrl: async () => null });
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.strictEqual(emitted[0], PLACEHOLDER, 'primero muestra placeholder (estaba eliminada)');
  assert.strictEqual(dlCalls, 1, 'recreada → re-descarga');
  assert.ok(emitted.includes('dlvimg://L/K?v=g2'), 'emite la copia recreada');
});

console.log('\ndecideSweep (catálogo completo vacío permitido):');
await check('array VACÍO con local coincidente => permite sweep', () => {
  assert.deepStrictEqual(decideSweep({ articles: [], currentLocalId: 'A', expectedLocalId: 'A' }), { allowed: true, reason: 'catalog-complete' });
});
await check('null (estado inicial/parcial/abortado) => NO permite sweep', () => {
  assert.strictEqual(decideSweep({ articles: null, currentLocalId: 'A', expectedLocalId: 'A' }).allowed, false);
  assert.strictEqual(decideSweep({ articles: undefined, currentLocalId: 'A' }).allowed, false);
});
await check('cambio de local durante la carga => cancela el sweep', () => {
  assert.strictEqual(decideSweep({ articles: [], currentLocalId: 'B', expectedLocalId: 'A' }).allowed, false);
  assert.strictEqual(decideSweep({ articles: [], currentLocalId: 'B', expectedLocalId: 'A' }).reason, 'local-changed');
});
await check('sin local activo => no permite sweep', () => {
  assert.strictEqual(decideSweep({ articles: [], currentLocalId: null }).allowed, false);
});

console.log('\nDedupe global + throttle de warm-up:');
await check('dos orchestrate simultáneos de la misma identidad = una sola resolución en vuelo', async () => {
  let resolveGate; const gate = new Promise((r) => { resolveGate = r; });
  let resolveLocalCalls = 0;
  const api = baseApi({
    resolveLocal: async () => { resolveLocalCalls++; await gate; return { ok: true, cached: true, protocolUrl: 'dlvimg://L/b?v=g1', entry: { generation: '1' } }; },
    shouldCheck: async () => ({ ok: true, should: false }),
  });
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'keep' }), fetchFreshDownloadUrl: async () => null });
  const p1 = ctrl.orchestrate('L', { ...IDENTITY, objectPath: 'x/b.png' }, {});
  const p2 = ctrl.orchestrate('L', { ...IDENTITY, objectPath: 'x/b.png' }, {});
  assert.strictEqual(p1, p2, 'misma promesa en vuelo');
  resolveGate();
  await Promise.all([p1, p2]);
  assert.strictEqual(resolveLocalCalls, 1);
});
await check('warm-up throttlea por local: 2ª llamada dentro del intervalo se saltea', async () => {
  let clock = 1_000_000;
  const api = baseApi({ resolveLocal: async () => ({ ok: true, cached: true, protocolUrl: 'dlvimg://L/x?v=g1', entry: {} }), shouldCheck: async () => ({ ok: true, should: false }) });
  const ctrl = createArticleImageController({ api, placeholderSrc: PLACEHOLDER, fetchRemoteMetadata: async () => ({ status: 'keep' }), fetchFreshDownloadUrl: async () => null, now: () => clock, minCheckIntervalMs: 60_000 });
  const ids = [{ kind: 'firebase', bucket: 'x', objectPath: 'a.png', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.png' }];
  assert.strictEqual((await ctrl.warm('L', ids, {})).skipped, false);
  clock += 30_000;
  assert.strictEqual((await ctrl.warm('L', ids, {})).skipped, true);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
