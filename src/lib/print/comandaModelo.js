// ---------------------------------------------------------------------------
// MODELO CANÓNICO DE LA COMANDA — funciones puras, sin DOM, sin React, sin
// Firebase, sin catálogo remoto. Idéntico en Desktop y Tablet.
//
// Resuelve las DOS cosas que hacían que un pedido de DLV Pedidos se imprimiera
// distinto que el mismo pedido cargado a mano:
//
// 1) EL TÍTULO DE CADA GRUPO
//
//    La comanda resolvía el título buscando el id del grupo en el catálogo del
//    local y, si no lo encontraba, escribía "Opcionales" (que el CSS pasa a
//    mayúsculas). Los pedidos cargados a mano guardan el id real del catálogo
//    ("1G"), así que encontraban "SABORES"; los que llegan de DLV Pedidos
//    guardan un id compuesto por artículo ("group-81A-1G"), que NO existe en el
//    catálogo, así que TODOS los grupos salían como "OPCIONALES".
//
//    El dato nunca se había perdido: el propio pedido trae `grupoNombre` en
//    cada opción ("SABORES", "SALSAS"). Lo que faltaba era mirarlo.
//
//    Cascada de resolución (nunca se infiere por el contenido):
//      1. catálogo del local por id EXACTO            → el nombre configurado hoy
//      2. catálogo del local por id NORMALIZADO       → "group-81A-1G" → "1G"
//      3. `grupoNombre` / `groupName` del snapshot    → lo que mandó el origen
//      4. `tipoGrupo` / `departamento` del snapshot   → última pista real
//      5. "OPCIONALES"                                → sólo si no hay NADA
//
//    El paso 2 no adivina: sólo acepta el id recortado si ese id existe de
//    verdad en el catálogo. "OPCIONALES" deja de ser un reemplazo general y
//    pasa a ser lo que siempre debió ser: el nombre de un grupo que realmente
//    se llama así, o el último recurso de un registro histórico sin datos.
//
// 2) LOS BLOQUES POR UNIDAD (y por qué NO se imprime "UNIDAD X DE Y")
//
//    Ese texto lo agregaba la comanda cuando la línea tenía `unidadTotal > 1`.
//    NO venía de DLV Pedidos: manual y DLV numeran las unidades con el mismo
//    `renumerarUnidades`, así que los dos lo mostraban igual.
//
//    Ya no se imprime NUNCA. Cada unidad configurada se imprime como su propio
//    BLOQUE, repitiendo el nombre del artículo y con su propia selección, y los
//    bloques se separan visualmente. La separación alcanza para distinguirlas;
//    la numeración sólo ensuciaba la comanda.
//
//    Dos unidades configuradas NO se juntan aunque su selección sea idéntica:
//    se pidieron por separado y cada una se prepara por separado.
//
//    La única línea que conserva "N x ARTÍCULO" es la que ya venía así: una
//    cantidad simple, sin configuración por unidad (un artículo sin opcionales
//    que el operador cargó con cantidad 3 sigue siendo "3x").
// ---------------------------------------------------------------------------

/** Fallback histórico. NO se usa como reemplazo general (ver cascada). */
export const TITULO_GRUPO_POR_DEFECTO = 'OPCIONALES';

const texto = (v) => {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object') {
    if (typeof v.nombre === 'string' && v.nombre.trim()) return v.nombre.trim();
    if (typeof v.name === 'string' && v.name.trim()) return v.name.trim();
  }
  return null;
};

/** Catálogo de grupos (array o mapa de Firebase) → Map id → grupo. */
export function indexarGrupos(catalogoGrupos) {
  const mapa = new Map();
  if (!catalogoGrupos) return mapa;
  const entradas = Array.isArray(catalogoGrupos)
    ? catalogoGrupos.map((g) => [g && (g.id ?? g.key), g])
    : Object.entries(catalogoGrupos);
  for (const [id, g] of entradas) {
    if (id === undefined || id === null || !g) continue;
    mapa.set(String(id), g);
  }
  return mapa;
}

/**
 * Candidatos de id para buscar en el catálogo, del más específico al más
 * general. Sólo recorta prefijos compuestos conocidos; nunca inventa un id.
 *
 *   "group-81A-1G" → ["group-81A-1G", "1G", "81A-1G"]
 */
export function idsCandidatos(groupId) {
  const id = String(groupId ?? '').trim();
  if (!id) return [];
  const salida = [id];
  const partes = id.split('-');
  if (partes.length > 1) {
    const ultimo = partes[partes.length - 1];
    if (ultimo && ultimo !== id) salida.push(ultimo);
    if (partes.length > 2) {
      const sinPrefijo = partes.slice(1).join('-');
      if (sinPrefijo && !salida.includes(sinPrefijo)) salida.push(sinPrefijo);
    }
  }
  return salida;
}

/**
 * Título real del grupo, con la cascada documentada arriba.
 *
 * @param {string} groupId            id tal como lo guardó el pedido
 * @param {Array}  opciones           opciones seleccionadas de ESE grupo
 * @param {Map|object|Array} catalogo grupos configurados del local
 * @returns {{titulo: string, origen: string}} `origen` sirve para las pruebas y
 *          para poder auditar de dónde salió cada título.
 */
export function resolverTituloGrupo(groupId, opciones, catalogo) {
  const indice = catalogo instanceof Map ? catalogo : indexarGrupos(catalogo);
  const lista = Array.isArray(opciones) ? opciones.filter(Boolean) : [];

  // 1 y 2 — el catálogo del local es la autoridad sobre el nombre configurado.
  const candidatos = idsCandidatos(groupId);
  for (let i = 0; i < candidatos.length; i += 1) {
    const g = indice.get(candidatos[i]);
    const nombre = texto(g && (g.nombre ?? g.name));
    if (nombre) return { titulo: nombre, origen: i === 0 ? 'catalogo' : 'catalogo-id-normalizado' };
  }

  // 3 — el título que viajó con el pedido (lo que mandó DLV Pedidos o Desktop).
  for (const op of lista) {
    const nombre = texto(op.grupoNombre) || texto(op.groupName);
    if (nombre) return { titulo: nombre, origen: 'snapshot' };
  }

  // 4 — tipo o departamento, si el origen los mandó.
  for (const op of lista) {
    const tipo = texto(op.tipoGrupo) || texto(op.departamento) || texto(op.departamentoNombre);
    if (tipo) return { titulo: tipo, origen: 'tipo' };
  }

  // 5 — histórico sin nada recuperable.
  return { titulo: TITULO_GRUPO_POR_DEFECTO, origen: 'fallback' };
}

/**
 * `selectedOptionals` → modelo canónico de grupos, listo para pintar en
 * pantalla o imprimir. Mismo modelo para los dos destinos.
 *
 * @returns {Array<{idGrupo, nombreGrupo, tipoGrupo, origenTitulo, opciones: Array<{nombre, cantidad, precio}>}>}
 */
export function gruposDeOpcionales(selectedOptionals, catalogo) {
  if (!selectedOptionals || typeof selectedOptionals !== 'object') return [];
  const indice = catalogo instanceof Map ? catalogo : indexarGrupos(catalogo);
  const salida = [];

  for (const [idGrupo, crudo] of Object.entries(selectedOptionals)) {
    const lista = (Array.isArray(crudo) ? crudo : []).filter((o) => o && texto(o));
    if (lista.length === 0) continue;

    const { titulo, origen } = resolverTituloGrupo(idGrupo, lista, indice);
    const grupoCatalogo = idsCandidatos(idGrupo).map((c) => indice.get(c)).find(Boolean);

    const opciones = lista
      .slice()
      .sort((a, b) => {
        const na = Number(a.numeroOrden); const nb = Number(b.numeroOrden);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return 0;
      })
      .map((op) => ({
        nombre: texto(op) || '',
        cantidad: Number(op.cantidad ?? op.quantity ?? 1) || 1,
        precio: op.precioUnitario !== undefined ? op.precioUnitario : op.precio,
      }));

    salida.push({
      idGrupo: String(idGrupo),
      nombreGrupo: titulo,
      tipoGrupo: texto(grupoCatalogo && grupoCatalogo.tipo) || texto(lista[0].tipoGrupo) || null,
      origenTitulo: origen,
      orden: Number(grupoCatalogo && (grupoCatalogo.ordenLocal ?? grupoCatalogo.orden)) || 0,
      opciones,
    });
  }

  // Orden estable: el configurado en el catálogo y, a igualdad, el del pedido.
  return salida.sort((a, b) => a.orden - b.orden);
}

/**
 * ¿Esta línea es una UNIDAD CONFIGURADA individualmente?
 *
 * Lo es cuando trae selección propia: opcionales elegidos o hijos de promo.
 * Esas líneas se guardan una por unidad (tanto en la carga manual como en DLV
 * Pedidos) y por eso se imprimen como bloques separados.
 *
 * Una línea SIN configuración es una cantidad simple: se imprime "N x" como
 * siempre.
 */
export function esUnidadConfigurada(item) {
  if (!item || typeof item !== 'object') return false;
  const sel = item.selectedOptionals;
  if (sel && typeof sel === 'object' && Object.values(sel).some((l) => Array.isArray(l) && l.length > 0)) return true;
  const hijos = item.promoItems || item.promoDetails;
  return Array.isArray(hijos) && hijos.length > 0;
}

/**
 * Bloques de la comanda, en el mismo orden en que se pidieron.
 *
 * - Unidad configurada → UN bloque propio, con el nombre del artículo repetido
 *   y su selección. NUNCA se junta con otra, ni aunque la selección sea
 *   idéntica: se pidieron por separado y se preparan por separado.
 * - Cantidad simple    → un bloque con "N x ARTÍCULO", como siempre.
 *
 * No se numera nada: los bloques se distinguen por la separación visual que
 * agrega la comanda. No cambia precios, ni cantidades, ni el orden.
 *
 * @returns {Array<{item: object, cantidad: number, esUnidad: boolean}>}
 */
export function bloquesDeComanda(items) {
  const lista = Array.isArray(items) ? items : [];
  const salida = [];

  for (const it of lista) {
    if (!it || typeof it !== 'object') continue;
    const esUnidad = esUnidadConfigurada(it);
    const cantidadLinea = Number(it.quantity);
    salida.push({
      item: it,
      // Una unidad configurada vale 1: su cantidad ya está en que existe la línea.
      cantidad: esUnidad ? 1 : (Number.isFinite(cantidadLinea) && cantidadLinea > 0 ? cantidadLinea : 1),
      esUnidad,
    });
  }

  return salida;
}
