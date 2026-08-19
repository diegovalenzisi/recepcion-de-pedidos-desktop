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
});

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

/** Texto de la pantalla de bloqueo. */
export const textoDeBloqueo = (evaluacion) => {
  const p = (c) => `$${aPesos(c).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  return {
    titulo: 'LÍMITE DE COMISIÓN ALCANZADO',
    pendiente: `Comisión pendiente: ${p(evaluacion.saldoCentavos)}`,
    limite: `Límite permitido: ${p(evaluacion.limiteCentavos)}`,
    detalle: 'Para comenzar a utilizar el sistema debe realizar un pago de comisión '
      + 'que reduzca la deuda por debajo del límite establecido.',
  };
};
