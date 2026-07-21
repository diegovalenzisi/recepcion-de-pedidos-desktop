// ---------------------------------------------------------------------------
// Controlador de resolución de imágenes (renderer) — SIN imports de firebase,
// window ni assets. Toda dependencia externa se inyecta, así se puede testear
// con node:assert. articleImageCache.js crea la instancia real con las deps
// concretas (SDK de Storage, window.electronAPI, core, placeholder).
//
// Implementa la lógica stale-while-revalidate, el throttle por imagen, la
// deduplicación global (hook + preload + miniaturas + montajes simultáneos), el
// throttle de warm-up por local, y la decisión de "cambió la versión".
// ---------------------------------------------------------------------------

export const memId = (localId, bucket, objectPath) => `${localId}::${bucket}::${objectPath}`;

/** Compara versión local vs remota. Prioridad generation → md5 → size/updated. */
export function decideChanged(entry, remoteMeta) {
  if (!remoteMeta) return false;         // offline / sin metadata: NO invalida
  if (!entry) return true;
  if (remoteMeta.generation != null && entry.generation != null) return String(remoteMeta.generation) !== String(entry.generation);
  if (remoteMeta.md5Hash && entry.md5Hash) return remoteMeta.md5Hash !== entry.md5Hash;
  if (remoteMeta.size != null && entry.size != null) return String(remoteMeta.size) !== String(entry.size);
  if (remoteMeta.updated && entry.updated) return remoteMeta.updated !== entry.updated;
  return false;
}

export function createArticleImageController(deps) {
  const {
    api,                       // { resolveLocal, shouldCheck, recordCheck, download }
    fetchRemoteMetadata,       // (bucket, objectPath) => Promise<meta|null>
    fetchFreshDownloadUrl,     // (bucket, objectPath) => Promise<url|null>
    isReady = () => true,
    isSwitching = () => false,
    now = () => Date.now(),
    minCheckIntervalMs = 15 * 60 * 1000,
    debug = () => {},
  } = deps;

  const resultCache = new Map();  // memId → { src, entry, checkedAt }
  const inflight = new Map();     // memId → Promise
  const lastWarmAt = new Map();   // localId → ts (throttle del warm-up, requisito 10)

  async function downloadWithRefresh(localId, bucket, objectPath, url, remoteMeta) {
    let res = await api.download({ localId, bucket, objectPath, url, remoteMeta });
    if (!res.ok && res.code === 'URL_EXPIRED') {              // requisito 8: un solo reintento
      const fresh = await fetchFreshDownloadUrl(bucket, objectPath);
      if (fresh) res = await api.download({ localId, bucket, objectPath, url: fresh, remoteMeta });
    }
    return res;
  }

  // Orquestación por identidad, deduplicada globalmente por memId.
  function orchestrate(localId, identity, { force = false, emit = () => {} } = {}) {
    const { bucket, objectPath, url } = identity;
    const id = memId(localId, bucket, objectPath);
    if (inflight.has(id)) return inflight.get(id);

    const job = (async () => {
      try {
        if (isSwitching() || !isReady()) return;
        const local = await api.resolveLocal({ localId, bucket, objectPath });
        if (!local || !local.ok) return;

        if (local.cached && local.protocolUrl) {
          const prev = resultCache.get(id);
          resultCache.set(id, { src: local.protocolUrl, entry: local.entry, checkedAt: (prev && prev.checkedAt) || 0 });
          debug('CACHE_HIT', { objectPath });
          emit(local.protocolUrl);
        } else {
          const remoteMeta = await fetchRemoteMetadata(bucket, objectPath);
          debug('DOWNLOAD_START', { objectPath });
          const dl = await downloadWithRefresh(localId, bucket, objectPath, url, remoteMeta || undefined);
          if (dl && dl.ok && dl.protocolUrl) {
            resultCache.set(id, { src: dl.protocolUrl, entry: remoteMeta, checkedAt: now() });
            debug('DOWNLOAD_OK', { objectPath });
            emit(dl.protocolUrl);
            return; // recién descargada: no revalidar
          }
          debug('DOWNLOAD_FAILED_KEEPING_OLD', { objectPath, code: dl && dl.code });
        }

        // Revalidación throttled: ¿cambió en Firebase?
        const cached = resultCache.get(id);
        const withinInterval = !force && cached && cached.checkedAt && (now() - cached.checkedAt) < minCheckIntervalMs;
        if (withinInterval) return;

        const chk = await api.shouldCheck({ entry: local.entry, force });
        if (!(chk.ok && chk.should)) return;

        debug('METADATA_CHECK', { objectPath });
        const remoteMeta = await fetchRemoteMetadata(bucket, objectPath);
        if (!remoteMeta) return; // offline: conservar local

        if (decideChanged(local.entry, remoteMeta)) {
          debug('IMAGE_VERSION_CHANGED', { objectPath });
          const dl = await downloadWithRefresh(localId, bucket, objectPath, url, remoteMeta);
          if (dl && dl.ok && dl.protocolUrl) {
            resultCache.set(id, { src: dl.protocolUrl, entry: remoteMeta, checkedAt: now() });
            debug('DOWNLOAD_OK', { objectPath });
            emit(dl.protocolUrl);
          } else {
            debug('DOWNLOAD_FAILED_KEEPING_OLD', { objectPath, code: dl && dl.code });
          }
        } else {
          const freshUrl = await fetchFreshDownloadUrl(bucket, objectPath);
          await api.recordCheck({ localId, bucket, objectPath, remoteMeta, downloadUrl: freshUrl });
          const prev = resultCache.get(id) || {};
          resultCache.set(id, { ...prev, checkedAt: now() });
          debug('CACHE_STALE', { objectPath, changed: false });
        }
      } catch {
        // Silencioso: un fallo de imagen NUNCA bloquea la app.
      } finally {
        inflight.delete(id);
      }
    })();

    inflight.set(id, job);
    return job;
  }

  // Valor inmediato conocido (síncrono) para el primer render.
  function immediateSrc(localId, identity) {
    const id = memId(localId, identity.bucket, identity.objectPath);
    const cached = resultCache.get(id);
    return (cached && cached.src) || identity.url;
  }

  // Warm-up con concurrencia limitada y throttle POR LOCAL (requisito 10): si se
  // precalentó hace menos del intervalo, no vuelve a consultar cientos de metadatos.
  async function warm(localId, identities, { concurrency = 4 } = {}) {
    const last = lastWarmAt.get(localId) || 0;
    if ((now() - last) < minCheckIntervalMs) return { skipped: true, reason: 'throttled' };
    lastWarmAt.set(localId, now());
    let idx = 0;
    const worker = async () => {
      while (idx < identities.length) {
        const identity = identities[idx++];
        try { await orchestrate(localId, identity, { force: false, emit: () => {} }); } catch { /* nunca bloquear */ }
      }
    };
    const n = Math.max(1, Math.min(concurrency, identities.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return { skipped: false, count: identities.length };
  }

  return { orchestrate, immediateSrc, warm, resultCache, inflight, lastWarmAt };
}
