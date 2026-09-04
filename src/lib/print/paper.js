// ---------------------------------------------------------------------------
// MEDIDAS DEL ROLLO TÉRMICO.
//
// El ancho del papel vivía escrito a mano en el CSS de cada plantilla
// (`command.js`, `counterTicket.js`, `safeTicket.js`), tres veces el mismo
// `80mm`. Este módulo es la única fuente de esas medidas, para que agregar un
// ancho no signifique repetir el condicional en cada archivo.
//
// REGLA CENTRAL: 80 mm ES EL COMPORTAMIENTO ACTUAL Y NO CAMBIA.
//
// Para 80 mm los valores que devuelve son EXACTAMENTE los que ya estaban
// escritos en las plantillas (ancho 80mm, padding 3mm, escala 1). Cualquier
// ancho ausente, inválido o desconocido cae en 80: un local que nunca configuró
// nada imprime igual que antes, byte por byte.
//
// Módulo PURO: sin DOM, sin Firebase, sin imports. Se prueba con node:assert.
// ---------------------------------------------------------------------------

/** Anchos de rollo soportados, en milímetros. */
export const ANCHOS_SOPORTADOS = Object.freeze([80, 58]);

/** El ancho por defecto: el que usan hoy todos los locales. */
export const ANCHO_POR_DEFECTO = 80;

/**
 * Normaliza lo que venga de la configuración a un ancho soportado.
 *
 * Acepta número o string ("58", "58mm"). Todo lo demás —ausente, 0, basura, un
 * ancho que no soportamos— devuelve 80. Nunca lanza: un valor raro en
 * CONFIGURACION no puede dejar al local sin imprimir.
 */
export const normalizarAncho = (valor) => {
  const n = typeof valor === 'number' ? valor : parseInt(String(valor ?? '').trim(), 10);
  return ANCHOS_SOPORTADOS.includes(n) ? n : ANCHO_POR_DEFECTO;
};

/** ¿Es el rollo angosto? Atajo legible para las plantillas. */
export const esAngosto = (valor) => normalizarAncho(valor) === 58;

/**
 * Medidas de impresión para un ancho de rollo.
 *
 * @returns {{
 *   anchoMm: number,        ancho del rollo, para `@page size` y `body width`
 *   paddingMm: number,      margen interno del ticket
 *   escala: number,         factor tipográfico sobre el tamaño de fuente configurado
 *   escalaTitulo: number,   factor extra para cabeceras y TOTAL
 *   anchoQrPx: number,      lado del QR del ticket de mostrador
 *   columnas: number        caracteres por línea aproximados (texto plano/depuración)
 * }}
 *
 * De dónde salen los números de 58 mm: el ancho imprimible real de un rollo de
 * 58 mm es ~48 mm contra los ~72 mm de uno de 80 (48/72 ≈ 0,67). El padding baja
 * de 3 a 2 mm para no comerse otro milímetro por lado, y la tipografía se
 * reduce a 0,8 —no a 0,67— porque por debajo de eso la comanda deja de leerse
 * de un vistazo en la cocina, que es para lo que existe. La diferencia se
 * absorbe con el corte de línea, no achicando más la letra.
 */
export const medidasDePapel = (valor) => {
  const anchoMm = normalizarAncho(valor);
  if (anchoMm === 58) {
    return Object.freeze({
      anchoMm: 58,
      paddingMm: 2,
      escala: 0.8,
      escalaTitulo: 0.85,
      anchoQrPx: 96,
      columnas: 32,
    });
  }
  // 80 mm — los valores actuales, intactos.
  return Object.freeze({
    anchoMm: 80,
    paddingMm: 3,
    escala: 1,
    escalaTitulo: 1,
    anchoQrPx: 130,
    columnas: 44,
  });
};

/**
 * CSS EXTRA que se agrega SOLO en 58 mm. En 80 mm devuelve cadena vacía, así
 * que la hoja de estilos de 80 queda idéntica a la de siempre.
 *
 * Todo lo de acá resuelve un único problema: en 52 mm útiles, un nombre de
 * producto largo o una lista de sabores desborda y la impresora térmica lo
 * recorta sin avisar. `overflow-wrap: anywhere` corta dentro de la palabra
 * cuando no hay espacios donde cortar; `min-width: 0` es lo que permite que un
 * hijo de flex se encoja en vez de empujar al importe fuera del papel.
 */
export const cssExtraAngosto = (valor) => {
  if (!esAngosto(valor)) return '';
  return `
          /* --- 58 mm: nada se corta, todo baja de línea --- */
          body, td, p, div, span {
            overflow-wrap: anywhere;
            word-break: break-word;
          }
          .items-table { table-layout: fixed; }
          .items-table td { word-break: break-word; }
          /* En flex, un hijo sin min-width:0 no se encoge y empuja al importe
             fuera del rollo: el importe queda cortado o salta de renglón solo. */
          .opt-line, .ticket-total { min-width: 0; }
          .opt-line > *, .ticket-total > * { min-width: 0; }
          .opt-line > :first-child, .ticket-total > :first-child { flex: 1 1 auto; }
          .opt-amount { flex: 0 0 auto; }
          /* Dirección y observaciones: textos largos, sin cortes. */
          .client-address, .observation-text { overflow-wrap: anywhere; }`;
};
