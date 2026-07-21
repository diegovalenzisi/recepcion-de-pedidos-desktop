// Prueba del CONTROLADOR del renderer (articleImageController.js) con
// dependencias inyectadas (api IPC + metadata fake), sin firebase ni window.
// Demuestra el requisito 1 a nivel renderer: la resolución pasa de ?v=g100 a
// ?v=g101 cuando Firebase informa una generation nueva, y el src final difiere.
//
// Correr con: node src/lib/cache/__tests__/articleImageController.test.js
import assert from 'node:assert';
import { createArticleImageController, decideChanged } from '../articleImageController.js';

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.stack ? e.stack : e}`); process.exitCode = 1; }
}

const IDENTITY = {
  kind: 'firebase',
  bucket: 'proj-a.appspot.com',
  objectPath: '40508022/articulos/a.png',
  url: 'https://firebasestorage.googleapis.com/v0/b/proj-a.appspot.com/o/40508022%2Farticulos%2Fa.png?token=t1',
};

console.log('decideChanged:');
await check('generation 100 vs 101 => cambió', () => {
  assert.strictEqual(decideChanged({ generation: '100' }, { generation: '101' }), true);
});
await check('generation igual, token distinto => NO cambió', () => {
  assert.strictEqual(decideChanged({ generation: '100' }, { generation: '100' }), false);
});
await check('metadata remota null (offline) => NO cambió', () => {
  assert.strictEqual(decideChanged({ generation: '100' }, null), false);
});

console.log('\nTransición ?v=g100 → ?v=g101 (imagen reemplazada en Firebase):');
await check('primera resolución emite ?v=g100; tras generation 101 emite ?v=g101 (src distinto)', async () => {
  const KEY = 'a'.repeat(40);
  let remoteGen = '100';
  const api = {
    resolveLocal: async () => ({ ok: true, key: KEY, cached: true, protocolUrl: `dlvimg://L/${KEY}?v=g100`, entry: { generation: '100', md5Hash: 'm' } }),
    shouldCheck: async () => ({ ok: true, should: true }),
    recordCheck: async () => ({ ok: true }),
    download: async () => ({ ok: true, protocolUrl: `dlvimg://L/${KEY}?v=g${remoteGen}` }),
  };
  const emitted = [];
  const ctrl = createArticleImageController({
    api,
    fetchRemoteMetadata: async () => ({ generation: remoteGen }),
    fetchFreshDownloadUrl: async () => 'https://firebasestorage.googleapis.com/v0/b/proj-a.appspot.com/o/40508022%2Farticulos%2Fa.png?token=fresh',
    now: () => Date.now(),
  });

  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.ok(emitted.includes(`dlvimg://L/${KEY}?v=g100`), `esperaba ?v=g100, fue ${JSON.stringify(emitted)}`);

  remoteGen = '101';
  emitted.length = 0;
  await ctrl.orchestrate('L', IDENTITY, { force: true, emit: (s) => emitted.push(s) });
  assert.ok(emitted.includes(`dlvimg://L/${KEY}?v=g101`), `esperaba ?v=g101, fue ${JSON.stringify(emitted)}`);
  assert.notStrictEqual(`dlvimg://L/${KEY}?v=g100`, `dlvimg://L/${KEY}?v=g101`);
});

console.log('\nDedupe global + throttle de warm-up:');
await check('dos orchestrate simultáneos de la misma identidad = una sola resolución en vuelo', async () => {
  const KEY = 'b'.repeat(40);
  let resolveGate; const gate = new Promise((r) => { resolveGate = r; });
  let resolveLocalCalls = 0;
  const api = {
    resolveLocal: async () => { resolveLocalCalls++; await gate; return { ok: true, key: KEY, cached: true, protocolUrl: `dlvimg://L/${KEY}?v=g1`, entry: { generation: '1' } }; },
    shouldCheck: async () => ({ ok: true, should: false }),
    recordCheck: async () => ({ ok: true }),
    download: async () => ({ ok: true, protocolUrl: `dlvimg://L/${KEY}?v=g1` }),
  };
  const ctrl = createArticleImageController({ api, fetchRemoteMetadata: async () => null, fetchFreshDownloadUrl: async () => null });
  const p1 = ctrl.orchestrate('L', { ...IDENTITY, objectPath: 'x/b.png' }, {});
  const p2 = ctrl.orchestrate('L', { ...IDENTITY, objectPath: 'x/b.png' }, {});
  assert.strictEqual(p1, p2, 'debe reusar la misma promesa en vuelo');
  resolveGate();
  await Promise.all([p1, p2]);
  assert.strictEqual(resolveLocalCalls, 1, 'una sola resolución real');
});
await check('warm-up throttlea por local: la 2ª llamada dentro del intervalo se saltea', async () => {
  let clock = 1_000_000;
  const api = {
    resolveLocal: async () => ({ ok: true, key: 'c'.repeat(40), cached: true, protocolUrl: 'dlvimg://L/x?v=g1', entry: {} }),
    shouldCheck: async () => ({ ok: true, should: false }),
    recordCheck: async () => ({ ok: true }),
    download: async () => ({ ok: true, protocolUrl: 'dlvimg://L/x?v=g1' }),
  };
  const ctrl = createArticleImageController({ api, fetchRemoteMetadata: async () => null, fetchFreshDownloadUrl: async () => null, now: () => clock, minCheckIntervalMs: 60_000 });
  const ids = [{ kind: 'firebase', bucket: 'x', objectPath: 'a.png', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.png' }];
  const r1 = await ctrl.warm('L', ids, {});
  assert.strictEqual(r1.skipped, false);
  clock += 30_000;
  const r2 = await ctrl.warm('L', ids, {});
  assert.strictEqual(r2.skipped, true, 'debe saltear el warm-up repetido dentro del intervalo');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
