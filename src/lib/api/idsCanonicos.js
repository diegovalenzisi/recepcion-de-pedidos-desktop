// ---------------------------------------------------------------------------
// IDENTIDAD CANÓNICA de departamentos y artículos.
//
// El identificador canónico es LA CLAVE REAL DE FIREBASE, completa: `D123`,
// `A-0007`, `O-40`. Nunca su versión "solo dígitos".
//
// Por qué existe este archivo: DLV Pedidos venía normalizando los IDs con
// `String(key).replace(/\D/g, '')`. Eso es una función NO INYECTIVA: `D12`,
// `12`, `D0012` y `AB12` colapsan todos a `12`. Usar eso como identidad permite
// que dos departamentos distintos se confundan y que un topping se cobre o
// descuente contra el artículo equivocado.
//
// Regla:
//   1. Se compara SIEMPRE primero por ID exacto.
//   2. El alias legado (solo dígitos) se usa ÚNICAMENTE como compatibilidad,
//      y solo cuando uno de los dos registros es histórico.
//   3. Si el alias legado puede corresponder a más de un candidato, la
//      comparación es AMBIGUA y se rechaza: nunca se adivina.
//
// Módulo puro: sin Firebase, sin React, sin DOM. Idéntico en los tres repos.
// ---------------------------------------------------------------------------

/** ID canónico: la clave real, recortada. Nunca se le quitan letras. */
export function idCanonico(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s.length > 0 ? s : null;
}

/**
 * Alias legado: la forma "solo dígitos" que escribía DLV. Se usa nada más que
 * para reconocer datos históricos. NO es una identidad.
 */
export function aliasLegado(valor) {
  const s = idCanonico(valor);
  if (s === null) return null;
  const soloDigitos = s.replace(/\D/g, '');
  return soloDigitos.length > 0 ? String(Number(soloDigitos)) : null;
}

/** ¿Dos identificadores son EXACTAMENTE el mismo? (única comparación segura) */
export function mismoIdExacto(a, b) {
  const x = idCanonico(a);
  const y = idCanonico(b);
  return x !== null && x === y;
}

/**
 * Resuelve un identificador recibido contra un conjunto de claves reales.
 *
 * @param {string} recibido        identificador que llegó en el pedido
 * @param {string[]} clavesReales  claves reales del catálogo del local
 * @param {{ permitirLegado?: boolean }} opts
 *        permitirLegado: solo true cuando el dato de origen es histórico.
 * @returns {{ id: string|null, via: 'exacto'|'legado'|null,
 *             ambiguo: boolean, candidatos: string[] }}
 */
export function resolverId(recibido, clavesReales, { permitirLegado = false } = {}) {
  const buscado = idCanonico(recibido);
  const claves = Array.isArray(clavesReales) ? clavesReales.map(idCanonico).filter(Boolean) : [];
  const vacio = { id: null, via: null, ambiguo: false, candidatos: [] };
  if (buscado === null) return vacio;

  // 1. Coincidencia exacta: siempre gana y nunca es ambigua.
  if (claves.includes(buscado)) return { id: buscado, via: 'exacto', ambiguo: false, candidatos: [buscado] };

  if (!permitirLegado) return vacio;

  // 2. Compatibilidad legada: solo si el alias identifica a UNO solo.
  const alias = aliasLegado(buscado);
  if (alias === null) return vacio;
  const candidatos = claves.filter((k) => aliasLegado(k) === alias);
  if (candidatos.length === 1) return { id: candidatos[0], via: 'legado', ambiguo: false, candidatos };
  if (candidatos.length > 1) return { id: null, via: null, ambiguo: true, candidatos };
  return vacio;
}

/**
 * ¿Este conjunto de claves es seguro para usar el alias legado? Si dos claves
 * distintas comparten alias, cualquier dato histórico que lo use es ambiguo.
 * Sirve para avisar en configuración, antes de que el problema aparezca en un
 * pedido real.
 */
export function detectarAliasAmbiguos(clavesReales) {
  const porAlias = {};
  for (const k of (Array.isArray(clavesReales) ? clavesReales : [])) {
    const id = idCanonico(k);
    const alias = aliasLegado(id);
    if (!id || alias === null) continue;
    (porAlias[alias] = porAlias[alias] || []).push(id);
  }
  return Object.entries(porAlias)
    .filter(([, ids]) => ids.length > 1)
    .map(([alias, ids]) => ({ alias, ids }));
}

/**
 * ¿La referencia guardada en un pedido es "moderna"? Un snapshot nuevo guarda el
 * ID completo; uno histórico de DLV puede traer solo dígitos. Se usa para decidir
 * si corresponde habilitar la compatibilidad legada.
 */
export function esIdLegado(valor) {
  const s = idCanonico(valor);
  if (s === null) return false;
  return /^\d+$/.test(s);
}
