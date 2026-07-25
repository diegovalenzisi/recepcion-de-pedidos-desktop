// ---------------------------------------------------------------------------
// DISPONIBILIDAD DERIVADA POR RECETA
//
// Un artículo con receta NO puede venderse por delivery si alguna de sus
// materias primas no alcanza para preparar la cantidad pedida. La disponibilidad
// se CALCULA a partir del stock y la receta vigentes; nunca se persiste ni se
// toca `activoDelivery`/`activo` (esa sigue siendo la decisión manual del
// usuario). Reponer la materia prima vuelve a habilitar el artículo solo si
// seguía habilitado manualmente, sin ningún estado "recordado".
//
//   disponibleEfectivamenteParaDelivery(art) =
//        (art.activoDelivery !== false)     // activo MANUAL — solo se LEE
//     && (art.activo !== false)             // artículo activo
//     && recetaConStockSuficiente(id, articulos, materiaPrima, 1)
//
// IGNORA STOCK: una materia prima con `ignoraStock === true` (y que no esté
// desactivada a mano) NO limita ni bloquea: se comporta como ilimitada en todos
// los cálculos de este módulo, aunque su stock sea 0 o negativo. La regla vive
// en `deliveryPorStock.js` (`materiaPrimaIgnoraStock`) y se importa desde acá
// para que Desktop, Tablet y DLV la interpreten EXACTAMENTE igual. El descuento
// de stock NO pasa por este módulo: se sigue registrando siempre.
//
// Identidad SIEMPRE por ID canónico (la clave real de Firebase), nunca por
// nombre. Se lee exclusivamente el catálogo del local actual: la separación por
// local la garantiza quien provee `articulos` y `materiaPrima`.
//
// Módulo puro: sin Firebase, sin React, sin DOM, sin import.meta. Idéntico en
// Desktop, Tablet y DLV Pedidos.
// ---------------------------------------------------------------------------

import { materiaPrimaIgnoraStock } from './deliveryPorStock.js';

/** Cantidad numérica tolerante a coma decimal y strings históricos. Nunca NaN. */
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : 0; }
  return 0;
}

/** Stock normalizado a un número >= 0. Nunca negativo, nunca NaN. */
function stockNoNegativo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Tolerancia que absorbe SOLO el ruido de punto flotante de las cantidades de
// receta (p.ej. 3 × 0,05 = 0,15000000000000002, o 0,15 / 0,05 = 2,9999…). No
// tolera faltantes reales: es varios órdenes de magnitud menor que cualquier
// cantidad de receta legítima.
const EPSILON = 1e-9;

/** Tipo de stock efectivo de un artículo, con la misma regla que ya usa el sistema. */
export function tipoDeStock(stock) {
  const s = stock || {};
  if (s.stockType) return s.stockType;
  if (s.receta && typeof s.receta === 'object' && Object.keys(s.receta).length > 0) return 'receta';
  if (s.heredadoDe) return 'heredado';
  if (s.propio !== undefined) return 'propio';
  return 'ninguno';
}

/** Normaliza la receta (objeto {codigo: qty} o array [{codigo|id|nombre, cantidad}]) a entradas [id, qty]. */
function entradasDeReceta(receta) {
  if (Array.isArray(receta)) {
    return receta.map((ing) => [ing.codigo || ing.id || ing.nombre, ing.cantidad]).filter(([id]) => Boolean(id));
  }
  return Object.entries(receta || {});
}

/**
 * Cuántas unidades reales del artículo pueden fabricarse/venderse, siguiendo la
 * misma resolución propio/heredado/receta que usa el descuento de stock, pero
 * SIN modificar nada (solo lee). Es la misma lógica que `getAvailableUnits`.
 *
 * Reglas:
 * - `controlStock === false` (artículo o materia prima) → Infinity (ilimitado).
 * - materia prima con "Ignora Stock" → Infinity (no limita, igual que la
 *   anterior): su faltante no debe reducir las unidades fabricables.
 * - stock propio → `stock.propio` (nunca negativo, nunca NaN).
 * - stock heredado → disponibilidad del padre (misma unidad, sin dividir).
 * - stock por receta → para cada ingrediente:
 *     ratio = disponible(ingrediente) / cantidadRequerida
 *   Se toma el MÍNIMO de los ratios SIN redondear cada uno, y recién al final se
 *   aplica UN SOLO Math.floor. Receta vacía → Infinity (nada la limita).
 * - materia prima hoja → su stock crudo (cantidad continua, sin redondear).
 * - referencia inexistente → 0. Ciclo (detectado por rama) → 0.
 *
 * @returns {number} unidades disponibles (entero para artículos por receta) o
 *   Infinity si no hay control de stock. Nunca NaN, nunca negativo.
 */
export function unidadesFabricables(articleId, articulos = {}, materiaPrima = {}, visited = new Set()) {
  if (!articleId) return 0;
  if (visited.has(articleId)) return 0; // ciclo: corta y limita
  const next = new Set(visited);
  next.add(articleId);

  const article = articulos[articleId];
  if (article) {
    if (article.controlStock === false) return Infinity;

    const stock = article.stock || {};
    const tipo = tipoDeStock(stock);

    if (tipo === 'heredado' && stock.heredadoDe) {
      return unidadesFabricables(stock.heredadoDe, articulos, materiaPrima, next);
    }

    if (tipo === 'receta' && stock.receta) {
      const entradas = entradasDeReceta(stock.receta);
      if (entradas.length === 0) return Infinity; // receta vacía: nada la limita

      let minRatio = Infinity;
      for (const [ingId, rawQty] of entradas) {
        const requerido = numero(rawQty);
        if (!(requerido > 0)) continue; // cantidad inválida/cero: no restringe
        const disponible = unidadesFabricables(ingId, articulos, materiaPrima, next);
        const ratio = disponible / requerido; // SIN redondear todavía
        if (ratio < minRatio) minRatio = ratio;
      }
      if (minRatio === Infinity) return Infinity;
      return Math.max(0, Math.floor(minRatio)); // UN SOLO floor, al final
    }

    // propio (o tipo desconocido): stock numérico directo del artículo.
    return stockNoNegativo(stock.propio);
  }

  const mp = materiaPrima[articleId];
  if (mp) {
    if (mp.controlStock === false) return Infinity;
    if (materiaPrimaIgnoraStock(mp)) return Infinity; // "Ignora Stock": no limita
    if (mp.heredadoDe) return unidadesFabricables(mp.heredadoDe, articulos, materiaPrima, next);
    return stockNoNegativo(mp.stock); // cantidad continua, sin redondear
  }

  return 0; // referencia inexistente: valor seguro que limita
}

/**
 * ¿La receta del artículo tiene stock suficiente para `unidades` unidades?
 *
 * Devuelve `true` (NO bloquea) para artículos sin receta, `controlStock === false`
 * o receta vacía: esos casos conservan su comportamiento anterior. Solo evalúa el
 * stock cuando el tipo de stock efectivo es `receta`.
 */
export function recetaConStockSuficiente(articleId, articulos = {}, materiaPrima = {}, unidades = 1) {
  const article = articulos[articleId];
  if (!article) return true;                 // desconocido: no se bloquea (política vigente)
  if (article.controlStock === false) return true;
  if (tipoDeStock(article.stock) !== 'receta') return true; // sin receta: intacto

  // Decisión EXACTA por acumulación de consumo real (respeta cantidad × receta
  // y anidamiento), sin el redondeo intermedio de `unidadesFabricables`.
  return evaluarRecetaPedido(articleId, unidades, articulos, materiaPrima).suficiente;
}

/**
 * Evaluación DETALLADA para el registro técnico y la validación del pedido.
 * Recorre la receta y reporta, por materia prima que no alcanza, el stock actual
 * y la cantidad requerida (`unidades × cantidadEnReceta`, incluso anidada).
 *
 * Las materias primas con "Ignora Stock" quedan FUERA del consumo evaluado, así
 * que nunca aparecen como faltantes: no bloquean el catálogo, ni el carrito, ni
 * la confirmación, ni la validación del pedido al recibirlo. Las demás materias
 * primas de la misma receta se siguen evaluando igual que siempre.
 *
 * @returns {{ suficiente: boolean,
 *             faltantes: Array<{ materiaPrimaId, stockActual, requerido }>,
 *             avisos: Array<object> }}
 */
export function evaluarRecetaPedido(articleId, unidades, articulos = {}, materiaPrima = {}) {
  const faltantes = [];
  const avisos = [];
  const necesarias = numero(unidades) > 0 ? numero(unidades) : 1;

  const article = articulos[articleId];
  if (!article) { avisos.push({ tipo: 'articulo-inexistente', id: articleId }); return { suficiente: true, faltantes, avisos }; }
  if (article.controlStock === false) return { suficiente: true, faltantes, avisos };
  if (tipoDeStock(article.stock) !== 'receta') return { suficiente: true, faltantes, avisos };

  // Acumula el consumo REAL por materia prima (respeta anidamiento y cantidades),
  // sin descontar nada, y luego compara contra el stock disponible de cada una.
  const consumo = {};
  const acumular = (id, cantidad, visited) => {
    if (!id || !(cantidad > 0)) return;
    if (visited.has(id)) { avisos.push({ tipo: 'ciclo', id }); return; }
    const next = new Set(visited); next.add(id);

    const art = articulos[id];
    if (art) {
      if (art.controlStock === false) return;
      const tipo = tipoDeStock(art.stock);
      if (tipo === 'heredado' && art.stock?.heredadoDe) { acumular(art.stock.heredadoDe, cantidad, next); return; }
      if (tipo === 'receta' && art.stock?.receta) {
        const entradas = entradasDeReceta(art.stock.receta);
        if (entradas.length === 0) { avisos.push({ tipo: 'receta-vacia', id }); return; }
        for (const [ingId, rawQty] of entradas) {
          const req = numero(rawQty);
          if (!(req > 0)) { avisos.push({ tipo: 'cantidad-invalida', id, ingrediente: ingId, crudo: rawQty }); continue; }
          acumular(ingId, cantidad * req, next);
        }
        return;
      }
      // propio/desconocido: es un nodo físico de artículo con stock propio.
      consumo[id] = consumo[id] || { tipo: 'ARTICULO', cantidad: 0 };
      consumo[id].cantidad += cantidad;
      return;
    }
    const mp = materiaPrima[id];
    if (mp) {
      if (mp.controlStock === false) return;
      // "Ignora Stock": no se acumula su consumo, así que jamás puede figurar
      // como faltante. El descuento real se sigue haciendo aparte (stockPlan /
      // stockAtomico) y puede dejar el stock negativo.
      if (materiaPrimaIgnoraStock(mp)) { avisos.push({ tipo: 'ignora-stock', id }); return; }
      if (mp.heredadoDe) { acumular(mp.heredadoDe, cantidad, next); return; }
      consumo[id] = consumo[id] || { tipo: 'MATERIA_PRIMA', cantidad: 0 };
      consumo[id].cantidad += cantidad;
      return;
    }
    avisos.push({ tipo: 'recurso-inexistente', id });
    faltantes.push({ materiaPrimaId: id, stockActual: 0, requerido: cantidad });
  };

  acumular(articleId, necesarias, new Set());

  for (const [id, datos] of Object.entries(consumo)) {
    const art = articulos[id];
    const disponible = art
      ? stockNoNegativo(art.stock && art.stock.propio)
      : stockNoNegativo(materiaPrima[id] && materiaPrima[id].stock);
    if (disponible + EPSILON < datos.cantidad) {
      faltantes.push({ materiaPrimaId: id, stockActual: disponible, requerido: datos.cantidad });
    }
  }

  return { suficiente: faltantes.length === 0, faltantes, avisos };
}

/**
 * Disponibilidad efectiva para delivery: combina el activo MANUAL (que solo se
 * lee, jamás se escribe) con la suficiencia de la receta. Un artículo sin receta
 * queda regido únicamente por su activo manual, como antes.
 */
export function disponibleParaDelivery(articleId, articulos = {}, materiaPrima = {}) {
  const article = articulos[articleId];
  if (!article) return false;
  if (article.activoDelivery === false) return false;
  if (article.activo === false) return false;
  return recetaConStockSuficiente(articleId, articulos, materiaPrima, 1);
}

/**
 * Conjunto de IDs de MATERIA_PRIMA (nodos físicos, resolviendo receta anidada y
 * herencia) que utiliza un artículo. Sirve para el cascadeo de disponibilidad:
 * saber qué artículos apagar cuando una materia prima se agota. Identidad SIEMPRE
 * por ID canónico; nunca por nombre.
 *
 * @returns {Set<string>} ids de materia prima usados por el artículo.
 */
export function materiasPrimasDeArticulo(articleId, articulos = {}, materiaPrima = {}) {
  const ids = new Set();
  const visitar = (id, visited) => {
    if (!id || visited.has(id)) return;
    const next = new Set(visited); next.add(id);
    const art = articulos[id];
    if (art) {
      const tipo = tipoDeStock(art.stock);
      if (tipo === 'heredado' && art.stock?.heredadoDe) { visitar(art.stock.heredadoDe, next); return; }
      if (tipo === 'receta' && art.stock?.receta) {
        for (const [ingId] of entradasDeReceta(art.stock.receta)) visitar(ingId, next);
      }
      return; // propio/otro: no es materia prima
    }
    const mp = materiaPrima[id];
    if (mp) {
      if (mp.heredadoDe) { visitar(mp.heredadoDe, next); return; }
      ids.add(id);
    }
  };
  visitar(articleId, new Set());
  return ids;
}
