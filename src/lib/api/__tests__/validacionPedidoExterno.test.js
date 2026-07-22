// Fase 2 — punto 7: validación autoritativa de pedidos externos (DLV).
// Idéntico en Desktop y Tablet: mismo JSON debe dar exactamente el mismo resultado.
//
// Correr con: node src/lib/api/__tests__/validacionPedidoExterno.test.js
import assert from 'node:assert';
import {
  ESTADOS_VALIDACION, debeValidarse, validarPedidoExterno,
  describirParaOperador, aplicarDecisionOperador, puedePasarAEntregado,
} from '../validacionPedidoExterno.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// --- Catálogo oficial del local -------------------------------------------
const CATALOGO = {
  departamentos: { 'D-TOP': { nombre: 'TOPPING' }, 'D-HELADO': { nombre: 'HELADOS' } },
  articulos: {
    'A-0007': {
      nombre: '1 KILO DE HELADO', departamento: 'D-HELADO', valor: 14500,
      activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 50 },
      opcionalesConfig: {
        'G-SAB': { activo: true, obligatorio: true, min: 1, max: 4, opcionales: ['O-11', 'O-13'] },
        'G-TOP': {
          activo: true, obligatorio: false, min: 0, max: 3,
          origen: 'departamento', departamentoId: 'D-TOP',
          usarPrecioArticulo: true, controlarStock: true,
          consumoStockUnitarioDefault: 1, consumosPorArticulo: { 'A-VASITOS': 2 },
        },
      },
    },
    'A-ROCKLETS': { nombre: 'Rocklets', departamento: 'D-TOP', valor: 1700, costoUnitario: 400, controlStock: true, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 20 } },
    'A-VASITOS': { nombre: 'Vasitos', departamento: 'D-TOP', valor: 0, costoUnitario: 50, controlStock: true, activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 100 } },
    'A-OREO': { nombre: 'Oreo', departamento: 'D-TOP', valor: 900, activoDelivery: false, activoMostrador: true, stock: { propio: 5 } },
    'A-OTRO-DEPTO': { nombre: 'Cucurucho', departamento: 'D-HELADO', valor: 300, activoDelivery: true, stock: { propio: 5 } },
  },
  gruposOpcionales: { 'G-SAB': { nombre: 'SABORES' }, 'G-TOP': { nombre: 'TOPPING' } },
  opcionales: {
    'O-11': { nombre: 'Chocolate', grupo: 'G-SAB', precio: 0, activo: true },
    'O-13': { nombre: 'Frutilla', grupo: 'G-SAB', precio: 0, activo: true },
    'O-99': { nombre: 'Inactivo', grupo: 'G-SAB', precio: 0, activo: false },
  },
  materiaPrima: {},
};

const sabor = (id = 'O-11', nombre = 'Chocolate') => ({ id, nombre, precioUnitario: 0, precio: 0, cantidad: 1, quantity: 1, total: 0, origen: 'manual' });
const rocklets = (over = {}) => ({
  id: 'A-ROCKLETS', nombre: 'Rocklets', origen: 'departamento',
  articleId: 'A-ROCKLETS', departamentoId: 'D-TOP',
  precioUnitario: 1700, precio: 1700, cantidad: 1, quantity: 1, total: 1700,
  costoUnitarioAplicado: 400, costoTotal: 400,
  controlaStock: true, consumoStockUnitario: 1, consumoStockTotal: 1, ...over,
});

const pedido = (over = {}, opcionalesTop = [rocklets()]) => ({
  id: 1001, origen: 'DLV', status: { main: 'ACEPTADO' },
  items: [{
    id: 'A-0007', codigo: 'A-0007', nombre: '1 KILO DE HELADO',
    valor: 14500, precioBaseUnitario: 14500, quantity: 1, uniqueId: 'u1',
    unidadIndice: 1, unidadTotal: 1,
    selectedOptionals: { 'G-SAB': [sabor()], ...(opcionalesTop.length ? { 'G-TOP': opcionalesTop } : {}) },
    totalOpcionales: opcionalesTop.reduce((s, o) => s + (o.total || 0), 0),
    subtotalLinea: 14500 + opcionalesTop.reduce((s, o) => s + (o.total || 0), 0),
    opcionalesIncluidosEnValor: false,
  }],
  payment: { total: 14500 + opcionalesTop.reduce((s, o) => s + (o.total || 0), 0) },
  ...over,
});

const validar = (p, opts = {}) => validarPedidoExterno(p, CATALOGO, { canal: 'delivery', ...opts });

console.log('Alcance: solo pedidos NUEVOS externos');
check('un pedido de DLV nuevo se valida', () => assert.strictEqual(debeValidarse(pedido()), true));
check('un pedido LOCAL no se valida', () => {
  assert.strictEqual(debeValidarse({ ...pedido(), origen: undefined, direccionValidada: undefined }), false);
});
check('un pedido ENTREGADO no se revalida (es historia)', () => {
  assert.strictEqual(debeValidarse({ ...pedido(), status: { main: 'ENTREGADO' } }), false);
});
check('un pedido CANCELADO no se revalida', () => {
  assert.strictEqual(debeValidarse({ ...pedido(), status: { main: 'CANCELADO' } }), false);
});
check('un pedido ya resuelto por el operador no se revalida', () => {
  assert.strictEqual(debeValidarse({ ...pedido(), validacionExterna: { resuelto: true } }), false);
});
check('un pedido sin items no se valida', () => assert.strictEqual(debeValidarse({ ...pedido(), items: [] }), false));

console.log('\nPedido correcto:');
check('status valid, sin issues, total 16.200', () => {
  const r = validar(pedido());
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
  assert.strictEqual(r.issues.length, 0);
  assert.strictEqual(r.canonicalTotal, 16200);
  assert.strictEqual(r.receivedTotal, 16200);
});
check('el opcional gratuito de departamento también valida', () => {
  const vasitos = rocklets({ id: 'A-VASITOS', nombre: 'Vasitos', articleId: 'A-VASITOS', precioUnitario: 0, precio: 0, total: 0, costoUnitarioAplicado: 50, costoTotal: 50, consumoStockUnitario: 2, consumoStockTotal: 2 });
  const r = validar(pedido({}, [vasitos]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
  assert.strictEqual(r.canonicalTotal, 14500, 'no suma precio');
  assert.strictEqual(r.canonicalItems[0].selectedOptionals['G-TOP'][0].consumoStockTotal, 2, 'pero sí consume');
});

console.log('\nprice-mismatch:');
check('Rocklets enviado a 100 en vez de 1700', () => {
  const r = validar(pedido({}, [rocklets({ precioUnitario: 100, precio: 100, total: 100 })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.PRICE_MISMATCH);
  const i = r.issues.find((x) => x.articleId === 'A-ROCKLETS');
  assert.strictEqual(i.precioRecibido, 100);
  assert.strictEqual(i.precioOficial, 1700);
  assert.strictEqual(r.canonicalTotal, 16200, 'el canónico usa el precio oficial');
});
check('precio base manipulado también se detecta', () => {
  const p = pedido();
  p.items[0].precioBaseUnitario = 1;
  p.items[0].valor = 1;
  const r = validar(p);
  assert.strictEqual(r.status, ESTADOS_VALIDACION.PRICE_MISMATCH);
  assert.ok(r.issues.some((x) => x.precioOficial === 14500));
});
check('el total general se compara aparte', () => {
  const p = pedido();
  p.payment.total = 999;
  const r = validar(p);
  assert.strictEqual(r.status, ESTADOS_VALIDACION.PRICE_MISMATCH);
  assert.strictEqual(r.receivedTotal, 999);
  assert.strictEqual(r.canonicalTotal, 16200);
});

console.log('\ninvalid-option:');
check('producto inexistente', () => {
  const p = pedido();
  p.items[0].codigo = 'A-NO-EXISTE'; p.items[0].id = 'A-NO-EXISTE';
  assert.strictEqual(validar(p).status, ESTADOS_VALIDACION.INVALID_OPTION);
});
check('grupo no habilitado para ese producto', () => {
  const p = pedido();
  p.items[0].selectedOptionals['G-FANTASMA'] = [sabor()];
  assert.strictEqual(validar(p).status, ESTADOS_VALIDACION.INVALID_OPTION);
});
check('opción manual que no pertenece al grupo', () => {
  const p = pedido();
  p.items[0].selectedOptionals['G-SAB'] = [sabor('O-77', 'Intruso')];
  assert.strictEqual(validar(p).status, ESTADOS_VALIDACION.INVALID_OPTION);
});
check('mínimo obligatorio incumplido', () => {
  const p = pedido();
  p.items[0].selectedOptionals['G-SAB'] = [];
  const r = validar(p);
  assert.ok(r.issues.some((i) => /mínimo/i.test(i.motivo)));
});
check('máximo superado', () => {
  const r = validar(pedido({}, [rocklets(), rocklets({ cantidad: 3, quantity: 3, total: 5100 })]));
  assert.ok(r.issues.some((i) => /máximo/i.test(i.motivo)));
});
check('artículo de otro departamento', () => {
  const r = validar(pedido({}, [rocklets({ articleId: 'A-OTRO-DEPTO', nombre: 'Cucurucho' })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_OPTION);
  assert.ok(r.issues.some((i) => /no pertenece al departamento/i.test(i.motivo)));
});
check('departamentoId que no coincide con el del grupo', () => {
  const r = validar(pedido({}, [rocklets({ departamentoId: 'D-HELADO' })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_OPTION);
});
check('opcional de departamento SIN articleId', () => {
  const r = validar(pedido({}, [rocklets({ articleId: undefined })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_OPTION);
});
check('origen declarado que no coincide con el oficial', () => {
  const r = validar(pedido({}, [rocklets({ origen: 'manual' })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_OPTION);
  assert.ok(r.issues.some((i) => /origen/i.test(i.motivo)));
});
check('unidadIndice incoherente', () => {
  const p = pedido();
  p.items[0].unidadIndice = 5; p.items[0].unidadTotal = 2;
  assert.ok(validar(p).issues.some((i) => /unidad/i.test(i.motivo)));
});

console.log('\nunavailable:');
check('artículo no activo para delivery', () => {
  const r = validar(pedido({}, [rocklets({ articleId: 'A-OREO', nombre: 'Oreo', precioUnitario: 900, precio: 900, total: 900 })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.UNAVAILABLE);
});
check('sin disponibilidad según el motor actual', () => {
  const r = validar(pedido(), { estaDisponible: (id) => id !== 'A-ROCKLETS' });
  assert.strictEqual(r.status, ESTADOS_VALIDACION.UNAVAILABLE);
});
check('opción manual inactiva', () => {
  const p = pedido();
  p.items[0].selectedOptionals['G-SAB'] = [sabor('O-99', 'Inactivo')];
  const cat = { ...CATALOGO, articulos: { ...CATALOGO.articulos } };
  cat.articulos['A-0007'] = { ...cat.articulos['A-0007'], opcionalesConfig: { ...cat.articulos['A-0007'].opcionalesConfig, 'G-SAB': { ...cat.articulos['A-0007'].opcionalesConfig['G-SAB'], opcionales: ['O-11', 'O-13', 'O-99'] } } };
  assert.strictEqual(validarPedidoExterno(p, cat, { canal: 'delivery' }).status, ESTADOS_VALIDACION.UNAVAILABLE);
});

console.log('\ninvalid-consumption:');
check('consumo distinto al configurado', () => {
  const r = validar(pedido({}, [rocklets({ consumoStockUnitario: 5, consumoStockTotal: 5 })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_CONSUMPTION);
  const i = r.issues.find((x) => x.consumoOficial !== undefined);
  assert.strictEqual(i.consumoRecibido, 5);
  assert.strictEqual(i.consumoOficial, 1);
});
check('el override por artículo es el que manda', () => {
  const vas = rocklets({ articleId: 'A-VASITOS', nombre: 'Vasitos', precioUnitario: 0, precio: 0, total: 0, costoUnitarioAplicado: 50, costoTotal: 50, consumoStockUnitario: 1, consumoStockTotal: 1 });
  const r = validar(pedido({}, [vas]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_CONSUMPTION);
  assert.strictEqual(r.issues.find((x) => x.consumoOficial !== undefined).consumoOficial, 2);
});
check('controlaStock incoherente', () => {
  const r = validar(pedido({}, [rocklets({ controlaStock: false })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_CONSUMPTION);
});

console.log('\nPrioridad de estados:');
check('un problema de opción manda sobre uno de precio', () => {
  const r = validar(pedido({}, [rocklets({ articleId: 'A-OTRO-DEPTO', precioUnitario: 1, precio: 1, total: 1 })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.INVALID_OPTION);
});

console.log('\nExperiencia del operador:');
check('describe motivo, producto, unidad, opcional y los DOS importes', () => {
  const d = describirParaOperador(validar(pedido({}, [rocklets({ precioUnitario: 100, precio: 100, total: 100 })])));
  assert.strictEqual(d.requiereDecision, true);
  assert.ok(d.titulo.length > 0);
  assert.strictEqual(d.totalRecibido, 14600);
  assert.strictEqual(d.totalOficial, 16200);
  assert.ok(d.lineas.join(' ').includes('1 KILO DE HELADO'));
  assert.ok(d.lineas.join(' ').includes('recibido $100'));
  assert.ok(d.lineas.join(' ').includes('oficial $1700'));
  assert.deepStrictEqual(d.acciones, ['corregir-a-oficial', 'rechazar']);
});
check('NUNCA llama fraude a la diferencia', () => {
  const d = describirParaOperador(validar(pedido({}, [rocklets({ precioUnitario: 100, precio: 100, total: 100 })])));
  const texto = `${d.titulo} ${d.aclaracion} ${d.lineas.join(' ')}`.toLowerCase();
  assert.ok(!texto.includes('fraude'));
  assert.ok(d.aclaracion.includes('cambio de precio'), 'contempla el cambio legítimo');
});
check('un pedido válido no pide decisión', () => {
  assert.strictEqual(describirParaOperador(validar(pedido())).requiereDecision, false);
});

console.log('\nDecisión del operador y trazabilidad:');
check('corregir al oficial deja el total oficial y conserva el original', () => {
  const p = pedido({}, [rocklets({ precioUnitario: 100, precio: 100, total: 100 })]);
  const r = validar(p);
  const corregido = aplicarDecisionOperador(p, r, { decision: 'corregir-a-oficial', operador: 'diego' });
  assert.strictEqual(corregido.payment.total, 16200);
  assert.strictEqual(corregido.validacionExterna.decision, 'corregir-a-oficial');
  assert.strictEqual(corregido.validacionExterna.totalRecibido, 14600);
  assert.strictEqual(corregido.validacionExterna.totalOficial, 16200);
  assert.strictEqual(corregido.validacionExterna.itemsOriginales[0].selectedOptionals['G-TOP'][0].precioUnitario, 100, 'el snapshot original se conserva');
  assert.ok(corregido.validacionExterna.issues.length > 0, 'la diferencia no se oculta');
});
check('rechazar NO modifica los items', () => {
  const p = pedido({}, [rocklets({ precioUnitario: 100, precio: 100, total: 100 })]);
  const r = validar(p);
  const rechazado = aplicarDecisionOperador(p, r, { decision: 'rechazar' });
  assert.strictEqual(rechazado.items[0].selectedOptionals['G-TOP'][0].precioUnitario, 100);
  assert.strictEqual(rechazado.validacionExterna.decision, 'rechazar');
});
check('una decisión desconocida se rechaza', () => {
  assert.throws(() => aplicarDecisionOperador(pedido(), validar(pedido()), { decision: 'inventada' }), /decisión desconocida/);
});

console.log('\nGuarda de ENTREGADO:');
check('externo con validación PENDIENTE no puede pasar a ENTREGADO', () => {
  const r = puedePasarAEntregado(pedido());
  assert.strictEqual(r.permitido, false);
  assert.ok(/pendiente/i.test(r.motivo));
});
check('externo RECHAZADO no puede pasar a ENTREGADO', () => {
  const r = puedePasarAEntregado({ ...pedido(), validacionExterna: { resuelto: true, decision: 'rechazar' } });
  assert.strictEqual(r.permitido, false);
});
check('externo corregido SÍ puede pasar', () => {
  const r = puedePasarAEntregado({ ...pedido(), validacionExterna: { resuelto: true, decision: 'corregir-a-oficial' } });
  assert.strictEqual(r.permitido, true);
});
check('un pedido LOCAL pasa sin restricción', () => {
  assert.strictEqual(puedePasarAEntregado({ id: 5, items: [{}], status: { main: 'EN DELIVERY' } }).permitido, true);
});

console.log('\nHistóricos y compatibilidad:');
check('un opcional histórico sin articleId en grupo manual no rompe', () => {
  const p = pedido();
  p.items[0].selectedOptionals = { 'G-SAB': [{ id: 'O-11', nombre: 'Chocolate', origen: 'manual', cantidad: 1 }] };
  p.items[0].subtotalLinea = 14500;
  p.payment.total = 14500;
  const r = validar(p);
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
});
check('los canonicalItems traen el snapshot corregido completo', () => {
  const r = validar(pedido());
  const op = r.canonicalItems[0].selectedOptionals['G-TOP'][0];
  for (const campo of ['articleId', 'departamentoId', 'precioUnitario', 'cantidad', 'total',
    'costoUnitarioAplicado', 'costoTotal', 'controlaStock', 'consumoStockUnitario', 'consumoStockTotal']) {
    assert.ok(op[campo] !== undefined, `falta ${campo}`);
  }
  assert.strictEqual(op.costoUnitarioAplicado, 400);
  assert.strictEqual(r.canonicalItems[0].subtotalLinea, 16200);
});
check('entradas basura no rompen', () => {
  assert.doesNotThrow(() => validarPedidoExterno(null, CATALOGO));
  assert.doesNotThrow(() => validarPedidoExterno({ items: [null, 7] }, CATALOGO));
  assert.doesNotThrow(() => validarPedidoExterno(pedido(), {}));
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
