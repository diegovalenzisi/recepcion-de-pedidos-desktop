// Artículo AUXILIAR de promoción: permiteVentaEfectivo=false Y
// permiteVentaElectronica=false (las DOS, explícitamente en `false` — no
// "ausente"). Regla de negocio:
//
//   - NO debe listarse como artículo individual en Mostrador ni Delivery.
//   - SÍ debe seguir siendo un componente válido de promoItems/grupos de
//     productos: disponibilidad, cálculo de stock/receta y venta de la promo
//     que lo usa NO dependen de estos dos flags, solo de
//     activo/activoDelivery/activoMostrador + stock/receta (igual que
//     cualquier otro artículo).
//
// Caso real que motivó esto: local 40508022 (Achaval), promos "GRATIS 1/4
// LLEVANDO 1 KILO" (9A) y "PROMO 1 KILO Y 1/2 DE HELADO" (130A), cuyos
// promoItems fijos apuntan a artículos pensados para no venderse sueltos
// (65A, 3A, 77A). La prueba es GENÉRICA: no depende de ese local ni de esos
// ids — fixtures propios, sin ningún id/local hardcodeado del caso real.
//
// Correr con: node src/lib/api/__tests__/articuloAuxiliarPromo.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isArticleAvailable, isPromoAvailable, opcionesDisponiblesDeGrupo } from '../stockAvailability.js';

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

console.log('Fuente: los flags de venta NUNCA entran en la disponibilidad de un componente de promo:');

check('stockAvailability.js (isArticleAvailable/isPromoAvailable) no lee permiteVentaEfectivo ni permiteVentaElectronica', () => {
  assert.ok(!/permiteVenta/.test(stockAvailabilitySrc));
});

check('promotionStockAutomation.js no lee permiteVentaEfectivo ni permiteVentaElectronica', () => {
  assert.ok(!/permiteVenta/.test(promotionStockAutomationSrc));
});

check('usePromo.js sigue resolviendo ítems fijos/grupos contra allArticles y verifiedArticles, no filtra por permiteVenta', () => {
  assert.ok(!/permiteVenta/.test(usePromoSrc));
});

console.log('\nFuente: el ocultamiento individual vive SOLO en la grilla (NewOrderModal), no en verifiedArticles:');

check('articlesByDept excluye el artículo auxiliar (permiteVentaEfectivo=false && permiteVentaElectronica=false)', () => {
  const i = newOrderModalSrc.indexOf('const articlesByDept');
  assert.ok(i > 0, 'no se encontró articlesByDept');
  const bloque = newOrderModalSrc.slice(i, i + 1000);
  assert.ok(/a\.permiteVentaEfectivo === false && a\.permiteVentaElectronica === false/.test(bloque));
});

check('el filtro de auxiliar no toca verifiedArticles (lo sigue usando usePromo para resolver grupos)', () => {
  // verifiedArticles se sigue pasando TAL CUAL a usePromo — la exclusión del
  // auxiliar ocurre sobre una copia (individualmenteVisibles), no sobre
  // verifiedArticles en sí.
  assert.ok(/usePromo\(\{[^}]*verifiedArticles/.test(newOrderModalSrc));
  const i = newOrderModalSrc.indexOf('const articlesByDept');
  const bloque = newOrderModalSrc.slice(i, i + 1000);
  assert.ok(/individualmenteVisibles = verifiedArticles\.filter/.test(bloque));
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
