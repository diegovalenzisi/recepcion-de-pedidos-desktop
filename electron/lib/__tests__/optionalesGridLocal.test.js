'use strict';

// Posicionamiento manual 2D de opcionales/sabores, LOCAL por PC (nunca en
// Firebase). Correr con: node electron/lib/__tests__/optionalesGridLocal.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FILAS_POR_DEFECTO,
  COLUMNAS_POR_DEFECTO,
  grillaPorDefecto,
  rutaArchivoGrid,
  leerArchivoGrid,
  escribirArchivoGrid,
  normalizarGrid,
  obtenerGridsDelDispositivo,
  obtenerGridGuardada,
  conGridActualizada,
  combinarGridConVigentes,
  conDimensionesAjustadas,
  conPosicionesIntercambiadas,
  conTituloDeColumna,
} = require('../optionalesGridLocal.js');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
console.log('Default: 6 columnas x 14 filas:');

check('grillaPorDefecto() = 14 filas x 6 columnas, sin títulos ni posiciones', () => {
  assert.deepStrictEqual(grillaPorDefecto(), { rows: 14, columns: 6, columnTitles: {}, positions: {} });
  assert.strictEqual(FILAS_POR_DEFECTO, 14);
  assert.strictEqual(COLUMNAS_POR_DEFECTO, 6);
});

check('normalizarGrid(undefined) cae al default, nunca rompe', () => {
  assert.deepStrictEqual(normalizarGrid(undefined), grillaPorDefecto());
  assert.deepStrictEqual(normalizarGrid(null), grillaPorDefecto());
  assert.deepStrictEqual(normalizarGrid('corrupto'), grillaPorDefecto());
});

check('normalizarGrid descarta posiciones inválidas (fila/columna no numérica o < 1)', () => {
  const g = normalizarGrid({
    rows: 5, columns: 3,
    positions: { a: { row: 1, column: 1 }, b: { row: 0, column: 1 }, c: { row: 'x', column: 2 }, d: { row: 2 } },
  });
  assert.deepStrictEqual(g.positions, { a: { row: 1, column: 1 } });
});

// ---------------------------------------------------------------------------
console.log('\nconGridActualizada / obtenerGridGuardada (puro, aislamiento por dispositivo y grupo):');

check('grupo nuevo para un dispositivo nuevo: se crea sin afectar nada más', () => {
  const data = conGridActualizada({}, 'PC-1', 'GUSTOS', { rows: 4, columns: 2, columnTitles: {}, positions: { choc: { row: 1, column: 1 } } });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-1', 'GUSTOS').positions, { choc: { row: 1, column: 1 } });
});

check('mismo dispositivo, dos grupos distintos: editar uno no altera el otro', () => {
  let data = conGridActualizada({}, 'PC-1', 'GUSTOS', { rows: 4, columns: 2, columnTitles: {}, positions: { choc: { row: 1, column: 1 } } });
  data = conGridActualizada(data, 'PC-1', 'TOPPINGS', { rows: 4, columns: 2, columnTitles: {}, positions: { nuez: { row: 1, column: 1 } } });
  data = conGridActualizada(data, 'PC-1', 'GUSTOS', { rows: 4, columns: 2, columnTitles: {}, positions: { choc: { row: 2, column: 2 } } });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-1', 'GUSTOS').positions, { choc: { row: 2, column: 2 } });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-1', 'TOPPINGS').positions, { nuez: { row: 1, column: 1 } }, 'TOPPINGS no debia cambiar');
});

check('obtenerGridGuardada sin nada guardado -> null', () => {
  assert.strictEqual(obtenerGridGuardada({}, 'PC-1', 'GUSTOS'), null);
});

// ---------------------------------------------------------------------------
console.log('\nAislamiento entre PCs (persistencia por PC):');

check('dos dispositivos distintos, mismo grupo: distribuciones independientes', () => {
  let data = conGridActualizada({}, 'PC-1', 'GUSTOS', { rows: 4, columns: 2, columnTitles: {}, positions: { choc: { row: 1, column: 1 } } });
  data = conGridActualizada(data, 'PC-2', 'GUSTOS', { rows: 4, columns: 2, columnTitles: {}, positions: { choc: { row: 3, column: 2 } } });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-1', 'GUSTOS').positions, { choc: { row: 1, column: 1 } });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-2', 'GUSTOS').positions, { choc: { row: 3, column: 2 } });
});

check('ACHAVAL / PC-1 / GRUPO-1G y ACHAVAL / PC-2 / GRUPO-1G tienen distribuciones diferentes', () => {
  let data = conGridActualizada({}, 'PC-1', 'GRUPO-1G', { rows: 14, columns: 6, columnTitles: { 1: 'CHOCOLATES' }, positions: { a: { row: 1, column: 1 } } });
  data = conGridActualizada(data, 'PC-2', 'GRUPO-1G', { rows: 14, columns: 6, columnTitles: { 1: 'CREMAS' }, positions: { a: { row: 5, column: 3 } } });
  const pc1 = obtenerGridGuardada(data, 'PC-1', 'GRUPO-1G');
  const pc2 = obtenerGridGuardada(data, 'PC-2', 'GRUPO-1G');
  assert.strictEqual(pc1.columnTitles['1'], 'CHOCOLATES');
  assert.strictEqual(pc2.columnTitles['1'], 'CREMAS');
  assert.deepStrictEqual(pc1.positions.a, { row: 1, column: 1 });
  assert.deepStrictEqual(pc2.positions.a, { row: 5, column: 3 });
});

// ---------------------------------------------------------------------------
console.log('\nAislamiento entre grupos (GRUPO 1G / GRUPO 2G no se mezclan):');

check('mismo dispositivo, mismo optionalId en dos grupos distintos: posiciones independientes', () => {
  let data = conGridActualizada({}, 'PC-1', 'GRUPO-1G', { rows: 4, columns: 2, columnTitles: {}, positions: { x: { row: 1, column: 1 } } });
  data = conGridActualizada(data, 'PC-1', 'GRUPO-2G', { rows: 4, columns: 2, columnTitles: {}, positions: { x: { row: 4, column: 2 } } });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-1', 'GRUPO-1G').positions.x, { row: 1, column: 1 });
  assert.deepStrictEqual(obtenerGridGuardada(data, 'PC-1', 'GRUPO-2G').positions.x, { row: 4, column: 2 });
});

// ---------------------------------------------------------------------------
console.log('\ncombinarGridConVigentes — huecos, altas y bajas de sabores:');

check('posiciones con huecos: una celda vacía queda vacía, no se rellena', () => {
  const guardada = { rows: 3, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 3, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'b']);
  assert.deepStrictEqual(r.positions, { a: { row: 1, column: 1 }, b: { row: 3, column: 2 } });
  // (1,2), (2,1), (2,2), (3,1) quedan sin ningún id — nada las ocupa.
  const ocupadas = new Set(Object.values(r.positions).map((p) => `${p.row}:${p.column}`));
  assert.strictEqual(ocupadas.has('1:2'), false);
  assert.strictEqual(ocupadas.has('2:1'), false);
});

check('sabor NUEVO sin posición guardada: va a la primera celda libre', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'nuevo']);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 }, 'el existente no se mueve');
  assert.deepStrictEqual(r.positions.nuevo, { row: 1, column: 2 }, 'el nuevo entra en la primera celda libre');
});

check('sabor ELIMINADO: su celda queda libre, no se pierde nada más', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['a']); // b ya no existe
  assert.deepStrictEqual(r.positions, { a: { row: 1, column: 1 } });
});

check('sabor eliminado y luego REAPARECIDO: no vuelve a su celda vieja, ocupa una libre', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 } } }; // b fue eliminado antes, ya no está guardado
  const r = combinarGridConVigentes(guardada, ['a', 'b']);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 });
  assert.deepStrictEqual(r.positions.b, { row: 1, column: 2 }, 'ocupa la primera celda libre disponible');
});

check('mismo id, nombre cambiado: conserva la posición (se indexa por id, no por nombre)', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { 'id-fijo': { row: 2, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['id-fijo']); // el "nombre" ni siquiera es un campo de esta función: solo importa el id
  assert.deepStrictEqual(r.positions['id-fijo'], { row: 2, column: 2 });
});

check('grilla llena: agrega filas automáticamente para no perder ningún sabor', () => {
  const guardada = { rows: 1, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 2 } } };
  const r = combinarGridConVigentes(guardada, ['a', 'b', 'c', 'd', 'e']);
  assert.strictEqual(r.filasAgregadas, 2, '3 nuevos / 2 columnas = 2 filas de sobra necesarias');
  assert.strictEqual(r.rows, 3);
  const idsUbicados = Object.keys(r.positions);
  assert.deepStrictEqual(idsUbicados.sort(), ['a', 'b', 'c', 'd', 'e'].sort(), 'ningun id se pierde');
  const celdas = new Set(Object.values(r.positions).map((p) => `${p.row}:${p.column}`));
  assert.strictEqual(celdas.size, 5, 'cada id tiene su propia celda, sin colisiones');
});

check('sin grilla guardada (primera vez): ubica todo en orden desde la celda (1,1)', () => {
  const r = combinarGridConVigentes(null, ['a', 'b', 'c']);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 });
  assert.deepStrictEqual(r.positions.b, { row: 1, column: 2 });
  assert.deepStrictEqual(r.positions.c, { row: 1, column: 3 });
  assert.strictEqual(r.rows, FILAS_POR_DEFECTO);
  assert.strictEqual(r.columns, COLUMNAS_POR_DEFECTO);
});

check('posición guardada fuera de los límites actuales (grilla se achicó fuera de esta función): se reubica como nueva', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 5, column: 5 } } };
  const r = combinarGridConVigentes(guardada, ['a']);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 });
});

check('ids repetidos en idsVigentes (dato corrupto) no consumen dos celdas', () => {
  const r = combinarGridConVigentes(null, ['a', 'a', 'b']);
  assert.strictEqual(Object.keys(r.positions).length, 2);
});

check('los títulos de columna se conservan intactos al combinar', () => {
  const guardada = { rows: 2, columns: 2, columnTitles: { 1: 'CHOCOLATES', 2: 'CREMAS' }, positions: {} };
  const r = combinarGridConVigentes(guardada, ['a']);
  assert.deepStrictEqual(r.columnTitles, { 1: 'CHOCOLATES', 2: 'CREMAS' });
});

// ---------------------------------------------------------------------------
console.log('\nconDimensionesAjustadas — cambiar filas/columnas desde el editor:');

check('agrandar la grilla: las posiciones existentes no se mueven', () => {
  const grid = { rows: 2, columns: 2, columnTitles: { 1: 'A' }, positions: { x: { row: 1, column: 1 } } };
  const r = conDimensionesAjustadas(grid, 5, 4);
  assert.strictEqual(r.rows, 5);
  assert.strictEqual(r.columns, 4);
  assert.deepStrictEqual(r.positions.x, { row: 1, column: 1 });
  assert.deepStrictEqual(r.reubicados, []);
  assert.strictEqual(r.columnTitles['1'], 'A', 'los títulos existentes se conservan');
});

check('achicar columnas: los sabores que quedaban en columnas eliminadas se reubican, no se pierden', () => {
  const grid = { rows: 3, columns: 4, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 4 } } };
  const r = conDimensionesAjustadas(grid, 3, 2);
  assert.deepStrictEqual(r.positions.a, { row: 1, column: 1 }, 'a seguia entrando, no se toca');
  assert.ok(r.positions.b, 'b se reubico, no desaparecio');
  assert.ok(r.positions.b.column <= 2);
  assert.deepStrictEqual(r.reubicados, ['b']);
});

check('achicar columnas hasta el punto de no tener lugar: agrega filas en vez de perder sabores', () => {
  const grid = { rows: 1, columns: 4, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 1, column: 2 }, c: { row: 1, column: 3 }, d: { row: 1, column: 4 } } };
  const r = conDimensionesAjustadas(grid, 1, 1);
  const idsUbicados = Object.keys(r.positions);
  assert.deepStrictEqual(idsUbicados.sort(), ['a', 'b', 'c', 'd'].sort());
  assert.ok(r.rows >= 4, 'tuvo que agregar filas para que entraran las 4 en 1 sola columna');
});

check('eliminar columnas descarta sus títulos; columnas nuevas quedan sin título', () => {
  const grid = { rows: 2, columns: 3, columnTitles: { 1: 'CHOCOLATES', 2: 'CREMAS', 3: 'DULCES' }, positions: {} };
  const achicada = conDimensionesAjustadas(grid, 2, 2);
  assert.deepStrictEqual(achicada.columnTitles, { 1: 'CHOCOLATES', 2: 'CREMAS' });

  const agrandada = conDimensionesAjustadas(grid, 2, 5);
  assert.deepStrictEqual(agrandada.columnTitles, { 1: 'CHOCOLATES', 2: 'CREMAS', 3: 'DULCES' });
  assert.strictEqual(agrandada.columnTitles['4'], undefined, 'columna nueva sin titulo');
});

// ---------------------------------------------------------------------------
console.log('\nconPosicionesIntercambiadas — mover / intercambiar en el editor:');

check('mover a una celda VACÍA: solo se mueve, no afecta a nadie más', () => {
  const grid = { rows: 3, columns: 3, columnTitles: {}, positions: { a: { row: 1, column: 1 } } };
  const r = conPosicionesIntercambiadas(grid, 'a', { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.a, { row: 2, column: 2 });
});

check('mover a una celda OCUPADA: se intercambian entre sí', () => {
  const grid = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 2, column: 2 } } };
  const r = conPosicionesIntercambiadas(grid, 'a', { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.a, { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.b, { row: 1, column: 1 });
});

check('intercambiar no afecta a un tercer sabor en otra celda', () => {
  const grid = { rows: 2, columns: 2, columnTitles: {}, positions: { a: { row: 1, column: 1 }, b: { row: 2, column: 2 }, c: { row: 1, column: 2 } } };
  const r = conPosicionesIntercambiadas(grid, 'a', { row: 2, column: 2 });
  assert.deepStrictEqual(r.positions.c, { row: 1, column: 2 });
});

// ---------------------------------------------------------------------------
console.log('\nconTituloDeColumna:');

check('setea un título nuevo', () => {
  const r = conTituloDeColumna(grillaPorDefecto(), 1, 'CHOCOLATES');
  assert.strictEqual(r.columnTitles['1'], 'CHOCOLATES');
});

check('título vacío es válido: borra el título existente', () => {
  const conTitulo = conTituloDeColumna(grillaPorDefecto(), 1, 'CHOCOLATES');
  const sinTitulo = conTituloDeColumna(conTitulo, 1, '');
  assert.strictEqual(sinTitulo.columnTitles['1'], undefined);
});

// ---------------------------------------------------------------------------
console.log('\nPersistencia real en filesystem (directorio temporal real, simula reinicio de la app):');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'optgrid-test-'));

check('guardar y "reiniciar la app" (nueva lectura desde cero) conserva la grilla completa', () => {
  const ruta = rutaArchivoGrid(tmpRoot, '57641732');
  const dataInicial = leerArchivoGrid(ruta);
  assert.deepStrictEqual(dataInicial, {}, 'no deberia existir nada todavia');

  const grid = { rows: 14, columns: 6, columnTitles: { 1: 'CHOCOLATES', 2: 'CREMAS' }, positions: { choc: { row: 1, column: 1 } } };
  const actualizada = conGridActualizada(dataInicial, 'PC-A', 'GRUPO-1G', grid);
  escribirArchivoGrid(ruta, actualizada);

  const releido = leerArchivoGrid(ruta);
  const guardada = obtenerGridGuardada(releido, 'PC-A', 'GRUPO-1G');
  assert.deepStrictEqual(guardada, grid);
});

check('misma PC + OTRO local: archivo y grilla completamente independientes', () => {
  const rutaLocalA = rutaArchivoGrid(tmpRoot, '57641732');
  const rutaLocalB = rutaArchivoGrid(tmpRoot, '40508022');
  assert.notStrictEqual(rutaLocalA, rutaLocalB);

  const dataB = conGridActualizada({}, 'PC-A', 'GRUPO-1G', { rows: 5, columns: 3, columnTitles: {}, positions: { x: { row: 5, column: 3 } } });
  escribirArchivoGrid(rutaLocalB, dataB);

  const releidoA = leerArchivoGrid(rutaLocalA);
  const releidoB = leerArchivoGrid(rutaLocalB);
  assert.strictEqual(obtenerGridGuardada(releidoA, 'PC-A', 'GRUPO-1G').rows, 14, 'local A no se toco');
  assert.strictEqual(obtenerGridGuardada(releidoB, 'PC-A', 'GRUPO-1G').rows, 5);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
