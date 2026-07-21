// ---------------------------------------------------------------------------
// Módulo RENDERER reutilizable para imágenes de artículos con caché local.
//
// Orquesta el caché de disco (proceso principal, vía window.electronAPI.imageCache)
// con el SDK de Firebase Storage (getMetadata / getDownloadURL, solo disponibles
// en el renderer). Estrategia: stale-while-revalidate.
//
//   1. resolveLocal (IPC) → si hay copia local, se muestra YA.
//   2. En segundo plano, con throttle por imagen, se comprueban metadatos
//      (getMetadata: un request minúsculo, no la imagen entera).
//   3. Solo si generation/md5/size cambió realmente se descarga la versión nueva
//      (en el main, atómica) y se avisa a la vista.
//   4. Si Firebase no responde, se conserva la copia local (offline no invalida).
//
// El renderer nunca recibe rutas físicas: solo URLs dlvimg://... o el placeholder.
// ---------------------------------------------------------------------------

import { getStorage, ref as storageRef, getMetadata, getDownloadURL } from 'firebase/storage';
import { getFirebaseApp, getLocalId, isFirebaseReady, isFirebaseSwitching } from '@/lib/firebase/core';
import placeholderUrl from '@/assets/article-placeholder.svg';

export const ARTICLE_IMAGE_PLACEHOLDER = placeholderUrl;

const MIN_CHECK_INTERVAL_MS = 15 * 60 * 1000; // intervalo mínimo entre getMetadata por imagen

// Caché en memoria del resultado ya resuelto, para no re-consultar en cada
// render. Clave SÍNCRONA = `${localId}::${bucket}::${objectPath}` (nunca el token).
const resultCache = new Map();
// Dedupe de resoluciones/revalidaciones en vuelo por la misma clave síncrona.
const inflight = new Map();

const hasImageCacheIPC = () =>
  typeof window !== 'undefined' && window.electronAPI && window.electronAPI.imageCache;

const memId = (localId, bucket, objectPath) => `${localId}::${bucket}::${objectPath}`;

/**
 * Clasifica el campo `foto` de un artículo en una identidad estable.
 * NUNCA usa la URL con token como identidad: extrae bucket + objectPath.
 */
export function parseArticleImage(foto) {
  if (!foto || typeof foto !== 'string') return { kind: 'none' };
  const t = foto.trim();
  if (!t) return { kind: 'none' };
  if (t.startsWith('data:')) return { kind: 'data', url: t };                  // Base64 histórico
  if (/(^|\.)via\.placeholder\.com/i.test(t)) return { kind: 'placeholder' };   // placeholder viejo
  try {
    const u = new URL(t);
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const m = u.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (m) {
        return { kind: 'firebase', bucket: decodeURIComponent(m[1]), objectPath: decodeURIComponent(m[2]), url: t };
      }
    }
    return { kind: 'external', url: t };
  } catch {
    return { kind: 'external', url: t };
  }
}

function storageRefFor(bucket, objectPath) {
  const app = getFirebaseApp();
  if (!app) return null;
  // gs://bucket/path para respetar EXACTAMENTE el bucket de la URL.
  return storageRef(getStorage(app), `gs://${bucket}/${objectPath}`);
}

async function fetchRemoteMetadata(bucket, objectPath) {
  try {
    const r = storageRefFor(bucket, objectPath);
    if (!r) return null;
    const md = await getMetadata(r);
    return { generation: md.generation, md5Hash: md.md5Hash, updated: md.updated, size: md.size, contentType: md.contentType };
  } catch {
    return null; // requisito 1: fallo de getMetadata NO invalida el caché
  }
}

async function fetchFreshDownloadUrl(bucket, objectPath) {
  try {
    const r = storageRefFor(bucket, objectPath);
    return r ? await getDownloadURL(r) : null;
  } catch {
    return null;
  }
}

/** Descarga en el main con reintento único ante 401/403 (requisito 8, sin bucle). */
async function downloadViaMain(localId, bucket, objectPath, url, remoteMeta) {
  const api = window.electronAPI.imageCache;
  let res = await api.download({ localId, bucket, objectPath, url, remoteMeta });
  if (!res.ok && res.code === 'URL_EXPIRED') {
    const fresh = await fetchFreshDownloadUrl(bucket, objectPath);
    if (fresh) res = await api.download({ localId, bucket, objectPath, url: fresh, remoteMeta });
  }
  return res;
}

function safeSwitching() { try { return isFirebaseSwitching(); } catch { return false; } }
function safeReady() { try { return isFirebaseReady(); } catch { return true; } }

/** Compara versión local vs remota. Prioridad generation → md5 → size/updated. */
function decideChanged(entry, remoteMeta) {
  if (!remoteMeta) return false;
  if (!entry) return true;
  if (remoteMeta.generation != null && entry.generation != null) return String(remoteMeta.generation) !== String(entry.generation);
  if (remoteMeta.md5Hash && entry.md5Hash) return remoteMeta.md5Hash !== entry.md5Hash;
  if (remoteMeta.size != null && entry.size != null) return String(remoteMeta.size) !== String(entry.size);
  if (remoteMeta.updated && entry.updated) return remoteMeta.updated !== entry.updated;
  return false;
}

// Orquestación async central por identidad, deduplicada.
async function orchestrate(localId, identity, { force, emit }) {
  const { bucket, objectPath, url } = identity;
  const id = memId(localId, bucket, objectPath);
  if (inflight.has(id)) return inflight.get(id);

  const job = (async () => {
    try {
      if (safeSwitching() || !safeReady()) return;
      const api = window.electronAPI.imageCache;
      const local = await api.resolveLocal({ localId, bucket, objectPath });
      if (!local || !local.ok) return;

      if (local.cached && local.protocolUrl) {
        // Mostrar la copia local YA.
        const prev = resultCache.get(id);
        resultCache.set(id, { src: local.protocolUrl, entry: local.entry, checkedAt: (prev && prev.checkedAt) || 0 });
        emit(local.protocolUrl);
      } else {
        // Sin copia local: bajarla (la vista sigue con la URL remota mientras tanto).
        const remoteMeta = await fetchRemoteMetadata(bucket, objectPath);
        const dl = await downloadViaMain(localId, bucket, objectPath, url, remoteMeta || undefined);
        if (dl && dl.ok && dl.protocolUrl) {
          resultCache.set(id, { src: dl.protocolUrl, entry: remoteMeta, checkedAt: Date.now() });
          emit(dl.protocolUrl);
          return; // recién descargada: no revalidar de nuevo
        }
      }

      // Revalidación throttled: ¿cambió en Firebase?
      const cached = resultCache.get(id);
      const withinInterval = !force && cached && cached.checkedAt && (Date.now() - cached.checkedAt) < MIN_CHECK_INTERVAL_MS;
      if (withinInterval) return;

      const chk = await api.shouldCheck({ entry: local.entry, force });
      if (!(chk.ok && chk.should)) return;

      const remoteMeta = await fetchRemoteMetadata(bucket, objectPath);
      if (!remoteMeta) return; // offline: conservar local

      if (decideChanged(local.entry, remoteMeta)) {
        const dl = await downloadViaMain(localId, bucket, objectPath, url, remoteMeta);
        if (dl && dl.ok && dl.protocolUrl) {
          resultCache.set(id, { src: dl.protocolUrl, entry: remoteMeta, checkedAt: Date.now() });
          emit(dl.protocolUrl);
        }
      } else {
        const freshUrl = await fetchFreshDownloadUrl(bucket, objectPath);
        await api.recordCheck({ localId, bucket, objectPath, remoteMeta, downloadUrl: freshUrl });
        const prev = resultCache.get(id) || {};
        resultCache.set(id, { ...prev, checkedAt: Date.now() });
      }
    } catch {
      // Silencioso: un fallo de imagen NUNCA bloquea la app ni el catálogo.
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, job);
  return job;
}

/**
 * Punto de entrada del hook. Devuelve SIEMPRE de inmediato el mejor `src`
 * conocido y, para imágenes de Firebase, dispara la orquestación async que
 * llama a onUpdate(newSrc) cuando hay una copia local/nueva lista.
 *
 * @returns {{ src: string, isPlaceholder: boolean, firebase: boolean }}
 */
export function resolveArticleImage(identity, { localId, force = false, onUpdate } = {}) {
  if (identity.kind === 'none' || identity.kind === 'placeholder') {
    return { src: ARTICLE_IMAGE_PLACEHOLDER, isPlaceholder: true, firebase: false };
  }
  if (identity.kind === 'data' || identity.kind === 'external') {
    return { src: identity.url, isPlaceholder: false, firebase: false };
  }
  if (!hasImageCacheIPC() || !localId) {
    // Sin IPC (dev en navegador): comportamiento actual (URL remota directa).
    return { src: identity.url, isPlaceholder: false, firebase: false };
  }

  const id = memId(localId, identity.bucket, identity.objectPath);
  const cached = resultCache.get(id);
  const immediateSrc = (cached && cached.src) || identity.url; // local si ya se resolvió, si no remoto

  if (typeof onUpdate === 'function') {
    orchestrate(localId, identity, { force, emit: onUpdate });
  }
  return { src: immediateSrc, isPlaceholder: false, firebase: true };
}

/**
 * Precalienta el caché de un catálogo con CONCURRENCIA LIMITADA (requisito 20):
 * no dispara metadata+descargas de todo el catálogo a la vez. Las tarjetas
 * visibles, al montarse, resuelven por su cuenta y se deduplican con esto.
 */
export async function warmArticleImages(articles, { concurrency = 4 } = {}) {
  if (!hasImageCacheIPC()) return;
  const localId = getLocalId();
  if (!localId || !Array.isArray(articles)) return;
  const identities = articles
    .map((a) => parseArticleImage(a && a.foto))
    .filter((i) => i.kind === 'firebase');
  let idx = 0;
  const worker = async () => {
    while (idx < identities.length) {
      const identity = identities[idx++];
      try { await orchestrate(localId, identity, { force: false, emit: () => {} }); } catch { /* nunca bloquear */ }
    }
  };
  const n = Math.max(1, Math.min(concurrency, identities.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * Limpieza central de huérfanos — se llama UNA vez tras cargar el catálogo
 * COMPLETO y confirmado del local (requisito 16/17). Nunca por artículo/render.
 * Envía las referencias (bucket+objectPath) y el main calcula las keys.
 */
export async function sweepArticleImageOrphans(articles) {
  if (!hasImageCacheIPC()) return { skipped: true };
  const localId = getLocalId();
  if (!localId || !Array.isArray(articles) || articles.length === 0) {
    return { skipped: true, reason: 'no-catalog' }; // catálogo vacío/incompleto: no borrar
  }
  const validRefs = [];
  for (const a of articles) {
    const idn = parseArticleImage(a && a.foto);
    if (idn.kind === 'firebase') validRefs.push({ bucket: idn.bucket, objectPath: idn.objectPath });
  }
  try {
    return await window.electronAPI.imageCache.sweep({ localId, validRefs, catalogComplete: true });
  } catch {
    return { skipped: true, reason: 'ipc-error' };
  }
}
