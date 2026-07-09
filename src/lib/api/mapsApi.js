import { getDatabase, ref, set, get, remove, update, push } from 'firebase/database';
import { getFirebaseUrl, getCurrentDatabasePath, checkLocalId } from '@/lib/firebase/core';

const mapsBase = (localId) => `${localId}/CONFIGURACION/maps`;

// ─── API Key ────────────────────────────────────────────────────────────────

export const fetchMapsApiKey = async () => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const url = `${getFirebaseUrl()}/${localId}/CONFIGURACION/maps/apiKey.json`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error('Error fetching maps API key');
        }
        const data = await response.json();
        return data || null;
    } catch (error) {
        console.error('Error fetching maps API key:', error);
        return null;
    }
};

export const saveMapsApiKey = async (apiKey) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const db = getDatabase();
    const keyRef = ref(db, `${mapsBase(localId)}/apiKey`);
    await set(keyRef, apiKey);
};

export const deleteMapsApiKey = async () => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const db = getDatabase();
    await remove(ref(db, `${mapsBase(localId)}/apiKey`));
};

// ─── Zonas Verdes ────────────────────────────────────────────────────────────

export const fetchZonasVerdes = async () => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const url = `${getFirebaseUrl()}/${localId}/CONFIGURACION/maps/zonasVerdes.json`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) return [];
            throw new Error('Error fetching zonas verdes');
        }
        const data = await response.json();
        if (!data) return [];
        return Object.keys(data).map(id => ({ id, ...data[id] }));
    } catch (error) {
        console.error('Error fetching zonas verdes:', error);
        return [];
    }
};

export const saveZonaVerde = async (zona) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const db = getDatabase();
    const zonasRef = ref(db, `${mapsBase(localId)}/zonasVerdes`);
    const newRef = push(zonasRef);
    const dataToSave = {
        nombre: zona.nombre,
        activa: zona.activa !== false,
        color: zona.color || '#22c55e',
        puntos: zona.puntos,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await set(newRef, dataToSave);
    return { id: newRef.key, ...dataToSave };
};

export const updateZonaVerde = async (zonaId, zonaData) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const db = getDatabase();
    const zonaRef = ref(db, `${mapsBase(localId)}/zonasVerdes/${zonaId}`);
    const updates = {
        nombre: zonaData.nombre,
        activa: zonaData.activa !== false,
        color: zonaData.color || '#22c55e',
        puntos: zonaData.puntos,
        updatedAt: new Date().toISOString(),
    };
    await update(zonaRef, updates);
    return { id: zonaId, ...updates };
};

export const deleteZonaVerde = async (zonaId) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const db = getDatabase();
    await remove(ref(db, `${mapsBase(localId)}/zonasVerdes/${zonaId}`));
};

export const toggleZonaVerde = async (zonaId, activa) => {
    checkLocalId();
    const localId = getCurrentDatabasePath();
    const db = getDatabase();
    const zonaRef = ref(db, `${mapsBase(localId)}/zonasVerdes/${zonaId}`);
    await update(zonaRef, { activa, updatedAt: new Date().toISOString() });
};
