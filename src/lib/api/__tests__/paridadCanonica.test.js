// F1.5 — Paridad de los MÓDULOS CANÓNICOS entre Desktop y Tablet.
//
// La regla es: no se modifica una copia sin reflejar el mismo cambio en la otra.
// Esta prueba corre en LOS DOS repos (es el mismo archivo) y falla si alguien
// toca un módulo compartido en uno y no en el otro. Además verifica que la lista
// de exports del módulo de precios sea exactamente la pactada.
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

const REPOS = ['recepcion-de-pedidos-desktop', 'recepcion-de-pedidos-tab'];

const esteRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const contenedor = path.dirname(esteRepo);
const otroRepo = REPOS
  .map((n) => path.join(contenedor, n))
  .find((p) => path.resolve(p) !== path.resolve(esteRepo) && fs.existsSync(p));

// Módulos que DEBEN ser byte a byte idénticos en los dos repos.
const COMPARTIDOS = [
  'src/lib/api/optionalsPricing.js',
  'src/lib/api/ventaUtils.js',
  'src/lib/api/unidadesPedido.js',
  'src/lib/print/orderPrintDetail.js',
  'src/lib/print/counterTicketHtml.js',
];

// Exports pactados del módulo canónico de precios (F1.5, punto 2).
const EXPORTS_CANONICOS = [
  'normalizarImporte',
  'obtenerPrecioOpcional',
  'tienePrecio',
  'precioOpcionalInvalido',
  'detectarOpcionalesConPrecioInvalido',
  'listarOpcionalesSeleccionados',
  'calcularTotalOpcionalesUnidad',
  'calcularTotalOpcionales',
  'calcularSubtotalLinea',
  'calcularTotalPedido',
  'construirSnapshotOpcionales',
  'enriquecerOpcionalSnapshot',
  'construirLineaPersistible',
  'verificarTotalRecibido',
  'calcularConsumoStockOpcionales',
];

// Normaliza fin de línea: git puede checkoutear CRLF en un repo y LF en el otro,
// y eso no es una divergencia real de comportamiento.
const hash = (p) => createHash('sha256')
  .update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');

console.log(`Paridad de módulos canónicos (${path.basename(esteRepo)} <-> ${otroRepo ? path.basename(otroRepo) : 'otro repo no encontrado'}):`);
for (const rel of COMPARTIDOS) {
  check(`${rel} idéntico en ambos repos`, () => {
    const aqui = path.join(esteRepo, rel);
    assert.ok(fs.existsSync(aqui), `falta en ${path.basename(esteRepo)}: ${rel}`);
    if (!otroRepo) {
      console.log('      (el otro repo no está disponible: se omite la comparación)');
      return;
    }
    const alla = path.join(otroRepo, rel);
    assert.ok(fs.existsSync(alla), `falta en ${path.basename(otroRepo)}: ${rel}`);
    assert.strictEqual(hash(aqui), hash(alla),
      `${rel} difiere entre los repos: sincronizá el cambio en los dos`);
  });
}

console.log('\nExports del módulo canónico de precios:');
const precios = await import('../optionalsPricing.js');
check('están exactamente los exports pactados', () => {
  const faltan = EXPORTS_CANONICOS.filter((n) => typeof precios[n] !== 'function');
  assert.strictEqual(faltan.length, 0, `faltan exports: ${faltan.join(', ')}`);
});
check('no sobra ningún export sin documentar', () => {
  const extra = Object.keys(precios).filter((n) => !EXPORTS_CANONICOS.includes(n));
  assert.strictEqual(extra.length, 0, `exports no pactados: ${extra.join(', ')}`);
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
