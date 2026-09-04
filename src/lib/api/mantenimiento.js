// ---------------------------------------------------------------------------
// BLOQUEO DE MANTENIMIENTO
//
// Mientras el reset de "Finalizar pruebas" corre —unos segundos— ninguna
// operación comercial nueva puede entrar. Si entrara, quedaría a medio camino:
// una venta creada después de que el plan se calculó no está en el respaldo, y
// después del borrado su stock ya no cuadra con el estado base.
//
// EL FLAG
//
//     /{raiz}/CONFIGURACION/mantenimiento = { activo, resetId, desde, por }
//
// Vive en CONFIGURACION porque es configuración del local y porque esa rama YA
// se conserva en el reset: el flag no se borra a sí mismo a mitad de camino.
//
// CÓMO SE CONSULTA, Y POR QUÉ ASÍ
//
// Con una lectura puntual (`get`) al empezar cada operación, no con un
// listener. Un `onValue` de precarga fue exactamente lo que colgó el stock una
// vez: el listener se dispara antes de que la app esté lista y bloquea el
// arranque. Acá alcanza con un `get` de un booleano, que son milisegundos y
// solo ocurre cuando alguien aprieta "Cobrar", no en cada render.
//
// SI NO SE PUEDE LEER, SE DEJA PASAR. Es deliberado: el mantenimiento dura
// segundos y ocurre con el comercio cerrado. Bloquear una venta real porque
// falló una lectura de red sería mucho peor que el riesgo que evita.
// Módulo PURO: la decisión y los tipos. El acceso a Firebase vive en
// `mantenimientoApi.js`, para que esto se pueda probar con node:assert.
// ---------------------------------------------------------------------------

/**
 * Ruta del flag. VIVE FUERA DEL NODO DEL LOCAL, y eso es esencial.
 *
 * La restauración reemplaza /{localId} ENTERO. Si el flag viviera adentro (como
 * vivía, en CONFIGURACION/mantenimiento), la propia restauración lo borraría a
 * mitad de camino y las guardas dejarían de ver el bloqueo justo mientras se
 * está reescribiendo la base. Acá, junto al backup, sobrevive a la escritura y
 * se puede liberar después.
 *
 * Toma el localId, NO la raíz de datos: es un nodo hermano del local.
 */
export const RUTA_MANTENIMIENTO = (localId) => `BACKUP/${localId}/MANTENIMIENTO`;

/** Mensaje único, para que todas las pantallas digan lo mismo. */
export const MENSAJE_MANTENIMIENTO = 'El sistema se encuentra en mantenimiento. Esperá unos segundos.';

/** Error que lanzan las guardas. Se distingue por su `code`. */
export class MantenimientoActivoError extends Error {
  constructor(mensaje = MENSAJE_MANTENIMIENTO) {
    super(mensaje);
    this.name = 'MantenimientoActivoError';
    this.code = 'MANTENIMIENTO_ACTIVO';
  }
}

/** ¿Este error es un bloqueo por mantenimiento? */
export const esErrorDeMantenimiento = (e) => !!e && e.code === 'MANTENIMIENTO_ACTIVO';

/**
 * Decide si el flag leído bloquea. FUNCIÓN PURA.
 *
 * Solo `activo === true` bloquea. Un nodo ausente, `null`, `false`, o un objeto
 * sin `activo` dejan pasar: el bloqueo tiene que ser explícito.
 */
export const bloquea = (flag) => {
  if (flag === true) return true;                     // forma simple
  if (!flag || typeof flag !== 'object') return false;
  return flag.activo === true;
};
