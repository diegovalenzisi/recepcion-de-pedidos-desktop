import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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