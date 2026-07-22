// Paridad de los MÓDULOS CANÓNICOS entre Desktop, Tablet y DLV Pedidos.
//
// La regla es: no se modifica una copia sin reflejar el mismo cambio en las
// otras. Este mismo archivo corre en los tres repos y falla si un módulo
// compartido se toca en uno y no en los demás.
//
// Correr con: node src/lib/api/__tests__/paridadCanonica.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const REPOS = ['recepcion-de-pedidos-desktop', 'recepcion-de-pedidos-tab', 'DLV Pedidos'];

const esteRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const contenedor = path.dirname(esteRepo);
const otrosRepos = REPOS
  .map((n) => path.join(contenedor, n))
  .filter((p) => path.resolve(p) !== path.resolve(esteRepo) && fs.existsSync(p));

// NÚCLEO: debe existir e ir idéntico en los TRES proyectos.
const NUCLEO = [
  'src/lib/api/optionalsPricing.js',
  'src/lib/api/unidadesPedido.js',
];

// COMPARTIDOS ENTRE RECEPTORES: solo aplican a Desktop y Tablet (DLV no imprime
// tickets ni calcula costo/ganancia). Donde existan en dos repos, deben coincidir.
const COMPARTIDOS_RECEPTORES = [
  'src/lib/api/ventaUtils.js',
  'src/lib/api/ordersIngest.js',
  'src/lib/print/orderPrintDetail.js',
  'src/lib/print/counterTicketHtml.js',
];

// Pruebas que deben ser idénticas donde existan.
const PRUEBAS_COMPARTIDAS = [
  'src/lib/api/__tests__/contratoPrecios.test.js',
  'src/lib/api/__tests__/paridadCanonica.test.js',
];

// Normaliza fin de línea: git puede checkoutear CRLF en un repo y LF en otro,
// y eso no es una divergencia real de comportamiento.
const hash = (p) => createHash('sha256')
  .update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

const nombre = (p) => path.basename(p);

console.log(`Paridad desde ${nombre(esteRepo)} contra: ${otrosRepos.map(nombre).join(', ') || '(ninguno disponible)'}`);

console.log('\nNúcleo (obligatorio en los tres):');
for (const rel of NUCLEO) {
  check(`${rel}`, () => {
    const aqui = path.join(esteRepo, rel);
    assert.ok(fs.existsSync(aqui), `falta en ${nombre(esteRepo)}: ${rel}`);
    for (const otro of otrosRepos) {
      const alla = path.join(otro, rel);
      assert.ok(fs.existsSync(alla), `falta en ${nombre(otro)}: ${rel}`);
      assert.strictEqual(hash(aqui), hash(alla),
        `${rel} difiere entre ${nombre(esteRepo)} y ${nombre(otro)}: sincronizá el cambio`);
    }
  });
}

console.log('\nCompartidos donde existan (Desktop / Tablet):');
for (const rel of [...COMPARTIDOS_RECEPTORES, ...PRUEBAS_COMPARTIDAS]) {
  check(`${rel}`, () => {
    const aqui = path.join(esteRepo, rel);
    if (!fs.existsSync(aqui)) { console.log('      (no aplica a este proyecto)'); return; }
    let comparados = 0;
    for (const otro of otrosRepos) {
      const alla = path.join(otro, rel);
      if (!fs.existsSync(alla)) continue;
      comparados += 1;
      assert.strictEqual(hash(aqui), hash(alla),
        `${rel} difiere entre ${nombre(esteRepo)} y ${nombre(otro)}: sincronizá el cambio`);
    }
    if (comparados === 0) console.log('      (ningún otro repo lo tiene)');
  });
}

// Exports pactados del módulo canónico de precios.
const EXPORTS_CANONICOS = [
  'normalizarImporte', 'obtenerPrecioOpcional', 'tienePrecio', 'precioOpcionalInvalido',
  'detectarOpcionalesConPrecioInvalido', 'listarOpcionalesSeleccionados',
  'calcularTotalOpcionalesUnidad', 'calcularTotalOpcionales', 'calcularSubtotalLinea',
  'calcularTotalPedido', 'construirSnapshotOpcionales', 'enriquecerOpcionalSnapshot',
  'construirLineaPersistible', 'verificarTotalRecibido', 'calcularConsumoStockOpcionales',
];

console.log('\nExports del módulo canónico de precios:');
const precios = await import('../optionalsPricing.js');
check('están exactamente los exports pactados', () => {
  const faltan = EXPORTS_CANONICOS.filter((n) => typeof precios[n] !== 'function');
  assert.strictEqual(faltan.length, 0, `faltan: ${faltan.join(', ')}`);
});
check('no sobra ningún export sin acordar', () => {
  const extra = Object.keys(precios).filter((n) => !EXPORTS_CANONICOS.includes(n));
  assert.strictEqual(extra.length, 0, `no pactados: ${extra.join(', ')}`);
});

console.log('\nExports del módulo de unidades:');
const unidades = await import('../unidadesPedido.js');
check('expone el manejo de unidades por línea', () => {
  for (const n of ['esLineaConfigurable', 'renumerarUnidades', 'quitarUnidad',
    'contarUnidadesConfiguradas', 'baseParaUnidadNueva', 'agregarUnidadConfigurada']) {
    assert.strictEqual(typeof unidades[n], 'function', n);
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
