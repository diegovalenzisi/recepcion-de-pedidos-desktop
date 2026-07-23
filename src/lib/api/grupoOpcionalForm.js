// Fase 2 — punto 8: lógica de la pantalla de configuración de grupos de opcionales.
//
// Este módulo NO dibuja nada. Contiene todo lo que Desktop y Tablet deben hacer
// igual: qué valores se cargan al abrir el formulario, qué pasa al cambiar el
// origen, qué se valida y qué se escribe finalmente en GRUPOS_OPCIONALES.
// La presentación (escritorio con grilla, tablet táctil) queda en cada JSX.
//
// Regla central: un grupo viejo, sin campo `origen`, es manual. Abrirlo y
// guardarlo sin tocar el origen NO debe escribir `origen: "manual"`, porque eso
// convertiría una lectura en una migración masiva silenciosa del catálogo.
import { ORIGEN_MANUAL, ORIGEN_DEPARTAMENTO, origenDeGrupo } from './opcionalesDepartamento.js';
import { idCanonico, detectarAliasAmbiguos, esIdLegado } from './idsCanonicos.js';

export { ORIGEN_MANUAL, ORIGEN_DEPARTAMENTO };

/** Los overrides viven bajo claves de Firebase: hay caracteres prohibidos. */
const CARACTERES_PROHIBIDOS = /[.#$[\]/]/;

function esClaveFirebaseValida(valor) {
  const s = idCanonico(valor);
  return typeof s === 'string' && s !== '' && !CARACTERES_PROHIBIDOS.test(s);
}

function aNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Valores con los que se abre el formulario.
 *
 * `origenOriginal` recuerda si el grupo traía el campo o no; se usa al guardar
 * para no escribirlo cuando nadie lo tocó.
 */
export function valoresInicialesGrupo(grupo) {
  const g = grupo && typeof grupo === 'object' ? grupo : {};
  const teniaOrigen = typeof g.origen === 'string' && g.origen.trim() !== '';
  const cfg = g.configDepartamento && typeof g.configDepartamento === 'object' ? g.configDepartamento : g;

  const overrides = {};
  const fuente = cfg.consumosPorArticulo;
  if (fuente && typeof fuente === 'object') {
    Object.keys(fuente).forEach((k) => { overrides[k] = fuente[k]; });
  }

  return {
    nombre: typeof g.nombre === 'string' ? g.nombre : '',
    origen: origenDeGrupo(g),
    origenOriginal: teniaOrigen ? g.origen : null,
    departamentoId: cfg.departamentoId !== undefined && cfg.departamentoId !== null ? String(cfg.departamentoId) : '',
    usarPrecioArticulo: cfg.usarPrecioArticulo !== false,
    controlarStock: cfg.controlarStock !== false,
    consumoStockUnitarioDefault: cfg.consumoStockUnitarioDefault !== undefined && cfg.consumoStockUnitarioDefault !== null
      ? cfg.consumoStockUnitarioDefault
      : 1,
    consumosPorArticulo: overrides,
  };
}

/**
 * Cambio de origen. No borra nada por su cuenta: devuelve qué datos quedarían
 * sin uso para que la pantalla pida confirmación con un mensaje concreto.
 */
export function cambiarOrigen(form, nuevoOrigen, { opcionalesManuales = [] } = {}) {
  const actual = form || {};
  const destino = nuevoOrigen === ORIGEN_DEPARTAMENTO ? ORIGEN_DEPARTAMENTO : ORIGEN_MANUAL;
  const siguiente = { ...actual, origen: destino };

  if (destino === actual.origen) {
    return { form: siguiente, requiereConfirmacion: false, mensaje: null, datosEnRiesgo: [] };
  }

  if (destino === ORIGEN_DEPARTAMENTO) {
    const cuantos = Array.isArray(opcionalesManuales) ? opcionalesManuales.length : 0;
    if (cuantos > 0) {
      return {
        form: siguiente,
        requiereConfirmacion: true,
        mensaje: `Este grupo tiene ${cuantos} opcional(es) cargado(s) a mano. Si el origen pasa a Departamento, esas opciones dejan de usarse (no se borran) y las opciones salen del catálogo del departamento.`,
        datosEnRiesgo: ['opcionalesManuales'],
      };
    }
    return { form: siguiente, requiereConfirmacion: false, mensaje: null, datosEnRiesgo: [] };
  }

  const enRiesgo = [];
  if (actual.departamentoId) enRiesgo.push('departamentoId');
  if (actual.consumosPorArticulo && Object.keys(actual.consumosPorArticulo).length > 0) enRiesgo.push('consumosPorArticulo');
  if (enRiesgo.length > 0) {
    return {
      form: siguiente,
      requiereConfirmacion: true,
      mensaje: 'Al volver a Manual, el departamento y los consumos configurados dejan de usarse. Se conservan por si volvés a Departamento; no se borran ahora.',
      datosEnRiesgo: enRiesgo,
    };
  }
  return { form: siguiente, requiereConfirmacion: false, mensaje: null, datosEnRiesgo: [] };
}

/**
 * Validación del formulario. Devuelve errores por campo, nunca lanza.
 * Los avisos (`avisos`) no impiden guardar; los errores sí.
 */
export function validarGrupoOpcional(form, { departamentos = {}, articulos = {} } = {}) {
  const f = form || {};
  const errores = [];
  const avisos = [];

  if (!idCanonico(f.nombre)) {
    errores.push({ campo: 'nombre', motivo: 'requerido', mensaje: 'El nombre del grupo es obligatorio.' });
  }

  const min = aNumero(f.min);
  const max = aNumero(f.max);
  if (min !== null && max !== null && max < min) {
    errores.push({ campo: 'max', motivo: 'max-menor-que-min', mensaje: 'El máximo no puede ser menor que el mínimo.' });
  }

  if (f.origen !== ORIGEN_DEPARTAMENTO) {
    return { valido: errores.length === 0, errores, avisos };
  }

  const depId = idCanonico(f.departamentoId);
  if (!depId) {
    errores.push({ campo: 'departamentoId', motivo: 'requerido', mensaje: 'Elegí un departamento.' });
  } else if (!esClaveFirebaseValida(depId)) {
    errores.push({ campo: 'departamentoId', motivo: 'id-invalido', mensaje: `"${depId}" no es un identificador válido.` });
  } else if (Object.keys(departamentos).length > 0 && !Object.prototype.hasOwnProperty.call(departamentos, depId)) {
    errores.push({ campo: 'departamentoId', motivo: 'inexistente', mensaje: `El departamento "${depId}" no existe en este local.` });
  } else if (esIdLegado(depId)) {
    avisos.push({ campo: 'departamentoId', motivo: 'id-legado', mensaje: `"${depId}" parece un identificador viejo, sin prefijo. Se guarda tal cual, pero conviene usar el ID real del departamento.` });
  }

  const ambiguos = detectarAliasAmbiguos(Object.keys(departamentos));
  if (depId) {
    ambiguos.forEach(({ alias, ids }) => {
      if (ids.includes(depId)) {
        avisos.push({
          campo: 'departamentoId',
          motivo: 'alias-ambiguo',
          mensaje: `Hay más de un departamento que se reduce al alias "${alias}" (${ids.join(', ')}). Se guarda el ID completo "${depId}"; los pedidos históricos que traigan solo "${alias}" no se van a poder resolver.`,
        });
      }
    });
  }

  const controla = f.controlarStock !== false;
  if (controla) {
    const def = aNumero(f.consumoStockUnitarioDefault);
    if (def === null || def <= 0) {
      errores.push({ campo: 'consumoStockUnitarioDefault', motivo: 'invalido', mensaje: 'Si el grupo controla stock, el consumo predeterminado tiene que ser un número mayor que cero.' });
    }
  }

  const overrides = f.consumosPorArticulo && typeof f.consumosPorArticulo === 'object' ? f.consumosPorArticulo : {};
  Object.keys(overrides).forEach((articleId) => {
    if (!esClaveFirebaseValida(articleId)) {
      errores.push({ campo: `consumosPorArticulo.${articleId}`, motivo: 'id-invalido', mensaje: `"${articleId}" no es un identificador de artículo válido.` });
      return;
    }
    if (Object.keys(articulos).length > 0 && !Object.prototype.hasOwnProperty.call(articulos, articleId)) {
      avisos.push({ campo: `consumosPorArticulo.${articleId}`, motivo: 'inexistente', mensaje: `El artículo "${articleId}" no está en el catálogo actual. El consumo queda guardado pero hoy no se usa.` });
    }
    const v = aNumero(overrides[articleId]);
    if (v === null || v <= 0) {
      errores.push({ campo: `consumosPorArticulo.${articleId}`, motivo: 'invalido', mensaje: `El consumo de "${articleId}" tiene que ser un número mayor que cero.` });
    }
  });

  return { valido: errores.length === 0, errores, avisos };
}

/**
 * Objeto que se persiste. Guarda IDs reales completos, nunca reducidos, y no
 * escribe `origen` en un grupo viejo que sigue siendo manual y no se tocó.
 */
export function construirGrupoParaGuardar(form, grupoExistente = {}) {
  const f = form || {};
  const base = { ...(grupoExistente && typeof grupoExistente === 'object' ? grupoExistente : {}) };
  delete base.origenOriginal;

  base.nombre = idCanonico(f.nombre) || f.nombre || '';
  if (f.min !== undefined) { const n = aNumero(f.min); if (n !== null) base.min = n; }
  if (f.max !== undefined) { const n = aNumero(f.max); if (n !== null) base.max = n; }
  if (f.obligatorio !== undefined) base.obligatorio = f.obligatorio === true;
  if (f.activo !== undefined) base.activo = f.activo !== false;

  if (f.origen === ORIGEN_DEPARTAMENTO) {
    base.origen = ORIGEN_DEPARTAMENTO;
    base.departamentoId = idCanonico(f.departamentoId);
    base.usarPrecioArticulo = f.usarPrecioArticulo !== false;
    base.controlarStock = f.controlarStock !== false;
    const def = aNumero(f.consumoStockUnitarioDefault);
    base.consumoStockUnitarioDefault = def === null ? 1 : def;

    const overrides = f.consumosPorArticulo && typeof f.consumosPorArticulo === 'object' ? f.consumosPorArticulo : {};
    const limpios = {};
    Object.keys(overrides).forEach((articleId) => {
      const v = aNumero(overrides[articleId]);
      if (v === null) return;
      if (v === base.consumoStockUnitarioDefault) return; // override sólo cuando difiere
      limpios[idCanonico(articleId)] = v;
    });
    if (Object.keys(limpios).length > 0) base.consumosPorArticulo = limpios;
    else delete base.consumosPorArticulo;
    return base;
  }

  // Manual. Si el grupo ya declaraba un origen, se conserva la declaración
  // explícita; si nunca lo tuvo, sigue sin tenerlo.
  if (f.origenOriginal || f.origenTocado === true) base.origen = ORIGEN_MANUAL;
  else delete base.origen;

  // Los datos de departamento no se borran solos: la pantalla decide, con
  // confirmación del usuario, si los limpia (`limpiarDatosDepartamento`).
  return base;
}

/** Limpieza explícita, sólo tras confirmación del usuario. */
export function limpiarDatosDepartamento(grupo) {
  const g = { ...(grupo && typeof grupo === 'object' ? grupo : {}) };
  delete g.departamentoId;
  delete g.usarPrecioArticulo;
  delete g.controlarStock;
  delete g.consumoStockUnitarioDefault;
  delete g.consumosPorArticulo;
  delete g.configDepartamento;
  return g;
}
