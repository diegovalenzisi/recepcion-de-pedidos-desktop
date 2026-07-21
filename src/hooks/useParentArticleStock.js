import { useState, useEffect } from 'react';
import { ref, onValue, get } from 'firebase/database';
import { getCurrentLocalId, getCurrentDatabaseOrThrow } from '@/lib/firebase/core';
import { useFirebaseReadiness } from '@/hooks/useFirebaseReadiness';

// Cache to prevent excessive reads for the same parentId across multiple rows
const stockCache = {};

/**
 * Helper function to fetch a parent article's stock manually
 * @param {string} parentId - The ID of the parent article
 * @returns {Promise<{stock: number|null, parentExists: boolean, error?: string}>}
 */
export const fetchParentArticleStock = async (parentId) => {
    if (!parentId) return { stock: null, parentExists: false };

    try {
        const localId = getCurrentLocalId();
        if (!localId) return { stock: null, parentExists: false };

        const db = getCurrentDatabaseOrThrow(localId);
        const parentRef = ref(db, `${localId}/ARTICULOS/${parentId}`);

        const snapshot = await get(parentRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            const stock = data.stock?.propio !== undefined ? data.stock.propio : 0;
            return { stock, parentExists: true };
        }
        return { stock: null, parentExists: false };
    } catch (error) {
        console.error("Error fetching parent stock:", error);
        return { stock: null, parentExists: false, error: error.message };
    }
};

/**
 * Custom hook to subscribe to a parent article's stock in real-time
 * @param {string|null} parentId - The ID of the parent article to listen to
 */
export const useParentArticleStock = (parentId) => {
    const [state, setState] = useState({
        stock: stockCache[parentId]?.stock !== undefined ? stockCache[parentId].stock : null,
        loading: stockCache[parentId] === undefined && !!parentId,
        error: null,
        parentExists: stockCache[parentId]?.exists !== undefined ? stockCache[parentId].exists : false
    });
    // firebaseReady en las deps del efecto: se desuscribe apenas empieza un
    // cambio de local (antes de que la app vieja se borre) y solo vuelve a
    // suscribirse cuando el nuevo local está confirmado.
    const { ready: firebaseReady } = useFirebaseReadiness();

    useEffect(() => {
        if (!parentId) {
            setState({ stock: null, loading: false, error: null, parentExists: false });
            return;
        }

        const localId = getCurrentLocalId();
        if (!localId || !firebaseReady) {
            setState(s => ({ ...s, loading: false, error: !localId ? 'No local ID configured' : null }));
            return;
        }

        let db;
        try {
            db = getCurrentDatabaseOrThrow(localId);
        } catch (e) {
            setState(s => ({ ...s, loading: false, error: e.message }));
            return;
        }
        const parentRef = ref(db, `${localId}/ARTICULOS/${parentId}`);

        const unsubscribe = onValue(parentRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const stockVal = data.stock?.propio !== undefined ? data.stock.propio : 0;
                
                stockCache[parentId] = { exists: true, stock: stockVal };
                
                setState({
                    stock: stockVal,
                    loading: false,
                    error: null,
                    parentExists: true
                });
            } else {
                stockCache[parentId] = { exists: false, stock: null };
                
                setState({
                    stock: null,
                    loading: false,
                    error: null,
                    parentExists: false
                });
            }
        }, (error) => {
            console.error("Error in useParentArticleStock listener:", error);
            setState(s => ({ ...s, loading: false, error: error.message }));
        });

        return () => unsubscribe();
    }, [parentId, firebaseReady]);

    return state;
};