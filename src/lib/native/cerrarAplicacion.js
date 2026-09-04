// Cierre real de la aplicación desde el renderer.
//
// Lo usa el botón SALIR de la pantalla de bloqueo por comisión impaga, donde
// "salir" tiene que dejar la aplicación cerrada y no devolver al login con la
// ventana abierta.
//
// NO usa window.close(): en Electron cierra la ventana sin terminar el proceso,
// y en un navegador ni siquiera funciona si la pestaña no la abrió un script.
// Se le pide al proceso principal por el MISMO canal IPC que ya usa el
// reinicio post-bootstrap (`electronAPI.relaunchApp`), agregando `quitApp`.
//
// Devuelve `true` si el cierre se pidió de verdad y `false` si en este entorno
// no hay forma de cerrar (por ejemplo la app servida en un navegador durante el
// desarrollo). El llamador decide qué hacer con ese `false`.
export const cerrarAplicacion = async () => {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.quitApp) {
      await window.electronAPI.quitApp();
      return true;
    }
  } catch (e) {
    console.warn('[cerrarAplicacion] No se pudo cerrar la aplicación:', e?.message);
  }
  return false;
};
