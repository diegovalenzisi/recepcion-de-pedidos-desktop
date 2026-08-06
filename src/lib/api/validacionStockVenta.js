// ---------------------------------------------------------------------------
// REVALIDACIÓN DE STOCK ANTES DE CONFIRMAR / COBRAR
//
// El catálogo se filtra en vivo, pero entre que el operador toca un artículo y
// confirma la venta puede pasar de todo: otra terminal vende lo último, la
// cocina descuenta materia prima, el carrito queda abierto media hora. Esta
// evaluación corre CONTRA UN SNAPSHOT FRESCO y con la CANTIDAD REAL del
// carrito, justo antes de tocar nada.
//
// No reimplementa cómo se resuelve el consumo: usa `construirPlanDeStock`
// (stockPlan.js, canónico), que es EXACTAMENTE el mismo plan que después
// ejecuta el descuento en transactionsApi. Se valida lo que se va a descontar,
// ni más ni menos. Eso trae gratis:
//   · recetas anidadas y herencia, resueltas hasta el recurso físico;
//   · el mismo artículo repetido en varias líneas, sumado una sola vez;
//   · DOS artículos distintos que comparten una materia prima, sumados juntos
//     (cada uno por separado puede alcanzar y entre los dos no);
//   · hijos de promoción y opcionales de departamento que consumen stock.
//
// Qué NO bloquea, en línea con el resto del sistema:
//   · `controlStock === false` (artículo o materia prima): ilimitado;
//   · materia prima con "Ignora Stock": nunca falta (su stock igual se
//     descuenta y puede quedar negativo, eso no cambia);
//   · un recurso que no existe en el catálogo: se informa aparte, no bloquea la
//     venta (misma política vigente en el resto del sistema).
//
// Qué SÍ bloquea además del faltante: una RECETA CIRCULAR. El plan corta el
// recorrido para no colgarse, así que el consumo calculado queda INCOMPLETO y
// vender con él descontaría de menos. No es un problema de stock —reponer no lo
// destraba—, así que se informa aparte y con otro texto.
//
// Módulo puro: sin Firebase, sin React, sin DOM. El snapshot lo provee
// validacionStockVentaApi.js.
// ---------------------------------------------------------------------------

import { construirPlanDeStock } from './stockPlan.js';
import { materiaPrimaIgnoraStock } from './deliveryPorStock.js';

// Absorbe SOLO el ruido de punto flotante de las cantidades de receta
// (3 × 0,05 = 0,15000000000000002). Es varios órdenes de magnitud menor que
// cualquier cantidad legítima: no tolera un faltante real.
const EPSILON = 1e-9;

/** Stock normalizado a un número >= 0. Nunca negativo, nunca NaN. */
function stockNoNegativo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * ¿Alcanza el stock para TODO el carrito?
 *
 * @param {object} params
 * @param {Array}  params.items         líneas del carrito (o de la venta)
 * @param {object} params.articulos     ARTICULOS del local, { [id]: articulo }
 * @param {object} params.materiaPrima  MATERIA_PRIMA del local, { [id]: mp }
 * @returns {{ suficiente: boolean,
 *             faltantes: Array<{ id, tipo, nombre, stockActual, requerido }>,
 *             inexistentes: Array<object>,
 *             avisos: Array<object> }}
 */
export function evaluarStockDeCarrito({ items, articulos = {}, materiaPrima = {} }) {
  const { impactMap, faltantes: inexistentes, avisos } = construirPlanDeStock({
    items: Array.isArray(items) ? items : [],
    articulos,
    materiaPrima,
  });

  // RECETA CIRCULAR: el recorrido se corta para no colgarse, así que el consumo
  // calculado está INCOMPLETO. Vender con ese plan descontaría de menos. Se
  // bloquea hasta corregir la receta; no es un problema de stock.
  const ciclos = [];
  for (const aviso of avisos || []) {
    if (!aviso || aviso.tipo !== 'ciclo' || !aviso.id) continue;
    if (ciclos.some((c) => c.id === aviso.id)) continue;
    ciclos.push({ id: aviso.id, nombre: (articulos[aviso.id] || materiaPrima[aviso.id] || {}).nombre || aviso.id });
  }

  const faltantes = [];

  for (const [id, datos] of Object.entries(impactMap || {})) {
    const requerido = Number(datos.quantity);
    if (!(requerido > 0)) continue; // una devolución/reposición nunca falta

    if (datos.type === 'MATERIA_PRIMA') {
      const mp = materiaPrima[id];
      if (!mp) continue;                               // inexistente: va en `inexistentes`
      if (mp.controlStock === false) continue;         // ilimitada
      if (materiaPrimaIgnoraStock(mp)) continue;       // "Ignora Stock": nunca falta
      const stockActual = stockNoNegativo(mp.stock);
      if (stockActual + EPSILON < requerido) {
        faltantes.push({ id, tipo: 'MATERIA_PRIMA', nombre: mp.nombre || id, stockActual, requerido });
      }
      continue;
    }

    const art = articulos[id];
    if (!art) continue;
    if (art.controlStock === false) continue;          // ilimitado
    const stockActual = stockNoNegativo(art.stock && art.stock.propio);
    if (stockActual + EPSILON < requerido) {
      faltantes.push({ id, tipo: 'ARTICULO', nombre: art.nombre || id, stockActual, requerido });
    }
  }

  faltantes.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  return {
    suficiente: faltantes.length === 0 && ciclos.length === 0,
    faltantes,
    ciclos,
    inexistentes: inexistentes || [],
    avisos: avisos || [],
  };
}

/** Cantidad legible: entera sin decimales, fraccionaria sin ceros de relleno. */
function cantidadLegible(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/**
 * Mensaje para el operador. Con faltantes dice QUÉ falta, CUÁNTO se necesita y
 * CUÁNTO hay — sin esos tres datos el cajero no sabe qué reponer. Con una receta
 * circular dice qué artículo hay que corregir, porque no es un problema de stock
 * y reponer no lo destraba.
 */
export function mensajeDeBloqueo({ faltantes = [], ciclos = [] } = {}) {
  const partes = [];

  if (ciclos.length) {
    const nombres = ciclos.map((c) => c.nombre).join(', ');
    partes.push(`La receta de ${nombres} tiene una referencia circular y no se puede calcular. Corregí la receta antes de vender este producto.`);
  }

  if (faltantes.length) {
    const detalle = faltantes
      .map((f) => `${f.nombre}: se necesitan ${cantidadLegible(f.requerido)} y hay ${cantidadLegible(f.stockActual)}`)
      .join('. ');
    partes.push(`No hay stock suficiente para completar la venta. ${detalle}.`);
  }

  return partes.join(' ');
}
