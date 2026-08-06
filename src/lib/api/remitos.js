// ---------------------------------------------------------------------------
// REMITOS (FCX) — MÓDULO PURO
//
// Un REMITO es el comprobante NO FISCAL de una venta que NO se factura. No lleva
// CAE, no lo emite AFIP y no reemplaza a una factura: es el respaldo interno de
// la entrega.
//
//   Factura  FCB / FCC  → la emite el runtime de facturación (AFIP) y la guarda
//                         en  /{localId}/VENTAS/{FCB…}   (ruta fiscal, intacta).
//   Remito   FCX        → lo emite ESTE módulo y vive en
//                         /{localId}/Remitos/{FCX…}
//
// El número de local es SIEMPRE el primer segmento (regla de rutasLocales.js).
// Sin localId válido no se construye ninguna ruta: se lanza LOCAL_ID_REQUIRED y
// el caller cancela la escritura.
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// Todo lo que toca la red vive en remitosApi.js.
// ---------------------------------------------------------------------------

import { construirRutaLocal, normalizarLocalId } from './rutasLocales.js';

/** Prefijo del comprobante no fiscal. NO se cambia: es el formato histórico. */
export const PREFIJO_REMITO = 'FCX';

/** Nodo del local donde viven los remitos. Único y canónico. */
export const NODO_REMITOS = 'Remitos';

/** Punto de venta por defecto cuando el local no tiene configuración AFIP. */
export const PUNTO_VENTA_POR_DEFECTO = '0001';

/** FCX0008-00010294 */
const FORMATO_NUMERO = /^FCX\d{4}-\d{8}$/;

/**
 * Punto de venta a 4 dígitos. Acepta 8, '8', '0008'. Cualquier cosa que no sea
 * un entero positivo cae al punto de venta por defecto (nunca produce 'NaN').
 */
export function normalizarPuntoVenta(valor) {
  const n = Number(String(valor ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return PUNTO_VENTA_POR_DEFECTO;
  return String(Math.floor(n)).padStart(4, '0').slice(-4);
}

/** Secuencia a 8 dígitos. */
export function normalizarSecuencia(valor) {
  const n = Number(String(valor ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.floor(n)).padStart(8, '0').slice(-8);
}

/**
 * Número de remito canónico: FCX{ptoVta 4}-{secuencia 8}.
 * Devuelve null si la secuencia no sirve (así el caller aborta en vez de
 * escribir un comprobante con número basura).
 */
export function construirNumeroRemito(puntoVenta, secuencia) {
  const sec = normalizarSecuencia(secuencia);
  if (!sec) return null;
  return `${PREFIJO_REMITO}${normalizarPuntoVenta(puntoVenta)}-${sec}`;
}

/** ¿Es un número de remito con el formato canónico exacto? */
export function esNumeroRemitoValido(valor) {
  return typeof valor === 'string' && FORMATO_NUMERO.test(valor);
}

/**
 * ¿Este identificador corresponde a un remito? Deliberadamente tolerante: los
 * remitos históricos (agosto 2025) usan el mismo prefijo pero pueden no cumplir
 * el formato al dígito, y también tienen que poder migrarse y mostrarse.
 */
export function esRemito(valor) {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_REMITO);
}

/** ¿Es una factura fiscal (FCB responsable inscripto / FCC monotributo)? */
export function esFacturaFiscal(valor) {
  const s = String(valor ?? '');
  return s.startsWith('FCB') || s.startsWith('FCC');
}

/** /{localId}/Remitos — lanza LOCAL_ID_REQUIRED si no hay local válido. */
export function rutaRemitos(localId) {
  return construirRutaLocal(localId, NODO_REMITOS);
}

/** /{localId}/Remitos/{numero} */
export function rutaRemito(localId, numero) {
  const n = String(numero ?? '').trim();
  if (!n) throw new Error('REMITO_SIN_NUMERO: no se puede construir la ruta de un remito sin número');
  return construirRutaLocal(localId, `${NODO_REMITOS}/${n}`);
}

/** /{localId}/CONTADORES/remitos — secuencia propia, jamás la de AFIP. */
export function rutaContadorRemitos(localId) {
  return construirRutaLocal(localId, 'CONTADORES/remitos');
}

/**
 * Copia sin claves `undefined` (Realtime Database las rechaza) y sin funciones.
 * Conserva null, 0, '' y false, que sí son datos.
 */
export function limpiarIndefinidos(valor) {
  if (Array.isArray(valor)) return valor.map(limpiarIndefinidos).filter((v) => v !== undefined);
  if (valor && typeof valor === 'object') {
    const salida = {};
    for (const k of Object.keys(valor)) {
      const v = limpiarIndefinidos(valor[k]);
      if (v !== undefined && typeof v !== 'function') salida[k] = v;
    }
    return salida;
  }
  if (typeof valor === 'function') return undefined;
  return valor;
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Total COMPLETO de la venta. Es el único importe con el que se emite un
 * comprobante: ni el remito ni la factura se parten por medio de pago.
 */
export function totalDeVenta(venta) {
  if (!venta || typeof venta !== 'object') return 0;
  return numero(venta.total ?? venta.payment?.total ?? venta.payment?.amount ?? venta.importe) ?? 0;
}

/** Lista de pagos normalizada, mire donde mire el formato de la venta. */
export function listarPagos(venta) {
  if (!venta || typeof venta !== 'object') return [];
  const crudos =
    (Array.isArray(venta.payments) && venta.payments) ||
    (Array.isArray(venta.payment?.payments) && venta.payment.payments) ||
    (Array.isArray(venta.payment?.details) && venta.payment.details) ||
    (venta.payment?.method ? [{ method: venta.payment.method, amount: venta.payment.total }] : []);

  return crudos
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      metodo: String(p.method ?? p.metodo ?? '').trim() || 'Sin especificar',
      importe: numero(p.amount ?? p.importe) ?? 0,
    }));
}

/** "Efectivo + Débito" — texto corto para la tabla y el ticket. */
export function describirFormaPago(pagos) {
  const lista = (pagos || []).map((p) => p.metodo).filter(Boolean);
  return lista.length ? [...new Set(lista)].join(' + ') : 'Sin especificar';
}

/** Un renglón del remito, con lo necesario para reimprimirlo tal cual se vendió. */
function construirProducto(item) {
  if (!item || typeof item !== 'object') return null;

  const cantidad = numero(item.cantidad ?? item.quantity) ?? 1;
  const unitario = numero(item.precioBaseUnitario ?? item.valor ?? item.precio) ?? 0;
  const opcionales = numero(item.totalOpcionales) ?? 0;
  const total = numero(item.subtotalLinea ?? item.precioTotal) ?? unitario * cantidad + opcionales;

  const producto = {
    nombre: String(item.nombre ?? item.name ?? '').trim() || 'Sin nombre',
    cantidad,
    precioUnitario: unitario,
    precioTotal: total,
  };

  if (item.codigo ?? item.id) producto.codigo = String(item.codigo ?? item.id);
  if (opcionales) producto.totalOpcionales = opcionales;
  if (item.selectedOptionals && Object.keys(item.selectedOptionals).length > 0) {
    producto.selectedOptionals = item.selectedOptionals;
  }
  if (item.isPromo) producto.isPromo = true;
  if (Array.isArray(item.promoDetails) && item.promoDetails.length > 0) producto.promoDetails = item.promoDetails;
  if (numero(item.unidadIndice) !== null) producto.unidadIndice = numero(item.unidadIndice);
  if (numero(item.unidadTotal) !== null) producto.unidadTotal = numero(item.unidadTotal);

  return limpiarIndefinidos(producto);
}

/** Los ítems de la venta como mapa '1','2','3'… (RTDB no guarda arrays ralos). */
export function construirProductos(items) {
  const lista = Array.isArray(items) ? items : Object.values(items || {});
  const productos = {};
  let i = 0;
  for (const item of lista) {
    const p = construirProducto(item);
    if (p) productos[String(++i)] = p;
  }
  return productos;
}

/**
 * REGISTRO CANÓNICO DEL REMITO. Es la ÚNICA estructura que se escribe en
 * /{localId}/Remitos/{numero}. No duplica la venta: la referencia por `origen`,
 * y guarda el detalle necesario para mostrarla y reimprimirla sin volver a
 * tocar MOSTRADOR / PEDIDOS (que al cerrar el turno se mueven a BACKUP).
 */
export function construirRemitoDesdeVenta({ venta, canal, numeroComprobante, localId, emitidoEn = null } = {}) {
  if (!venta || typeof venta !== 'object') throw new Error('REMITO_SIN_VENTA: no hay venta de origen');
  if (!esRemito(numeroComprobante)) throw new Error(`REMITO_NUMERO_INVALIDO: ${JSON.stringify(numeroComprobante)}`);
  const id = normalizarLocalId(localId);
  if (!id) throw new Error(`LOCAL_ID_REQUIRED: remito sin local (${JSON.stringify(localId)})`);

  const pagos = listarPagos(venta);
  const total = totalDeVenta(venta);
  const origenId = venta.id ?? venta.orderId ?? null;

  return limpiarIndefinidos({
    numeroComprobante,
    tipo: PREFIJO_REMITO,
    fecha: venta.fecha || venta.date || venta.FECHA || null,
    hora: venta.hora || venta.times?.ingress || venta.HORA || null,
    fechacaja: venta.fechacaja || null,
    turno: venta.turno ?? null,
    total,
    cliente: String(venta.client?.name || venta.cliente || venta.CLIENTE || 'Consumidor Final'),
    direccion: venta.client?.address || null,
    productos: construirProductos(venta.items),
    formaPago: describirFormaPago(pagos),
    pagos,
    canal: canal === 'delivery' ? 'delivery' : 'mostrador',
    localId: id,
    facturado: false,
    origen: {
      tipo: canal === 'delivery' ? 'delivery' : 'mostrador',
      id: origenId === null || origenId === undefined ? null : String(origenId),
      ruta: canal === 'delivery' ? 'PEDIDOS' : 'MOSTRADOR',
    },
    emitidoEn: emitidoEn || new Date().toISOString(),
  });
}

/**
 * Remito guardado → fila de la tabla / entrada de reimpresión.
 * Tolera las dos formas: la canónica de este módulo y la de los remitos
 * históricos que quedaron en VENTAS con claves en mayúscula.
 */
export function normalizarRemitoParaTabla(id, data) {
  const d = data && typeof data === 'object' ? data : {};
  const productos = d.productos || d.ARTICULOS || d.articulos || {};
  const lista = Array.isArray(productos) ? productos : Object.keys(productos)
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
    .map((k) => productos[k]);

  return {
    id: String(id),
    // El N° de comprobante de la fila es el del REMITO. El de la factura, si el
    // remito se facturó después, va aparte en `numeroFacturaFiscal`.
    numeroFactura: d.numeroComprobante || d.NumeroFactura || String(id),
    fecha: d.fecha || d.FECHA || null,
    hora: d.hora || d.HORA || null,
    importe: numero(d.total ?? d.IMPORTE ?? d.importe) ?? 0,
    modo: d.canal || d.MODO || d.modo || null,
    formaPago: d.formaPago || null,
    cliente: { nombre: d.cliente || d.CLIENTE || 'Consumidor Final' },
    articulos: lista.filter(Boolean).map((p) => ({
      nombre: p.nombre || p.NOMBRE || '',
      cantidad: numero(p.cantidad ?? p.CANTIDAD) ?? 1,
      precioTotal: numero(p.precioTotal ?? p.PRECIO ?? p.valor) ?? 0,
      selectedOptionals: p.selectedOptionals,
    })),
    facturado: d.facturado === true,
    // Ciclo de facturación posterior del remito (ver facturacionDeRemito.js).
    estadoFacturacion: d.estadoFacturacion || null,
    numeroFacturaFiscal: d.numeroFactura || null,
    tipoFactura: d.tipoFactura || null,
    cae: d.cae ?? null,
    errorFacturacion: d.errorFacturacion || null,
    origen: d.origen || null,
    esRemito: true,
  };
}

/**
 * Nodo Remitos crudo → filas ordenadas listas para la tabla.
 *
 * Los remitos facturados a posteriori SIGUEN listados, mostrando su estado y el
 * número de la factura con la que quedaron vinculados: el remito existió y hay
 * que poder reimprimirlo. Lo que no se cuenta dos veces es el IMPORTE — de eso
 * se encarga totalNoFacturado(), porque esa plata ya figura en Facturación.
 */
export function filasDeRemitos(data) {
  return ordenarRemitos(
    Object.keys(data || {}).map((k) => normalizarRemitoParaTabla(k, data[k]))
  );
}

/** Suma de los remitos que todavía NO se facturaron. Evita el doble conteo. */
export function totalNoFacturado(filas) {
  return (filas || []).reduce((suma, f) => (f.facturado ? suma : suma + (Number(f.importe) || 0)), 0);
}

/** Ordena remitos por fecha+hora, del más nuevo al más viejo. */
export function ordenarRemitos(filas) {
  const clave = (f) => {
    const [d, m, a] = String(f.fecha || '').split('-');
    if (!a) return 0;
    const [hh = '0', mm = '0', ss = '0'] = String(f.hora || '').split(':');
    return new Date(Number(a), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)).getTime() || 0;
  };
  return [...(filas || [])].sort((x, y) => clave(y) - clave(x));
}
