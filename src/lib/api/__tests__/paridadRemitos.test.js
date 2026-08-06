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
  // La decisión factura/remito: si un receptor decidiera distinto que el otro,
  // la misma venta saldría facturada en uno y con FCX en el otro.
  'src/lib/api/facturaORemito.js',
  'src/lib/api/facturaORemitoApi.js',
  'src/lib/api/__tests__/facturaORemito.test.js',
  'src/lib/api/__tests__/comprobanteEmulator.integration.mjs',
  // Facturar un remito a posteriori: si un receptor lo hiciera distinto, el
  // mismo FCX podría terminar con dos facturas.
  'src/lib/api/facturacionDeRemito.js',
  'src/lib/api/facturacionDeRemitoApi.js',
  'src/lib/api/__tests__/facturacionDeRemito.test.js',
  'src/lib/api/__tests__/facturacionRemitoEmulator.integration.mjs',
  'src/pages/SalesTable.jsx',
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

console.log('\nContrato de la decisión:');
check('el remito se omite por la decisión, no por el nombre del medio de pago', () => {
  const fuente = fs.readFileSync(path.join(esteRepo, 'src/lib/api/remitosFlujo.js'), 'utf8');
  assert.ok(/ventaSeFactura\(venta\)/.test(fuente), 'la compuerta ya no usa ventaSeFactura()');
});
check('el interruptor se llama imprimeFactura en los dos receptores', () => {
  for (const repo of [esteRepo, ...otrosRepos]) {
    const fuente = fs.readFileSync(path.join(repo, 'src/lib/api/facturaORemito.js'), 'utf8');
    assert.ok(/CAMPO_IMPRIME_FACTURA = 'imprimeFactura'/.test(fuente),
      `cambió el nombre del campo en ${nombre(repo)}`);
  }
});
check('las colas fiscales se resuelven por coincidencia exacta, sin includes()', () => {
  for (const rel of ['src/lib/api/counterApi.js', 'src/lib/api/ordersApi.js']) {
    for (const repo of [esteRepo, ...otrosRepos]) {
      const fuente = fs.readFileSync(path.join(repo, rel), 'utf8');
      assert.ok(!/includes\('transferencia/i.test(fuente),
        `${rel} de ${nombre(repo)} todavía elige la cola por substring del nombre`);
      assert.ok(!/getFacturacionNodeForPayment/.test(fuente),
        `${rel} de ${nombre(repo)} conserva el ruteo viejo por nombre`);
    }
  }
});
check('facturar un remito NO emite notas de crédito en ningún receptor', () => {
  for (const rel of ['src/lib/api/facturacionDeRemito.js', 'src/lib/api/facturacionDeRemitoApi.js']) {
    for (const repo of [esteRepo, ...otrosRepos]) {
      // Se miran los comentarios aparte: ahí SÍ se explica que no se anula nada.
      const codigo = fs.readFileSync(path.join(repo, rel), 'utf8')
        .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
      for (const prohibido of ['notacredito', 'nota_credito', 'notadecredito', 'anular']) {
        assert.ok(!codigo.includes(prohibido), `${rel} de ${nombre(repo)} menciona "${prohibido}"`);
      }
    }
  }
});
check('los dos receptores escriben el remito en /{localId}/Remitos', () => {
  for (const repo of [esteRepo, ...otrosRepos]) {
    const fuente = fs.readFileSync(path.join(repo, 'src/lib/api/facturacionDeRemitoApi.js'), 'utf8');
    assert.ok(/rutaRemito\(raiz, numeroComprobante\)/.test(fuente),
      `${nombre(repo)} no usa la ruta canónica del remito`);
    assert.ok(!/['"`]Remitos\//.test(fuente), `${nombre(repo)} arma una ruta /Remitos/...`);
  }
});
check('el comprobante se emite por el TOTAL, nunca por el importe de un pago', () => {
  for (const rel of ['src/lib/api/counterApi.js', 'src/lib/api/ordersApi.js']) {
    for (const repo of [esteRepo, ...otrosRepos]) {
      const fuente = fs.readFileSync(path.join(repo, rel), 'utf8');
      assert.ok(!/total: payment\.amount|total: pago\.amount/.test(fuente),
        `${rel} de ${nombre(repo)} factura el importe parcial de un pago`);
    }
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
