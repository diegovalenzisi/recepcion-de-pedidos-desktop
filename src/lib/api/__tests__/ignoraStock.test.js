// "IGNORA STOCK" (MATERIA_PRIMA/{id}/ignoraStock)
//
// Una materia prima marcada con `ignoraStock: true` deja de considerarse
// agotada: ni ella ni los artículos que la usan se apagan por falta de stock, y
// ninguna capa de disponibilidad la reporta como faltante. El stock se sigue
// descontando y puede quedar negativo. Campo AUSENTE = false. "Ignora Stock"
// SOLO ignora el stock: nunca una desactivación manual (`activo === false`).
//
// Este archivo es la regla ÚNICA compartida: corre idéntico en Desktop, Tablet
// y DLV Pedidos (está en el NÚCLEO de paridadCanonica.test.js).
//
// Correr con: node src/lib/api/__tests__/ignoraStock.test.js
import assert from 'node:assert';
import {
  tieneIgnoraStock,
  materiaPrimaIgnoraStock,
  materiaPrimaDisponible,
  aplicarReglaMateriaPrima,
  aplicarReglaMateriaPrimaANodo,
  resolverToggleManualMateriaPrima,
  reconciliarArticuloDeliveryANodo,
} from '../deliveryPorStock.js';
import {
  evaluarRecetaPedido,
  recetaConStockSuficiente,
  unidadesFabricables,
  disponibleParaDelivery,
  materiasPrimasDeArticulo,
} from '../disponibilidadReceta.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Simulación de la reconciliación real (stockDeliveryAutomation), con las mismas
// funciones puras: materias primas de la receta que HOY bloquean → patch del
// artículo. Sin Firebase: exactamente la misma decisión.
// ---------------------------------------------------------------------------
const bloqueantesDe = (artId, articulos, materiaPrima) =>
  [...materiasPrimasDeArticulo(artId, articulos, materiaPrima)]
    .filter((mpId) => !materiaPrimaDisponible(materiaPrima[mpId]));

const reconciliarArticulo = (artId, articulos, materiaPrima) =>
  reconciliarArticuloDeliveryANodo(articulos[artId], bloqueantesDe(artId, articulos, materiaPrima));

/** Aplica la regla de MP a todo el catálogo (equivale a la reconciliación inicial). */
const reconciliarTodo = (materiaPrima) => {
  const salida = {};
  for (const [id, nodo] of Object.entries(materiaPrima)) {
    salida[id] = aplicarReglaMateriaPrimaANodo(nodo).nodo;
  }
  return salida;
};

/** Catálogo estilo Achaval: 156A..159A usan 11M (chipa); 157A además usa 25M (queso). */
const catalogoAchaval = (mp11, mp25 = { nombre: 'Queso', stock: 20, activo: true }) => ({
  articulos: {
    '156A': { nombre: 'Chipa x6', activo: true, activoDelivery: true, stock: { stockType: 'receta', receta: { '11M': 6 } } },
    '157A': { nombre: 'Chipa rellena', activo: true, activoDelivery: true, stock: { stockType: 'receta', receta: { '11M': 4, '25M': 1 } } },
    '158A': { nombre: 'Chipa x12', activo: true, activoDelivery: true, stock: { stockType: 'receta', receta: { '11M': 12 } } },
    '159A': { nombre: 'Chipa x1', activo: true, activoDelivery: true, stock: { stockType: 'receta', receta: { '11M': 1 } } },
  },
  materiaPrima: { '11M': mp11, '25M': mp25 },
});

// ---------------------------------------------------------------------------
console.log('Lectura del campo (ausente = false):');
// ---------------------------------------------------------------------------
check('ausente, null, false y "true" (string) NO activan la opción', () => {
  assert.strictEqual(tieneIgnoraStock({ stock: 5 }), false);
  assert.strictEqual(tieneIgnoraStock({ stock: 5, ignoraStock: null }), false);
  assert.strictEqual(tieneIgnoraStock({ stock: 5, ignoraStock: false }), false);
  assert.strictEqual(tieneIgnoraStock({ stock: 5, ignoraStock: 'true' }), false);
  assert.strictEqual(tieneIgnoraStock({ stock: 5, ignoraStock: 1 }), false);
  assert.strictEqual(tieneIgnoraStock(null), false);
  assert.strictEqual(tieneIgnoraStock({ stock: 5, ignoraStock: true }), true);
});
check('la regla efectiva exige además que NO esté desactivada a mano', () => {
  assert.strictEqual(materiaPrimaIgnoraStock({ ignoraStock: true, stock: -10 }), true);
  assert.strictEqual(materiaPrimaIgnoraStock({ ignoraStock: true, stock: -10, activo: true }), true);
  assert.strictEqual(materiaPrimaIgnoraStock({ ignoraStock: true, stock: -10, activo: false }), false);
});

// ---------------------------------------------------------------------------
console.log('\nDisponibilidad de la materia prima:');
// ---------------------------------------------------------------------------
check('sin el campo: se comporta EXACTAMENTE como hasta ahora', () => {
  assert.strictEqual(materiaPrimaDisponible({ stock: 5, activo: true }), true);
  assert.strictEqual(materiaPrimaDisponible({ stock: 0, activo: true }), false);
  assert.strictEqual(materiaPrimaDisponible({ stock: -3, activo: true }), false);
});
check('ignoraStock:false con stock 0 → sigue no disponible', () => {
  assert.strictEqual(materiaPrimaDisponible({ stock: 0, activo: true, ignoraStock: false }), false);
});
check('ignoraStock:true con stock positivo → disponible (sin cambios)', () => {
  assert.strictEqual(materiaPrimaDisponible({ stock: 8, activo: true, ignoraStock: true }), true);
});
check('ignoraStock:true con stock 0 o negativo → disponible', () => {
  assert.strictEqual(materiaPrimaDisponible({ stock: 0, activo: true, ignoraStock: true }), true);
  assert.strictEqual(materiaPrimaDisponible({ stock: -20, activo: true, ignoraStock: true }), true);
});
check('ignoraStock:true pero desactivada a mano → NO disponible', () => {
  assert.strictEqual(materiaPrimaDisponible({ stock: 50, activo: false, ignoraStock: true }), false);
  assert.strictEqual(materiaPrimaDisponible({ stock: -20, activo: false, ignoraStock: true }), false);
});

// ---------------------------------------------------------------------------
console.log('\nApagado automático de la materia prima:');
// ---------------------------------------------------------------------------
check('ignoraStock:false y stock 0 → apaga y recuerda (comportamiento actual)', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: 0, activo: true, ignoraStock: false });
  assert.strictEqual(patch.activo, false);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, true);
  assert.strictEqual(patch.activoAntesDeAgotarse, true);
});
check('ignoraStock:true y stock 0 → NO la apaga', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: 0, activo: true, ignoraStock: true });
  assert.strictEqual(patch.activo, undefined);
  assert.strictEqual(Object.keys(patch).length, 0);
});
check('ignoraStock:true y stock negativo → sigue activa', () => {
  const r = aplicarReglaMateriaPrimaANodo({ stock: -20, activo: true, ignoraStock: true });
  assert.strictEqual(r.nodo.activo, true);
  assert.strictEqual(r.nodo.stock, -20, 'el valor negativo se conserva tal cual, para poder reponer');
  assert.strictEqual(r.cambio, false);
});
check('ignoraStock:true sobre una materia prima inactiva a mano → NO la activa', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: -20, activo: false, ignoraStock: true });
  assert.strictEqual(patch.activo, undefined);
});
check('idempotente: la segunda pasada no cambia nada', () => {
  const r1 = aplicarReglaMateriaPrimaANodo({ stock: -5, activo: true, ignoraStock: true });
  assert.strictEqual(aplicarReglaMateriaPrimaANodo(r1.nodo).cambio, false);
  assert.strictEqual(aplicarReglaMateriaPrimaANodo(r1.nodo).nodo.activo, true);
});
check('reconciliación inicial: ignora las materias primas con ignoraStock', () => {
  const mp = reconciliarTodo({
    '11M': { stock: -20, activo: true, ignoraStock: true },
    '25M': { stock: 0, activo: true },
    '30M': { stock: 7, activo: true },
  });
  assert.strictEqual(mp['11M'].activo, true);
  assert.strictEqual(mp['25M'].activo, false);
  assert.strictEqual(mp['30M'].activo, true);
});

// ---------------------------------------------------------------------------
console.log('\nEncender "Ignora Stock" con la materia prima ya agotada:');
// ---------------------------------------------------------------------------
check('estaba apagada AUTOMÁTICAMENTE y antes activa → la restaura y limpia marcadores', () => {
  const apagadaAuto = { stock: -20, activo: false, apagadoAutomaticoPorStock: true, activoAntesDeAgotarse: true };
  const { patch } = aplicarReglaMateriaPrima({ ...apagadaAuto, ignoraStock: true });
  assert.strictEqual(patch.activo, true);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, null);
  assert.strictEqual(patch.activoAntesDeAgotarse, null);
});
check('estaba apagada A MANO (sin marcadores) → NO la activa', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: -20, activo: false, ignoraStock: true });
  assert.strictEqual(patch.activo, undefined);
  assert.strictEqual(Object.keys(patch).length, 0);
});
check('encenderla a mano con stock negativo ahora sí la activa', () => {
  const { patch } = resolverToggleManualMateriaPrima({ stock: -20, activo: false, ignoraStock: true }, true);
  assert.strictEqual(patch.activo, true);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, null);
  assert.strictEqual(patch.activoAntesDeAgotarse, null);
});
check('apagarla a mano con ignoraStock la deja apagada (y no se autorestaura)', () => {
  const { patch } = resolverToggleManualMateriaPrima({ stock: -20, activo: true, ignoraStock: true }, false);
  assert.strictEqual(patch.activo, false);
  const r = aplicarReglaMateriaPrimaANodo({ stock: -20, activo: false, ignoraStock: true });
  assert.strictEqual(r.nodo.activo, false);
});

// ---------------------------------------------------------------------------
console.log('\nApagar "Ignora Stock" con el stock agotado:');
// ---------------------------------------------------------------------------
check('aplica el bloqueo en el acto: activo=false + estado previo guardado', () => {
  const { patch } = aplicarReglaMateriaPrima({ stock: -20, activo: true, ignoraStock: false });
  assert.strictEqual(patch.activo, false);
  assert.strictEqual(patch.apagadoAutomaticoPorStock, true);
  assert.strictEqual(patch.activoAntesDeAgotarse, true);
});
check('y los artículos que la usan quedan bloqueados en la misma reconciliación', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: -20, activo: true, ignoraStock: false });
  materiaPrima['11M'] = aplicarReglaMateriaPrimaANodo(materiaPrima['11M']).nodo;
  const r = reconciliarArticulo('156A', articulos, materiaPrima);
  assert.strictEqual(r.nodo.activoDelivery, false);
  assert.strictEqual(r.nodo.activoDeliveryAntesDeFaltaMateriaPrima, true);
  assert.deepStrictEqual(r.nodo.materiasPrimasBloqueantes, { '11M': true });
});

// ---------------------------------------------------------------------------
console.log('\nArtículos: cascada de activoDelivery:');
// ---------------------------------------------------------------------------
check('ignoraStock:false y stock 0 → apaga la MP y el delivery de sus artículos', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: 0, activo: true });
  materiaPrima['11M'] = aplicarReglaMateriaPrimaANodo(materiaPrima['11M']).nodo;
  assert.strictEqual(materiaPrima['11M'].activo, false);
  for (const id of ['156A', '157A', '158A', '159A']) {
    assert.strictEqual(reconciliarArticulo(id, articulos, materiaPrima).nodo.activoDelivery, false, id);
  }
});
check('ignoraStock:true y stock 0 → artículos siguen activos para delivery', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: 0, activo: true, ignoraStock: true });
  for (const id of ['156A', '157A', '158A', '159A']) {
    const r = reconciliarArticulo(id, articulos, materiaPrima);
    assert.strictEqual(r.cambio, false, `${id} no debería tocarse`);
    assert.strictEqual(r.nodo.activoDelivery, true, id);
    assert.ok(!('materiasPrimasBloqueantes' in r.nodo), `${id} no debe tener bloqueantes`);
  }
});
check('NUNCA se toca ARTICULOS/{id}/activo', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: 0, activo: true });
  materiaPrima['11M'] = aplicarReglaMateriaPrimaANodo(materiaPrima['11M']).nodo;
  const { patch } = reconciliarArticulo('156A', articulos, materiaPrima);
  assert.strictEqual('activo' in patch, false);
});
check('encender ignoraStock quita el bloqueo y restaura solo lo que corresponde', () => {
  // Estado de partida: 11M agotada y apagada automáticamente; 156A apagado por
  // la automatización (restaurable), 158A apagado A MANO durante el bloqueo
  // (canceló su restauración) y 159A desactivado por el usuario (activo=false).
  const { articulos, materiaPrima } = catalogoAchaval({
    stock: -20, activo: false, apagadoAutomaticoPorStock: true, activoAntesDeAgotarse: true,
  });
  articulos['156A'] = {
    ...articulos['156A'], activoDelivery: false,
    apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true,
    materiasPrimasBloqueantes: { '11M': true },
  };
  articulos['158A'] = {
    ...articulos['158A'], activoDelivery: false,
    apagadoDeliveryAutomaticoPorMateriaPrima: true,
    materiasPrimasBloqueantes: { '11M': true },
  };
  articulos['159A'] = {
    ...articulos['159A'], activo: false, activoDelivery: false,
    apagadoDeliveryAutomaticoPorMateriaPrima: true, activoDeliveryAntesDeFaltaMateriaPrima: true,
    materiasPrimasBloqueantes: { '11M': true },
  };

  // El usuario enciende "Ignora Stock" y se guarda: misma reconciliación.
  materiaPrima['11M'] = aplicarReglaMateriaPrimaANodo({ ...materiaPrima['11M'], ignoraStock: true }).nodo;
  assert.strictEqual(materiaPrima['11M'].activo, true, 'la MP se restaura');
  assert.ok(!('apagadoAutomaticoPorStock' in materiaPrima['11M']), 'se borran sus marcadores automáticos');
  assert.ok(!('activoAntesDeAgotarse' in materiaPrima['11M']));

  const r156 = reconciliarArticulo('156A', articulos, materiaPrima);
  assert.strictEqual(r156.nodo.activoDelivery, true, '156A vuelve porque estaba habilitado antes');
  assert.ok(!('materiasPrimasBloqueantes' in r156.nodo), '11M sale del mapa de bloqueantes');

  const r158 = reconciliarArticulo('158A', articulos, materiaPrima);
  assert.strictEqual(r158.nodo.activoDelivery, false, '158A lo apagó el usuario: no se restaura');
  assert.ok(!('materiasPrimasBloqueantes' in r158.nodo));

  const r159 = reconciliarArticulo('159A', articulos, materiaPrima);
  assert.strictEqual(r159.nodo.activo, false, 'su propio activo no se toca');
  assert.strictEqual(disponibleParaDelivery('159A', { '159A': r159.nodo }, materiaPrima), false);
});
check('encender ignoraStock sobre una MP inactiva a mano no desbloquea los artículos', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: -20, activo: false, ignoraStock: true });
  const r = reconciliarArticulo('156A', articulos, materiaPrima);
  assert.strictEqual(r.nodo.activoDelivery, false);
  assert.deepStrictEqual(r.nodo.materiasPrimasBloqueantes, { '11M': true });
});

// ---------------------------------------------------------------------------
console.log('\nVarias materias primas en una receta:');
// ---------------------------------------------------------------------------
check('una ignora y la otra no: solo bloquea la que NO ignora', () => {
  const { articulos, materiaPrima } = catalogoAchaval(
    { nombre: 'CHIPAS', stock: -10, activo: true, ignoraStock: true },
    { nombre: 'QUESO', stock: 0, activo: true, ignoraStock: false },
  );
  materiaPrima['25M'] = aplicarReglaMateriaPrimaANodo(materiaPrima['25M']).nodo;
  const r = reconciliarArticulo('157A', articulos, materiaPrima);
  assert.strictEqual(r.nodo.activoDelivery, false);
  assert.deepStrictEqual(r.nodo.materiasPrimasBloqueantes, { '25M': true });
  // 156A solo usa 11M: no se bloquea.
  assert.strictEqual(reconciliarArticulo('156A', articulos, materiaPrima).nodo.activoDelivery, true);
});
check('si TODAS las faltantes ignoran stock, el artículo no se bloquea', () => {
  const { articulos, materiaPrima } = catalogoAchaval(
    { stock: -10, activo: true, ignoraStock: true },
    { stock: -4, activo: true, ignoraStock: true },
  );
  const r = reconciliarArticulo('157A', articulos, materiaPrima);
  assert.strictEqual(r.nodo.activoDelivery, true);
  assert.strictEqual(r.cambio, false);
});

// ---------------------------------------------------------------------------
console.log('\nDisponibilidad por receta (catálogo, detalle, carrito, validación):');
// ---------------------------------------------------------------------------
check('sin el campo: sigue faltando lo que faltaba', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: 2, activo: true });
  const r = evaluarRecetaPedido('156A', 1, articulos, materiaPrima);
  assert.strictEqual(r.suficiente, false);
  assert.deepStrictEqual(r.faltantes, [{ materiaPrimaId: '11M', stockActual: 2, requerido: 6 }]);
});
check('ignoraStock:true → nunca figura como faltante (stock 0 y negativo)', () => {
  for (const stock of [0, -20]) {
    const { articulos, materiaPrima } = catalogoAchaval({ stock, activo: true, ignoraStock: true });
    const r = evaluarRecetaPedido('156A', 1, articulos, materiaPrima);
    assert.strictEqual(r.suficiente, true, `stock ${stock}`);
    assert.strictEqual(r.faltantes.length, 0);
    assert.ok(r.avisos.some((a) => a.tipo === 'ignora-stock' && a.id === '11M'));
  }
});
check('pedido de varias unidades: tampoco lo rechaza', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: 2, activo: true, ignoraStock: true });
  assert.strictEqual(evaluarRecetaPedido('156A', 10, articulos, materiaPrima).suficiente, true);
  assert.strictEqual(recetaConStockSuficiente('156A', articulos, materiaPrima, 10), true);
});
check('con dos materias primas, la que NO ignora sigue rechazando', () => {
  const { articulos, materiaPrima } = catalogoAchaval(
    { stock: -10, activo: true, ignoraStock: true },
    { stock: 0, activo: true },
  );
  const r = evaluarRecetaPedido('157A', 1, articulos, materiaPrima);
  assert.strictEqual(r.suficiente, false);
  assert.deepStrictEqual(r.faltantes.map((f) => f.materiaPrimaId), ['25M']);
});
check('desactivada a mano: vuelve a evaluarse por stock, como antes', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: -10, activo: false, ignoraStock: true });
  assert.strictEqual(evaluarRecetaPedido('156A', 1, articulos, materiaPrima).suficiente, false);
});
check('unidadesFabricables: la MP que ignora stock no limita', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: -10, activo: true, ignoraStock: true });
  assert.strictEqual(unidadesFabricables('156A', articulos, materiaPrima), Infinity);
  // Con otra MP finita en la receta, esa sí manda.
  materiaPrima['25M'] = { stock: 3, activo: true };
  assert.strictEqual(unidadesFabricables('157A', articulos, materiaPrima), 3);
});
check('disponibleParaDelivery respeta el activo manual del artículo', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: -10, activo: true, ignoraStock: true });
  assert.strictEqual(disponibleParaDelivery('156A', articulos, materiaPrima), true);
  articulos['156A'] = { ...articulos['156A'], activoDelivery: false };
  assert.strictEqual(disponibleParaDelivery('156A', articulos, materiaPrima), false);
});
check('recetas anidadas: la MP interna que ignora stock tampoco bloquea', () => {
  const articulos = {
    '200A': { nombre: 'Combo', activo: true, activoDelivery: true, stock: { stockType: 'receta', receta: { '156A': 2 } } },
    '156A': { nombre: 'Chipa x6', activo: true, activoDelivery: true, stock: { stockType: 'receta', receta: { '11M': 6 } } },
  };
  const materiaPrima = { '11M': { stock: -30, activo: true, ignoraStock: true } };
  assert.strictEqual(evaluarRecetaPedido('200A', 3, articulos, materiaPrima).suficiente, true);
});
check('la MP sigue apareciendo entre las materias primas del artículo (para el cascadeo)', () => {
  const { articulos, materiaPrima } = catalogoAchaval({ stock: -10, activo: true, ignoraStock: true });
  assert.deepStrictEqual([...materiasPrimasDeArticulo('157A', articulos, materiaPrima)].sort(), ['11M', '25M']);
});

// ---------------------------------------------------------------------------
console.log('\nCaso Achaval (11M con stock negativo e ignoraStock):');
// ---------------------------------------------------------------------------
check('11M queda activa y 156A/157A/158A/159A siguen disponibles', () => {
  const { articulos, materiaPrima } = catalogoAchaval(
    { nombre: 'Chipa', stock: -20, activo: true, ignoraStock: true },
    { nombre: 'Queso', stock: 20, activo: true },
  );
  const mp = reconciliarTodo(materiaPrima);
  assert.strictEqual(mp['11M'].activo, true);
  assert.strictEqual(mp['11M'].stock, -20);
  for (const id of ['156A', '157A', '158A', '159A']) {
    assert.strictEqual(reconciliarArticulo(id, articulos, mp).nodo.activoDelivery, true, id);
    assert.strictEqual(disponibleParaDelivery(id, articulos, mp), true, id);
    assert.strictEqual(evaluarRecetaPedido(id, 3, articulos, mp).suficiente, true, id);
  }
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
