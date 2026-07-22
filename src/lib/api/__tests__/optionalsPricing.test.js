// Pruebas del cálculo centralizado de opcionales (Fase 1).
// Correr con: node src/lib/api/__tests__/optionalsPricing.test.js
import assert from 'node:assert';
import {
  normalizarImporte,
  obtenerPrecioOpcional,
  tienePrecio,
  calcularTotalOpcionalesUnidad,
  calcularTotalOpcionales,
  calcularSubtotalLinea,
  calcularTotalPedido,
  construirSnapshotOpcionales,
  calcularConsumoStockOpcionales,
} from '../optionalsPricing.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// Fixtures del caso real
const KILO = { id: 'kilo-1', nombre: '1 KILO DE HELADO', valor: 14500 };
const ROCKLETS = { id: 'op-rock', nombre: 'Rocklets', precio: 1700 };
const SALSA_GRATIS = { id: 'op-salsa', nombre: 'Salsa de chocolate', precio: 0 };
const CUCURUCHOS = { id: 'op-cuc', nombre: 'Cucuruchos x 3', precio: 900 };

console.log('normalizarImporte — formatos históricos:');
check('número 1700', () => assert.strictEqual(normalizarImporte(1700).valor, 1700));
check('string "1700"', () => assert.strictEqual(normalizarImporte('1700').valor, 1700));
check('string "1700.00" (punto decimal)', () => assert.strictEqual(normalizarImporte('1700.00').valor, 1700));
check('string "1.700" (punto de miles AR)', () => assert.strictEqual(normalizarImporte('1.700').valor, 1700));
check('string "$1.700"', () => assert.strictEqual(normalizarImporte('$1.700').valor, 1700));
check('string "$ 1.700,00"', () => assert.strictEqual(normalizarImporte('$ 1.700,00').valor, 1700));
check('string "1.234.567"', () => assert.strictEqual(normalizarImporte('1.234.567').valor, 1234567));
check('decimal real "1.5"', () => assert.strictEqual(normalizarImporte('1.5').valor, 1.5));
check('ausente (null/undefined/"") = 0 y VÁLIDO', () => {
  for (const v of [null, undefined, '']) {
    const r = normalizarImporte(v);
    assert.strictEqual(r.valor, 0);
    assert.strictEqual(r.valido, true);
    assert.strictEqual(r.ausente, true);
  }
});
check('inválido "abc" → valido:false, valor 0, NUNCA NaN', () => {
  const r = normalizarImporte('abc');
  assert.strictEqual(r.valido, false);
  assert.strictEqual(r.valor, 0);
  assert.ok(!Number.isNaN(r.valor));
});
check('NaN/Infinity → valido:false, nunca NaN', () => {
  assert.strictEqual(normalizarImporte(NaN).valido, false);
  assert.strictEqual(normalizarImporte(Infinity).valido, false);
  assert.ok(!Number.isNaN(normalizarImporte(NaN).valor));
});

console.log('\nobtenerPrecioOpcional / tienePrecio:');
check('lee precio del opcional', () => assert.strictEqual(obtenerPrecioOpcional(ROCKLETS), 1700));
check('precio 0 → tienePrecio false (no mostrar "+$0")', () => {
  assert.strictEqual(tienePrecio(SALSA_GRATIS), false);
  assert.strictEqual(tienePrecio(ROCKLETS), true);
});
check('prioriza precioUnitario (snapshot congelado) sobre precio actual', () => {
  assert.strictEqual(obtenerPrecioOpcional({ nombre: 'X', precioUnitario: 1500, precio: 9999 }), 1500);
});
check('importe inválido dispara onWarn con identificación', () => {
  const warns = [];
  obtenerPrecioOpcional({ nombre: 'Roto', precio: 'abc' }, null, (w) => warns.push(w));
  assert.strictEqual(warns.length, 1);
  assert.strictEqual(warns[0].opcional, 'Roto');
  assert.strictEqual(warns[0].tipo, 'importe-invalido');
});

console.log('\nCaso real — 1 KILO DE HELADO + Rocklets:');
check('1. sin opcional → $14.500', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1 });
  assert.strictEqual(l.subtotal, 14500);
  assert.strictEqual(l.totalOpcionales, 0);
});
check('2. + Rocklets $1.700 → $16.200 (suma exactamente una vez)', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } });
  assert.strictEqual(l.precioBase, 14500);
  assert.strictEqual(l.totalOpcionales, 1700);
  assert.strictEqual(l.subtotal, 16200);
});
check('3. deseleccionar Rocklets → vuelve a $14.500', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1, selectedOptionals: { g1: [] } });
  assert.strictEqual(l.subtotal, 14500);
});
check('4. dos opcionales pagos → suma ambos', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS, CUCURUCHOS] } });
  assert.strictEqual(l.totalOpcionales, 2600);
  assert.strictEqual(l.subtotal, 17100);
});
check('5. opcional valor 0 → no cambia el total', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1, selectedOptionals: { g1: [SALSA_GRATIS] } });
  assert.strictEqual(l.subtotal, 14500);
});
check('6. opcional string "1700" → suma correctamente', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1, selectedOptionals: { g1: [{ nombre: 'R', precio: '1700' }] } });
  assert.strictEqual(l.subtotal, 16200);
});
check('7. opcional histórico "$ 1.700,00" → se interpreta bien', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 1, selectedOptionals: { g1: [{ nombre: 'R', precio: '$ 1.700,00' }] } });
  assert.strictEqual(l.subtotal, 16200);
});
check('8. valor inválido → warning y nunca NaN', () => {
  const warns = [];
  const l = calcularSubtotalLinea(
    { ...KILO, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Roto', precio: 'xx' }] } },
    { onWarn: (w) => warns.push(w) }
  );
  assert.ok(warns.length >= 1);
  assert.ok(!Number.isNaN(l.subtotal));
  assert.strictEqual(l.subtotal, 14500);
});

console.log('\nRegla POR UNIDAD (cantidad > 1, selección independiente por unidad):');
check('27a. 2 unidades como 2 líneas, Rocklets solo en la unidad 1 → $30.700', () => {
  const items = [
    { ...KILO, quantity: 1, unidadIndice: 1, unidadTotal: 2, selectedOptionals: { g1: [ROCKLETS] } },
    { ...KILO, quantity: 1, unidadIndice: 2, unidadTotal: 2, selectedOptionals: { g1: [] } },
  ];
  const t = calcularTotalPedido(items);
  assert.strictEqual(t.totalBase, 29000);
  assert.strictEqual(t.totalOpcionales, 1700);
  assert.strictEqual(t.total, 30700);
});
check('27b. Rocklets en AMBAS unidades → $1.700 × 2', () => {
  const items = [
    { ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } },
    { ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } },
  ];
  const t = calcularTotalPedido(items);
  assert.strictEqual(t.totalOpcionales, 3400);
  assert.strictEqual(t.total, 32400);
});
check('27c. línea legacy con quantity 2 y una selección → multiplica por unidad', () => {
  const l = calcularSubtotalLinea({ ...KILO, quantity: 2, selectedOptionals: { g1: [ROCKLETS] } });
  assert.strictEqual(l.totalOpcionales, 3400);
  assert.strictEqual(l.subtotal, 32400);
});

console.log('\nAnti doble-suma y compatibilidad:');
check('24. valor SIEMPRE es base: recalcular no vuelve a sumar el opcional', () => {
  const item = { ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } };
  const a = calcularSubtotalLinea(item).subtotal;
  const b = calcularSubtotalLinea(item).subtotal; // idempotente
  assert.strictEqual(a, 16200);
  assert.strictEqual(b, 16200);
});
check('23. Desktop/Tab/DLV usan la misma función → mismo total', () => {
  const items = [{ ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } }];
  assert.strictEqual(calcularTotalPedido(items).total, 16200);
});
check('25. pedido histórico sin precio ni articleId no rompe', () => {
  const l = calcularSubtotalLinea({ nombre: 'Viejo', valor: '14500', quantity: 1, selectedOptionals: { g1: [{ nombre: 'Sin precio' }] } });
  assert.strictEqual(l.subtotal, 14500);
  assert.ok(!Number.isNaN(l.subtotal));
});
check('item sin selectedOptionals no rompe', () => {
  assert.strictEqual(calcularSubtotalLinea({ valor: 100, quantity: 3 }).subtotal, 300);
});

console.log('\nCompatibilidad / detección de doble suma (condición 1):');
check('línea con snapshot congelado NO se recalcula (manda el subtotal guardado)', () => {
  const l = calcularSubtotalLinea({
    nombre: 'Kilo', valor: 99999, quantity: 1,          // precio actual cambió
    precioBaseUnitario: 14500, totalOpcionales: 1700, subtotalLinea: 16200,
    selectedOptionals: { g1: [ROCKLETS] },              // no debe volver a sumarse
  });
  assert.strictEqual(l.subtotal, 16200);
  assert.strictEqual(l.fuente, 'snapshot-congelado');
});
check('legacy marcado opcionalesIncluidosEnValor → NO vuelve a sumar', () => {
  const l = calcularSubtotalLinea({
    valor: 16200, quantity: 1, opcionalesIncluidosEnValor: true,
    selectedOptionals: { g1: [ROCKLETS] },
  });
  assert.strictEqual(l.subtotal, 16200);
  assert.strictEqual(l.totalOpcionales, 0);
});
check('histórico real (opcional sin precio) → recalcular da el MISMO total guardado', () => {
  // Así están hoy los pedidos: valor=base y opcionales sin precio ⇒ sin doble suma.
  const historico = { valor: 14500, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Rocklets', quantity: 1 }] } };
  assert.strictEqual(calcularSubtotalLinea(historico).subtotal, 14500);
});
check('recalcular N veces una línea nueva es idempotente (nunca duplica)', () => {
  const item = { ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } };
  const r = [1, 2, 3].map(() => calcularSubtotalLinea(item).subtotal);
  assert.deepStrictEqual(r, [16200, 16200, 16200]);
});

console.log('\nSnapshot congelado (29: cambio de precio posterior no altera históricos):');
check('construye snapshot con precio congelado y cantidad', () => {
  const snap = construirSnapshotOpcionales({ selectedOptionals: { g1: [{ ...ROCKLETS, articleId: 'art-rock', departamentoId: 'dep-top' }] } });
  assert.strictEqual(snap.length, 1);
  assert.strictEqual(snap[0].precioUnitario, 1700);
  assert.strictEqual(snap[0].articleId, 'art-rock');
  assert.strictEqual(snap[0].origen, 'departamento');
  assert.strictEqual(snap[0].total, 1700);
});
check('29. el snapshot manda aunque cambie el precio del artículo', () => {
  const snapItem = { valor: 14500, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Rocklets', precioUnitario: 1700, precio: 9999 }] } };
  assert.strictEqual(calcularSubtotalLinea(snapItem).subtotal, 16200);
});
check('opcional manual (sin articleId) → origen manual y sin consumo de stock', () => {
  const snap = construirSnapshotOpcionales({ selectedOptionals: { g1: [SALSA_GRATIS] } });
  assert.strictEqual(snap[0].origen, 'manual');
  assert.strictEqual(snap[0].consumoStock, 0);
});

console.log('\nConsumo de stock de opcionales (base Fase 2):');
check('16. Rocklets vinculado a artículo → consumo 1', () => {
  const mov = calcularConsumoStockOpcionales({ quantity: 1, selectedOptionals: { g1: [{ ...ROCKLETS, articleId: 'art-rock' }] } });
  assert.deepStrictEqual(mov, [{ articleId: 'art-rock', cantidad: 1 }]);
});
check('17. sin seleccionar → sin movimiento', () => {
  assert.deepStrictEqual(calcularConsumoStockOpcionales({ quantity: 1, selectedOptionals: {} }), []);
});
check('opcional manual no genera movimiento de stock', () => {
  assert.deepStrictEqual(calcularConsumoStockOpcionales({ quantity: 1, selectedOptionals: { g1: [SALSA_GRATIS] } }), []);
});
check('consumoStock configurable (no se deduce del nombre "x 5")', () => {
  const mov = calcularConsumoStockOpcionales({ quantity: 1, selectedOptionals: { g1: [{ nombre: 'Vasitos x 5', precio: 500, articleId: 'art-vas', consumoStock: 1 }] } });
  assert.deepStrictEqual(mov, [{ articleId: 'art-vas', cantidad: 1 }]);
});
check('mismo artículo en dos grupos → se agrega en un solo movimiento', () => {
  const mov = calcularConsumoStockOpcionales({
    quantity: 1,
    selectedOptionals: { g1: [{ nombre: 'R', articleId: 'art-rock' }], g2: [{ nombre: 'R', articleId: 'art-rock' }] },
  });
  assert.deepStrictEqual(mov, [{ articleId: 'art-rock', cantidad: 2 }]);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
