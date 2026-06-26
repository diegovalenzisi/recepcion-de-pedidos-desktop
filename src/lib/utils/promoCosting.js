
const r3 = v => Math.round((Number(v) || 0) * 1000) / 1000;

/**
 * Calcula el costo unitario de un artículo según su tipo de stock:
 *   propio   → costoTotalReceta guardado en el artículo
 *   heredado → recurre al artículo padre
 *   receta   → suma cantidad × costoUnitario de cada materia prima
 *
 * @param {string}   articuloId
 * @param {number}   cantidad         unidades a calcular
 * @param {Array}    allArticles
 * @param {Array}    allRawMaterials
 * @param {number}   _depth           protección contra ciclos de herencia
 */
export const calcularCostoProducto = (articuloId, cantidad, allArticles, allRawMaterials, _depth = 0) => {
  const qty = Number(cantidad) || 1;

  if (_depth > 4) {
    console.warn(`[PROMO COSTO] warning=ciclo de herencia detectado id=${articuloId}`);
    return { productoId: articuloId, nombre: articuloId, cantidad: qty, tipoCosto: 'error_ciclo', costoUnitario: 0, costoTotal: 0 };
  }

  const articulo = (allArticles || []).find(a => a.id === articuloId);
  if (!articulo) {
    console.warn(`[PROMO COSTO] warning=artículo no encontrado id=${articuloId}`);
    return { productoId: articuloId, nombre: articuloId, cantidad: qty, tipoCosto: 'no_encontrado', costoUnitario: 0, costoTotal: 0 };
  }

  const stock = articulo.stock || {};
  const stockType = stock.stockType || 'propio';
  let costoUnitario = 0;
  let tipoCosto = 'stock_propio';

  if (stockType === 'receta' && stock.receta && typeof stock.receta === 'object') {
    costoUnitario = Object.entries(stock.receta).reduce((sum, [mpId, mpQty]) => {
      const mp = (allRawMaterials || []).find(m => m.id === mpId || m.codigo === mpId);
      const unitCost = Number(mp?.costoUnitario ?? 0);
      return sum + r3(unitCost * (parseFloat(mpQty) || 0));
    }, 0);
    costoUnitario = r3(costoUnitario);
    tipoCosto = 'receta';
  } else if (stockType === 'heredado' && stock.heredadoDe) {
    const padre = calcularCostoProducto(stock.heredadoDe, 1, allArticles, allRawMaterials, _depth + 1);
    costoUnitario = padre.costoUnitario;
    tipoCosto = 'heredado';
  } else {
    costoUnitario = r3(articulo.costoTotalReceta ?? 0);
    tipoCosto = 'stock_propio';
  }

  const costoTotal = r3(costoUnitario * qty);

  console.log(
    `[PROMO COSTO] producto=${articulo.nombre} cantidad=${qty} tipoCosto=${tipoCosto}` +
    ` costoUnitario=${costoUnitario} costoTotal=${costoTotal}`
  );

  return {
    productoId: articuloId,
    nombre: articulo.nombre,
    cantidad: qty,
    tipoCosto,
    costoUnitario,
    costoTotal,
  };
};

/**
 * Calcula el costo total estimado de una promo desde sus promoItems.
 *
 * Para ítems fijos → costo exacto.
 * Para grupos a elección → rango min/max basado en los artículos permitidos.
 *
 * Retorna:
 *   costoFijo      → suma exacta de ítems fijos
 *   costoMinimo    → costoFijo + mínimo posible de grupos
 *   costoMaximo    → costoFijo + máximo posible de grupos
 *   costoEstimado  → promedio de min/max (usado en costoTotalReceta para cálculo de ganancia)
 *   detalle        → Array con detalle por ítem
 *   tieneGrupos    → boolean
 */
export const calcularCostoPromo = (promoNombre, promoItems, allArticles, allRawMaterials, allProductGroups) => {
  console.log(`[PROMO COSTO] calculando promo=${promoNombre || '(sin nombre)'}`);

  if (!promoItems || promoItems.length === 0) {
    return { costoFijo: 0, costoMinimo: 0, costoMaximo: 0, costoEstimado: 0, detalle: [], tieneGrupos: false };
  }

  let costoFijo = 0;
  let costoMinGrupos = 0;
  let costoMaxGrupos = 0;
  const detalle = [];
  let tieneGrupos = false;

  for (const item of promoItems) {
    const cantidad = Number(item.cantidad) || 1;

    if (item.tipo === 'grupo') {
      tieneGrupos = true;

      const group = (allProductGroups || []).find(g => g.id === item.grupoId);
      const groupArticleIds = group?.articulos || [];
      const allowedIds = (item.permitidos && item.permitidos.length > 0) ? item.permitidos : groupArticleIds;

      // Cantidad a elegir: maxSeleccion si está definido, si no minSeleccion, si no cantidad
      const cantidadElegir = (item.maxSeleccion > 0)
        ? item.maxSeleccion
        : (item.minSeleccion > 0 ? item.minSeleccion : cantidad);

      const unitCosts = allowedIds
        .map(id => calcularCostoProducto(id, 1, allArticles, allRawMaterials).costoUnitario);

      if (unitCosts.length > 0) {
        const minU = Math.min(...unitCosts);
        const maxU = Math.max(...unitCosts);
        const minTotal = r3(minU * cantidadElegir);
        const maxTotal = r3(maxU * cantidadElegir);
        costoMinGrupos += minTotal;
        costoMaxGrupos += maxTotal;
        detalle.push({
          productoId: item.grupoId,
          nombre: item.nombre,
          cantidad: cantidadElegir,
          tipoCosto: 'grupo_eleccion',
          costoUnitarioMin: minU,
          costoUnitarioMax: maxU,
          costoTotalMin: minTotal,
          costoTotalMax: maxTotal,
        });
      } else {
        detalle.push({
          productoId: item.grupoId,
          nombre: item.nombre,
          cantidad: cantidadElegir,
          tipoCosto: 'grupo_eleccion',
          costoUnitarioMin: 0,
          costoUnitarioMax: 0,
          costoTotalMin: 0,
          costoTotalMax: 0,
        });
      }
    } else {
      const resultado = calcularCostoProducto(item.codigo, cantidad, allArticles, allRawMaterials);
      costoFijo = r3(costoFijo + resultado.costoTotal);
      detalle.push(resultado);
    }
  }

  const costoMinimo = r3(costoFijo + costoMinGrupos);
  const costoMaximo = r3(costoFijo + costoMaxGrupos);
  const costoEstimado = tieneGrupos ? r3((costoMinimo + costoMaximo) / 2) : costoFijo;

  console.log(
    `[PROMO COSTO] costoTotalPromo=${costoFijo} fijo=${costoFijo}` +
    ` min=${costoMinimo} max=${costoMaximo} estimado=${costoEstimado}`
  );

  return { costoFijo, costoMinimo, costoMaximo, costoEstimado, detalle, tieneGrupos };
};
