// Pruebas del cálculo centralizado de opcionales (Fase 1).
// Correr con: node src/lib/api/__tests__/optionalsPricing.test.js
import assert from 'node:assert';
import {
  normalizarImporte,
  obtenerPrecioOpcional,
  tienePrecio,
  precioOpcionalInvalido,
  detectarOpcionalesConPrecioInvalido,
  calcularTotalOpcionalesUnidad,
  calcularTotalOpcionales,
  calcularSubtotalLinea,
  calcularTotalPedido,
  construirSnapshotOpcionales,
  construirLineaPersistible,
  enriquecerOpcionalSnapshot,
  verificarTotalRecibido,
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

console.log('\nF1.4 — Snapshot persistible (recalculado al confirmar):');
check('construirLineaPersistible recalcula y agrega el desglose canónico', () => {
  const l = construirLineaPersistible({ ...KILO, quantity: 1, uniqueId: 'u1', unidadIndice: 1, unidadTotal: 2, selectedOptionals: { g1: [ROCKLETS] } });
  assert.strictEqual(l.precioBaseUnitario, 14500);
  assert.strictEqual(l.totalOpcionales, 1700);
  assert.strictEqual(l.subtotalLinea, 16200);
  assert.strictEqual(l.opcionalesIncluidosEnValor, false);
  assert.strictEqual(l.quantity, 1);
  assert.strictEqual(l.uniqueId, 'u1');           // se conserva para editar por unidad
  assert.strictEqual(l.unidadIndice, 1);
});
check('IGNORA subtotales temporales previos y recalcula desde las selecciones', () => {
  const l = construirLineaPersistible({
    ...KILO, quantity: 1,
    precioBaseUnitario: 999, totalOpcionales: 999, subtotalLinea: 999, // basura del modal
    selectedOptionals: { g1: [ROCKLETS] },
  });
  assert.strictEqual(l.subtotalLinea, 16200);
});
check('opcional persistido trae los campos canónicos + alias históricos', () => {
  const op = enriquecerOpcionalSnapshot({ ...ROCKLETS, id: 'op-rock', groupName: 'TOPPING', articleId: 'art-rock', departamentoId: 'dep-top' }, 'g1');
  assert.strictEqual(op.precioUnitario, 1700);
  assert.strictEqual(op.cantidad, 1);
  assert.strictEqual(op.total, 1700);
  assert.strictEqual(op.grupoId, 'g1');
  assert.strictEqual(op.grupoNombre, 'TOPPING');
  assert.strictEqual(op.origen, 'departamento');
  assert.strictEqual(op.consumoStockUnitario, 1);
  assert.strictEqual(op.precio, 1700);            // alias histórico conservado
  assert.strictEqual(op.id, 'op-rock');
});
check('estructura por unidad: dos líneas con snapshots independientes', () => {
  const u1 = construirLineaPersistible({ ...KILO, quantity: 1, uniqueId: 'a', unidadIndice: 1, unidadTotal: 2, selectedOptionals: { g1: [ROCKLETS] } });
  const u2 = construirLineaPersistible({ ...KILO, quantity: 1, uniqueId: 'b', unidadIndice: 2, unidadTotal: 2, selectedOptionals: {} });
  assert.strictEqual(u1.subtotalLinea, 16200);
  assert.strictEqual(u2.subtotalLinea, 14500);
  assert.strictEqual(calcularTotalPedido([u1, u2]).total, 30700);
  assert.ok(u2.selectedOptionals === undefined || Object.keys(u2.selectedOptionals).length === 0);
});

console.log('\nF1.4 — Bloqueo por precio inválido (condición 6):');
check('detecta el producto y el opcional con precio roto', () => {
  const malos = detectarOpcionalesConPrecioInvalido([
    { nombre: '1 KILO', valor: 14500, selectedOptionals: { g1: [{ nombre: 'Roto', precio: 'abc' }] } },
  ]);
  assert.strictEqual(malos.length, 1);
  assert.strictEqual(malos[0].articulo, '1 KILO');
  assert.strictEqual(malos[0].opcional, 'Roto');
});
check('NO bloquea opcionales gratuitos ni precio 0', () => {
  assert.strictEqual(detectarOpcionalesConPrecioInvalido([{ nombre: 'K', valor: 1, selectedOptionals: { g1: [SALSA_GRATIS, { nombre: 'Sin precio' }] } }]).length, 0);
  assert.strictEqual(precioOpcionalInvalido(SALSA_GRATIS), false);
});

console.log('\nF1.4 — No confiar en el total de DLV (condición 3):');
check('snapshot completo + total distinto → manda el canónico y avisa', () => {
  const items = [construirLineaPersistible({ ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } })];
  const warns = [];
  const r = verificarTotalRecibido(items, 14500, { onWarn: (w) => warns.push(w) }); // DLV mandó mal
  assert.strictEqual(r.total, 16200);
  assert.strictEqual(r.fuente, 'canonico');
  assert.strictEqual(r.difiere, true);
  assert.ok(warns.length >= 1);
});
check('histórico incompleto → se respeta el total guardado (no se modifica)', () => {
  const historicos = [{ nombre: 'Viejo', valor: 14500, quantity: 1, selectedOptionals: { g1: [{ nombre: 'Rocklets' }] } }];
  const r = verificarTotalRecibido(historicos, 14500);
  assert.strictEqual(r.total, 14500);
  assert.strictEqual(r.snapshotCompleto, false);
});
check('total coincidente → no hay warning ni cambio', () => {
  const items = [construirLineaPersistible({ ...KILO, quantity: 1, selectedOptionals: { g1: [ROCKLETS] } })];
  const r = verificarTotalRecibido(items, 16200);
  assert.strictEqual(r.difiere, false);
  assert.strictEqual(r.total, 16200);
});

console.log('\nF1.4 — Prueba de RECARGA ida y vuelta (condición 14):');
check('$14.500 + Rocklets: 16.200 → guardar → recargar → editar sin cambios → 16.200', () => {
  // 1) construir pedido
  const carrito = [{ ...KILO, quantity: 1, uniqueId: 'u1', selectedOptionals: { g1: [ROCKLETS] } }];
  const antesDeGuardar = calcularTotalPedido(carrito).total;
  assert.strictEqual(antesDeGuardar, 16200);

  // 2) serializar EXACTAMENTE como se persiste en Firebase
  const persistido = carrito.map((i) => construirLineaPersistible(i));
  const json = JSON.parse(JSON.stringify(persistido));

  // 3) releer y recalcular
  const despuesDeRecargar = calcularTotalPedido(json).total;
  assert.strictEqual(despuesDeRecargar, 16200);

  // 4) editar sin cambios: volver a persistir lo leído no duplica
  const reGuardado = json.map((i) => construirLineaPersistible(i));
  assert.strictEqual(calcularTotalPedido(reGuardado).total, 16200);
  assert.strictEqual(reGuardado[0].totalOpcionales, 1700);
});
check('recarga de 2 unidades conserva $30.700 y cada snapshot por separado', () => {
  const carrito = [
    { ...KILO, quantity: 1, uniqueId: 'a', unidadIndice: 1, unidadTotal: 2, selectedOptionals: { g1: [ROCKLETS] } },
    { ...KILO, quantity: 1, uniqueId: 'b', unidadIndice: 2, unidadTotal: 2, selectedOptionals: {} },
  ];
  const json = JSON.parse(JSON.stringify(carrito.map((i) => construirLineaPersistible(i))));
  assert.strictEqual(calcularTotalPedido(json).total, 30700);
  assert.strictEqual(json[0].subtotalLinea, 16200);
  assert.strictEqual(json[1].subtotalLinea, 14500);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
