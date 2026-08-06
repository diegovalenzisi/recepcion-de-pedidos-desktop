// Paridad de disponibilidad entre MOSTRADOR y DELIVERY.
//
// Caso real que motivó todo esto (local Bynnon): VASITOS X 5 se elabora con una
// receta que consume la materia prima "Vasitos". Cuando Vasitos llegó a 0 el
// artículo desapareció de Delivery pero siguió apareciendo en Mostrador, porque
// cada canal decidía con una fórmula distinta y la de Mostrador no miraba
// recetas.
//
// Acá se verifica que la regla sea UNA SOLA y dé lo mismo en los dos canales, y
// que la revalidación previa a cobrar bloquee con la cantidad real del carrito.
//
// Correr con: node src/lib/api/__tests__/disponibilidadMostrador.test.js
import assert from 'node:assert';
import {
  isArticleAvailable,
  getAvailableUnits,
  isPromoAvailable,
  materiasPrimasBloqueantes,
  recetaTieneCiclo,
  BLOQUEO_RECETA_CIRCULAR,
} from '../stockAvailability.js';
import { evaluarStockDeCarrito, mensajeDeBloqueo } from '../validacionStockVenta.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// --- Catálogo de Bynnon ----------------------------------------------------
// VASITOS X 5 consume 5 "Vasitos". El resto sirve de control: un artículo con
// stock propio, uno ilimitado, uno con receta de dos materias primas y uno
// anidado (usa a otro artículo por receta).
const materiaBase = () => ({
  'M-VASITOS': { nombre: 'Vasitos', stock: 100 },
  'M-DULCE':   { nombre: 'Dulce de leche', stock: 10 },
  'M-OBLEA':   { nombre: 'Obleas', stock: 50 },
});

const articulosBase = () => ({
  'A-VASITOS-5': {
    nombre: 'VASITOS X 5', activo: true, activoDelivery: true, activoMostrador: true,
    stock: { stockType: 'receta', receta: { 'M-VASITOS': 5 } },
  },
  'A-COPA-DOBLE': {
    nombre: 'Copa doble', activo: true, activoDelivery: true, activoMostrador: true,
    stock: { stockType: 'receta', receta: { 'M-VASITOS': 2, 'M-DULCE': 0.2 } },
  },
  'A-COMBO': {
    // Receta ANIDADA: usa un artículo que a su vez tiene receta.
    nombre: 'Combo vasitos + oblea', activo: true, activoDelivery: true, activoMostrador: true,
    stock: { stockType: 'receta', receta: { 'A-VASITOS-5': 1, 'M-OBLEA': 2 } },
  },
  'A-GASEOSA': {
    nombre: 'Gaseosa', activo: true, activoDelivery: true, activoMostrador: true,
    stock: { stockType: 'propio', propio: 5 },
  },
  'A-CAFE': {
    nombre: 'Café', activo: true, activoDelivery: true, activoMostrador: true,
    controlStock: false, stock: { stockType: 'propio', propio: 0 },
  },
});

// Catálogo con una receta CIRCULAR: A-CICLO-1 usa A-CICLO-2 y viceversa.
const conCiclo = () => {
  const articulos = articulosBase();
  articulos['A-CICLO-1'] = { nombre: 'Ciclo 1', activo: true, activoMostrador: true, activoDelivery: true, stock: { stockType: 'receta', receta: { 'A-CICLO-2': 1 } } };
  articulos['A-CICLO-2'] = { nombre: 'Ciclo 2', activo: true, activoMostrador: true, activoDelivery: true, stock: { stockType: 'receta', receta: { 'A-CICLO-1': 1 } } };
  return articulos;
};

const enLosDosCanales = (id, articulos, materiaPrima) => ({
  mostrador: isArticleAvailable(id, articulos, materiaPrima, 'counter'),
  delivery: isArticleAvailable(id, articulos, materiaPrima, 'delivery'),
});

// ---------------------------------------------------------------------------
console.log('\nCaso Bynnon — VASITOS X 5 (la receta pide 5 Vasitos):');

check('necesita 5, hay 0 → oculto en Mostrador Y en Delivery', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 0;
  const r = enLosDosCanales('A-VASITOS-5', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false, 'seguía visible en Mostrador (el bug original)');
  assert.strictEqual(r.delivery, false);
});

check('necesita 5, hay 4 → oculto en los dos (no alcanza con "> 0")', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 4;
  const r = enLosDosCanales('A-VASITOS-5', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('necesita 5, hay 5 → visible en los dos', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 5;
  const r = enLosDosCanales('A-VASITOS-5', articulosBase(), mp);
  assert.strictEqual(r.mostrador, true);
  assert.strictEqual(r.delivery, true);
});

check('se repone la materia prima → reaparece sola, sin tocar ningún activo', () => {
  const articulos = articulosBase();
  const mp = materiaBase(); mp['M-VASITOS'].stock = 0;
  assert.strictEqual(isArticleAvailable('A-VASITOS-5', articulos, mp, 'counter'), false);

  mp['M-VASITOS'].stock = 20;                       // reposición
  assert.strictEqual(isArticleAvailable('A-VASITOS-5', articulos, mp, 'counter'), true);
  assert.strictEqual(isArticleAvailable('A-VASITOS-5', articulos, mp, 'delivery'), true);
  // Nada persistido cambió: la disponibilidad es 100% derivada.
  assert.strictEqual(articulos['A-VASITOS-5'].activoMostrador, true);
  assert.strictEqual(articulos['A-VASITOS-5'].activoDelivery, true);
});

check('el activo manual de Mostrador sigue mandando aunque sobre stock', () => {
  const articulos = articulosBase();
  articulos['A-VASITOS-5'].activoMostrador = false;   // apagado A MANO
  const mp = materiaBase();                            // 100 vasitos
  assert.strictEqual(isArticleAvailable('A-VASITOS-5', articulos, mp, 'counter'), false);
  assert.strictEqual(isArticleAvailable('A-VASITOS-5', articulos, mp, 'delivery'), true,
    'apagar Mostrador a mano no debe tocar Delivery');
});

// ---------------------------------------------------------------------------
console.log('\nVarias materias primas y recetas anidadas:');

check('si falta CUALQUIERA de las dos materias primas, se oculta', () => {
  const mp = materiaBase(); mp['M-DULCE'].stock = 0.1;   // la receta pide 0,2
  const r = enLosDosCanales('A-COPA-DOBLE', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('con las dos materias primas alcanzando, se ve', () => {
  const r = enLosDosCanales('A-COPA-DOBLE', articulosBase(), materiaBase());
  assert.strictEqual(r.mostrador, true);
  assert.strictEqual(r.delivery, true);
});

check('receta anidada: falla la materia prima del artículo interno', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 4;   // el interno pide 5
  const r = enLosDosCanales('A-COMBO', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('receta anidada: falla la materia prima del nivel externo', () => {
  const mp = materiaBase(); mp['M-OBLEA'].stock = 1;     // el combo pide 2
  const r = enLosDosCanales('A-COMBO', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('receta anidada completa → visible', () => {
  const r = enLosDosCanales('A-COMBO', articulosBase(), materiaBase());
  assert.strictEqual(r.mostrador, true);
  assert.strictEqual(r.delivery, true);
});

// ---------------------------------------------------------------------------
console.log('\nLo que NO tiene que cambiar:');

check('stock propio: se ve con stock y se oculta en cero, como siempre', () => {
  const articulos = articulosBase();
  assert.strictEqual(isArticleAvailable('A-GASEOSA', articulos, materiaBase(), 'counter'), true);
  articulos['A-GASEOSA'].stock.propio = 0;
  const r = enLosDosCanales('A-GASEOSA', articulos, materiaBase());
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('controlStock === false con stock PROPIO: ilimitado, no se oculta nunca', () => {
  const r = enLosDosCanales('A-CAFE', articulosBase(), materiaBase());
  assert.strictEqual(r.mostrador, true);
  assert.strictEqual(r.delivery, true);
});

check('ELABORADO con receta y controlStock false: SÍ se oculta si falta materia prima', () => {
  // Caso real de Bynnon: "1 BOCHA" / "2 BOCHAS". El interruptor apagado no los
  // hace ilimitados; solo dice que no llevan cuenta propia de unidades.
  const articulos = articulosBase();
  articulos['A-BOCHA'] = {
    nombre: '1 BOCHA', activo: true, activoMostrador: true, activoDelivery: false,
    controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-VASITOS': 1 } },
  };

  const mp = materiaBase(); mp['M-VASITOS'].stock = 0;
  assert.strictEqual(isArticleAvailable('A-BOCHA', articulos, mp, 'counter'), false,
    'con la materia prima en cero no puede seguir en Mostrador');

  // Se vende SOLO por Mostrador (activoDelivery false): la receta se evalúa igual.
  assert.strictEqual(isArticleAvailable('A-BOCHA', articulos, mp, 'delivery'), false);

  mp['M-VASITOS'].stock = 1;
  assert.strictEqual(isArticleAvailable('A-BOCHA', articulos, mp, 'counter'), true);
});

check('ELABORADO sin cuenta propia: también respeta la CANTIDAD de la receta', () => {
  const articulos = articulosBase();
  articulos['A-BOCHA-2'] = {
    nombre: 'Bocha doble', activo: true, activoMostrador: true, activoDelivery: true,
    controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-VASITOS': 2 } },
  };
  const mp = materiaBase(); mp['M-VASITOS'].stock = 1;   // la receta pide 2
  const r = enLosDosCanales('A-BOCHA-2', articulos, mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('ELABORADO sin cuenta propia: el carrito también lo bloquea', () => {
  const articulos = articulosBase();
  articulos['A-BOCHA'] = {
    nombre: '1 BOCHA', activoMostrador: true, controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-VASITOS': 1 } },
  };
  const mp = materiaBase(); mp['M-VASITOS'].stock = 0;
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-BOCHA', quantity: 1 }], articulos, materiaPrima: mp });
  assert.strictEqual(r.suficiente, false);
  assert.strictEqual(r.faltantes[0].nombre, 'Vasitos');
});

check('"Ignora Stock" en la materia prima: no bloquea aunque esté en cero', () => {
  const mp = materiaBase();
  mp['M-VASITOS'].stock = 0;
  mp['M-VASITOS'].ignoraStock = true;
  const r = enLosDosCanales('A-VASITOS-5', articulosBase(), mp);
  assert.strictEqual(r.mostrador, true);
  assert.strictEqual(r.delivery, true);
});

check('"Ignora Stock" NO pisa una desactivación manual de la materia prima', () => {
  const mp = materiaBase();
  mp['M-VASITOS'].stock = 0;
  mp['M-VASITOS'].ignoraStock = true;
  mp['M-VASITOS'].activo = false;                    // apagada a mano
  const r = enLosDosCanales('A-VASITOS-5', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('stock legado guardado como número suelto sigue funcionando', () => {
  const articulos = articulosBase();
  articulos['A-LEGADO'] = { nombre: 'Legado', activoMostrador: true, activoDelivery: true, stock: 3 };
  assert.strictEqual(isArticleAvailable('A-LEGADO', articulos, materiaBase(), 'counter'), true);
  articulos['A-LEGADO'].stock = 0;
  assert.strictEqual(isArticleAvailable('A-LEGADO', articulos, materiaBase(), 'counter'), false);
});

check('artículo sin ninguna configuración de stock no se oculta', () => {
  const articulos = articulosBase();
  articulos['A-SIN-CONFIG'] = { nombre: 'Sin config', activoMostrador: true, activoDelivery: true, stock: {} };
  const r = enLosDosCanales('A-SIN-CONFIG', articulos, materiaBase());
  assert.strictEqual(r.mostrador, true);
  assert.strictEqual(r.delivery, true);
});

check('receta CIRCULAR: se oculta en Mostrador y en Delivery, y no cuelga', () => {
  // Una receta circular no se puede calcular, así que el artículo no se puede
  // producir: se oculta en los dos canales hasta que alguien corrija la receta.
  const articulos = conCiclo();
  const r = enLosDosCanales('A-CICLO-1', articulos, materiaBase());
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
  assert.strictEqual(recetaTieneCiclo('A-CICLO-1', articulos, materiaBase()), true);
});

check('receta circular: también sale de delivery, con bloqueante sentinela', () => {
  const bloqueantes = materiasPrimasBloqueantes('A-CICLO-1', conCiclo(), materiaBase());
  assert.deepStrictEqual(bloqueantes, [BLOQUEO_RECETA_CIRCULAR]);
});

check('corregir la receta destraba el artículo solo, sin tocar nada persistido', () => {
  const articulos = conCiclo();
  assert.strictEqual(isArticleAvailable('A-CICLO-1', articulos, materiaBase(), 'counter'), false);

  // Se corrige: en vez de apuntarse entre sí, el segundo usa una materia prima.
  articulos['A-CICLO-2'].stock = { stockType: 'receta', receta: { 'M-OBLEA': 1 } };
  assert.strictEqual(isArticleAvailable('A-CICLO-1', articulos, materiaBase(), 'counter'), true);
  assert.strictEqual(isArticleAvailable('A-CICLO-1', articulos, materiaBase(), 'delivery'), true);
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-CICLO-1', articulos, materiaBase()), []);
});

check('materia prima apagada A MANO con stock: oculta en Mostrador Y en Delivery', () => {
  // El hueco que expusieron los datos reales de Bynnon: `activo` no lo mira
  // ningún cálculo de stock, pero sí la automatización de delivery. Si el
  // catálogo no lo mirara, Mostrador mostraría lo que Delivery oculta.
  const mp = materiaBase();
  mp['M-VASITOS'].activo = false;           // apagada a mano, con 100 de stock
  const r = enLosDosCanales('A-VASITOS-5', articulosBase(), mp);
  assert.strictEqual(r.mostrador, false);
  assert.strictEqual(r.delivery, false);
});

check('un artículo sano NO se marca como circular por compartir materia prima', () => {
  // A-COPA-DOBLE y A-VASITOS-5 comparten M-VASITOS: eso no es un ciclo.
  assert.strictEqual(recetaTieneCiclo('A-COPA-DOBLE', articulosBase(), materiaBase()), false);
  assert.strictEqual(recetaTieneCiclo('A-COMBO', articulosBase(), materiaBase()), false);
  assert.strictEqual(recetaTieneCiclo('A-GASEOSA', articulosBase(), materiaBase()), false);
});

check('getAvailableUnits sigue dando la misma cantidad que antes', () => {
  const mp = materiaBase();                            // 100 vasitos, receta de 5
  assert.strictEqual(getAvailableUnits('A-VASITOS-5', articulosBase(), mp), 20);
  mp['M-VASITOS'].stock = 4;
  assert.strictEqual(getAvailableUnits('A-VASITOS-5', articulosBase(), mp), 0);
  assert.strictEqual(getAvailableUnits('A-CAFE', articulosBase(), mp), Infinity);
});

check('promoción por artículos reales: usa la misma regla de receta', () => {
  const articulos = articulosBase();
  articulos['A-PROMO'] = {
    nombre: 'Promo vasitos', isPromo: true, activoMostrador: true, activoDelivery: true,
    stock: { descuentaPorArticulo: true },
    promoItems: [{ codigo: 'A-VASITOS-5', cantidad: 1 }],
  };
  const mp = materiaBase(); mp['M-VASITOS'].stock = 4;   // no alcanza para 1 unidad
  assert.strictEqual(isPromoAvailable(articulos['A-PROMO'], articulos, mp, [], 'counter'), false);
  mp['M-VASITOS'].stock = 5;
  assert.strictEqual(isPromoAvailable(articulos['A-PROMO'], articulos, mp, [], 'counter'), true);
});

// ---------------------------------------------------------------------------
console.log('\nApagado automático de Delivery: ahora mira cantidades, no "> 0":');

check('la receta pide 5 y hay 4 → la materia prima BLOQUEA (antes no)', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 4;
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-VASITOS-5', articulosBase(), mp), ['M-VASITOS']);
});

check('la receta pide 5 y hay 5 → no bloquea', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 5;
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-VASITOS-5', articulosBase(), mp), []);
});

check('materia prima en cero: sigue bloqueando, como siempre', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 0;
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-VASITOS-5', articulosBase(), mp), ['M-VASITOS']);
});

check('materia prima apagada A MANO con stock de sobra: sigue bloqueando', () => {
  const mp = materiaBase(); mp['M-VASITOS'].activo = false;   // 100 de stock
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-VASITOS-5', articulosBase(), mp), ['M-VASITOS']);
});

check('"Ignora Stock" no bloquea aunque no alcance', () => {
  const mp = materiaBase();
  mp['M-VASITOS'].stock = 1;
  mp['M-VASITOS'].ignoraStock = true;
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-VASITOS-5', articulosBase(), mp), []);
});

check('con varias materias primas se listan todas las que faltan, sin repetir', () => {
  const mp = materiaBase();
  mp['M-VASITOS'].stock = 1;   // la receta pide 2
  mp['M-DULCE'].stock = 0;     // la receta pide 0,2
  const r = materiasPrimasBloqueantes('A-COPA-DOBLE', articulosBase(), mp);
  assert.deepStrictEqual(r.sort(), ['M-DULCE', 'M-VASITOS']);
});

check('receta anidada: bloquea la materia prima del nivel interno', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 4;   // el artículo interno pide 5
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-COMBO', articulosBase(), mp), ['M-VASITOS']);
});

check('artículo sin receta: nunca tiene materias primas bloqueantes', () => {
  const articulos = articulosBase();
  articulos['A-GASEOSA'].stock.propio = 0;
  assert.deepStrictEqual(materiasPrimasBloqueantes('A-GASEOSA', articulos, materiaBase()), []);
});

// ---------------------------------------------------------------------------
console.log('\nRevalidación al confirmar/cobrar (cantidad REAL del carrito):');

const carrito = (items) => evaluarStockDeCarrito({ items, articulos: articulosBase(), materiaPrima: materiaBase() });

check('1 unidad con 100 vasitos: pasa', () => {
  const r = carrito([{ id: 'A-VASITOS-5', quantity: 1 }]);
  assert.strictEqual(r.suficiente, true, JSON.stringify(r.faltantes));
});

check('el catálogo deja agregar 1, pero 21 unidades ya no entran (100 / 5)', () => {
  const ok = carrito([{ id: 'A-VASITOS-5', quantity: 20 }]);
  assert.strictEqual(ok.suficiente, true);

  const no = carrito([{ id: 'A-VASITOS-5', quantity: 21 }]);
  assert.strictEqual(no.suficiente, false);
  assert.strictEqual(no.faltantes.length, 1);
  assert.strictEqual(no.faltantes[0].nombre, 'Vasitos');
  assert.strictEqual(no.faltantes[0].requerido, 105);
  assert.strictEqual(no.faltantes[0].stockActual, 100);
});

check('carrito abierto y la materia prima se agota → bloquea al confirmar', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 0;   // se agotó mientras tanto
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-VASITOS-5', quantity: 1 }], articulos: articulosBase(), materiaPrima: mp });
  assert.strictEqual(r.suficiente, false);
  assert.match(mensajeDeBloqueo(r), /Vasitos: se necesitan 5 y hay 0/);
});

check('el mismo artículo en dos líneas se SUMA (no se evalúa por separado)', () => {
  // 11 + 10 = 21 unidades → 105 vasitos > 100. Por separado, cada línea pasaría.
  const r = carrito([
    { id: 'A-VASITOS-5', quantity: 11 },
    { id: 'A-VASITOS-5', quantity: 10, uniqueId: 'A-VASITOS-5-2' },
  ]);
  assert.strictEqual(r.suficiente, false);
  assert.strictEqual(r.faltantes[0].requerido, 105);
});

check('dos artículos DISTINTOS que comparten materia prima se suman entre sí', () => {
  // VASITOS X 5 ×18 = 90 vasitos; Copa doble ×6 = 12 vasitos. Cada uno solo
  // entra; juntos son 102 > 100.
  const solo1 = carrito([{ id: 'A-VASITOS-5', quantity: 18 }]);
  const solo2 = carrito([{ id: 'A-COPA-DOBLE', quantity: 6 }]);
  assert.strictEqual(solo1.suficiente, true);
  assert.strictEqual(solo2.suficiente, true);

  const juntos = carrito([
    { id: 'A-VASITOS-5', quantity: 18 },
    { id: 'A-COPA-DOBLE', quantity: 6 },
  ]);
  assert.strictEqual(juntos.suficiente, false);
  assert.strictEqual(juntos.faltantes[0].nombre, 'Vasitos');
  assert.strictEqual(juntos.faltantes[0].requerido, 102);
});

check('receta anidada: el consumo del artículo interno también se controla', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 4;
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-COMBO', quantity: 1 }], articulos: articulosBase(), materiaPrima: mp });
  assert.strictEqual(r.suficiente, false);
  assert.strictEqual(r.faltantes[0].nombre, 'Vasitos');
  assert.strictEqual(r.faltantes[0].requerido, 5);
});

check('varias materias primas faltantes se informan TODAS', () => {
  const mp = materiaBase(); mp['M-VASITOS'].stock = 0; mp['M-DULCE'].stock = 0;
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-COPA-DOBLE', quantity: 1 }], articulos: articulosBase(), materiaPrima: mp });
  assert.strictEqual(r.suficiente, false);
  assert.strictEqual(r.faltantes.length, 2);
  assert.deepStrictEqual(r.faltantes.map(f => f.nombre), ['Dulce de leche', 'Vasitos']);
});

check('artículo con stock propio: el carrito no puede superarlo', () => {
  const ok = carrito([{ id: 'A-GASEOSA', quantity: 5 }]);
  assert.strictEqual(ok.suficiente, true);
  const no = carrito([{ id: 'A-GASEOSA', quantity: 6 }]);
  assert.strictEqual(no.suficiente, false);
  assert.strictEqual(no.faltantes[0].nombre, 'Gaseosa');
});

check('controlStock === false e "Ignora Stock" nunca bloquean la venta', () => {
  assert.strictEqual(carrito([{ id: 'A-CAFE', quantity: 999 }]).suficiente, true);

  const mp = materiaBase();
  mp['M-VASITOS'].stock = 0;
  mp['M-VASITOS'].ignoraStock = true;
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-VASITOS-5', quantity: 50 }], articulos: articulosBase(), materiaPrima: mp });
  assert.strictEqual(r.suficiente, true);
});

check('receta circular en el carrito: BLOQUEA la venta, y no como faltante', () => {
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-CICLO-1', quantity: 1 }], articulos: conCiclo(), materiaPrima: materiaBase() });
  assert.strictEqual(r.suficiente, false, 'una receta circular no puede venderse');
  assert.strictEqual(r.faltantes.length, 0, 'no es un faltante de stock');
  assert.ok(r.ciclos.length > 0, 'debe reportarse como ciclo');
  const msg = mensajeDeBloqueo(r);
  assert.match(msg, /referencia circular/);
  assert.match(msg, /Corregí la receta/);
});

check('reponer materia prima NO destraba una receta circular', () => {
  const mp = materiaBase();
  mp['M-VASITOS'].stock = 99999;
  mp['M-OBLEA'].stock = 99999;
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-CICLO-1', quantity: 1 }], articulos: conCiclo(), materiaPrima: mp });
  assert.strictEqual(r.suficiente, false);
});

check('corregir la receta permite vender de nuevo', () => {
  const articulos = conCiclo();
  articulos['A-CICLO-2'].stock = { stockType: 'receta', receta: { 'M-OBLEA': 1 } };
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-CICLO-1', quantity: 1 }], articulos, materiaPrima: materiaBase() });
  assert.strictEqual(r.suficiente, true, JSON.stringify({ f: r.faltantes, c: r.ciclos }));
});

check('un carrito sano nunca reporta ciclos', () => {
  const r = carrito([{ id: 'A-COMBO', quantity: 2 }, { id: 'A-GASEOSA', quantity: 1 }]);
  assert.strictEqual(r.suficiente, true);
  assert.deepStrictEqual(r.ciclos, []);
});

check('carrito vacío no bloquea', () => {
  assert.strictEqual(carrito([]).suficiente, true);
  assert.strictEqual(mensajeDeBloqueo({ faltantes: [], ciclos: [] }), '');
});

check('el mensaje dice qué falta, cuánto se necesita y cuánto hay', () => {
  const mp = materiaBase(); mp['M-DULCE'].stock = 0.1;
  const r = evaluarStockDeCarrito({ items: [{ id: 'A-COPA-DOBLE', quantity: 1 }], articulos: articulosBase(), materiaPrima: mp });
  const msg = mensajeDeBloqueo(r);
  assert.match(msg, /Dulce de leche/);
  assert.match(msg, /se necesitan 0\.2 y hay 0\.1/);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
