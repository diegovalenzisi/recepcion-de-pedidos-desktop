// Artículo AUXILIAR de promoción (esArticuloSoloParaPromocion, en
// stockAvailability.js): permiteVentaEfectivo=false Y
// permiteVentaElectronica=false (las DOS, explícitamente en `false` — no
// "ausente"). Regla de negocio:
//
//   - NO debe listarse como artículo individual en Mostrador, Delivery ni
//     DLV Pedidos web.
//   - SÍ debe seguir siendo un componente válido de promoItems/grupos de
//     productos: disponibilidad, cálculo de stock/receta y venta de la promo
//     que lo usa NO dependen de estos dos flags, solo de
//     activo/activoDelivery/activoMostrador + stock/receta (igual que
//     cualquier otro artículo).
//   - El precio ($0 u otro) NUNCA es parte del criterio.
//
// Casos reales que motivaron esto:
//   - local 40508022 (Achaval): promos "GRATIS 1/4 LLEVANDO 1 KILO" (9A) y
//     "PROMO 1 KILO Y 1/2 DE HELADO" (130A), con promoItems fijos apuntando
//     a 65A/3A/77A.
//   - local 57641732 (Viticos): artículo 23A ("1/4 promo", $0) seguía
//     vendiéndose suelto en Mostrador/Delivery porque useStockVerification.js
//     devolvía el artículo "viejo" (el de `allArticles`, cargado UNA sola vez
//     por sesión — NewOrderModal nunca desmonta, solo cambia `isOpen`) en vez
//     del fusionado con el snapshot fresco de Firebase que la propia
//     verificación ya había leído para decidir disponibilidad. Si alguien
//     apagaba los dos medios de venta DESPUÉS de que la sesión ya hubiera
//     cargado el catálogo, el artículo seguía viéndose vendible suelto hasta
//     reiniciar la app — aunque activo/activoDelivery/activoMostrador SÍ se
//     respetaban en vivo, porque la DECISIÓN de incluir ya usaba el dato
//     fresco; solo el OBJETO devuelto quedaba desactualizado.
//
// La prueba es GENÉRICA: no depende de ningún local, id o nombre real —
// fixtures propios.
//
// Correr con: node src/lib/api/__tests__/articuloAuxiliarPromo.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isArticleAvailable, isPromoAvailable, opcionesDisponiblesDeGrupo, esArticuloSoloParaPromocion,
} from '../stockAvailability.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const stockAvailabilitySrc = fs.readFileSync(path.join(RAIZ, 'src/lib/api/stockAvailability.js'), 'utf8');
const promotionStockAutomationSrc = fs.readFileSync(path.join(RAIZ, 'src/lib/api/promotionStockAutomation.js'), 'utf8');
const usePromoSrc = fs.readFileSync(path.join(RAIZ, 'src/hooks/usePromo.js'), 'utf8');
const newOrderModalSrc = fs.readFileSync(path.join(RAIZ, 'src/components/attention/NewOrderModal.jsx'), 'utf8');
const useStockVerificationSrc = fs.readFileSync(path.join(RAIZ, 'src/hooks/useStockVerification.js'), 'utf8');

console.log('Fuente: la regla de artículo auxiliar vive en UNA sola función reutilizable:');

check('esArticuloSoloParaPromocion existe y es exactamente la comparación de los dos flags', () => {
  assert.match(stockAvailabilitySrc, /export const esArticuloSoloParaPromocion = \(articulo\) => \(/);
  const i = stockAvailabilitySrc.indexOf('export const esArticuloSoloParaPromocion');
  const bloque = stockAvailabilitySrc.slice(i, i + 300);
  assert.match(bloque, /articulo\.permiteVentaEfectivo === false && articulo\.permiteVentaElectronica === false/);
});

check('NewOrderModal.jsx usa esArticuloSoloParaPromocion (no repite la comparación a mano)', () => {
  assert.match(newOrderModalSrc, /import \{ esArticuloSoloParaPromocion \} from '@\/lib\/api\/stockAvailability'/);
  assert.ok(!/permiteVentaEfectivo === false/.test(newOrderModalSrc), 'NewOrderModal.jsx no debería repetir la comparación: tiene que llamar a la función');
  const i = newOrderModalSrc.indexOf('const articlesByDept');
  const bloque = newOrderModalSrc.slice(i, i + 800);
  assert.match(bloque, /individualmenteVisibles = verifiedArticles\.filter\(\(a\) => !esArticuloSoloParaPromocion\(a\)\)/);
});

console.log('\nFuente: los flags de venta NUNCA entran en la disponibilidad de un componente de promo:');

check('los CUERPOS de isArticleAvailable e isPromoAvailable no leen permiteVentaEfectivo ni permiteVentaElectronica', () => {
  const iArticleAvailable = stockAvailabilitySrc.indexOf('export const isArticleAvailable');
  const iPromoAvailable = stockAvailabilitySrc.indexOf('export const isPromoAvailable');
  assert.ok(iArticleAvailable > 0 && iPromoAvailable > 0);
  const cuerpoIsArticleAvailable = stockAvailabilitySrc.slice(iArticleAvailable, iArticleAvailable + 2500);
  const cuerpoIsPromoAvailable = stockAvailabilitySrc.slice(iPromoAvailable, iPromoAvailable + 1500);
  assert.ok(!/permiteVenta/.test(cuerpoIsArticleAvailable), 'isArticleAvailable no debe leer permiteVenta*');
  assert.ok(!/permiteVenta/.test(cuerpoIsPromoAvailable), 'isPromoAvailable no debe leer permiteVenta*');
});

check('esArticuloSoloParaPromocion NUNCA se llama desde isArticleAvailable ni isPromoAvailable', () => {
  const iArticleAvailable = stockAvailabilitySrc.indexOf('export const isArticleAvailable');
  const iPromoAvailable = stockAvailabilitySrc.indexOf('export const isPromoAvailable');
  const iFnAuxiliar = stockAvailabilitySrc.indexOf('export const esArticuloSoloParaPromocion');
  const cuerpoIsArticleAvailable = stockAvailabilitySrc.slice(iArticleAvailable, iArticleAvailable + 2500);
  const cuerpoIsPromoAvailable = stockAvailabilitySrc.slice(iPromoAvailable, iPromoAvailable + 1500);
  assert.ok(!cuerpoIsArticleAvailable.includes('esArticuloSoloParaPromocion'));
  assert.ok(!cuerpoIsPromoAvailable.includes('esArticuloSoloParaPromocion'));
  assert.ok(iFnAuxiliar > 0);
});

check('promotionStockAutomation.js no lee permiteVentaEfectivo ni permiteVentaElectronica', () => {
  assert.ok(!/permiteVenta/.test(promotionStockAutomationSrc));
});

check('usePromo.js sigue resolviendo ítems fijos/grupos contra allArticles y verifiedArticles, no filtra por permiteVenta', () => {
  assert.ok(!/permiteVenta/.test(usePromoSrc));
});

check('el filtro de auxiliar no toca verifiedArticles (lo sigue usando usePromo para resolver grupos)', () => {
  // verifiedArticles se sigue pasando TAL CUAL a usePromo — la exclusión del
  // auxiliar ocurre sobre una copia (individualmenteVisibles), no sobre
  // verifiedArticles en sí.
  assert.ok(/usePromo\(\{[^}]*verifiedArticles/.test(newOrderModalSrc));
});

console.log('\nFuente: useStockVerification.js devuelve el artículo FRESCO, no el de la sesión vieja:');

check('filtered fusiona cada artículo con el snapshot recién leído (catalogo) antes de devolverlo', () => {
  assert.match(
    useStockVerificationSrc,
    /list\.map\(article => \(\{ \.\.\.article, \.\.\.\(catalogo\[article\.id\] \|\| \{\}\) \}\)\)\.filter\(rtArticle => \{/,
    'filtered ya no debe devolver el `article` original de `list`: tiene que devolver la fusión con `catalogo` (el snapshot fresco)',
  );
});

// ---------------------------------------------------------------------------
console.log('\nRéplica de la fusión (fixtures genéricos, misma lógica que useStockVerification.js):');

// Réplica exacta del merge agregado: `list.map(article => ({ ...article, ...(catalogo[article.id] || {}) }))`.
function fusionarConSnapshotFresco(list, catalogo) {
  return list.map((article) => ({ ...article, ...(catalogo[article.id] || {}) }));
}

check('un artículo cargado al principio de la sesión refleja el flag cambiado DESPUÉS, sin reiniciar la app', () => {
  // `list` = lo que ya estaba en memoria desde el primer fetch de la sesión
  // (permiteVentaEfectivo todavía en true en ese momento).
  const listDeLaSesion = [{ id: 'ART1', nombre: 'Uno', permiteVentaEfectivo: true, permiteVentaElectronica: true, activoDelivery: true }];
  // `catalogo` = snapshot fresco leído recién ahora: alguien ya apagó los dos
  // medios de venta individual DESPUÉS de que la sesión cargó `listDeLaSesion`.
  const catalogoFresco = { ART1: { id: 'ART1', nombre: 'Uno', permiteVentaEfectivo: false, permiteVentaElectronica: false, activoDelivery: true } };

  const fusionado = fusionarConSnapshotFresco(listDeLaSesion, catalogoFresco);
  assert.strictEqual(fusionado[0].permiteVentaEfectivo, false, 'debe reflejar el dato fresco, no el de la sesión vieja');
  assert.strictEqual(esArticuloSoloParaPromocion(fusionado[0]), true, 'con el dato fresco ya es auxiliar y debe ocultarse');
  // Sin la fusión (comportamiento viejo) habría quedado en `true`/`true` y
  // esArticuloSoloParaPromocion habría dado `false` (seguiría visible):
  assert.strictEqual(esArticuloSoloParaPromocion(listDeLaSesion[0]), false, 'el objeto viejo de la sesión, sin fusionar, todavía parece vendible suelto');
});

check('si el artículo desaparece del snapshot fresco, la fusión conserva el de la sesión (fallback)', () => {
  const listDeLaSesion = [{ id: 'ART1', nombre: 'Uno', permiteVentaEfectivo: true, permiteVentaElectronica: true }];
  const fusionado = fusionarConSnapshotFresco(listDeLaSesion, {});
  assert.deepStrictEqual(fusionado[0], listDeLaSesion[0]);
});

// ---------------------------------------------------------------------------
console.log('\nDisponibilidad real (fixtures genéricos, sin ids/locales del caso real):');

// Artículo auxiliar: activo para ambos canales, pero no vendible suelto.
const auxiliar = (id, { activoDelivery = true, activoMostrador = true, stockPropio = 10 } = {}) => ({
  [id]: {
    nombre: `Auxiliar ${id}`,
    activo: true,
    activoDelivery,
    activoMostrador,
    permiteVentaEfectivo: false,
    permiteVentaElectronica: false,
    controlStock: true,
    stock: { stockType: 'propio', propio: stockPropio },
  },
});

check('esArticuloSoloParaPromocion: true solo con los DOS flags explícitamente en false', () => {
  assert.strictEqual(esArticuloSoloParaPromocion({ permiteVentaEfectivo: false, permiteVentaElectronica: false }), true);
  assert.strictEqual(esArticuloSoloParaPromocion({ permiteVentaEfectivo: false, permiteVentaElectronica: true }), false);
  assert.strictEqual(esArticuloSoloParaPromocion({ permiteVentaEfectivo: true, permiteVentaElectronica: false }), false);
  assert.strictEqual(esArticuloSoloParaPromocion({}), false, 'sin los campos (legacy/ausente) nunca es auxiliar');
  assert.strictEqual(esArticuloSoloParaPromocion({ permiteVentaEfectivo: false, permiteVentaElectronica: false, valor: 0 }), true, 'el precio $0 no es parte del criterio');
  assert.strictEqual(esArticuloSoloParaPromocion(null), false);
});

check('auxiliar CON stock: isArticleAvailable = true (usable como componente) a pesar de permiteVenta en false', () => {
  const articulos = auxiliar('AUX1');
  assert.strictEqual(isArticleAvailable('AUX1', articulos, {}, 'delivery'), true);
  assert.strictEqual(isArticleAvailable('AUX1', articulos, {}, 'counter'), true);
});

check('auxiliar SIN stock: isArticleAvailable = false (el bloqueo es por stock, no por permiteVenta)', () => {
  const articulos = auxiliar('AUX1', { stockPropio: 0 });
  assert.strictEqual(isArticleAvailable('AUX1', articulos, {}, 'delivery'), false);
});

check('promo FIJA que depende de un auxiliar con stock -> disponible', () => {
  const articulos = auxiliar('AUX1');
  const promo = { promoItems: [{ codigo: 'AUX1', cantidad: 1 }] };
  assert.strictEqual(isPromoAvailable(promo, articulos, {}, [], 'delivery'), true);
});

check('promo FIJA que depende de un auxiliar SIN stock -> bloqueada', () => {
  const articulos = auxiliar('AUX1', { stockPropio: 0 });
  const promo = { promoItems: [{ codigo: 'AUX1', cantidad: 1 }] };
  assert.strictEqual(isPromoAvailable(promo, articulos, {}, [], 'delivery'), false);
});

check('GRUPO de elección con una opción auxiliar sin stock: esa opción se excluye, pero quedan las demás y la promo sigue disponible', () => {
  const articulos = {
    ...auxiliar('AUX1', { stockPropio: 0 }), // auxiliar agotado
    NORMAL1: {
      nombre: 'Normal 1', activo: true, activoDelivery: true, activoMostrador: true,
      permiteVentaEfectivo: true, permiteVentaElectronica: true,
      controlStock: true, stock: { stockType: 'propio', propio: 5 },
    },
  };
  const grupos = [{ id: 'G1', articulos: ['AUX1', 'NORMAL1'] }];
  const promoItem = { tipo: 'grupo', grupoId: 'G1' };

  // 1. opcionesDisponiblesDeGrupo: el auxiliar agotado no aparece, NORMAL1 sí.
  const idsDisponibles = new Set(
    Object.keys(articulos).filter((id) => isArticleAvailable(id, articulos, {}, 'delivery')),
  );
  const opciones = opcionesDisponiblesDeGrupo(promoItem, grupos, Object.entries(articulos).map(([id, a]) => ({ id, ...a })), idsDisponibles);
  assert.deepStrictEqual(opciones.map((o) => o.id), ['NORMAL1']);

  // 2. La promo en sí sigue disponible (alcanza con 1 opción para min=1).
  const promo = { promoItems: [promoItem] };
  assert.strictEqual(isPromoAvailable(promo, articulos, {}, grupos, 'delivery'), true);
});

check('GRUPO de elección donde la ÚNICA opción es un auxiliar CON stock: disponible (ser auxiliar no lo descalifica)', () => {
  const articulos = auxiliar('AUX1');
  const grupos = [{ id: 'G1', articulos: ['AUX1'] }];
  const promo = { promoItems: [{ tipo: 'grupo', grupoId: 'G1' }] };
  assert.strictEqual(isPromoAvailable(promo, articulos, {}, grupos, 'delivery'), true);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
