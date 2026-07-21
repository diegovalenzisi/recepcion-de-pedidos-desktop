import { useSyncExternalStore } from 'react';
import { getFirebaseReadinessSnapshot, subscribeFirebaseReadiness } from '@/lib/firebase/core';

// useSyncExternalStore es la API correcta de React para suscribirse a un
// store que vive FUERA de React (core.js, para que hooks/funciones de
// lib/api/* puedan leerlo sin pasar por Context). getFirebaseReadinessSnapshot()
// devuelve siempre el MISMO objeto hasta el próximo cambio real -- requisito
// de useSyncExternalStore para no re-renderizar de más.
export const useFirebaseReadiness = () => useSyncExternalStore(subscribeFirebaseReadiness, getFirebaseReadinessSnapshot);
