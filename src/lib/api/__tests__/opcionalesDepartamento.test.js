// Fase 2 — grupos por departamento: consumo, overrides, opciones, costo, snapshot.
// Correr con: node src/lib/api/__tests__/opcionalesDepartamento.test.js
import assert from 'node:assert';
import {
  ORIGEN_MANUAL, ORIGEN_DEPARTAMENTO, origenDeGrupo, configDepartamento,
  consumoEfectivo, costoEfectivo, resolverOpcionesDeDepartamento, construirSnapshotDepartamento,
} from '../opcionalesDepartamento.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const ARTICULOS = {
  'A-ROCKLETS': { nombre: 'Rocklets', departamento: 'D-TOP', valor: 1700, costoUnitario: 400, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 20 } },
  'A-VASITOS': { nombre: 'Vasitos x 5', departamento: 'D-TOP', valor: 0, costoUnitario: 50, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 100 } },
  'A-OREO': { nombre: 'Oreo', departamento: 'D-TOP', valor: 900, activoDelivery: false, activoMostrador: true, stock: { stockType: 'propio', propio: 5 } },
  'A-ELIMINADO': { nombre: 'Viejo', departamento: 'D-TOP', valor: 100, eliminado: true, stock: { propio: 1 } },
  'A-SALSA': { nombre: 'Salsa', departamento: 'D-SALSA', valor: 0, activoDelivery: true, activoMostrador: true, stock: { propio: 9 } },
  'A-RECETA': { nombre: 'Topping receta', departamento: 'D-TOP', valor: 500, activoDelivery: true, activoMostrador: true, stock: { stockType: 'receta', receta: { 'M-3': 2, 'M-9': 1 } } },
  'A-HEREDA': { nombre: 'Hereda', departamento: 'D-TOP', valor: 300, activoDelivery: true, activoMostrador: true, stock: { stockType: 'heredado', heredadoDe: 'A-ROCKLETS' } },
  'A-PRECIO-ROTO': { nombre: 'Roto', departamento: 'D-TOP', valor: 'abc', activoDelivery: true, activoMostrador: true, stock: { propio: 3 } },
  'A-SIN-CONTROL': { nombre: 'Ilimitado', departamento: 'D-TOP', valor: 200, controlStock: false, activoDelivery: true, activoMostrador: true, stock: { propio: 0 } },
};
const MATERIA_PRIMA = { 'M-3': { nombre: 'Azúcar', costoUnitario: 10 }, 'M-9': { nombre: 'Cacao', costoUnitario: 30 } };

const CFG = {
  id: 'G-TOP', nombre: 'TOPPING', origen: 'departamento', departamentoId: 'D-TOP',
  usarPrecioArticulo: true, controlarStock: true,
  consumoStockUnitarioDefault: 1, consumosPorArticulo: { 'A-VASITOS': 2 },
};

console.log('Compatibilidad con grupos manuales:');
check('un grupo SIN origen se comporta como manual', () => {
  assert.strictEqual(origenDeGrupo({ id: 'G1', opcionales: ['O-1'] }), ORIGEN_MANUAL);
  assert.strictEqual(origenDeGrupo(undefined), ORIGEN_MANUAL);
  assert.strictEqual(configDepartamento({ id: 'G1' }), null, 'no se le inventa configuración');
});
check('solo origen "departamento" activa el modo nuevo', () => {
  assert.strictEqual(origenDeGrupo(CFG), ORIGEN_DEPARTAMENTO);
  assert.strictEqual(origenDeGrupo({ origen: 'manual' }), ORIGEN_MANUAL);
});
check('el departamentoId se conserva COMPLETO', () => {
  assert.strictEqual(configDepartamento(CFG).departamentoId, 'D-TOP');
  assert.notStrictEqual(configDepartamento(CFG).departamentoId, 'TOP');
});

console.log('\nConsumo por artículo y overrides:');
check('sin override usa el default del grupo', () => {
  const r = consumoEfectivo(CFG, 'A-ROCKLETS');
  assert.strictEqual(r.consumo, 1);
  assert.strictEqual(r.fuente, 'default');
});
check('con override usa el override', () => {
  const r = consumoEfectivo(CFG, 'A-VASITOS');
  assert.strictEqual(r.consumo, 2);
  assert.strictEqual(r.fuente, 'override');
});
check('el consumo NO se deduce del nombre ("Vasitos x 5" no da 5)', () => {
  assert.strictEqual(consumoEfectivo(CFG, 'A-VASITOS').consumo, 2, 'sale de la configuración, no del "x 5"');
  const sinOverride = { ...CFG, consumosPorArticulo: {} };
  assert.strictEqual(consumoEfectivo(sinOverride, 'A-VASITOS').consumo, 1);
});
check('override inválido cae al default y avisa', () => {
  for (const malo of ['abc', 0, -1, null, NaN]) {
    const r = consumoEfectivo({ ...CFG, consumosPorArticulo: { 'A-ROCKLETS': malo } }, 'A-ROCKLETS');
    assert.strictEqual(r.consumo, 1, `${malo}`);
    if (malo !== null) assert.strictEqual(r.fuente, 'default');
  }
});
check('acepta decimales', () => {
  assert.strictEqual(consumoEfectivo({ ...CFG, consumosPorArticulo: { 'A-ROCKLETS': 0.5 } }, 'A-ROCKLETS').consumo, 0.5);
  assert.strictEqual(consumoEfectivo({ ...CFG, consumosPorArticulo: { 'A-ROCKLETS': '0,25' } }, 'A-ROCKLETS').consumo, 0.25);
});
check('default inválido en el grupo cae a 1', () => {
  assert.strictEqual(consumoEfectivo({ ...CFG, consumoStockUnitarioDefault: 'x' }, 'A-ROCKLETS').consumo, 1);
});

console.log('\nCosto efectivo (nunca el precio de venta):');
check('artículo propio usa su costo unitario', () => {
  assert.strictEqual(costoEfectivo('A-ROCKLETS', ARTICULOS, MATERIA_PRIMA), 400);
});
check('NUNCA usa `valor` como costo', () => {
  assert.notStrictEqual(costoEfectivo('A-ROCKLETS', ARTICULOS, MATERIA_PRIMA), 1700);
});
check('receta: suma el costo de sus ingredientes', () => {
  assert.strictEqual(costoEfectivo('A-RECETA', ARTICULOS, MATERIA_PRIMA), 2 * 10 + 1 * 30);
});
check('heredado: toma el costo del padre', () => {
  assert.strictEqual(costoEfectivo('A-HEREDA', ARTICULOS, MATERIA_PRIMA), 400);
});
check('costoTotalReceta consolidado tiene prioridad (misma regla que los informes)', () => {
  const arts = { ...ARTICULOS, 'A-X': { nombre: 'X', costoTotalReceta: 777, stock: { stockType: 'receta', receta: { 'M-3': 99 } } } };
  assert.strictEqual(costoEfectivo('A-X', arts, MATERIA_PRIMA), 777);
});
check('artículo inexistente o ciclo no rompen', () => {
  assert.strictEqual(costoEfectivo('A-NO', ARTICULOS, MATERIA_PRIMA), 0);
  const ciclo = { 'A-1': { stock: { stockType: 'heredado', heredadoDe: 'A-2' } }, 'A-2': { stock: { stockType: 'heredado', heredadoDe: 'A-1' } } };
  assert.strictEqual(costoEfectivo('A-1', ciclo, {}), 0);
});

console.log('\nResolución dinámica de opciones:');
const resolver = (over = {}) => resolverOpcionesDeDepartamento({ config: CFG, articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA, ...over });

check('solo trae artículos del departamento EXACTO', () => {
  const { opciones } = resolver({ canal: 'mostrador' });
  assert.ok(opciones.every((o) => o.departamentoId === 'D-TOP'));
  assert.ok(!opciones.some((o) => o.nombre === 'Salsa'), 'no trae los de otro departamento');
});
check('no compara por nombre ni normaliza dígitos', () => {
  const { opciones } = resolverOpcionesDeDepartamento({ config: { ...CFG, departamentoId: 'TOP' }, articulos: ARTICULOS, materiaPrima: MATERIA_PRIMA });
  assert.strictEqual(opciones.length, 0, '"TOP" no es "D-TOP"');
});
check('excluye eliminados', () => {
  assert.ok(!resolver().opciones.some((o) => o.articleId === 'A-ELIMINADO'));
});
check('respeta el canal: Oreo no está activo para delivery', () => {
  assert.ok(!resolver({ canal: 'delivery' }).opciones.some((o) => o.articleId === 'A-OREO'));
  assert.ok(resolver({ canal: 'mostrador' }).opciones.some((o) => o.articleId === 'A-OREO'));
});
check('el precio sale del ARTÍCULO real', () => {
  const rock = resolver().opciones.find((o) => o.articleId === 'A-ROCKLETS');
  assert.strictEqual(rock.precio, 1700);
  assert.strictEqual(rock.costo, 400);
});
check('precio inválido se marca, no se convierte en 0 silencioso', () => {
  const roto = resolver().opciones.find((o) => o.articleId === 'A-PRECIO-ROTO');
  assert.strictEqual(roto.precioInvalido, true);
});
check('precio 0 es válido y no se marca', () => {
  const vasitos = resolver().opciones.find((o) => o.articleId === 'A-VASITOS');
  assert.strictEqual(vasitos.precio, 0);
  assert.strictEqual(vasitos.precioInvalido, false);
});
check('el consumo por opción respeta el override', () => {
  const ops = resolver().opciones;
  assert.strictEqual(ops.find((o) => o.articleId === 'A-ROCKLETS').consumoStockUnitario, 1);
  assert.strictEqual(ops.find((o) => o.articleId === 'A-VASITOS').consumoStockUnitario, 2);
});
check('controlStock=false sigue ilimitado y no consume', () => {
  const ilim = resolver().opciones.find((o) => o.articleId === 'A-SIN-CONTROL');
  assert.strictEqual(ilim.controlaStock, false);
  assert.strictEqual(ilim.consumoStockUnitario, 0);
});
check('grupo con controlarStock=false apaga el consumo de todos', () => {
  const { opciones } = resolver({ config: { ...CFG, controlarStock: false } });
  assert.ok(opciones.every((o) => o.consumoStockUnitario === 0));
});
check('usa el motor de disponibilidad que se le pase', () => {
  const { opciones } = resolver({ estaDisponible: (id) => id !== 'A-ROCKLETS' });
  assert.strictEqual(opciones.find((o) => o.articleId === 'A-ROCKLETS').disponible, false);
  assert.strictEqual(opciones.find((o) => o.articleId === 'A-VASITOS').disponible, true);
});
check('NO copia los artículos dentro del grupo', () => {
  assert.strictEqual(CFG.opcionales, undefined, 'la configuración no guarda la lista');
  assert.ok(resolver().opciones.length > 0, 'se resuelve dinámicamente');
});
check('grupo sin departamentoId avisa y no devuelve opciones', () => {
  const r = resolver({ config: { ...CFG, departamentoId: null } });
  assert.strictEqual(r.opciones.length, 0);
  assert.ok(r.avisos.some((a) => a.tipo === 'grupo-sin-departamento'));
});

console.log('\nSnapshot congelado:');
const opcionRock = () => resolver().opciones.find((o) => o.articleId === 'A-ROCKLETS');
check('guarda precio, costo y consumo del momento del pedido', () => {
  const s = construirSnapshotDepartamento(opcionRock(), { cantidad: 1, unidadIndice: 1, unidadTotal: 2 });
  assert.strictEqual(s.origen, 'departamento');
  assert.strictEqual(s.articleId, 'A-ROCKLETS');
  assert.strictEqual(s.departamentoId, 'D-TOP');
  assert.strictEqual(s.precioUnitario, 1700);
  assert.strictEqual(s.total, 1700);
  assert.strictEqual(s.costoUnitarioAplicado, 400);
  assert.strictEqual(s.costoTotal, 400);
  assert.strictEqual(s.consumoStockUnitario, 1);
  assert.strictEqual(s.consumoStockTotal, 1);
  assert.strictEqual(s.unidadIndice, 1);
  assert.strictEqual(s.unidadTotal, 2);
});
check('cantidad > 1 multiplica precio, costo y consumo', () => {
  const s = construirSnapshotDepartamento(opcionRock(), { cantidad: 3 });
  assert.strictEqual(s.total, 5100);
  assert.strictEqual(s.costoTotal, 1200);
  assert.strictEqual(s.consumoStockTotal, 3);
});
check('un cambio posterior del artículo NO altera el snapshot', () => {
  const s = construirSnapshotDepartamento(opcionRock(), { cantidad: 1 });
  ARTICULOS['A-ROCKLETS'].valor = 9999;
  ARTICULOS['A-ROCKLETS'].costoUnitario = 8888;
  assert.strictEqual(s.precioUnitario, 1700, 'la ganancia histórica no se mueve');
  assert.strictEqual(s.costoUnitarioAplicado, 400);
  ARTICULOS['A-ROCKLETS'].valor = 1700;
  ARTICULOS['A-ROCKLETS'].costoUnitario = 400;
});
check('conserva los alias históricos', () => {
  const s = construirSnapshotDepartamento(opcionRock(), { cantidad: 2 });
  assert.strictEqual(s.precio, 1700);
  assert.strictEqual(s.quantity, 2);
});
check('un opcional GRATUITO basado en artículo igual lleva consumo', () => {
  const vas = resolver().opciones.find((o) => o.articleId === 'A-VASITOS');
  const s = construirSnapshotDepartamento(vas, { cantidad: 1 });
  assert.strictEqual(s.total, 0, 'no suma precio');
  assert.strictEqual(s.consumoStockTotal, 2, 'pero sí descuenta stock');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
