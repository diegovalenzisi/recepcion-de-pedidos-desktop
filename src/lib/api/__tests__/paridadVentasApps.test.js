// Paridad de los módulos de VENTAS POR APP (PedidosYa / Rappi) entre Desktop y
// Tablet. Las dos pantallas tienen que leer las MISMAS rutas y normalizar igual:
// si no, el mismo local mostraría distinto historial en el desktop y en la
// tablet. Por eso estos archivos van byte a byte iguales y este test falla si
// alguien toca una copia sola.
//
// DLV Pedidos queda afuera a propósito: no cobra, no cierra caja y no guarda
// medios de pago. No tiene (ni debe tener) estos módulos.
//
// Correr con: node src/lib/api/__tests__/paridadVentasApps.test.js
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
  'src/lib/api/ventasApps.js',
  'src/lib/api/ventasAppsFlujo.js',
  'src/lib/api/ventasAppsApi.js',
  'src/lib/api/__tests__/ventasApps.test.js',
  'src/lib/api/__tests__/ventasAppsEmulator.integration.mjs',
  'src/lib/api/__tests__/paridadVentasApps.test.js',
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

console.log(`Paridad de ventas por app desde ${nombre(esteRepo)} contra: ${otrosRepos.map(nombre).join(', ') || '(ninguno disponible)'}`);

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

// Contrato de lectura: si alguien cambia estas rutas en un repo, el otro deja de
// ver las mismas ventas. Se verifica sobre el texto del módulo de lectura.
console.log('\nContrato de las rutas leídas:');
check('lee ventas vivas, BACKUP por día y el ledger, siempre bajo /{localId}/', () => {
  const fuente = fs.readFileSync(path.join(esteRepo, 'src/lib/api/ventasAppsFlujo.js'), 'utf8');
  for (const ruta of [
    '${raiz}/${nodo}',
    '${raiz}/BACKUP/${anio}/${mes}/${dia}/TURNO',
    '${raiz}/BACKUP/${nodo}',
    '${raiz}/PREPAGO_${plataforma}',
  ]) {
    assert.ok(fuente.includes(ruta), `ya no se lee ${ruta}`);
  }
  assert.ok(!/ref\(db,\s*['"`](?!\$\{raiz\})/.test(fuente), 'hay una lectura que no empieza por la raíz del local');
});
check('el módulo de lectura no escribe: no importa set/update/push/remove', () => {
  const fuente = fs.readFileSync(path.join(esteRepo, 'src/lib/api/ventasAppsFlujo.js'), 'utf8');
  const importes = /import\s*\{([^}]*)\}\s*from\s*'firebase\/database'/.exec(fuente)?.[1] || '';
  for (const prohibido of ['set', 'update', 'push', 'remove', 'runTransaction']) {
    assert.ok(!importes.split(',').map((s) => s.trim()).includes(prohibido),
      `importa ${prohibido}: esta pantalla es de sólo lectura`);
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
