// Bug real: al terminar de configurar correctamente el ÚLTIMO ítem de una
// promo (ej. "gratis 1/4 comprando 1 kilo"), la promo se agregaba bien al
// resumen, pero igual aparecía el toast rojo "Configuración de promo
// cancelada" — como si el usuario hubiera cancelado, cuando en realidad
// terminó con éxito.
//
// Causa raíz: OptionalSelectionModal.jsx, al confirmar el ÚLTIMO ítem de una
// promo, llamaba onConfirm(...) (que agenda setPromoConfig({isFinalizing:true})
// vía React, sin aplicarlo todavía) y, en el MISMO tick, sin esperar el
// re-render, llamaba también a onOpenChange(false). Esa llamada disparaba
// handleOptionalModalClose en NewOrderModal.jsx, cuyo guard
// (`promoConfig.isConfiguring && !promoConfig.isFinalizing`) todavía veía el
// `promoConfig` VIEJO (isFinalizing aún en false) — y mostraba el toast de
// cancelación aunque la promo se hubiera confirmado bien.
//
// El cierre del modal para un ítem de promo (incluido el último) ya lo hace,
// correctamente, el useEffect de NewOrderModal.jsx que mira
// `promoConfig.isFinalizing` y llama a setIsOptionalModalOpen(false)
// DIRECTO — sin pasar por onOpenChange/handleOptionalModalClose, así que
// nunca evalúa (ni puede disparar por error) el camino de cancelación. La
// corrección es que OptionalSelectionModal.jsx ya NO llame a onOpenChange
// para ningún ítem de promo (ni intermedio, que ya no lo hacía; ni el
// último, que sí lo hacía) — solo para un artículo individual sin promo,
// donde no existe ese efecto y sigue siendo el único lugar que cierra.
//
// REGRESIÓN introducida por ese mismo arreglo: al quitar el onOpenChange(false)
// del último ítem, quedó expuesto un bug latente del useEffect de
// NewOrderModal.jsx. Al confirmar el ÚLTIMO ítem, handlePromoItemConfigured
// (usePromo.js) pone isFinalizing:true PERO NO incrementa currentIndex (no
// hace falta: ya no hay "siguiente" ítem). El useEffect revisaba PRIMERO "¿hay
// otro ítem para configurar?" (`currentIndex < itemsToConfigure.length`, que
// seguía siendo cierto con el currentIndex sin avanzar) y solo si eso era
// falso miraba `isFinalizing` — así que reabría el modal con el MISMO
// artículo en vez de cerrarlo. Antes esto quedaba oculto porque el viejo
// onOpenChange(false) llamaba a handleOptionalModalClose, que reseteaba
// promoConfig entero de inmediato (isConfiguring:false), y entonces esa misma
// condición ya daba falso. La promo SÍ quedaba agregada al pedido
// (addArticleToOrder ya se había llamado), pero "Finalizar Promo" parecía no
// hacer nada. Corrección: el useEffect ahora revisa `isFinalizing` PRIMERO —
// es la señal de éxito, y tiene prioridad sobre "hay más ítems" sin importar
// si currentIndex avanzó o no — y resetea promoConfig él mismo (no
// handleOptionalModalClose) para no heredar estado viejo en la próxima
// apertura.
//
// La prueba es GENÉRICA: no depende de ninguna promo/local real.
//
// Correr con: node src/lib/api/__tests__/promoConfiguracionNoCancelada.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const optionalModalSrc = leer('src/components/attention/OptionalSelectionModal.jsx');
const newOrderModalSrc = leer('src/components/attention/NewOrderModal.jsx');

console.log('Fuente: OptionalSelectionModal.jsx ya no cierra un ítem de promo por su cuenta:');

check('handleConfirm solo llama a onOpenChange(false) para un artículo SIN promo (!isPromoItem)', () => {
  const i = optionalModalSrc.indexOf('const handleConfirm');
  assert.ok(i > 0, 'no se encontró handleConfirm');
  const cuerpo = optionalModalSrc.slice(i, i + 3200);
  assert.match(cuerpo, /onConfirm\(finalSelection\);/);
  // La condición vieja ("|| promoItemIndex >= promoTotalItems - 1") cerraba
  // también el ÚLTIMO ítem de promo desde acá mismo — es justo lo que
  // causaba el toast de cancelación falso.
  assert.ok(!/if \(!isPromoItem \|\| promoItemIndex >= promoTotalItems - 1\)/.test(cuerpo),
    'sigue existiendo la condición vieja que cerraba el último ítem de promo desde acá');
  assert.match(cuerpo, /if \(!isPromoItem\) \{\s*\n\s*onOpenChange\(false\);/,
    'onOpenChange(false) debe quedar SOLO para el caso sin promo');
});

check('el botón "Cancelar" explícito y el cierre por Escape/backdrop siguen intactos (onOpenChange en el Dialog)', () => {
  assert.match(optionalModalSrc, /onClick={\(\) => onOpenChange\(false\)}/, 'el botón Cancelar debe seguir cerrando siempre, sin condición');
  assert.match(optionalModalSrc, /<Dialog open={isOpen} onOpenChange={onOpenChange}>/, 'Escape/backdrop siguen delegando en onOpenChange');
});

console.log('\nFuente: NewOrderModal.jsx sigue siendo quien cierra un ítem de promo (sin pasar por el camino de cancelar):');

check('el useEffect revisa isFinalizing PRIMERO (antes que "hay más ítems"), para no reabrir el último ítem', () => {
  const iEffect = newOrderModalSrc.indexOf('useEffect(() => {\r\n    // `promoConfig.isFinalizing`');
  const iEffectAlt = iEffect > 0 ? iEffect : newOrderModalSrc.indexOf("useEffect(() => {\n    // `promoConfig.isFinalizing`");
  assert.ok(iEffectAlt > 0, 'no se encontró el useEffect de promoConfig (buscando el comentario de isFinalizing)');
  const bloque = newOrderModalSrc.slice(iEffectAlt, iEffectAlt + 1600);
  const iIfFinalizing = bloque.indexOf('if (promoConfig.isFinalizing) {');
  const iElseIfMasItems = bloque.indexOf('} else if (promoConfig.isConfiguring && promoConfig.currentIndex < promoConfig.itemsToConfigure.length) {');
  assert.ok(iIfFinalizing > 0, 'no se encontró el chequeo de isFinalizing');
  assert.ok(iElseIfMasItems > 0, 'no se encontró el chequeo de "hay más ítems"');
  assert.ok(iIfFinalizing < iElseIfMasItems, 'isFinalizing debe revisarse ANTES que "hay más ítems" — si no, el último ítem reabre el modal');
  const cuerpoFinalizing = bloque.slice(iIfFinalizing, iElseIfMasItems);
  assert.match(cuerpoFinalizing, /setIsOptionalModalOpen\(false\);/);
  assert.match(cuerpoFinalizing, /resetPromoConfig\(\);/, 'debe resetear promoConfig él mismo al cerrar con éxito');
});

check('handleOptionalModalClose sigue mostrando el toast SOLO para una cancelación real (isConfiguring && !isFinalizing)', () => {
  const i = newOrderModalSrc.indexOf('const handleOptionalModalClose');
  assert.ok(i > 0);
  const bloque = newOrderModalSrc.slice(i, i + 400);
  assert.match(bloque, /if \(promoConfig\.isConfiguring && !promoConfig\.isFinalizing\)/);
  assert.match(bloque, /Configuración de promo cancelada/);
});

// ---------------------------------------------------------------------------
console.log('\nRéplica del guard (fixtures genéricos, misma condición que handleOptionalModalClose):');

// Réplica exacta del guard que decide si se muestra el toast de cancelación.
const debeMostrarToastCancelacion = (promoConfig) => (
  promoConfig.isConfiguring && !promoConfig.isFinalizing
);

check('confirmar el ÚLTIMO ítem (isFinalizing=true) NO muestra el toast, aunque isConfiguring siga en true', () => {
  // Este es exactamente el estado "viejo" que seguía viendo
  // handleOptionalModalClose en el bug: isConfiguring true, pero ya
  // isFinalizing true porque el ítem se confirmó con éxito.
  const promoConfig = { isConfiguring: true, isFinalizing: true, currentIndex: 2, itemsToConfigure: [1, 2] };
  assert.strictEqual(debeMostrarToastCancelacion(promoConfig), false);
});

check('cancelar de verdad a mitad de la configuración (isFinalizing=false) SÍ muestra el toast', () => {
  const promoConfig = { isConfiguring: true, isFinalizing: false, currentIndex: 0, itemsToConfigure: [1, 2] };
  assert.strictEqual(debeMostrarToastCancelacion(promoConfig), true);
});

check('cerrar el modal para un artículo normal (nunca hubo promo) no muestra el toast de promo', () => {
  const promoConfig = { isConfiguring: false, isFinalizing: false, currentIndex: 0, itemsToConfigure: [] };
  assert.strictEqual(debeMostrarToastCancelacion(promoConfig), false);
});

// ---------------------------------------------------------------------------
console.log('\nRéplica de la decisión del useEffect (caso real del bug: 2 de 2, "Finalizar Promo" no hacía nada):');

// Réplica exacta de la decisión, YA CORREGIDA (isFinalizing primero).
function decidirAccionModalPromo(promoConfig) {
  if (promoConfig.isFinalizing) return 'cerrar';
  if (promoConfig.isConfiguring && promoConfig.currentIndex < promoConfig.itemsToConfigure.length) return 'mostrar-siguiente-item';
  return 'nada';
}

check('último ítem de una promo de 2 (Artículo 2 de 2): currentIndex SIN avanzar (sigue en 1) + isFinalizing=true -> cierra, no reabre el mismo ítem', () => {
  // Exactamente el estado real tras confirmar "Artículo 2 de 2": handlePromoItemConfigured
  // puso isFinalizing:true pero currentIndex se quedó en 1 (índice del ítem
  // que se acaba de confirmar, 0-based) — "1 < 2" sigue siendo cierto.
  const promoConfig = { isConfiguring: true, isFinalizing: true, currentIndex: 1, itemsToConfigure: [{}, {}] };
  assert.strictEqual(decidirAccionModalPromo(promoConfig), 'cerrar',
    'con la condición vieja (revisar "hay más ítems" primero) esto daba "mostrar-siguiente-item" y reabría el mismo artículo');
});

check('ítem intermedio (no el último): sigue mostrando el siguiente, no cierra de más', () => {
  const promoConfig = { isConfiguring: true, isFinalizing: false, currentIndex: 1, itemsToConfigure: [{}, {}, {}] };
  assert.strictEqual(decidirAccionModalPromo(promoConfig), 'mostrar-siguiente-item');
});

check('promo de un solo ítem: confirmarlo ya es "el último" -> cierra sin reabrir', () => {
  const promoConfig = { isConfiguring: true, isFinalizing: true, currentIndex: 0, itemsToConfigure: [{}] };
  assert.strictEqual(decidirAccionModalPromo(promoConfig), 'cerrar');
});

check('sin promo en curso: no hace nada', () => {
  const promoConfig = { isConfiguring: false, isFinalizing: false, currentIndex: 0, itemsToConfigure: [] };
  assert.strictEqual(decidirAccionModalPromo(promoConfig), 'nada');
});

// ---------------------------------------------------------------------------
console.log('\nFuente + réplica: un grupo de opcionales SIN mínimo obligatorio (min ausente/0, max=1) nunca exige elegir uno:');

check('OptionalSelectionModal.jsx: minSelections solo exige algo si el grupo es obligatorio (max=1 no implica obligatorio)', () => {
  const i = optionalModalSrc.indexOf('const minSelections');
  assert.ok(i > 0, 'no se encontró el cálculo de minSelections');
  const linea = optionalModalSrc.slice(i, i + 120);
  assert.match(linea, /groupConfig\.obligatorio \? parseInt\(groupConfig\.min, 10\) : 0/,
    'minSelections debe depender de "obligatorio", nunca inferirse de "max"');
});

// Réplica exacta de la validación por grupo de handleConfirm.
function grupoValido(groupConfig, cantidadSeleccionada) {
  const minSelections = groupConfig.obligatorio ? parseInt(groupConfig.min, 10) : 0;
  return cantidadSeleccionada >= minSelections;
}

check('grupo opcional (obligatorio:false, min ausente, max:1) con 0 seleccionados -> VÁLIDO', () => {
  assert.strictEqual(grupoValido({ obligatorio: false, max: 1 }, 0), true);
});

check('el mismo grupo opcional (max:1) con 1 seleccionado -> también VÁLIDO', () => {
  assert.strictEqual(grupoValido({ obligatorio: false, max: 1 }, 1), true);
});

check('grupo opcional con min:0 explícito y max:1, 0 seleccionados -> VÁLIDO', () => {
  assert.strictEqual(grupoValido({ obligatorio: false, min: 0, max: 1 }, 0), true);
});

check('grupo OBLIGATORIO (min:1, max:4) con 4 seleccionados -> VÁLIDO (caso real: 1G, 4/4)', () => {
  assert.strictEqual(grupoValido({ obligatorio: true, min: 1, max: 4 }, 4), true);
});

check('grupo OBLIGATORIO (min:1) con 0 seleccionados -> INVÁLIDO, sí debe bloquear', () => {
  assert.strictEqual(grupoValido({ obligatorio: true, min: 1, max: 4 }, 0), false);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
