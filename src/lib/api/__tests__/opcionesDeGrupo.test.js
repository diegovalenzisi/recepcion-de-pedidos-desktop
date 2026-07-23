// Fase 2 — punto 9: qué opciones ve el cliente, manual o por departamento.
// Correr con: node src/lib/api/__tests__/opcionesDeGrupo.test.js
import assert from 'node:assert';
import {
  combinarConfigDeGrupo,
  opcionesVisiblesDeGrupo,
  etiquetaDeOpcion,
  opcionSeleccionable,
  snapshotDeOpcion,
} from '../opcionesDeGrupo.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const GRUPO_DEP = {
  codigo: 'G-TOPPING', nombre: 'TOPPING', origen: 'departamento', departamentoId: 'D-TOP',
  usarPrecioArticulo: true, controlarStock: true, consumoStockUnitarioDefault: 1,
};
const CONFIG_EN_ARTICULO = { activo: true, min: 0, max: 3, obligatorio: false, opcionales: ['O-VIEJO'] };

const ARTICULOS = {
  'A-ROCKLETS': { nombre: 'Rocklets', departamento: 'D-TOP', valor: 1700, costoUnitario: 400, controlStock: true, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 20 } },
  'A-GRANAS': { nombre: 'Granas', departamento: 'D-TOP', valor: 0, costoUnitario: 50, controlStock: true, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 5 } },
  'A-SOLOMOSTRADOR': { nombre: 'Solo mostrador', departamento: 'D-TOP', valor: 300, activoDelivery: false, activoMostrador: true, stock: { stockType: 'propio', propio: 5 } },
  'A-OTRODEPTO': { nombre: 'Cucurucho', departamento: 'D-CONOS', valor: 500, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 9 } },
};

console.log('Grupo manual: sin cambios:');
check('lee opcionales[] igual que antes', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G-SAB', ...CONFIG_EN_ARTICULO, opcionales: ['O-1'] }, { codigo: 'G-SAB', nombre: 'SABORES' });
  const { opciones } = opcionesVisiblesDeGrupo({
    config: cfg,
    opcionalesManuales: [{ id: 'O-1', grupo: 'G-SAB', nombre: 'Chocolate', precio: 0 }],
  });
  assert.strictEqual(opciones.length, 1);
  assert.strictEqual(opciones[0].nombre, 'Chocolate');
  assert.strictEqual(opciones[0].origen, 'manual');
});
check('un grupo viejo sin origen NO se marca como migrado', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G-SAB', activo: true }, { codigo: 'G-SAB', nombre: 'SABORES' });
  assert.ok(!('origen' in cfg), 'le escribió un origen al leerlo');
});
check('respeta el orden personalizado del usuario', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G', opcionales: ['O-1', 'O-2'] }, { codigo: 'G' });
  const manuales = [{ id: 'O-1', grupo: 'G', nombre: 'A' }, { id: 'O-2', grupo: 'G', nombre: 'B' }];
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfg, opcionalesManuales: manuales, ordenPersonalizado: ['O-2', 'O-1'] });
  assert.deepStrictEqual(opciones.map(o => o.nombre), ['B', 'A']);
});

console.log('\nGrupo por departamento: dinámico:');
const cfgDep = combinarConfigDeGrupo({ id: 'G-TOPPING', ...CONFIG_EN_ARTICULO }, GRUPO_DEP);
check('la definición del catálogo manda sobre el artículo', () => {
  assert.strictEqual(cfgDep.origen, 'departamento');
  assert.strictEqual(cfgDep.departamentoId, 'D-TOP');
});
check('NO lee opcionales[] aunque el artículo lo traiga', () => {
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: ARTICULOS, canal: 'mostrador' });
  assert.ok(!opciones.some(o => o.id === 'O-VIEJO'), 'usó la lista vieja');
});
check('resuelve por departamento EXACTO, no por nombre', () => {
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: ARTICULOS, canal: 'mostrador' });
  assert.ok(!opciones.some(o => o.articleId === 'A-OTRODEPTO'), 'trajo otro departamento');
});
check('el precio sale del artículo real', () => {
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: ARTICULOS, canal: 'mostrador' });
  const r = opciones.find(o => o.articleId === 'A-ROCKLETS');
  assert.strictEqual(r.precio, 1700);
  assert.strictEqual(r.id, 'A-ROCKLETS', 'el ID visible debe ser el artículo');
});

console.log('\nFiltro por canal:');
check('delivery excluye lo que no está activo para delivery', () => {
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: ARTICULOS, canal: 'delivery' });
  assert.ok(!opciones.some(o => o.articleId === 'A-SOLOMOSTRADOR'));
});
check('mostrador sí lo incluye', () => {
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: ARTICULOS, canal: 'mostrador' });
  assert.ok(opciones.some(o => o.articleId === 'A-SOLOMOSTRADOR'));
});

console.log('\nVisualización:');
check('precio > 0 muestra el adicional', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-ROCKLETS': ARTICULOS['A-ROCKLETS'] }, canal: 'mostrador' }).opciones;
  assert.strictEqual(etiquetaDeOpcion(o), 'Rocklets (+$1.700)');
});
check('precio 0 NO muestra "+$0"', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-GRANAS': ARTICULOS['A-GRANAS'] }, canal: 'mostrador' }).opciones;
  assert.strictEqual(etiquetaDeOpcion(o), 'Granas');
});
check('precio inválido se marca, no se muestra gratis', () => {
  const arts = { 'A-X': { nombre: 'Roto', departamento: 'D-TOP', valor: 'abc', activoMostrador: true } };
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: arts, canal: 'mostrador' }).opciones;
  assert.strictEqual(etiquetaDeOpcion(o), 'Roto — precio inválido');
  assert.strictEqual(opcionSeleccionable(o), false);
});
check('nunca NaN ni undefined', () => {
  for (const entrada of [null, {}, { nombre: 'X', precioMostrado: NaN }, { nombre: 'X', precioMostrado: undefined }]) {
    const t = etiquetaDeOpcion(entrada);
    assert.ok(!/NaN|undefined|\+\$0/.test(t), `salida inválida: ${t}`);
  }
});
check('el costo y el consumo NUNCA aparecen en la etiqueta', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-ROCKLETS': ARTICULOS['A-ROCKLETS'] }, canal: 'mostrador' }).opciones;
  const t = etiquetaDeOpcion(o);
  assert.ok(!t.includes('400'), 'filtró el costo');
  assert.ok(!/consumo/i.test(t));
});

console.log('\nDisponibilidad:');
check('sin stock queda visible pero NO seleccionable', () => {
  const { opciones } = opcionesVisiblesDeGrupo({
    config: cfgDep, articulos: ARTICULOS, canal: 'mostrador',
    estaDisponible: (id) => id !== 'A-ROCKLETS',
  });
  const r = opciones.find(o => o.articleId === 'A-ROCKLETS');
  assert.ok(r, 'lo ocultó en silencio');
  assert.strictEqual(opcionSeleccionable(r), false);
});
check('funciona con receta y stock heredado, no sólo con stock.propio', () => {
  const arts = {
    'A-REC': { nombre: 'Receta', departamento: 'D-TOP', valor: 100, activoMostrador: true, stock: { stockType: 'receta', receta: { 'M-1': 0.25 } } },
    'A-HER': { nombre: 'Heredado', departamento: 'D-TOP', valor: 100, activoMostrador: true, stock: { stockType: 'heredado', heredadoDe: 'A-REC' } },
  };
  const { opciones } = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: arts, canal: 'mostrador', estaDisponible: () => true });
  assert.strictEqual(opciones.length, 2, 'descartó lo que no tiene stock.propio');
  assert.ok(opciones.every(o => opcionSeleccionable(o)));
});

console.log('\nSnapshot:');
check('el dinámico congela artículo, departamento, precio, costo y consumo', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-ROCKLETS': ARTICULOS['A-ROCKLETS'] }, canal: 'mostrador' }).opciones;
  const s = snapshotDeOpcion(o, { cantidad: 1, unidadIndice: 1, unidadTotal: 2 });
  assert.strictEqual(s.articleId, 'A-ROCKLETS');
  assert.strictEqual(s.departamentoId, 'D-TOP');
  assert.strictEqual(s.precioUnitario, 1700);
  assert.strictEqual(s.total, 1700);
  assert.strictEqual(s.costoUnitarioAplicado, 400);
  assert.strictEqual(s.consumoStockUnitario, 1);
  assert.strictEqual(s.unidadIndice, 1);
  assert.strictEqual(s.unidadTotal, 2);
});
check('cantidad 2 multiplica precio, costo y consumo', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-ROCKLETS': ARTICULOS['A-ROCKLETS'] }, canal: 'mostrador' }).opciones;
  const s = snapshotDeOpcion(o, { cantidad: 2 });
  assert.strictEqual(s.total, 3400);
  assert.strictEqual(s.costoTotal, 800);
  assert.strictEqual(s.consumoStockTotal, 2);
});
check('el gratuito con stock no suma pero sí consume', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-GRANAS': ARTICULOS['A-GRANAS'] }, canal: 'mostrador' }).opciones;
  const s = snapshotDeOpcion(o, { cantidad: 1 });
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.consumoStockTotal, 1);
});
check('el snapshot manual NO pierde su forma histórica', () => {
  const cfg = combinarConfigDeGrupo({ id: 'G', opcionales: ['O-1'] }, { codigo: 'G' });
  const [o] = opcionesVisiblesDeGrupo({ config: cfg, opcionalesManuales: [{ id: 'O-1', grupo: 'G', nombre: 'Chocolate', precio: 500 }] }).opciones;
  const s = snapshotDeOpcion(o, { cantidad: 2 });
  assert.strictEqual(s.id, 'O-1');
  assert.strictEqual(s.precio, 500);
  assert.strictEqual(s.quantity, 2);
  assert.strictEqual(s.origen, 'manual');
});
check('el snapshot dinámico NUNCA pierde articleId', () => {
  const [o] = opcionesVisiblesDeGrupo({ config: cfgDep, articulos: { 'A-ROCKLETS': ARTICULOS['A-ROCKLETS'] }, canal: 'mostrador' }).opciones;
  assert.ok(snapshotDeOpcion(o, {}).articleId, 'sin articleId no hay descuento de stock posible');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
