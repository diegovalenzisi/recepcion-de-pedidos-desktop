import { getDatabase, ref, get, update, runTransaction } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { aplicarReglaMateriaPrimaANodo, reconciliarArticuloDeliveryANodo } from './deliveryPorStock';
import { materiasPrimasDeArticulo } from './disponibilidadReceta';
import { materiasPrimasBloqueantes, recetaTieneCiclo } from './stockAvailability';

/**
 * Stock Delivery Automation Module
 * Automatically manages delivery channel availability based on stock levels
 * Applies to articles with own stock and their inherited children
 */

export const shouldAutoToggleDelivery = (article) => {
  if (!article) return false;
  
  const hasOwnStock = article.stock?.stockType === 'propio' || 
                      (article.stock?.propio !== undefined && article.stock?.propio !== null);
  
  const hasInheritedStock = article.stock?.stockType === 'heredado' || article.stock?.heredadoDe;
  
  return hasOwnStock || hasInheritedStock;
};

/**
 * Validates and updates the delivery status of all articles that inherit stock
 * from the specified parent article. Uses recursion to handle multi-level inheritance.
 * @param {string} parentId - Parent Article ID
 * @param {number} parentStockValue - The new stock value of the parent
 */
export const validateInheritedStockStatus = async (parentId, parentStockValue) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  try {
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    const snapshot = await get(articlesRef);
    
    if (!snapshot.exists()) return;
    
    const articlesData = snapshot.val();
    const updates = {};
    const isDepleted = parentStockValue === 0;
    const timestamp = Date.now();
    const visited = new Set();
    
    const traverse = (currentParentId, isParentDepleted) => {
      for (const [articleId, article] of Object.entries(articlesData)) {
        const isInherited = (article.stock?.stockType === 'heredado' && article.stock?.heredadoDe === currentParentId) ||
                            (article.stock?.heredadoDe === currentParentId);
        
        if (isInherited && !visited.has(articleId)) {
          visited.add(articleId);
          
          if (isParentDepleted) {
            const isCurrentlyActive = article.activoDelivery !== false;
            if (isCurrentlyActive) {
              // Parent depleted -> disable child delivery and save state
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/activoDelivery`] = false;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = true;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/lastAutoToggle`] = timestamp;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/autoToggleReason`] = 'cascade_stock_depleted';
              console.log(`[Stock Automation] Disabled delivery for inherited child ${articleId} (parent ${currentParentId} depleted). Saving hadDeliveryEnabled=true.`);
            } else if (article.hadDeliveryEnabled !== false) {
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = false;
            }
          } else {
            // Parent replenished -> enable child delivery ONLY if it was previously active
            console.log(`[Stock Automation] Evaluating inherited child ${articleId} for replenishment. hadDeliveryEnabled=${article.hadDeliveryEnabled}`);
            if (article.hadDeliveryEnabled === true) {
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/activoDelivery`] = true;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = false;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/lastAutoToggle`] = timestamp;
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/autoToggleReason`] = 'cascade_stock_replenished';
              console.log(`[Stock Automation] Restored delivery for inherited child ${articleId} (parent ${currentParentId} replenished)`);
            } else if (article.hadDeliveryEnabled !== false) {
              updates[`${LOCAL_ID}/ARTICULOS/${articleId}/hadDeliveryEnabled`] = false;
            }
          }
          
          // Recursively traverse children of this child
          traverse(articleId, isParentDepleted);
        }
      }
    };
    
    traverse(parentId, isDepleted);
    
    if (Object.keys(updates).length > 0) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      await update(ref(op.getDatabaseOrAbort()), updates);
      console.log(`[Stock Automation] Applied ${Object.keys(updates).length} cascade updates for parent ${parentId}`);
    }
  } catch (error) {
    console.error(`[Stock Automation] Error validating inherited stock for parent ${parentId}:`, error);
  }
};

export const handleStockDepletion = async (articleId, currentStock, previousStock, isOwnStock) => {
  console.log(`[Stock Automation] handleStockDepletion triggered for ${articleId}. Stock: ${previousStock} -> ${currentStock}.`);
  // Always validate inherited children first if this article is a parent
  await validateInheritedStockStatus(articleId, currentStock);

  if (!isOwnStock) return;
  if (currentStock !== 0 || previousStock <= 0) return;

  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  try {
    const articleRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}`);
    const snapshot = await get(articleRef);

    if (!snapshot.exists()) {
      console.warn(`[Stock Automation] Article ${articleId} not found`);
      return;
    }

    const articleData = snapshot.val();
    const isCurrentlyActive = articleData.activoDelivery !== false;
    const updates = {};

    if (isCurrentlyActive) {
      updates.hadDeliveryEnabled = true;
      updates.activoDelivery = false;
      updates.lastAutoToggle = Date.now();
      updates.autoToggleReason = 'stock_depleted';
      console.log(`[Stock Automation] Disabled delivery for ${articleId} (stock depleted). Saving hadDeliveryEnabled=true.`);
      console.log(`[DELIVERY AUTO STOCK] articulo=${articleId} stock=${currentStock} estadoAnterior=true desactivadoPorStock=true restaurado=false`);
    } else if (articleData.hadDeliveryEnabled !== false) {
      updates.hadDeliveryEnabled = false;
    }

    if (Object.keys(updates).length > 0) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      const freshArticleRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/ARTICULOS/${articleId}`);
      await update(freshArticleRef, updates);
    }
  } catch (error) {
    console.error(`[Stock Automation] Error handling depletion for ${articleId}:`, error);
    throw error;
  }
};

export const handleStockReplenishment = async (articleId, currentStock, previousStock, isOwnStock) => {
  console.log(`[Stock Automation] handleStockReplenishment triggered for ${articleId}. Stock: ${previousStock} -> ${currentStock}.`);
  // Always validate inherited children first if this article is a parent
  await validateInheritedStockStatus(articleId, currentStock);

  if (!isOwnStock) return;
  if (previousStock !== 0 || currentStock <= 0) return;

  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  try {
    const articleRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}`);
    const snapshot = await get(articleRef);

    if (!snapshot.exists()) {
      console.warn(`[Stock Automation] Article ${articleId} not found`);
      return;
    }

    const articleData = snapshot.val();
    const updates = {};

    console.log(`[Stock Automation] Evaluating ${articleId} for replenishment: hadDeliveryEnabled=${articleData.hadDeliveryEnabled}`);

    if (articleData.hadDeliveryEnabled === true) {
      updates.hadDeliveryEnabled = false;
      updates.activoDelivery = true;
      updates.lastAutoToggle = Date.now();
      updates.autoToggleReason = 'stock_replenished';
      console.log(`[Stock Automation] Restored delivery for ${articleId} (stock replenished). Resetting hadDeliveryEnabled=false.`);
      console.log(`[DELIVERY AUTO STOCK] articulo=${articleId} stock=${currentStock} estadoAnterior=true desactivadoPorStock=false restaurado=true`);
    } else if (articleData.hadDeliveryEnabled !== false) {
      updates.hadDeliveryEnabled = false;
    }

    if (Object.keys(updates).length > 0) {
      // Revalida antes del update() definitivo: el get() de arriba fue un await real.
      const freshArticleRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/ARTICULOS/${articleId}`);
      await update(freshArticleRef, updates);
    }
  } catch (error) {
    console.error(`[Stock Automation] Error handling replenishment for ${articleId}:`, error);
    throw error;
  }
};

export const fetchAffectedArticles = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    const snapshot = await get(articlesRef);
    
    if (!snapshot.exists()) return [];
    
    const articlesData = snapshot.val();
    const affectedArticles = [];
    
    for (const [articleId, articleData] of Object.entries(articlesData)) {
      if (articleData.hadDeliveryEnabled === true && shouldAutoToggleDelivery(articleData)) {
        affectedArticles.push({
          id: articleId,
          codigo: articleId,
          nombre: articleData.nombre,
          stock: articleData.stock?.propio !== undefined ? articleData.stock.propio : 0,
          activoDelivery: articleData.activoDelivery,
          hadDeliveryEnabled: articleData.hadDeliveryEnabled,
          lastAutoToggle: articleData.lastAutoToggle,
          autoToggleReason: articleData.autoToggleReason,
          departamento: articleData.departamento
        });
      }
    }
    
    return affectedArticles.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  } catch (error) {
    console.error('[Stock Automation] Error fetching affected articles:', error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// APAGADO AUTOMÁTICO POR FALTA DE STOCK DE MATERIA PRIMA
//
// stock <= 0  →  MATERIA_PRIMA/{id}/activo = false  +  cada ARTÍCULO que la usa
//               en su receta →  activoDelivery = false (recordando su estado).
// stock > 0   →  restaura MP y artículos si el apagado fue automático.
//
// Cada decisión se computa desde el estado propio del nodo (regla canónica pura)
// dentro de runTransaction, así dos PCs/Tablets convergen y reprocesar no reactiva
// de más. NUNCA se toca ARTICULOS/{id}/activo ni MATERIA_PRIMA/{id}/activoDelivery.
// Identidad SIEMPRE por ID canónico (clave real), nunca por nombre.
// ---------------------------------------------------------------------------

/**
 * Reconcilia el `activoDelivery` de UN artículo según la disponibilidad ACTUAL
 * de las materias primas de su receta (leídas del snapshot provisto).
 *
 * Qué bloquea y por qué lo decide `materiasPrimasBloqueantes`
 * (stockAvailability.js): contempla tanto la materia prima agotada o apagada a
 * mano como la que tiene stock pero MENOS del que la receta consume — el caso
 * "la receta pide 5 y hay 4", que antes no se detectaba y dejaba el artículo
 * publicado en delivery.
 */
const reconciliarArticuloPorMaterias = async (db, LOCAL_ID, articuloId, articulos, materiaPrima) => {
  const bloqueantes = materiasPrimasBloqueantes(articuloId, articulos, materiaPrima);
  const artRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articuloId}`);
  let ultimoPatch = {};
  await runTransaction(artRef, (nodo) => {
    if (nodo === null || nodo === undefined || typeof nodo !== 'object') return nodo;
    const { nodo: nuevo, patch } = reconciliarArticuloDeliveryANodo(nodo, bloqueantes);
    ultimoPatch = patch;
    return Object.keys(patch).length > 0 ? nuevo : undefined;
  });
  if (Object.keys(ultimoPatch).length > 0) {
    console.log(`[MP DELIVERY] artículo ${articuloId} reconciliado (bloqueantes: ${bloqueantes.join(',') || 'ninguna'})`, ultimoPatch);
  }
  return Object.keys(ultimoPatch).length > 0;
};

/**
 * Reconcilia UNA materia prima (activo por stock) y CASCADEA a todos los
 * artículos que la usan en su receta (activoDelivery). Idempotente.
 * @param {string} materiaPrimaId  ID canónico (p.ej. "11M")
 */
export const reconciliarMateriaPrima = async (materiaPrimaId) => {
  if (!materiaPrimaId) return { cambio: false };
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  try {
    // 1) MATERIA_PRIMA/{id}/activo según su stock.
    const mpRef = ref(db, `${LOCAL_ID}/MATERIA_PRIMA/${materiaPrimaId}`);
    let patchMP = {};
    await runTransaction(mpRef, (nodo) => {
      if (nodo === null || nodo === undefined || typeof nodo !== 'object') return nodo;
      const { nodo: nuevo, patch } = aplicarReglaMateriaPrimaANodo(nodo);
      patchMP = patch;
      return Object.keys(patch).length > 0 ? nuevo : undefined;
    });
    if (Object.keys(patchMP).length > 0) console.log(`[MP DELIVERY] materia prima ${materiaPrimaId} → activo`, patchMP);

    // 2) Cascada a los artículos que usan esta materia prima (snapshot fresco).
    const [artSnap, mpSnap] = await Promise.all([
      get(ref(db, `${LOCAL_ID}/ARTICULOS`)),
      get(ref(db, `${LOCAL_ID}/MATERIA_PRIMA`)),
    ]);
    const articulos = artSnap.val() || {};
    const materiaPrima = mpSnap.val() || {};

    let cambiados = 0;
    for (const artId of Object.keys(articulos)) {
      const usadas = materiasPrimasDeArticulo(artId, articulos, materiaPrima);
      if (!usadas.has(materiaPrimaId)) continue; // solo los que usan esta MP
      const cambio = await reconciliarArticuloPorMaterias(db, LOCAL_ID, artId, articulos, materiaPrima);
      if (cambio) cambiados += 1;
    }
    return { cambio: Object.keys(patchMP).length > 0 || cambiados > 0, articulosCambiados: cambiados };
  } catch (error) {
    console.error(`[MP DELIVERY] Error reconciliando materia prima ${materiaPrimaId}:`, error);
    return { cambio: false };
  }
};

/**
 * Reconciliación completa del local actual (arranque / cambio de local /
 * datos existentes): pone activo=false a las materias primas agotadas y apaga
 * el activoDelivery de los artículos afectados; restaura lo que corresponda.
 * Solo el local actual. No afecta otros locales.
 * @returns {Promise<{ materiasCambiadas: number, articulosCambiados: number }>}
 */
export const reconciliarTodasLasMateriasPrimas = async () => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const op = beginFirebaseOperation();
  const db = op.getDatabaseOrAbort();

  let materiasCambiadas = 0;
  let articulosCambiados = 0;
  try {
    // 1) Pasada de materias primas: activo según stock.
    const mpSnap0 = await get(ref(db, `${LOCAL_ID}/MATERIA_PRIMA`));
    if (mpSnap0.exists()) {
      const mp0 = mpSnap0.val() || {};
      for (const id of Object.keys(mp0)) {
        const { patch } = aplicarReglaMateriaPrimaANodo(mp0[id] || {});
        if (Object.keys(patch).length === 0) continue;
        const mpRef = ref(db, `${LOCAL_ID}/MATERIA_PRIMA/${id}`);
        let cambio = false;
        await runTransaction(mpRef, (nodo) => {
          if (nodo === null || nodo === undefined || typeof nodo !== 'object') return nodo;
          const r = aplicarReglaMateriaPrimaANodo(nodo);
          cambio = r.cambio;
          return r.cambio ? r.nodo : undefined;
        });
        if (cambio) materiasCambiadas += 1;
      }
    }

    // 2) Pasada de artículos: activoDelivery según materias bloqueantes (snapshot ya actualizado).
    const [artSnap, mpSnap] = await Promise.all([
      get(ref(db, `${LOCAL_ID}/ARTICULOS`)),
      get(ref(db, `${LOCAL_ID}/MATERIA_PRIMA`)),
    ]);
    const articulos = artSnap.val() || {};
    const materiaPrima = mpSnap.val() || {};
    for (const artId of Object.keys(articulos)) {
      const usadas = materiasPrimasDeArticulo(artId, articulos, materiaPrima);
      // Sin receta con materias primas no aplica... salvo que la receta sea
      // CIRCULAR: ahí no se resuelve ninguna materia prima justamente porque el
      // recorrido se corta, y el artículo igual tiene que salir de delivery.
      // Ésta es la única pasada que puede detectarlo (un ciclo no se dispara por
      // el cambio de stock de ninguna materia prima).
      if (usadas.size === 0 && !recetaTieneCiclo(artId, articulos, materiaPrima)) continue;
      const cambio = await reconciliarArticuloPorMaterias(db, LOCAL_ID, artId, articulos, materiaPrima);
      if (cambio) articulosCambiados += 1;
    }

    if (materiasCambiadas > 0 || articulosCambiados > 0) {
      console.log(`[MP DELIVERY] Reconciliación inicial: ${materiasCambiadas} materias primas y ${articulosCambiados} artículos ajustados.`);
    }
    return { materiasCambiadas, articulosCambiados };
  } catch (error) {
    console.error('[MP DELIVERY] Error en reconciliación total:', error);
    return { materiasCambiadas, articulosCambiados };
  }
};

export const manualOverrideDelivery = async (articleId, newDeliveryStatus) => {
  checkLocalId();
  const LOCAL_ID = getCurrentDatabasePath();
  const db = getDatabase();
  
  try {
    const articleRef = ref(db, `${LOCAL_ID}/ARTICULOS/${articleId}`);
    
    const updates = {
      activoDelivery: newDeliveryStatus,
      hadDeliveryEnabled: newDeliveryStatus, // Sync state when manually overridden
      lastAutoToggle: Date.now(),
      autoToggleReason: 'manual_override'
    };
    
    await update(articleRef, updates);
    console.log(`[Stock Automation] Manual override for ${articleId}: delivery ${newDeliveryStatus ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error(`[Stock Automation] Error during manual override for ${articleId}:`, error);
    throw error;
  }
};