import { fetchUsers } from '@/lib/api/usersApi';

/**
 * ROL REAL del usuario logueado, re-leído desde USUARIOS del local activo
 * (no desde sessionStorage, que puede haber quedado viejo si le cambiaron el
 * rol a alguien después de iniciar sesión). DiegoL es la excepción: es el
 * administrador del sistema y no está en USUARIOS, así que se resuelve sin
 * consultar nada (su `user.rol` de sesión ya es 'dueño').
 *
 * Se usa para VALIDAR antes de ejecutar una acción sensible (ej. confirmar un
 * Retiro de Efectivo) — nunca para decidir solo si se MUESTRA un botón, donde
 * alcanza con el rol de sesión (igual que el resto de la app). Mismo criterio
 * que ya usaba CloseShiftModal para "quién cierra el turno".
 */
export const resolverRolReal = async (user) => {
  if (!user) return null;
  if (user.usuario === 'DiegoL') return user.rol || 'dueño';
  try {
    const usuarios = await fetchUsers();
    const encontrado = usuarios.find((u) =>
      (user.id !== undefined && String(u.id) === String(user.id))
      || (user.usuario && u.usuario === user.usuario));
    return encontrado?.rol ?? user.rol ?? null;
  } catch (error) {
    console.warn('[rolReal] no se pudo releer el rol real, se usa el de sesión:', error?.message || error);
    return user.rol ?? null;
  }
};
