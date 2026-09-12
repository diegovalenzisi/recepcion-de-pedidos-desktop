'use strict';

// Orden manual de opcionales/sabores, LOCAL por PC (nunca en Firebase).
// Correr con: node electron/lib/__tests__/optionalesOrdenLocal.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  rutaArchivoOrden,
  leerArchivoOrden,
  escribirArchivoOrden,
  obtenerOrdenesDelDispositivo,
  obtenerOrdenGuardado,
  conOrdenActualizado,
  conOrdenesMultiplesActualizadas,
  combinarOrdenConVigentes,
} = require('../optionalesOrdenLocal.js');

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Lógica pura (sin filesystem)
// ---------------------------------------------------------------------------
console.log('conOrdenActualizado / obtenerOrdenGuardado (puro):');

check('grupo nuevo para un dispositivo nuevo: se crea sin afectar nada más', () => {
  const data = conOrdenActualizado({}, 'PC-1', 'GUSTOS', ['choc', 'vain']);
  assert.deepStrictEqual(data, { 'PC-1': { GUSTOS: ['choc', 'vain'] } });
});

check('mismo dispositivo, dos grupos distintos: ordenar uno no altera el otro', () => {
  let data = conOrdenActualizado({}, 'PC-1', 'GUSTOS', ['choc', 'vain']);
  data = conOrdenActualizado(data, 'PC-1', 'TOPPINGS', ['nuez', 'dulce']);
  // Reordeno GUSTOS
  data = conOrdenActualizado(data, 'PC-1', 'GUSTOS', ['vain', 'choc']);
  assert.deepStrictEqual(obtenerOrdenGuardado(data, 'PC-1', 'GUSTOS'), ['vain', 'choc']);
  assert.deepStrictEqual(obtenerOrdenGuardado(data, 'PC-1', 'TOPPINGS'), ['nuez', 'dulce'], 'TOPPINGS no debia cambiar');
});

check('dos dispositivos distintos, mismo grupo: orden independiente', () => {
  let data = conOrdenActualizado({}, 'PC-1', 'GUSTOS', ['choc', 'vain']);
  data = conOrdenActualizado(data, 'PC-2', 'GUSTOS', ['vain', 'choc']);
  assert.deepStrictEqual(obtenerOrdenGuardado(data, 'PC-1', 'GUSTOS'), ['choc', 'vain']);
  assert.deepStrictEqual(obtenerOrdenGuardado(data, 'PC-2', 'GUSTOS'), ['vain', 'choc']);
});

check('obtenerOrdenGuardado sin nada guardado -> []', () => {
  assert.deepStrictEqual(obtenerOrdenGuardado({}, 'PC-1', 'GUSTOS'), []);
});

check('conOrdenesMultiplesActualizadas guarda varios grupos de una, sin pisarse entre ellos', () => {
  const data = conOrdenesMultiplesActualizadas({}, 'PC-1', { GUSTOS: ['choc', 'vain'], TOPPINGS: ['nuez'] });
  assert.deepStrictEqual(obtenerOrdenesDelDispositivo(data, 'PC-1'), { GUSTOS: ['choc', 'vain'], TOPPINGS: ['nuez'] });
});

// ---------------------------------------------------------------------------
console.log('\ncombinarOrdenConVigentes (sabor nuevo / sabor eliminado):');

check('sin cambios en el catalogo: el orden guardado se respeta tal cual', () => {
  const r = combinarOrdenConVigentes(['choc', 'vain', 'frut'], ['choc', 'vain', 'frut']);
  assert.deepStrictEqual(r, ['choc', 'vain', 'frut']);
});

check('aparece un sabor NUEVO: se agrega al final, sin alterar el resto', () => {
  const r = combinarOrdenConVigentes(['choc', 'vain'], ['choc', 'vain', 'frut-nuevo']);
  assert.deepStrictEqual(r, ['choc', 'vain', 'frut-nuevo']);
});

check('se elimina un sabor: su id guardado se ignora, sin error, sin dejar huecos', () => {
  const r = combinarOrdenConVigentes(['choc', 'vain', 'eliminado'], ['choc', 'vain']);
  assert.deepStrictEqual(r, ['choc', 'vain']);
});

check('combinado: uno eliminado y uno nuevo a la vez', () => {
  const r = combinarOrdenConVigentes(['choc', 'eliminado', 'vain'], ['vain', 'choc', 'nuevo']);
  assert.deepStrictEqual(r, ['choc', 'vain', 'nuevo']);
});

check('sin orden guardado (primera vez): usa el orden vigente tal cual viene', () => {
  const r = combinarOrdenConVigentes([], ['choc', 'vain']);
  assert.deepStrictEqual(r, ['choc', 'vain']);
});

check('ids repetidos en lo guardado (dato corrupto) no duplican el resultado', () => {
  const r = combinarOrdenConVigentes(['choc', 'choc', 'vain'], ['choc', 'vain']);
  assert.deepStrictEqual(r, ['choc', 'vain']);
});

// ---------------------------------------------------------------------------
// Persistencia real en filesystem (directorio temporal real, no Electron)
// ---------------------------------------------------------------------------
console.log('\nPersistencia real (archivo en disco, simula reinicio de la app):');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'optorden-test-'));

check('ordenar y "reiniciar la app" (nueva lectura desde cero) conserva el orden', () => {
  const ruta = rutaArchivoOrden(tmpRoot, '57641732');
  const dataInicial = leerArchivoOrden(ruta);
  assert.deepStrictEqual(dataInicial, {}, 'no deberia existir nada todavia');

  const actualizada = conOrdenActualizado(dataInicial, 'PC-A', 'GUSTOS', ['choc', 'vain', 'frut']);
  escribirArchivoOrden(ruta, actualizada);

  // "Reinicio de la app": instancia nueva, vuelve a leer del disco.
  const releido = leerArchivoOrden(ruta);
  assert.deepStrictEqual(obtenerOrdenGuardado(releido, 'PC-A', 'GUSTOS'), ['choc', 'vain', 'frut']);
});

check('misma PC + mismo local: una segunda escritura en otro grupo conserva la anterior', () => {
  const ruta = rutaArchivoOrden(tmpRoot, '57641732');
  let data = leerArchivoOrden(ruta);
  data = conOrdenActualizado(data, 'PC-A', 'TOPPINGS', ['nuez', 'dulce']);
  escribirArchivoOrden(ruta, data);

  const releido = leerArchivoOrden(ruta);
  assert.deepStrictEqual(obtenerOrdenGuardado(releido, 'PC-A', 'GUSTOS'), ['choc', 'vain', 'frut'], 'el orden anterior de GUSTOS debia seguir ahi');
  assert.deepStrictEqual(obtenerOrdenGuardado(releido, 'PC-A', 'TOPPINGS'), ['nuez', 'dulce']);
});

check('misma PC + OTRO local: archivo y orden completamente independientes', () => {
  const rutaLocalA = rutaArchivoOrden(tmpRoot, '57641732');
  const rutaLocalB = rutaArchivoOrden(tmpRoot, '40508022');
  assert.notStrictEqual(rutaLocalA, rutaLocalB);

  // El local B nunca tuvo nada guardado para PC-A.
  const dataB = leerArchivoOrden(rutaLocalB);
  assert.deepStrictEqual(obtenerOrdenGuardado(dataB, 'PC-A', 'GUSTOS'), []);

  const dataBActualizada = conOrdenActualizado(dataB, 'PC-A', 'GUSTOS', ['frut', 'choc']);
  escribirArchivoOrden(rutaLocalB, dataBActualizada);

  // El local A no se vio afectado por la escritura en B.
  const dataAReleida = leerArchivoOrden(rutaLocalA);
  assert.deepStrictEqual(obtenerOrdenGuardado(dataAReleida, 'PC-A', 'GUSTOS'), ['choc', 'vain', 'frut']);
  // Y B quedo con lo suyo.
  const dataBReleida = leerArchivoOrden(rutaLocalB);
  assert.deepStrictEqual(obtenerOrdenGuardado(dataBReleida, 'PC-A', 'GUSTOS'), ['frut', 'choc']);
});

check('OTRO deviceId + mismo local: orden independiente dentro del mismo archivo', () => {
  const ruta = rutaArchivoOrden(tmpRoot, '57641732');
  let data = leerArchivoOrden(ruta);
  // PC-B nunca guardo nada para GUSTOS en este local.
  assert.deepStrictEqual(obtenerOrdenGuardado(data, 'PC-B', 'GUSTOS'), []);

  data = conOrdenActualizado(data, 'PC-B', 'GUSTOS', ['vain', 'frut', 'choc']);
  escribirArchivoOrden(ruta, data);

  const releido = leerArchivoOrden(ruta);
  assert.deepStrictEqual(obtenerOrdenGuardado(releido, 'PC-A', 'GUSTOS'), ['choc', 'vain', 'frut'], 'PC-A no debia cambiar');
  assert.deepStrictEqual(obtenerOrdenGuardado(releido, 'PC-B', 'GUSTOS'), ['vain', 'frut', 'choc']);
});

check('aparece un sabor nuevo en el local real (via combinarOrdenConVigentes sobre lo leido): queda al final', () => {
  const ruta = rutaArchivoOrden(tmpRoot, '57641732');
  const data = leerArchivoOrden(ruta);
  const guardado = obtenerOrdenGuardado(data, 'PC-A', 'GUSTOS'); // ['choc','vain','frut']
  const vigentesConNuevo = ['choc', 'vain', 'frut', 'mango-nuevo'];
  const combinado = combinarOrdenConVigentes(guardado, vigentesConNuevo);
  assert.deepStrictEqual(combinado, ['choc', 'vain', 'frut', 'mango-nuevo']);
});

check('se elimina un sabor del catalogo real: no rompe la lectura ni genera error', () => {
  const ruta = rutaArchivoOrden(tmpRoot, '57641732');
  const data = leerArchivoOrden(ruta);
  const guardado = obtenerOrdenGuardado(data, 'PC-A', 'GUSTOS'); // ['choc','vain','frut']
  const vigentesSinVain = ['choc', 'frut']; // "vain" ya no existe en el catalogo
  const combinado = combinarOrdenConVigentes(guardado, vigentesSinVain);
  assert.deepStrictEqual(combinado, ['choc', 'frut']);
});

check('archivo corrupto (JSON invalido): se trata como vacio, nunca rompe ni tira', () => {
  const rutaCorrupta = rutaArchivoOrden(tmpRoot, 'local-corrupto');
  fs.mkdirSync(path.dirname(rutaCorrupta), { recursive: true });
  fs.writeFileSync(rutaCorrupta, '{ esto no es JSON valido ][', 'utf-8');
  const data = leerArchivoOrden(rutaCorrupta);
  assert.deepStrictEqual(data, {});
});

check('"actualizacion de la app" simulada (releer el mismo archivo en userData) no pierde nada', () => {
  const ruta = rutaArchivoOrden(tmpRoot, '57641732');
  const antesDeActualizar = leerArchivoOrden(ruta);
  // Una actualización reemplaza la carpeta de instalación, NO userData: el
  // archivo sigue en el mismo lugar, se simula con una relectura directa.
  const despuesDeActualizar = leerArchivoOrden(ruta);
  assert.deepStrictEqual(despuesDeActualizar, antesDeActualizar);
  assert.deepStrictEqual(obtenerOrdenGuardado(despuesDeActualizar, 'PC-A', 'GUSTOS'), ['choc', 'vain', 'frut']);
});

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
