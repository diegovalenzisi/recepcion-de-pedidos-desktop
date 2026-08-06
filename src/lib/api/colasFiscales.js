// ---------------------------------------------------------------------------
// COLAS FISCALES — UNA CUENTA FISCAL DISTINTA POR CADA FACTURACION_N
//
// REGLA CENTRAL, PARA TODOS LOS LOCALES, ACTUALES Y FUTUROS:
//
//     Dentro de UN local puede haber hasta NUEVE contribuyentes distintos.
//     Cada FACTURACION_N es una CUENTA FISCAL SEPARADA, con su propio CUIT,
//     razón social, punto de venta, certificado, domicilio, numeración,
//     runtime y ownership.
//
//     NO existe "la configuración fiscal del local". Existe la configuración
//     fiscal DE CADA COLA.
//
// Una venta que entra a FACTURACION_2 se factura con el CUIT, el punto de venta
// y el certificado de FACTURACION_2. Nunca con los de FACTURACION_1, nunca con
// "los del local".
//
// DE DÓNDE SALE EL VÍNCULO (estructura que YA existe, no se inventa otra):
//
//   /{localId}/CUENTAS/{cta-N}/nombre           → "Transferencia 2"
//   /{localId}/CUENTAS/{cta-N}/imprimeFactura   → el switch
//        │
//        │  COLAS_POR_CUENTA (facturaORemito.js), coincidencia EXACTA
//        ▼
//   "FACTURACION_2"
//        │
//        │  la cuenta fiscal cuyo `firebasePath` termina en esa cola
//        ▼
//   /{localId}/CONFIGURACION/FACTURACION_AFIP/monotributo/cuentas[i]
//        con firebasePath = "{localId}/FACTURACION_2"
//
// Por eso un local NUEVO no necesita ningún cambio de código: alcanza con
// cargar sus cuentas fiscales apuntando cada una a su cola.
//
// QUÉ NO HACE ESTE MÓDULO:
//   - no decide si una venta se factura (eso es facturaORemito.js);
//   - no emite, no pide CAE, no toca AFIP;
//   - no escribe en Firebase (eso es colasFiscalesApi.js).
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// ---------------------------------------------------------------------------

import { COLAS_POR_CUENTA, normalizarNombreCuenta } from './facturaORemito.js';
import { CBTE_TIPO, CBTE_TIPO_POR_CONDICION, LETRA_POR_CBTE_TIPO, puntoVentaCanonico } from './comprobanteFiscal.js';

/** Las nueve colas fiscales posibles de un local. */
export const COLAS_FISCALES = Object.freeze(
  Array.from({ length: 9 }, (_, i) => `FACTURACION_${i + 1}`)
);

/**
 * Cola sin sufijo, de instalaciones antiguas. Se reconoce para poder auditarla
 * e informarla, pero no se le asigna ninguna cuenta de cobro.
 */
export const COLA_LEGADA = 'FACTURACION';

/** Runtime que consume cada tipo de cuenta fiscal. */
export const RUNTIME_POR_CONDICION = Object.freeze({
  responsable_inscripto: 'responsable-inscripto',
  monotributo: 'monotributo',
});

/** Cuenta de COBRO que alimenta cada cola. Inverso exacto de COLAS_POR_CUENTA. */
export const CUENTA_COBRO_POR_COLA = Object.freeze(
  Object.fromEntries(Object.entries(COLAS_POR_CUENTA).map(([cuenta, cola]) => [cola, cuenta]))
);

/** Estados posibles de una cola fiscal. */
export const ESTADO = Object.freeze({
  LISTA: 'facturacion-lista',
  /**
   * La cuenta de COBRO de esta cola tiene `imprimeFactura: false`. Sus ventas
   * generan remito a propósito. NO es un error y NO exige ninguna configuración
   * fiscal: sin CUIT, sin punto de venta, sin certificado, sin runtime.
   */
  NO_FACTURA: 'cuenta-no-fiscal',
  INCOMPLETA: 'configuracion-incompleta',
  SIN_RUNTIME: 'cola-sin-runtime',
  CERTIFICADO_INVALIDO: 'certificado-invalido',
  PUNTO_VENTA_FALTANTE: 'punto-venta-no-configurado',
  HUERFANA: 'cola-huerfana',
  NO_CONFIGURADA: 'cola-no-configurada',
});

/** Etiqueta para mostrarle el estado al usuario. */
export const ETIQUETA_ESTADO = Object.freeze({
  [ESTADO.LISTA]: 'Facturación lista',
  [ESTADO.NO_FACTURA]: 'No factura — genera remito',
  [ESTADO.INCOMPLETA]: 'Configuración incompleta',
  [ESTADO.SIN_RUNTIME]: 'Cola sin runtime',
  [ESTADO.CERTIFICADO_INVALIDO]: 'Certificado inválido',
  [ESTADO.PUNTO_VENTA_FALTANTE]: 'Punto de venta no configurado',
  [ESTADO.HUERFANA]: 'Cola huérfana',
  [ESTADO.NO_CONFIGURADA]: 'Sin configurar',
});

/**
 * ¿La cuenta de COBRO que alimenta esta cola tiene el interruptor encendido?
 *
 * @param {object} switches  { 'TRANSFERENCIA 2': false, ... } por nombre normalizado
 * @returns {true|false|null} null = no existe esa cuenta de cobro en el local.
 */
export function imprimeFacturaDeCola(cola, switches = {}) {
  const nombre = CUENTA_COBRO_POR_COLA[cola];
  if (!nombre) return null;
  const v = switches[nombre];
  return v === true ? true : v === false ? false : null;
}

const texto = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

/** ¿Es el nombre de una cola fiscal? */
export function esColaFiscal(nombre) {
  const s = String(nombre ?? '').trim();
  return s === COLA_LEGADA || COLAS_FISCALES.includes(s);
}

/**
 * Nombre de la cola a partir del `firebasePath` de una cuenta fiscal.
 * Convención: `{localId}/FACTURACION_N` — el ÚLTIMO segmento es la cola.
 * Devuelve null si el path no apunta a una cola fiscal reconocible.
 */
export function colaDeFirebasePath(firebasePath) {
  const limpio = String(firebasePath ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!limpio) return null;
  const ultimo = limpio.split('/').pop();
  return esColaFiscal(ultimo) ? ultimo : null;
}

/**
 * Local al que pertenece un `firebasePath`. El número de local es SIEMPRE el
 * primer segmento (misma regla que rutasLocales.js). Sin local no se deriva
 * nada: falla segura.
 */
export function localIdDeFirebasePath(firebasePath) {
  const limpio = String(firebasePath ?? '').trim().replace(/^\/+/, '');
  const primero = limpio.split('/')[0];
  return /^\d+$/.test(primero) ? primero : null;
}

/** Clave de ownership de una cuenta fiscal: `{cuit}_{ptoVta}`. */
export function claveOwnership(cuit, ptoVta) {
  const limpiar = (v) => String(v ?? '').trim().replace(/[.#$[\]/\s]/g, '');
  return `${limpiar(cuit)}_${limpiar(ptoVta)}`;
}

/**
 * TODAS las cuentas fiscales declaradas en la configuración del local, incluidas
 * las INCOMPLETAS —hacen falta para poder informar qué les falta— y con su cola
 * ya resuelta.
 *
 * Es la lectura canónica de /{localId}/CONFIGURACION/FACTURACION_AFIP. No se
 * inventa ninguna estructura nueva: se interpreta la que ya guarda el formulario
 * de facturación.
 *
 * @returns {Array<object>} una entrada por cuenta fiscal configurada.
 */
export function listarCuentasFiscalesCrudas(config) {
  if (!config || typeof config !== 'object') return [];
  const salida = [];

  const agregar = (cuenta, condicion) => {
    if (!cuenta || typeof cuenta !== 'object') return;
    const cbteTipo = CBTE_TIPO_POR_CONDICION[condicion] ?? null;
    const cola = colaDeFirebasePath(cuenta.firebasePath);
    salida.push({
      // Identidad
      cuentaId: texto(cuenta.id),
      nombre: texto(cuenta.nombre),
      logAlias: texto(cuenta.logAlias),
      condicion,
      runtime: RUNTIME_POR_CONDICION[condicion] ?? null,

      // Comprobante que emite
      cbteTipo,
      letra: cbteTipo ? LETRA_POR_CBTE_TIPO[cbteTipo] ?? null : null,

      // Cola: el vínculo con la cuenta de cobro
      cola,
      cuentaCobro: cola ? CUENTA_COBRO_POR_COLA[cola] ?? null : null,

      // Datos fiscales propios de ESTA cuenta
      cuit: texto(cuenta.cuit),
      cuitFormat: texto(cuenta.cuitFormat),
      razonSocial: texto(cuenta.razonSocial),
      nombreFantasia: texto(cuenta.fantasia),
      condicionIVA: texto(cuenta.condIVA),
      puntoVenta: puntoVentaCanonico(cuenta.ptoVta),
      domicilioComercial: texto(cuenta.domicilio),
      ingresosBrutos: texto(cuenta.iibb),
      inicioActividades: texto(cuenta.inicioActividades),

      // Credenciales (se guardan en Storage; acá sólo se sabe si están)
      certificado: texto(cuenta.certStoragePath) || texto(cuenta.certDownloadUrl),
      clave: texto(cuenta.keyStoragePath) || texto(cuenta.keyDownloadUrl),
      serviceAccount: texto(cuenta.serviceAccountStoragePath) || texto(cuenta.serviceAccountDownloadUrl),

      // Infraestructura
      firebaseDb: texto(cuenta.firebaseDb),
      firebasePath: texto(cuenta.firebasePath),
      firebaseHistorial: texto(cuenta.firebaseHistorial),
      localIdDeclarado: localIdDeFirebasePath(cuenta.firebasePath),

      // Estado declarado por el formulario
      inicializada: cuenta.initialized === true,
      // `activo` es intencionalmente PC-local (ver afipConfigApi.js): acá sólo
      // se refleja lo que haya, nunca se usa como verdad remota.
      activaEnEstaPC: cuenta.activo === true,

      ownerKey: claveOwnership(cuenta.cuit, cuenta.ptoVta),
    });
  };

  agregar(config.ri, 'responsable_inscripto');
  for (const cuenta of config.monotributo?.cuentas || []) agregar(cuenta, 'monotributo');

  // Una cuenta SIN IDENTIDAD FISCAL no es una cuenta: es una fila en blanco del
  // formulario. Se descarta aunque tenga `firebasePath` cargado, porque el
  // formulario deja ese campo precompletado en la fila vacía de responsable
  // inscripto — y si se la contara, competiría por la cola con la cuenta real y
  // bloquearía la facturación del local por un conflicto inexistente.
  return salida.filter((c) => c.cuit || c.puntoVenta || c.razonSocial);
}

/**
 * Índice cola → cuenta fiscal. Si DOS cuentas declaran la misma cola es un error
 * de configuración: no se elige ninguna, se marca el conflicto, porque facturar
 * con el CUIT equivocado es peor que no facturar.
 *
 * @returns {{porCola: Map<string, object>, conflictos: Array<{cola: string, cuentas: string[]}>, sinCola: Array<object>}}
 */
export function indexarColasFiscales(config) {
  const cuentas = listarCuentasFiscalesCrudas(config);
  const agrupadas = new Map();
  const sinCola = [];

  for (const c of cuentas) {
    if (!c.cola) { sinCola.push(c); continue; }
    if (!agrupadas.has(c.cola)) agrupadas.set(c.cola, []);
    agrupadas.get(c.cola).push(c);
  }

  const porCola = new Map();
  const conflictos = [];
  for (const [cola, lista] of agrupadas) {
    if (lista.length === 1) porCola.set(cola, lista[0]);
    else conflictos.push({ cola, cuentas: lista.map((c) => c.cuitFormat || c.cuit || c.cuentaId || '(sin CUIT)') });
  }

  return { porCola, conflictos, sinCola };
}

/** Cuenta fiscal que factura en una cola. null si no hay, o si hay conflicto. */
export function cuentaFiscalDeCola(config, cola) {
  return indexarColasFiscales(config).porCola.get(String(cola ?? '').trim()) || null;
}

/**
 * Cuentas fiscales que comparten CUIT + punto de venta dentro de la misma
 * configuración. Es la MISMA identidad fiscal ante ARCA: dos emisores
 * simultáneos sobre ella se pisarían la numeración.
 */
export function identidadesFiscalesDuplicadas(config) {
  const porClave = new Map();
  for (const c of listarCuentasFiscalesCrudas(config)) {
    if (!c.cuit || !c.puntoVenta) continue;
    const k = claveOwnership(c.cuit, c.puntoVenta);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push(c);
  }
  return [...porClave.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([clave, lista]) => ({ clave, colas: lista.map((c) => c.cola || '(sin cola)') }));
}

/**
 * ¿ESTA cola está en condiciones de facturar?
 *
 * Se valida TODO lo que hace falta ANTES de aceptar la venta como facturada. Si
 * algo falta, la venta NO se encola y NO se cae a un FCX: se informa exactamente
 * qué configuración está incompleta.
 *
 * @param {object} cuenta   cuenta fiscal de la cola (de cuentaFiscalDeCola)
 * @param {object} [ctx]
 * @param {boolean|null} [ctx.runtimeActiva]  ¿hay un motor consumiendo esta cola?
 *        null = no se pudo determinar (no bloquea: es información de otra PC).
 * @param {boolean|null} [ctx.ownershipOk]    ¿el ownership de esta cuenta está sano?
 * @param {string|null}  [ctx.localId]        local activo, para verificar que la
 *        cola pertenece a ESTE local y no a otro.
 *
 * @returns {{estado: string, listo: boolean, faltantes: string[], avisos: string[], mensaje: string|null}}
 */
export function validarCuentaFiscal(cuenta, { runtimeActiva = null, ownershipOk = null, localId = null, imprimeFactura = null } = {}) {
  // EL SWITCH MANDA, Y CORTA ANTES QUE TODO.
  //
  // Si la cuenta de COBRO de esta cola tiene `imprimeFactura: false`, sus ventas
  // van a remito por decisión del dueño. Esa cola no se consulta, no se valida y
  // no necesita nada: ni CUIT, ni punto de venta, ni certificado, ni runtime.
  // No es un error de configuración y no se reporta como tal.
  if (imprimeFactura === false) {
    return {
      estado: ESTADO.NO_FACTURA,
      listo: false,          // no factura: no es que esté "lista para facturar"
      esError: false,        // …pero tampoco es un problema
      noFactura: true,
      faltantes: [],
      avisos: [],
      mensaje: null,
    };
  }

  if (!cuenta) {
    // Una cola sin contribuyente es un ERROR sólo si alguien encendió
    // "Imprime Factura" en su cuenta de cobro: ahí sí se esperan facturas y no
    // hay con qué emitirlas. Si el switch está apagado o la cuenta de cobro ni
    // siquiera existe en el local, la cola simplemente está libre.
    const esperada = imprimeFactura === true;
    return {
      estado: ESTADO.NO_CONFIGURADA, listo: false, esError: esperada, noFactura: false,
      faltantes: esperada ? ['No hay ninguna cuenta fiscal configurada para esta cola.'] : [],
      avisos: [],
      mensaje: esperada ? 'No hay ninguna cuenta fiscal configurada para esta cola.' : null,
    };
  }

  const faltantes = [];
  const avisos = [];

  if (!cuenta.cuit) faltantes.push('CUIT');
  if (!cuenta.puntoVenta) faltantes.push('Punto de venta');
  if (!cuenta.cbteTipo) faltantes.push('Tipo de comprobante (condición fiscal)');
  if (!cuenta.razonSocial) faltantes.push('Razón social');
  if (!cuenta.domicilioComercial) faltantes.push('Domicilio comercial');
  if (!cuenta.certificado) faltantes.push('Certificado');
  if (!cuenta.clave) faltantes.push('Clave privada');
  if (!cuenta.firebaseDb) faltantes.push('Base de datos de facturación');
  if (!cuenta.firebasePath) faltantes.push('Ruta de la cola (Firebase)');
  if (!cuenta.firebaseHistorial) faltantes.push('Ruta donde se guarda la factura');
  if (!cuenta.runtime) faltantes.push('Runtime de facturación');
  if (!cuenta.cuentaCobro) faltantes.push('Cuenta de cobro asociada a la cola');

  // La cola tiene que ser de ESTE local. Un firebasePath apuntando a otro local
  // facturaría las ventas de un comercio con el CUIT de otro.
  if (localId && cuenta.localIdDeclarado && String(cuenta.localIdDeclarado) !== String(localId)) {
    faltantes.push(`La cola pertenece al local ${cuenta.localIdDeclarado}, no al ${localId}`);
  }

  // Datos que se imprimen sólo si están: no bloquean la emisión.
  if (!cuenta.inicioActividades) avisos.push('Inicio de actividades sin cargar');
  if (!cuenta.ingresosBrutos) avisos.push('Ingresos Brutos sin cargar');
  if (!cuenta.nombreFantasia) avisos.push('Nombre de fantasía sin cargar');
  if (!cuenta.serviceAccount) avisos.push('Service Account sin cargar (el motor no podrá escribir la factura)');
  if (ownershipOk === false) avisos.push('El ownership de esta cuenta fiscal está tomado por otro equipo');

  // El estado más específico primero: le dice al usuario qué arreglar.
  let estado = ESTADO.LISTA;
  if (!cuenta.certificado || !cuenta.clave) estado = ESTADO.CERTIFICADO_INVALIDO;
  else if (!cuenta.puntoVenta) estado = ESTADO.PUNTO_VENTA_FALTANTE;
  else if (faltantes.length > 0) estado = ESTADO.INCOMPLETA;
  else if (runtimeActiva === false) estado = ESTADO.SIN_RUNTIME;

  const listo = faltantes.length === 0 && estado !== ESTADO.SIN_RUNTIME;

  return {
    estado,
    listo,
    // Una cuenta fiscal habilitada que no está lista SÍ es un error: alguien
    // encendió "Imprime Factura" sin terminar de configurar el contribuyente.
    esError: !listo,
    noFactura: false,
    faltantes,
    avisos,
    mensaje: listo ? null : mensajeDeEstado(estado, cuenta, faltantes),
  };
}

/** Texto para el operador: qué pasa y qué tiene que arreglar. */
export function mensajeDeEstado(estado, cuenta, faltantes = []) {
  const cola = cuenta?.cola || 'la cola';
  const quien = cuenta?.razonSocial ? ` (${cuenta.razonSocial})` : '';
  switch (estado) {
    case ESTADO.NO_CONFIGURADA:
      return `No hay ninguna cuenta fiscal configurada para ${cola}. Cargala en Configuración → Facturación.`;
    case ESTADO.CERTIFICADO_INVALIDO:
      return `${cola}${quien} no tiene certificado y clave cargados: sin eso no se puede pedir el CAE.`;
    case ESTADO.PUNTO_VENTA_FALTANTE:
      return `${cola}${quien} no tiene punto de venta configurado.`;
    case ESTADO.SIN_RUNTIME:
      return `${cola}${quien} no tiene ningún motor de facturación activo consumiéndola: la factura quedaría encolada sin emitirse.`;
    case ESTADO.HUERFANA:
      return `${cola} tiene ventas esperando y ninguna cuenta fiscal configurada que las facture.`;
    case ESTADO.INCOMPLETA:
    default:
      return `${cola}${quien} tiene la configuración fiscal incompleta. Falta: ${faltantes.join(', ')}.`;
  }
}

/**
 * Cuántos días hacia atrás se considera que un pendiente es "nuevo". Sirve para
 * distinguir un atasco HISTÓRICO —que sólo hay que informar— de una cola que
 * SIGUE recibiendo ventas, que sí es un error.
 */
export const DIAS_PARA_CONSIDERAR_NUEVA = 2;

/**
 * COLAS HUÉRFANAS — de forma genérica, para cualquier local.
 *
 * Una cola es huérfana cuando TIENE VENTAS ESPERANDO y no hay una cuenta fiscal
 * en condiciones de facturarlas. Es el caso de las ventas que se encolaron y se
 * quedaron ahí para siempre.
 *
 * NO procesa ni borra nada: sólo informa.
 *
 * @param {object} opciones
 * @param {object} opciones.config              configuración fiscal del local
 * @param {object} opciones.pendientesPorCola   { FACTURACION_2: {n, masViejoMs} }
 * @param {object} [opciones.runtimesActivas]   { FACTURACION_2: true|false }
 * @returns {Array<object>} una entrada por cola huérfana.
 */
export function detectarColasHuerfanas({
  config,
  pendientesPorCola = {},
  runtimesActivas = {},
  switchesCuentaCobro = {},
  ventanaNuevasMs = DIAS_PARA_CONSIDERAR_NUEVA * 86400000,
} = {}) {
  const { porCola } = indexarColasFiscales(config);
  const huerfanas = [];

  for (const [cola, info] of Object.entries(pendientesPorCola)) {
    const n = Number(info?.n ?? info) || 0;
    if (n <= 0) continue;

    const cuenta = porCola.get(cola) || null;
    const imprimeFactura = imprimeFacturaDeCola(cola, switchesCuentaCobro);
    const runtimeActiva = Object.prototype.hasOwnProperty.call(runtimesActivas, cola) ? runtimesActivas[cola] : null;
    const validacion = validarCuentaFiscal(cuenta, { runtimeActiva, imprimeFactura });
    if (validacion.listo) continue;

    // LO PENDIENTE NO ALCANZA PARA LLAMARLA HUÉRFANA.
    //
    // Si la cuenta de cobro tiene el interruptor apagado, lo que hay en la cola
    // es HISTÓRICO: quedó de cuando esas ventas sí se encolaban. Eso no es una
    // cola huérfana, es un pendiente viejo que hay que informar, no un problema
    // de configuración. Sólo vuelve a ser un problema si SIGUE recibiendo
    // ventas nuevas, que sería un error real de código.
    const masNuevoMs = info?.masNuevoMs ?? null;
    const recibiendoNuevas = masNuevoMs !== null && (Date.now() - masNuevoMs) <= ventanaNuevasMs;
    if (validacion.noFactura && !recibiendoNuevas) continue;

    huerfanas.push({
      cola,
      pendientes: n,
      masViejoMs: info?.masViejoMs ?? null,
      masNuevoMs,
      antiguedadDias: info?.masViejoMs ? Math.floor((Date.now() - info.masViejoMs) / 86400000) : null,
      cuentaCobro: CUENTA_COBRO_POR_COLA[cola] ?? null,
      imprimeFactura,
      recibiendoNuevas,
      cuit: cuenta?.cuitFormat || cuenta?.cuit || null,
      razonSocial: cuenta?.razonSocial || null,
      puntoVenta: cuenta?.puntoVenta || null,
      runtimeEsperada: cuenta?.runtime || null,
      estado: validacion.noFactura ? ESTADO.NO_FACTURA : cuenta ? validacion.estado : ESTADO.HUERFANA,
      motivo: validacion.noFactura
        ? `La cuenta "${CUENTA_COBRO_POR_COLA[cola]}" tiene "Imprime Factura" apagado —sus ventas deben ser remitos— ` +
          `pero ${cola} SIGUE recibiendo ventas nuevas. Algún equipo está enviándolas ahí: casi siempre es una PC ` +
          'con una versión anterior a esta regla. Hasta que se actualice, esas ventas se siguen acumulando sin facturarse.'
        : cuenta ? validacion.mensaje : mensajeDeEstado(ESTADO.HUERFANA, { cola }),
    });
  }

  return huerfanas.sort((a, b) => b.pendientes - a.pendientes);
}

/**
 * Radiografía completa de las nueve colas de un local. Es lo que muestra la
 * pantalla de facturación y lo que informa la auditoría: la MISMA función, para
 * que las dos digan siempre lo mismo.
 */
export function radiografiaDeColas({
  config,
  localId = null,
  pendientesPorCola = {},
  runtimesActivas = {},
  switchesCuentaCobro = {},
  ventanaNuevasMs = DIAS_PARA_CONSIDERAR_NUEVA * 86400000,
} = {}) {
  const { porCola, conflictos, sinCola } = indexarColasFiscales(config);

  const colas = [...COLAS_FISCALES, COLA_LEGADA].map((cola) => {
    const cuenta = porCola.get(cola) || null;
    const pend = pendientesPorCola[cola];
    const pendientes = Number(pend?.n ?? pend) || 0;
    const masNuevoMs = pend?.masNuevoMs ?? null;
    const runtimeActiva = Object.prototype.hasOwnProperty.call(runtimesActivas, cola) ? runtimesActivas[cola] : null;
    const imprimeFactura = imprimeFacturaDeCola(cola, switchesCuentaCobro);
    const validacion = validarCuentaFiscal(cuenta, { runtimeActiva, localId, imprimeFactura });
    const recibiendoNuevas = masNuevoMs !== null && (Date.now() - masNuevoMs) <= ventanaNuevasMs;

    return {
      cola,
      cuentaCobro: CUENTA_COBRO_POR_COLA[cola] ?? null,
      imprimeFactura,
      configurada: !!cuenta,
      cuenta,
      pendientes,
      masViejoMs: pend?.masViejoMs ?? null,
      masNuevoMs,
      recibiendoNuevas,
      runtimeActiva,
      ...validacion,
      // Huérfana = hay ventas esperando y la cola NO puede facturarlas por un
      // problema real. Una cola cuya cuenta de cobro no factura NO es huérfana:
      // sus pendientes son históricos. Salvo que siga recibiendo ventas nuevas,
      // que sí sería un error de código.
      huerfana: pendientes > 0 && (validacion.noFactura ? recibiendoNuevas : !validacion.listo),
      // Pendientes viejos de una cuenta que ya no factura: sólo para informar.
      pendientesHistoricos: validacion.noFactura && pendientes > 0 && !recibiendoNuevas ? pendientes : 0,
    };
  });

  return {
    localId,
    colas,
    configuradas: colas.filter((c) => c.configurada).length,
    listas: colas.filter((c) => c.listo).length,
    noFacturan: colas.filter((c) => c.noFactura),
    conErrores: colas.filter((c) => c.esError),
    huerfanas: colas.filter((c) => c.huerfana),
    conPendientesHistoricos: colas.filter((c) => c.pendientesHistoricos > 0),
    conflictos,
    cuentasSinCola: sinCola,
    identidadesDuplicadas: identidadesFiscalesDuplicadas(config),
  };
}

/**
 * Datos del EMISOR que hay que grabar en la factura y estampar en el PDF. Salen
 * SIEMPRE de la cuenta de la cola que la emitió, nunca de "el local".
 */
export function emisorDeCuenta(cuenta) {
  if (!cuenta) return null;
  return {
    cuit: cuenta.cuit,
    cuitFormat: cuenta.cuitFormat || cuenta.cuit,
    razonSocial: cuenta.razonSocial,
    nombreFantasia: cuenta.nombreFantasia,
    condicionIVA: cuenta.condicionIVA,
    puntoVenta: cuenta.puntoVenta,
    domicilioComercial: cuenta.domicilioComercial,
    ingresosBrutos: cuenta.ingresosBrutos,
    inicioActividades: cuenta.inicioActividades,
    cbteTipo: cuenta.cbteTipo,
    letra: cuenta.letra,
    cola: cuenta.cola,
    runtime: cuenta.runtime,
  };
}

/**
 * Interruptor de cada cuenta de COBRO, por nombre normalizado, listo para
 * pasárselo a `radiografiaDeColas` / `detectarColasHuerfanas`.
 *
 * Entrada: /{localId}/CUENTAS tal cual viene de Firebase (mapa o array).
 */
export function switchesDeCuentasCobro(cuentas) {
  const lista = Array.isArray(cuentas) ? cuentas : Object.values(cuentas || {});
  const salida = {};
  for (const c of lista) {
    const nombre = normalizarNombreCuenta(c?.nombre);
    if (nombre) salida[nombre] = c.imprimeFactura === true;
  }
  return salida;
}

/** ¿La cuenta de cobro `nombre` alimenta la cola `cola`? Coincidencia exacta. */
export function cuentaCobroAlimentaCola(nombre, cola) {
  const clave = normalizarNombreCuenta(nombre);
  return !!clave && COLAS_POR_CUENTA[clave] === cola;
}

export { CBTE_TIPO };
