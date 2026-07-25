// Desktop y Tablet deben producir EXACTAMENTE el mismo resultado de validación
// para el mismo JSON de DLV (grupos manuales).
//
// Compara la salida completa (status, issues, canonicalItems, totales) contra la
// del repo vecino, importando su módulo real.
//
// Correr con: node src/lib/api/__tests__/paridadValidacionExterna.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarPedidoExterno } from '../validacionPedidoExterno.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const esteRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const contenedor = path.dirname(esteRepo);
const OTROS = ['recepcion-de-pedidos-desktop', 'recepcion-de-pedidos-tab']
  .map((n) => ({ nombre: n, ruta: path.join(contenedor, n, 'src/lib/api/validacionPedidoExterno.js') }))
  .filter((r) => path.resolve(path.join(contenedor, r.nombre)) !== path.resolve(esteRepo) && fs.existsSync(r.ruta));

const CATALOGO = {
  articulos: {
    'A-0007': {
      nombre: '1 KILO DE HELADO', valor: 14500, activoDelivery: true,
      opcionalesConfig: {
        'G-TOP': { activo: true, min: 0, max: 3, opcionales: ['O-21'] },
      },
    },
  },
  gruposOpcionales: { 'G-TOP': { nombre: 'TOPPINGS' } },
  opcionales: { 'O-21': { nombre: 'Rocklets', grupo: 'G-TOP', precio: 1700, activo: true } },
};

/** Casos que deben dar el mismo resultado en los dos receptores. */
const CASOS = {
  correcto: 1700,
  manipulado: 100,
  cero: 0,
};

function pedidoCon(precio) {
  const total = 14500 + precio;
  return {
    id: 7, origen: 'DLV', status: { main: 'ACEPTADO' },
    items: [{
      id: 'A-0007', codigo: 'A-0007', nombre: '1 KILO DE HELADO',
      valor: 14500, precioBaseUnitario: 14500, quantity: 1, uniqueId: 'u1',
      unidadIndice: 1, unidadTotal: 1,
      selectedOptionals: {
        'G-TOP': [{
          id: 'O-21', nombre: 'Rocklets',
          precioUnitario: precio, precio, cantidad: 1, quantity: 1, total: precio,
        }],
      },
      totalOpcionales: precio, subtotalLinea: total, opcionalesIncluidosEnValor: false,
    }],
    payment: { total },
  };
}

console.log(`Paridad de validación desde ${path.basename(esteRepo)} contra: ${OTROS.map((o) => o.nombre).join(', ') || '(ninguno)'}`);

if (OTROS.length === 0) {
  check('el otro receptor no está disponible: se omite la comparación', () => assert.ok(true));
} else {
  for (const otro of OTROS) {
    const mod = await import(`file:///${otro.ruta.replace(/\\/g, '/')}`);
    for (const [nombre, precio] of Object.entries(CASOS)) {
      check(`caso "${nombre}" da el MISMO resultado que ${otro.nombre}`, () => {
        const aqui = validarPedidoExterno(pedidoCon(precio), CATALOGO, { canal: 'delivery' });
        const alla = mod.validarPedidoExterno(pedidoCon(precio), CATALOGO, { canal: 'delivery' });
        assert.strictEqual(JSON.stringify(aqui), JSON.stringify(alla), `divergen en "${nombre}"`);
      });
    }
    check(`${otro.nombre}: mismo status y mismos totales`, () => {
      const aqui = validarPedidoExterno(pedidoCon(100), CATALOGO, { canal: 'delivery' });
      const alla = mod.validarPedidoExterno(pedidoCon(100), CATALOGO, { canal: 'delivery' });
      assert.strictEqual(aqui.status, alla.status);
      assert.strictEqual(aqui.status, 'price-mismatch');
      assert.strictEqual(aqui.canonicalTotal, alla.canonicalTotal);
      assert.strictEqual(aqui.canonicalTotal, 16200);
      assert.strictEqual(aqui.receivedTotal, alla.receivedTotal);
      assert.strictEqual(aqui.receivedTotal, 14600);
    });
    check(`${otro.nombre}: mismos issues, en el mismo orden`, () => {
      const aqui = validarPedidoExterno(pedidoCon(100), CATALOGO, { canal: 'delivery' });
      const alla = mod.validarPedidoExterno(pedidoCon(100), CATALOGO, { canal: 'delivery' });
      assert.deepStrictEqual(aqui.issues, alla.issues);
    });
  }
}

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
