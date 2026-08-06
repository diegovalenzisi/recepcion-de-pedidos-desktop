// ---------------------------------------------------------------------------
// PLAN DE IMPACTO DE STOCK: resolución completa + agrupación por RUTA FÍSICA
//
// Punto 8: un pedido puede tocar el mismo nodo físico por varios caminos —
// el artículo base por receta, un topping de departamento por herencia, un hijo
// de promo directo. Todos deben terminar en UNA sola transacción, UNA sola
// entrada de appliedOps y UN solo renglón del movimiento.
//
//   Base consume M-3 = 0,25
//   Topping consume M-3 = 0,25
//   → M-3 = 0,50   (una transacción, no dos)
//
// Punto 4: además arma el PREFLIGHT, que separa los recursos que existen de los
// que no, para no intentar descontar sobre algo inexistente ni crearlo.
//
// Módulo puro: recibe los catálogos ya leídos. No importa Firebase.
// ---------------------------------------------------------------------------

import { rutaRecurso } from './stockAtomico.js';
import { idCanonico } from './idsCanonicos.js';

const numero = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : 0; }
  return 0;
};

/** Tipo de stock efectivo de un artículo, con la misma regla que ya usa el sistema. */
export function tipoDeStock(articulo) {
  const s = (articulo && articulo.stock) || {};
  if (s.stockType) return s.stockType;
  if (s.receta && Object.keys(s.receta).length > 0) return 'receta';
  if (s.heredadoDe) return 'heredado';
  if (s.propio !== undefined) return 'propio';
  return 'ninguno';
}

/**
 * Resuelve un consumo hasta las rutas FÍSICAS que realmente cambian, siguiendo
 * propio / heredado / receta, y acumula en `acc` sumando cuando coinciden.
 *
 * @param {object} params
 *   id, cantidad, articulos, materiaPrima, acc, visitados, avisos
 *   permitirNombre — SOLO para artículos base históricos. Prohibido para
 *                    opcionales de departamento, que exigen articleId.
 */
export function resolverRutasFisicas({ id, cantidad, articulos, materiaPrima, acc = {}, visitados = new Set(), avisos = [], permitirNombre = false, origen = 'base' }) {
  const clave = idCanonico(id);
  if (!clave || !Number.isFinite(cantidad) || cantidad === 0) return acc;

  if (visitados.has(clave)) {
    avisos.push({ tipo: 'ciclo', id: clave, cadena: [...visitados] });
    return acc;   // ciclo de herencia o receta: se corta, no se cuelga
  }
  const visitadosAhora = new Set(visitados);
  visitadosAhora.add(clave);

  let resolvedId = clave;
  let art = articulos[resolvedId];
  let mp = !art ? materiaPrima[resolvedId] : null;

  // Compatibilidad legada por NOMBRE: solo para artículos base históricos.
  if (!art && !mp && permitirNombre) {
    const buscado = String(clave).trim().toLowerCase();
    const k = Object.keys(articulos).find((x) => String(articulos[x].nombre || '').trim().toLowerCase() === buscado);
    if (k) {
      resolvedId = k; art = articulos[k];
      avisos.push({ tipo: 'fallback-por-nombre', buscado: clave, resuelto: k, origen });
    } else {
      const km = Object.keys(materiaPrima).find((x) => String(materiaPrima[x].nombre || '').trim().toLowerCase() === buscado);
      if (km) {
        resolvedId = km; mp = materiaPrima[km];
        avisos.push({ tipo: 'fallback-por-nombre', buscado: clave, resuelto: km, origen });
      }
    }
  }

  if (!art && !mp) {
    avisos.push({ tipo: 'recurso-inexistente', id: clave, origen });
    acc.__faltantes = acc.__faltantes || [];
    acc.__faltantes.push({ id: clave, origen });
    return acc;
  }

  if (mp) {
    // UNA MATERIA PRIMA SE DESCUENTA SIEMPRE.
    //
    // Ni `ignoraStock` ni `controlStock` la sacan del plan: son banderas de
    // DISPONIBILIDAD (si bloquea la venta y si apaga los artículos que la
    // usan), no de consumo. El inventario tiene que reflejar lo que realmente
    // se gastó, aunque después el saldo quede en cero o en negativo y aunque la
    // materia prima se considere siempre disponible.
    //
    // Antes había acá un `if (mp.controlStock === false) return acc;` que la
    // excluía del plan y del ledger: se vendía, se consumía y el saldo no se
    // movía nunca. `ignoraStock` ya se trataba bien (nunca llegó a filtrar acá);
    // el que estaba mal era `controlStock`.
    //
    // Quién decide bloquear o desactivar: materiaPrimaDisponible() en
    // deliveryPorStock.js y unidadesFabricables() en disponibilidadReceta.js.
    // Esas funciones son las únicas que miran estas banderas.
    if (mp.heredadoDe) {
      return resolverRutasFisicas({ id: mp.heredadoDe, cantidad, articulos, materiaPrima, acc, visitados: visitadosAhora, avisos, permitirNombre, origen });
    }
    const ruta = rutaRecurso('', resolvedId, 'MATERIA_PRIMA').replace(/^\//, '');
    acc[ruta] = acc[ruta] || { id: resolvedId, tipo: 'MATERIA_PRIMA', cantidad: 0, origenes: [] };
    acc[ruta].cantidad += cantidad;
    acc[ruta].origenes.push({ origen, id: clave, cantidad });
    return acc;
  }

  // `controlStock === false` significa ILIMITADO PARA DISPONIBILIDAD: el
  // artículo nunca bloquea una venta ni figura como agotado. NO significa
  // "no consume nada".
  //
  // Confundir las dos cosas fue la regresión: este chequeo estaba ANTES de
  // resolver receta/heredado, así que un artículo con receta y el interruptor
  // en "no controla stock" —la configuración normal de un producto elaborado,
  // que no lleva cuenta propia porque su stock vive en la materia prima— salía
  // de acá sin tocar NADA. Ni el artículo (correcto: no tiene cuenta propia) ni
  // sus materias primas (incorrecto: cada una sí lleva la suya).
  //
  // Por eso la resolución de heredado/receta va PRIMERO y `controlStock` se
  // consulta solo en la rama de stock propio, que es la única cuenta que el
  // interruptor apaga de verdad.
  const tipo = tipoDeStock(art);
  if (tipo === 'heredado' && art.stock.heredadoDe) {
    return resolverRutasFisicas({ id: art.stock.heredadoDe, cantidad, articulos, materiaPrima, acc, visitados: visitadosAhora, avisos, permitirNombre, origen });
  }
  if (tipo === 'receta' && art.stock.receta) {
    const receta = art.stock.receta;
    const entradas = Array.isArray(receta)
      ? receta.map((ing) => [ing.codigo || ing.id || ing.nombre, ing.cantidad])
      : Object.entries(receta);
    for (const [ingId, ingQty] of entradas) {
      if (!ingId) continue;
      resolverRutasFisicas({
        id: ingId, cantidad: cantidad * numero(ingQty), articulos, materiaPrima,
        acc, visitados: visitadosAhora, avisos, permitirNombre, origen,
      });
    }
    return acc;
  }
  if (tipo === 'ninguno') { avisos.push({ tipo: 'sin-configuracion-de-stock', id: resolvedId }); return acc; }

  // STOCK PROPIO: la única cuenta que `controlStock` apaga. Un artículo
  // declarado sin control de stock no lleva unidades propias, así que no hay
  // nada que descontarle.
  if (art.controlStock === false) { avisos.push({ tipo: 'sin-control-de-stock', id: resolvedId }); return acc; }

  const ruta = rutaRecurso('', resolvedId, 'ARTICULO').replace(/^\//, '');
  acc[ruta] = acc[ruta] || { id: resolvedId, tipo: 'ARTICULO', cantidad: 0, origenes: [] };
  acc[ruta].cantidad += cantidad;
  acc[ruta].origenes.push({ origen, id: clave, cantidad });
  return acc;
}

/**
 * Construye el plan COMPLETO de un pedido: artículo base, hijos de promoción y
 * opcionales vinculados a artículos, todo agrupado por ruta física.
 *
 * @returns {{ impactMap, porRuta, avisos, faltantes }}
 */
export function construirPlanDeStock({ items, articulos = {}, materiaPrima = {}, permitirNombreEnBase = true }) {
  const acc = {};
  const avisos = [];
  const lista = Array.isArray(items) ? items : [];

  for (const item of lista) {
    const cantidadLinea = numero(item.quantity ?? item.cantidad ?? 1) || 1;
    const hijos = (item.isPromo && (item.promoItems || item.promoDetails)) || [];

    if (hijos.length > 0) {
      for (const hijo of hijos) {
        const idHijo = hijo.codigo || hijo.id || hijo.nombre;
        const cantHijo = numero(hijo.cantidad ?? hijo.quantity ?? 1) || 1;
        if (idHijo) {
          resolverRutasFisicas({
            id: idHijo, cantidad: cantHijo * cantidadLinea, articulos, materiaPrima,
            acc, avisos, permitirNombre: permitirNombreEnBase, origen: 'promo-hijo',
          });
        }
        // Los opcionales de cada hijo aportan su propio impacto.
        acumularOpcionales(hijo.selectedOptionals, cantHijo * cantidadLinea, { articulos, materiaPrima, acc, avisos });
      }
    } else {
      const idBase = item.codigo || item.id || item.nombre;
      if (idBase) {
        resolverRutasFisicas({
          id: idBase, cantidad: cantidadLinea, articulos, materiaPrima,
          acc, avisos, permitirNombre: permitirNombreEnBase, origen: 'base',
        });
      }
    }

    acumularOpcionales(item.selectedOptionals, cantidadLinea, { articulos, materiaPrima, acc, avisos });
  }

  const faltantes = acc.__faltantes || [];
  delete acc.__faltantes;

  const impactMap = {};
  for (const datos of Object.values(acc)) {
    if (!Number.isFinite(datos.cantidad) || datos.cantidad === 0) continue;
    impactMap[datos.id] = { quantity: datos.cantidad, type: datos.tipo };
  }
  return { impactMap, porRuta: acc, avisos, faltantes };
}

/**
 * Opcionales que mueven stock. Regla efectiva:
 *   · manual sin articleId       → NO mueve stock;
 *   · departamento con articleId → mueve, resuelto SOLO por articleId;
 *   · consumo desde el snapshot validado, nunca desde el nombre;
 *   · precio cero NO implica consumo cero.
 */
function acumularOpcionales(selectedOptionals, multiplicador, { articulos, materiaPrima, acc, avisos }) {
  if (!selectedOptionals || typeof selectedOptionals !== 'object') return;
  for (const lista of Object.values(selectedOptionals)) {
    if (!Array.isArray(lista)) continue;
    for (const op of lista) {
      if (!op || typeof op !== 'object') continue;

      const articleId = idCanonico(op.articleId);
      if (!articleId) {
        // Opcional manual (o histórico sin articleId): no genera stock.
        if (op.origen === 'departamento') {
          avisos.push({ tipo: 'departamento-sin-articleId', opcional: op.nombre || null });
        }
        continue;
      }
      if (op.controlaStock === false) continue;

      const consumoUnit = numero(op.consumoStockUnitario);
      if (!(consumoUnit > 0)) {
        if (op.consumoStockUnitario !== undefined && op.consumoStockUnitario !== 0) {
          avisos.push({ tipo: 'consumo-invalido', opcional: op.nombre || null, crudo: op.consumoStockUnitario });
        }
        continue;
      }
      const cantidadOp = numero(op.cantidad ?? op.quantity ?? 1) || 1;

      resolverRutasFisicas({
        id: articleId,
        cantidad: consumoUnit * cantidadOp * multiplicador,
        articulos, materiaPrima, acc, avisos,
        permitirNombre: false,        // los opcionales NUNCA caen a búsqueda por nombre
        origen: 'opcional',
      });
    }
  }
}

/**
 * PREFLIGHT (punto 4): separa lo que existe de lo que no, ANTES de abrir
 * ninguna transacción. No elimina la carrera con un borrado posterior — eso lo
 * cubre `missing-resource` dentro de la transacción — pero evita intentar
 * descontar sobre recursos que ya se sabe que no están.
 */
export function preflight({ impactMap, articulos = {}, materiaPrima = {} }) {
  const existentes = {};
  const faltantes = [];
  for (const [id, datos] of Object.entries(impactMap || {})) {
    const existe = datos.type === 'ARTICULO' ? !!articulos[id] : !!materiaPrima[id];
    if (existe) existentes[id] = datos;
    else faltantes.push({ id, tipo: datos.type });
  }
  return { existentes, faltantes, listo: faltantes.length === 0 };
}
