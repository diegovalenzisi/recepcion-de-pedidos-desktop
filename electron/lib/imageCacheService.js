'use strict';

// ---------------------------------------------------------------------------
// Servicio de caché local de imágenes de artículos (PROCESO PRINCIPAL).
//
// Vive en el main process porque el renderer está sandboxeado (contextIsolation
// + preload, sin nodeIntegration) y no puede escribir en disco. El renderer solo
// recibe URLs `dlvimg://{localId}/{key}` o el placeholder — nunca rutas físicas.
//
// DISEÑO (ver requisitos 1-25 del pedido):
//  - Identidad de caché ESTABLE = sha1(bucket \n objectPath). NUNCA la URL con
//    token: una rotación de token no cambia la identidad ni fuerza descarga.
//  - Aislamiento por local: cada local tiene su carpeta física
//    {root}/{localId}/ y su propio manifest.json. Aunque dos locales generen la
//    misma key, nunca comparten archivos ni manifiesto.
//  - Versión: prioridad `generation`, luego `md5Hash`, luego `size`+`updated`.
//    Si falta metadata remota NO se invalida el caché (offline = usar local).
//  - Escritura atómica: bytes → archivo `.part` único → fsync → rename. El
//    manifest.json también se escribe atómicamente (tmp → fsync → rename) y bajo
//    un mutex por local para que dos operaciones no se pisen.
//  - Dedupe de descargas por (localId, bucket, objectPath), no solo por key.
//  - Validación del contenido antes de reemplazar: status 200, no vacío, <= max,
//    content-type de imagen, magic bytes reales (rechaza HTML/JSON de error),
//    md5 si Firebase lo provee. Si algo falla, se conserva la copia anterior.
//  - Protocolo: resuelve SOLO keys registradas en el manifiesto, dentro de la
//    carpeta del local; rechaza `..`, rutas absolutas, keys/locales inválidos.
//
// Este módulo es CommonJS y NO importa electron: se puede testear con node:assert
// contra un directorio temporal real (fs real) inyectando solo `httpGet` (fake).
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const nodePath = require('path');
const nodeFsPromises = require('fs').promises;

// ---- Constantes por defecto (todas configurables al crear el servicio) ----
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (los artículos suben hasta 5 MB)
const DEFAULT_ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif',
]);
// Intervalo mínimo entre chequeos de getMetadata() por imagen (requisito 3).
const DEFAULT_MIN_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min
// Período de gracia antes de borrar un huérfano (requisito 16).
const DEFAULT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000; // 24 h
const KEY_REGEX = /^[a-f0-9]{40}$/;             // sha1 hex — rechaza `..`, `/`, absolutos
const LOCAL_ID_REGEX = /^[A-Za-z0-9_-]+$/;      // rechaza traversal en el nombre de carpeta

// ---------------------------------------------------------------------------
// Errores tipados (el renderer puede distinguir por .code)
// ---------------------------------------------------------------------------
class ImageCacheError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ImageCacheError';
    this.code = code;
  }
}

// ===========================================================================
// HELPERS PUROS (sin I/O) — exportados para test directo
// ===========================================================================

/** Normaliza el objectPath de Storage. Rechaza traversal. NO usa el nombre a secas. */
function normalizeObjectPath(objectPath) {
  let p = String(objectPath == null ? '' : objectPath).trim().replace(/\\/g, '/');
  p = p.replace(/^\/+/, '').replace(/\/{2,}/g, '/'); // sin barras iniciales ni dobles
  if (!p) throw new ImageCacheError('INVALID_OBJECT_PATH', 'objectPath vacío');
  const segments = p.split('/');
  if (segments.some((s) => s === '..' || s === '.')) {
    throw new ImageCacheError('INVALID_OBJECT_PATH', `objectPath con traversal: ${objectPath}`);
  }
  return p;
}

/** Normaliza el bucket (trim). No fuerza minúsculas para no crear identidades falsas. */
function normalizeBucket(bucket) {
  const b = String(bucket == null ? '' : bucket).trim();
  if (!b) throw new ImageCacheError('INVALID_BUCKET', 'bucket vacío');
  return b;
}

/** Valida localId como nombre de carpeta seguro. Rechaza traversal. */
function sanitizeLocalId(localId) {
  const id = String(localId == null ? '' : localId).trim();
  if (!LOCAL_ID_REGEX.test(id)) {
    throw new ImageCacheError('INVALID_LOCAL', `localId inválido: ${localId}`);
  }
  return id;
}

/** Clave estable = sha1(bucket \n objectPath). Independiente del token de la URL. */
function makeStableKey(bucket, objectPath) {
  const b = normalizeBucket(bucket);
  const p = normalizeObjectPath(objectPath);
  return crypto.createHash('sha1').update(`${b}\n${p}`).digest('hex');
}

/**
 * Decide si la imagen remota cambió respecto de la entrada local.
 * Prioridad: generation → md5Hash → (size + updated). Si falta metadata remota
 * (offline / getMetadata falló) NO se considera cambiada (requisito 1 y 6).
 */
function compareVersion(entry, remoteMeta) {
  if (!remoteMeta) return { changed: false, reason: 'no-remote-metadata' };
  if (!entry) return { changed: true, reason: 'no-local-entry' };

  if (remoteMeta.generation != null && entry.generation != null) {
    return {
      changed: String(remoteMeta.generation) !== String(entry.generation),
      reason: 'generation',
    };
  }
  if (remoteMeta.md5Hash && entry.md5Hash) {
    return { changed: remoteMeta.md5Hash !== entry.md5Hash, reason: 'md5' };
  }
  const haveSize = remoteMeta.size != null && entry.size != null;
  const haveUpdated = remoteMeta.updated && entry.updated;
  if (haveSize || haveUpdated) {
    const sizeChanged = haveSize && String(remoteMeta.size) !== String(entry.size);
    const updatedChanged = haveUpdated && remoteMeta.updated !== entry.updated;
    return { changed: !!(sizeChanged || updatedChanged), reason: 'size-updated' };
  }
  // No hay metadata suficiente para afirmar un cambio → conservar local.
  return { changed: false, reason: 'insufficient-metadata' };
}

/** Detecta si un buffer es realmente una imagen (magic bytes) y no HTML/JSON de error. */
function looksLikeImage(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // Rechazo temprano de respuestas de error de texto (HTML/JSON/XML).
  let i = 0;
  while (i < buffer.length && (buffer[i] === 0x20 || buffer[i] === 0x09 || buffer[i] === 0x0a || buffer[i] === 0x0d)) i++;
  const firstChar = buffer[i];
  if (firstChar === 0x3c /* < */ || firstChar === 0x7b /* { */ || firstChar === 0x5b /* [ */) return false;

  const b = buffer;
  // JPEG FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  // PNG 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  // GIF 'GIF8'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
  // BMP 'BM'
  if (b[0] === 0x42 && b[1] === 0x4d) return true;
  // WEBP: 'RIFF' .... 'WEBP'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
  // AVIF / HEIF: 'ftyp' en offset 4
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true;
  return false;
}

/** md5 en base64 (mismo formato que Firebase Storage md5Hash). */
function md5Base64(buffer) {
  return crypto.createHash('md5').update(buffer).digest('base64');
}

/**
 * Valida una respuesta de descarga ANTES de reemplazar la copia local.
 * Devuelve { ok, code }. Nunca lanza. Códigos:
 *  URL_EXPIRED (401/403) · HTTP_ERROR · EMPTY · TOO_LARGE · BAD_CONTENT_TYPE ·
 *  NOT_IMAGE · MD5_MISMATCH · OK
 */
function validateDownload({ status, buffer, contentType, expectedMd5, maxBytes, allowedContentTypes }) {
  if (status === 401 || status === 403) return { ok: false, code: 'URL_EXPIRED' };
  if (status !== 200) return { ok: false, code: 'HTTP_ERROR' };
  if (!buffer || buffer.length === 0) return { ok: false, code: 'EMPTY' };
  if (buffer.length > maxBytes) return { ok: false, code: 'TOO_LARGE' };
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ct && !allowedContentTypes.has(ct)) return { ok: false, code: 'BAD_CONTENT_TYPE' };
  if (!looksLikeImage(buffer)) return { ok: false, code: 'NOT_IMAGE' };
  if (expectedMd5 && md5Base64(buffer) !== expectedMd5) return { ok: false, code: 'MD5_MISMATCH' };
  return { ok: true, code: 'OK' };
}

// ===========================================================================
// FÁBRICA DEL SERVICIO (con I/O)
// ===========================================================================
function createImageCacheService(options = {}) {
  const fs = options.fs || nodeFsPromises;
  const path = options.path || nodePath;
  const root = options.root;
  if (!root) throw new ImageCacheError('NO_ROOT', 'createImageCacheService requiere { root }');
  const httpGet = options.httpGet; // obligatorio para download(); inyectable en tests
  const now = options.now || (() => Date.now());
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const allowedContentTypes = options.allowedContentTypes
    ? new Set(options.allowedContentTypes)
    : DEFAULT_ALLOWED_CONTENT_TYPES;
  const minCheckIntervalMs = options.minCheckIntervalMs != null ? options.minCheckIntervalMs : DEFAULT_MIN_CHECK_INTERVAL_MS;
  const orphanGraceMs = options.orphanGraceMs != null ? options.orphanGraceMs : DEFAULT_ORPHAN_GRACE_MS;
  const logger = options.logger || { warn() {}, error() {}, info() {} };

  // Dedupe de descargas por (localId, bucket, objectPath) — requisito 15.
  const inFlightDownloads = new Map();
  // Mutex por local para el manifest.json — requisito 14.
  const manifestLocks = new Map();

  const rand = () => `${crypto.randomBytes(6).toString('hex')}.${process.pid}`;

  const localDir = (localId) => path.join(root, sanitizeLocalId(localId));
  const manifestPath = (localId) => path.join(localDir(localId), 'manifest.json');
  const filePath = (localId, key) => path.join(localDir(localId), key);

  async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
  }

  async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  /** Escritura atómica con fsync: tmp único → sync → rename. */
  async function writeAtomic(finalPath, data) {
    await ensureDir(path.dirname(finalPath));
    const tmp = `${finalPath}.${rand()}.tmp`;
    let fh;
    try {
      fh = await fs.open(tmp, 'w');
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      if (fh) await fh.close();
    }
    await fs.rename(tmp, finalPath);
  }

  /** Lee el manifiesto del local. ENOENT → {}. Corrupto → respaldo + {} (requisito 14). */
  async function readManifest(localId) {
    const mp = manifestPath(localId);
    let raw;
    try {
      raw = await fs.readFile(mp, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return {};
      throw e;
    }
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      const backup = `${mp}.corrupt-${now()}.json`;
      try { await fs.rename(mp, backup); } catch { /* best-effort */ }
      logger.warn(`[imageCache] manifest.json corrupto en ${localId}, respaldado y reiniciado: ${e.message}`);
      return {};
    }
  }

  /** Serializa el acceso al manifiesto por local: read → mutate → writeAtomic. */
  function withManifest(localId, mutator) {
    const prev = manifestLocks.get(localId) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const manifest = await readManifest(localId);
      const result = await mutator(manifest);
      // mutator devuelve { manifest, value } o solo el valor si no cambió nada.
      if (result && result.__write) {
        await writeAtomic(manifestPath(localId), JSON.stringify(result.manifest, null, 2));
      }
      return result ? result.value : undefined;
    });
    manifestLocks.set(localId, next);
    // Limpia el lock cuando queda al final de la cadena.
    next.finally(() => { if (manifestLocks.get(localId) === next) manifestLocks.delete(localId); });
    return next;
  }

  function buildProtocolUrl(localId, key) {
    return `dlvimg://${sanitizeLocalId(localId)}/${key}`;
  }

  // ---- API pública ----

  /**
   * Resuelve la copia LOCAL inmediatamente (para stale-while-revalidate).
   * No toca la red. Devuelve { key, cached, protocolUrl?, entry? }.
   */
  async function resolveLocal(localId, bucket, objectPath) {
    const key = makeStableKey(bucket, objectPath);
    const manifest = await readManifest(localId);
    const entry = manifest[key];
    if (entry && await fileExists(filePath(localId, key))) {
      return { key, cached: true, protocolUrl: buildProtocolUrl(localId, key), entry };
    }
    return { key, cached: false, entry: entry || null };
  }

  /** ¿Corresponde chequear metadata? (dedupe temporal — requisito 3). */
  function shouldCheckMetadata(entry, { force = false } = {}) {
    if (force) return true;
    if (!entry) return true;
    const last = entry.lastCheckedAt || 0;
    return (now() - last) >= minCheckIntervalMs;
  }

  /**
   * Registra un chequeo de metadata SIN descargar (cuando la versión no cambió).
   * Actualiza lastCheckedAt y refresca metadata/URL en el manifiesto.
   */
  async function recordMetadataCheck(localId, bucket, objectPath, remoteMeta, downloadUrl) {
    const key = makeStableKey(bucket, objectPath);
    return withManifest(localId, (manifest) => {
      const entry = manifest[key];
      if (!entry) return { value: { key, updated: false } };
      entry.lastCheckedAt = now();
      if (remoteMeta) {
        if (remoteMeta.generation != null) entry.generation = String(remoteMeta.generation);
        if (remoteMeta.md5Hash) entry.md5Hash = remoteMeta.md5Hash;
        if (remoteMeta.updated) entry.updated = remoteMeta.updated;
        if (remoteMeta.size != null) entry.size = remoteMeta.size;
        if (remoteMeta.contentType) entry.contentType = remoteMeta.contentType;
      }
      if (downloadUrl) entry.downloadUrl = downloadUrl; // token nuevo, misma identidad
      return { __write: true, manifest, value: { key, updated: true } };
    });
  }

  /**
   * Descarga y reemplaza atómicamente. Dedup por (localId,bucket,objectPath).
   * Lanza ImageCacheError con .code en fallos (URL_EXPIRED, TOO_LARGE, NOT_IMAGE...).
   * En cualquier fallo conserva la copia local anterior (no la toca).
   */
  function download(localId, bucket, objectPath, { url, remoteMeta } = {}) {
    if (!httpGet) throw new ImageCacheError('NO_HTTP_GET', 'download() requiere httpGet inyectado');
    const b = normalizeBucket(bucket);
    const p = normalizeObjectPath(objectPath);
    const lid = sanitizeLocalId(localId);
    const key = makeStableKey(b, p);
    const dedupeKey = `${lid} ${b} ${p}`;

    if (inFlightDownloads.has(dedupeKey)) return inFlightDownloads.get(dedupeKey);

    const task = (async () => {
      const res = await httpGet(url, { maxBytes });
      const validation = validateDownload({
        status: res.status,
        buffer: res.buffer,
        contentType: res.contentType || (res.headers && res.headers['content-type']),
        expectedMd5: remoteMeta && remoteMeta.md5Hash,
        maxBytes,
        allowedContentTypes,
      });
      if (!validation.ok) {
        throw new ImageCacheError(validation.code, `descarga inválida (${validation.code}) para ${p}`);
      }

      // bytes → .part único → fsync → rename (nunca pisa la copia válida antes de terminar)
      await ensureDir(localDir(lid));
      const partPath = `${filePath(lid, key)}.${rand()}.part`;
      let fh;
      try {
        fh = await fs.open(partPath, 'w');
        await fh.writeFile(res.buffer);
        await fh.sync();
      } finally {
        if (fh) await fh.close();
      }
      try {
        await fs.rename(partPath, filePath(lid, key));
      } catch (e) {
        try { await fs.unlink(partPath); } catch { /* best-effort */ }
        throw e;
      }

      const ct = (res.contentType || (res.headers && res.headers['content-type']) || '')
        .split(';')[0].trim().toLowerCase();
      await withManifest(lid, (manifest) => {
        manifest[key] = {
          bucket: b,
          objectPath: p,
          generation: remoteMeta && remoteMeta.generation != null ? String(remoteMeta.generation) : (manifest[key] && manifest[key].generation) || null,
          md5Hash: (remoteMeta && remoteMeta.md5Hash) || md5Base64(res.buffer),
          updated: (remoteMeta && remoteMeta.updated) || null,
          size: (remoteMeta && remoteMeta.size != null) ? remoteMeta.size : res.buffer.length,
          contentType: ct || (remoteMeta && remoteMeta.contentType) || 'image/jpeg',
          localFile: key,
          downloadUrl: url || null,
          downloadedAt: now(),
          lastCheckedAt: now(),
          state: 'ready',
        };
        return { __write: true, manifest, value: null };
      });

      return { key, protocolUrl: buildProtocolUrl(lid, key) };
    })();

    // finally: SIEMPRE se limpia la entrada de inFlight (requisito 15).
    const wrapped = task.finally(() => { inFlightDownloads.delete(dedupeKey); });
    inFlightDownloads.set(dedupeKey, wrapped);
    return wrapped;
  }

  /**
   * Descarga con reintento único ante URL_EXPIRED (401/403): pide una URL fresca
   * y reintenta UNA vez. Sin bucles (requisito 8).
   */
  async function downloadWithRefresh(localId, bucket, objectPath, { url, remoteMeta, getFreshUrl } = {}) {
    try {
      return await download(localId, bucket, objectPath, { url, remoteMeta });
    } catch (e) {
      if (e && e.code === 'URL_EXPIRED' && typeof getFreshUrl === 'function') {
        const freshUrl = await getFreshUrl();
        if (!freshUrl) throw e;
        return await download(localId, bucket, objectPath, { url: freshUrl, remoteMeta });
      }
      throw e;
    }
  }

  /**
   * Resuelve una request del protocolo dlvimg:// a una ruta física — SOLO si la
   * key está registrada en el manifiesto y el archivo vive dentro de la carpeta
   * del local. Rechaza traversal / keys / locales desconocidos (requisitos 9, 11).
   * La ruta devuelta es de uso interno del main; nunca se expone al renderer.
   */
  async function resolveProtocolPath(localId, key) {
    const lid = sanitizeLocalId(localId);              // rechaza traversal en local
    if (!KEY_REGEX.test(String(key || ''))) {          // rechaza `..`, `/`, absolutos
      throw new ImageCacheError('INVALID_KEY', `key inválida: ${key}`);
    }
    const manifest = await readManifest(lid);
    if (!manifest[key]) throw new ImageCacheError('UNKNOWN_KEY', `key no registrada: ${key}`);

    const dir = localDir(lid);
    const abs = path.resolve(dir, key);
    const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
    if (abs !== path.join(dir, key) || !abs.startsWith(dirWithSep)) {
      throw new ImageCacheError('PATH_ESCAPE', `ruta fuera del cache: ${key}`);
    }
    if (!await fileExists(abs)) throw new ImageCacheError('FILE_MISSING', `archivo ausente: ${key}`);
    return { path: abs, contentType: manifest[key].contentType || 'image/jpeg' };
  }

  /**
   * Limpieza de huérfanos — SOLO con catálogo completo y confirmado (requisito 16/17).
   * - catalogComplete=false → no borra NADA.
   * - Borra entradas del manifiesto que no estén en validKeys Y superen el período
   *   de gracia desde su última descarga/uso.
   * - Borra archivos `.part`/`.tmp` sueltos y archivos sin entrada de manifiesto.
   * - Nunca toca carpetas de otros locales (opera solo dentro de localDir(localId)).
   */
  async function sweepOrphans(localId, validKeys, { catalogComplete = false, graceMs = orphanGraceMs } = {}) {
    if (!catalogComplete) return { skipped: true, reason: 'catalog-incomplete', deleted: 0 };
    const lid = sanitizeLocalId(localId);
    const valid = validKeys instanceof Set ? validKeys : new Set(validKeys || []);
    const dir = localDir(lid);
    const nowMs = now();

    return withManifest(lid, async (manifest) => {
      let deleted = 0;
      let changed = false;

      // 1) Entradas huérfanas del manifiesto (fuera del catálogo + fuera de gracia).
      for (const key of Object.keys(manifest)) {
        if (valid.has(key)) {
          // Marca "visto" para futuros barridos (refresca la gracia).
          manifest[key].lastSeenAt = nowMs;
          changed = true;
          continue;
        }
        const entry = manifest[key];
        const ref = entry.lastSeenAt || entry.downloadedAt || 0;
        if (nowMs - ref >= graceMs) {
          try { await fs.unlink(filePath(lid, key)); } catch { /* puede no existir */ }
          delete manifest[key];
          deleted++;
          changed = true;
        }
      }

      // 2) Archivos sueltos en disco (temporales o sin entrada de manifiesto).
      let entries = [];
      try { entries = await fs.readdir(dir); } catch { entries = []; }
      for (const name of entries) {
        if (name === 'manifest.json' || name.startsWith('manifest.json.')) continue;
        if (name.endsWith('.part') || name.endsWith('.tmp')) {
          try { await fs.unlink(path.join(dir, name)); deleted++; } catch { /* best-effort */ }
          continue;
        }
        // Archivo con nombre de key pero sin entrada viva en el manifiesto → huérfano.
        if (KEY_REGEX.test(name) && !manifest[name]) {
          try { await fs.unlink(path.join(dir, name)); deleted++; } catch { /* best-effort */ }
        }
      }

      return { __write: changed, manifest, value: { skipped: false, deleted } };
    });
  }

  async function stats(localId) {
    const manifest = await readManifest(localId);
    return { entries: Object.keys(manifest).length };
  }

  return {
    resolveLocal,
    shouldCheckMetadata,
    recordMetadataCheck,
    download,
    downloadWithRefresh,
    resolveProtocolPath,
    sweepOrphans,
    stats,
    buildProtocolUrl,
    makeStableKey,
    // Para inspección/pruebas:
    __internals: { inFlightDownloads, manifestLocks, localDir, manifestPath, filePath, readManifest },
  };
}

module.exports = {
  createImageCacheService,
  ImageCacheError,
  // helpers puros
  normalizeObjectPath,
  normalizeBucket,
  sanitizeLocalId,
  makeStableKey,
  compareVersion,
  looksLikeImage,
  md5Base64,
  validateDownload,
  // constantes
  DEFAULT_MAX_BYTES,
  DEFAULT_MIN_CHECK_INTERVAL_MS,
  DEFAULT_ORPHAN_GRACE_MS,
  KEY_REGEX,
  LOCAL_ID_REGEX,
};
