// ---------------------------------------------------------------------------
// BLOQUEO DE PEDIDOS CON PRECIO DE OPCIONAL INVÁLIDO  (punto 11)
//
// El cálculo es defensivo: ante un precio ilegible devuelve el precio base para
// no producir NaN. Eso evita que la pantalla se rompa, pero NO puede permitir
// que el pedido avance: se estaría cobrando de menos y tratando un error como si
// fuera un opcional gratuito.
//
// Este módulo produce el bloqueo y el mensaje, y es el MISMO en las tres rutas
// reales de confirmación (Desktop, Tablet y DLV), así que los tres identifican
// producto, unidad, grupo, opcional y el valor inválido recibido.
//
// Reglas:
//   · precio 0 bien configurado  → NO bloquea y no se muestra "+$0";
//   · precio ilegible ("abc", "", objeto, negativo) → BLOQUEA;
//   · un histórico ya guardado no se ve afectado: esto corre solo al confirmar
//     un pedido nuevo o al guardar la edición de uno pendiente.
//
// Módulo puro. Idéntico en los tres repos.
// ---------------------------------------------------------------------------

import { precioOpcionalInvalido, listarOpcionalesSeleccionados } from './optionalsPricing.js';

const textoValor = (v) => {
  if (v === undefined) return '(sin valor)';
  if (v === null) return '(nulo)';
  if (typeof v === 'object') return '(no es un número)';
  const s = String(v);
  return s.trim() === '' ? '(vacío)' : s;
};

/** Valor crudo que hace inválido a un opcional, para poder mostrarlo. */
function valorCrudo(op) {
  if (op.precioUnitario !== undefined) return op.precioUnitario;
  if (op.precio !== undefined) return op.precio;
  return op.valor;
}

/**
 * Detecta TODOS los opcionales con precio inválido de un pedido, con el detalle
 * necesario para que el operador sepa exactamente qué corregir.
 *
 * @returns {Array<{articulo, unidadIndice, unidadTotal, grupo, opcional, valorInvalido, esHijoDePromo}>}
 */
export function detectarBloqueos(items) {
  const lista = Array.isArray(items) ? items : [];
  const salida = [];

  const recorrer = (contenedor, articulo, unidadIndice, unidadTotal, esHijoDePromo) => {
    const grupos = (contenedor && contenedor.selectedOptionals) || {};
    for (const [grupoId, ops] of Object.entries(grupos)) {
      if (!Array.isArray(ops)) continue;
      for (const op of ops) {
        if (!op || typeof op !== 'object') continue;
        if (!precioOpcionalInvalido(op)) continue;
        salida.push({
          articulo: articulo || '(sin nombre)',
          unidadIndice: Number.isFinite(Number(unidadIndice)) ? Number(unidadIndice) : null,
          unidadTotal: Number.isFinite(Number(unidadTotal)) ? Number(unidadTotal) : null,
          grupo: op.grupoNombre || op.groupName || grupoId,
          opcional: op.nombre || op.name || '(sin nombre)',
          valorInvalido: textoValor(valorCrudo(op)),
          esHijoDePromo: !!esHijoDePromo,
        });
      }
    }
  };

  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const nombre = item.nombre || item.name;
    recorrer(item, nombre, item.unidadIndice, item.unidadTotal, false);

    const hijos = item.promoItems || item.promoDetails;
    if (Array.isArray(hijos)) {
      for (const hijo of hijos) {
        recorrer(hijo, `${nombre} › ${hijo?.nombre || hijo?.name || 'ítem'}`, item.unidadIndice, item.unidadTotal, true);
      }
    }
  }
  return salida;
}

/** Una línea de mensaje por bloqueo, con producto, unidad, grupo, opcional y valor. */
export function describirBloqueo(b) {
  const unidad = (b.unidadTotal && b.unidadTotal > 1 && b.unidadIndice)
    ? ` (Unidad ${b.unidadIndice} de ${b.unidadTotal})`
    : '';
  return `${b.articulo}${unidad} › ${b.grupo} › ${b.opcional}: precio inválido "${b.valorInvalido}"`;
}

/**
 * Evalúa si el pedido puede confirmarse.
 * @returns {{ bloquear: boolean, motivos: Array, titulo: string, mensaje: string }}
 */
export function evaluarBloqueoPrecioInvalido(items) {
  const motivos = detectarBloqueos(items);
  if (motivos.length === 0) {
    return { bloquear: false, motivos: [], titulo: '', mensaje: '' };
  }
  return {
    bloquear: true,
    motivos,
    titulo: motivos.length === 1 ? 'Precio de opcional inválido' : `${motivos.length} opcionales con precio inválido`,
    mensaje: `No se puede confirmar el pedido. Revisá: ${motivos.map(describirBloqueo).join(' · ')}`,
  };
}
