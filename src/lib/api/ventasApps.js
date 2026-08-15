// ---------------------------------------------------------------------------
// VENTAS POR APP (PedidosYa / Rappi) — MÓDULO PURO
//
// FUENTE CANÓNICA: la VENTA. Una venta cobrada con un medio de pago de la
// plataforma es el hecho real; el nodo `/{localId}/PREPAGO_{APP}/…` es un
// LEDGER DERIVADO que se escribe después de la venta y que histórricamente
// quedó incompleto (ver `ventasAppsFlujo.js`). Por eso el reporte se arma
// leyendo las ventas —vivas y respaldadas— y el ledger sólo aporta las fechas
// que las ventas ya no pueden cubrir.
//
// Dónde vive cada cosa (todo SIEMPRE bajo /{localId}/):
//   MOSTRADOR/{id}                                            venta viva de mostrador
//   PEDIDOS/{id}                                              pedido vivo de delivery
//   BACKUP/{aaaa}/{mm}/{dd}/TURNO/{t}/MOSTRADOR/{estado}/{id} venta de turno cerrado
//   BACKUP/{aaaa}/{mm}/{dd}/TURNO/{t}/DELIVERY/{estado}/{id}  pedido de turno cerrado
//   PREPAGO_PEDIDOSYA|PREPAGO_RAPPI/{fecha}/{numero}          ledger derivado
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// Sólo lee y transforma: nada de lo que hay acá escribe en ningún lado.
// ---------------------------------------------------------------------------

/** Plataformas soportadas. El orden es el de las pestañas. */
export const PLATAFORMAS = Object.freeze(['PEDIDOSYA', 'RAPPI', 'MPAGO']);

export const ETIQUETA_PLATAFORMA = Object.freeze({ PEDIDOSYA: 'PedidosYa', RAPPI: 'Rappi', MPAGO: 'M.PAGO' });

/** Estados que NO son una venta cobrada: no suman ni se listan. */
const ESTADOS_ANULADOS = new Set(['CANCELADO', 'CANCELADOS', 'ANULADO', 'RECHAZADO']);

/**
 * Normaliza cualquier variante histórica del nombre de la plataforma.
 * Cubre "PREPAGO PEDIDOSYA", "PedidosYa", "Pedidos Ya", "PEDIDOS_YA",
 * "prepago-rappi", "Rappi", etc. Devuelve null si no es una app.
 *
 * Se compara sin espacios, guiones ni underscores y sin acentos, así una
 * variante nueva del mismo nombre sigue cayendo en la misma plataforma.
 */
export function normalizarPlataforma(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[\s_\-.]+/g, '');
  if (!s) return null;
  if (s.includes('PEDIDOSYA') || s.includes('PEDIDOYA') || s.includes('PEYA')) return 'PEDIDOSYA';
  if (s.includes('RAPPI')) return 'RAPPI';
  // "PREPAGO M.PAGO" normaliza a PREPAGOMPAGO (el punto ya se saca arriba).
  // No colisiona con la cuenta "Mercado Pago" (MERCADOPAGO), que no contiene
  // la secuencia MPAGO y sigue sin ser una app.
  if (s.includes('MPAGO')) return 'MPAGO';
  return null;
}

/** ¿Este medio de pago corresponde a una app? (efectivo, débito, MP → false) */
export const esMedioDeApp = (metodo) => normalizarPlataforma(metodo) !== null;

const dosDigitos = (n) => String(n).padStart(2, '0');

/**
 * Normaliza a 'DD-MM-AAAA' cualquier forma histórica:
 *   'DD-MM-AAAA', 'DD/MM/AAAA', 'AAAA-MM-DD', 'AAAA/MM/DD', 'DDMMAAAA',
 *   Date, timestamp en ms (número o string), ISO 8601.
 * Devuelve null si no se puede interpretar. NUNCA modifica el dato original.
 */
export function normalizarFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${dosDigitos(valor.getDate())}-${dosDigitos(valor.getMonth() + 1)}-${valor.getFullYear()}`;
  }

  if (typeof valor === 'number') {
    // Timestamp en ms (o en segundos, si viniera de un sistema viejo).
    const ms = valor < 1e11 ? valor * 1000 : valor;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : normalizarFecha(d);
  }

  const s = String(valor).trim();
  if (!s) return null;

  let m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);          // DD-MM-AAAA · DD/MM/AAAA
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(s);              // AAAA-MM-DD · AAAA/MM/DD
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);                      // DDMMAAAA (clave de carpeta)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  if (/^\d{10,}$/.test(s)) return normalizarFecha(Number(s));  // timestamp como string

  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);            // ISO 8601
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;

  return null;
}

/** 'DD-MM-AAAA' → 'AAAA-MM-DD' (clave ordenable). null si la fecha no sirve. */
export function claveOrdenable(fecha) {
  const f = normalizarFecha(fecha);
  if (!f) return null;
  const [d, m, a] = f.split('-');
  return `${a}-${m}-${d}`;
}

/** 'DD-MM-AAAA' → 'DDMMAAAA' (clave de carpeta del ledger). */
export function claveCarpeta(fecha) {
  const f = normalizarFecha(fecha);
  return f ? f.replace(/-/g, '') : null;
}

/** Milisegundos de la fecha+hora de una fila, para ordenar y comparar. */
export function instante(fecha, hora) {
  const f = normalizarFecha(fecha);
  if (!f) return null;
  const [d, m, a] = f.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = String(hora || '').split(':').map((x) => Number(x) || 0);
  const t = new Date(a, m - 1, d, hh, mm, ss).getTime();
  return Number.isNaN(t) ? null : t;
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Pagos de app dentro de una venta, mire donde mire el formato histórico:
 * `payments[]`, `payment.payments[]`, `payment.details[]`, `payment.method`,
 * `paid.method` o `formaPago`. Devuelve una entrada por cada pago de app, con
 * su importe (en un pago dividido, sólo la parte de la app).
 */
export function pagosDeAppEnVenta(venta) {
  if (!venta || typeof venta !== 'object') return [];

  const listas = [venta.payments, venta.payment?.payments, venta.payment?.details]
    .filter((l) => Array.isArray(l) && l.length > 0);

  if (listas.length > 0) {
    // Las tres listas suelen ser copias de lo mismo: se usa la primera con datos.
    return listas[0]
      .map((p) => ({ plataforma: normalizarPlataforma(p?.method ?? p?.metodo), importe: numero(p?.amount ?? p?.importe), metodo: p?.method ?? p?.metodo }))
      .filter((p) => p.plataforma);
  }

  const total = numero(venta.payment?.total ?? venta.total ?? venta.importe);
  for (const metodo of [venta.payment?.method, venta.paid?.method, venta.formaPago, venta.modo]) {
    const plataforma = normalizarPlataforma(metodo);
    if (plataforma) return [{ plataforma, importe: total, metodo }];
  }
  return [];
}

/** ¿La venta está anulada/cancelada? Una venta anulada no es ingreso de la app. */
export function ventaAnulada(venta, estadoCarpeta = null) {
  const estado = String(venta?.status?.main ?? venta?.status ?? estadoCarpeta ?? '').toUpperCase();
  return ESTADOS_ANULADOS.has(estado);
}

/**
 * Filas del reporte a partir de UNA venta. Devuelve una fila por cada pago de
 * app (un pago dividido PedidosYa + efectivo aporta sólo la parte de la app).
 *
 * @param {object} venta   la venta tal cual está guardada
 * @param {object} ctx     { id, canal:'Mostrador'|'Delivery', origen, fecha, turno, localId, estado }
 */
export function filasDeVenta(venta, ctx = {}) {
  if (!venta || typeof venta !== 'object') return [];
  if (ventaAnulada(venta, ctx.estado)) return [];

  const pagos = pagosDeAppEnVenta(venta);
  if (pagos.length === 0) return [];

  const idVenta = String(ctx.id ?? venta.id ?? '').trim();
  const canal = ctx.canal === 'Delivery' ? 'Delivery' : 'Mostrador';
  const prefijo = canal === 'Delivery' ? 'D' : 'M';
  const fecha = normalizarFecha(ctx.fecha ?? venta.fechacaja ?? venta.date ?? venta.fecha ?? venta.timestamp);
  const hora = venta.hora || venta.times?.ingress || null;

  return pagos.map((pago, i) => ({
    // Clave ESTABLE: no depende de fecha, hora ni importe. La misma venta leída
    // de MOSTRADOR vivo y de BACKUP produce la misma clave → se deduplica.
    id: `${pago.plataforma}|${canal}|${idVenta}|${i}`,
    plataforma: pago.plataforma,
    fecha,
    hora,
    importe: pago.importe,
    referencia: idVenta ? `${prefijo}${idVenta}` : null,
    numeroVenta: idVenta || null,
    canal,
    turno: venta.turno ?? ctx.turno ?? null,
    estado: String(venta.status?.main ?? venta.status ?? ctx.estado ?? '').toUpperCase() || null,
    metodo: pago.metodo || null,
    origen: ctx.origen || (canal === 'Delivery' ? 'PEDIDOS' : 'MOSTRADOR'),
    localId: ctx.localId || null,
    instante: instante(fecha, hora),
  }));
}

/**
 * Fila a partir de un registro del ledger PREPAGO_*. `numero` es un contador
 * que arranca en 1 CADA DÍA: por eso la clave lleva también la fecha (usar sólo
 * el número fue exactamente el bug que hacía desaparecer casi todo el
 * historial).
 */
export function filaDeLedger(registro, ctx = {}) {
  if (!registro || typeof registro !== 'object') return null;
  const plataforma = normalizarPlataforma(ctx.plataforma ?? registro.type);
  if (!plataforma) return null;

  const fecha = normalizarFecha(registro.fecha ?? ctx.fecha ?? registro.timestamp);
  const hora = registro.hora || null;
  const num = registro.numero ?? ctx.numero ?? null;

  return {
    id: `${plataforma}|LEDGER|${claveCarpeta(fecha) || 'SINFECHA'}|${num ?? registro.id ?? '0'}`,
    plataforma,
    fecha,
    hora,
    importe: numero(registro.monto),
    referencia: num !== null && num !== undefined ? `#${num}` : null,
    numeroVenta: null,
    canal: 'Prepago',
    turno: null,
    estado: null,
    metodo: `PREPAGO ${plataforma}`,
    origen: `PREPAGO_${plataforma}`,
    localId: ctx.localId || null,
    instante: registro.timestamp ? Number(registro.timestamp) : instante(fecha, hora),
  };
}

/**
 * Une las fuentes SIN duplicar.
 *
 * 1. Las filas de VENTA mandan: se deduplican por su clave estable, así una
 *    venta que está a la vez viva y respaldada aparece una sola vez.
 * 2. Del LEDGER sólo entran las filas cuya (plataforma, fecha) no está cubierta
 *    por ninguna venta. El ledger se escribe A PARTIR de la venta, así que si
 *    ese día hay ventas, sus registros ya están representados —y contarlos otra
 *    vez inflaría los totales—. Si ese día no hay ninguna venta alcanzable
 *    (respaldo viejo, carga manual desde Cuentas), la fila del ledger es la
 *    única evidencia y se conserva.
 *
 * Nunca se deduplica por fecha+hora+importe entre ventas: eso borraría dos
 * ventas legítimas del mismo monto en el mismo minuto.
 */
export function unirSinDuplicar(filasDeVentas = [], filasDeLedger = []) {
  const porId = new Map();
  const fechasConVenta = new Set();

  for (const fila of filasDeVentas) {
    if (!fila) continue;
    if (!porId.has(fila.id)) porId.set(fila.id, fila);
    if (fila.fecha) fechasConVenta.add(`${fila.plataforma}|${fila.fecha}`);
  }

  for (const fila of filasDeLedger) {
    if (!fila) continue;
    if (fila.fecha && fechasConVenta.has(`${fila.plataforma}|${fila.fecha}`)) continue;
    if (!porId.has(fila.id)) porId.set(fila.id, fila);
  }

  return ordenarFilas([...porId.values()]);
}

/** Más nuevas primero; las que no tienen fecha van al final, sin romper nada. */
export function ordenarFilas(filas) {
  return [...(filas || [])].sort((a, b) => {
    if (a.instante === null && b.instante === null) return 0;
    if (a.instante === null) return 1;
    if (b.instante === null) return -1;
    return b.instante - a.instante;
  });
}

/** Filtra por plataforma (una fila pertenece a UNA sola pestaña). */
export const filtrarPorPlataforma = (filas, plataforma) =>
  (filas || []).filter((f) => f.plataforma === normalizarPlataforma(plataforma));

/**
 * Rango de fechas INCLUSIVO en los dos extremos. `desde`/`hasta` aceptan las
 * mismas formas que normalizarFecha (la UI manda 'AAAA-MM-DD').
 */
export function filtrarPorRango(filas, desde, hasta) {
  const ini = claveOrdenable(desde);
  const fin = claveOrdenable(hasta);
  if (!ini && !fin) return [...(filas || [])];
  return (filas || []).filter((f) => {
    const k = claveOrdenable(f.fecha);
    if (!k) return false;
    if (ini && k < ini) return false;
    if (fin && k > fin) return false;
    return true;
  });
}

/**
 * Totales de las tarjetas sobre EL CONJUNTO QUE SE ESTÁ MOSTRANDO.
 * - hoy      : sólo la fecha de hoy;
 * - semana   : desde el domingo de esta semana (mismo criterio que ya usaba la
 *              pantalla) hasta hoy;
 * - mes      : mes calendario actual;
 * - total y operaciones: todo lo mostrado, coherente con el rango elegido.
 */
export function calcularTotales(filas, hoyRef = new Date()) {
  const hoy = new Date(hoyRef.getFullYear(), hoyRef.getMonth(), hoyRef.getDate());
  const inicioSemana = new Date(hoy);
  inicioSemana.setDate(hoy.getDate() - hoy.getDay());
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const clave = (d) => `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
  const kHoy = clave(hoy);
  const kSemana = clave(inicioSemana);
  const kMes = clave(inicioMes);

  return (filas || []).reduce((acc, f) => {
    const importe = numero(f.importe);
    acc.total += importe;
    acc.operaciones += 1;
    const k = claveOrdenable(f.fecha);
    if (!k) return acc;
    if (k === kHoy) acc.hoy += importe;
    if (k >= kSemana && k <= kHoy) acc.semana += importe;
    if (k >= kMes && k <= kHoy) acc.mes += importe;
    return acc;
  }, { hoy: 0, semana: 0, mes: 0, total: 0, operaciones: 0 });
}

/**
 * Días del rango como {anio, mes, dia} — es la lista EXACTA de nodos
 * BACKUP/{aaaa}/{mm}/{dd} que hay que leer. Así una consulta de un mes lee 30
 * nodos y no toda la base. Se corta en `maxDias` para que un rango absurdo no
 * dispare miles de lecturas.
 */
export function diasDelRango(desde, hasta, maxDias = 400) {
  const ini = claveOrdenable(desde);
  const fin = claveOrdenable(hasta);
  if (!ini || !fin || ini > fin) return [];
  const [ai, mi, di] = ini.split('-').map(Number);
  const [af, mf, df] = fin.split('-').map(Number);
  const cursor = new Date(ai, mi - 1, di);
  const limite = new Date(af, mf - 1, df);
  const dias = [];
  while (cursor <= limite && dias.length < maxDias) {
    dias.push({
      anio: String(cursor.getFullYear()),
      mes: dosDigitos(cursor.getMonth() + 1),
      dia: dosDigitos(cursor.getDate()),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

/** Filas → filas de Excel. Exactamente las columnas visibles, mismo orden. */
export function filasParaExcel(filas, localId) {
  return (filas || []).map((f) => ({
    Fecha: f.fecha || '',
    Hora: f.hora || '',
    Plataforma: ETIQUETA_PLATAFORMA[f.plataforma] || f.plataforma || '',
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
