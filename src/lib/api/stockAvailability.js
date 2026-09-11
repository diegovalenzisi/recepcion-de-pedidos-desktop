/**
 * FUENTE ÚNICA DE VERDAD de "¿este artículo se puede vender AHORA?".
 *
 * `isArticleAvailable` es la ÚNICA función que responde esa pregunta, y la usan
 * por igual el catálogo de MOSTRADOR, el de DELIVERY y las promociones. Antes
 * había tres fórmulas distintas (el filtro del catálogo no miraba recetas, ésta
 * sí pero solo exigía "stock > 0" por ingrediente, y el módulo canónico —el
 * único correcto— no lo usaba ninguna pantalla). Ese desfasaje era el que dejaba
 * un artículo por receta visible en Mostrador después de desaparecer de Delivery.
 *
 *     disponible = activo del CANAL (manual)  &&  se puede producir 1 unidad
 *
 * La segunda mitad se delega SIEMPRE en `recetaConStockSuficiente`
 * (disponibilidadReceta.js, módulo canónico idéntico en Desktop, Tablet y DLV):
 * respeta las CANTIDADES reales de la receta, el anidamiento, la herencia,
 * `controlStock` e "Ignora Stock". Acá no se reimplementa nada de eso.
 *
 * El activo del canal (`activoDelivery` / `activoMostrador`) es una decisión
 * MANUAL del usuario: solo se LEE, nunca se escribe. Un artículo apagado a mano
 * no se muestra jamás; uno permitido se oculta o reaparece solo, en vivo, según
 * el stock.
 *
 * "Ignora Stock" (MATERIA_PRIMA/{id}/ignoraStock): se respeta la MISMA regla
 * canónica que usan Desktop, Tablet y DLV (materiaPrimaIgnoraStock, en
 * deliveryPorStock.js). Una materia prima marcada así no limita ni deja sin
 * disponibilidad a los artículos que la usan, aunque su stock sea 0 o negativo;
 * una desactivación manual (`activo === false`) sí la sigue limitando.
 */

// Con extensión .js: así el módulo se puede importar tal cual desde Node para
// las pruebas, además de por Vite.
import { materiaPrimaIgnoraStock, materiaPrimaDisponible } from './deliveryPorStock.js';
import {
    tipoDeStock,
    recetaConStockSuficiente,
    unidadesFabricables,
    evaluarRecetaPedido,
    materiasPrimasDeArticulo,
} from './disponibilidadReceta.js';

/** ¿El artículo está habilitado a mano en este canal? Solo lectura. */
const activoEnCanal = (nodo, context) => (
    context === 'delivery' ? nodo.activoDelivery !== false : nodo.activoMostrador !== false
);

/**
 * ¿Este artículo es SOLO PARA PROMOCIÓN — auxiliar interno que nunca se vende
 * suelto? Regla: permiteVentaEfectivo=false Y permiteVentaElectronica=false,
 * las DOS explícitamente en `false` (no "ausente": un artículo sin estos
 * campos nunca es auxiliar, es el comportamiento de siempre). No depende del
 * precio ($0 no es el criterio) ni de activo/activoDelivery/activoMostrador:
 * un auxiliar puede y debe seguir activo en ambos canales para que las
 * promos/grupos que lo usan sigan funcionando.
 *
 * ÚNICO uso correcto: excluirlo de un catálogo de venta INDIVIDUAL (Mostrador,
 * Delivery, DLV Pedidos). JAMÁS debe llamarse desde `isArticleAvailable` ni
 * `isPromoAvailable`: la disponibilidad de un artículo como COMPONENTE de una
 * promo o de un grupo de elección depende solo de
 * activo/activoDelivery/activoMostrador + stock/receta — nunca de estos dos
 * flags (ver guarda en articuloAuxiliarPromo.test.js).
 *
 * Caso real que motivó esto: local 57641732 (Viticos), artículo 23A ("1/4
 * promo", $0) — visible a mano en Mostrador/Delivery pese a tener ambos
 * medios de venta individual deshabilitados.
 */
export const esArticuloSoloParaPromocion = (articulo) => (
    !!articulo && articulo.permiteVentaEfectivo === false && articulo.permiteVentaElectronica === false
);

/**
 * ¿La receta del artículo tiene una referencia circular (A usa B, B usa A,
 * directa o transitivamente)?
 *
 * Un ciclo NO es un faltante de stock: es una receta mal cargada, y no se puede
 * saber cuánto consume. El módulo canónico lo corta para no colgarse y lo deja
 * anotado como aviso `ciclo` sin bloquear. Acá se decide que SÍ bloquee: un
 * artículo que no se puede calcular no se puede producir, así que no se ofrece
 * ni se vende hasta que alguien corrija la receta.
 */
export const recetaTieneCiclo = (articleId, articulos = {}, materiaPrima = {}) => (
    evaluarRecetaPedido(articleId, 1, articulos, materiaPrima)
        .avisos.some((a) => a && a.tipo === 'ciclo')
);

/**
 * Marca que se guarda en `materiasPrimasBloqueantes` cuando lo que bloquea no es
 * una materia prima sino una receta circular. Se limpia sola en cuanto la receta
 * se corrige, igual que cualquier otro bloqueante.
 */
export const BLOQUEO_RECETA_CIRCULAR = '__RECETA_CIRCULAR__';

/**
 * ¿Se puede vender este artículo AHORA en este canal? Ver el encabezado: es la
 * única regla, compartida por Mostrador, Delivery y promociones.
 *
 * @param {string} articleId       ID canónico (clave real de Firebase)
 * @param {object} articlesData    catálogo del local, { [id]: articulo }
 * @param {object} materiaPrimaData materias primas del local, { [id]: mp }
 * @param {'delivery'|'counter'} context  canal cuyo activo manual se respeta
 */
export const isArticleAvailable = (articleId, articlesData = {}, materiaPrimaData = {}, context = 'delivery', visited = new Set()) => {
    if (!articleId || visited.has(articleId)) return false;
    visited.add(articleId);

    const article = articlesData[articleId];
    if (article) {
        if (!activoEnCanal(article, context)) return false;

        // Stock legado guardado como número suelto (ARTICULOS/{id}/stock = 5),
        // sin el objeto { stockType, ... }. Se conserva tal cual funcionaba.
        const stock = article.stock;
        if (typeof stock === 'number' || typeof stock === 'string') {
            return article.controlStock === false ? true : Number(stock || 0) > 0;
        }

        const stockType = tipoDeStock(stock);

        // OJO: `controlStock === false` NO se consulta acá arriba. En un artículo
        // por RECETA ese interruptor no significa "ilimitado", sino que el
        // artículo no lleva cuenta propia de unidades porque su stock vive en la
        // materia prima — la configuración normal de un elaborado. Tenerlo antes
        // de la receta es lo que dejaba a "1 BOCHA" y "2 BOCHAS" (Bynnon)
        // vendiéndose con VASITO DE PASTA en cero, mientras el sistema igual les
        // descontaba la materia prima. Se consulta más abajo, en la rama propio.

        if (stockType === 'heredado' && stock.heredadoDe) {
            // El padre aporta su stock Y su activo manual del mismo canal.
            return isArticleAvailable(stock.heredadoDe, articlesData, materiaPrimaData, context, visited);
        }

        if (stockType === 'receta') {
            // EXACTAMENTE la misma cuenta que usa la automatización que apaga
            // `activoDelivery`: materia prima agotada, apagada A MANO, o que no
            // alcanza para una unidad, más la receta circular. Llamar a la misma
            // función es lo que garantiza que Mostrador y Delivery no puedan
            // volver a contestar distinto.
            //
            // Sin esto quedaba un hueco real (visto en Bynnon): la materia prima
            // "VASITO DE PASTA" tiene `activo: false`, y `activo` no lo mira
            // ningún cálculo de stock. Con el stock repuesto pero el activo
            // todavía apagado, Mostrador la habría mostrado y Delivery no.
            if (materiasPrimasBloqueantes(articleId, articlesData, materiaPrimaData).length > 0) return false;

            // Y además el resto de la receta: ingredientes que son ARTÍCULOS con
            // stock propio, que no figuran en el mapa de materias primas.
            return recetaConStockSuficiente(articleId, articlesData, materiaPrimaData, 1);
        }

        // 'ninguno': el artículo no tiene ninguna configuración de stock, así que
        // no hay nada que lo limite (es lo mismo que decide el plan de descuento
        // en stockPlan.js, que no le descuenta nada). No se oculta.
        if (stockType === 'ninguno') return true;

        // Stock PROPIO: la única cuenta que `controlStock === false` apaga.
        if (article.controlStock === false) return true;
        return Number(stock?.propio || 0) > 0;
    }

    const rawMaterial = materiaPrimaData[articleId];
    if (rawMaterial) {
        if (rawMaterial.controlStock === false) return true;
        if (materiaPrimaIgnoraStock(rawMaterial)) return true; // "Ignora Stock"
        if (rawMaterial.heredadoDe) {
            return isArticleAvailable(rawMaterial.heredadoDe, articlesData, materiaPrimaData, context, visited);
        }
        return Number(rawMaterial.stock || 0) > 0;
    }

    return false;
};

/**
 * Materias primas que HOY bloquean a un artículo, por cualquiera de los dos
 * motivos posibles. La usa la automatización que apaga `activoDelivery`
 * (stockDeliveryAutomation.js) para armar `materiasPrimasBloqueantes`.
 *
 *  1. NO DISPONIBLE — `materiaPrimaDisponible`: agotada (stock <= 0) o apagada
 *     A MANO por el usuario. Apagar una materia prima a mano sigue sacando de
 *     delivery a los artículos que la usan, aunque le quede stock.
 *  2. NO ALCANZA PARA UNA UNIDAD — `evaluarRecetaPedido(id, 1, …)`: tiene
 *     stock, pero menos del que consume la receta. Si la receta pide 5 vasitos
 *     y hay 4, el motivo 1 daba "disponible" (4 > 0) y el artículo seguía
 *     publicado. Ésta es la mitad que faltaba.
 *
 * Solo se devuelven ids de MATERIA_PRIMA: `materiasPrimasBloqueantes` es un
 * mapa de materias primas, y es por materia prima que se dispara la
 * reconciliación. Un artículo con stock propio usado como ingrediente lo cubre
 * el cálculo en vivo del catálogo (`isArticleAvailable`).
 *
 * @returns {string[]} ids de materia prima que bloquean, sin repetir.
 */
export const materiasPrimasBloqueantes = (articuloId, articulos = {}, materiaPrima = {}) => {
    const bloqueantes = [];
    const agregar = (id) => { if (id && !bloqueantes.includes(id)) bloqueantes.push(id); };

    for (const mpId of materiasPrimasDeArticulo(articuloId, articulos, materiaPrima)) {
        if (!materiaPrimaDisponible(materiaPrima[mpId])) agregar(mpId);
    }

    const { faltantes, avisos } = evaluarRecetaPedido(articuloId, 1, articulos, materiaPrima);
    for (const f of faltantes) {
        if (materiaPrima[f.materiaPrimaId]) agregar(f.materiaPrimaId);
    }

    // 3. RECETA CIRCULAR: no hay materia prima a la que culpar, pero el artículo
    //    tampoco se puede producir. Se marca con un bloqueante sentinela para
    //    que también salga de delivery, y se limpia solo al corregir la receta.
    if (avisos.some((a) => a && a.tipo === 'ciclo')) agregar(BLOQUEO_RECETA_CIRCULAR);

    return bloqueantes;
};

/**
 * Returns the list of article ids that can be chosen for a promo group item:
 * the explicit `permitidos` list if set, otherwise all articles of the group.
 */
export const getGroupOptionIds = (promoItem, productGroups = []) => {
    const group = (productGroups || []).find(g => g.id === promoItem.grupoId);
    const groupArticleIds = group?.articulos || [];
    return (promoItem.permitidos && promoItem.permitidos.length > 0) ? promoItem.permitidos : groupArticleIds;
};

/**
 * Opciones que se le pueden OFRECER al operador para un ítem de grupo de una
 * promoción: las del grupo (o su lista `permitidos`) que además estén
 * disponibles AHORA en el canal actual.
 *
 * `idsDisponibles` viene del catálogo ya verificado por `useStockVerification`
 * —la misma lista que alimenta la grilla—, así que lo que se puede elegir
 * dentro de una promo es exactamente lo que se puede elegir fuera de ella. No
 * se reimplementa ninguna regla de stock acá.
 *
 * Si `idsDisponibles` viene vacío se devuelven todas las opciones SIN filtrar:
 * el catálogo verificado todavía no cargó, y "no sé nada" no es lo mismo que
 * "no hay nada" — filtrar ahí cancelaría la promo por error.
 *
 * @param {object} promoItem       ítem de promo con `grupoId` y opcional `permitidos`
 * @param {Array}  productGroups   grupos de productos del local
 * @param {Array}  articulos       catálogo completo (para resolver id → artículo)
 * @param {Set<string>} idsDisponibles ids que hoy se pueden vender en este canal
 * @returns {Array<object>} artículos ofrecibles, en el orden del grupo
 */
export const opcionesDisponiblesDeGrupo = (promoItem, productGroups = [], articulos = [], idsDisponibles = new Set()) => {
    const permitidos = getGroupOptionIds(promoItem, productGroups);
    const opciones = permitidos
        .map((id) => (articulos || []).find((a) => a && a.id === id))
        .filter(Boolean);

    if (!idsDisponibles || idsDisponibles.size === 0) return opciones;
    return opciones.filter((o) => idsDisponibles.has(o.id));
};

/**
 * Determines whether a promotion is sellable based on the real availability
 * of its components: every fixed item must be available, and for each group
 * item at least one of its allowed options must be available.
 */
export const isPromoAvailable = (promoArticle, articlesData = {}, materiaPrimaData = {}, productGroups = [], context = 'delivery') => {
    const promoItems = promoArticle.promoItems || promoArticle.promoDetails || [];
    if (promoItems.length === 0) return true;

    for (const pItem of promoItems) {
        if (pItem.tipo === 'grupo') {
            const optionIds = getGroupOptionIds(pItem, productGroups);
            if (optionIds.length === 0) continue;
            const availableOptions = optionIds.filter(id => isArticleAvailable(id, articlesData, materiaPrimaData, context));
            // Si hay minSeleccion configurado, necesitamos al menos ese número de opciones disponibles
            const minRequired = (pItem.minSeleccion > 0) ? pItem.minSeleccion : 1;
            if (availableOptions.length < minRequired) return false;
        } else {
            const targetId = pItem.codigo || pItem.id;
            if (!targetId) continue;
            if (!isArticleAvailable(targetId, articlesData, materiaPrimaData, context)) return false;
        }
    }

    return true;
};

/**
 * Calcula cuántas unidades reales de `articleId` pueden fabricarse/venderse, siguiendo la
 * misma resolución conceptual de cadenas propio/heredado/receta que usa `resolveStockImpact`
 * (transactionsApi.js) para DESCONTAR stock — pero sin modificar ni descontar nada, solo lee.
 *
 * Es la única fuente de verdad para "cuánto stock disponible tiene un artículo", usada tanto
 * por la pantalla de Stock (DataTable) como por el cálculo de disponibilidad de promociones
 * (usePromotionMinimumStock). La activación/desactivación automática de delivery sigue usando
 * `isArticleAvailable`/`isPromoAvailable` (booleano, con gating por activoDelivery/activoMostrador),
 * que es un caso de uso distinto (¿se puede vender ahora?) y no una cantidad.
 *
 * DELEGA en `unidadesFabricables` (disponibilidadReceta.js, módulo canónico idéntico en
 * Desktop, Tablet y DLV). Antes esta función reimplementaba la MISMA resolución línea por
 * línea; eran dos copias de la misma fórmula que había que mantener sincronizadas a mano.
 * Se conserva el nombre y la firma porque son la API que ya consumen DataTable,
 * managementApi y usePromotionMinimumStock.
 *
 * Reglas (las implementa el módulo canónico):
 * - `controlStock === false` (artículo o materia prima) → Infinity (no limita, "ilimitado").
 * - stock propio → el número de `stock.propio` (nunca negativo, nunca NaN).
 * - stock heredado → la disponibilidad del padre (misma unidad, sin dividir).
 * - stock por receta → para cada ingrediente (materia prima u OTRO artículo, incluso anidado):
 *     ratio_ingrediente = disponibilidad(ingrediente) / cantidadRequerida
 *   Se toma el MÍNIMO de todos los ratios SIN redondear cada uno individualmente, y recién al
 *   final se aplica UN SOLO Math.floor sobre ese mínimo. Así "10 kg disponibles / 0.5 kg por
 *   unidad" da exactamente 20, sin perder unidades por redondeos intermedios.
 * - Materia prima (hoja, sin receta propia) → su stock numérico tal cual (SIN redondear: es una
 *   cantidad continua en su propia unidad —kg, litros—, no "unidades fabricables"; el redondeo
 *   final lo aplica quien la consume como ingrediente de una receta).
 * - Referencia inexistente (ni en ARTICULOS ni en MATERIA_PRIMA) → 0 (valor seguro que limita).
 * - Ciclo (A hereda/receta-usa B, B hereda/receta-usa A, directa o transitivamente) → 0. Se
 *   detecta con un set de IDs visitados POR RAMA (no global): permite que dos ingredientes
 *   distintos de una misma receta compartan una materia prima sin falsos positivos, pero corta
 *   cualquier referencia circular real antes de colgar la aplicación.
 *
 * @returns {number} unidades disponibles (entero, resultado de un único Math.floor final para
 *   artículos por receta) o `Infinity` si no hay control de stock. Nunca NaN, nunca negativo.
 */
export const getAvailableUnits = (articleId, articlesData = {}, materiaPrimaData = {}, visited = new Set()) => (
    unidadesFabricables(articleId, articlesData, materiaPrimaData, visited)
);
