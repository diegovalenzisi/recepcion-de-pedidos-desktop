// Disponibilidad derivada por receta. Idéntico en Desktop, Tablet y DLV Pedidos.
// Verifica que un artículo con receta se bloquee cuando una materia prima no
// alcanza, que reponerla lo rehabilite sin tocar el activo manual, y que los
// artículos sin receta no se vean afectados.
//
// Correr con: node src/lib/api/__tests__/disponibilidadReceta.test.js
import assert from 'node:assert';
import {
  tipoDeStock,
  unidadesFabricables,
  recetaConStockSuficiente,
  evaluarRecetaPedido,
  disponibleParaDelivery,
  materiasPrimasDeArticulo,
} from '../disponibilidadReceta.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// --- Catálogo del local ----------------------------------------------------
// CHIPA RELLENA usa CHIPAS (1 u) + QUESO (0,050 kg). CHIPA SIMPLE usa solo CHIPAS.
const materiaBase = () => ({
  'M-CHIPAS': { nombre: 'CHIPAS', stock: 10 },
  'M-QUESO': { nombre: 'QUESO', stock: 2 },
});
const articulosBase = () => ({
  'A-CHIPA-RELLENA': {
    nombre: 'Chipa rellena', activoDelivery: true, activo: true,
    stock: { stockType: 'receta', receta: { 'M-CHIPAS': 1, 'M-QUESO': 0.05 } },
  },
  'A-CHIPA-SIMPLE': {
    nombre: 'Chipa simple', activoDelivery: true, activo: true,
    stock: { stockType: 'receta', receta: { 'M-CHIPAS': 1 } },
  },
  'A-GASEOSA': {
    nombre: 'Gaseosa', activoDelivery: true, activo: true,
    stock: { stockType: 'propio', propio: 5 },
  },
  'A-SIN-CONTROL': {
    nombre: 'Servicio', activoDelivery: true, activo: true, controlStock: false,
    stock: { stockType: 'propio', propio: 0 },
  },
});

console.log('tipoDeStock:');
check('detecta receta por presencia de receta', () => {
  assert.strictEqual(tipoDeStock({ receta: { 'M-CHIPAS': 1 } }), 'receta');
});

console.log('\nDisponibilidad visual (activo manual + receta):');
check('activo manual + materia prima > 0 → disponible', () => {
  const arts = articulosBase(); const mp = materiaBase();
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), true);
});
check('materia prima exactamente 0 → bloquea', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-CHIPAS'].stock = 0;
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), false);
});
check('materia prima negativa → bloquea', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-CHIPAS'].stock = -3;
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), false);
});
check('reponer stock → vuelve a estar disponible automáticamente', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-CHIPAS'].stock = 0;
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), false);
  mp['M-CHIPAS'].stock = 4; // reposición
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), true);
});
check('desactivado manual + reponer stock → sigue desactivado', () => {
  const arts = articulosBase(); const mp = materiaBase();
  arts['A-CHIPA-RELLENA'].activoDelivery = false; // decisión manual
  mp['M-CHIPAS'].stock = 100;
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), false);
});
check('receta con dos materias primas: una en 0 bloquea', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-QUESO'].stock = 0;
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), false);
});
check('todas las materias primas con stock → disponible', () => {
  const arts = articulosBase(); const mp = materiaBase();
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), true);
});
check('stock positivo pero menor que la cantidad requerida por unidad → bloquea', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-QUESO'].stock = 0.02; // < 0,05
  assert.strictEqual(recetaConStockSuficiente('A-CHIPA-RELLENA', arts, mp, 1), false);
  assert.strictEqual(disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp), false);
});

console.log('\nArtículos sin receta / control:');
check('artículo sin receta (propio) no se ve afectado por materias primas', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-CHIPAS'].stock = 0;
  assert.strictEqual(recetaConStockSuficiente('A-GASEOSA', arts, mp, 1), true);
  assert.strictEqual(disponibleParaDelivery('A-GASEOSA', arts, mp), true);
});
check('controlStock === false en stock PROPIO nunca bloquea', () => {
  const arts = articulosBase(); const mp = materiaBase();
  assert.strictEqual(recetaConStockSuficiente('A-SIN-CONTROL', arts, mp, 1), true);
  assert.strictEqual(unidadesFabricables('A-SIN-CONTROL', arts, mp), Infinity);
});

check('controlStock === false en un ELABORADO por receta SÍ se evalúa', () => {
  // Caso real de Bynnon: "1 BOCHA" y "2 BOCHAS" tienen receta y el interruptor
  // apagado. Ahí `controlStock:false` solo significa "no lleva cuenta propia de
  // unidades porque su stock vive en la materia prima": si la materia prima no
  // alcanza, el elaborado NO se puede preparar. Antes devolvía "ilimitado" sin
  // mirar la receta, y se seguía vendiendo con la materia prima en cero —
  // mientras stockPlan.js sí le descontaba el consumo.
  const arts = articulosBase();
  arts['A-ELABORADO'] = {
    nombre: 'Elaborado sin cuenta propia', activoDelivery: true, activo: true,
    controlStock: false,
    stock: { stockType: 'receta', receta: { 'M-CHIPAS': 2 } },
  };
  const mp = materiaBase();

  mp['M-CHIPAS'].stock = 10;
  assert.strictEqual(recetaConStockSuficiente('A-ELABORADO', arts, mp, 1), true);
  assert.strictEqual(unidadesFabricables('A-ELABORADO', arts, mp), 5);
  assert.strictEqual(disponibleParaDelivery('A-ELABORADO', arts, mp), true);

  mp['M-CHIPAS'].stock = 1;   // la receta pide 2
  assert.strictEqual(recetaConStockSuficiente('A-ELABORADO', arts, mp, 1), false);
  assert.strictEqual(unidadesFabricables('A-ELABORADO', arts, mp), 0);
  assert.strictEqual(disponibleParaDelivery('A-ELABORADO', arts, mp), false);

  mp['M-CHIPAS'].stock = 0;
  const r = evaluarRecetaPedido('A-ELABORADO', 1, arts, mp);
  assert.strictEqual(r.suficiente, false);
  assert.deepStrictEqual(r.faltantes, [{ materiaPrimaId: 'M-CHIPAS', stockActual: 0, requerido: 2 }]);

  // Y "Ignora Stock" lo sigue eximiendo, como cualquier otra receta.
  mp['M-CHIPAS'].ignoraStock = true;
  assert.strictEqual(recetaConStockSuficiente('A-ELABORADO', arts, mp, 1), true);
});

check('un ingrediente ARTÍCULO con controlStock false no limita ni consume', () => {
  const arts = articulosBase();
  arts['A-INSUMO-LIBRE'] = { nombre: 'Insumo libre', controlStock: false, stock: { stockType: 'propio', propio: 0 } };
  arts['A-USA-INSUMO'] = {
    nombre: 'Usa insumo libre', activoDelivery: true, activo: true,
    stock: { stockType: 'receta', receta: { 'A-INSUMO-LIBRE': 3 } },
  };
  const mp = materiaBase();
  assert.strictEqual(recetaConStockSuficiente('A-USA-INSUMO', arts, mp, 1), true);
  assert.strictEqual(unidadesFabricables('A-USA-INSUMO', arts, mp), Infinity);
});
check('receta vacía no se interpreta como stock cero (no bloquea, avisa)', () => {
  const arts = articulosBase(); const mp = materiaBase();
  arts['A-CHIPA-RELLENA'].stock = { stockType: 'receta', receta: {} };
  assert.strictEqual(recetaConStockSuficiente('A-CHIPA-RELLENA', arts, mp, 1), true);
  const r = evaluarRecetaPedido('A-CHIPA-RELLENA', 1, arts, mp);
  assert.strictEqual(r.suficiente, true);
});

console.log('\nPedido por varias unidades (cantidad × receta):');
check('3 chipas rellenas necesitan 3 CHIPAS y 0,15 de QUESO', () => {
  const arts = articulosBase(); const mp = materiaBase();
  mp['M-CHIPAS'].stock = 3; mp['M-QUESO'].stock = 0.15;
  assert.strictEqual(recetaConStockSuficiente('A-CHIPA-RELLENA', arts, mp, 3), true);
  mp['M-CHIPAS'].stock = 2; // no alcanza para 3
  assert.strictEqual(recetaConStockSuficiente('A-CHIPA-RELLENA', arts, mp, 3), false);
});
check('evaluarRecetaPedido reporta materia prima, stock actual y requerido', () => {
  const arts = articulosBase(); const mp = materiaBase();
  mp['M-CHIPAS'].stock = 2;
  const r = evaluarRecetaPedido('A-CHIPA-RELLENA', 5, arts, mp);
  assert.strictEqual(r.suficiente, false);
  const f = r.faltantes.find((x) => x.materiaPrimaId === 'M-CHIPAS');
  assert.ok(f, 'reporta CHIPAS');
  assert.strictEqual(f.stockActual, 2);
  assert.strictEqual(f.requerido, 5);
});

console.log('\nunidadesFabricables:');
check('respeta cantidades sin perder unidades por redondeos intermedios', () => {
  const arts = { 'A': { stock: { stockType: 'receta', receta: { 'M': 0.5 } } } };
  const mp = { 'M': { stock: 10 } };
  assert.strictEqual(unidadesFabricables('A', arts, mp), 20); // 10 / 0,5
});
check('referencia inexistente → 0 (bloquea)', () => {
  const arts = { 'A': { stock: { stockType: 'receta', receta: { 'M-NO-EXISTE': 1 } } } };
  assert.strictEqual(unidadesFabricables('A', arts, {}), 0);
});

console.log('\nmateriasPrimasDeArticulo (para el cascadeo):');
check('detecta las materias primas de la receta', () => {
  const arts = articulosBase(); const mp = materiaBase();
  const ids = materiasPrimasDeArticulo('A-CHIPA-RELLENA', arts, mp);
  assert.strictEqual(ids.has('M-CHIPAS'), true);
  assert.strictEqual(ids.has('M-QUESO'), true);
  assert.strictEqual(ids.size, 2);
});
check('artículo sin receta no usa materias primas', () => {
  const arts = articulosBase(); const mp = materiaBase();
  assert.strictEqual(materiasPrimasDeArticulo('A-GASEOSA', arts, mp).size, 0);
});
check('receta anidada (artículo que usa otro artículo con receta) resuelve hasta la MP', () => {
  const arts = {
    'A-COMBO': { stock: { stockType: 'receta', receta: { 'A-CHIPA-RELLENA': 1 } } },
    'A-CHIPA-RELLENA': { stock: { stockType: 'receta', receta: { 'M-CHIPAS': 1 } } },
  };
  const mp = { 'M-CHIPAS': { stock: 5 } };
  const ids = materiasPrimasDeArticulo('A-COMBO', arts, mp);
  assert.strictEqual(ids.has('M-CHIPAS'), true);
});

console.log('\nInvariante: no se modifica el activo manual:');
check('ninguna función escribe activoDelivery/activo en los objetos', () => {
  const arts = articulosBase(); const mp = materiaBase(); mp['M-CHIPAS'].stock = 0;
  const antesDelivery = arts['A-CHIPA-RELLENA'].activoDelivery;
  const antesActivo = arts['A-CHIPA-RELLENA'].activo;
  disponibleParaDelivery('A-CHIPA-RELLENA', arts, mp);
  recetaConStockSuficiente('A-CHIPA-RELLENA', arts, mp, 1);
  evaluarRecetaPedido('A-CHIPA-RELLENA', 1, arts, mp);
  assert.strictEqual(arts['A-CHIPA-RELLENA'].activoDelivery, antesDelivery);
  assert.strictEqual(arts['A-CHIPA-RELLENA'].activo, antesActivo);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
