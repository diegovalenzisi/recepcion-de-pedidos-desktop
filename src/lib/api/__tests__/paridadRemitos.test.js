// Paridad de los módulos de REMITOS (FCX) entre Desktop y Tablet.
//
// Los dos receptores tienen que escribir y leer EXACTAMENTE la misma ruta
// (/{localId}/Remitos) con la misma estructura: si no, un remito emitido en la
// tablet no se vería en el desktop. Por eso estos archivos van byte a byte
// iguales y este test falla si alguien toca una copia sola.
//
// DLV Pedidos queda afuera a propósito: no emite ventas ni comprobantes, sólo
// crea pedidos en PEDIDOS. No tiene (ni debe tener) estos módulos.
//
// Correr con: node src/lib/api/__tests__/paridadRemitos.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const RECEPTORES = ['recepcion-de-pedidos-desktop', 'recepcion-de-pedidos-tab'];

const ARCHIVOS = [
  'src/lib/api/remitos.js',
  'src/lib/api/remitosFlujo.js',
  'src/lib/api/remitosApi.js',
  'src/lib/api/__tests__/remitos.test.js',
  'src/lib/api/__tests__/remitosEmulator.integration.mjs',
  'src/lib/api/__tests__/paridadRemitos.test.js',
];

const esteRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const contenedor = path.dirname(esteRepo);
const otrosRepos = RECEPTORES
  .map((n) => path.join(contenedor, n))
  .filter((p) => path.resolve(p) !== path.resolve(esteRepo) && fs.existsSync(p));

const hash = (p) => createHash('sha256')
  .update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');
const nombre = (p) => path.basename(p);

console.log(`Paridad de remitos desde ${nombre(esteRepo)} contra: ${otrosRepos.map(nombre).join(', ') || '(ninguno disponible)'}`);

for (const rel of ARCHIVOS) {
  check(rel, () => {
    const aqui = path.join(esteRepo, rel);
    assert.ok(fs.existsSync(aqui), `falta en ${nombre(esteRepo)}: ${rel}`);
    let comparados = 0;
    for (const otro of otrosRepos) {
      const alla = path.join(otro, rel);
      assert.ok(fs.existsSync(alla), `falta en ${nombre(otro)}: ${rel}`);
      comparados += 1;
      assert.strictEqual(hash(aqui), hash(alla),
        `${rel} difiere entre ${nombre(esteRepo)} y ${nombre(otro)}: sincronizá el cambio`);
    }
    if (comparados === 0) console.log('      (ningún otro receptor disponible)');
  });
}

// La ruta canónica es parte del contrato: si alguien la cambia en un repo, el
// otro deja de ver los remitos. Se verifica sobre el texto del módulo puro para
// no depender de Firebase.
console.log('\nContrato de la ruta:');
check('el nodo se llama Remitos y el local es el primer segmento', async () => {
  const fuente = fs.readFileSync(path.join(esteRepo, 'src/lib/api/remitos.js'), 'utf8');
  assert.ok(/NODO_REMITOS = 'Remitos'/.test(fuente), 'cambió el nombre del nodo');
  assert.ok(/construirRutaLocal\(localId, NODO_REMITOS\)/.test(fuente),
    'la ruta ya no se construye con el localId como primer segmento');
  assert.ok(!/'Remitos\/\$\{localId\}'|`Remitos\//.test(fuente), 'aparece una ruta /Remitos/{localId}');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
