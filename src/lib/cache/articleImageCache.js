// ---------------------------------------------------------------------------
// Wiring RENDERER del caché de imágenes: conecta el controlador puro
// (articleImageController.js) con las dependencias reales — SDK de Firebase
// Storage (getMetadata/getDownloadURL), window.electronAPI.imageCache, core
// (localId/ready/switching) y el placeholder empaquetado.
//
// El renderer nunca recibe rutas físicas: solo URLs dlvimg://...?v=version o el
// placeholder. La URL versionada (?v=) hace que el <img> cambie de src cuando
// cambian los bytes, forzando la recarga.
// ---------------------------------------------------------------------------

import { getStorage, ref as storageRef, getMetadata, getDownloadURL } from 'firebase/storage';
import { getFirebaseApp, getLocalId, isFirebaseReady, isFirebaseSwitching } from '@/lib/firebase/core';
import placeholderUrl from '@/assets/article-placeholder.svg';
import { createArticleImageController } from '@/lib/cache/articleImageController';

export const ARTICLE_IMAGE_PLACEHOLDER = placeholderUrl;

const hasImageCacheIPC = () =>
  typeof window !== 'undefined' && window.electronAPI && window.electronAPI.imageCache;

// Logs de depuración del renderer (requisito 12): apagados salvo que exista
// localStorage['dlv_img_debug']==='1'. No imprimen tokens ni URLs completas.
const debug = (tag, info) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('dlv_img_debug') === '1') {
      console.log(`[imageCache] ${tag}`, info || '');
    }
  } catch { /* noop */ }
};

/**
 * Clasifica el campo `foto` en una identidad estable. NUNCA usa la URL con
 * token como identidad: extrae bucket + objectPath.
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
      if (m) return { kind: 'firebase', bucket: decodeURIComponent(m[1]), objectPath: decodeURIComponent(m[2]), url: t };
    }
    return { kind: 'external', url: t };
  } catch {
    return { kind: 'external', url: t };
  }
}

function storageRefFor(bucket, objectPath) {
  const app = getFirebaseApp();
  if (!app) return null;
  return storageRef(getStorage(app), `gs://${bucket}/${objectPath}`); // respeta el bucket exacto
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

// Controlador único (singleton) del proceso renderer → dedup global entre el
// hook de las tarjetas, el preload y las miniaturas del admin (requisito 10).
const controller = createArticleImageController({
  api: {
    resolveLocal: (p) => window.electronAPI.imageCache.resolveLocal(p),
    shouldCheck: (p) => window.electronAPI.imageCache.shouldCheck(p),
    recordCheck: (p) => window.electronAPI.imageCache.recordCheck(p),
    download: (p) => window.electronAPI.imageCache.download(p),
  },
  fetchRemoteMetadata,
  fetchFreshDownloadUrl,
  isReady: () => { try { return isFirebaseReady(); } catch { return true; } },
  isSwitching: () => { try { return isFirebaseSwitching(); } catch { return false; } },
  debug,
});

/**
 * Punto de entrada del hook. Devuelve de inmediato el mejor `src` conocido y,
 * para imágenes de Firebase, dispara la orquestación async que llama a
 * onUpdate(newSrc) cuando hay una copia local/nueva lista (con ?v=version).
 */
export function resolveArticleImage(identity, { localId, force = false, onUpdate } = {}) {
  if (identity.kind === 'none' || identity.kind === 'placeholder') {
    return { src: ARTICLE_IMAGE_PLACEHOLDER, isPlaceholder: true, firebase: false };
  }
  if (identity.kind === 'data' || identity.kind === 'external') {
    return { src: identity.url, isPlaceholder: false, firebase: false };
  }
  if (!hasImageCacheIPC() || !localId) {
    return { src: identity.url, isPlaceholder: false, firebase: false }; // dev navegador: URL remota
  }
  const immediate = controller.immediateSrc(localId, identity);
  if (typeof onUpdate === 'function') {
    controller.orchestrate(localId, identity, { force, emit: onUpdate });
  }
  return { src: immediate, isPlaceholder: false, firebase: true };
}

/** Precalienta el catálogo con concurrencia limitada + throttle por local (requisito 10, 20). */
export async function warmArticleImages(articles, { concurrency = 4 } = {}) {
  if (!hasImageCacheIPC()) return { skipped: true };
  const localId = getLocalId();
  if (!localId || !Array.isArray(articles)) return { skipped: true };
  const identities = articles.map((a) => parseArticleImage(a && a.foto)).filter((i) => i.kind === 'firebase');
  return controller.warm(localId, identities, { concurrency });
}

/**
 * Limpieza central de huérfanos — UNA vez tras cargar el catálogo COMPLETO y
 * confirmado del local (requisito 16/17). `expectedLocalId` permite cancelar si
 * el local cambió entre la carga y el barrido (requisito 11).
 */
export async function sweepArticleImageOrphans(articles, expectedLocalId) {
  if (!hasImageCacheIPC()) return { skipped: true };
  const localId = getLocalId();
  if (!localId || (expectedLocalId && localId !== expectedLocalId)) {
    debug('SWEEP_SKIPPED', { reason: 'local-changed' });
    return { skipped: true, reason: 'local-changed' };
  }
  if (!Array.isArray(articles) || articles.length === 0) {
    debug('SWEEP_SKIPPED', { reason: 'no-catalog' });
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
