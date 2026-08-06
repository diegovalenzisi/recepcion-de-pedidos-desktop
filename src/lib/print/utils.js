import { gruposDeOpcionales } from './comandaModelo.js';

/** Escapa el texto que va al HTML de la comanda (los nombres son datos). */
const escaparHtml = (v) =>
    String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * Opcionales de una línea → HTML de la comanda.
 *
 * El TÍTULO de cada grupo lo resuelve `gruposDeOpcionales` con la cascada
 * canónica: catálogo del local → título que trae el propio pedido → tipo o
 * departamento → "OPCIONALES" sólo como último recurso.
 *
 * ANTES esta función buscaba el id del grupo ÚNICAMENTE en el catálogo del
 * local y, si no lo encontraba, escribía "Opcionales" (que el CSS de la comanda
 * pasa a mayúsculas). Por eso los pedidos de DLV Pedidos —que guardan ids
 * compuestos por artículo, como "group-81A-1G", que no existen en el catálogo—
 * imprimían TODOS los grupos como "OPCIONALES", aunque el propio pedido traía
 * "SABORES" y "SALSAS" escritos en cada opción. Los pedidos cargados a mano
 * guardan el id real ("1G") y por eso salían bien.
 */
export const generateOptionalsHtml = (optionals, optionalGroups) => {
    const grupos = gruposDeOpcionales(optionals, optionalGroups);
    if (grupos.length === 0) return '';

    let html = '<div class="optionals-container">';
    for (const grupo of grupos) {
        html += `<div class="optional-group-name">${escaparHtml(grupo.nombreGrupo)}</div>`;
        for (const op of grupo.opciones) {
            if (!op.nombre) continue;
            const cant = op.cantidad > 1 ? ` (x${op.cantidad})` : '';
            html += `<div class="optional-item">${escaparHtml(op.nombre)}${cant}</div>`;
        }
    }
    html += '</div>';
    return html;
};
