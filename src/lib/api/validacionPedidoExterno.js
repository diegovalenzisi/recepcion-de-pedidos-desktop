// ---------------------------------------------------------------------------
// VALIDACIÓN AUTORITATIVA DE PEDIDOS EXTERNOS (DLV Pedidos)
//
// DLV corre en el navegador del cliente: su snapshot puede ser internamente
// coherente y aun así económicamente falso. Recalcular desde ese snapshot
// garantiza COHERENCIA, no AUTENTICIDAD. Este módulo aporta la autenticidad
// contrastando contra el catálogo oficial del local.
//
// ALCANCE — se aplica SOLO a pedidos NUEVOS de origen externo. No toca:
//   · pedidos históricos;
//   · pedidos creados localmente (Desktop/Tablet);
//   · reimpresiones;
//   · facturas históricas.
// `debeValidarse()` es la única puerta de entrada y decide eso.
//
// LÍMITE CONOCIDO: valida contra el catálogo VIGENTE AL RECIBIR. Si el precio
// cambió legítimamente entre que DLV confirmó y Recepción recibió, aparece una
// diferencia que NO es fraude. Por eso nunca se etiqueta como tal: se muestran
// los dos importes y decide el operador. La autoridad total en el instante de
// creación exige un backend/Cloud Function que selle el precio al crear el
// pedido; queda preparado como pendiente y no se despliega.
//
// Los grupos de opcionales son MANUALES: sus opciones salen exclusivamente de
// los opcionales guardados dentro del grupo (OPCIONALES/{id}). No se consulta
// ningún departamento ni se resuelven opciones dinámicamente desde el catálogo.
//
// Módulo puro: recibe el catálogo ya leído. Idéntico en Desktop y Tablet, y
// produce exactamente el mismo resultado para el mismo JSON.
// ---------------------------------------------------------------------------

import { idCanonico, mismoIdExacto } from './idsCanonicos.js';
import { normalizarImporte, calcularSubtotalLinea, calcularTotalPedido } from './optionalsPricing.js';
import { evaluarRecetaPedido } from './disponibilidadReceta.js';

export const ESTADOS_VALIDACION = Object.freeze({
  VALID: 'valid',
  PRICE_MISMATCH: 'price-mismatch',
  INVALID_OPTION: 'invalid-option',
  UNAVAILABLE: 'unavailable',
});

/** Prioridad: si hay varios problemas, manda el más grave. */
const PRIORIDAD = [
  ESTADOS_VALIDACION.INVALID_OPTION,
  ESTADOS_VALIDACION.UNAVAILABLE,
  ESTADOS_VALIDACION.PRICE_MISMATCH,
];

/** Tolerancia de comparación de importes (centavos). */
const TOLERANCIA = 0.01;

/**
 * ¿Este pedido debe pasar por la validación autoritativa?
 * Solo pedidos NUEVOS de origen externo. Todo lo demás queda intacto.
 */
export function debeValidarse(order, { origenExterno = null } = {}) {
  if (!order || typeof order !== 'object') return false;

  // Ya validado antes: no se revalida ni se pisa la decisión del operador.
  if (order.validacionExterna && order.validacionExterna.resuelto === true) return false;

  // Un pedido ya entregado/cancelado es historia: no se toca.
  const estado = order.status?.main || order.status;
  if (['ENTREGADO', 'CANCELADO', 'COMPLETADO'].includes(estado)) return false;

  // Origen: explícito, o inferido de las marcas que deja DLV.
  const externo = origenExterno !== null
    ? !!origenExterno
    : (order.origen === 'DLV' || order.origen === 'web' || order.fromApp === true || !!order.direccionValidada);
  if (!externo) return false;

  return Array.isArray(order.items) && order.items.length > 0;
}

const nuevaIssue = (base, motivo, extra = {}) => ({ ...base, motivo, ...extra });

/**
 * Valida un pedido externo contra el catálogo oficial.
 *
 * @param {object} order
 * @param {object} catalogo  { articulos, gruposOpcionales, opcionales, materiaPrima }
 * @param {object} opciones  { canal, estaDisponible }
 * @returns {{status, issues, canonicalItems, canonicalTotal, receivedTotal}}
 */
export function validarPedidoExterno(order, catalogo = {}, { canal = 'delivery', estaDisponible = null } = {}) {
  const articulos = catalogo.articulos || {};
  const gruposOpcionales = catalogo.gruposOpcionales || {};
  const opcionalesCatalogo = catalogo.opcionales || {};
  const materiaPrima = catalogo.materiaPrima || {};

  const items = Array.isArray(order?.items) ? order.items : [];
  const issues = [];
  const canonicalItems = [];

  for (const item of items) {
    // Un renglón corrupto se reporta, no tumba la validación del pedido entero.
    if (!item || typeof item !== 'object') {
      issues.push({ producto: '(renglón inválido)', motivo: 'El pedido trae un renglón que no es un objeto.', estado: ESTADOS_VALIDACION.INVALID_OPTION });
      continue;
    }
    const productId = idCanonico(item.codigo ?? item.id);
    const base = {
      productId,
      producto: item.nombre || '(sin nombre)',
      uniqueId: item.uniqueId ?? null,
      unidadIndice: Number.isFinite(Number(item.unidadIndice)) ? Number(item.unidadIndice) : null,
      unidadTotal: Number.isFinite(Number(item.unidadTotal)) ? Number(item.unidadTotal) : null,
    };

    // 1. El artículo base existe.
    const articulo = productId ? articulos[productId] : null;
    if (!articulo) {
      issues.push(nuevaIssue(base, 'El producto no existe en el catálogo del local.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
      canonicalItems.push({ ...item });
      continue;
    }

    // 8. unidadIndice / unidadTotal coherentes.
    if (base.unidadTotal !== null) {
      const ui = base.unidadIndice;
      if (!Number.isFinite(ui) || ui < 1 || ui > base.unidadTotal) {
        issues.push(nuevaIssue(base, `Numeración de unidad incoherente (${ui} de ${base.unidadTotal}).`, { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
      }
    }

    // Stock de receta al RECIBIR: una materia prima agotada entre el envío y la
    // recepción bloquea la venta. Considera la cantidad pedida del ítem. El
    // detalle técnico (materia prima, stock actual, requerido) queda en el issue
    // para el registro del operador; nunca se expone al cliente.
    const unidadesItem = Number(item.quantity ?? item.cantidad ?? 1) || 1;
    const evalStock = evaluarRecetaPedido(productId, unidadesItem, articulos, materiaPrima);
    if (!evalStock.suficiente) {
      issues.push(nuevaIssue(base, 'El producto se quedó sin stock suficiente para prepararse.', {
        estado: ESTADOS_VALIDACION.UNAVAILABLE,
        faltantesStock: evalStock.faltantes,
      }));
    }

    // Precio base oficial del artículo.
    const rBaseOficial = normalizarImporte(articulo.valor);
    const precioBaseOficial = rBaseOficial.valido && !rBaseOficial.ausente ? rBaseOficial.valor : 0;
    const rBaseRecibido = normalizarImporte(item.precioBaseUnitario !== undefined ? item.precioBaseUnitario : item.valor);
    const precioBaseRecibido = rBaseRecibido.valido && !rBaseRecibido.ausente ? rBaseRecibido.valor : 0;
    if (Math.abs(precioBaseOficial - precioBaseRecibido) > TOLERANCIA) {
      issues.push(nuevaIssue(base, 'El precio base no coincide con el catálogo oficial.', {
        estado: ESTADOS_VALIDACION.PRICE_MISMATCH,
        precioRecibido: precioBaseRecibido,
        precioOficial: precioBaseOficial,
      }));
    }

    const configArticulo = articulo.opcionalesConfig || {};
    const opcionalesCanonicos = {};
    const seleccionados = item.selectedOptionals && typeof item.selectedOptionals === 'object' ? item.selectedOptionals : {};

    for (const [grupoId, lista] of Object.entries(seleccionados)) {
      const opsRecibidas = Array.isArray(lista) ? lista : [];
      const grupoInfo = gruposOpcionales[grupoId] || null;
      const configEnArticulo = configArticulo[grupoId] || null;
      const baseGrupo = { ...base, grupoId, grupoNombre: grupoInfo?.nombre || configEnArticulo?.nombre || grupoId };

      // 2. El grupo existe. 3. Está habilitado para ese artículo.
      if (!grupoInfo && !configEnArticulo) {
        issues.push(nuevaIssue(baseGrupo, 'El grupo de opcionales no existe.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
        continue;
      }
      if (!configEnArticulo || configEnArticulo.activo === false) {
        issues.push(nuevaIssue(baseGrupo, 'El grupo no está habilitado para este producto.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
        continue;
      }

      // 4. Mínimo y máximo.
      const total = opsRecibidas.reduce((s, o) => s + (Number(o?.cantidad ?? o?.quantity ?? 1) || 1), 0);
      const min = configEnArticulo.obligatorio ? (Number(configEnArticulo.min) || 0) : 0;
      const max = Number(configEnArticulo.max);
      if (total < min) {
        issues.push(nuevaIssue(baseGrupo, `Faltan selecciones obligatorias: mínimo ${min}, recibidas ${total}.`, { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
      }
      if (Number.isFinite(max) && total > max) {
        issues.push(nuevaIssue(baseGrupo, `Se superó el máximo del grupo: máximo ${max}, recibidas ${total}.`, { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
      }

      // Lista oficial de opciones del grupo, tal como se guardó dentro del grupo.
      const permitidas = Array.isArray(configEnArticulo.opcionales) ? configEnArticulo.opcionales.map(idCanonico) : [];
      const opsCanonicas = [];

      for (const op of opsRecibidas) {
        if (!op || typeof op !== 'object') continue;
        const optionId = idCanonico(op.id ?? op.optionId);
        const cantidad = Number(op.cantidad ?? op.quantity ?? 1) || 1;
        const b = { ...baseGrupo, optionId };

        const rPrecioRecibido = normalizarImporte(op.precioUnitario !== undefined ? op.precioUnitario : op.precio);
        const precioRecibido = rPrecioRecibido.valido && !rPrecioRecibido.ausente ? rPrecioRecibido.valor : 0;

        // 6. La opción pertenece al grupo.
        const pertenece = optionId && permitidas.some((p) => mismoIdExacto(p, optionId));
        if (!pertenece) {
          issues.push(nuevaIssue(b, 'La opción no pertenece a este grupo.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
          continue;
        }
        const oficial = opcionalesCatalogo[optionId] || null;
        if (!oficial) {
          issues.push(nuevaIssue(b, 'La opción no existe en el catálogo.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
          continue;
        }
        if (oficial.activo === false) {
          issues.push(nuevaIssue(b, 'La opción está inactiva.', { estado: ESTADOS_VALIDACION.UNAVAILABLE }));
          continue;
        }
        const rOficial = normalizarImporte(oficial.precio);
        const precioOficial = rOficial.valido && !rOficial.ausente ? rOficial.valor : 0;
        if (Math.abs(precioOficial - precioRecibido) > TOLERANCIA) {
          issues.push(nuevaIssue(b, 'El precio del opcional no coincide con el oficial.', {
            estado: ESTADOS_VALIDACION.PRICE_MISMATCH, precioRecibido, precioOficial,
          }));
        }
        opsCanonicas.push({
          ...op,
          nombre: oficial.nombre ?? op.nombre,
          precioUnitario: precioOficial, precio: precioOficial,
          cantidad, quantity: cantidad, total: precioOficial * cantidad,
        });
      }

      if (opsCanonicas.length > 0) opcionalesCanonicos[grupoId] = opsCanonicas;
    }

    // 9. Subtotal de la línea, recalculado con los valores OFICIALES.
    const lineaCanonica = {
      ...item,
      valor: precioBaseOficial,
      precioBaseUnitario: undefined,
      totalOpcionales: undefined,
      subtotalLinea: undefined,
      opcionalesIncluidosEnValor: false,
      ...(Object.keys(opcionalesCanonicos).length > 0 ? { selectedOptionals: opcionalesCanonicos } : {}),
    };
    const { subtotal, totalOpcionales } = calcularSubtotalLinea(lineaCanonica);
    lineaCanonica.precioBaseUnitario = precioBaseOficial;
    lineaCanonica.totalOpcionales = totalOpcionales;
    lineaCanonica.subtotalLinea = subtotal;

    const rSubRecibido = normalizarImporte(item.subtotalLinea);
    if (rSubRecibido.valido && !rSubRecibido.ausente && Math.abs(rSubRecibido.valor - subtotal) > TOLERANCIA) {
      issues.push(nuevaIssue(base, 'El subtotal de la línea no coincide con el oficial.', {
        estado: ESTADOS_VALIDACION.PRICE_MISMATCH, precioRecibido: rSubRecibido.valor, precioOficial: subtotal,
      }));
    }
    canonicalItems.push(lineaCanonica);
  }

  // 10. Total general.
  const canonicalTotal = calcularTotalPedido(canonicalItems).total;
  const rRecibido = normalizarImporte(order?.payment?.total ?? order?.payment?.amount ?? order?.total);
  const receivedTotal = rRecibido.valido && !rRecibido.ausente ? rRecibido.valor : 0;
  if (Math.abs(canonicalTotal - receivedTotal) > TOLERANCIA) {
    issues.push({
      producto: '(pedido completo)', motivo: 'El total del pedido no coincide con el oficial.',
      estado: ESTADOS_VALIDACION.PRICE_MISMATCH, precioRecibido: receivedTotal, precioOficial: canonicalTotal,
    });
  }

  let status = ESTADOS_VALIDACION.VALID;
  for (const candidato of PRIORIDAD) {
    if (issues.some((i) => i.estado === candidato)) { status = candidato; break; }
  }

  return { status, issues, canonicalItems, canonicalTotal, receivedTotal };
}

/**
 * Resumen legible para el operador: motivo, producto, unidad, opcional y los
 * dos importes. Nunca califica la diferencia como fraude — puede ser un cambio
 * de precio legítimo entre el envío y la recepción.
 */
export function describirParaOperador(resultado) {
  if (!resultado || resultado.status === ESTADOS_VALIDACION.VALID) {
    return { requiereDecision: false, titulo: '', lineas: [], totalRecibido: null, totalOficial: null };
  }
  const lineas = resultado.issues.map((i) => {
    const unidad = (i.unidadTotal > 1 && i.unidadIndice) ? ` (Unidad ${i.unidadIndice} de ${i.unidadTotal})` : '';
    const opcional = i.grupoNombre ? ` › ${i.grupoNombre}${i.optionId ? ` › ${i.nombreOpcional || i.optionId}` : ''}` : '';
    const importes = (i.precioRecibido !== undefined && i.precioOficial !== undefined)
      ? ` — recibido $${i.precioRecibido} · oficial $${i.precioOficial}` : '';
    return `${i.producto || '(sin producto)'}${unidad}${opcional}: ${i.motivo}${importes}`;
  });
  const titulos = {
    [ESTADOS_VALIDACION.PRICE_MISMATCH]: 'El pedido llegó con precios distintos a los oficiales',
    [ESTADOS_VALIDACION.INVALID_OPTION]: 'El pedido llegó con opciones que no corresponden',
    [ESTADOS_VALIDACION.UNAVAILABLE]: 'El pedido incluye artículos no disponibles',
  };
  return {
    requiereDecision: true,
    titulo: titulos[resultado.status] || 'El pedido externo requiere revisión',
    lineas,
    totalRecibido: resultado.receivedTotal,
    totalOficial: resultado.canonicalTotal,
    // El precio pudo cambiar legítimamente entre el envío y la recepción.
    aclaracion: 'Puede tratarse de un cambio de precio posterior al envío. Revisá antes de decidir.',
    acciones: ['corregir-a-oficial', 'rechazar'],
  };
}

/**
 * Aplica la decisión del operador dejando TRAZABILIDAD: conserva el snapshot
 * original recibido y guarda el canónico corregido. No oculta la diferencia y
 * no toca pedidos históricos.
 */
export function aplicarDecisionOperador(order, resultado, { decision, operador = null, ahora = Date.now() }) {
  if (decision !== 'corregir-a-oficial' && decision !== 'rechazar') {
    throw new Error(`decisión desconocida: ${decision}`);
  }
  const traza = {
    resuelto: true,
    decision,
    operador,
    fecha: new Date(ahora).toISOString(),
    status: resultado.status,
    totalRecibido: resultado.receivedTotal,
    totalOficial: resultado.canonicalTotal,
    issues: resultado.issues,
    // Snapshot ORIGINAL tal como llegó: nunca se pierde.
    itemsOriginales: JSON.parse(JSON.stringify(order.items || [])),
  };

  if (decision === 'rechazar') {
    return { ...order, validacionExterna: traza };
  }
  return {
    ...order,
    items: resultado.canonicalItems,
    payment: { ...(order.payment || {}), total: resultado.canonicalTotal, amount: resultado.canonicalTotal },
    validacionExterna: traza,
  };
}

/**
 * Guarda de ENTREGADO: un pedido externo con validación pendiente o inválida no
 * puede avanzar. Es la condición que impide descontar stock sobre datos falsos.
 */
export function puedePasarAEntregado(order) {
  if (!debeValidarse(order) && !order?.validacionExterna) return { permitido: true, motivo: null };
  const v = order?.validacionExterna;
  if (!v || v.resuelto !== true) {
    return { permitido: false, motivo: 'El pedido externo tiene una validación de precios pendiente.' };
  }
  if (v.decision === 'rechazar') {
    return { permitido: false, motivo: 'El pedido externo fue rechazado en la validación de precios.' };
  }
  return { permitido: true, motivo: null };
}
