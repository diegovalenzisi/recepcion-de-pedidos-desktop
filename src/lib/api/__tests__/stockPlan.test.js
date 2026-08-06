// Fase 2 — punto 8: agrupación por ruta física real de stock.
// Correr con: node src/lib/api/__tests__/stockPlan.test.js
import assert from 'node:assert';
import { construirPlanDeStock, resolverRutasFisicas, preflight, tipoDeStock } from '../stockPlan.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const ARTICULOS = {
  'A-KILO': { nombre: '1 KILO DE HELADO', stock: { stockType: 'receta', receta: { 'M-3': 0.25 } } },
  'A-ROCKLETS': { nombre: 'Rocklets', stock: { stockType: 'propio', propio: 20 } },
  'A-ROCKLETS-2': { nombre: 'Rocklets grande', stock: { stockType: 'heredado', heredadoDe: 'A-ROCKLETS' } },
  'A-ROCKLETS-3': { nombre: 'Rocklets chico', stock: { stockType: 'heredado', heredadoDe: 'A-ROCKLETS' } },
  'A-TOPPING-RECETA': { nombre: 'Topping por receta', stock: { stockType: 'receta', receta: { 'M-3': 0.25, 'M-9': 2 } } },
  'A-SIN-CONTROL': { nombre: 'Ilimitado', controlStock: false, stock: { stockType: 'propio', propio: 0 } },
  'A-CICLO-A': { nombre: 'Ciclo A', stock: { stockType: 'heredado', heredadoDe: 'A-CICLO-B' } },
  'A-CICLO-B': { nombre: 'Ciclo B', stock: { stockType: 'heredado', heredadoDe: 'A-CICLO-A' } },
  'A-FALTA-MP': { nombre: 'Receta rota', stock: { stockType: 'receta', receta: { 'M-NO-EXISTE': 1 } } },
  // Producto ELABORADO en su configuración normal: no lleva cuenta propia
  // (controlStock=false) porque su stock vive en la materia prima de la receta.
  // Es exactamente el caso de "1 KILO DE HELADO" en producción.
  'A-ELABORADO-SIN-CONTROL': {
    nombre: '1 KILO DE HELADO', controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-3': 1, 'M-9': 0.25 } },
  },
  'A-HEREDA-SIN-CONTROL': {
    nombre: 'Hereda pero no controla', controlStock: false,
    stock: { stockType: 'heredado', heredadoDe: 'A-ROCKLETS' },
  },
};
const MATERIA_PRIMA = {
  'M-3': { nombre: 'Azúcar', stock: 100 },
  'M-9': { nombre: 'Cacao', stock: 50 },
};

const plan = (items, opts = {}) => construirPlanDeStock({ items, articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA, ...opts });
const opcional = (over = {}) => ({
  nombre: 'Rocklets', origen: 'departamento', articleId: 'A-ROCKLETS',
  consumoStockUnitario: 1, cantidad: 1, controlaStock: true, ...over,
});

console.log('Resolución hasta la ruta física:');
check('stock propio → el propio artículo', () => {
  const { impactMap } = plan([{ id: 'A-ROCKLETS', quantity: 3 }]);
  assert.deepStrictEqual(impactMap, { 'A-ROCKLETS': { quantity: 3, type: 'ARTICULO' } });
});
check('stock heredado → el padre', () => {
  const { impactMap } = plan([{ id: 'A-ROCKLETS-2', quantity: 2 }]);
  assert.deepStrictEqual(impactMap, { 'A-ROCKLETS': { quantity: 2, type: 'ARTICULO' } });
});
check('receta → sus materias primas', () => {
  const { impactMap } = plan([{ id: 'A-KILO', quantity: 4 }]);
  assert.deepStrictEqual(impactMap, { 'M-3': { quantity: 1, type: 'MATERIA_PRIMA' } });
});
check('controlStock=false con stock PROPIO no mueve nada (sigue ilimitado)', () => {
  const { impactMap, avisos } = plan([{ id: 'A-SIN-CONTROL', quantity: 5 }]);
  assert.deepStrictEqual(impactMap, {});
  assert.ok(avisos.some((a) => a.tipo === 'sin-control-de-stock'));
});

// REGRESIÓN REAL (producción, local 40508022): 32 de los 42 artículos con
// receta tenían controlStock=false y por eso NUNCA descontaban materia prima.
// `controlStock` apaga la cuenta PROPIA del artículo, no el consumo de los
// recursos que sí llevan la suya.
console.log('\ncontrolStock=false NO cancela receta ni herencia:');
check('receta + controlStock=false → SÍ descuenta sus materias primas', () => {
  const { impactMap } = plan([{ id: 'A-ELABORADO-SIN-CONTROL', quantity: 1 }]);
  assert.deepStrictEqual(impactMap, {
    'M-3': { quantity: 1, type: 'MATERIA_PRIMA' },
    'M-9': { quantity: 0.25, type: 'MATERIA_PRIMA' },
  });
});
check('2 unidades multiplican la receta aunque no controle stock', () => {
  const { impactMap } = plan([{ id: 'A-ELABORADO-SIN-CONTROL', quantity: 2 }]);
  assert.strictEqual(impactMap['M-3'].quantity, 2);
  assert.strictEqual(impactMap['M-9'].quantity, 0.5);
});
check('heredado + controlStock=false → SÍ descuenta el padre', () => {
  const { impactMap } = plan([{ id: 'A-HEREDA-SIN-CONTROL', quantity: 3 }]);
  assert.deepStrictEqual(impactMap, { 'A-ROCKLETS': { quantity: 3, type: 'ARTICULO' } });
});
check('el elaborado no se descuenta a sí mismo: solo su materia prima', () => {
  const { impactMap } = plan([{ id: 'A-ELABORADO-SIN-CONTROL', quantity: 1 }]);
  assert.ok(!('A-ELABORADO-SIN-CONTROL' in impactMap), 'no lleva cuenta propia');
});

// REGLA DEFINITIVA: una materia prima se descuenta SIEMPRE. `ignoraStock` y
// `controlStock` son banderas de DISPONIBILIDAD (si bloquea la venta y si apaga
// los artículos que la usan), nunca de consumo.
console.log('\nLa materia prima se descuenta SIEMPRE:');
const MP_BANDERAS = {
  'M-NORMAL':  { nombre: 'Normal',            stock: 10 },
  'M-IGNORA':  { nombre: 'Ignora stock',      stock: 10, ignoraStock: true },
  'M-SINCTRL': { nombre: 'Sin control',       stock: 10, controlStock: false },
  'M-AMBAS':   { nombre: 'Ignora y sin ctrl', stock: 10, ignoraStock: true, controlStock: false },
};
const ART_BANDERAS = {
  'A-USA-TODAS': {
    nombre: 'Usa las cuatro', controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-NORMAL': 0.25, 'M-IGNORA': 0.25, 'M-SINCTRL': 0.25, 'M-AMBAS': 0.25 } },
  },
  'A-OTRO-QUE-COMPARTE': {
    nombre: 'Comparte materia prima', controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-IGNORA': 1 } },
  },
};
const planBanderas = (items) => construirPlanDeStock({ items, articulos: ART_BANDERAS, materiaPrima: MP_BANDERAS });

check('ninguna bandera saca a la materia prima del plan', () => {
  const { impactMap } = planBanderas([{ id: 'A-USA-TODAS', quantity: 1 }]);
  assert.deepStrictEqual(impactMap, {
    'M-NORMAL':  { quantity: 0.25, type: 'MATERIA_PRIMA' },
    'M-IGNORA':  { quantity: 0.25, type: 'MATERIA_PRIMA' },
    'M-SINCTRL': { quantity: 0.25, type: 'MATERIA_PRIMA' },
    'M-AMBAS':   { quantity: 0.25, type: 'MATERIA_PRIMA' },
  });
});
check('controlStock=false en materia prima YA NO la excluye (era el bug)', () => {
  const { impactMap, avisos } = planBanderas([{ id: 'A-USA-TODAS', quantity: 1 }]);
  assert.ok(impactMap['M-SINCTRL'], 'antes salía del plan y el saldo no se movía nunca');
  assert.ok(!avisos.some((a) => a.tipo === 'sin-control-de-stock' && a.id === 'M-SINCTRL'));
});
check('2 unidades × 0,250 = 0,500 en todas, con o sin ignoraStock', () => {
  const { impactMap } = planBanderas([{ id: 'A-USA-TODAS', quantity: 2 }]);
  for (const id of ['M-NORMAL', 'M-IGNORA', 'M-SINCTRL', 'M-AMBAS']) {
    assert.strictEqual(impactMap[id].quantity, 0.5, id);
  }
});
check('una materia prima compartida por dos productos se suma en una sola entrada', () => {
  const { impactMap, porRuta } = planBanderas([
    { id: 'A-USA-TODAS', quantity: 2 },          // M-IGNORA 0,50
    { id: 'A-OTRO-QUE-COMPARTE', quantity: 3 },  // M-IGNORA 3
  ]);
  assert.strictEqual(impactMap['M-IGNORA'].quantity, 3.5);
  assert.strictEqual(Object.values(porRuta).filter((r) => r.id === 'M-IGNORA').length, 1, 'una sola ruta física');
});
check('el consumo no depende del saldo: se planifica aunque no alcance', () => {
  const pocas = { ...MP_BANDERAS, 'M-IGNORA': { nombre: 'Ignora', stock: 0, ignoraStock: true } };
  const { impactMap } = construirPlanDeStock({
    items: [{ id: 'A-OTRO-QUE-COMPARTE', quantity: 5 }], articulos: ART_BANDERAS, materiaPrima: pocas,
  });
  assert.strictEqual(impactMap['M-IGNORA'].quantity, 5, 'quedará en -5, y está bien');
});

// Caso real de Achaval: BOMBON SUIZO existe 4 veces (uno por departamento). El
// del depto 1 lleva la cuenta (`propio`); los otros tres heredan de él y tienen
// el control de stock apagado. Genérico: cualquier artículo heredado sin control.
console.log('\nArtículo heredado con controlStock=false (caso Bombón Suizo):');
const ART_HEREDA = {
  'BASE':   { nombre: 'Base con cuenta propia', controlStock: true,  stock: { stockType: 'propio', propio: 5 } },
  'HIJO-1': { nombre: 'Hijo depto 2',           controlStock: false, stock: { heredadoDe: 'BASE' } },
  'HIJO-2': { nombre: 'Hijo depto 9',           controlStock: false, stock: { heredadoDe: 'BASE' } },
};
const planHereda = (items) => construirPlanDeStock({ items, articulos: ART_HEREDA, materiaPrima: {} });

check('vender 1 del hijo descuenta exactamente 1 de la base', () => {
  assert.deepStrictEqual(planHereda([{ id: 'HIJO-1', quantity: 1 }]).impactMap,
    { BASE: { quantity: 1, type: 'ARTICULO' } });
});
check('los tres caminos llegan al MISMO recurso, sin duplicar', () => {
  const { impactMap, porRuta } = planHereda([
    { id: 'BASE', quantity: 1 }, { id: 'HIJO-1', quantity: 1 }, { id: 'HIJO-2', quantity: 1 },
  ]);
  assert.deepStrictEqual(impactMap, { BASE: { quantity: 3, type: 'ARTICULO' } });
  assert.strictEqual(Object.keys(porRuta).length, 1, 'una sola ruta física');
});
check('el hijo nunca se descuenta a sí mismo', () => {
  const { impactMap } = planHereda([{ id: 'HIJO-1', quantity: 2 }]);
  assert.ok(!('HIJO-1' in impactMap));
  assert.strictEqual(impactMap.BASE.quantity, 2);
});

console.log('\nAgrupación: varios caminos, una sola ruta:');
check('base por receta + topping por receta sobre la MISMA materia prima → 0,50', () => {
  const { impactMap, porRuta } = plan([{
    id: 'A-KILO', quantity: 1,
    selectedOptionals: { g: [opcional({ articleId: 'A-TOPPING-RECETA' })] },
  }]);
  assert.strictEqual(impactMap['M-3'].quantity, 0.5, 'una sola entrada con la suma');
  assert.strictEqual(impactMap['M-9'].quantity, 2);
  const ruta = porRuta['MATERIA_PRIMA/M-3'];
  assert.strictEqual(ruta.origenes.length, 2, 'dos orígenes, una sola ruta');
  assert.deepStrictEqual(ruta.origenes.map((o) => o.origen).sort(), ['base', 'opcional']);
});
check('dos artículos heredados del mismo padre → una sola entrada', () => {
  const { impactMap } = plan([
    { id: 'A-ROCKLETS-2', quantity: 1 },
    { id: 'A-ROCKLETS-3', quantity: 2 },
  ]);
  assert.deepStrictEqual(Object.keys(impactMap), ['A-ROCKLETS']);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 3);
});
check('base y topping son el MISMO artículo → se suman', () => {
  const { impactMap } = plan([{
    id: 'A-ROCKLETS', quantity: 1,
    selectedOptionals: { g: [opcional()] },
  }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 2);
});
check('promo y opcional sobre la misma ruta → una sola entrada', () => {
  const { impactMap } = plan([{
    id: 'A-PROMO', quantity: 1, isPromo: true,
    promoItems: [{ id: 'A-ROCKLETS', cantidad: 1, selectedOptionals: { g: [opcional()] } }],
  }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 2, 'hijo + su opcional');
});
check('dos unidades con el mismo topping → consumo agregado 2', () => {
  const linea = { id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional()] } };
  const { impactMap } = plan([linea, { ...linea }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 2);
});
check('una unidad con topping y otra sin → consumo 1', () => {
  const { impactMap } = plan([
    { id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional()] } },
    { id: 'A-KILO', quantity: 1 },
  ]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1);
  assert.strictEqual(impactMap['M-3'].quantity, 0.5, 'las dos unidades base sí suman');
});

console.log('\nOpcionales: quién mueve stock y quién no:');
check('opcional MANUAL sin articleId NO mueve stock', () => {
  const { impactMap } = plan([{ id: 'A-KILO', quantity: 1, selectedOptionals: { g: [{ nombre: 'Rocklets', precio: 1700 }] } }]);
  assert.ok(!impactMap['A-ROCKLETS']);
});
check('opcional GRATUITO basado en artículo SÍ descuenta', () => {
  const { impactMap } = plan([{ id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional({ precioUnitario: 0 })] } }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1, 'precio cero no implica consumo cero');
});
check('opcional NUNCA cae a búsqueda por nombre', () => {
  const { impactMap, avisos } = plan([{ id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional({ articleId: 'Rocklets' })] } }]);
  assert.ok(!impactMap['A-ROCKLETS'], 'no se resolvió por nombre');
  assert.ok(avisos.some((a) => a.tipo === 'recurso-inexistente' && a.origen === 'opcional'));
});
check('consumo configurado en 2 se respeta; no se deduce del nombre', () => {
  const { impactMap } = plan([{
    id: 'A-KILO', quantity: 1,
    selectedOptionals: { g: [opcional({ nombre: 'Vasitos x 5', consumoStockUnitario: 2 })] },
  }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 2, 'el "x 5" del nombre se ignora');
});
check('consumo inválido no descuenta y avisa', () => {
  const { impactMap, avisos } = plan([{ id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional({ consumoStockUnitario: 'abc' })] } }]);
  assert.ok(!impactMap['A-ROCKLETS']);
  assert.ok(avisos.some((a) => a.tipo === 'consumo-invalido'));
});
check('controlaStock=false en el snapshot no descuenta', () => {
  const { impactMap } = plan([{ id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional({ controlaStock: false })] } }]);
  assert.ok(!impactMap['A-ROCKLETS']);
});
check('cantidad del opcional > 1 multiplica el consumo', () => {
  const { impactMap } = plan([{ id: 'A-KILO', quantity: 1, selectedOptionals: { g: [opcional({ cantidad: 3 })] } }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 3);
});

console.log('\nCasos degradados:');
check('receta con materia prima faltante: se avisa y no rompe', () => {
  const { impactMap, avisos, faltantes } = plan([{ id: 'A-FALTA-MP', quantity: 1 }]);
  assert.deepStrictEqual(impactMap, {});
  assert.ok(avisos.some((a) => a.tipo === 'recurso-inexistente' && a.id === 'M-NO-EXISTE'));
  assert.strictEqual(faltantes.length, 1);
});
check('ciclo de herencia: se corta y se avisa, no se cuelga', () => {
  const { avisos } = plan([{ id: 'A-CICLO-A', quantity: 1 }]);
  assert.ok(avisos.some((a) => a.tipo === 'ciclo'));
});
check('artículo base histórico SÍ puede resolverse por nombre, con aviso', () => {
  const { impactMap, avisos } = plan([{ nombre: 'Rocklets', quantity: 1 }]);
  assert.strictEqual(impactMap['A-ROCKLETS'].quantity, 1);
  assert.ok(avisos.some((a) => a.tipo === 'fallback-por-nombre'));
});
check('se puede desactivar el fallback por nombre', () => {
  const { impactMap } = plan([{ nombre: 'Rocklets', quantity: 1 }], { permitirNombreEnBase: false });
  assert.deepStrictEqual(impactMap, {});
});
check('IDs iguales en locales distintos no se mezclan (el plan es por catálogo)', () => {
  const otroLocal = { 'A-ROCKLETS': { nombre: 'Rocklets otro local', stock: { stockType: 'propio', propio: 5 } } };
  const p1 = construirPlanDeStock({ items: [{ id: 'A-ROCKLETS', quantity: 1 }], articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA });
  const p2 = construirPlanDeStock({ items: [{ id: 'A-ROCKLETS', quantity: 1 }], articulos: otroLocal, materiaPrima: {} });
  assert.strictEqual(p1.impactMap['A-ROCKLETS'].quantity, 1);
  assert.strictEqual(p2.impactMap['A-ROCKLETS'].quantity, 1);
});

console.log('\nPreflight (punto 4):');
check('separa lo que existe de lo que no', () => {
  const r = preflight({
    impactMap: { 'A-ROCKLETS': { quantity: 1, type: 'ARTICULO' }, 'A-NO': { quantity: 1, type: 'ARTICULO' } },
    articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA,
  });
  assert.strictEqual(r.listo, false);
  assert.deepStrictEqual(Object.keys(r.existentes), ['A-ROCKLETS']);
  assert.deepStrictEqual(r.faltantes, [{ id: 'A-NO', tipo: 'ARTICULO' }]);
});
check('plan sano → listo', () => {
  assert.strictEqual(preflight({ impactMap: { 'M-3': { quantity: 1, type: 'MATERIA_PRIMA' } }, articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA }).listo, true);
});

console.log('\nAuxiliares:');
check('tipoDeStock deduce igual que el sistema actual', () => {
  assert.strictEqual(tipoDeStock({ stock: { stockType: 'propio' } }), 'propio');
  assert.strictEqual(tipoDeStock({ stock: { receta: { a: 1 } } }), 'receta');
  assert.strictEqual(tipoDeStock({ stock: { heredadoDe: 'X' } }), 'heredado');
  assert.strictEqual(tipoDeStock({ stock: { propio: 3 } }), 'propio');
  assert.strictEqual(tipoDeStock({}), 'ninguno');
});
check('resolverRutasFisicas tolera entradas basura', () => {
  const acc = {};
  resolverRutasFisicas({ id: null, cantidad: 1, articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA, acc });
  resolverRutasFisicas({ id: 'A-ROCKLETS', cantidad: NaN, articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA, acc });
  assert.deepStrictEqual(acc, {});
});

// ---------------------------------------------------------------------------
console.log('\n"Ignora Stock": el descuento se sigue planificando igual:');
// El plan de impacto NO consulta el nivel de stock: `ignoraStock` no puede
// omitir el descuento, ni recortarlo a cero, ni sacar el renglón del ledger.
// ---------------------------------------------------------------------------
const MP_IGNORA = {
  'M-3': { nombre: 'Azúcar', stock: 100 },
  'M-9': { nombre: 'Cacao', stock: 50 },
  'M-CHIPAS': { nombre: 'CHIPAS', stock: 2, activo: true, ignoraStock: true },
};
const ART_IGNORA = {
  ...ARTICULOS,
  'A-CHIPA': { nombre: 'Chipa', stock: { stockType: 'receta', receta: { 'M-CHIPAS': 6 } } },
};
const planIgnora = (items) => construirPlanDeStock({ items, articulos: ART_IGNORA, materiaPrima: MP_IGNORA });

check('descuenta el consumo completo aunque el stock no alcance', () => {
  const { impactMap } = planIgnora([{ codigo: 'A-CHIPA', quantity: 1 }]);
  // stock 2 − 6 = −4: el plan pide los 6, sin recortes.
  assert.deepStrictEqual(impactMap['M-CHIPAS'], { quantity: 6, type: 'MATERIA_PRIMA' });
});
check('el stock negativo no frena el pedido siguiente ni cambia el plan', () => {
  const mp = { ...MP_IGNORA, 'M-CHIPAS': { ...MP_IGNORA['M-CHIPAS'], stock: -4 } };
  const { impactMap } = construirPlanDeStock({ items: [{ codigo: 'A-CHIPA', quantity: 2 }], articulos: ART_IGNORA, materiaPrima: mp });
  assert.deepStrictEqual(impactMap['M-CHIPAS'], { quantity: 12, type: 'MATERIA_PRIMA' });
});
check('la reversión devuelve exactamente lo descontado (cantidad negativa)', () => {
  const mp = { ...MP_IGNORA, 'M-CHIPAS': { ...MP_IGNORA['M-CHIPAS'], stock: -4 } };
  const { impactMap } = construirPlanDeStock({ items: [{ codigo: 'A-CHIPA', quantity: -1 }], articulos: ART_IGNORA, materiaPrima: mp });
  assert.deepStrictEqual(impactMap['M-CHIPAS'], { quantity: -6, type: 'MATERIA_PRIMA' });
});
check('preflight: la materia prima existe, así que el descuento se ejecuta', () => {
  const { impactMap } = planIgnora([{ codigo: 'A-CHIPA', quantity: 1 }]);
  assert.strictEqual(preflight({ impactMap, articulos: ART_IGNORA, materiaPrima: MP_IGNORA }).listo, true);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
