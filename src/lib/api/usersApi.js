import { getFirebaseUrl, checkLocalId, getCurrentLocalId } from '@/lib/firebase/core';

const USERS_PATH = 'USUARIOS';

// Fetch all users from Firebase
export const fetchUsers = async () => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const url = `${getFirebaseUrl()}/${localId}/${USERS_PATH}.json`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Error fetching users');
        const data = await response.json();
        if (!data) return [];
        
        const usersFromDb = Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        }));
        return usersFromDb;
    } catch (error) {
        console.error("Error fetching users:", error);
        return [];
    }
};

// Save a new user or update an existing one in Firebase
export const saveUser = async (userData, isUpdate = false) => {
    checkLocalId();
    const localId = getCurrentLocalId();
    const userId = userData.usuario; 

    if (userId === 'DiegoL') {
        throw new Error("No se puede modificar al usuario administrador.");
    }

    const url = `${getFirebaseUrl()}/${localId}/${USERS_PATH}/${userId}.json`;
    
    let finalUserData = { ...userData };

    if (isUpdate) {
        const userResponse = await fetch(url);
        if (!userResponse.ok) throw new Error('Could not fetch existing user to update.');
        const existingData = await userResponse.json();
        
        finalUserData = { ...existingData, ...userData };
        if (!userData.contrasena) {
            delete finalUserData.contrasena;
        }
    }

    const method = isUpdate ? 'PATCH' : 'PUT';

    const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalUserData),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to save user: ${errorData.error}`);
    }
    return { id: userId, ...finalUserData };
};

// Delete a user from Firebase
export const deleteUser = async (userId) => {
    checkLocalId();
    const localId = getCurrentLocalId();

    if (userId === 'DiegoL') {
        throw new Error("No se puede eliminar al usuario administrador.");
    }

    const url = `${getFirebaseUrl()}/${localId}/${USERS_PATH}/${userId}.json`;
    
    const response = await fetch(url, {
        method: 'DELETE',
    });

    if (!response.ok) {
        throw new Error('Failed to delete user');
    }
    
    return true;
};