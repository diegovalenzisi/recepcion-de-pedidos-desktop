import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { isFirebaseSwitching, isFirebaseReady, getFirebaseGeneration, FirebaseNotReadyError } from './readiness.js';

const BASE_URL_DEFAULT    = "https://achava3703-default-rtdb.firebaseio.com";
const BASE_URL_TEMPERLEY  = "https://bdtemperley-default-rtdb.firebaseio.com";
const BASE_URL_CENTENARIO = "https://centenario1199-default-rtdb.firebaseio.com";
const BASE_URL_BURANO     = "https://buranoheladerias-default-rtdb.firebaseio.com";
const BASE_URL_CANADA     = "https://lanyulinacanada-default-rtdb.firebaseio.com";
const BASE_URL_BYNNON     = "https://heladeriabynnonadrogue-default-rtdb.firebaseio.com";
const BASE_URL_ILCAPO     = "https://ilcapogelatojls2026-default-rtdb.firebaseio.com";

const STORAGE_BUCKET_DEFAULT    = "achava3703.firebasestorage.app";
const STORAGE_BUCKET_TEMPERLEY  = "bdtemperley.firebasestorage.app";
const STORAGE_BUCKET_CENTENARIO = "centenario1199.firebasestorage.app";
const STORAGE_BUCKET_CANADA     = "lanyulinacanada.firebasestorage.app";
const STORAGE_BUCKET_BURANO     = "buranoheladerias.firebasestorage.app";
const STORAGE_BUCKET_ILCAPO     = "ilcapogelatojls2026.firebasestorage.app";

const API_KEY_DEFAULT    = import.meta.env.VITE_API_KEY_DEFAULT    || "AIzaSyDFsKxM8F5v9YqJxT8pYxQZvLzRxNmWqKs";
const API_KEY_TEMPERLEY  = import.meta.env.VITE_API_KEY_TEMPERLEY  || "AIzaSyBxYqJ8pWxFzT9KvLmNqRzPyDtCxWvXyUs";
const API_KEY_CENTENARIO = import.meta.env.VITE_API_KEY_CENTENARIO || "AIzaSyCxZqK9qXyGzU0LwNmOsRpTzQyExWyYzVt";
const API_KEY_CANADA     = import.meta.env.VITE_API_KEY_CANADA     || "AIzaSyDyArL0rYzHaV1MxPnQtSzRyFxGxXzZaWu";

const PROJECT_ID_DEFAULT    = "achava3703";
const PROJECT_ID_TEMPERLEY  = "bdtemperley";
const PROJECT_ID_CENTENARIO = "centenario1199";
const PROJECT_ID_CANADA     = "lanyulinacanada";
const PROJECT_ID_BURANO     = "buranoheladerias";
const PROJECT_ID_ILCAPO     = "ilcapogelatojls2026";

// Tabla centralizada de configuración por local.
// Antes había 6 switch statements idénticos — ahora hay uno solo.
const LOCATION_CONFIG = {
    '40508022': { dbUrl: BASE_URL_DEFAULT,    storage: STORAGE_BUCKET_DEFAULT,    apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_DEFAULT    },
    '38827976': { dbUrl: BASE_URL_TEMPERLEY,  storage: STORAGE_BUCKET_TEMPERLEY,  apiKey: API_KEY_TEMPERLEY,  projectId: PROJECT_ID_TEMPERLEY  },
    '51501748': { dbUrl: BASE_URL_CENTENARIO, storage: STORAGE_BUCKET_CENTENARIO, apiKey: API_KEY_CENTENARIO, projectId: PROJECT_ID_CENTENARIO },
    '25230974': { dbUrl: BASE_URL_BURANO,     storage: STORAGE_BUCKET_BURANO,     apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_BURANO     },
    '34734081': { dbUrl: BASE_URL_CANADA,     storage: STORAGE_BUCKET_CANADA,     apiKey: API_KEY_CANADA,     projectId: PROJECT_ID_CANADA     },
    '34516605': { dbUrl: BASE_URL_BYNNON,     storage: STORAGE_BUCKET_DEFAULT,    apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_DEFAULT    },
    '31915636': { dbUrl: BASE_URL_ILCAPO,     storage: STORAGE_BUCKET_ILCAPO,     apiKey: API_KEY_DEFAULT,    projectId: PROJECT_ID_ILCAPO     },
};

const DEFAULT_CONFIG = LOCATION_CONFIG['40508022'];

// Permite distinguir "local ya conocido en la tabla hardcodeada" de "local
// nuevo" SIN exponer la tabla completa — para no precargar por error los
// datos de Achaval (el fallback) como si fueran los de un local desconocido.
export const isKnownLocationConfig = (localId) => Object.prototype.hasOwnProperty.call(LOCATION_CONFIG, localId);

// ---------------------------------------------------------------------------
// Override de rutas configurable por local (pantalla de configuración inicial,
// guardado en https://achava3703-default-rtdb.firebaseio.com/rutas/{localId}/).
// Se cachea en memoria + localStorage para que getConfig() siga siendo 100%
// SÍNCRONA (la usan ~50 archivos con fetch() inmediato) — la única llamada
// async real ocurre una vez, en la pantalla de configuración, que llama a
// applyRoutesOverride() para que quede disponible sincrónicamente de ahí en más.
// ---------------------------------------------------------------------------
const ROUTES_OVERRIDE_KEY_PREFIX = 'firebaseRoutesOverride_';
const overrideCache = {}; // { [localId]: { databaseURL, databasePath, storageBucket, storageBasePath, apiKey, projectId } }

const readOverrideFromStorage = (localId) => {
  try {
    const raw = localStorage.getItem(`${ROUTES_OVERRIDE_KEY_PREFIX}${localId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getOverride = (localId) => {
  if (!localId) return null;
  if (overrideCache[localId] !== undefined) return overrideCache[localId];
  const stored = readOverrideFromStorage(localId);
  overrideCache[localId] = stored; // cachea también el "no hay override" (null)
  return stored;
};

/**
 * Aplica (y persiste localmente) el override de rutas de un local, resultado
 * de guardar desde la pantalla de configuración o de sincronizar desde
 * /rutas/{localId} en el arranque. NO escribe en Firebase — eso lo hace
 * localConfigApi.saveLocalRoutes(); esta función solo actualiza la caché local
 * que consume getConfig().
 */
export const applyRoutesOverride = (localId, routes) => {
  if (!localId || !routes) return;
  overrideCache[localId] = routes;
  try {
    localStorage.setItem(`${ROUTES_OVERRIDE_KEY_PREFIX}${localId}`, JSON.stringify(routes));
  } catch (e) {
    console.warn('[core] No se pudo persistir el override de rutas en localStorage:', e.message);
  }
};

/** Devuelve el override crudo (tal cual quedó guardado) o null si no hay. Uso: precargar el form. */
export const getRoutesOverride = (localId) => getOverride(localId);

const getConfig = (localId) => {
  const override = getOverride(localId);
  if (override?.databaseURL) {
    const base = LOCATION_CONFIG[localId] ?? DEFAULT_CONFIG;
    return {
      dbUrl:     override.databaseURL,
      storage:   override.storageBucket || base.storage,
      // apiKey/projectId son técnicos: si el override no los trae (caso normal
      // para un local YA existente en LOCATION_CONFIG), se resuelven solos.
      apiKey:    override.apiKey    || base.apiKey,
      projectId: override.projectId || base.projectId,
    };
  }
  return LOCATION_CONFIG[localId] ?? DEFAULT_CONFIG;
};

// databasePath resuelto: el override lo trae explícito; si no hay override,
// el comportamiento actual (implícito en todo el código existente) es que la
// raíz de datos = el propio número de local. Getter nuevo, listo para usar,
// pero TODAVÍA NO conectado en las llamadas de pedidos/caja/stock/facturación/
// ventas/historial (eso requiere tocar esos ~50 call sites, fuera de alcance
// de este cambio).
export const getLocationSpecificDatabasePath = (localId) => {
  const override = getOverride(localId);
  return override?.databasePath || localId;
};
// Raíz OFICIAL de la base de datos del local actual: databaseURL + "/" + <esto>.
// Resuelve el id tanto desde la variable de módulo (getCurrentLocalId, seteada
// por checkLocalId) como desde localStorage (getLocalId), para funcionar en
// todos los archivos de src/lib/api independientemente de cuál usaran antes.
export const getCurrentDatabasePath = () => getLocationSpecificDatabasePath(getCurrentLocalId() || getLocalId());

// storageBasePath resuelto: mismo criterio que databasePath — se guarda y se
// puede leer, pero storage.js todavía no lo usa para componer rutas de subida.
export const getLocationSpecificStorageBasePath = (localId) => getOverride(localId)?.storageBasePath || '';

let LOCAL_ID = null;

export const getLocalId = () => localStorage.getItem('localId');

export const getFirebaseUrl = () => getConfig(getLocalId()).dbUrl;

export const getLocationSpecificDatabaseURL = (localId) => getConfig(localId).dbUrl;
export const getLocationSpecificStorageBucket = (localId) => getConfig(localId).storage;
export const getLocationSpecificProjectId = (localId) => getConfig(localId).projectId;

export const setFirebaseLocalId = (localId) => {
  LOCAL_ID = localId;
};

export const setLocalId = (localId) => localStorage.setItem('localId', localId);
export const clearLocalId = () => localStorage.removeItem('localId');
export const getCurrentLocalId = () => LOCAL_ID;

export const checkLocalId = () => {
  if (!LOCAL_ID) {
    const storedId = getLocalId();
    if (storedId) {
      setFirebaseLocalId(storedId);
    } else {
      console.warn("El ID de local no está configurado.");
    }
  }
};

let currentDBURL = null;
let currentStorageBucket = null;

// Devuelve la app Firebase '[DEFAULT]' si existe, o null. NO usar getApps()[0]:
// puede haber apps con NOMBRE (ej. 'routes-config-db' de localConfigApi) creadas
// antes que la default, y getApps()[0] devolvería esa por error.
const getDefaultAppOrNull = () => getApps().find((a) => a.name === '[DEFAULT]') || null;

// Compartida entre ensureFirebaseAppSync() e initializeFirebaseApp() — antes
// solo la primera validaba esto, así que un config incompleto (ej. apiKey
// vacío por un override guardado a medias) podía ser rechazado por una pero
// aceptado por la otra, dependiendo de cuál se llamara. Un firebaseConfig
// técnicamente "completo" pero con apiKey vacío no falla en initializeApp()
// (no valida credenciales al crear el objeto) — solo se notaría más tarde,
// al intentar conectar. Se corta acá, antes de crear la app.
const isCompleteFirebaseConfig = (firebaseConfig) =>
  !!(firebaseConfig.databaseURL && firebaseConfig.apiKey && firebaseConfig.projectId);

// Inicialización SINCRÓNICA y segura de la app Firebase '[DEFAULT]' — mismo
// patrón que getApps().length > 0 ? getApp() : initializeApp(config), pero
// usando getDefaultAppOrNull() (arriba) en vez de getApps() a secas, porque
// este proyecto también crea apps CON NOMBRE (ej. 'routes-config-db') y
// getApps().length > 0 sería true sin que exista la default — getApp() con
// esa condición explotaría con el mismo error app/no-app que se busca evitar.
//
// A diferencia de initializeFirebaseApp() (async, porque además maneja el
// caso de CAMBIAR de local borrando la app anterior con otra config),
// initializeApp() en sí es sincrónico — por eso esta función no necesita
// awaits y puede llamarse como PRIMER paso del arranque, antes de cualquier
// operación async no relacionada (IPC, fetch, etc.), cerrando la ventana en
// la que localId ya está seteado pero la app default todavía no existe. Los
// servicios deben pedirse siempre pasándole la instancia que devuelve:
//   const app = ensureFirebaseAppSync();
//   const database = app && getDatabase(app);
//
// SEGURIDAD MULTI-LOCAL: si ya existe una app '[DEFAULT]', NUNCA se devuelve
// a ciegas — se verifica que su databaseURL/storageBucket coincidan con los
// del localId pedido. Si no coinciden (típicamente: el usuario cambió de
// local hace un instante y initializeFirebaseApp() todavía no terminó de
// borrar la app vieja y crear la nueva), se devuelve null en vez de la app
// del local ANTERIOR — un caller que reciba null simplemente no se suscribe
// todavía (se recupera solo en el próximo montaje/llamada), lo cual es
// preferible a leer o escribir en el Firebase equivocado.
export const ensureFirebaseAppSync = (localId = getLocalId()) => {
  if (!localId) return null;

  const config = getConfig(localId);
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };

  // Config incompleta (defensivo — getConfig() ya resuelve fallbacks, pero un
  // override guardado a medias en localStorage podría faltar algún campo):
  // no inicializar con datos parciales.
  if (!isCompleteFirebaseConfig(firebaseConfig)) {
    console.error('[core] ensureFirebaseAppSync: firebaseConfig incompleta para localId', localId, firebaseConfig);
    return null;
  }

  const existing = getDefaultAppOrNull();
  if (existing) {
    const matchesRequestedLocal =
      existing.options.databaseURL === firebaseConfig.databaseURL &&
      existing.options.storageBucket === firebaseConfig.storageBucket;
    // Coincide: reusar (evita "Firebase App named '[DEFAULT]' already exists").
    // NO coincide: es la app de OTRO local (cambio de local en curso) —
    // devolver null, nunca la app equivocada.
    return matchesRequestedLocal ? existing : null;
  }

  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  try {
    return initializeApp(firebaseConfig);
  } catch (e) {
    console.error("Firebase initialization error:", e);
    return null;
  }
};

export const initializeFirebaseApp = async () => {
  const localId = getLocalId();

  if (!localId) {
    return null;
  }

  const config = getConfig(localId);
  // IMPORTANTE: storageBucket es SOLO el bucket (ej. "achava3703.firebasestorage.app").
  // El storageBasePath NUNCA se concatena acá — se guarda aparte para rutas internas.
  const firebaseConfig = {
    apiKey: config.apiKey,
    projectId: config.projectId,
    databaseURL: config.dbUrl,
    storageBucket: config.storage,
  };

  // Misma validación que ensureFirebaseAppSync() — antes solo esa la tenía,
  // así que un config incompleto podía ser rechazado por una y aceptado por
  // la otra según cuál se llamara primero.
  if (!isCompleteFirebaseConfig(firebaseConfig)) {
    console.error('[core] initializeFirebaseApp: firebaseConfig incompleta para localId', localId, firebaseConfig);
    return null;
  }

  const defaultApp = getDefaultAppOrNull();

  if (
    defaultApp &&
    currentDBURL === firebaseConfig.databaseURL &&
    currentStorageBucket === firebaseConfig.storageBucket
  ) {
    return defaultApp;
  }

  currentDBURL = firebaseConfig.databaseURL;
  currentStorageBucket = firebaseConfig.storageBucket;

  if (defaultApp) {
    if (
      defaultApp.options.databaseURL !== firebaseConfig.databaseURL ||
      defaultApp.options.storageBucket !== firebaseConfig.storageBucket
    ) {
      try {
        await deleteApp(defaultApp);
      } catch (err) {
        console.error("Error eliminando app Firebase anterior:", err);
        return null;
      }
    } else {
      return defaultApp;
    }
  }

  try {
    // initializeApp SIN nombre crea la app '[DEFAULT]' (coexiste con las nombradas).
    return initializeApp(firebaseConfig);
  } catch (e) {
    console.error("Firebase initialization error:", e);
    return null;
  }
};

// SIEMPRE sincrónica: devuelve FirebaseApp o null, NUNCA una Promise. Antes
// podía devolver initializeFirebaseApp() (una Promise) cuando no había app
// todavía, así que un caller sin await recibía un objeto Promise en vez de
// la app — ej. storage.js hacía `getStorage(getFirebaseApp())` sin await, lo
// que en ese caso le pasaba una Promise a getStorage(). Ahora es un simple
// alias de ensureFirebaseAppSync(), que ya es sincrónica y segura (nunca
// devuelve la app de OTRO local). Los callers existentes (storage.js,
// whatsappMessageApi.js) no necesitan cambiar su forma de llamarla.
export const getFirebaseApp = (localId = getLocalId()) => ensureFirebaseAppSync(localId);

// Estado central de disponibilidad — vive en readiness.js (SIN import.meta.env)
// para poder testearlo directo con node:assert, sin tener que replicar su
// lógica en un test. Re-exportado acá para no cambiar cómo lo importa el
// resto del código (App.jsx, hooks, etc. siguen usando '@/lib/firebase/core').
export {
  getFirebaseReadinessSnapshot,
  subscribeFirebaseReadiness,
  markFirebaseSwitching,
  markFirebaseReady,
  markFirebaseError,
  isFirebaseReady,
  isFirebaseSwitching,
  getFirebaseGeneration,
  FirebaseNotReadyError,
} from './readiness.js';

/**
 * ÚNICO punto seguro para obtener el Database del local ACTUAL. Reemplaza a
 * getDatabase() a secas en listeners persistentes (categoría A) y en código
 * de arranque (categoría C) — ver auditoría de getDatabase() bare.
 *
 * Verifica, en este orden: (1) que haya localId, (2) que Firebase no esté a
 * mitad de un cambio de local (isFirebaseSwitching()), (3) que exista una app
 * '[DEFAULT]' cuya config coincida con el localId pedido (ensureFirebaseAppSync
 * ya garantiza esto último — nunca devuelve la app de otro local). Si algo de
 * esto falla, lanza FirebaseNotReadyError en vez de dejar que getDatabase()
 * tire el crudo "No Firebase App '[DEFAULT]'" — el caller puede distinguirlo
 * (error.code === 'firebase/not-ready') y reintentar/esperar en vez de crashear.
 */
export const getCurrentDatabaseOrThrow = (localId = getCurrentLocalId() || getLocalId()) => {
  if (!localId) {
    throw new FirebaseNotReadyError('No hay ningún local configurado todavía.');
  }
  if (isFirebaseSwitching()) {
    throw new FirebaseNotReadyError('Firebase está cambiando de local — todavía no se puede leer ni escribir.');
  }
  const app = ensureFirebaseAppSync(localId);
  if (!app) {
    throw new FirebaseNotReadyError('Firebase todavía no está listo para este local.');
  }
  return getDatabase(app);
};

/**
 * Protección central para operaciones asíncronas con un await de por medio
 * (guardar con una subida de archivo/imagen previa, un fetch externo antes de
 * escribir, etc.). El riesgo que cierra: se arranca en el local A, la función
 * obtiene su db/ref, queda esperando un await, el usuario cambia al local B, y
 * la función continúa y escribe en A (o escribe en B con datos pensados para
 * A) — un simple chequeo de "hay localId" en ese punto no alcanza porque
 * puede haber un localId B perfectamente válido, solo que no es el que la
 * operación empezó a procesar.
 *
 * Uso: al EMPEZAR la operación (antes del primer await real) se llama
 * beginFirebaseOperation() para capturar el local y la generación vigentes en
 * ese instante. Antes de CADA escritura definitiva se llama a
 * op.getDatabaseOrAbort(), que revalida: Firebase sigue ready, no está
 * cambiando de local, el localId no cambió, y la generación (que sube en cada
 * markFirebaseSwitching(), es decir en cada cambio de local) tampoco cambió.
 * Si algo cambió, lanza FirebaseNotReadyError — el caller debe atraparlo y
 * abortar sin escribir, nunca ignorarlo.
 *
 * Deliberadamente NO se aplica a los ~146 call sites de getDatabase()/
 * getCurrentDatabaseOrThrow() que resuelven la db y escriben en el mismo tick
 * sin ningún await intermedio real: ahí no hay ventana de carrera que cerrar,
 * y agregar esto ahí sería ceremonia sin beneficio. Se usa quirúrgicamente
 * solo en los flujos que sí tienen un await genuino entre "obtener db" y
 * "escribir" (ver auditoría de operaciones en vuelo).
 */
/**
 * TRES CONCEPTOS DISTINTOS que NO hay que confundir (hoy suelen coincidir, y
 * justamente por eso el error pasaba desapercibido):
 *
 *   localId       — identidad del comercio ("40508022"). Es lo que se compara
 *                   para saber si el usuario cambió de local.
 *   databasePath  — raíz de datos DENTRO de la base ({localId} por defecto, o
 *                   `databasePath` si el local tiene override de rutas). Es lo
 *                   que se antepone a ARTICULOS/PEDIDOS/MOSTRADOR/…
 *   databaseURL   — a QUÉ base de Firebase se conecta.
 *
 * `beginFirebaseOperation` espera un **localId**. Pasarle un databasePath hacía
 * que `getDatabaseOrAbort()` comparara peras con manzanas y abortara TODAS las
 * escrituras de esa operación en cuanto los dos valores dejaran de coincidir —
 * es decir, en el primer local que configurara un override de rutas: ni ventas,
 * ni stock, ni caja.
 *
 * Se normaliza en vez de explotar: si llega el databasePath del local activo se
 * resuelve al localId real y se deja un error en consola para corregir el call
 * site. Un localId genuinamente distinto se respeta tal cual (esa operación SÍ
 * debe abortar: empezó en otro local).
 */
const normalizarLocalIdDeOperacion = (valor) => {
  const activo = getCurrentLocalId() || getLocalId();
  if (!valor || valor === activo) return valor;
  if (String(valor) === String(getLocationSpecificDatabasePath(activo))) {
    console.error(
      '[core] beginFirebaseOperation recibió un databasePath ("%s") donde espera un localId ("%s"). ' +
      'Se corrige automáticamente, pero hay que arreglar el call site.', valor, activo,
    );
    return activo;
  }
  return valor;
};

export const beginFirebaseOperation = (localIdRecibido = getCurrentLocalId() || getLocalId()) => {
  const localId = normalizarLocalIdDeOperacion(localIdRecibido);
  const generation = getFirebaseGeneration();

  const getDatabaseOrAbort = () => {
    if (!isFirebaseReady()) {
      throw new FirebaseNotReadyError('Firebase no está listo — operación abortada (posible cambio de local en curso).');
    }
    if (isFirebaseSwitching()) {
      throw new FirebaseNotReadyError('Firebase está cambiando de local — operación abortada para evitar escribir en el local incorrecto.');
    }
    if (getFirebaseGeneration() !== generation) {
      throw new FirebaseNotReadyError('El local cambió mientras la operación estaba en curso — operación abortada para evitar escribir en el local incorrecto.');
    }
    const activeLocalId = getCurrentLocalId() || getLocalId();
    if (!localId || activeLocalId !== localId) {
      throw new FirebaseNotReadyError('El local activo cambió mientras la operación estaba en curso — operación abortada.');
    }
    // getCurrentDatabaseOrThrow ya revalida internamente switching/ready/localId,
    // así que esto además garantiza que la app/database devuelta corresponde
    // efectivamente a ESTE localId (nunca la de otro local a mitad de cambio).
    return getCurrentDatabaseOrThrow(localId);
  };

  return { localId, generation, getDatabaseOrAbort };
};

/**
 * Firebase Security Rules Documentation:
 *
 * /whatsappMessages/{delivererId}/ - readable/writable by authenticated users managing that deliverer
 * Message data structure: { lastMessage: string, createdAt: timestamp, updatedAt: timestamp, generatedBy: userId }
 * Each deliverer has isolated message storage
 */
