import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { getFirebaseApp, getLocationSpecificStorageBucket, getLocalId } from './core';

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
    const fileName = `articulos/${articleCode}_${timestamp}.${fileExtension}`;
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
    const fileName = `web/featured_${timestamp}.jpg`;
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