import { getFirebaseUrl, getCurrentLocalId, checkLocalId } from '@/lib/firebase/core';

const getCounterUrl = (type) => {
    const LOCAL_ID = getCurrentLocalId();
    const API_URL = getFirebaseUrl();

    if (LOCAL_ID === '38827976') {
        return `${API_URL}/${LOCAL_ID}/CONTADORES/${type}.json`;
    }
    
    return `${API_URL}/${LOCAL_ID}/CONTADORES/${type}.json`;
};

export const incrementCounter = async (type) => {
    checkLocalId();
    
    if (type !== 'DELIVERY' && type !== 'MOSTRADOR') {
        throw new Error('Tipo de contador inválido. Debe ser DELIVERY o MOSTRADOR.');
    }

    const counterUrl = getCounterUrl(type);

    try {
        const getResponse = await fetch(counterUrl);
        if (!getResponse.ok && getResponse.status !== 404) {
            throw new Error(`Error al leer el contador: ${getResponse.statusText}`);
        }
        
        const currentValue = await getResponse.json();
        const newValue = (currentValue || 0) + 1;

        const putResponse = await fetch(counterUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newValue),
        });

        if (!putResponse.ok) {
            throw new Error(`Error al actualizar el contador: ${putResponse.statusText}`);
        }

        return await putResponse.json();
    } catch (error) {
        console.error(`Error al incrementar el contador ${type}:`, error);
        throw error;
    }
};