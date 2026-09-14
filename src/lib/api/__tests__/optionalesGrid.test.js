// Posicionamiento manual 2D de opcionales/sabores — lógica pura del lado del
// renderer (gemela de electron/lib/optionalesGridLocal.js).
// Correr con: node src/lib/api/__tests__/optionalesGrid.test.js
import assert from 'node:assert';
import {
  FILAS_POR_DEFECTO,
  COLUMNAS_POR_DEFECTO,
  grillaPorDefecto,
  normalizarGrid,
  combinarGridConVigentes,
  conDimensionesAjustadas,
  conPosicionesIntercambiadas,
  conTituloDeColumna,
} from '../optionalesGrid.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

console.log('Default: 6 columnas x 14 filas:');

check('grillaPorDefecto() = 14 filas x 6 columnas, sin títulos ni posiciones', () => {
  assert.deepStrictEqual(grillaPorDefecto(), { rows: 14, columns: 6, columnTitles: {}, positions: {} });
  assert.strictEqual(FILAS_POR_DEFECTO, 14);
  assert.strictEqual(COLUMNAS_POR_DEFECTO, 6);
});

check('normalizarGrid(undefined/null/corrupto) cae al default, nunca rompe', () => {
  assert.deepStrictEqual(normalizarGrid(undefined), grillaPorDefecto());
  assert.deepStrictEqual(normalizarGrid(null), grillaPorDefecto());
  assert.deepStrictEqual(normalizarGrid('corrupto'), grillaPorDefecto());
});

console.log('\ncombinarGridConVigentes — huecos, altas y bajas de sabores:');

check('posiciones con huecos: una celda vacía queda vacía, no se rellena', () => {
  const guardada = { rows: 3, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 3, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'b']);
  assert.deepStrictEqual(r.positions, { a: { row: 1, column: 1 }, b: { row: 3, column: 2 } });
  const ocupadas = new Set(Object.values(r.positions).map((p) => `${p.row}:${p.column}`));
  assert.strictEqual(ocupadas.has('1:2'), false);
  assert.strictEqual(ocupadas.has('2:1'), false);
});

check('sabor NUEVO sin posición guardada: va a la primera celda libre', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'nuevo']);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 });
  assert.deepStrictEqual(r.positions.nuevo, { row: 1, column: 2 });
});

check('sabor ELIMINADO: su celda queda libre', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['a']);
  assert.deepStrictEqual(r.positions, { a: { row: 1, column: 1 } });
});

check('sabor eliminado y luego REAPARECIDO: ocupa una celda libre, no vuelve a la vieja', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'b']);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 });
  assert.deepStrictEqual(r.positions.b, { row: 1, column: 2 });
});

check('mismo id con nombre cambiado (la función solo conoce ids): conserva la posición', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { 'id-fijo': { row: 2, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['id-fijo']);
  assert.deepStrictEqual(r.positions['id-fijo'], { row: 2, column: 2 });
});

check('grilla llena: agrega filas automáticamente, no pierde sabores', () => {
  const guardada = { rows: 1, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'b', 'c', 'd', 'e']);
  assert.strictEqual(r.filasAgregadas, 2);
  assert.strictEqual(r.rows, 3);
  assert.deepStrictEqual(Object.keys(r.positions).sort(), ['a', 'b', 'c', 'd', 'e'].sort());
});

check('búsqueda/filtro no es parte de esta función: combinarGridConVigentes no filtra por nombre, solo por id', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 } } };
  const r1 = combinarGridConVigentes(guardada, ['a', 'b']);
  const r2 = combinarGridConVigentes(guardada, ['a', 'b']);
  assert.deepStrictEqual(r1, r2, 'llamar dos veces con los mismos ids da siempre el mismo resultado (determinístico)');
});

console.log('\nconDimensionesAjustadas — editor: cambiar filas/columnas:');

check('achicar columnas reubica lo que quedaba afuera, nunca lo pierde', () => {
  const grid = { rows: 3, columns: 4, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 4 } } };
  const r = conDimensionesAjustadas(grid, 3, 2);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 });
  assert.ok(r.positions.b.column <= 2);
  assert.deepStrictEqual(r.reubicados, ['b']);
});

check('eliminar columnas descarta sus títulos; agrandar deja las nuevas sin título', () => {
  const grid = { rows: 2, columns: 3, columnTitles: { 1: 'CHOCOLATES', 2: 'CREMAS', 3: 'DULCES' }, positions: {} };
  const achicada = conDimensionesAjustadas(grid, 2, 2);
  assert.deepStrictEqual(achicada.columnTitles, { 1: 'CHOCOLATES', 2: 'CREMAS' });
  const agrandada = conDimensionesAjustadas(grid, 2, 5);
  assert.strictEqual(agrandada.columnTitles['4'], undefined);
});

console.log('\nconPosicionesIntercambiadas — mover entre celdas:');

check('mover a celda vacía', () => {
  const grid = { rows: 3, columns: 3, columnTitles: {}, positions: { a: { row: 1, column: 1 } } };
  const r = conPosicionesIntercambiadas(grid, 'a', { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.a, { row: 2, column: 2 });
});

check('mover a celda ocupada: intercambia', () => {
  const grid = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 2, column: 2 } } };
  const r = conPosicionesIntercambiadas(grid, 'a', { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.a, { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.b, { row: 1, column: 1 });
});

console.log('\nconTituloDeColumna:');

check('setea y borra un título (vacío es válido)', () => {
  const conTitulo = conTituloDeColumna(grillaPorDefecto(), 1, 'CHOCOLATES');
  assert.strictEqual(conTitulo.columnTitles['1'], 'CHOCOLATES');
  const sinTitulo = conTituloDeColumna(conTitulo, 1, '');
  assert.strictEqual(sinTitulo.columnTitles['1'], undefined);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
