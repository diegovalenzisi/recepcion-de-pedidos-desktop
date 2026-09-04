// ---------------------------------------------------------------------------
// IMAGEN COMPLETA DEL LOCAL — snapshot total y restauración total.
//
// EL CONCEPTO, Y POR QUÉ REEMPLAZÓ AL ANTERIOR
//
// Antes esto era un reset selectivo: una lista de ramas a borrar, otra de
// contadores a reiniciar, y el stock restaurado dato por dato. Cada rama nueva
// que apareciera en Firebase quedaba fuera de esa lista y sobrevivía al reset
// sin que nadie se enterara.
//
// Ahora la verdad es UNA SOLA: una copia completa del nodo del local, tomada
// cuando el comercio terminó de configurarse.
//
//     lo que existía al sacar la imagen  →  vuelve
//     lo que apareció después            →  desaparece
//
// No hay clasificación, no hay listas, no hay decisiones. Nada que mantener
// cuando el modelo de datos cambie.
//
// DÓNDE VIVE LA COPIA
//
//     BACKUP/{localId}/IMAGEN        la copia completa de /{localId}
//     BACKUP/{localId}/METADATA      cuándo, quién, qué versión, cuánto pesa
//     BACKUP/{localId}/MANTENIMIENTO el lock, mientras dura la restauración
//
// FUERA de /{localId}, y eso es deliberado: la restauración reemplaza el nodo
// del local entero, así que todo lo que tenga que sobrevivir a esa escritura
// tiene que estar afuera. Si el lock viviera en /{localId}/CONFIGURACION, la
// propia restauración lo borraría a mitad de camino y las guardas dejarían de
// ver el bloqueo justo mientras se reescribe la base.
//
// Módulo PURO: sin Firebase, sin DOM. Se prueba con node:assert.
// ---------------------------------------------------------------------------

/** Versión del formato de la imagen. Si cambia, una imagen vieja se rechaza. */
export const SCHEMA_VERSION = 1;

/** Raíz del backup de un local. SIEMPRE fuera del nodo del local. */
export const RUTA_BACKUP = (localId) => `BACKUP/${localId}`;

/** La copia completa. */
export const RUTA_IMAGEN = (localId) => `${RUTA_BACKUP(localId)}/IMAGEN`;

/** Datos SOBRE la copia. No forma parte de lo que se restaura. */
export const RUTA_METADATA = (localId) => `${RUTA_BACKUP(localId)}/METADATA`;

/**
 * LÍMITE DE TAMAÑO.
 *
 * Una escritura del SDK de Firebase no puede superar los 16 MB. Como la imagen
 * se escribe y se restaura de una sola vez, un local más pesado que eso no se
 * puede copiar ni restaurar entero: la escritura fallaría a mitad de camino.
 *
 * El margen es real: 12 MB deja lugar para el crecimiento del JSON al
 * serializar. Un comercio en período de prueba pesa muy por debajo (un local
 * recién configurado ronda 1-2 MB); los que superan esto son locales con años
 * de historia, que no son el caso de uso de esta función.
 *
 * Se corta ANTES de escribir, con un mensaje que explica el motivo, en vez de
 * dejar una imagen incompleta o una restauración a medias.
 */
export const LIMITE_BYTES = 12 * 1024 * 1024;

/** Peso aproximado de la imagen ya serializada. */
export const medirImagen = (imagen) => {
  try {
    return JSON.stringify(imagen ?? null).length;
  } catch {
    return Infinity;   // referencias circulares o algo peor: no se puede escribir
  }
};

/** Bytes en un texto legible. */
export const enMB = (bytes) =>
  (!Number.isFinite(bytes) ? '?' : (bytes / 1024 / 1024).toFixed(1)) + ' MB';

// ---------------------------------------------------------------------------
// METADATA
// ---------------------------------------------------------------------------

/**
 * Datos SOBRE la imagen. Nunca se restauran: describen la copia, no el local.
 *
 * `creadaEn` y `creadaEnMs` salen del MISMO valor, para que no puedan discrepar.
 */
export const construirMetadata = ({
  localId, databasePathOriginal, versionSistema = '', creadaPor = '',
  bytes = 0, ramas = [], ahora = Date.now(),
} = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  localId: String(localId ?? ''),
  databasePathOriginal: String(databasePathOriginal ?? ''),
  creadaEn: new Date(ahora).toISOString(),
  creadaEnMs: ahora,
  versionSistema: String(versionSistema ?? ''),
  creadaPor: String(creadaPor ?? ''),
  bytes,
  // Las ramas de primer nivel que quedaron capturadas. Es lo que la pantalla
  // muestra ("53 ramas") y lo que permite ver de un vistazo si la copia salió
  // completa o quedó en la mitad.
  ramas: [...ramas].sort(),
  cantidadRamas: ramas.length,
});

// ---------------------------------------------------------------------------
// VALIDACIÓN
// ---------------------------------------------------------------------------

/**
 * ¿Esta imagen sirve para restaurar?
 *
 * Se llama ANTES de tocar nada. Si sale `ok:false`, la restauración aborta y el
 * local queda intacto.
 */
export const validarImagen = (imagen, metadata, localId = null) => {
  const problemas = [];

  if (imagen === null || imagen === undefined) {
    return { ok: false, problemas: ['No hay ninguna imagen de la base de datos.'] };
  }
  if (typeof imagen !== 'object' || Array.isArray(imagen)) {
    return { ok: false, problemas: ['La imagen está corrupta: no es un nodo de base de datos.'] };
  }
  if (Object.keys(imagen).length === 0) {
    // Restaurar una imagen vacía dejaría el local sin absolutamente nada.
    return { ok: false, problemas: ['La imagen está vacía: restaurarla borraría todo el local.'] };
  }

  if (!metadata || typeof metadata !== 'object') {
    problemas.push('La imagen no tiene metadata: no se sabe de qué local ni de cuándo es.');
  } else {
    if (metadata.schemaVersion !== SCHEMA_VERSION) {
      problemas.push(
        `La imagen es de un formato distinto (schemaVersion ${metadata.schemaVersion ?? 'ausente'}, `
        + `se esperaba ${SCHEMA_VERSION}). Volvé a crearla.`,
      );
    }
    if (!metadata.creadaEn) problemas.push('La imagen no dice cuándo se creó.');
    // Restaurar la imagen de OTRO comercio sobre este sería catastrófico.
    if (localId && metadata.localId && String(metadata.localId) !== String(localId)) {
      problemas.push(`La imagen es del local ${metadata.localId}, no del ${localId}.`);
    }
  }

  const bytes = medirImagen(imagen);
  if (bytes > LIMITE_BYTES) {
    problemas.push(
      `La imagen pesa ${enMB(bytes)} y el máximo que Firebase acepta en una sola `
      + `escritura es ${enMB(LIMITE_BYTES)}. No se puede restaurar de una vez.`,
    );
  }

  return { ok: problemas.length === 0, problemas, bytes };
};

/** ¿El local es lo bastante chico como para copiarlo entero? */
export const validarTamanoParaCopiar = (nodo) => {
  const bytes = medirImagen(nodo);
  if (bytes > LIMITE_BYTES) {
    return {
      ok: false,
      bytes,
      motivo: `Este local pesa ${enMB(bytes)}. La imagen completa no puede superar `
        + `${enMB(LIMITE_BYTES)}, que es el máximo de una escritura de Firebase. `
        + 'Esta función está pensada para un comercio en período de prueba, no para '
        + 'uno con años de historial.',
    };
  }
  return { ok: true, bytes, motivo: '' };
};

// ---------------------------------------------------------------------------
// LA RESTAURACIÓN
// ---------------------------------------------------------------------------

/**
 * Arma el `update()` multipath que devuelve el local a la imagen.
 *
 * POR QUÉ UN UPDATE MULTIPATH Y NO UN `set` DEL NODO ENTERO:
 *
 * Los dos son atómicos, pero el multipath por rama permite además BORRAR lo que
 * apareció después de la imagen: cada rama que hoy existe y no está en la
 * imagen se escribe como `null`. Un `set` del nodo también las borraría, pero
 * el multipath deja el detalle explícito y auditable — se puede mirar la lista
 * de rutas antes de aplicarla.
 *
 * Y es una sola escritura: Firebase la aplica entera o no la aplica. No existe
 * el estado "mitad restaurado".
 *
 * @param {string} raiz            la raíz de datos del local (databasePath)
 * @param {object} imagen         la copia completa
 * @param {string[]} ramasActuales las ramas de primer nivel que hoy existen
 */
export const construirUpdateRestauracion = (raiz, imagen, ramasActuales = []) => {
  const updates = {};

  // 1) Todo lo que estaba en la imagen, vuelve tal cual.
  for (const [rama, contenido] of Object.entries(imagen || {})) {
    updates[`${raiz}/${rama}`] = contenido;
  }

  // 2) Todo lo que apareció DESPUÉS de la imagen, se va.
  for (const rama of ramasActuales) {
    if (!Object.prototype.hasOwnProperty.call(imagen || {}, rama)) {
      updates[`${raiz}/${rama}`] = null;
    }
  }

  return updates;
};

/**
 * Qué va a pasar, en números, para mostrarlo antes de confirmar.
 */
export const resumenDeRestauracion = (imagen, ramasActuales = []) => {
  const enImagen = Object.keys(imagen || {});
  const seBorran = ramasActuales.filter((r) => !enImagen.includes(r));
  const seRestauran = enImagen.filter((r) => ramasActuales.includes(r));
  const seRecrean = enImagen.filter((r) => !ramasActuales.includes(r));
  return {
    ramasEnImagen: enImagen.length,
    ramasQueSeRestauran: seRestauran.length,
    ramasQueSeRecrean: seRecrean.length,
    ramasQueSeBorran: seBorran.length,
    nombresQueSeBorran: seBorran.sort(),
  };
};

// ---------------------------------------------------------------------------
// VERIFICACIÓN POSTERIOR
// ---------------------------------------------------------------------------

/**
 * ¿El local quedó igual a la imagen?
 *
 * Compara el JSON serializado de cada rama. Es una comparación real del
 * contenido, no un conteo: si una rama volvió distinta, se ve cuál.
 *
 * `null` y ausente se tratan igual: Firebase no distingue entre una rama
 * borrada y una que nunca existió.
 */
export const compararConImagen = (imagen, restaurado) => {
  const fallas = [];
  const norm = (v) => (v === undefined ? null : v);
  const claves = new Set([
    ...Object.keys(imagen || {}),
    ...Object.keys(restaurado || {}),
  ]);

  for (const rama of claves) {
    const esperado = norm((imagen || {})[rama]);
    const obtenido = norm((restaurado || {})[rama]);
    if (esperado === null && obtenido === null) continue;
    if (JSON.stringify(esperado) !== JSON.stringify(obtenido)) {
      fallas.push(
        esperado === null
          ? `La rama ${rama} no se borró: no estaba en la imagen.`
          : obtenido === null
            ? `La rama ${rama} no se restauró: quedó vacía.`
            : `La rama ${rama} quedó distinta de la imagen.`,
      );
    }
  }

  return { ok: fallas.length === 0, fallas };
};
