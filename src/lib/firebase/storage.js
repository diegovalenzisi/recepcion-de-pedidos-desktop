import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFirebaseApp, getLocationSpecificStorageBucket, getLocationSpecificStorageBasePath, getLocalId, getCurrentLocalId } from './core';
import { construirRutaStorageLocal, normalizarLocalId, rutaPerteneceAlLocal } from '@/lib/api/rutasLocales';

// REGLA DE ALMACENAMIENTO POR LOCAL (Firebase Storage):
//
//     {localId}/...     ej: 40508022/articulos/156A_1712345678.png
//
// El número de local es SIEMPRE el primer segmento. Antes había dos formas
// incorrectas conviviendo: subidas SIN prefijo (cuando el local no tenía
// `storageBasePath` configurado, que es el caso por defecto) y rutas INVERTIDAS
// (`facturacion/{localId}/...`, `app-icons/{localId}/...`,
// `actualizaciones/{localId}/...`). Ambas quedaron corregidas.
//
// `storageBasePath` sigue respetándose como raíz explícita del local cuando está
// configurado (es literalmente "la carpeta de ese local"); si no lo está, la raíz
// es el propio número de local — nunca la raíz del bucket.

/** Raíz de Storage del local: storageBasePath si está configurado, si no el localId. */
const raizStorage = (localId) => {
  const base = (getLocationSpecificStorageBasePath(localId) || '').replace(/^\/+|\/+$/g, '');
  return normalizarLocalId(base || localId);
};

/**
 * Construye una ruta de Storage DENTRO del local. Sin local válido lanza
 * LOCAL_ID_REQUIRED y la subida se cancela (nunca se sube a la raíz del bucket).
 */
const rutaLocal = (localId, ruta) => construirRutaStorageLocal(raizStorage(localId), ruta);

/** Prefijo con barra final del local actual (para composiciones puntuales). */
const storagePrefix = (localId) => construirRutaStorageLocal(raizStorage(localId));

/** Local actual normalizado (variable de módulo o localStorage). */
const localActual = () => normalizarLocalId(getCurrentLocalId() || getLocalId());

export const uploadArticleImage = async (file, articleCode) => {
  try {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase no está inicializado');
    }

    const localId = localActual();
    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);
    
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const fileName = rutaLocal(localId, `articulos/${articleCode}_${timestamp}.${fileExtension}`);
    const storageRef = ref(storage, fileName);

    const metadata = {
      contentType: file.type,
      customMetadata: {
        articleCode: articleCode,
        uploadedAt: new Date().toISOString(),
        localId: localId,
        storageBucket: storageBucket
      }
    };

    await uploadBytes(storageRef, file, metadata);
    const downloadURL = await getDownloadURL(storageRef);
    
    return downloadURL;
  } catch (error) {
    console.error('Error detallado al subir imagen:', error);
    
    if (error.code === 'storage/unauthorized') {
      throw new Error('No tienes permisos para subir archivos. Verifica las reglas de Firebase Storage.');
    } else if (error.code === 'storage/canceled') {
      throw new Error('La carga fue cancelada.');
    } else if (error.code === 'storage/unknown') {
      throw new Error('Error desconocido al subir la imagen. Verifica tu conexión a internet.');
    } else {
      throw new Error(`Error al subir imagen: ${error.message}`);
    }
  }
};

export const uploadWebImage = async (file) => {
  try {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase no está inicializado');
    }

    const localId = localActual();
    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);
    
    const timestamp = Date.now();
    // Always use jpg for compressed web images
    const fileName = rutaLocal(localId, `web/featured_${timestamp}.jpg`);
    const storageRef = ref(storage, fileName);

    const metadata = {
      contentType: 'image/jpeg',
      customMetadata: {
        type: 'web_featured',
        uploadedAt: new Date().toISOString(),
        localId: localId,
        storageBucket: storageBucket
      }
    };

    await uploadBytes(storageRef, file, metadata);
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error('Error uploading web image:', error);
    throw error;
  }
};

export const deleteArticleImage = async (imageUrl) => {
  try {
    if (!imageUrl || !imageUrl.includes('firebasestorage.googleapis.com')) {
      return;
    }

    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase no está inicializado');
    }

    const localId = localActual();
    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);
    
    // Extract path from URL
    // URL format: https://firebasestorage.googleapis.com/v0/b/[bucket]/o/[path]?alt=media...
    const urlParts = imageUrl.split('/o/')[1];
    if (!urlParts) {
      throw new Error('URL de imagen inválida');
    }
    
    const filePath = decodeURIComponent(urlParts.split('?')[0]);

    // GUARDA DE PERTENENCIA — NO SE BORRA FUERA DE LA CARPETA DEL LOCAL.
    //
    // Varios locales comparten un mismo bucket (los que no tienen Firebase
    // propio caen por fallback al proyecto por defecto), y hasta acá se borraba
    // la ruta que viniera en la URL, sin mirar de quién era. Un artículo cuya
    // `foto` apuntara a la carpeta de otro local destruía el archivo del otro.
    //
    // La raíz sale de `raizStorage` — la MISMA que usan las subidas — y la
    // comprobación es `rutaPerteneceAlLocal`, la guarda canónica de
    // rutasLocales.js. No se hardcodea ningún local.
    const raiz = raizStorage(localId);
    if (!raiz || !rutaPerteneceAlLocal(filePath, raiz)) {
      console.warn(
        `[Storage] BORRADO OMITIDO: "${filePath}" no pertenece a la raíz del local actual ` +
        `("${raiz || 'sin local'}"). El archivo NO se tocó: puede ser de otro local del ` +
        'mismo bucket.',
      );
      return;
    }

    const imageRef = ref(storage, filePath);

    await deleteObject(imageRef);
    console.log(`Image deleted successfully from bucket: ${storageBucket}`);
  } catch (error) {
    console.error('Error al eliminar imagen:', error);
    // Don't throw here to prevent blocking UI updates if delete fails
  }
};

// Alias for web images since the logic is the same
export const deleteWebImage = deleteArticleImage;

// Extrae el path interno de Storage desde una URL de descarga de Firebase.
// Ej: https://.../o/40508022%2Farticulos%2F123.png?alt=media... → "40508022/articulos/123.png"
const extractStoragePath = (imageUrl) => {
  const urlParts = (imageUrl || '').split('/o/')[1];
  if (!urlParts) return null;
  return decodeURIComponent(urlParts.split('?')[0]);
};

/**
 * Migra (copia) la imagen de UN artículo a la carpeta del local, SOLO si hace
 * falta. Devuelve { newUrl } si migró, o null si no había nada que hacer.
 * NO borra la imagen vieja: eso lo hace el caller (managementApi) DESPUÉS de guardar
 * en RTDB, para respetar el orden seguro.
 *
 * No hace nada si: foto vacío · no es URL de Firebase Storage · no hay un local
 * válido · el path ya empieza con "{localId}/".
 * Si la descarga/subida falla, LANZA (el caller lo captura y no borra la vieja).
 */
export const migrateArticleImageIfNeeded = async (foto, articleCode) => {
  if (!foto || !foto.includes('firebasestorage.googleapis.com')) return null;

  const localId = localActual();
  if (!localId) return null;            // sin local válido no se migra nada
  let prefix;
  try {
    prefix = storagePrefix(localId);    // "40508022/"
  } catch {
    return null;                        // raíz de local no resoluble: no se toca nada
  }

  const oldPath = extractStoragePath(foto);
  if (!oldPath) return null;
  if (oldPath.startsWith(prefix)) return null; // ya está dentro del local

  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase no está inicializado');

  // Descargar la imagen vieja como blob
  const resp = await fetch(foto);
  if (!resp.ok) throw new Error(`No se pudo descargar la imagen vieja (HTTP ${resp.status})`);
  const blob = await resp.blob();

  // Subir al nuevo path con prefijo storageBasePath, conservando la extensión real
  const ext = (oldPath.split('.').pop() || 'png').toLowerCase();
  const timestamp = Date.now();
  const newName = rutaLocal(localId, `articulos/${articleCode}_${timestamp}.${ext}`);
  const storage = getStorage(app);
  const storageRef = ref(storage, newName);

  await uploadBytes(storageRef, blob, {
    contentType: blob.type || 'application/octet-stream',
    customMetadata: {
      articleCode: String(articleCode),
      migratedAt: new Date().toISOString(),
      localId: localId || '',
      migratedFrom: oldPath,
    },
  });

  const newUrl = await getDownloadURL(storageRef);
  return { newUrl };
};

/**
 * Sube un archivo de certificado AFIP (cert/key/json) a Firebase Storage.
 * @param {string} localId - ID del local
 * @param {string} tipo - 'ri' | 'mono'
 * @param {string|null} cuentaId - ID de la cuenta Mono (null para RI)
 * @param {string} filename - nombre destino del archivo (ej: 'certificado.crt')
 * @param {string} base64Data - contenido del archivo en base64
 * @returns {{ storagePath: string, downloadUrl: string }}
 */
export const uploadAfipFile = async (localId, tipo, cuentaId, filename, base64Data) => {
  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase no está inicializado');

  const storage = getStorage(app);
  const accountSegment = cuentaId ? `${tipo}/${cuentaId}` : tipo;
  const storagePath    = rutaLocal(localId, `facturacion/${accountSegment}/${filename}`);
  const storageRef     = ref(storage, storagePath);

  const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  await uploadBytes(storageRef, bytes, {
    contentType: 'application/octet-stream',
    customMetadata: { localId, tipo, cuentaId: cuentaId || 'ri', filename },
  });

  const downloadUrl = await getDownloadURL(storageRef);
  return { storagePath, downloadUrl };
};

/**
 * Sube el instalador .exe a Firebase Storage usando uploadBytesResumable.
 * onProgress recibe { pct, bytesTransferred, totalBytes, speedBps, state }
 * Devuelve la URL de descarga al completar.
 */
export const uploadUpdateInstaller = (file, onProgress) => {
  return new Promise((resolve, reject) => {
    const app = getFirebaseApp();
    if (!app) { reject(new Error('Firebase no está inicializado')); return; }

    const localId = localActual();
    const storage = getStorage(app);
    const storageRef = ref(storage, rutaLocal(localId, `actualizaciones/${file.name}`));

    const metadata = {
      contentType: 'application/octet-stream',
      customMetadata: {
        type: 'update_installer',
        uploadedAt: new Date().toISOString(),
        localId: String(localId),
      },
    };

    const task = uploadBytesResumable(storageRef, file, metadata);

    let lastBytes = 0;
    let lastTime  = Date.now();

    task.on(
      'state_changed',
      (snapshot) => {
        const now   = Date.now();
        const dt    = (now - lastTime) / 1000;          // segundos desde último tick
        const dBytes = snapshot.bytesTransferred - lastBytes;
        const speedBps = dt > 0 ? dBytes / dt : 0;

        lastBytes = snapshot.bytesTransferred;
        lastTime  = now;

        onProgress?.({
          pct:              Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes:       snapshot.totalBytes,
          speedBps,
          state:            snapshot.state,
        });
      },
      (error) => reject(error),
      async () => {
        onProgress?.({ pct: 100, bytesTransferred: file.size, totalBytes: file.size, speedBps: 0, state: 'success' });
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
};

export const uploadAppIcon = async (file, localId) => {
  try {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase no está inicializado');
    }

    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);

    const timestamp = Date.now();
    const fileExtension = (file.name.split('.').pop() || 'png').toLowerCase();
    const fileName = rutaLocal(localId, `app-icons/icon-${timestamp}.${fileExtension}`);
    const storageRef = ref(storage, fileName);

    const metadata = {
      contentType: file.type,
      customMetadata: {
        type: 'app_icon',
        uploadedAt: new Date().toISOString(),
        localId: localId,
        storageBucket: storageBucket
      }
    };

    await uploadBytes(storageRef, file, metadata);
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error('Error uploading app icon:', error);
    throw error;
  }
};

/**
 * Sube el LOGO de la app de pedidos a Firebase Storage, a una ruta fija por local:
 * `{localId}/logo`. Es independiente del ícono de la app (uploadAppIcon → app-icons/...).
 * Usa un nombre fijo (se sobrescribe en cada guardado, sin acumular archivos). Devuelve la
 * URL de descarga, que el caller guarda en RTDB (CONFIGURACION/logoAppPedidos) para leerla luego.
 */
export const uploadAppLogo = async (file, localId) => {
  try {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase no está inicializado');
    }

    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);

    const fileName = rutaLocal(localId, 'logo');
    const storageRef = ref(storage, fileName);

    const metadata = {
      contentType: file.type,
      customMetadata: {
        type: 'app_logo',
        uploadedAt: new Date().toISOString(),
        localId: String(localId),
        storageBucket: storageBucket
      }
    };

    await uploadBytes(storageRef, file, metadata);
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error('Error uploading app logo:', error);
    throw error;
  }
};