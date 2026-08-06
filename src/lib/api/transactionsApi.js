import { getDatabase, ref, get, runTransaction, update, push, set } from 'firebase/database';
import { getCurrentDatabasePath, checkLocalId, beginFirebaseOperation } from '@/lib/firebase/core';
import { getOperationalDate, formatDateForFirebase } from '@/lib/utils';
import { shouldAutoToggleDelivery, handleStockDepletion, handleStockReplenishment, validateInheritedStockStatus, reconciliarMateriaPrima } from './stockDeliveryAutomation';
import { checkAndUpdatePromotionStockStatus } from './promotionStockAutomation';
import { construirPlanDeStock } from './stockPlan';
import {
    revertirEnRecurso, resolverResultadoRecurso, aplicarEnRecurso, decidirIntento,
    calcularImpactHash, construirMarcaFinal, rutaRecurso, RESULTADOS, quedoAplicado,
} from './stockAtomico';

const parseQuantity = (val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        return parseFloat(val.replace(',', '.')) || 0;
    }
    return 0;
};

export const resolveStockImpact = (itemId, quantity, articlesData, materiaPrimaData, impactMap, visited = new Set()) => {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    let resolvedId = itemId;
    let foundInArticles = false;
    let foundInMP = false;

    if (articlesData[resolvedId]) {
        const art = articlesData[resolvedId];
        const hasStockConfig = (art.stock && (
            art.stock.stockType === 'propio' || 
            art.stock.stockType === 'receta' || 
            art.stock.stockType === 'heredado' ||
            art.stock.propio !== undefined ||
            (art.stock.receta && Object.keys(art.stock.receta).length > 0) ||
            art.stock.heredadoDe
        ));
        
        if (hasStockConfig) {
            foundInArticles = true;
        }
    } 
    
    if (!foundInArticles && materiaPrimaData[resolvedId]) {
        foundInMP = true;
    } 
    
    if (!foundInArticles && !foundInMP) {
        const searchTerm = String(itemId).trim().toLowerCase();
        
        const articleKey = Object.keys(articlesData).find(key => 
            articlesData[key].nombre && String(articlesData[key].nombre).trim().toLowerCase() === searchTerm
        );
        
        if (articleKey) {
            const art = articlesData[articleKey];
            const hasStockConfig = (art.stock && (
                art.stock.stockType === 'propio' || 
                art.stock.stockType === 'receta' || 
                art.stock.stockType === 'heredado' ||
                art.stock.propio !== undefined ||
                (art.stock.receta && Object.keys(art.stock.receta).length > 0) ||
                art.stock.heredadoDe
            ));

            if (hasStockConfig) {
                resolvedId = articleKey;
                foundInArticles = true;
            }
        }
        
        if (!foundInArticles) {
            const mpKey = Object.keys(materiaPrimaData).find(key => 
                materiaPrimaData[key].nombre && String(materiaPrimaData[key].nombre).trim().toLowerCase() === searchTerm
            );
            if (mpKey) {
                resolvedId = mpKey;
                foundInMP = true;
            }
        }
    }

    if (foundInArticles) {
        const article = articlesData[resolvedId];
        const stockType = article.stock?.stockType;
        const hasReceta = article.stock?.receta;
        const hasHeredado = article.stock?.heredadoDe;
        const hasPropio = article.stock?.propio !== undefined;

        if (stockType === 'propio' || (!stockType && hasPropio)) {
            if (!impactMap[resolvedId]) {
                impactMap[resolvedId] = { quantity: 0, type: 'ARTICULO' };
            }
            impactMap[resolvedId].quantity += quantity;
        } 
        else if ((stockType === 'receta' || !stockType) && hasReceta) {
            const receta = article.stock.receta;
            
            if (typeof receta === 'object' && !Array.isArray(receta)) {
                 Object.entries(receta).forEach(([ingredientId, ingredientQty]) => {
                    const qtyNeeded = parseQuantity(ingredientQty);
                    resolveStockImpact(ingredientId, quantity * qtyNeeded, articlesData, materiaPrimaData, impactMap, visited);
                });
            }
            else if (Array.isArray(receta)) {
                receta.forEach(ing => {
                    const ingId = ing.codigo || ing.id || ing.nombre;
                    const qtyNeeded = parseQuantity(ing.cantidad);
                    if (ingId) {
                        resolveStockImpact(ingId, quantity * qtyNeeded, articlesData, materiaPrimaData, impactMap, visited);
                    }
                });
            }
        } 
        else if ((stockType === 'heredado' || !stockType) && hasHeredado) {
            resolveStockImpact(article.stock.heredadoDe, quantity, articlesData, materiaPrimaData, impactMap, visited);
        }
        return;
    }

    if (foundInMP) {
        if (!impactMap[resolvedId]) {
            impactMap[resolvedId] = { quantity: 0, type: 'MATERIA_PRIMA' };
        }
        impactMap[resolvedId].quantity += quantity;
        return;
    }
};

const saveProcessReport = async (db, localId, impactMap, articlesData, materiaPrimaData, source, referenceId) => {
    const now = new Date();
    const operationalDate = getOperationalDate(now);
    const fechaCaja = formatDateForFirebase(operationalDate);
    const timeString = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const reportPath = `${localId}/INFORME/${fechaCaja}/${timeString}/SUCESO`;
    
    const detalles = Object.entries(impactMap).map(([id, data]) => {
        let name = id;
        if (data.type === 'ARTICULO' && articlesData[id]) name = articlesData[id].nombre;
        if (data.type === 'MATERIA_PRIMA' && materiaPrimaData[id]) name = materiaPrimaData[id].nombre;
        
        return {
            item: name,
            itemId: id,
            cantidad: data.quantity,
            tipo: data.type
        };
    });

    const reportData = {
        dia: fechaCaja,
        hora: timeString,
        tipo: source,
        referenceId: referenceId || null,
        detalles: detalles
    };

    try {
        await set(ref(db, reportPath), reportData);
    } catch (e) {
        console.error("Error saving process report:", e);
    }
}

/**
 * RESERVA de la operación. Es una OPTIMIZACIÓN para no repetir trabajo, no el
 * mecanismo de corrección: la garantía de exactly-once la da `appliedOps`
 * dentro de cada recurso (`aplicarEnRecurso`), evaluado por el servidor en la
 * misma transacción que cambia el stock.
 *
 * El candado anterior era `if (currentData) return;` y NO vencía nunca: si el
 * descuento fallaba a mitad de camino, la marca quedaba en `processing` para
 * siempre y todo reintento salía por "Already processed". La venta quedaba
 * registrada y sin descontar, de forma permanente y silenciosa. `decidirIntento`
 * reemplaza eso por un lease: `completed` no se reintenta, `processing` fresco
 * se respeta, y `processing` huérfano se retoma — sin riesgo de doble descuento,
 * porque el recurso ya sabe qué operaciones se le aplicaron.
 */
const acquireTransactionLock = async (db, localId, referenceId, source = null) => {
    if (!referenceId) return { intentar: false, motivo: 'sin-referenceId' };

    const lockRef = ref(db, `${localId}/PROCESSED_STOCK_IDS/${referenceId}`);
    let decision = { intentar: false, motivo: 'sin-evaluar' };

    try {
        await runTransaction(lockRef, (marca) => {
            decision = decidirIntento(marca);
            if (!decision.intentar) return;   // aborta sin pisar la marca existente
            return {
                ...(marca || {}),
                status: 'processing',
                referenceId,
                source: source || (marca && marca.source) || null,
                intento: (Number(marca && marca.intento) || 0) + 1,
                timestamp: Date.now(),
            };
        });
        return decision;
    } catch (e) {
        console.error("Error acquiring transaction lock:", e);
        return { intentar: false, motivo: 'error-de-reserva' };
    }
};

/**
 * Cierra la operación con lo que REALMENTE quedó aplicado. `completed` solo si
 * no faltó ningún recurso; si faltó alguno queda `partial`, que SÍ es
 * reintentable (y cada recurso ya aplicado no se vuelve a descontar).
 */
const markTransactionAsCompleted = async (db, localId, referenceId, cierre) => {
    if (!referenceId) return;
    const lockRef = ref(db, `${localId}/PROCESSED_STOCK_IDS/${referenceId}`);
    await update(lockRef, construirMarcaFinal(cierre));
};

const processStockUpdate = async (items, source = 'Venta Delivery', referenceId = null) => {
    if (!items || items.length === 0) return { success: true, message: 'No items' };

    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    // Un solo "op" para todo el procesamiento de stock: hay varios await
    // reales (lock, lecturas de artículos/materia prima, reporte) antes de
    // las transacciones de stock, y más awaits (esas mismas transacciones)
    // antes del push de cada movimiento y del markTransactionAsCompleted final.
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

    // SIN referenceId no hay idempotencia posible: un reintento, un doble clic o
    // dos dispositivos descontarían de nuevo. Antes esto se dejaba pasar en
    // silencio (`if (!referenceId) return true`) y así corrían TODOS los
    // descuentos de delivery, sin candado y sin marca.
    if (!referenceId) {
        throw new Error('STOCK_SIN_REFERENCIA: no se puede descontar stock sin un identificador idempotente de la venta.');
    }

    const reserva = await acquireTransactionLock(db, LOCAL_ID, referenceId, source);
    if (!reserva.intentar) {
        console.warn(`[stock] ${referenceId} no se procesa (${reserva.motivo}).`);
        return { success: true, message: 'Already processed', motivo: reserva.motivo };
    }

    const impactMap = {}; 
    const articlesRef = ref(db, `${LOCAL_ID}/ARTICULOS`);
    const materiaPrimaRef = ref(db, `${LOCAL_ID}/MATERIA_PRIMA`);

    try {
        const [articlesSnapshot, materiaPrimaSnapshot] = await Promise.all([
            get(articlesRef),
            get(materiaPrimaRef)
        ]);

        const articlesData = articlesSnapshot.val() || {};
        const materiaPrimaData = materiaPrimaSnapshot.val() || {};

        // PLAN ÚNICO DE STOCK (Fase 2, punto 10).
        //
        // Antes este bucle resolvía solo el artículo base y los hijos de promo,
        // y los opcionales quedaban afuera: un topping vinculado a un artículo
        // real se cobraba pero nunca se descontaba.
        //
        // `construirPlanDeStock` arma UNA sola operación con artículo base,
        // hijos de promoción y opcionales de departamento, resolviendo cada
        // consumo hasta la RUTA FÍSICA que realmente cambia (propio, heredado o
        // receta) y agrupando cuando varios caminos caen en el mismo nodo. No se
        // crea una segunda llamada de stock ni un segundo referenceId.
        //
        // Reglas que aplica: los opcionales resuelven SOLO por articleId y nunca
        // por nombre; un opcional manual sin articleId no mueve stock; el
        // consumo sale del snapshot congelado y validado, jamás del nombre; y un
        // opcional gratuito basado en artículo igual descuenta.
        const plan = construirPlanDeStock({
            items,
            articulos: articlesData,
            materiaPrima: materiaPrimaData,
            permitirNombreEnBase: true,   // compatibilidad de artículos base históricos
        });
        Object.assign(impactMap, plan.impactMap);

        for (const aviso of plan.avisos) {
            if (aviso.tipo === 'fallback-por-nombre') {
                console.warn(`[stock] artículo resuelto por NOMBRE (compatibilidad histórica): "${aviso.buscado}" → ${aviso.resuelto}`, aviso);
            } else if (aviso.tipo === 'recurso-inexistente' || aviso.tipo === 'consumo-invalido' || aviso.tipo === 'ciclo') {
                console.warn(`[stock] ${aviso.tipo}`, aviso);
            }
        }
        if (plan.faltantes.length > 0) {
            console.warn(`[stock] ${plan.faltantes.length} recurso(s) del pedido no existen en el catálogo`, plan.faltantes);
        }

        if (Object.keys(impactMap).length > 0) {
            // Revalida antes del set() del reporte: el Promise.all(get) de
            // arriba fue un await real.
            await saveProcessReport(op.getDatabaseOrAbort(), LOCAL_ID, impactMap, articlesData, materiaPrimaData, source, referenceId);
        }

        const automationPromises = [];
        const validationPromises = [];
        const operationalDate = getOperationalDate(new Date());

        // Hash del impacto: identifica ESTE plan. Si el mismo referenceId vuelve
        // con otro contenido, el recurso lo rechaza en vez de descontar de nuevo.
        const impactHash = calcularImpactHash(impactMap, { localId: LOCAL_ID, operation: 'decrement' });
        const resultados = [];

        // DESCUENTO IDEMPOTENTE POR RECURSO.
        //
        // Antes esto era una resta cruda sobre el escalar de stock
        // (`runTransaction(.../stock/propio, n => n - cantidad)`), que NO dejaba
        // registro de qué operación se había aplicado. Dos consecuencias reales:
        // dos dispositivos procesando la misma venta descontaban dos veces, y la
        // reversión de una cancelación —que sí mira `appliedOps`— nunca
        // encontraba la operación original y por lo tanto jamás reponía nada.
        //
        // `aplicarEnRecurso` cambia el stock y registra la operación DENTRO de la
        // misma transacción, así que la condición la evalúa el servidor.
        // Se recorre en serie: cada recurso necesita su precarga y su
        // transacción, y un pedido toca pocos nodos.
        for (const id of Object.keys(impactMap)) {
            const { quantity, type } = impactMap[id];
            const isArticle = type === 'ARTICULO';
            const recurso = `${type}:${id}`;

            // Revalida antes de CADA transacción definitiva: arriba hubo awaits
            // reales (reserva, lecturas, reporte, recursos anteriores).
            const refNodo = ref(op.getDatabaseOrAbort(), rutaRecurso(LOCAL_ID, id, type));

            // SIN PRECARGA. Acá había un `onValue` de "precalentamiento" que se
            // desuscribía a sí mismo DENTRO de su propio callback, usando una
            // variable declarada con `const` en esa misma línea.
            //
            // Cuando OTRO listener ya cubre la ruta —y en la app siempre lo hay:
            // la pantalla de Stock, useStockStatus, las automatizaciones—, RTDB
            // invoca el callback SINCRÓNICAMENTE, dentro de la llamada a
            // onValue(). En ese instante `off` todavía está en la zona muerta
            // temporal del `const`, así que `off()` lanza
            // "Cannot access 'off' before initialization", el error sale del
            // executor de la Promise, la promesa se rechaza y TODA la operación
            // de stock muere en silencio con la marca en `processing`.
            //
            // La precarga además era innecesaria: `aplicarEnRecurso` ya resuelve
            // el null de la primera invocación devolviendo `{}` para forzar la
            // reejecución con los datos del servidor, y `resolverResultadoRecurso`
            // distingue después "caché fría" de "recurso inexistente".
            let salida = null;
            let invocacion = 0;
            await runTransaction(refNodo, (nodo) => {
                invocacion += 1;
                salida = aplicarEnRecurso(nodo, {
                    referenceId, cantidad: quantity, impactHash, tipo: type, invocacion,
                });
                return salida.nodo;
            });

            let resultado = salida ? salida.resultado : RESULTADOS.RETRYABLE;
            if (resultado === RESULTADOS.RETRYABLE) {
                resultado = resolverResultadoRecurso(resultado, (await get(refNodo)).val());
            }
            resultados.push({ recurso, itemId: id, tipo: type, resultado });

            if (salida && salida.aviso) console.warn(`[stock] ${recurso}`, salida.aviso);
            if (resultado !== RESULTADOS.APPLIED) {
                if (resultado !== RESULTADOS.ALREADY_APPLIED) {
                    console.error(`[stock] ${referenceId} — ${recurso} NO aplicado: ${resultado}`);
                }
                continue;   // ya aplicado, o no aplicable: no se registra dos veces
            }

            const previousStock = salida.stockAnterior;
            const newStockValue = salida.stockNuevo;

            if (isArticle) {
                const articleData = articlesData[id];
                const isOwnStock = shouldAutoToggleDelivery(articleData);
                console.log(`[Stock Transaction] Article ${id}: ${previousStock} -> ${newStockValue}`);

                if (newStockValue === 0 && previousStock > 0) {
                    automationPromises.push(
                        handleStockDepletion(id, newStockValue, previousStock, isOwnStock)
                            .catch(err => console.error(`[Automation Depletion] Failed for ${id}:`, err))
                    );
                } else if (newStockValue > 0 && previousStock === 0) {
                    automationPromises.push(
                        handleStockReplenishment(id, newStockValue, previousStock, isOwnStock)
                            .catch(err => console.error(`[Automation Replenishment] Failed for ${id}:`, err))
                    );
                } else {
                    validationPromises.push(
                        validateInheritedStockStatus(id, newStockValue)
                            .catch(err => console.error(`[Validation] Failed for inherited stock of ${id}:`, err))
                    );
                }
            } else {
                // MATERIA PRIMA: reconciliar activoDelivery según el stock
                // recién commiteado (idempotente, lee el estado del nodo).
                automationPromises.push(
                    reconciliarMateriaPrima(id)
                        .catch(err => console.error(`[MP Delivery] Failed for ${id}:`, err))
                );
            }

            const transaction = {
                tipo: 'salida',
                itemId: id,
                isArticle,
                cantidad: quantity,
                fecha: operationalDate.toISOString(),
                timestamp: Date.now(),
                motivo: source,
                referenceId: referenceId
            };
            // Revalida antes del push() definitivo: la transacción de
            // stock de arriba fue un await real.
            const transactionsRef = ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/TRANSACCIONES_STOCK`);
            await push(transactionsRef, transaction);
        }

        if (validationPromises.length > 0) {
            await Promise.all(validationPromises);
        }

        if (automationPromises.length > 0) {
            await Promise.all(automationPromises);
        }

        // Cierre honesto: `completed` SOLO si todos los recursos del plan
        // quedaron aplicados. Si faltó alguno queda `partial`, que la reserva
        // permite retomar sin volver a descontar los que ya estaban.
        const faltantes = resultados.filter((r) => !quedoAplicado(r.resultado));
        // Revalida antes del update() final de la marca: arriba hubo varios await reales.
        await markTransactionAsCompleted(op.getDatabaseOrAbort(), LOCAL_ID, referenceId, {
            referenceId,
            impactHash,
            impacto: resultados,
            source,
            parcial: faltantes.length > 0,
        });

        if (faltantes.length > 0) {
            console.error(`[stock] ${referenceId} quedó PARCIAL: faltan ${faltantes.map((r) => r.recurso).join(', ')}`);
            return { success: false, parcial: true, faltantes, resultados };
        }
        return { success: true, resultados };
    } catch (error) {
        console.error("Error processing stock update:", error);
        throw error;
    }
};

export const processStockForDeliveredOrder = async (order) => {
    if (!order || !order.items || order.items.length === 0) return { success: true, message: 'No items to process' };
    const referenceId = order.id ? `DELIVERY_${order.id}` : null;

    // El nodo guardado de PEDIDOS no tiene campo `id`: quien llame a esto tiene
    // que pasar el pedido CON su id. Sin él no hay idempotencia y el descuento
    // corría sin candado ni marca — que es exactamente lo que venía pasando.
    if (!referenceId) {
        const e = new Error('STOCK_SIN_REFERENCIA: el pedido llegó sin id, no se puede descontar stock de forma idempotente.');
        console.error('[stock] delivery sin id — no se descuenta', e.message);
        return { success: false, error: e.message };
    }

    try {
        await processStockUpdate(order.items, 'Venta Delivery', referenceId);
        // Verify promotion availability after stock modifications
        await checkAndUpdatePromotionStockStatus().catch(err => console.warn('Failed to verify promotion stock', err));
        return { success: true };
    } catch (error) {
        console.error("Stock deduction failed:", error);
        return { success: false, error: error.message };
    }
};

/**
 * REVERSIÓN IDEMPOTENTE DE UNA VENTA DE MOSTRADOR (Fase 2, punto 11).
 *
 * Única autoridad de reversión: reemplaza al camino viejo
 * (restoreStockForItem + bulkUpdateStock), que no tenía referenceId y por lo
 * tanto reponía de nuevo en cada cancelación repetida.
 *
 * Cómo garantiza que no repone dos veces: no se apoya en el pedido actual sino
 * en lo que cada recurso REGISTRÓ haber recibido. `revertirEnRecurso` mira el
 * `appliedOps` del propio nodo dentro de la transacción:
 *   · si la operación original no figura ahí     → no repone (nunca se descontó);
 *   · si la reversión ya figura                  → `ya-revertido`;
 *   · si figura la original y no la reversión    → repone exactamente su importe.
 * Por eso una operación original PARCIAL revierte solo los recursos realmente
 * aplicados, sin necesidad de reconstruir nada.
 *
 * @returns {{ success, estado, resultados, motivo? }}
 *   estado: 'reversed' | 'already-reversed' | 'original-not-applied' | 'reversal-partial'
 */
export const reverseStockForCounterSale = async (sale) => {
    if (!sale || !sale.items || sale.items.length === 0) {
        return { success: true, estado: 'reversed', resultados: [], motivo: 'sin-items' };
    }
    checkLocalId();
    const LOCAL_ID = getCurrentDatabasePath();
    const op = beginFirebaseOperation();
    const db = op.getDatabaseOrAbort();

    const referenceIdOriginal = `MOSTRADOR_${sale.id}`;
    const referenceIdReversion = `REVERSAL_MOSTRADOR_${sale.id}`;

    // Solo se revierte lo que efectivamente se aplicó.
    // `partial` también se revierte: `revertirEnRecurso` solo repone los
    // recursos que registraron la operación original, así que una venta que
    // quedó a medio descontar devuelve exactamente lo que sí se descontó.
    const marcaOriginal = (await get(ref(db, `${LOCAL_ID}/PROCESSED_STOCK_IDS/${referenceIdOriginal}`))).val();
    if (!marcaOriginal || !['completed', 'partial'].includes(marcaOriginal.status)) {
        return { success: true, estado: 'original-not-applied', resultados: [], motivo: 'la venta no descontó stock' };
    }
    const marcaReversion = (await get(ref(db, `${LOCAL_ID}/PROCESSED_STOCK_IDS/${referenceIdReversion}`))).val();
    if (marcaReversion && marcaReversion.status === 'completed') {
        return { success: true, estado: 'already-reversed', resultados: [], motivo: 'ya se había repuesto' };
    }

    const [articlesSnapshot, materiaPrimaSnapshot] = await Promise.all([
        get(ref(db, `${LOCAL_ID}/ARTICULOS`)),
        get(ref(db, `${LOCAL_ID}/MATERIA_PRIMA`)),
    ]);
    const articlesData = articlesSnapshot.val() || {};
    const materiaPrimaData = materiaPrimaSnapshot.val() || {};

    // El mismo plan que se usó al descontar: base + hijos de promo + opcionales,
    // agrupado por ruta física.
    const plan = construirPlanDeStock({ items: sale.items, articulos: articlesData, materiaPrima: materiaPrimaData });

    const resultados = [];
    const dbRev = op.getDatabaseOrAbort();
    for (const [itemId, datos] of Object.entries(plan.impactMap)) {
        const rutaNodo = datos.type === 'ARTICULO'
            ? `${LOCAL_ID}/ARTICULOS/${itemId}/stock`
            : `${LOCAL_ID}/MATERIA_PRIMA/${itemId}`;
        const refNodo = ref(dbRev, rutaNodo);

        // SIN PRECARGA, por el mismo motivo que en el descuento: con otro
        // listener activo sobre la ruta, el callback de onValue corre
        // sincrónicamente y `off()` lanza dentro del executor de la Promise.
        // `revertirEnRecurso` ya maneja el null de la primera invocación.
        let resultado = null;
        let invocacion = 0;
        await runTransaction(refNodo, (nodo) => {
            invocacion += 1;
            const r = revertirEnRecurso(nodo, {
                referenceIdOriginal, referenceIdReversion, tipo: datos.type, invocacion,
            });
            resultado = r.resultado;
            return r.nodo;
        });
        if (resultado === 'retryable') {
            resultado = resolverResultadoRecurso(resultado, (await get(refNodo)).val());
        }
        resultados.push({ itemId, tipo: datos.type, resultado });
    }

    // Reconciliar activoDelivery de las materias primas repuestas: la reversión
    // sube el stock, así que puede corresponder reactivar delivery.
    for (const r of resultados) {
      if (r.tipo === 'MATERIA_PRIMA' && r.resultado === 'revertido') {
        await reconciliarMateriaPrima(r.itemId).catch((e) => console.error('[MP Delivery] reversión', r.itemId, e));
      }
    }

    const repuestos = resultados.filter((r) => r.resultado === 'revertido');
    const problemas = resultados.filter((r) => !['revertido', 'ya-revertido', 'original-no-aplicada'].includes(r.resultado));
    const estado = problemas.length > 0 ? 'reversal-partial' : 'reversed';

    await set(ref(op.getDatabaseOrAbort(), `${LOCAL_ID}/PROCESSED_STOCK_IDS/${referenceIdReversion}`), {
        status: estado === 'reversed' ? 'completed' : 'reversal-partial',
        referenceId: referenceIdReversion,
        revierteA: referenceIdOriginal,
        timestamp: Date.now(),
        movementId: `MOV_${referenceIdReversion}`,
        resultados,
    });

    if (problemas.length > 0) {
        console.warn('[stock] la reversión de mostrador quedó incompleta', { referenceIdReversion, problemas });
    }
    return { success: true, estado, resultados, repuestos: repuestos.length };
};

export const processStockForCounterSale = async (sale) => {
    if (!sale || !sale.items || sale.items.length === 0) return { success: true };
    const referenceId = sale.id ? `MOSTRADOR_${sale.id}` : null;
    if (!referenceId) {
        const mensaje = 'STOCK_SIN_REFERENCIA: la venta llegó sin id, no se puede descontar stock de forma idempotente.';
        console.error('[stock] mostrador sin id — no se descuenta');
        return { success: false, error: mensaje };
    }
    try {
        await processStockUpdate(sale.items, 'Venta Mostrador', referenceId);
        // Verify promotion availability after stock modifications
        await checkAndUpdatePromotionStockStatus().catch(err => console.warn('Failed to verify promotion stock', err));
        return { success: true };
    } catch(e) {
        console.error("Stock deduction failed for counter sale", e);
        return { success: false, error: e.message };
    }
};