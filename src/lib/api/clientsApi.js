import { getDatabase, ref, onValue, set, remove, update } from 'firebase/database';
import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

const sanitizeFirebaseKey = (key) => {
  if (typeof key !== 'string') {
    key = String(key);
  }
  return key.replace(/[.#$[\]/]/g, '');
};

export const fetchClients = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const FIREBASE_URL = getFirebaseUrl();
  
  console.log(`[ClientsAPI] Iniciando carga de clientes para Local ID: ${LOCAL_ID}`);
  console.log(`[ClientsAPI] URL Endpoint: ${FIREBASE_URL}/${LOCAL_ID}/CLIENTES.json`);
  
  try {
    const url = `${FIREBASE_URL}/${LOCAL_ID}/CLIENTES.json`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`[ClientsAPI] Error de red. Status: ${response.status}`);
      if (response.status === 404) return [];
      throw new Error('Network response was not ok');
    }
    
    const data = await response.json();
    console.log(`[ClientsAPI] Datos crudos recibidos:`, data ? `${Object.keys(data).length} registros` : 'null');
    
    if (!data) return [];
    
    // Normalizar datos para evitar crashes en el frontend
    const parsedClients = Object.keys(data).map(phone => {
      const clientData = data[phone];
      return {
        phone: phone || '',
        nombre: clientData.nombre || clientData.name || '', // Soportar ambos formatos históricos
        direccion: clientData.direccion || clientData.address || '',
        entrecalle1: clientData.entrecalle1 || clientData.cross_street1 || '',
        entrecalle2: clientData.entrecalle2 || clientData.cross_street2 || '',
        detalles: clientData.detalles || clientData.details || '',
        ...clientData // Mantener otras props
      };
    });
    
    console.log(`[ClientsAPI] Clientes procesados exitosamente: ${parsedClients.length}`);
    return parsedClients;
    
  } catch (error) {
    console.error("[ClientsAPI] Error fatal cargando clientes:", error);
    throw error;
  }
};

export const fetchClientByPhone = async (phone) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  const db = getDatabase();
  const sanitizedPhone = sanitizeFirebaseKey(phone);
  const clientRef = ref(db, `${LOCAL_ID}/CLIENTES/${sanitizedPhone}`);
  
  return new Promise((resolve, reject) => {
    onValue(clientRef, (snapshot) => {
      resolve(snapshot.val());
    }, (error) => {
      console.error("[ClientsAPI] Error fetching client by phone:", error);
      reject(error);
    }, { onlyOnce: true });
  });
};

export const saveClient = async (clientData) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  if (!clientData.phone) {
    throw new Error("El teléfono es obligatorio para guardar un cliente.");
  }
  try {
    const db = getDatabase();
    const sanitizedPhone = sanitizeFirebaseKey(clientData.phone);
    const clientRef = ref(db, `${LOCAL_ID}/CLIENTES/${sanitizedPhone}`);
    await set(clientRef, {
        nombre: clientData.nombre || '',
        direccion: clientData.direccion || '',
        entrecalle1: clientData.entrecalle1 || '',
        entrecalle2: clientData.entrecalle2 || '',
    });
    return { ...clientData, phone: sanitizedPhone };
  } catch (error) {
    console.error("[ClientsAPI] Error saving client:", error);
    throw error;
  }
};

export const deleteClient = async (phone) => {
  checkLocalId();
  const LOCAL_ID = getCurrentLocalId();
  try {
    const db = getDatabase();
    const sanitizedPhone = sanitizeFirebaseKey(phone);
    const clientRef = ref(db, `${LOCAL_ID}/CLIENTES/${sanitizedPhone}`);
    await remove(clientRef);
    return true;
  } catch (error) {
    console.error("[ClientsAPI] Error deleting client:", error);
    throw error;
  }
};

export const importClients = async (clients) => {
    checkLocalId();
    const LOCAL_ID = getCurrentLocalId();
    const db = getDatabase();
    const updates = {};

    clients.forEach(client => {
        if (client.phone) {
            const sanitizedPhone = sanitizeFirebaseKey(client.phone);
            if (sanitizedPhone) {
                const path = `/${LOCAL_ID}/CLIENTES/${sanitizedPhone}`;
                updates[path] = {
                    nombre: client.name || '',
                    direccion: client.address || '',
                    entrecalle1: client.cross_street1 || '',
                    entrecalle2: client.cross_street2 || '',
                };
            }
        }
    });

    if (Object.keys(updates).length === 0) {
        return Promise.resolve();
    }

    try {
        await update(ref(db), updates);
    } catch (error) {
        console.error("[ClientsAPI] Error importing clients:", error);
        throw error;
    }
};