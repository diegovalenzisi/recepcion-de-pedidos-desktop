// Estado central de disponibilidad de Firebase durante el arranque y los
// cambios de local. Vive en un módulo SEPARADO de core.js (que tiene
// import.meta.env.VITE_* en el top-level y por eso no se puede importar
// directo en un test de Node puro) para que este archivo sí sea 100%
// testeable con node:assert sin necesidad de replicar su lógica.
//
// - "switching" = true mientras loadInitialData() (App.jsx) está en curso
//   (desde que arranca hasta que initializeFirebaseApp() resuelve, con éxito
//   o error).
// - "ready" = true solo cuando terminó con éxito y la app/database del local
//   actual están confirmadas.
// - "error" = mensaje si la última inicialización falló (para la pantalla de
//   Reintentar) — se limpia al empezar un nuevo intento.

let firebaseReadinessSnapshot = { ready: false, switching: false, error: null };
const firebaseReadinessSubscribers = new Set();

// Contador monotónico ("epoch") de cambios de local. Se incrementa UNA vez por
// cada llamada a markFirebaseSwitching(), es decir, al empezar cada cambio de
// local (incluyendo el arranque inicial). Las operaciones asíncronas con un
// await de por medio (guardar, subir archivos, etc.) capturan este número al
// empezar y lo vuelven a comparar justo antes de escribir: si cambió, el local
// activo cambió mientras la operación estaba en vuelo y hay que abortar en vez
// de escribir en el local viejo (o en el nuevo con datos pensados para el
// viejo). Ver beginFirebaseOperation() en core.js.
let firebaseGeneration = 0;

const publishFirebaseReadiness = (next) => {
  firebaseReadinessSnapshot = next;
  firebaseReadinessSubscribers.forEach((cb) => {
    try { cb(); } catch { /* un subscriber roto no debe tumbar a los demás */ }
  });
};

/** Snapshot estable (mismo objeto hasta el próximo cambio) — apto para useSyncExternalStore. */
export const getFirebaseReadinessSnapshot = () => firebaseReadinessSnapshot;

export const subscribeFirebaseReadiness = (callback) => {
  firebaseReadinessSubscribers.add(callback);
  return () => firebaseReadinessSubscribers.delete(callback);
};

/** Llamado por App.jsx al empezar a cargar/cambiar de local. */
export const markFirebaseSwitching = () => {
  firebaseGeneration += 1;
  publishFirebaseReadiness({ ready: false, switching: true, error: null });
};

/** Generación/epoch actual. Sube en cada markFirebaseSwitching() (cada cambio de local). */
export const getFirebaseGeneration = () => firebaseGeneration;
/** Llamado por App.jsx cuando initializeFirebaseApp() resuelve con éxito. */
export const markFirebaseReady = () => publishFirebaseReadiness({ ready: true, switching: false, error: null });
/** Llamado por App.jsx si la inicialización falla — habilita la pantalla de Reintentar. */
export const markFirebaseError = (error) => publishFirebaseReadiness({
  ready: false,
  switching: false,
  error: (error && error.message) || String(error || 'Error desconocido al inicializar Firebase.'),
});

export const isFirebaseReady = () => firebaseReadinessSnapshot.ready;
export const isFirebaseSwitching = () => firebaseReadinessSnapshot.switching;

/** Error controlado y distinguible (código 'firebase/not-ready') — nunca el crudo app/no-app del SDK. */
export class FirebaseNotReadyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FirebaseNotReadyError';
    this.code = 'firebase/not-ready';
  }
}

// Solo para tests: vuelve al estado inicial entre casos, sin depender del
// orden de ejecución de los distintos bloques de un mismo archivo de test.
export const __resetFirebaseReadinessForTests = () => {
  firebaseGeneration = 0;
  publishFirebaseReadiness({ ready: false, switching: false, error: null });
};
