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
// Módulo puro: recibe el catálogo ya leído. Idéntico en Desktop y Tablet, y
// produce exactamente el mismo resultado para el mismo JSON.
// ---------------------------------------------------------------------------

import { idCanonico, mismoIdExacto, esIdLegado, resolverId } from './idsCanonicos.js';
import { normalizarImporte, calcularSubtotalLinea, calcularTotalPedido } from './optionalsPricing.js';
import { combinarConfigDeGrupo } from './opcionesDeGrupo.js';
import {
  origenDeGrupo, configDepartamento, consumoEfectivo, costoEfectivo,
  ORIGEN_DEPARTAMENTO, ORIGEN_MANUAL,
} from './opcionalesDepartamento.js';

export const ESTADOS_VALIDACION = Object.freeze({
  VALID: 'valid',
  PRICE_MISMATCH: 'price-mismatch',
  INVALID_OPTION: 'invalid-option',
  UNAVAILABLE: 'unavailable',
  INVALID_CONSUMPTION: 'invalid-consumption',
});

/** Prioridad: si hay varios problemas, manda el más grave. */
const PRIORIDAD = [
  ESTADOS_VALIDACION.INVALID_OPTION,
  ESTADOS_VALIDACION.UNAVAILABLE,
  ESTADOS_VALIDACION.INVALID_CONSUMPTION,
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
 * @param {object} catalogo  { articulos, departamentos, gruposOpcionales, opcionales }
 * @param {object} opciones  { canal, estaDisponible }
 * @returns {{status, issues, canonicalItems, canonicalTotal, receivedTotal}}
 */
export function validarPedidoExterno(order, catalogo = {}, { canal = 'delivery', estaDisponible = null } = {}) {
  const articulos = catalogo.articulos || {};
  const departamentos = catalogo.departamentos || {};
  const gruposOpcionales = catalogo.gruposOpcionales || {};
  const opcionalesCatalogo = catalogo.opcionales || {};

  const items = Array.isArray(order?.items) ? order.items : [];
  const issues = [];
  const canonicalItems = [];

  const clavesDepto = Object.keys(departamentos);

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

      // 5. El origen del grupo coincide con lo declarado en el snapshot.
      // El origen lo declara el GRUPO del catálogo, no la config dentro del
      // artículo: ahí sólo viven activo/min/max/obligatorio y, en los manuales,
      // la lista de opciones. Sin combinar, un grupo por departamento se leería
      // como manual y toda opción dinámica legítima caería en invalid-option.
      // Si el grupo del catálogo declara su origen, manda él. Si no declara nada
      // (grupo viejo, o catálogo de grupos no disponible), se respeta lo que
      // traiga la config del artículo, que es donde vivía antes.
      const configEfectiva = grupoInfo && typeof grupoInfo.origen === 'string' && grupoInfo.origen.trim() !== ''
        ? combinarConfigDeGrupo(configEnArticulo, grupoInfo)
        : configEnArticulo;
      const origenOficial = origenDeGrupo(configEfectiva);
      const cfgDepto = configDepartamento(configEfectiva);
      const opsCanonicas = [];

      for (const op of opsRecibidas) {
        if (!op || typeof op !== 'object') continue;
        const optionId = idCanonico(op.id ?? op.optionId);
        const articleId = idCanonico(op.articleId);
        const cantidad = Number(op.cantidad ?? op.quantity ?? 1) || 1;
        const b = { ...baseGrupo, optionId, articleId, departamentoId: idCanonico(op.departamentoId) };
        const origenRecibido = op.origen === ORIGEN_DEPARTAMENTO ? ORIGEN_DEPARTAMENTO : ORIGEN_MANUAL;

        const rPrecioRecibido = normalizarImporte(op.precioUnitario !== undefined ? op.precioUnitario : op.precio);
        const precioRecibido = rPrecioRecibido.valido && !rPrecioRecibido.ausente ? rPrecioRecibido.valor : 0;

        if (origenRecibido !== origenOficial) {
          issues.push(nuevaIssue(b, `El origen del grupo no coincide: recibido "${origenRecibido}", oficial "${origenOficial}".`, { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
          continue;
        }

        // ---- Grupo MANUAL ----
        if (origenOficial === ORIGEN_MANUAL) {
          // 6. La opción pertenece al grupo.
          const permitidas = Array.isArray(configEnArticulo.opcionales) ? configEnArticulo.opcionales.map(idCanonico) : [];
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
            origen: ORIGEN_MANUAL,
            consumoStockUnitario: 0, consumoStockTotal: 0, controlaStock: false,
          });
          continue;
        }

        // ---- Grupo DEPARTAMENTO ----
        if (!cfgDepto || !cfgDepto.departamentoId) {
          issues.push(nuevaIssue(b, 'El grupo por departamento no tiene departamento configurado.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
          continue;
        }
        // 7a. departamentoId exacto (con compatibilidad legada solo si el dato es histórico).
        const rDepto = resolverId(b.departamentoId, clavesDepto, { permitirLegado: esIdLegado(b.departamentoId) });
        if (rDepto.ambiguo) {
          issues.push(nuevaIssue(b, 'El identificador de departamento es ambiguo y no puede resolverse.', {
            estado: ESTADOS_VALIDACION.INVALID_OPTION, departamentoOficial: cfgDepto.departamentoId,
          }));
          continue;
        }
        if (!rDepto.id || !mismoIdExacto(rDepto.id, cfgDepto.departamentoId)) {
          issues.push(nuevaIssue(b, 'El departamento del opcional no coincide con el configurado en el grupo.', {
            estado: ESTADOS_VALIDACION.INVALID_OPTION, departamentoOficial: cfgDepto.departamentoId,
          }));
          continue;
        }
        // 7b. articleId exacto y existente.
        if (!articleId) {
          issues.push(nuevaIssue(b, 'El opcional de departamento no trae articleId.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
          continue;
        }
        const artOpcional = articulos[articleId];
        if (!artOpcional) {
          issues.push(nuevaIssue(b, 'El artículo del opcional no existe en el catálogo.', { estado: ESTADOS_VALIDACION.INVALID_OPTION }));
          continue;
        }
        // 7c. Pertenece al departamento.
        if (!mismoIdExacto(artOpcional.departamento, cfgDepto.departamentoId)) {
          issues.push(nuevaIssue(b, 'El artículo no pertenece al departamento configurado.', {
            estado: ESTADOS_VALIDACION.INVALID_OPTION, departamentoOficial: cfgDepto.departamentoId,
          }));
          continue;
        }
        // 7d. Activo para el canal.
        const activo = canal === 'delivery' ? artOpcional.activoDelivery !== false : artOpcional.activoMostrador !== false;
        if (!activo || artOpcional.eliminado === true) {
          issues.push(nuevaIssue(b, 'El artículo del opcional no está activo para este canal.', { estado: ESTADOS_VALIDACION.UNAVAILABLE }));
          continue;
        }
        // 7e. Disponibilidad según la regla actual del sistema.
        if (typeof estaDisponible === 'function' && !estaDisponible(articleId)) {
          issues.push(nuevaIssue(b, 'El artículo del opcional no está disponible (sin stock).', { estado: ESTADOS_VALIDACION.UNAVAILABLE }));
          continue;
        }
        // 7f. Precio oficial (del ARTÍCULO, no de OPCIONALES).
        const rArt = normalizarImporte(cfgDepto.usarPrecioArticulo ? artOpcional.valor : 0);
        const precioOficial = rArt.valido && !rArt.ausente ? rArt.valor : 0;
        if (Math.abs(precioOficial - precioRecibido) > TOLERANCIA) {
          issues.push(nuevaIssue(b, 'El precio del opcional no coincide con el del artículo oficial.', {
            estado: ESTADOS_VALIDACION.PRICE_MISMATCH, precioRecibido, precioOficial,
          }));
        }
        // 7g. Consumo permitido y 7h. control de stock coherente.
        const { consumo: consumoOficialUnit } = consumoEfectivo(configEfectiva, articleId);
        const controlaStockOficial = cfgDepto.controlarStock && artOpcional.controlStock !== false;
        const consumoOficial = controlaStockOficial ? consumoOficialUnit : 0;
        const consumoRecibido = Number(op.consumoStockUnitario);
        if (!Number.isFinite(consumoRecibido) || Math.abs(consumoRecibido - consumoOficial) > 1e-6) {
          issues.push(nuevaIssue(b, 'El consumo de stock no coincide con el configurado.', {
            estado: ESTADOS_VALIDACION.INVALID_CONSUMPTION,
            consumoRecibido: Number.isFinite(consumoRecibido) ? consumoRecibido : null,
            consumoOficial,
          }));
        }
        if (!!op.controlaStock !== controlaStockOficial) {
          issues.push(nuevaIssue(b, 'El control de stock del opcional no coincide con la configuración.', {
            estado: ESTADOS_VALIDACION.INVALID_CONSUMPTION,
            consumoRecibido: Number.isFinite(consumoRecibido) ? consumoRecibido : null,
            consumoOficial,
          }));
        }

        const costoUnit = costoEfectivo(articleId, articulos, catalogo.materiaPrima || {});
        opsCanonicas.push({
          ...op,
          nombre: artOpcional.nombre ?? op.nombre,
          origen: ORIGEN_DEPARTAMENTO,
          articleId,
          departamentoId: cfgDepto.departamentoId,
          precioUnitario: precioOficial, precio: precioOficial,
          cantidad, quantity: cantidad, total: precioOficial * cantidad,
          costoUnitarioAplicado: costoUnit, costoTotal: costoUnit * cantidad,
          controlaStock: controlaStockOficial,
          consumoStockUnitario: consumoOficial, consumoStockTotal: consumoOficial * cantidad,
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
    const opcional = i.grupoNombre ? ` › ${i.grupoNombre}${i.optionId || i.articleId ? ` › ${i.nombreOpcional || i.articleId || i.optionId}` : ''}` : '';
    const importes = (i.precioRecibido !== undefined && i.precioOficial !== undefined)
      ? ` — recibido $${i.precioRecibido} · oficial $${i.precioOficial}` : '';
    const consumo = (i.consumoRecibido !== undefined && i.consumoOficial !== undefined)
      ? ` — consumo recibido ${i.consumoRecibido} · oficial ${i.consumoOficial}` : '';
    return `${i.producto || '(sin producto)'}${unidad}${opcional}: ${i.motivo}${importes}${consumo}`;
  });
  const titulos = {
    [ESTADOS_VALIDACION.PRICE_MISMATCH]: 'El pedido llegó con precios distintos a los oficiales',
    [ESTADOS_VALIDACION.INVALID_OPTION]: 'El pedido llegó con opciones que no corresponden',
    [ESTADOS_VALIDACION.UNAVAILABLE]: 'El pedido incluye artículos no disponibles',
    [ESTADOS_VALIDACION.INVALID_CONSUMPTION]: 'El pedido llegó con un consumo de stock distinto al configurado',
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
