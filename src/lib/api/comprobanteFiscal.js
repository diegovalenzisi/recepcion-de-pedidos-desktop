// ---------------------------------------------------------------------------
// COMPROBANTE FISCAL — LECTURA, TIPO REAL Y DETALLE
//
// Este módulo NO emite nada, NO pide CAE y NO escribe en Firebase. Sólo LEE un
// registro ya guardado en /{localId}/VENTAS y lo traduce a una estructura única
// para mostrarlo en pantalla y reimprimirlo.
//
// POR QUÉ EXISTE
// --------------
// Los registros fiscales se escribieron a lo largo del tiempo con cuatro formas
// distintas, según qué runtime los generó:
//
//   runtime RI (Factura B)          → PRODUCTO / CLIENTE / TOTAL / VtoCAE / PDF_BASE64
//   runtime monotributo (Factura C) → producto / clientes / total / CAE_VTO / PDF (archivo local)
//   colas viejas                    → producto_1, producto_2… sueltos
//   remitos históricos              → ARTICULOS en mayúscula
//
// La pantalla leía SÓLO `ARTICULOS`, que es la única clave que ningún runtime
// escribe: por eso la reimpresión salía con el total correcto y la tabla de
// productos vacía. Acá se leen TODAS las variantes.
//
// LA LETRA DEL COMPROBANTE
// ------------------------
// El prefijo de la clave (FCB… / FCC…) NO es fuente de verdad: hay comprobantes
// guardados como `FCB…` que son Facturas C, porque el prefijo del runtime cambió
// después de haberlos emitido y la clave quedó como estaba. La clave se conserva
// tal cual —es el identificador técnico y hay referencias apuntando a ella— pero
// la LETRA que se muestra sale de esta cascada (ver `resolverTipoComprobante`):
//
//   1. el tipo fiscal guardado en el propio comprobante (CbteTipo de ARCA);
//   2. si no lo tiene, la cuenta fiscal que lo emitió, ubicada por su punto de
//      venta y CUIT en la configuración del local;
//   3. como último recurso, la condición fiscal actual del local, marcando el
//      resultado como INFERIDO.
//
// ARCA: CbteTipo 6 = Factura B, CbteTipo 11 = Factura C. (1 = Factura A.)
//
// Nada de esto altera CAE, numeración, punto de venta ni el dato histórico: es
// interpretación de lectura.
//
// Módulo PURO: sin Firebase, sin React, sin DOM. Idéntico en Desktop y Tablet.
// ---------------------------------------------------------------------------

/** Códigos de comprobante de ARCA (RG 4291 / tabla FEParamGetTiposCbte). */
export const CBTE_TIPO = Object.freeze({
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
});

/** CbteTipo → letra fiscal. */
export const LETRA_POR_CBTE_TIPO = Object.freeze({
  1: 'A',
  6: 'B',
  11: 'C',
});

/** Condición fiscal del local → CbteTipo que emite. */
export const CBTE_TIPO_POR_CONDICION = Object.freeze({
  responsable_inscripto: CBTE_TIPO.FACTURA_B,
  monotributo: CBTE_TIPO.FACTURA_C,
});

/**
 * Claves donde puede venir el tipo fiscal en el registro guardado. La primera
 * que exista gana. Se aceptan variantes porque los runtimes las escribieron
 * distinto en distintas épocas.
 */
const CLAVES_CBTE_TIPO = ['CbteTipo', 'cbteTipo', 'CBTE_TIPO', 'TIPO_CBTE', 'tipoComprobante', 'FACTURA_TIPO'];

/** Claves donde puede venir el detalle de productos. Orden de preferencia. */
const CLAVES_PRODUCTOS = ['ARTICULOS', 'articulos', 'PRODUCTO', 'producto', 'PRODUCTOS', 'productos', 'items', 'detalle'];

const numero = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const texto = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

const primero = (...vals) => vals.find((v) => v !== undefined && v !== null && String(v).trim() !== '') ?? null;

/** '0008' a partir de 8, '8', '0008'. Devuelve null si no es un entero > 0. */
export function puntoVentaCanonico(valor) {
  const n = Number(String(valor ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.floor(n)).padStart(4, '0').slice(-4);
}

/**
 * Descompone el identificador de un comprobante: 'FCC0001-00001345' o
 * '0001-00001345'. El PREFIJO se devuelve tal cual está guardado: es el
 * identificador técnico y no se reescribe.
 *
 * @returns {{prefijo: string|null, puntoVenta: string|null, numero: number|null, completo: string|null}}
 */
export function partesDeNumero(valor) {
  const s = String(valor ?? '').trim();
  const m = s.match(/^([A-Za-z]*)(\d{4})-(\d{1,8})$/);
  if (!m) return { prefijo: null, puntoVenta: null, numero: null, completo: null };
  const [, prefijo, pv, nro] = m;
  return {
    prefijo: prefijo ? prefijo.toUpperCase() : null,
    puntoVenta: pv,
    numero: Number(nro),
    completo: `${pv}-${String(Number(nro)).padStart(8, '0')}`,
  };
}

/**
 * Cola fiscal declarada en el `firebasePath` de una cuenta: `{localId}/FACTURACION_N`.
 * Se resuelve acá, con una sola línea, para no depender de colasFiscales.js —
 * que sí depende de este módulo.
 */
export function colaDeFirebasePath(firebasePath) {
  const ultimo = String(firebasePath ?? '').trim().replace(/^\/+|\/+$/g, '').split('/').pop();
  return /^FACTURACION(_[1-9])?$/.test(ultimo) ? ultimo : null;
}

/** ¿La clave corresponde a una factura fiscal (no a un remito)? */
export function esClaveDeFactura(valor) {
  const s = String(valor ?? '');
  return s.startsWith('FCB') || s.startsWith('FCC') || s.startsWith('FCA');
}

/**
 * Prefijo EXACTO con el que una cuenta fiscal escribe sus comprobantes en
 * VENTAS: `FC{letra}{puntoVenta}-` (ej. `FCC0001-`). Es el mismo formato que
 * lee `partesDeNumero()`, expresado al revés: de la cuenta a la clave.
 *
 * @param {{letra: string, puntoVenta: string}} cuenta
 * @returns {string|null} null si falta letra o punto de venta.
 */
export function construirPrefijoClave({ letra, puntoVenta } = {}) {
  const l = String(letra ?? '').trim().toUpperCase();
  const pv = puntoVentaCanonico(puntoVenta);
  if (!l || !pv) return null;
  return `FC${l}${pv}-`;
}

/**
 * Rango de claves de VENTAS donde puede estar CUALQUIER comprobante de esta
 * cuenta fiscal — sin importar cuántas otras cuentas, ventas históricas o
 * comprobantes de formatos viejos (p. ej. FCX legado) tenga el mismo local.
 *
 * Es un rango por CLAVE (orderByKey + startAt/endAt): a diferencia de una
 * consulta por campo (orderByChild/equalTo), no requiere ningún `.indexOn` en
 * las reglas de Firebase — funciona igual en cualquiera de las bases.
 *
 * @param {{letra: string, puntoVenta: string}} cuenta
 * @returns {{desde: string, hasta: string}|null} null si la cuenta no resuelve prefijo.
 */
export function rangoDeClavesDeCuenta(cuenta) {
  const prefijo = construirPrefijoClave(cuenta || {});
  if (!prefijo) return null;
  // U+F8FF: carácter del área de uso privado de Unicode, más alto que
  // cualquier carácter imprimible real — cierra el rango sin incluir el
  // siguiente prefijo (p. ej. FCC0002-) ni excluir ningún sufijo válido.
  return { desde: prefijo, hasta: `${prefijo}` };
}

/**
 * Tipo fiscal REAL escrito en el comprobante, si lo trae.
 * @returns {number|null} CbteTipo de ARCA, o null si el registro no lo guarda.
 */
export function leerCbteTipoDelRegistro(registro) {
  if (!registro || typeof registro !== 'object') return null;
  for (const clave of CLAVES_CBTE_TIPO) {
    const bruto = registro[clave];
    if (bruto === undefined || bruto === null || bruto === '') continue;
    const n = numero(bruto);
    if (n !== null && LETRA_POR_CBTE_TIPO[n]) return n;
    // Algunas variantes históricas guardaron la letra ('B', 'C') o el nombre.
    const s = String(bruto).trim().toUpperCase();
    const porLetra = Object.entries(LETRA_POR_CBTE_TIPO).find(([, l]) => l === s || s === `FACTURA ${l}` || s === `FACTURA_${l}`);
    if (porLetra) return Number(porLetra[0]);
  }
  return null;
}

/**
 * Cuentas fiscales del local, normalizadas y con su CbteTipo, a partir de
 * /{localId}/CONFIGURACION/FACTURACION_AFIP.
 *
 * Devuelve TODAS las cuentas inicializadas (RI y monotributo), porque un local
 * puede haber cambiado de régimen y sus comprobantes viejos siguen perteneciendo
 * a la cuenta que los emitió.
 */
export function listarCuentasFiscales(config) {
  if (!config || typeof config !== 'object') return [];
  const cuentas = [];

  const agregar = (cuenta, tipo) => {
    if (!cuenta || typeof cuenta !== 'object') return;
    const ptoVta = puntoVentaCanonico(cuenta.ptoVta);
    const cuit = texto(cuenta.cuit);
    // Sin punto de venta ni CUIT no se puede atribuir ningún comprobante.
    if (!ptoVta && !cuit) return;
    cuentas.push({
      id: texto(cuenta.id),
      tipo,
      cbteTipo: CBTE_TIPO_POR_CONDICION[tipo] ?? null,
      // Cola en la que factura esta cuenta: el ÚLTIMO segmento de su
      // `firebasePath` ({localId}/FACTURACION_N). Es el vínculo más fuerte entre
      // un comprobante y el contribuyente que lo emitió, porque dos cuentas del
      // mismo local pueden compartir punto de venta pero nunca la cola.
      cola: colaDeFirebasePath(cuenta.firebasePath),
      ptoVta,
      cuit,
      cuitFormat: texto(cuenta.cuitFormat),
      razonSocial: texto(cuenta.razonSocial),
      fantasia: texto(cuenta.fantasia),
      domicilio: texto(cuenta.domicilio),
      condIVA: texto(cuenta.condIVA),
      inicioActividades: texto(cuenta.inicioActividades),
      iibb: texto(cuenta.iibb),
      nombre: texto(cuenta.nombre),
    });
  };

  agregar(config.ri, 'responsable_inscripto');
  for (const cuenta of config.monotributo?.cuentas || []) agregar(cuenta, 'monotributo');
  return cuentas;
}

/**
 * Cuenta que emitió un comprobante. Se ubica por punto de venta —que es lo que
 * identifica a la cuenta dentro del local— y se confirma con el CUIT si el
 * registro lo trae.
 */
export function resolverCuentaEmisora({ registro, id, config, cuentas = null }) {
  const lista = cuentas || listarCuentasFiscales(config);
  if (lista.length === 0) return null;

  const r = registro && typeof registro === 'object' ? registro : {};
  const cuitRegistro = texto(r.CUIT ?? r.cuit);
  const pvRegistro =
    puntoVentaCanonico(r.PTO_VTA ?? r.ptoVta ?? r.PtoVta) ||
    partesDeNumero(r.NumeroFactura ?? r.numeroFactura ?? id).puntoVenta;

  // 1. LA COLA con la que se facturó. Es el dato más fuerte: identifica al
  //    contribuyente aunque dos cuentas del local compartan punto de venta.
  const colaRegistro = texto(r.colaFacturacion ?? r.COLA_FACTURACION ?? r.cola);
  if (colaRegistro) {
    const porCola = lista.filter((c) => c.cola === colaRegistro);
    if (porCola.length === 1) return porCola[0];
  }

  if (cuitRegistro) {
    const porCuit = lista.filter((c) => c.cuit === cuitRegistro.replace(/\D/g, ''));
    if (porCuit.length === 1) return porCuit[0];
    const exacta = porCuit.find((c) => c.ptoVta === pvRegistro);
    if (exacta) return exacta;
  }

  if (pvRegistro) {
    const porPv = lista.filter((c) => c.ptoVta === pvRegistro);
    // Si dos cuentas comparten punto de venta no se adivina: sería atribuirle
    // el comprobante al CUIT equivocado.
    if (porPv.length === 1) return porPv[0];
  }

  return null;
}

/**
 * LETRA Y TIPO FISCAL DEL COMPROBANTE, por la cascada acordada.
 *
 * @returns {{
 *   cbteTipo: number|null, letra: string|null, nombre: string|null,
 *   origen: 'registro'|'cuenta-emisora'|'local-inferido'|'desconocido',
 *   inferido: boolean, cuenta: object|null
 * }}
 */
export function resolverTipoComprobante({ registro, id, config, cuentas = null }) {
  const lista = cuentas || listarCuentasFiscales(config);
  const cuenta = resolverCuentaEmisora({ registro, id, config, cuentas: lista });

  const conLetra = (cbteTipo, origen, inferido) => {
    const letra = LETRA_POR_CBTE_TIPO[cbteTipo] || null;
    return {
      cbteTipo: cbteTipo ?? null,
      letra,
      nombre: letra ? `Factura ${letra}` : null,
      origen,
      inferido,
      cuenta,
    };
  };

  // 1. El tipo fiscal que ARCA autorizó, guardado en el propio comprobante.
  const delRegistro = leerCbteTipoDelRegistro(registro);
  if (delRegistro) return conLetra(delRegistro, 'registro', false);

  // 2. La cuenta que lo emitió (punto de venta + CUIT), no el local entero.
  if (cuenta?.cbteTipo) return conLetra(cuenta.cbteTipo, 'cuenta-emisora', false);

  // 3. Último recurso: la condición fiscal ACTUAL del local. Queda marcado como
  //    inferido para que la pantalla pueda decirlo y nadie lo tome por dato firme.
  const porLocal = CBTE_TIPO_POR_CONDICION[config?.tipo];
  if (porLocal) return conLetra(porLocal, 'local-inferido', true);

  return conLetra(null, 'desconocido', true);
}

/**
 * Un renglón del comprobante, mire donde mire el formato con el que se guardó.
 *
 * `cantidadPresente` distingue la cantidad REAL guardada de la asumida en 1:
 * los comprobantes encolados por las versiones viejas guardaban sólo nombre y
 * precio, y esa diferencia tiene que poder informarse en vez de disimularse.
 */
export function normalizarArticulo(item) {
  if (!item || typeof item !== 'object') return null;

  const nombre = texto(primero(item.nombre, item.NOMBRE, item.name, item.descripcion, item.DESCRIPCION)) || 'Sin nombre';
  const cantidadCruda = primero(item.cantidad, item.CANTIDAD, item.quantity, item.cant);
  const cantidad = numero(cantidadCruda) ?? 1;

  const unitario = numero(primero(
    item.precioUnitario, item.PRECIO_UNITARIO, item.precio_unitario,
    item.precioBaseUnitario, item.valor, item.VALOR, item.precio, item.PRECIO,
  ));
  const opcionales = numero(primero(item.totalOpcionales, item.TOTAL_OPCIONALES)) ?? 0;
  const totalLinea = numero(primero(
    item.precioTotal, item.PRECIO_TOTAL, item.precio_total, item.subtotalLinea, item.subtotal, item.total, item.TOTAL,
  ));

  const salida = {
    nombre,
    cantidad,
    cantidadPresente: cantidadCruda !== null && cantidadCruda !== undefined,
    precioUnitario: unitario ?? (totalLinea !== null && cantidad ? totalLinea / cantidad : 0),
    precioTotal: totalLinea ?? ((unitario ?? 0) * cantidad + opcionales),
  };
  if (opcionales) salida.totalOpcionales = opcionales;
  if (item.selectedOptionals && Object.keys(item.selectedOptionals).length > 0) {
    salida.selectedOptionals = item.selectedOptionals;
  }
  const codigo = texto(primero(item.codigo, item.CODIGO, item.id));
  if (codigo) salida.codigo = codigo;
  if (numero(item.unidadIndice) !== null) salida.unidadIndice = numero(item.unidadIndice);
  if (numero(item.unidadTotal) !== null) salida.unidadTotal = numero(item.unidadTotal);
  return salida;
}

/**
 * Detalle del comprobante, leyendo TODAS las variantes históricas de la clave y
 * también los `producto_1`, `producto_2`… sueltos en la raíz del registro.
 *
 * @returns {{articulos: Array, clave: string|null}}
 */
export function normalizarArticulos(registro) {
  if (!registro || typeof registro !== 'object') return { articulos: [], clave: null };

  let clave = null;
  let crudo = null;
  for (const c of CLAVES_PRODUCTOS) {
    const v = registro[c];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'object') continue;
    const tieneAlgo = Array.isArray(v) ? v.some(Boolean) : Object.keys(v).length > 0;
    if (!tieneAlgo) continue;
    clave = c;
    crudo = v;
    break;
  }

  // Variante suelta: producto_1, producto_2… directamente en la raíz.
  if (!crudo) {
    const sueltas = Object.keys(registro)
      .filter((k) => /^producto_\d+$/i.test(k))
      .sort((a, b) => (Number(a.split('_')[1]) || 0) - (Number(b.split('_')[1]) || 0));
    if (sueltas.length > 0) {
      clave = 'producto_N';
      crudo = sueltas.map((k) => registro[k]);
    }
  }

  if (!crudo) return { articulos: [], clave: null };

  const lista = Array.isArray(crudo)
    ? crudo
    : Object.keys(crudo)
        .sort((a, b) => {
          const na = Number(String(a).replace(/\D/g, ''));
          const nb = Number(String(b).replace(/\D/g, ''));
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
          return String(a).localeCompare(String(b));
        })
        .map((k) => crudo[k]);

  return { articulos: lista.map(normalizarArticulo).filter(Boolean), clave };
}

/** 'dd-MM-yyyy' o 'dd/MM/yyyy' → 'yyyy-MM-dd'. null si no se reconoce. */
export function fechaISO(valor) {
  const s = String(valor ?? '').trim();
  let m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // AFIP devuelve el vencimiento del CAE como 'YYYYMMDD'.
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** 'YYYYMMDD' → 'dd/MM/yyyy', para mostrar el vencimiento del CAE. */
export function fechaLegible(valor) {
  const iso = fechaISO(valor);
  if (!iso) return texto(valor);
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * URL del QR OFICIAL de ARCA (RG 4291) reconstruida con los datos del propio
 * comprobante. NO es un QR interno del pedido.
 *
 * Devuelve null si falta cualquier dato obligatorio: antes que un QR con datos
 * inventados —que no validaría contra ARCA y sería peor que no tenerlo— no se
 * emite ninguno.
 */
export function construirQrArca({ cuit, ptoVta, cbteTipo, nroCmp, fecha, importe, cae, tipoDocRec = 99, nroDocRec = 0 }) {
  const cuitN = numero(String(cuit ?? '').replace(/\D/g, ''));
  const pv = numero(ptoVta);
  const nro = numero(nroCmp);
  const imp = numero(importe);
  const caeN = numero(cae);
  const f = fechaISO(fecha);
  if (!cuitN || !pv || !nro || !cbteTipo || !f || imp === null || !caeN) return null;

  const datos = {
    ver: 1,
    fecha: f,
    cuit: cuitN,
    ptoVta: pv,
    tipoCmp: cbteTipo,
    nroCmp: nro,
    importe: Number(imp.toFixed(2)),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec,
    nroDocRec,
    tipoCodAut: 'E',
    codAut: caeN,
  };
  // base64 ESTÁNDAR: ARCA no decodifica la variante url-safe (- _).
  // El módulo corre en el navegador (btoa) y en Node —las pruebas y el runtime—
  // (Buffer): se resuelve por globalThis para no depender de ninguno de los dos.
  const json = JSON.stringify(datos);
  const b64 = typeof globalThis.btoa === 'function'
    ? globalThis.btoa(unescape(encodeURIComponent(json)))
    : globalThis.Buffer.from(json, 'utf8').toString('base64');
  return { url: `https://www.arca.gob.ar/fe/qr/?p=${b64}`, datos };
}

/**
 * REGISTRO GUARDADO → COMPROBANTE LISTO PARA MOSTRAR E IMPRIMIR.
 *
 * Es la única traducción: la pantalla, la tabla y la reimpresión leen esto y no
 * vuelven a mirar los nombres de campo históricos.
 */
export function normalizarComprobante(id, registro, { config = null, cuentas = null } = {}) {
  const r = registro && typeof registro === 'object' ? registro : {};
  const lista = cuentas || listarCuentasFiscales(config);
  const tipo = resolverTipoComprobante({ registro: r, id, config, cuentas: lista });
  const emisor = tipo.cuenta;

  const { articulos, clave } = normalizarArticulos(r);
  const numeroFactura = texto(primero(r.NumeroFactura, r.numeroFactura, r.numeroComprobante)) || String(id);
  const partes = partesDeNumero(numeroFactura);
  const ptoVta = puntoVentaCanonico(primero(r.PTO_VTA, r.ptoVta, partes.puntoVenta));
  const nroCmp = numero(primero(r.NRO_CMP, r.nroCmp, partes.numero));

  const importe = numero(primero(r.total, r.TOTAL, r.IMPORTE, r.importe, r.NORMALIZADO?.TOTAL)) ?? 0;
  const fecha = texto(primero(r.FECHA, r.fecha));
  const cae = texto(primero(r.CAE, r.cae));
  const caeVto = texto(primero(r.VtoCAE, r.CAE_VTO, r.caeVto, r.CAEFchVto));

  // QR: si el motor lo guardó al emitir, ESE es el QR de la factura y se usa tal
  // cual. Sólo se reconstruye para los comprobantes viejos que no lo guardaron.
  const qrGuardado = texto(r.qrUrl);
  const qr = qrGuardado
    ? { url: qrGuardado, datos: r.qrData && typeof r.qrData === 'object' ? r.qrData : null }
    : construirQrArca({
        cuit: emisor?.cuit,
        ptoVta,
        cbteTipo: tipo.cbteTipo,
        nroCmp,
        fecha,
        importe,
        cae,
      });

  const sumaDetalle = articulos.reduce((s, a) => s + (Number(a.precioTotal) || 0), 0);

  return {
    id: String(id),
    numeroFactura,
    numeroCompleto: partes.completo || (ptoVta && nroCmp ? `${ptoVta}-${String(nroCmp).padStart(8, '0')}` : numeroFactura),
    puntoVenta: ptoVta,
    nroComprobante: nroCmp,

    // Tipo fiscal REAL (no el prefijo de la clave).
    cbteTipo: tipo.cbteTipo,
    letra: tipo.letra,
    tipoNombre: tipo.nombre,
    tipoOrigen: tipo.origen,
    tipoInferido: tipo.inferido,

    emisor: emisor
      ? {
          razonSocial: emisor.razonSocial,
          fantasia: emisor.fantasia,
          cuit: emisor.cuitFormat || emisor.cuit,
          cuitPlano: emisor.cuit,
          domicilio: emisor.domicilio,
          condIVA: emisor.condIVA,
          inicioActividades: emisor.inicioActividades,
          iibb: emisor.iibb,
          cola: emisor.cola,
        }
      : null,

    // Con QUÉ cuenta fiscal se emitió, y de qué venta salió.
    colaFacturacion: texto(primero(r.colaFacturacion, r.COLA_FACTURACION)),
    cuentaCobro: texto(r.cuentaCobro),
    origen: r.origen && typeof r.origen === 'object' ? r.origen : null,
    localId: texto(primero(r.localId, r.LOCAL_ID)),

    fecha,
    hora: texto(primero(r.HORA, r.hora)),
    cliente: { nombre: texto(primero(r.CLIENTE, r.cliente, r.clientes, r.NORMALIZADO?.CLIENTE)) || 'Consumidor Final' },
    direccion: texto(primero(r.DIRECCION, r.direccion, r.NORMALIZADO?.DIRECCION)),
    docTipoReceptor: numero(primero(r.DocTipo, r.docTipoReceptor)) ?? 99,
    docNroReceptor: numero(primero(r.DocNro, r.docNroReceptor)) ?? 0,
    condIVAReceptor: texto(primero(r.condIVAReceptor, r.COND_IVA_RECEPTOR)) || 'Consumidor Final',
    modo: texto(primero(r.MODO, r.modo, r.canal)),
    formaPago: texto(primero(r.formaPago, r.FORMA_PAGO, r.metodoPago)),

    importe,
    articulos,
    claveDetalle: clave,
    sumaDetalle,

    cae,
    caeVto,
    caeVtoLegible: caeVto ? fechaLegible(caeVto) : null,
    qrUrl: qr?.url || null,
    qrDatos: qr?.datos || null,

    // El PDF original de ARCA, si el runtime lo dejó en Firebase.
    pdfBase64: texto(r.PDF_BASE64),
    pdfArchivo: texto(r.PDF),

    esRemito: false,
  };
}

/**
 * DESGLOSE IMPOSITIVO, según el tipo real del comprobante y exactamente como se
 * declaró ante ARCA:
 *
 *   Factura C (11) — Régimen Simplificado: ImpNeto = total, ImpIVA = 0. El IVA
 *                    NO se discrimina.
 *   Factura B (6)  — ImpNeto = total / 1.21, ImpIVA = total − neto (alícuota 21%,
 *                    AlicIva Id 5). El IVA va incluido en el precio y no se
 *                    discrimina al consumidor final, pero el neto es el que se
 *                    informó.
 *
 * Si el registro guarda los importes que se enviaron (ImpNeto / ImpIVA), se usan
 * esos y se marca `origen: 'registro'`. Si no, se recalculan igual que lo hizo
 * el runtime al emitir, y se marca `origen: 'derivado'` para no presentar un
 * número reconstruido como si estuviera guardado.
 */
export function totalesImpositivos(c) {
  const total = numero(c?.importe) ?? 0;
  const netoGuardado = numero(primero(c?.impNeto, c?.ImpNeto));
  const ivaGuardado = numero(primero(c?.impIVA, c?.ImpIVA));

  if (netoGuardado !== null && ivaGuardado !== null) {
    return { total, neto: netoGuardado, iva: ivaGuardado, discrimina: ivaGuardado > 0, alicuota: null, origen: 'registro' };
  }

  if (c?.cbteTipo === CBTE_TIPO.FACTURA_C) {
    return { total, neto: total, iva: 0, discrimina: false, alicuota: null, origen: 'derivado' };
  }
  if (c?.cbteTipo === CBTE_TIPO.FACTURA_B || c?.cbteTipo === CBTE_TIPO.FACTURA_A) {
    const neto = Number((total / 1.21).toFixed(2));
    return { total, neto, iva: Number((total - neto).toFixed(2)), discrimina: true, alicuota: 21, origen: 'derivado' };
  }
  return { total, neto: null, iva: null, discrimina: false, alicuota: null, origen: 'desconocido' };
}

/**
 * ¿Este comprobante se puede reimprimir COMO FACTURA FISCAL?
 *
 * Una factura con total pero con la tabla de productos vacía NO es válida: se
 * informa el problema en vez de imprimir un documento incompleto que parezca
 * fiscal. Los `avisos` no bloquean, pero se muestran.
 *
 * @returns {{valido: boolean, problemas: string[], avisos: string[]}}
 */
export function validarComprobanteFiscal(c) {
  const problemas = [];
  const avisos = [];
  if (!c || typeof c !== 'object') return { valido: false, problemas: ['No hay comprobante.'], avisos };

  if (!c.articulos || c.articulos.length === 0) {
    problemas.push('El comprobante no tiene detalle de productos.');
  }
  if (!(Number(c.importe) > 0)) problemas.push('El comprobante no tiene un total válido.');
  if (!c.cae) problemas.push('El comprobante no tiene CAE.');
  if (!c.cbteTipo) problemas.push('No se pudo determinar el tipo de comprobante (Factura B o C).');
  if (!c.emisor || !c.emisor.cuit) problemas.push('No se pudo identificar la cuenta fiscal que emitió el comprobante.');
  if (!c.puntoVenta || !c.nroComprobante) problemas.push('El número de comprobante está incompleto.');

  if (!c.caeVto) avisos.push('El comprobante no tiene fecha de vencimiento del CAE.');
  if (!c.qrUrl) avisos.push('No se pudo reconstruir el QR oficial de ARCA con los datos guardados.');
  if (c.tipoInferido) avisos.push('El tipo de comprobante se infirió de la condición fiscal actual del local.');
  if (c.emisor && !c.emisor.inicioActividades) avisos.push('La cuenta fiscal no tiene cargado el inicio de actividades.');
  if (c.articulos?.length && c.articulos.every((a) => !a.cantidadPresente)) {
    avisos.push('El detalle guardado no incluye cantidades: se muestran como 1.');
  }
  if (c.articulos?.length && Number(c.importe) > 0 && Math.abs(c.sumaDetalle - Number(c.importe)) > 0.5) {
    avisos.push(`El detalle guardado suma ${c.sumaDetalle.toFixed(2)} y el total del comprobante es ${Number(c.importe).toFixed(2)}.`);
  }

  return { valido: problemas.length === 0, problemas, avisos };
}
