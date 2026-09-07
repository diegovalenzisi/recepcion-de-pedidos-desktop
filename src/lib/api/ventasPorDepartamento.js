// ---------------------------------------------------------------------------
// VENTAS DE MOSTRADOR POR DEPARTAMENTO — PEDIDOSYA / RAPPI / M.LIBRE
//
// A diferencia de `ventasApps.js` (que clasifica por MEDIO DE PAGO), esto
// clasifica por el DEPARTAMENTO real de cada artículo vendido: una venta de
// Mostrador aporta a una pestaña del reporte si tiene items cuyo
// `item.departamento` resuelve (por nombre, normalizado) a
// PEDIDOSYA/RAPPI/M.LIBRE — sin depender de que el departamento esté escrito
// exactamente igual (ver `departamentosCanonicos.js`).
//
// Reglas de negocio pedidas explícitamente:
//   - Sólo MOSTRADOR (nunca Delivery/PEDIDOS ni el ledger PREPAGO_*): esto es
//     "ventas reales de Mostrador clasificadas por artículo", no el reporte
//     de ventas por app que clasifica por medio de pago.
//   - El importe es el SUBTOTAL de los items de esa venta que pertenecen al
//     departamento (cantidad × precio + opcionales, vía calcularSubtotalLinea
//     de optionalsPricing.js) — no el total del ticket, porque un mismo
//     ticket puede mezclar artículos de distintos departamentos.
//
// El `item.departamento` es el id REAL del departamento tal como quedó
// congelado en la venta al momento de cobrar (p. ej. "9D") — se resuelve
// contra el DEPARTAMENTOS ACTUAL del local (mapaClavePorDepartamento), no
// contra un snapshot histórico: si un departamento se renombra hoy a su
// forma canónica, las ventas viejas que ya usaban ese id se reclasifican
// solas la próxima vez que se abre el reporte.
//
// Módulo puro: sin Firebase, sin React, sin DOM.
// ---------------------------------------------------------------------------

import { calcularSubtotalLinea } from './optionalsPricing.js';
import { normalizarNombreDepartamento, CLAVES_CANONICAS } from './departamentosCanonicos.js';
import { normalizarFecha, instante, ordenarFilas, normalizarPlataforma } from './ventasApps.js';

export { normalizarNombreDepartamento };

/** Etiquetas VISIBLES de cada clave canónica, en el mismo orden que las pestañas. */
export const ETIQUETA_CLAVE = Object.freeze({ PEDIDOSYA: 'PedidosYa', RAPPI: 'Rappi', MLIBRE: 'M.LIBRE' });

// ---------------------------------------------------------------------------
// FORMA DE PAGO dentro de cada departamento — auditado sobre ventas REALES de
// Mostrador antes de programar (no se adivinó ningún campo ni valor):
//   - el campo real es `venta.payments` (duplicado en `venta.payment.payments`
//     y `venta.payment.details`), cada entrada `{ amount, method }` — misma
//     forma que ya usa `pagosDeAppEnVenta()` en ventasApps.js.
//   - el efectivo se guarda como "Efectivo" (no "EFECTIVO": se compara sin
//     importar mayúsculas).
//   - el prepago de plataforma se guarda como "PREPAGO PEDIDOSYA",
//     "PREPAGO RAPPI" o (histórico) "PREPAGO M.PAGO" — se reutiliza
//     normalizarPlataforma() de ventasApps.js, que ya resuelve esas tres
//     variantes, en vez de reinventar la normalización acá.
//   - también aparecen medios NO esperados en producción (ej. "Transferencia
//     2", o el prepago de OTRA plataforma pagando un item de esta): nunca se
//     descartan, quedan en la categoría OTRO con su valor real tal cual.
// ---------------------------------------------------------------------------

// Bridge entre el espacio de claves de DEPARTAMENTO ('PEDIDOSYA'|'RAPPI'|'MLIBRE')
// y el espacio de claves de MEDIO DE PAGO que ya resuelve normalizarPlataforma()
// ('PEDIDOSYA'|'RAPPI'|'MPAGO'). M.LIBRE es la única que no coincide de nombre.
const CLAVE_PAGO_ESPERADA = Object.freeze({ PEDIDOSYA: 'PEDIDOSYA', RAPPI: 'RAPPI', MLIBRE: 'MPAGO' });

/** Etiqueta VISIBLE del prepago esperado para cada departamento. */
export const ETIQUETA_PREPAGO = Object.freeze({ PEDIDOSYA: 'PREPAGO PEDIDOSYA', RAPPI: 'PREPAGO RAPPI', MLIBRE: 'PREPAGO M.LIBRE' });

export const CATEGORIA_EFECTIVO = 'EFECTIVO';
export const CATEGORIA_PREPAGO = 'PREPAGO';
export const CATEGORIA_OTRO = 'OTRO';

const esEfectivo = (metodo) => String(metodo ?? '').trim().toUpperCase() === 'EFECTIVO';

/**
 * Clasifica el medio de pago REAL de una venta dentro de un departamento:
 *   EFECTIVO — el valor guardado es literalmente "Efectivo" (case-insensitive).
 *   PREPAGO  — normaliza (reutilizando normalizarPlataforma() de ventasApps.js)
 *              al prepago ESPERADO para ESTE departamento.
 *   OTRO     — cualquier otro medio: transferencia, tarjeta, el prepago de
 *              OTRA plataforma pagado por error, o ningún medio reconocible.
 *              Nunca se descarta: se etiqueta con el valor real tal cual está
 *              guardado, para que quede visible en el reporte.
 */
export function categorizarFormaDePago(metodo, clave) {
  if (esEfectivo(metodo)) return { categoria: CATEGORIA_EFECTIVO, etiqueta: 'EFECTIVO' };
  const detectada = normalizarPlataforma(metodo);
  if (detectada && detectada === CLAVE_PAGO_ESPERADA[clave]) {
    return { categoria: CATEGORIA_PREPAGO, etiqueta: ETIQUETA_PREPAGO[clave] };
  }
  const literal = String(metodo ?? '').trim();
  return { categoria: CATEGORIA_OTRO, etiqueta: literal || '(sin forma de pago)' };
}

const ESTADOS_ANULADOS = new Set(['CANCELADO', 'CANCELADOS', 'ANULADO', 'RECHAZADO']);

/** ¿La venta está anulada/cancelada? Una venta anulada no aporta al reporte. */
export function ventaAnulada(venta, estadoCarpeta = null) {
  const estado = String(venta?.status?.main ?? venta?.status ?? estadoCarpeta ?? '').toUpperCase();
  return ESTADOS_ANULADOS.has(estado);
}

/**
 * `{ [departamentoId]: 'PEDIDOSYA'|'RAPPI'|'MLIBRE' }` — sólo los ids cuyo
 * `nombre` resuelve a alguno de los tres canónicos. El resto del catálogo de
 * departamentos del local queda fuera del mapa (no aporta a este reporte).
 */
export function mapaClavePorDepartamento(departamentos) {
  const mapa = {};
  for (const [id, dep] of Object.entries(departamentos || {})) {
    const clave = normalizarNombreDepartamento(dep?.nombre);
    if (clave) mapa[id] = clave;
  }
  return mapa;
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Subtotales por clave canónica de UNA venta, sumando sólo los items cuyo
 * `item.departamento` resuelve a esa clave según `mapaClave`.
 * @returns {{ PEDIDOSYA: number, RAPPI: number, MLIBRE: number }}
 */
export function subtotalesPorDepartamento(venta, mapaClave = {}) {
  const acumulado = { PEDIDOSYA: 0, RAPPI: 0, MLIBRE: 0 };
  const items = Array.isArray(venta?.items) ? venta.items
    : Array.isArray(venta?.articulos) ? venta.articulos
      : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const clave = mapaClave[item.departamento];
    if (!clave) continue;
    const { subtotal } = calcularSubtotalLinea(item);
    acumulado[clave] += numero(subtotal);
  }
  return acumulado;
}

/**
 * Pagos reales de la venta: `[{ amount, method }]`. Misma precedencia que
 * `pagosDeAppEnVenta()` de ventasApps.js (`payments[]` / `payment.payments[]`
 * / `payment.details[]`, y a falta de array, los campos sueltos históricos),
 * pero sin filtrar por plataforma: acá interesa CUALQUIER medio de pago, no
 * sólo los de una app.
 */
export function pagosDeVenta(venta) {
  if (!venta || typeof venta !== 'object') return [];
  const listas = [venta.payments, venta.payment?.payments, venta.payment?.details]
    .filter((l) => Array.isArray(l) && l.length > 0);
  if (listas.length > 0) {
    return listas[0].map((p) => ({ amount: numero(p?.amount ?? p?.importe), method: p?.method ?? p?.metodo ?? null }));
  }
  const total = numero(venta.payment?.total ?? venta.total ?? venta.importe);
  for (const metodo of [venta.payment?.method, venta.paid?.method, venta.formaPago, venta.modo]) {
    if (metodo) return [{ amount: total, method: metodo }];
  }
  return [];
}

/**
 * Reparte el subtotal de UN departamento entre las formas de pago reales del
 * ticket. El caso normal (un solo medio de pago, la inmensa mayoría) devuelve
 * una única fila con el importe completo. Un ticket con pago DIVIDIDO (raro,
 * pero real — se vio en auditoría) prorratea el subtotal según la proporción
 * de cada medio sobre el total efectivamente pagado: si el ticket es de un
 * solo departamento (lo habitual en un pago dividido), el prorrateo da
 * exactamente los montos reales de cada pago; si además mezcla
 * departamentos, reparte proporcionalmente sin inventar ni perder un peso (el
 * redondeo se ajusta en el último tramo para que la suma cierre EXACTO).
 * Sin ningún medio reconocible, no se descarta: se informa como OTRO.
 */
export function filasDePagoParaClave(clave, importeDepto, pagos) {
  if (!importeDepto) return [];
  if (!pagos || pagos.length === 0) {
    const { categoria, etiqueta } = categorizarFormaDePago(null, clave);
    return [{ categoria, etiqueta, importe: importeDepto, prorrateado: false }];
  }
  if (pagos.length === 1) {
    const { categoria, etiqueta } = categorizarFormaDePago(pagos[0].method, clave);
    return [{ categoria, etiqueta, importe: importeDepto, prorrateado: false }];
  }
  const totalPagos = pagos.reduce((acc, p) => acc + numero(p.amount), 0);
  let acumulado = 0;
  return pagos
    .map((p, i) => {
      const { categoria, etiqueta } = categorizarFormaDePago(p.method, clave);
      const esUltimo = i === pagos.length - 1;
      const proporcion = totalPagos > 0 ? numero(p.amount) / totalPagos : 1 / pagos.length;
      const parte = esUltimo ? (importeDepto - acumulado) : Math.round(importeDepto * proporcion);
      acumulado += parte;
      // Marca de auditoría: este importe NO es el monto real de ese pago, es
      // una porción prorrateada (ticket con pago dividido). Queda en la fila
      // para poder identificar y auditar estos casos — nunca se oculta.
      return { categoria, etiqueta, importe: parte, prorrateado: true };
    })
    .filter((f) => f.importe !== 0);
}

/**
 * Filas del reporte a partir de UNA venta de Mostrador: una fila por cada
 * (clave canónica × forma de pago) con importe distinto de cero — una venta
 * que mezcla PedidosYa + Rappi en el mismo ticket aporta a las dos, y un
 * ticket con pago dividido dentro de una misma clave aporta una fila por
 * cada medio de pago (ver `filasDePagoParaClave`).
 *
 * @param {object} venta   la venta tal cual está guardada en MOSTRADOR/BACKUP
 * @param {object} ctx     { id, fecha, turno, localId, estado, origen }
 * @param {object} mapaClave  el de `mapaClavePorDepartamento()`
 */
export function filasDeVentaPorDepartamento(venta, ctx = {}, mapaClave = {}) {
  if (!venta || typeof venta !== 'object') return [];
  if (ventaAnulada(venta, ctx.estado)) return [];

  const subtotales = subtotalesPorDepartamento(venta, mapaClave);
  const pagos = pagosDeVenta(venta);
  const idVenta = String(ctx.id ?? venta.id ?? '').trim();
  const fecha = normalizarFecha(ctx.fecha ?? venta.fechacaja ?? venta.date ?? venta.fecha ?? venta.timestamp);
  const hora = venta.hora || venta.times?.ingress || null;

  const filas = [];
  for (const clave of CLAVES_CANONICAS) {
    const importeDepto = subtotales[clave];
    if (!importeDepto) continue;
    const filasDePago = filasDePagoParaClave(clave, importeDepto, pagos);
    filasDePago.forEach((pago, i) => {
      filas.push({
        // Clave ESTABLE: no depende de fecha/hora/importe (sólo del índice
        // del pago dentro del ticket, que es determinístico). La misma venta
        // leída de MOSTRADOR vivo y de BACKUP produce la misma clave → se
        // deduplica en unirSinDuplicarPorDepartamento().
        id: `${clave}|Mostrador|${idVenta}|${i}`,
        clave,
        fecha,
        hora,
        importe: pago.importe,
        categoriaPago: pago.categoria,
        metodoPago: pago.etiqueta,
        // Auditoría: true si este importe es una porción prorrateada de un
        // ticket con pago dividido (ver filasDePagoParaClave) — no es el
        // monto real de un único pago.
        prorrateado: pago.prorrateado,
        referencia: idVenta ? `M${idVenta}` : null,
        numeroVenta: idVenta || null,
        canal: 'Mostrador',
        turno: venta.turno ?? ctx.turno ?? null,
        estado: String(venta.status?.main ?? venta.status ?? ctx.estado ?? '').toUpperCase() || null,
        origen: ctx.origen || 'MOSTRADOR',
        localId: ctx.localId || null,
        instante: instante(fecha, hora),
      });
    });
  }
  return filas;
}

/** Une filas de varias fuentes (vivas + BACKUP) sin duplicar, por su id estable. */
export function unirSinDuplicarPorDepartamento(filas = []) {
  const porId = new Map();
  for (const fila of filas) {
    if (!fila) continue;
    if (!porId.has(fila.id)) porId.set(fila.id, fila);
  }
  return ordenarFilas([...porId.values()]);
}

/** Filtra por clave canónica (una fila pertenece a UNA sola pestaña). */
export const filtrarPorClave = (filas, clave) => (filas || []).filter((f) => f.clave === clave);

/**
 * Totales por forma de pago sobre un conjunto de filas YA filtrado por clave
 * y por rango de fechas — alimenta las 4 tarjetas de cada pestaña (EFECTIVO /
 * PREPAGO / TOTAL / OPERACIONES). TOTAL y OPERACIONES siempre reconcilian con
 * el listado de abajo: `total` es la suma de TODAS las filas (efectivo +
 * prepago + otros — nunca se pierde un peso) y `operaciones` es la cantidad
 * de filas, la misma cantidad de líneas que se listan.
 *
 * `otrosPorEtiqueta` desglosa cualquier medio de pago que no sea efectivo ni
 * el prepago esperado de esta plataforma (ver `categorizarFormaDePago`) — se
 * informa, nunca se descarta silenciosamente.
 */
export function calcularTotalesFormaPago(filas) {
  const acc = { efectivo: 0, prepago: 0, otros: 0, otrosPorEtiqueta: {}, total: 0, operaciones: 0 };
  for (const f of (filas || [])) {
    const importe = numero(f.importe);
    acc.operaciones += 1;
    acc.total += importe;
    if (f.categoriaPago === CATEGORIA_EFECTIVO) acc.efectivo += importe;
    else if (f.categoriaPago === CATEGORIA_PREPAGO) acc.prepago += importe;
    else {
      acc.otros += importe;
      const etiqueta = f.metodoPago || '(sin forma de pago)';
      acc.otrosPorEtiqueta[etiqueta] = (acc.otrosPorEtiqueta[etiqueta] || 0) + importe;
    }
  }
  return acc;
}

/** Filas → filas de Excel. Mismas columnas que la grilla de pantalla. */
export function filasParaExcel(filas, localId) {
  return (filas || []).map((f) => ({
    Fecha: f.fecha || '',
    Hora: f.hora || '',
    Plataforma: ETIQUETA_CLAVE[f.clave] || f.clave || '',
    'Forma de pago': f.metodoPago || '',
    Referencia: f.referencia || '—',
    Importe: numero(f.importe),
    Local: f.localId || localId || '',
    Turno: f.turno ?? '',
    Canal: f.canal || '',
    'N° de venta': f.numeroVenta || '',
    Origen: f.origen || '',
    ID: f.id,
  }));
}
