// ---------------------------------------------------------------------------
// Cálculo centralizado de opcionales con precio (Fase 1).
//
// Módulo PURO: sin React, sin Firebase, sin DOM. Es la única fuente de verdad
// para el precio de un opcional, el subtotal de una línea y el total del pedido.
// Se replica idéntico en recepcion-de-pedidos-desktop, recepcion-de-pedidos-tab
// y DLV Pedidos para que los tres calculen EXACTAMENTE lo mismo.
//
// INVARIANTE ANTI-DOBLE-SUMA (regla central):
//   `item.valor` (o .precio/.price) es SIEMPRE el PRECIO BASE del artículo y
//   NUNCA incluye opcionales. El adicional de opcionales se calcula aparte y se
//   suma una sola vez acá. Ningún componente debe mutar `valor` para "meterle"
//   el opcional adentro: eso es lo que producía totales duplicados.
//
// REGLA DE CANTIDAD (definida por el usuario): los opcionales son POR UNIDAD.
// Con cantidad > 1 cada unidad se pide por separado y se guarda como su propia
// línea con quantity: 1 (campos unidadIndice/unidadTotal). Para líneas legacy
// que tengan quantity > 1 con una sola selección, se multiplica por la cantidad,
// que es el equivalente correcto de "por unidad".
// ---------------------------------------------------------------------------

/**
 * Normaliza un importe a número. Soporta los formatos históricos del sistema:
 *   1700 · "1700" · "1700.00" · "1.700" · "$1.700" · "$ 1.700,00"
 * Devuelve { valor, valido, ausente?, motivo? } y NUNCA NaN.
 * Un importe ausente (null/undefined/"") es VÁLIDO y vale 0 (opcional gratuito).
 * Un importe con basura ("abc") es INVÁLIDO: valor 0 pero valido:false, para que
 * el caller pueda avisar en vez de tragarse el error en silencio.
 */
export function normalizarImporte(entrada) {
  if (entrada === null || entrada === undefined) return { valor: 0, valido: true, ausente: true };

  if (typeof entrada === 'number') {
    return Number.isFinite(entrada)
      ? { valor: entrada, valido: true }
      : { valor: 0, valido: false, motivo: 'numero-no-finito' };
  }

  if (typeof entrada === 'object') {
    // Compatibilidad: algunos registros guardan { valor } / { precio }
    if ('precio' in entrada || 'valor' in entrada) {
      return normalizarImporte(entrada.precio ?? entrada.valor);
    }
    return { valor: 0, valido: false, motivo: 'tipo-invalido' };
  }

  if (typeof entrada !== 'string') return { valor: 0, valido: false, motivo: 'tipo-invalido' };

  const bruto = entrada.trim();
  if (!bruto) return { valor: 0, valido: true, ausente: true };
  if (!/\d/.test(bruto)) return { valor: 0, valido: false, motivo: 'sin-digitos' };
  // Solo se aceptan dígitos, separadores, espacios, $ y signo.
  if (/[^\d.,\s$+-]/.test(bruto)) return { valor: 0, valido: false, motivo: 'caracteres-invalidos' };

  let s = bruto.replace(/[\s$+]/g, '');
  const negativo = s.startsWith('-');
  if (negativo) s = s.slice(1);
  if (s.includes('-')) return { valor: 0, valido: false, motivo: 'signo-invalido' };

  if (s.includes(',')) {
    // Formato AR: la coma es decimal y el punto es separador de miles.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.')) {
    const partes = s.split('.');
    const ultima = partes[partes.length - 1];
    // "1.700" / "1.234.567" → puntos de miles (último grupo de 3 dígitos).
    // "1700.00" / "1.5"     → punto decimal (último grupo de 1-2 dígitos).
    if (partes.length > 1 && ultima.length === 3 && partes[0].length > 0) {
      s = partes.join('');
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return { valor: 0, valido: false, motivo: 'no-numerico' };
  return { valor: negativo ? -n : n, valido: true };
}

/**
 * Precio unitario de UN opcional. El sistema no tiene variantes de precio por
 * forma de pago (esas variantes están modeladas como artículos distintos, p. ej.
 * "1 KILO DE HELADO EN EFECTIVO"), pero se acepta un mapa `preciosPorPago` si
 * alguna vez existe, sin romper nada.
 * Prioridad: preciosPorPago[formaPago] → precioUnitario (snapshot) → precio → valor.
 */
export function obtenerPrecioOpcional(opcional, formaPago = null, onWarn = null) {
  if (!opcional || typeof opcional !== 'object') return 0;

  let crudo;
  if (formaPago && opcional.preciosPorPago && opcional.preciosPorPago[formaPago] !== undefined) {
    crudo = opcional.preciosPorPago[formaPago];
  } else if (opcional.precioUnitario !== undefined) {
    crudo = opcional.precioUnitario;     // snapshot ya congelado del pedido
  } else if (opcional.precio !== undefined) {
    crudo = opcional.precio;             // campo real del opcional en el sistema
  } else {
    crudo = opcional.valor;
  }

  const r = normalizarImporte(crudo);
  if (!r.valido && typeof onWarn === 'function') {
    onWarn({
      tipo: 'importe-invalido',
      motivo: r.motivo,
      opcional: opcional.nombre || opcional.id || '(sin nombre)',
      articleId: opcional.articleId || null,
      crudo,
    });
  }
  return r.valor;
}

/** ¿Este opcional tiene costo adicional? (para mostrar "+$…" solo si > 0). */
export function tienePrecio(opcional, formaPago = null) {
  return obtenerPrecioOpcional(opcional, formaPago) > 0;
}

/**
 * ¿El precio de este opcional es INVÁLIDO? (basura tipo "abc"). Un precio
 * ausente o 0 NO es inválido: es un opcional gratuito. Se usa para no mostrar
 * un importe roto como si fuera gratis y para bloquear la confirmación.
 */
export function precioOpcionalInvalido(opcional, formaPago = null) {
  if (!opcional || typeof opcional !== 'object') return false;
  let crudo;
  if (formaPago && opcional.preciosPorPago && opcional.preciosPorPago[formaPago] !== undefined) {
    crudo = opcional.preciosPorPago[formaPago];
  } else if (opcional.precioUnitario !== undefined) crudo = opcional.precioUnitario;
  else if (opcional.precio !== undefined) crudo = opcional.precio;
  else crudo = opcional.valor;
  return normalizarImporte(crudo).valido === false;
}

/**
 * Lista los opcionales con precio inválido de una línea. Si devuelve algo, un
 * pedido NUEVO no debe confirmarse (los históricos igual se abren y muestran).
 */
export function detectarOpcionalesConPrecioInvalido(items, formaPago = null) {
  const lista = Array.isArray(items) ? items : [items];
  const malos = [];
  for (const item of lista) {
    if (!item) continue;
    for (const op of listarOpcionalesSeleccionados(item.selectedOptionals)) {
      if (precioOpcionalInvalido(op, formaPago)) {
        malos.push({
          articulo: item.nombre || item.id || '(sin nombre)',
          opcional: op.nombre || op.name || '(sin nombre)',
          grupoId: op.groupId || null,
        });
      }
    }
  }
  return malos;
}

/**
 * Itera las selecciones de opcionales de UNA unidad.
 * `selectedOptionals` es { [groupId]: [opcional, ...] } (estructura actual).
 */
export function listarOpcionalesSeleccionados(selectedOptionals) {
  if (!selectedOptionals || typeof selectedOptionals !== 'object') return [];
  const salida = [];
  for (const groupId of Object.keys(selectedOptionals)) {
    const lista = selectedOptionals[groupId];
    if (!Array.isArray(lista)) continue;
    for (const op of lista) {
      if (op && typeof op === 'object') salida.push({ ...op, groupId: op.groupId || groupId });
    }
  }
  return salida;
}

/**
 * Total de opcionales de UNA unidad (sin multiplicar por la cantidad de la línea).
 * Respeta `quantity` propio del opcional cuando el selector permite cantidades.
 */
export function calcularTotalOpcionalesUnidad(selectedOptionals, { formaPago = null, onWarn = null } = {}) {
  return listarOpcionalesSeleccionados(selectedOptionals).reduce((sum, op) => {
    const precio = obtenerPrecioOpcional(op, formaPago, onWarn);
    const cant = Number(op.quantity ?? op.cantidad ?? 1) || 1;
    return sum + precio * cant;
  }, 0);
}

/**
 * Total de opcionales de una LÍNEA completa (regla POR UNIDAD → × cantidad).
 * Con el modelo por unidad cada línea es quantity 1, así que esto coincide; se
 * mantiene la multiplicación para líneas legacy con cantidad > 1.
 */
export function calcularTotalOpcionales(selectedOptionals, cantidadProducto = 1, opts = {}) {
  const cant = Number(cantidadProducto) || 1;
  return calcularTotalOpcionalesUnidad(selectedOptionals, opts) * cant;
}

/**
 * Subtotal de una línea del pedido, desglosado.
 * `item.valor` se interpreta SIEMPRE como precio base (nunca con opcionales).
 * @returns {{ precioBase:number, cantidad:number, totalOpcionales:number, subtotal:number }}
 */
export function calcularSubtotalLinea(item, { formaPago = null, onWarn = null } = {}) {
  if (!item || typeof item !== 'object') {
    return { precioBase: 0, cantidad: 0, totalOpcionales: 0, subtotal: 0 };
  }

  // --- Compatibilidad / anti doble-suma (auditado en los 3 proyectos) ---
  // Hoy NINGÚN flujo mete opcionales dentro de `valor`/`price`: DLV guarda
  // `valor: Number(item.price)` (base), Desktop/Tab idem. Aun así se detectan
  // dos casos defensivos:
  //  a) La línea trae un subtotal CONGELADO del pedido guardado
  //     (precioBaseUnitario + subtotalLinea): manda el snapshot, no se recalcula
  //     con precios actuales (integridad histórica).
  //  b) Un registro legacy marca explícitamente que su precio ya incluye los
  //     opcionales: entonces NO se vuelven a sumar.
  if (item.opcionalesIncluidosEnValor === true) {
    const rInc = normalizarImporte(item.valor ?? item.precio ?? item.price);
    const cantInc = Number(item.quantity ?? item.cantidad ?? 1) || 1;
    return {
      precioBase: rInc.valor,
      cantidad: cantInc,
      totalOpcionales: 0,
      subtotal: rInc.valor * cantInc,
      fuente: 'valor-ya-incluye-opcionales',
    };
  }
  if (item.subtotalLinea !== undefined && item.precioBaseUnitario !== undefined) {
    const rSub = normalizarImporte(item.subtotalLinea);
    const rBaseCong = normalizarImporte(item.precioBaseUnitario);
    const rOpc = normalizarImporte(item.totalOpcionales);
    if (rSub.valido && !rSub.ausente) {
      return {
        precioBase: rBaseCong.valor,
        cantidad: Number(item.quantity ?? item.cantidad ?? 1) || 1,
        totalOpcionales: rOpc.valor,
        subtotal: rSub.valor,
        fuente: 'snapshot-congelado',
      };
    }
  }

  const baseRaw = item.valor ?? item.precio ?? item.price;
  const rBase = normalizarImporte(baseRaw);
  if (!rBase.valido && typeof onWarn === 'function') {
    onWarn({
      tipo: 'importe-invalido',
      motivo: rBase.motivo,
      articulo: item.nombre || item.id || '(sin nombre)',
      articleId: item.id || null,
      crudo: baseRaw,
    });
  }
  const precioBase = rBase.valor;
  const cantidad = Number(item.quantity ?? item.cantidad ?? 1) || 1;

  const totalOpcionales = calcularTotalOpcionales(item.selectedOptionals, cantidad, { formaPago, onWarn });

  return {
    precioBase,
    cantidad,
    totalOpcionales,
    subtotal: precioBase * cantidad + totalOpcionales,
  };
}

/**
 * Total del pedido. Única fórmula usada por Desktop, Tablet y DLV Pedidos.
 * @returns {{ total:number, totalBase:number, totalOpcionales:number, lineas:Array }}
 */
export function calcularTotalPedido(items, { formaPago = null, onWarn = null } = {}) {
  const lista = Array.isArray(items) ? items : [];
  let total = 0;
  let totalBase = 0;
  let totalOpcionales = 0;
  const lineas = [];

  for (const item of lista) {
    const l = calcularSubtotalLinea(item, { formaPago, onWarn });
    total += l.subtotal;
    totalBase += l.precioBase * l.cantidad;
    totalOpcionales += l.totalOpcionales;
    lineas.push(l);
  }

  return { total, totalBase, totalOpcionales, lineas };
}

/**
 * Snapshot de los opcionales de una línea, para persistir en el pedido. Congela
 * el precio usado (el artículo puede cambiar de precio después) y conserva la
 * referencia estable al artículo real cuando el opcional viene de un departamento.
 */
export function construirSnapshotOpcionales(item, { formaPago = null, onWarn = null } = {}) {
  const seleccion = listarOpcionalesSeleccionados(item && item.selectedOptionals);
  return seleccion.map((op) => {
    const precioUnitario = obtenerPrecioOpcional(op, formaPago, onWarn);
    const cantidad = Number(op.quantity ?? op.cantidad ?? 1) || 1;
    return {
      // identidad (Fase 2: articleId/departamentoId cuando viene de departamento)
      articleId: op.articleId ?? null,
      departamentoId: op.departamentoId ?? null,
      opcionalId: op.id ?? op.codigo ?? null,
      grupoId: op.groupId ?? null,
      nombre: op.nombre ?? op.name ?? '',
      origen: op.origen ?? (op.articleId ? 'departamento' : 'manual'),
      // importe congelado
      precioUnitario,
      cantidad,
      total: precioUnitario * cantidad,
      // consumo de stock (Fase 2); por defecto 1 unidad del artículo por selección
      consumoStock: op.articleId ? Number(op.consumoStock ?? 1) || 1 : 0,
    };
  });
}

/**
 * Consumo de stock generado por los opcionales de una línea (Fase 2).
 * Devuelve movimientos por artículo real, ya multiplicados por la cantidad de
 * la línea (regla por unidad). Solo incluye opcionales vinculados a un artículo.
 */
export function calcularConsumoStockOpcionales(item) {
  if (!item || typeof item !== 'object') return [];
  const cantidadLinea = Number(item.quantity ?? item.cantidad ?? 1) || 1;
  const snapshot = Array.isArray(item.opcionalesSnapshot)
    ? item.opcionalesSnapshot
    : construirSnapshotOpcionales(item);

  const porArticulo = new Map();
  for (const op of snapshot) {
    if (!op.articleId) continue;                 // solo opcionales con artículo real
    const consumo = (Number(op.consumoStock) || 0) * (Number(op.cantidad) || 1) * cantidadLinea;
    if (consumo <= 0) continue;
    porArticulo.set(op.articleId, (porArticulo.get(op.articleId) || 0) + consumo);
  }

  return Array.from(porArticulo.entries()).map(([articleId, cantidad]) => ({ articleId, cantidad }));
}
