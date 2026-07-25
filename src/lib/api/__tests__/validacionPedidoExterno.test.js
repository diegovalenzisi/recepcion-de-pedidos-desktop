// Validación autoritativa de pedidos externos (DLV) — grupos MANUALES.
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

// --- Catálogo oficial del local (solo grupos manuales) --------------------
const CATALOGO = {
  articulos: {
    'A-0007': {
      nombre: '1 KILO DE HELADO', valor: 14500,
      activoDelivery: true, activoMostrador: true, stock: { stockType: 'propio', propio: 50 },
      opcionalesConfig: {
        'G-SAB': { activo: true, obligatorio: true, min: 1, max: 4, opcionales: ['O-11', 'O-13'] },
        'G-TOP': { activo: true, obligatorio: false, min: 0, max: 3, opcionales: ['O-21', 'O-22'] },
      },
    },
  },
  gruposOpcionales: { 'G-SAB': { nombre: 'SABORES' }, 'G-TOP': { nombre: 'TOPPINGS' } },
  opcionales: {
    'O-11': { nombre: 'Chocolate', grupo: 'G-SAB', precio: 0, activo: true },
    'O-13': { nombre: 'Frutilla', grupo: 'G-SAB', precio: 0, activo: true },
    'O-21': { nombre: 'Rocklets', grupo: 'G-TOP', precio: 1700, activo: true },
    'O-22': { nombre: 'Granas', grupo: 'G-TOP', precio: 0, activo: true },
    'O-99': { nombre: 'Inactivo', grupo: 'G-SAB', precio: 0, activo: false },
  },
};

const sabor = (id = 'O-11', nombre = 'Chocolate') => ({ id, nombre, precioUnitario: 0, precio: 0, cantidad: 1, quantity: 1, total: 0 });
const topping = (over = {}) => ({
  id: 'O-21', nombre: 'Rocklets',
  precioUnitario: 1700, precio: 1700, cantidad: 1, quantity: 1, total: 1700, ...over,
});

const pedido = (over = {}, opcionalesTop = [topping()]) => ({
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
check('un opcional gratuito también valida y no suma', () => {
  const granas = topping({ id: 'O-22', nombre: 'Granas', precioUnitario: 0, precio: 0, total: 0 });
  const r = validar(pedido({}, [granas]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
  assert.strictEqual(r.canonicalTotal, 14500, 'no suma precio');
});

console.log('\nprice-mismatch:');
check('Rocklets enviado a 100 en vez de 1700', () => {
  const r = validar(pedido({}, [topping({ precioUnitario: 100, precio: 100, total: 100 })]));
  assert.strictEqual(r.status, ESTADOS_VALIDACION.PRICE_MISMATCH);
  const i = r.issues.find((x) => x.optionId === 'O-21');
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
check('opción que no pertenece al grupo', () => {
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
  const r = validar(pedido({}, [topping({ cantidad: 4, quantity: 4, total: 6800 })]));
  assert.ok(r.issues.some((i) => /máximo/i.test(i.motivo)));
});
check('unidadIndice incoherente', () => {
  const p = pedido();
  p.items[0].unidadIndice = 5; p.items[0].unidadTotal = 2;
  assert.ok(validar(p).issues.some((i) => /unidad/i.test(i.motivo)));
});

console.log('\nunavailable:');
check('opción inactiva', () => {
  const p = pedido();
  p.items[0].selectedOptionals['G-SAB'] = [sabor('O-99', 'Inactivo')];
  const cat = { ...CATALOGO, articulos: { ...CATALOGO.articulos } };
  cat.articulos['A-0007'] = { ...cat.articulos['A-0007'], opcionalesConfig: { ...cat.articulos['A-0007'].opcionalesConfig, 'G-SAB': { ...cat.articulos['A-0007'].opcionalesConfig['G-SAB'], opcionales: ['O-11', 'O-13', 'O-99'] } } };
  assert.strictEqual(validarPedidoExterno(p, cat, { canal: 'delivery' }).status, ESTADOS_VALIDACION.UNAVAILABLE);
});

console.log('\nPrioridad de estados:');
check('un problema de opción manda sobre uno de precio', () => {
  const p = pedido();
  p.items[0].selectedOptionals['G-SAB'] = [sabor('O-77', 'Intruso')];
  p.items[0].selectedOptionals['G-TOP'] = [topping({ precioUnitario: 1, precio: 1, total: 1 })];
  assert.strictEqual(validar(p).status, ESTADOS_VALIDACION.INVALID_OPTION);
});

console.log('\nExperiencia del operador:');
check('describe motivo, producto, unidad, opcional y los DOS importes', () => {
  const d = describirParaOperador(validar(pedido({}, [topping({ precioUnitario: 100, precio: 100, total: 100 })])));
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
  const d = describirParaOperador(validar(pedido({}, [topping({ precioUnitario: 100, precio: 100, total: 100 })])));
  const texto = `${d.titulo} ${d.aclaracion} ${d.lineas.join(' ')}`.toLowerCase();
  assert.ok(!texto.includes('fraude'));
  assert.ok(d.aclaracion.includes('cambio de precio'), 'contempla el cambio legítimo');
});
check('un pedido válido no pide decisión', () => {
  assert.strictEqual(describirParaOperador(validar(pedido())).requiereDecision, false);
});

console.log('\nDecisión del operador y trazabilidad:');
check('corregir al oficial deja el total oficial y conserva el original', () => {
  const p = pedido({}, [topping({ precioUnitario: 100, precio: 100, total: 100 })]);
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
  const p = pedido({}, [topping({ precioUnitario: 100, precio: 100, total: 100 })]);
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
check('un opcional histórico sin campos extra en grupo manual no rompe', () => {
  const p = pedido();
  p.items[0].selectedOptionals = { 'G-SAB': [{ id: 'O-11', nombre: 'Chocolate', cantidad: 1 }] };
  p.items[0].subtotalLinea = 14500;
  p.payment.total = 14500;
  const r = validar(p);
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
});
check('los canonicalItems traen el snapshot recalculado con el precio oficial', () => {
  const r = validar(pedido());
  const op = r.canonicalItems[0].selectedOptionals['G-TOP'][0];
  for (const campo of ['id', 'nombre', 'precioUnitario', 'cantidad', 'total']) {
    assert.ok(op[campo] !== undefined, `falta ${campo}`);
  }
  assert.strictEqual(op.precioUnitario, 1700);
  assert.strictEqual(r.canonicalItems[0].subtotalLinea, 16200);
});
check('entradas basura no rompen', () => {
  assert.doesNotThrow(() => validarPedidoExterno(null, CATALOGO));
  assert.doesNotThrow(() => validarPedidoExterno({ items: [null, 7] }, CATALOGO));
  assert.doesNotThrow(() => validarPedidoExterno(pedido(), {}));
});

console.log('\nStock de receta al recibir:');
const CATALOGO_RECETA = {
  articulos: {
    'A-CHIPA': {
      nombre: 'Chipa rellena', valor: 500, activoDelivery: true, activoMostrador: true,
      stock: { stockType: 'receta', receta: { 'M-CHIPAS': 1, 'M-QUESO': 0.05 } },
    },
  },
  gruposOpcionales: {},
  opcionales: {},
  materiaPrima: { 'M-CHIPAS': { nombre: 'CHIPAS', stock: 10 }, 'M-QUESO': { nombre: 'QUESO', stock: 2 } },
};
const pedidoReceta = (over = {}) => ({
  id: 2002, origen: 'DLV', status: { main: 'ACEPTADO' },
  items: [{ id: 'A-CHIPA', codigo: 'A-CHIPA', nombre: 'Chipa rellena', valor: 500, precioBaseUnitario: 500, quantity: 1, uniqueId: 'r1', unidadIndice: 1, unidadTotal: 1, subtotalLinea: 500 }],
  payment: { total: 500 }, ...over,
});
check('materia prima con stock → VALID', () => {
  const r = validarPedidoExterno(pedidoReceta(), CATALOGO_RECETA, { canal: 'delivery' });
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
});
check('materia prima agotada al recibir → UNAVAILABLE con detalle técnico', () => {
  const cat = { ...CATALOGO_RECETA, materiaPrima: { ...CATALOGO_RECETA.materiaPrima, 'M-CHIPAS': { nombre: 'CHIPAS', stock: 0 } } };
  const r = validarPedidoExterno(pedidoReceta(), cat, { canal: 'delivery' });
  assert.strictEqual(r.status, ESTADOS_VALIDACION.UNAVAILABLE);
  const i = r.issues.find((x) => x.estado === ESTADOS_VALIDACION.UNAVAILABLE);
  assert.ok(i.faltantesStock.some((f) => f.materiaPrimaId === 'M-CHIPAS' && f.stockActual === 0 && f.requerido === 1));
});
check('pedido por 5 unidades: stock alcanza para 1 → UNAVAILABLE', () => {
  const cat = { ...CATALOGO_RECETA, materiaPrima: { ...CATALOGO_RECETA.materiaPrima, 'M-CHIPAS': { nombre: 'CHIPAS', stock: 1 } } };
  const p = pedidoReceta(); p.items[0].quantity = 5; p.items[0].subtotalLinea = 2500; p.payment.total = 2500;
  const r = validarPedidoExterno(p, cat, { canal: 'delivery' });
  assert.strictEqual(r.status, ESTADOS_VALIDACION.UNAVAILABLE);
});
check('artículo sin receta no se bloquea por materias primas', () => {
  const r = validarPedidoExterno(pedido(), { ...CATALOGO, materiaPrima: {} }, { canal: 'delivery' });
  assert.strictEqual(r.status, ESTADOS_VALIDACION.VALID, JSON.stringify(r.issues));
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
