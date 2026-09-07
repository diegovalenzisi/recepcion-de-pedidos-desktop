// ---------------------------------------------------------------------------
// DEPARTAMENTOS CANÓNICOS — PEDIDOSYA / RAPPI / M.LIBRE
//
// Antes de esto, cada local escribía estos tres departamentos con el nombre
// que se le ocurriera a quien los cargó a mano: "PEDIDOS YA", "PEDIDOSYA",
// "RAPPI", etc. Esto resuelve esa variación en los dos sentidos que hacen
// falta:
//
//   1. `planDepartamentosCanonicos()` decide, para los DEPARTAMENTOS de un
//      local, si hay que ADAPTAR uno ya existente (reusar su id, corregir
//      nombre y flags) o CREARLO — nunca duplica uno que ya está, aunque esté
//      mal escrito.
//   2. `normalizarNombreDepartamento()` es la función que reconoce un
//      departamento como uno de los tres SIN depender de que su nombre esté
//      escrito exactamente igual — la usa tanto el paso 1 como el reporte de
//      Reportes Prepago (ver `ventasPorDepartamento.js`).
//
// Todo lo de acá es de SOLO LECTURA/CÁLCULO: no escribe en Firebase. El
// writer real vive en `departamentosCanonicosApi.js`.
//
// Módulo puro: sin Firebase, sin React, sin DOM.
// ---------------------------------------------------------------------------

/** Nombre EXACTO con el que se guarda cada departamento canónico. */
export const NOMBRE_CANONICO = Object.freeze({
  PEDIDOSYA: 'PEDIDOSYA',
  RAPPI: 'RAPPI',
  MLIBRE: 'M.LIBRE',
});

/** Claves canónicas, en el orden en que deben aparecer las pestañas del reporte. */
export const CLAVES_CANONICAS = Object.freeze(['PEDIDOSYA', 'RAPPI', 'MLIBRE']);

// Forma normalizada (sin mayúsculas/minúsculas, espacios, puntos ni guiones)
// → clave canónica. "Mercado Libre" se acepta como alias del nombre completo
// de la plataforma; el resto son variantes de formato del mismo nombre.
const ALIAS_A_CLAVE = Object.freeze({
  PEDIDOSYA: 'PEDIDOSYA',
  RAPPI: 'RAPPI',
  MLIBRE: 'MLIBRE',
  MERCADOLIBRE: 'MLIBRE',
});

/**
 * Normaliza el nombre de un departamento a su clave canónica
 * ('PEDIDOSYA' | 'RAPPI' | 'MLIBRE'), ignorando mayúsculas/minúsculas,
 * espacios, puntos y guiones (y acentos, por robustez). Devuelve null si el
 * nombre no corresponde a ninguno de los tres.
 *
 *   "PEDIDOS YA", "PedidosYa", "PEDIDOS.YA", "pedidos-ya" → 'PEDIDOSYA'
 *   "M.LIBRE", "M. LIBRE", "M LIBRE", "MLIBRE", "Mercado Libre" → 'MLIBRE'
 */
export function normalizarNombreDepartamento(nombre) {
  if (nombre === null || nombre === undefined) return null;
  const limpio = String(nombre)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[\s.\-_]+/g, '');
  if (!limpio) return null;
  return ALIAS_A_CLAVE[limpio] || null;
}

// ---------------------------------------------------------------------------
// Plan de departamentos canónicos
// ---------------------------------------------------------------------------

/** Estado objetivo de un departamento canónico (además del `nombre`). */
const camposObjetivo = (nombreCanonico) => ({
  nombre: nombreCanonico,
  activo: true,
  activoMostrador: true,
  activoDelivery: false,        // "únicamente en ventas de Mostrador"
  permiteVentaEfectivo: true,   // "permitir cualquier método de pago"
  permiteVentaElectronica: true,
});

/** Extrae el número de un id de departamento ("10D" → 10). null si no aplica. */
function numeroDeId(id) {
  const n = parseInt(String(id ?? '').replace('D', ''), 10);
  return Number.isNaN(n) ? null : n;
}

/** Próximo id libre ("D" + siguiente número), evitando los ya repartidos en este mismo plan. */
function siguienteIdDepartamento(departamentosExistentes, idsYaAsignados) {
  let max = 0;
  for (const id of Object.keys(departamentosExistentes || {})) {
    const n = numeroDeId(id);
    if (n !== null && n > max) max = n;
  }
  for (const id of idsYaAsignados) {
    const n = numeroDeId(id);
    if (n !== null && n > max) max = n;
  }
  return `${max + 1}D`;
}

/**
 * Plan de qué hacer con los tres departamentos canónicos de un local, dado su
 * nodo `/{localId}/DEPARTAMENTOS` actual. NO modifica nada — es una función
 * pura de solo cálculo.
 *
 * @param {object} departamentosExistentes  el objeto DEPARTAMENTOS tal cual está en Firebase (o {}/null)
 * @returns {Array<{
 *   clave: 'PEDIDOSYA'|'RAPPI'|'MLIBRE',
 *   nombreCanonico: string,
 *   accion: 'crear'|'adaptar'|'sin_cambios',
 *   id: string,
 *   nombreActual: string|null,
 *   cambios: object,          // campos a escribir (vacío si accion === 'sin_cambios')
 *   duplicados: string[],     // OTROS ids que también matchean esta clave — no se tocan, solo se informan
 * }>}
 */
export function planDepartamentosCanonicos(departamentosExistentes = {}) {
  const entradas = Object.entries(departamentosExistentes || {});
  const plan = [];
  const idsAsignadosEnEstePlan = [];

  for (const clave of CLAVES_CANONICAS) {
    const nombreCanonico = NOMBRE_CANONICO[clave];

    const coincidencias = entradas
      .filter(([, dep]) => normalizarNombreDepartamento(dep?.nombre) === clave)
      .map(([id]) => id)
      .sort((a, b) => {
        const na = numeroDeId(a);
        const nb = numeroDeId(b);
        if (na !== null && nb !== null) return na - nb;
        return String(a).localeCompare(String(b));
      });

    if (coincidencias.length === 0) {
      const id = siguienteIdDepartamento(departamentosExistentes, idsAsignadosEnEstePlan);
      idsAsignadosEnEstePlan.push(id);
      plan.push({
        clave,
        nombreCanonico,
        accion: 'crear',
        id,
        nombreActual: null,
        cambios: { ...camposObjetivo(nombreCanonico), ordenLocal: 0, ordenWeb: 0 },
        duplicados: [],
      });
      continue;
    }

    // Con más de una coincidencia (departamento duplicado) se elige el de id
    // más chico —determinístico y estable entre corridas— y el resto se
    // informa como `duplicados`, SIN tocarlos: fusionarlos automáticamente
    // podría mezclar el historial de ventas de dos departamentos distintos.
    const [idElegido, ...duplicados] = coincidencias;
    const actual = departamentosExistentes[idElegido] || {};
    const objetivo = camposObjetivo(nombreCanonico);

    const cambios = {};
    for (const [campo, valor] of Object.entries(objetivo)) {
      if (actual[campo] !== valor) cambios[campo] = valor;
    }

    plan.push({
      clave,
      nombreCanonico,
      id: idElegido,
      nombreActual: actual.nombre ?? null,
      accion: Object.keys(cambios).length === 0 ? 'sin_cambios' : 'adaptar',
      cambios,
      duplicados,
    });
  }

  return plan;
}

/**
 * Aplica un plan sobre un DEPARTAMENTOS existente y devuelve el resultado
 * (nuevo objeto — no muta el original). Sirve para tests de idempotencia y es
 * la misma transformación que hace el writer real contra Firebase.
 */
export function aplicarPlanDepartamentos(departamentosExistentes, plan) {
  const resultado = { ...(departamentosExistentes || {}) };
  for (const paso of plan) {
    if (paso.accion === 'crear') {
      resultado[paso.id] = { ...paso.cambios };
    } else if (paso.accion === 'adaptar') {
      resultado[paso.id] = { ...(resultado[paso.id] || {}), ...paso.cambios };
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Visibilidad en Mostrador
//
// Los tres departamentos canónicos existen SIEMPRE en Firebase (nunca se
// borran ni se desactivan — `activo`/`activoMostrador` quedan fijos en true
// por el plan de arriba), pero en la GRILLA de Mostrador sólo tiene sentido
// listarlos si tienen algún artículo asignado: una pestaña vacía no sirve
// para nada y confunde al cajero. Esta regla es SOLO de visualización — no
// toca Firebase — y sólo aplica a estos tres, nunca al resto del catálogo de
// departamentos del local.
// ---------------------------------------------------------------------------

/**
 * Cuenta artículos por departamento a partir del catálogo, usando
 * `articulo.departamento` (el id real del depto). Ignora artículos sin
 * departamento asignado.
 */
export function contarArticulosPorDepartamento(articulos) {
  const conteo = {};
  for (const a of (articulos || [])) {
    const depId = a?.departamento;
    if (!depId) continue;
    conteo[depId] = (conteo[depId] || 0) + 1;
  }
  return conteo;
}

/**
 * ¿Este departamento debe listarse en la grilla de Mostrador? Para los tres
 * canónicos (PEDIDOSYA/RAPPI/M.LIBRE): sólo si tiene 1 o más artículos
 * asignados. Para cualquier otro departamento la regla no aplica — siempre
 * visible (asumiendo que ya pasó el filtro de `activoMostrador` de siempre).
 */
export function departamentoVisibleEnMostrador(departamento, cantidadArticulos) {
  const clave = normalizarNombreDepartamento(departamento?.nombre);
  if (!CLAVES_CANONICAS.includes(clave)) return true;
  return (Number(cantidadArticulos) || 0) > 0;
}

/**
 * Filtra una lista de departamentos (ya restringida a `activoMostrador`) para
 * la grilla de Mostrador: aplica `departamentoVisibleEnMostrador` a cada uno.
 * `departamentos` deben traer `id` (la clave real de Firebase, como la
 * devuelve `fetchData('departamentos')`).
 */
export function filtrarDepartamentosVisiblesEnMostrador(departamentos, articulos) {
  const conteo = contarArticulosPorDepartamento(articulos);
  return (departamentos || []).filter((d) => departamentoVisibleEnMostrador(d, conteo[d?.id]));
}

/**
 * Traduce un plan a un objeto de `updates` planos para `update(ref(db), …)`:
 * sólo incluye los pasos que realmente cambian algo. Crear escribe el
 * departamento completo de una vez; adaptar sólo toca los campos que difieren
 * (nunca pisa `ordenLocal`/`ordenWeb` ni ningún otro campo del departamento
 * existente).
 */
export function construirUpdatesDesdePlan(plan, localId) {
  const updates = {};
  for (const paso of plan) {
    if (paso.accion === 'crear') {
      updates[`${localId}/DEPARTAMENTOS/${paso.id}`] = paso.cambios;
    } else if (paso.accion === 'adaptar') {
      for (const [campo, valor] of Object.entries(paso.cambios)) {
        updates[`${localId}/DEPARTAMENTOS/${paso.id}/${campo}`] = valor;
      }
    }
  }
  return updates;
}
