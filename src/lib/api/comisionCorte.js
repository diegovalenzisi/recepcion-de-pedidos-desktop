// ---------------------------------------------------------------------------
// AVISO DE COMISIÓN Y LÍMITE DE CORTE.
//
// Dos umbrales, los dos por local, los dos en PESOS (como se cargan en la
// pantalla de configuración):
//
//     CONFIGURACION/alarmaPago    aviso: se muestra pero se puede trabajar
//     CONFIGURACION/limiteCorte   corte: no se puede empezar a trabajar
//
// LA REGLA CENTRAL: EL CORTE SE EVALÚA UNA SOLA VEZ, AL INICIAR.
//
// Una sesión que arrancó autorizada NO se bloquea nunca, aunque durante el
// turno la deuda pase el límite. El objetivo es que nadie se quede sin poder
// cobrar en medio de un turno. El límite decide si una sesión NUEVA puede
// empezar, no si una sesión en curso puede seguir.
//
// Por eso este módulo es una función pura que se llama UNA vez con el saldo
// leído de una sola lectura. No hay listener, no hay suscripción: no existe
// ningún camino por el que una venta posterior dispare un bloqueo.
//
// `limiteCorte` en 0 o ausente = corte DESACTIVADO. Es el valor con el que
// quedan todos los locales al migrar, así que la actualización no bloquea a
// nadie: cada límite se activa después, local por local.
// ---------------------------------------------------------------------------

import { aPesos } from './comisionMovimiento.js';

/** Qué puede hacer una sesión que recién arranca. */
export const ESTADO_INICIO = Object.freeze({
  NORMAL: 'NORMAL',       // ni aviso ni bloqueo
  AVISO: 'AVISO',         // se avisa, pero se trabaja
  BLOQUEADO: 'BLOQUEADO', // no se puede empezar hasta pagar
  NO_VERIFICABLE: 'NO_VERIFICABLE', // no se pudo leer: NO se asume nada
});

/** Estados del gate de inicio, tal como los ve la interfaz. */
export const ESTADO_SESION = Object.freeze({
  VERIFICANDO: 'VERIFICANDO_COMISION',
  AUTORIZADA: 'AUTORIZADA',
  BLOQUEADA: 'BLOQUEADA_POR_CORTE',
  ERROR: 'ERROR_DE_VERIFICACION',
});

/**
 * Valor de configuración LEÍDO, distinguiendo "no está" de "no se pudo leer".
 *
 * Un campo ausente vale 0 y significa desactivado — eso es un dato válido.
 * Una lectura fallida NO vale 0: significa que no sabemos, y no sabemos no
 * puede convertirse en "corte desactivado", porque permitiría saltarse el
 * límite justo cuando no se pudo comprobar.
 */
export const valorLeido = (pesos) => ({ ok: true, pesos: Number(pesos) || 0 });
export const valorNoVerificable = (causa) => ({ ok: false, pesos: null, causa });
export const esNoVerificable = (v) => !!v && v.ok === false;

const aCentavosDeConfig = (pesos) => {
  const n = Number(pesos);
  if (!Number.isFinite(n) || n <= 0) return 0;   // 0, negativo o basura = desactivado
  return Math.round(n * 100);
};

/** ¿El corte está configurado? 0 o ausente = desactivado. */
export const corteActivo = (limiteCortePesos) => aCentavosDeConfig(limiteCortePesos) > 0;

/** ¿El aviso está configurado? */
export const avisoActivo = (alarmaPagoPesos) => aCentavosDeConfig(alarmaPagoPesos) > 0;

/**
 * Decisión de arranque. FUNCIÓN PURA: se le pasa el saldo ya leído.
 *
 * @param {number} saldoCentavos       deuda actual
 * @param {number} alarmaPagoPesos     CONFIGURACION/alarmaPago
 * @param {number} limiteCortePesos    CONFIGURACION/limiteCorte
 */
export const evaluarInicio = ({ saldoCentavos, alarmaPagoPesos, limiteCortePesos }) => {
  const saldo = Number(saldoCentavos) || 0;
  const alarma = aCentavosDeConfig(alarmaPagoPesos);
  const limite = aCentavosDeConfig(limiteCortePesos);

  // El corte manda sobre el aviso.
  if (limite > 0 && saldo >= limite) {
    return {
      estado: ESTADO_INICIO.BLOQUEADO,
      saldoCentavos: saldo, alarmaCentavos: alarma, limiteCentavos: limite,
      faltaPagarCentavos: saldo - limite + 1, // lo mínimo para quedar POR DEBAJO
      mensaje: 'LÍMITE DE COMISIÓN ALCANZADO',
    };
  }
  if (alarma > 0 && saldo >= alarma) {
    return {
      estado: ESTADO_INICIO.AVISO,
      saldoCentavos: saldo, alarmaCentavos: alarma, limiteCentavos: limite,
      faltaPagarCentavos: 0,
      mensaje: 'Tenés comisión pendiente de pago.',
    };
  }
  return {
    estado: ESTADO_INICIO.NORMAL,
    saldoCentavos: saldo, alarmaCentavos: alarma, limiteCentavos: limite,
    faltaPagarCentavos: 0,
    mensaje: '',
  };
};

/** ¿Esta evaluación impide empezar a trabajar? */
export const bloquea = (evaluacion) => evaluacion?.estado === ESTADO_INICIO.BLOQUEADO;

/**
 * EVALUACIÓN DE INICIO CON LECTURAS QUE PUEDEN FALLAR.
 *
 * Recibe los tres valores como `{ ok, pesos }` / `{ ok:false }`. Si CUALQUIERA
 * no se pudo verificar, el resultado es NO_VERIFICABLE: no se asume 0, no se
 * asume desactivado y no se habilita la sesión. La interfaz muestra
 * "no se pudo verificar" con Reintentar / Salir.
 *
 * Esto aplica SOLO al arranque. Una sesión ya autorizada nunca se re-evalúa,
 * así que una caída posterior de Firebase no puede bloquear a nadie.
 */
export const evaluarInicioConLecturas = ({ saldo, alarma, limite }) => {
  const fallo = [saldo, alarma, limite].find(esNoVerificable);
  if (fallo) {
    return {
      estado: ESTADO_INICIO.NO_VERIFICABLE,
      saldoCentavos: null, alarmaCentavos: null, limiteCentavos: null,
      faltaPagarCentavos: 0,
      causa: fallo.causa,
      mensaje: 'NO SE PUDO VERIFICAR EL ESTADO DE COMISIONES',
    };
  }
  return evaluarInicio({
    saldoCentavos: saldo.pesos,     // el saldo ya viene en centavos
    alarmaPagoPesos: alarma.pesos,
    limiteCortePesos: limite.pesos,
  });
};

/** Estado de sesión que corresponde a una evaluación de inicio. */
export const estadoDeSesion = (evaluacion) => {
  switch (evaluacion?.estado) {
    case ESTADO_INICIO.BLOQUEADO: return ESTADO_SESION.BLOQUEADA;
    case ESTADO_INICIO.NO_VERIFICABLE: return ESTADO_SESION.ERROR;
    default: return ESTADO_SESION.AUTORIZADA;   // NORMAL y AVISO dejan trabajar
  }
};

/** Texto de la pantalla de "no se pudo verificar". */
export const textoNoVerificable = () => ({
  titulo: 'NO SE PUDO VERIFICAR EL ESTADO DE COMISIONES',
  detalle: 'No fue posible consultar la configuración necesaria para iniciar. '
    + 'Verifique la conexión e intente nuevamente.',
  acciones: ['REINTENTAR', 'SALIR'],
});

/**
 * Después de un pago hecho DESDE la pantalla de bloqueo: ¿se libera la sesión?
 *
 * Se vuelve a evaluar UNA sola vez, con el saldo nuevo. Si quedó por debajo del
 * límite, la sesión arranca sin necesidad de cerrar y reabrir la aplicación.
 */
export const liberaTrasPago = ({ saldoCentavosDespues, limiteCortePesos }) => {
  const limite = aCentavosDeConfig(limiteCortePesos);
  if (limite <= 0) return true;
  return (Number(saldoCentavosDespues) || 0) < limite;
};

/**
 * Validación de la configuración: el aviso tiene que llegar ANTES del corte.
 * Con cualquiera de los dos en 0 (desactivado) no hay nada que comparar.
 */
export const validarConfiguracion = ({ alarmaPagoPesos, limiteCortePesos }) => {
  const alarma = aCentavosDeConfig(alarmaPagoPesos);
  const limite = aCentavosDeConfig(limiteCortePesos);
  if (alarma === 0 || limite === 0) return { ok: true, motivo: '' };
  if (alarma >= limite) {
    return {
      ok: false,
      motivo: `La alarma de pago ($${aPesos(alarma).toLocaleString('es-AR')}) tiene que ser MENOR `
        + `que el límite de corte ($${aPesos(limite).toLocaleString('es-AR')}), `
        + 'para que el aviso llegue antes del bloqueo.',
    };
  }
  return { ok: true, motivo: '' };
};

/**
 * Texto de la pantalla de bloqueo.
 *
 * `importe` es el SALDO TOTAL ADEUDADO — el mismo `saldoCentavos` con el que se
 * decidió el bloqueo, y NO `faltaPagarCentavos` (el mínimo para quedar por
 * debajo del límite). Al local se le pide la deuda completa, no lo justo para
 * zafar del corte.
 *
 * Ya no se nombra el límite ni se describe ninguna acción: la pantalla no
 * ofrece forma de continuar. El desbloqueo ocurre cuando la administración
 * registra el pago real y el saldo baja, no acá.
 */
export const textoDeBloqueo = (evaluacion) => {
  const p = (c) => `$${aPesos(c).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  return {
    titulo: 'SISTEMA BLOQUEADO POR FALTA DE PAGO',
    pedido: 'Por favor, realice el pago de:',
    importe: p(evaluacion.saldoCentavos),
    cierre: 'para seguir utilizando el servicio.',
    gracias: 'Muchas gracias.',
  };
};
