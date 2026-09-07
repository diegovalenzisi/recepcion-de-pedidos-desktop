// Departamentos canónicos (PEDIDOSYA / RAPPI / M.LIBRE): normalización de
// nombre y plan de creación/adaptación. Módulo puro → corre sin Firebase:
//   node src/lib/api/__tests__/departamentosCanonicos.test.js
import assert from 'node:assert';
import {
  NOMBRE_CANONICO,
  aplicarPlanDepartamentos,
  construirUpdatesDesdePlan,
  contarArticulosPorDepartamento,
  departamentoVisibleEnMostrador,
  filtrarDepartamentosVisiblesEnMostrador,
  normalizarNombreDepartamento,
  planDepartamentosCanonicos,
} from '../departamentosCanonicos.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const dep = (nombre, extra = {}) => ({
  nombre, activo: true, activoDelivery: true, activoMostrador: true,
  permiteVentaEfectivo: true, permiteVentaElectronica: true,
  ordenLocal: '1', ordenWeb: '1', ...extra,
});

console.log('\nNormalización de nombre de departamento:');
check('variantes de PEDIDOSYA (espacio, mayúsculas, punto, guión)', () => {
  for (const v of ['PEDIDOS YA', 'PedidosYa', 'PEDIDOSYA', 'pedidosya', 'PEDIDOS.YA', 'Pedidos-Ya', 'pedidos_ya']) {
    assert.strictEqual(normalizarNombreDepartamento(v), 'PEDIDOSYA', `falló con ${JSON.stringify(v)}`);
  }
});
check('variantes de RAPPI', () => {
  for (const v of ['RAPPI', 'Rappi', 'rappi', ' RAPPI ']) {
    assert.strictEqual(normalizarNombreDepartamento(v), 'RAPPI', `falló con ${JSON.stringify(v)}`);
  }
});
check('variantes de M.LIBRE', () => {
  for (const v of ['M.LIBRE', 'M. LIBRE', 'M LIBRE', 'M.Libre', 'M Libre', 'MLIBRE', 'mlibre', 'Mercado Libre', 'MERCADO LIBRE']) {
    assert.strictEqual(normalizarNombreDepartamento(v), 'MLIBRE', `falló con ${JSON.stringify(v)}`);
  }
});
check('otros departamentos no matchean ninguno de los tres', () => {
  for (const v of ['TOPPING', 'MP DELIVERY', 'BOCHAS', 'PROMO LUNES!!!', '', null, undefined, 'MERCADOPAGO', 'M.PAGO']) {
    assert.strictEqual(normalizarNombreDepartamento(v), null, `falló con ${JSON.stringify(v)}`);
  }
});
check('"MP DELIVERY" (Mercado Pago Delivery) NO es una variante de M.LIBRE', () => {
  assert.strictEqual(normalizarNombreDepartamento('MP DELIVERY'), null);
});

console.log('\nPlan sobre un local vacío (los tres a crear):');
check('crea los tres con ids consecutivos empezando en 1D si no hay departamentos', () => {
  const plan = planDepartamentosCanonicos({});
  assert.strictEqual(plan.length, 3);
  assert.deepStrictEqual(plan.map((p) => p.accion), ['crear', 'crear', 'crear']);
  assert.deepStrictEqual(plan.map((p) => p.id), ['1D', '2D', '3D']);
  for (const paso of plan) {
    assert.strictEqual(paso.cambios.nombre, NOMBRE_CANONICO[paso.clave]);
    assert.strictEqual(paso.cambios.activo, true);
    assert.strictEqual(paso.cambios.activoMostrador, true);
    assert.strictEqual(paso.cambios.activoDelivery, false);
    assert.strictEqual(paso.cambios.permiteVentaEfectivo, true);
    assert.strictEqual(paso.cambios.permiteVentaElectronica, true);
  }
});
check('el id nuevo sigue al máximo id numérico existente', () => {
  const plan = planDepartamentosCanonicos({ '1D': dep('TOPPING'), '19D': dep('DULCES') });
  assert.deepStrictEqual(plan.map((p) => p.id), ['20D', '21D', '22D']);
});

console.log('\nPlan sobre un local con variantes ya escritas (adaptar, no duplicar):');
check('"PEDIDOS YA" existente se adapta: mismo id, nombre corregido y flags puestos', () => {
  const existentes = { '9D': dep('PEDIDOS YA', { activoDelivery: true }) };
  const plan = planDepartamentosCanonicos(existentes);
  const paso = plan.find((p) => p.clave === 'PEDIDOSYA');
  assert.strictEqual(paso.accion, 'adaptar');
  assert.strictEqual(paso.id, '9D');
  assert.strictEqual(paso.nombreActual, 'PEDIDOS YA');
  assert.deepStrictEqual(paso.cambios, { nombre: 'PEDIDOSYA', activoDelivery: false });
});
check('"PEDIDOSYA" (sin espacio) ya canónico y ya con los flags correctos → sin_cambios', () => {
  const existentes = { '6D': dep('PEDIDOSYA', { activoDelivery: false }) };
  const plan = planDepartamentosCanonicos(existentes);
  const paso = plan.find((p) => p.clave === 'PEDIDOSYA');
  assert.strictEqual(paso.accion, 'sin_cambios');
  assert.deepStrictEqual(paso.cambios, {});
});
check('no crea un id nuevo cuando ya existe una variante: no duplica', () => {
  const existentes = { '9D': dep('PEDIDOS YA'), '10D': dep('RAPPI') };
  const plan = planDepartamentosCanonicos(existentes);
  const ids = plan.map((p) => p.id);
  assert.ok(ids.includes('9D') && ids.includes('10D'), 'debía reusar los ids existentes');
  const mlibre = plan.find((p) => p.clave === 'MLIBRE');
  assert.strictEqual(mlibre.accion, 'crear'); // M.LIBRE no existe en ningún local real → se crea
});
check('nunca toca ordenLocal/ordenWeb de un departamento existente al adaptar', () => {
  const existentes = { '9D': dep('PEDIDOS YA', { ordenLocal: '9', ordenWeb: '9' }) };
  const plan = planDepartamentosCanonicos(existentes);
  const paso = plan.find((p) => p.clave === 'PEDIDOSYA');
  assert.ok(!('ordenLocal' in paso.cambios));
  assert.ok(!('ordenWeb' in paso.cambios));
});
check('no modifica ningún OTRO departamento del local', () => {
  const existentes = { '1D': dep('TOPPING'), '2D': dep('BOCHAS') };
  const plan = planDepartamentosCanonicos(existentes);
  const resultado = aplicarPlanDepartamentos(existentes, plan);
  assert.deepStrictEqual(resultado['1D'], existentes['1D']);
  assert.deepStrictEqual(resultado['2D'], existentes['2D']);
});

console.log('\nDuplicados (dos departamentos que matchean la misma clave):');
check('con dos variantes de la misma clave, adapta la de id más chico e informa la otra como duplicado', () => {
  const existentes = { '15D': dep('PEDIDOSYA'), '9D': dep('PEDIDOS YA') };
  const plan = planDepartamentosCanonicos(existentes);
  const paso = plan.find((p) => p.clave === 'PEDIDOSYA');
  assert.strictEqual(paso.id, '9D'); // id numéricamente más chico, no el primero en el objeto
  assert.deepStrictEqual(paso.duplicados, ['15D']);
});
check('un duplicado nunca se toca (no aparece en los updates)', () => {
  const existentes = { '15D': dep('PEDIDOSYA'), '9D': dep('PEDIDOS YA') };
  const plan = planDepartamentosCanonicos(existentes);
  const updates = construirUpdatesDesdePlan(plan, '40508022');
  for (const clave of Object.keys(updates)) {
    assert.ok(!clave.includes('/15D/') && !clave.endsWith('/15D'), `tocó el duplicado: ${clave}`);
  }
});

console.log('\nIdempotencia (aplicar el plan dos veces converge):');
check('un segundo plan sobre el resultado del primero no propone ningún cambio', () => {
  const existentes = { '9D': dep('PEDIDOS YA'), '10D': dep('RAPPI'), '1D': dep('TOPPING') };
  const plan1 = planDepartamentosCanonicos(existentes);
  const despuesDe1 = aplicarPlanDepartamentos(existentes, plan1);
  const plan2 = planDepartamentosCanonicos(despuesDe1);
  assert.deepStrictEqual(plan2.map((p) => p.accion), ['sin_cambios', 'sin_cambios', 'sin_cambios']);
  assert.deepStrictEqual(plan2.map((p) => p.cambios), [{}, {}, {}]);
});
check('desde vacío: aplicar y volver a planear también converge', () => {
  const plan1 = planDepartamentosCanonicos({});
  const despuesDe1 = aplicarPlanDepartamentos({}, plan1);
  assert.strictEqual(Object.keys(despuesDe1).length, 3);
  const plan2 = planDepartamentosCanonicos(despuesDe1);
  assert.deepStrictEqual(plan2.map((p) => p.accion), ['sin_cambios', 'sin_cambios', 'sin_cambios']);
});

console.log('\nUpdates planos para Firebase:');
check('crear escribe el departamento completo de una sola vez', () => {
  const plan = planDepartamentosCanonicos({});
  const updates = construirUpdatesDesdePlan(plan, '40508022');
  const py = plan.find((p) => p.clave === 'PEDIDOSYA');
  assert.deepStrictEqual(updates[`40508022/DEPARTAMENTOS/${py.id}`], py.cambios);
});
check('adaptar sólo escribe los campos que cambian, path por path', () => {
  const existentes = { '9D': dep('PEDIDOS YA') };
  const plan = planDepartamentosCanonicos(existentes);
  const updates = construirUpdatesDesdePlan(plan, '40508022');
  assert.strictEqual(updates['40508022/DEPARTAMENTOS/9D/nombre'], 'PEDIDOSYA');
  assert.strictEqual(updates['40508022/DEPARTAMENTOS/9D/activoDelivery'], false);
  assert.ok(!('40508022/DEPARTAMENTOS/9D/ordenLocal' in updates));
  assert.ok(!('40508022/DEPARTAMENTOS/9D' in updates)); // nunca pisa el nodo entero al adaptar
});
check('sin_cambios no genera ningún update', () => {
  const existentes = {
    '9D': dep('PEDIDOSYA', { activoDelivery: false }),
    '10D': dep('RAPPI', { activoDelivery: false }),
    '11D': dep('M.LIBRE', { activoDelivery: false }),
  };
  const plan = planDepartamentosCanonicos(existentes);
  const updates = construirUpdatesDesdePlan(plan, '40508022');
  assert.deepStrictEqual(updates, {});
});

console.log('\nVisibilidad en Mostrador (solo para los tres canónicos):');
const articulo = (id, departamento) => ({ id, departamento });

check('contarArticulosPorDepartamento cuenta por el id real del depto', () => {
  const conteo = contarArticulosPorDepartamento([
    articulo('A1', '9D'), articulo('A2', '9D'), articulo('A3', '10D'),
  ]);
  assert.deepStrictEqual(conteo, { '9D': 2, '10D': 1 });
});
check('ignora artículos sin departamento asignado', () => {
  assert.deepStrictEqual(contarArticulosPorDepartamento([{ id: 'A1' }, articulo('A2', null)]), {});
});

check('PEDIDOSYA con 0 artículos → oculto', () => {
  assert.strictEqual(departamentoVisibleEnMostrador(dep('PEDIDOSYA'), 0), false);
  assert.strictEqual(departamentoVisibleEnMostrador(dep('PEDIDOSYA'), undefined), false);
});
check('PEDIDOSYA con 1 artículo → visible', () => {
  assert.strictEqual(departamentoVisibleEnMostrador(dep('PEDIDOSYA'), 1), true);
});
check('RAPPI con 0 artículos → oculto', () => {
  assert.strictEqual(departamentoVisibleEnMostrador(dep('RAPPI'), 0), false);
});
check('M.LIBRE con 3 artículos → visible', () => {
  assert.strictEqual(departamentoVisibleEnMostrador(dep('M.LIBRE'), 3), true);
});
check('una variante mal escrita (PEDIDOS YA) también respeta la regla', () => {
  assert.strictEqual(departamentoVisibleEnMostrador(dep('PEDIDOS YA'), 0), false);
  assert.strictEqual(departamentoVisibleEnMostrador(dep('PEDIDOS YA'), 1), true);
});
check('un departamento CUALQUIERA (no canónico) siempre es visible, tenga o no artículos', () => {
  assert.strictEqual(departamentoVisibleEnMostrador(dep('TOPPING'), 0), true);
  assert.strictEqual(departamentoVisibleEnMostrador(dep('TOPPING'), 5), true);
});

check('filtrarDepartamentosVisiblesEnMostrador: oculta solo los canónicos vacíos', () => {
  const departamentos = [
    { id: '9D', ...dep('PEDIDOSYA') },
    { id: '10D', ...dep('RAPPI') },
    { id: '11D', ...dep('M.LIBRE') },
    { id: '1D', ...dep('TOPPING') },
  ];
  const articulos = [articulo('A1', '9D')]; // sólo PEDIDOSYA tiene artículos
  const visibles = filtrarDepartamentosVisiblesEnMostrador(departamentos, articulos).map((d) => d.id);
  assert.deepStrictEqual(visibles, ['9D', '1D']); // RAPPI y M.LIBRE quedan afuera; TOPPING nunca se toca
});
check('quitar el último artículo del departamento lo oculta', () => {
  const departamentos = [{ id: '9D', ...dep('PEDIDOSYA') }];
  const conArticulo = filtrarDepartamentosVisiblesEnMostrador(departamentos, [articulo('A1', '9D')]);
  assert.strictEqual(conArticulo.length, 1);
  const sinArticulo = filtrarDepartamentosVisiblesEnMostrador(departamentos, []); // se borró/reasignó el único artículo
  assert.strictEqual(sinArticulo.length, 0);
});
check('volver a agregar un artículo lo hace reaparecer', () => {
  const departamentos = [{ id: '9D', ...dep('PEDIDOSYA') }];
  assert.strictEqual(filtrarDepartamentosVisiblesEnMostrador(departamentos, []).length, 0);
  const reaparecido = filtrarDepartamentosVisiblesEnMostrador(departamentos, [articulo('A9', '9D')]);
  assert.strictEqual(reaparecido.length, 1);
  assert.strictEqual(reaparecido[0].id, '9D');
});
check('esta regla no cambia nada en Firebase: el departamento sigue activo, solo se filtra la lista', () => {
  // departamentoVisibleEnMostrador/filtrarDepartamentosVisiblesEnMostrador no
  // reciben ninguna referencia a Firebase (db/ref/update) — son puro cálculo
  // sobre los arrays que ya se leyeron. No hay nada que verificar en runtime
  // además de que la firma no toma un `db`: lo documenta la firma misma.
  assert.strictEqual(departamentoVisibleEnMostrador.length, 2);
  assert.strictEqual(filtrarDepartamentosVisiblesEnMostrador.length, 2);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
