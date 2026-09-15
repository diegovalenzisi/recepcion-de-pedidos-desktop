// Módulo PURO: sin Firebase, sin imports. Se prueba directo con node:assert
// (mismo criterio que lib/print/paper.js). La resolución del rol REAL contra
// USUARIOS (que sí necesita Firebase) vive aparte, en lib/rolReal.js.

/**
 * Rol comparable: sin tildes, sin espacios sobrantes, en minúsculas.
 * Misma normalización que ya usaba CloseShiftModal — se comparte acá para que
 * cualquier gate por rol (Cerrar Turno, Retiro de Efectivo, etc.) trate
 * "Dueño", "dueño", "DUEÑO" y "dueno" como el mismo valor.
 */
export const normalizarRol = (rol) =>
  String(rol ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/**
 * Roles jerárquicos habilitados para RETIRO DE EFECTIVO. Ni cajero ni empleado.
 * OJO: van SIN tilde ('dueno', no 'dueño') porque se comparan contra el
 * resultado de normalizarRol(), que le quita los acentos — mismo criterio que
 * ROLES_SIN_SELECTOR en CloseShiftModal.jsx. Con tilde acá, ningún "dueño"
 * real (que normaliza a 'dueno') matchearía nunca.
 */
export const ROLES_AUTORIZADOS_RETIRO_EFECTIVO = ['dueno', 'encargado'];

/** ¿Este rol puede ver/ejecutar el Retiro de Efectivo? */
export const esRolAutorizadoRetiroEfectivo = (rol) =>
  ROLES_AUTORIZADOS_RETIRO_EFECTIVO.includes(normalizarRol(rol));
