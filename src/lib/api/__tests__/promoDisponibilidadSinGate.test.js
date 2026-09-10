// GUARDA: la disponibilidad de una promo con grupos de elección YA NO se
// calcula solo cuando `stock.descuentaPorArticulo === true`.
//
// Causa raíz real (local 38827976, promo "1/4 KILO + FRAMBUESAS A ELECCION",
// grupo GIO): las promos armadas con `promoItems` casi nunca tienen ese flag
// en `true` (es un flag de CÓMO se descuenta el stock al vender, no de
// disponibilidad). Gateadas detrás de él, esas promos caían al camino que
// evalúa el `stock` propio/heredado DE LA PROMO MISMA — que para una promo
// suele ser basura (`heredadoDe: ""`, `controlStock: false`, etc.) — en vez de
// evaluarse por sus componentes reales (ítems fijos + grupos de elección).
//
// Esta prueba audita el TEXTO FUENTE real (igual que
// promoGrupoDisponibilidad.test.js para useAppData.jsx en DLV Pedidos):
// confirma que el gate quedó sacado y que no vuelve a aparecer en un revert.
//
// Correr con: node src/lib/api/__tests__/promoDisponibilidadSinGate.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const aquí = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(aquí, '../../../..');
const leer = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const useStockVerificationSrc = leer('src/hooks/useStockVerification.js');
const promotionStockAutomationSrc = leer('src/lib/api/promotionStockAutomation.js');
const usePromoSrc = leer('src/hooks/usePromo.js');

console.log('useStockVerification.js:');

check('ya NO gatea isPromoAvailable detrás de stock.descuentaPorArticulo === true', () => {
  assert.ok(
    !/rtArticle\.stock\?\.descuentaPorArticulo\s*===\s*true/.test(useStockVerificationSrc),
    'sigue condicionando isPromoAvailable al flag descuentaPorArticulo',
  );
});

check('cualquier promo con promoItems (o promoDetails) pasa por isPromoAvailable', () => {
  assert.ok(/rtArticle\.isPromo\s*&&\s*promoItems\.length\s*>\s*0/.test(useStockVerificationSrc));
  assert.ok(/return isPromoAvailable\(/.test(useStockVerificationSrc));
});

check('la red de seguridad contra OOS en tiempo real también exime a CUALQUIER promo con componentes, no solo a las de descuentaPorArticulo', () => {
  assert.ok(!/a\.stock\?\.descuentaPorArticulo\s*===\s*true/.test(useStockVerificationSrc));
  assert.ok(/a\.isPromo\s*&&\s*aPromoItems\.length\s*>\s*0/.test(useStockVerificationSrc));
});

console.log('\npromotionStockAutomation.js (auto-toggle de activoDelivery):');

check('checkAndUpdatePromotionStockStatus ya no tiene el modo "legacy" que ignoraba los grupos', () => {
  assert.ok(
    !/if\s*\(\s*targetArt\s*&&\s*targetArt\.stock\s*&&\s*targetArt\.stock\.propio\s*===\s*0\s*\)/.test(promotionStockAutomationSrc),
    'sigue existiendo el chequeo legacy por ítem (que no entendía grupos de elección)',
  );
});

check('usa isPromoAvailable incondicionalmente para cualquier promo con promoItems', () => {
  const i = promotionStockAutomationSrc.indexOf('checkAndUpdatePromotionStockStatus');
  const bloque = promotionStockAutomationSrc.slice(i, i + 2500);
  assert.ok(/!isPromoAvailable\(/.test(bloque));
  assert.ok(!/item\.stock\?\.descuentaPorArticulo\s*===\s*true/.test(bloque));
});

check('getPromotionArticleStockStatus ya no tiene el modo "legacy" ni el gate', () => {
  const i = promotionStockAutomationSrc.indexOf('getPromotionArticleStockStatus');
  const bloque = promotionStockAutomationSrc.slice(i);
  assert.ok(!/promoData\.stock\?\.descuentaPorArticulo\s*===\s*true/.test(bloque));
  assert.ok(!/targetArt\.stock\?\.propio\s*\|\|\s*0/.test(bloque));
});

check('el chequeo de grupo en getPromotionArticleStockStatus respeta minSeleccion (no solo "hay al menos una")', () => {
  const i = promotionStockAutomationSrc.indexOf('getPromotionArticleStockStatus');
  const bloque = promotionStockAutomationSrc.slice(i);
  assert.ok(/minRequired/.test(bloque), 'no calcula un mínimo requerido para el grupo');
  assert.ok(/availableCount\s*>=\s*minRequired/.test(bloque));
});

console.log('\nusePromo.js (selector al armar la promo en Mostrador/Delivery):');

check('un grupo ya no se marca vacío solo por "length === 0": ahora compara contra el mínimo requerido', () => {
  assert.ok(
    !/else if \(availableIds\.size > 0\) \{\s*\n\s*\/\/ Ninguna opción del grupo se puede vender/.test(usePromoSrc),
    'sigue usando la condición vieja que solo miraba "0 disponibles", ignorando minSeleccion',
  );
  assert.ok(/const minRequerido = \(promoItem\.minSeleccion > 0\) \? promoItem\.minSeleccion : 1;/.test(usePromoSrc));
  assert.ok(/options\.length < minRequerido/.test(usePromoSrc));
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
