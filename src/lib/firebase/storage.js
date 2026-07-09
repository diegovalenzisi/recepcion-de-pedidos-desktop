import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFirebaseApp, getLocationSpecificStorageBucket, getLocationSpecificStorageBasePath, getLocalId } from './core';

// Prefijo interno de Storage por local (storageBasePath). NO es el bucket: el bucket
// se usa tal cual para inicializar Firebase. Esto es solo una carpeta base dentro del
// bucket para las subidas NUEVAS. Si no hay storageBasePath configurado → prefijo vacío
// → comportamiento idéntico al actual (rutas sin prefijo). Normaliza barras sobrantes.
const storagePrefix = (localId) => {
  const base = (getLocationSpecificStorageBasePath(localId) || '').replace(/^\/+|\/+$/g, '');
  return base ? `${base}/` : '';
};

export const uploadArticleImage = async (file, articleCode) => {
  try {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error('Firebase no está inicializado');
    }

    const localId = getLocalId();
    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);
    
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const fileName = `${storagePrefix(localId)}articulos/${articleCode}_${timestamp}.${fileExtension}`;
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

    const localId = getLocalId();
    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);
    
    const timestamp = Date.now();
    // Always use jpg for compressed web images
    const fileName = `${storagePrefix(localId)}web/featured_${timestamp}.jpg`;
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

    const localId = getLocalId();
    const storageBucket = getLocationSpecificStorageBucket(localId);
    const storage = getStorage(app);
    
    // Extract path from URL
    // URL format: https://firebasestorage.googleapis.com/v0/b/[bucket]/o/[path]?alt=media...
    const urlParts = imageUrl.split('/o/')[1];
    if (!urlParts) {
      throw new Error('URL de imagen inválida');
    }
    
    const filePath = decodeURIComponent(urlParts.split('?')[0]);
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
 * Migra (copia) la imagen de UN artículo a la carpeta base storageBasePath, SOLO si
 * hace falta. Devuelve { newUrl } si migró, o null si no había nada que hacer.
 * NO borra la imagen vieja: eso lo hace el caller (managementApi) DESPUÉS de guardar
 * en RTDB, para respetar el orden seguro.
 *
 * No hace nada si: foto vacío · no es URL de Firebase Storage · no hay storageBasePath
 * configurado · el path ya empieza con "{storageBasePath}/".
 * Si la descarga/subida falla, LANZA (el caller lo captura y no borra la vieja).
 */
export const migrateArticleImageIfNeeded = async (foto, articleCode) => {
  if (!foto || !foto.includes('firebasestorage.googleapis.com')) return null;

  const localId = getLocalId();
  const prefix = storagePrefix(localId); // "40508022/" o ""
  if (!prefix) return null; // sin storageBasePath → nada que migrar

  const oldPath = extractStoragePath(foto);
  if (!oldPath) return null;
  if (oldPath.startsWith(prefix)) return null; // ya está bajo storageBasePath

  const app = getFirebaseApp();
  if (!app) throw new Error('Firebase no está inicializado');

  // Descargar la imagen vieja como blob
  const resp = await fetch(foto);
  if (!resp.ok) throw new Error(`No se pudo descargar la imagen vieja (HTTP ${resp.status})`);
  const blob = await resp.blob();

  // Subir al nuevo path con prefijo storageBasePath, conservando la extensión real
  const ext = (oldPath.split('.').pop() || 'png').toLowerCase();
  const timestamp = Date.now();
  const newName = `${prefix}articulos/${articleCode}_${timestamp}.${ext}`;
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
  const storagePath    = `facturacion/${localId}/${accountSegment}/${filename}`;
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

    const localId = getLocalId();
    const storage = getStorage(app);
    const storageRef = ref(storage, `actualizaciones/${localId}/${file.name}`);

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
    const fileName = `app-icons/${localId}/icon-${timestamp}.${fileExtension}`;
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