// Lo que se OFRECE dentro de una promoción tiene que ser lo mismo que se
// ofrece fuera de ella.
//
// El bug: el filtro de disponibilidad de las opciones de un grupo corría SOLO
// si la promo tenía `stock.descuentaPorArticulo === true`. Las promos sin esa
// marca ofrecían todos los artículos del grupo, incluidos los agotados, y
// recién fallaban al intentar descontar. La disponibilidad de una opción no
// depende de CÓMO descuenta la promo.
//
// Los fixtures son datos REALES de producción (12/08/2026).
//
// Correr con: node src/lib/api/__tests__/opcionesPromoGrupo.test.js
import assert from 'node:assert';
import { opcionesDisponiblesDeGrupo, getGroupOptionIds } from '../stockAvailability.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// ACHAVAL — grupo 1GP "GIO", 7 artículos. Tres en cero y apagados para delivery.
// ---------------------------------------------------------------------------
const GIO_ACHAVAL = [
  { id: '19A',  nombre: 'GIO FRAMBUESA COOKIES',        stock: { stockType: 'propio', propio: 14 }, activoDelivery: true },
  { id: '1A',   nombre: 'GIO FRAMBUESA PISTACHO',       stock: { stockType: 'propio', propio: 7 },  activoDelivery: true },
  { id: '145A', nombre: 'GIO FRUTILLA COOKIES',         stock: { stockType: 'propio', propio: 0 },  activoDelivery: false },
  { id: '137A', nombre: 'GIO MORAS D/ CHOCOLATE',       stock: { stockType: 'propio', propio: 0 },  activoDelivery: false },
  { id: '17A',  nombre: 'GIO FRAMBUESA D/ CHOCOLATE',   stock: { stockType: 'propio', propio: 27 }, activoDelivery: true },
  { id: '18A',  nombre: 'GIO FRAMBUESAS VEGANAS',       stock: { stockType: 'propio', propio: 5 },  activoDelivery: true },
  { id: '141A', nombre: 'GIO FRUTILLA DOBLE CHOCOLATE', stock: { stockType: 'propio', propio: 0 },  activoDelivery: false },
];

const GRUPOS = [{ id: '1GP', nombre: 'GIO', articulos: GIO_ACHAVAL.map((a) => a.id) }];

/** Lo que `useStockVerification` deja pasar: los que hoy se pueden vender. */
const DISPONIBLES = new Set(['19A', '1A', '17A', '18A']);

/** Ítem de grupo SIN `permitidos`: la promo ofrece todo el grupo. */
const itemTodoElGrupo = { tipo: 'grupo', grupoId: '1GP', nombre: 'GIO a elección', cantidad: 1 };

const nombres = (arr) => arr.map((o) => o.id);

console.log('\nOpciones de un grupo dentro de una promoción:');

check('los agotados NO se ofrecen; los que tienen stock sí', () => {
  const r = opcionesDisponiblesDeGrupo(itemTodoElGrupo, GRUPOS, GIO_ACHAVAL, DISPONIBLES);
  assert.deepStrictEqual(nombres(r), ['19A', '1A', '17A', '18A']);
  for (const agotado of ['145A', '137A', '141A']) {
    assert.ok(!nombres(r).includes(agotado), `${agotado} está en cero y no se puede ofrecer`);
  }
});

check('la promo no depende de `descuentaPorArticulo`: el filtro es el mismo', () => {
  // La función ni siquiera recibe la promo: solo el ítem, el grupo y qué hay
  // disponible. No hay forma de que una marca de la promo lo saltee.
  const r = opcionesDisponiblesDeGrupo(itemTodoElGrupo, GRUPOS, GIO_ACHAVAL, DISPONIBLES);
  assert.strictEqual(r.length, 4);
});

check('reponer stock devuelve la opción automáticamente', () => {
  const repuesto = new Set([...DISPONIBLES, '141A']);
  const r = opcionesDisponiblesDeGrupo(itemTodoElGrupo, GRUPOS, GIO_ACHAVAL, repuesto);
  assert.ok(nombres(r).includes('141A'), 'con stock repuesto vuelve a ofrecerse');
  assert.strictEqual(r.length, 5);
});

check('se respeta `permitidos` y ADEMÁS la disponibilidad', () => {
  // El item real de 170A restringe a 4; si uno de esos se agota, quedan 3.
  const item = { ...itemTodoElGrupo, permitidos: ['19A', '1A', '17A', '18A'] };
  assert.deepStrictEqual(nombres(opcionesDisponiblesDeGrupo(item, GRUPOS, GIO_ACHAVAL, DISPONIBLES)), ['19A', '1A', '17A', '18A']);
  const sinPistacho = new Set(['19A', '17A', '18A']);
  assert.deepStrictEqual(nombres(opcionesDisponiblesDeGrupo(item, GRUPOS, GIO_ACHAVAL, sinPistacho)), ['19A', '17A', '18A']);
});

check('`permitidos` que apunta a un artículo inexistente no rompe', () => {
  const item = { ...itemTodoElGrupo, permitidos: ['19A', 'NO-EXISTE'] };
  assert.deepStrictEqual(nombres(opcionesDisponiblesDeGrupo(item, GRUPOS, GIO_ACHAVAL, DISPONIBLES)), ['19A']);
});

check('catálogo verificado sin cargar todavía → NO se filtra', () => {
  // Vaciar el grupo acá cancelaría la promo por error: "no sé nada" no es
  // "no hay nada".
  const r = opcionesDisponiblesDeGrupo(itemTodoElGrupo, GRUPOS, GIO_ACHAVAL, new Set());
  assert.strictEqual(r.length, 7, 'se ofrecen todas hasta saber cuáles están disponibles');
});

check('si NINGUNA opción está disponible, el grupo queda vacío', () => {
  const r = opcionesDisponiblesDeGrupo(itemTodoElGrupo, GRUPOS, GIO_ACHAVAL, new Set(['OTRO']));
  assert.strictEqual(r.length, 0, 'la promo no se puede armar y quien llama la cancela');
});

check('el orden del grupo se conserva', () => {
  const r = opcionesDisponiblesDeGrupo(itemTodoElGrupo, GRUPOS, GIO_ACHAVAL, new Set(['18A', '19A']));
  assert.deepStrictEqual(nombres(r), ['19A', '18A'], 'sigue el orden del grupo, no el del Set');
});

// ---------------------------------------------------------------------------
// Los otros dos locales que tenían el mismo problema, con sus datos reales.
// ---------------------------------------------------------------------------
console.log('\nLos otros locales afectados (mismo grupo, otra promo):');

check('Temperley 134A: los 4 GIO agotados dejan de ofrecerse', () => {
  const arts = [
    { id: '99A',  nombre: 'GIO DOBLE CHOCOLATE',             stock: { propio: 0 } },
    { id: '106A', nombre: 'GIO PISTACHO Y CHOCO BLANCO',     stock: { propio: 0 } },
    { id: '102A', nombre: 'GIO CHOCOLATE BLANCO Y COOKIES',  stock: { propio: 0 } },
    { id: '104A', nombre: 'GIO FRAMBUESAS VEGANAS',          stock: { propio: 0 } },
    { id: '110A', nombre: 'GIO CON STOCK',                   stock: { propio: 6 } },
  ];
  const grupos = [{ id: 'G1', articulos: arts.map((a) => a.id) }];
  const item = { tipo: 'grupo', grupoId: 'G1', cantidad: 1 };
  const r = opcionesDisponiblesDeGrupo(item, grupos, arts, new Set(['110A']));
  assert.deepStrictEqual(nombres(r), ['110A']);
});

check('Centenario 142A: los 2 GIO agotados dejan de ofrecerse', () => {
  const arts = [
    { id: '112A', nombre: 'GIO MORAS DOBLE CHOCOLATE',   stock: { propio: 0 } },
    { id: '102A', nombre: 'GIO BANANAS DOBLE CHOCOLATE', stock: { propio: 0 } },
    { id: '120A', nombre: 'GIO CON STOCK',               stock: { propio: 3 } },
  ];
  const grupos = [{ id: 'G2', articulos: arts.map((a) => a.id) }];
  const item = { tipo: 'grupo', grupoId: 'G2', cantidad: 1 };
  assert.deepStrictEqual(nombres(opcionesDisponiblesDeGrupo(item, grupos, arts, new Set(['120A']))), ['120A']);
});

console.log('\nLo que no cambia:');

check('getGroupOptionIds sigue devolviendo los ids sin filtrar', () => {
  // Se usa para OTRA pregunta (¿la promo es vendible?), y no debe filtrar.
  assert.strictEqual(getGroupOptionIds(itemTodoElGrupo, GRUPOS).length, 7);
  assert.deepStrictEqual(getGroupOptionIds({ ...itemTodoElGrupo, permitidos: ['1A'] }, GRUPOS), ['1A']);
});

check('un grupo inexistente no rompe: devuelve vacío', () => {
  const r = opcionesDisponiblesDeGrupo({ tipo: 'grupo', grupoId: 'NO-EXISTE' }, GRUPOS, GIO_ACHAVAL, DISPONIBLES);
  assert.deepStrictEqual(r, []);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
