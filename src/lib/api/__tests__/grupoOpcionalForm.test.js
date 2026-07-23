// Fase 2 — punto 8: lógica de la pantalla de configuración de grupos.
// Correr con: node src/lib/api/__tests__/grupoOpcionalForm.test.js
import assert from 'node:assert';
import {
  ORIGEN_MANUAL,
  ORIGEN_DEPARTAMENTO,
  valoresInicialesGrupo,
  cambiarOrigen,
  validarGrupoOpcional,
  construirGrupoParaGuardar,
  limpiarDatosDepartamento,
} from '../grupoOpcionalForm.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const DEPARTAMENTOS = { 'D-TOP': { nombre: 'TOPPING' }, 'D-SAL': { nombre: 'SALSAS' } };

console.log('Lectura de un grupo (sin migrarlo):');
check('grupo viejo sin origen se interpreta manual', () => {
  const v = valoresInicialesGrupo({ nombre: 'SABORES' });
  assert.strictEqual(v.origen, ORIGEN_MANUAL);
  assert.strictEqual(v.origenOriginal, null, 'no debe inventar que traía origen');
});
check('abrir y guardar un grupo viejo NO escribe origen: manual', () => {
  const viejo = { codigo: 'G-SAB', nombre: 'SABORES' };
  const guardado = construirGrupoParaGuardar(valoresInicialesGrupo(viejo), viejo);
  assert.ok(!('origen' in guardado), 'escribió origen en un grupo que no lo tenía');
  assert.strictEqual(guardado.nombre, 'SABORES');
});
check('grupo que YA declaraba manual conserva la declaración', () => {
  const g = { codigo: 'G-X', nombre: 'X', origen: 'manual' };
  const guardado = construirGrupoParaGuardar(valoresInicialesGrupo(g), g);
  assert.strictEqual(guardado.origen, ORIGEN_MANUAL);
});
check('grupo por departamento se relee completo', () => {
  const v = valoresInicialesGrupo({
    nombre: 'TOPPING', origen: 'departamento', departamentoId: 'D-TOP',
    usarPrecioArticulo: true, controlarStock: true, consumoStockUnitarioDefault: 1,
    consumosPorArticulo: { 'A-ROCKLETS': 2 },
  });
  assert.strictEqual(v.origen, ORIGEN_DEPARTAMENTO);
  assert.strictEqual(v.departamentoId, 'D-TOP');
  assert.strictEqual(v.consumosPorArticulo['A-ROCKLETS'], 2);
});

console.log('\nCambio de origen:');
check('manual -> departamento con opciones cargadas pide confirmación', () => {
  const r = cambiarOrigen({ origen: ORIGEN_MANUAL }, ORIGEN_DEPARTAMENTO, { opcionalesManuales: [{ codigo: 'O-1' }] });
  assert.strictEqual(r.requiereConfirmacion, true);
  assert.ok(/no se borran/.test(r.mensaje));
});
check('manual -> departamento sin opciones no molesta', () => {
  const r = cambiarOrigen({ origen: ORIGEN_MANUAL }, ORIGEN_DEPARTAMENTO, { opcionalesManuales: [] });
  assert.strictEqual(r.requiereConfirmacion, false);
});
check('departamento -> manual pide confirmación y NO borra', () => {
  const form = { origen: ORIGEN_DEPARTAMENTO, departamentoId: 'D-TOP', consumosPorArticulo: { 'A-ROCKLETS': 2 } };
  const r = cambiarOrigen(form, ORIGEN_MANUAL);
  assert.strictEqual(r.requiereConfirmacion, true);
  assert.strictEqual(r.form.departamentoId, 'D-TOP', 'borró el departamento sin permiso');
  assert.strictEqual(r.form.consumosPorArticulo['A-ROCKLETS'], 2);
});
check('siendo manual, los datos de departamento quedan pero no se usan', () => {
  const form = { origen: ORIGEN_MANUAL, nombre: 'X', departamentoId: 'D-TOP', origenOriginal: 'departamento' };
  const g = construirGrupoParaGuardar(form, { departamentoId: 'D-TOP' });
  assert.strictEqual(g.origen, ORIGEN_MANUAL);
  assert.strictEqual(g.departamentoId, 'D-TOP', 'se conservan');
});
check('limpieza explícita sí borra', () => {
  const g = limpiarDatosDepartamento({ nombre: 'X', departamentoId: 'D-TOP', consumosPorArticulo: { a: 1 } });
  assert.ok(!('departamentoId' in g));
  assert.ok(!('consumosPorArticulo' in g));
});

console.log('\nValidación:');
const baseDep = {
  nombre: 'TOPPING', origen: ORIGEN_DEPARTAMENTO, departamentoId: 'D-TOP',
  usarPrecioArticulo: true, controlarStock: true, consumoStockUnitarioDefault: 1, consumosPorArticulo: {},
};
check('configuración válida pasa', () => {
  const r = validarGrupoOpcional(baseDep, { departamentos: DEPARTAMENTOS });
  assert.strictEqual(r.valido, true, JSON.stringify(r.errores));
});
check('nombre obligatorio', () => {
  const r = validarGrupoOpcional({ ...baseDep, nombre: '  ' }, { departamentos: DEPARTAMENTOS });
  assert.ok(r.errores.some((e) => e.campo === 'nombre'));
});
check('departamento obligatorio si el origen es departamento', () => {
  const r = validarGrupoOpcional({ ...baseDep, departamentoId: '' }, { departamentos: DEPARTAMENTOS });
  assert.ok(r.errores.some((e) => e.campo === 'departamentoId' && e.motivo === 'requerido'));
});
check('departamento inexistente se rechaza', () => {
  const r = validarGrupoOpcional({ ...baseDep, departamentoId: 'D-NADA' }, { departamentos: DEPARTAMENTOS });
  assert.ok(r.errores.some((e) => e.motivo === 'inexistente'));
});
check('ID con caracteres prohibidos de Firebase se rechaza', () => {
  const r = validarGrupoOpcional({ ...baseDep, departamentoId: 'D/TOP' }, { departamentos: {} });
  assert.ok(r.errores.some((e) => e.motivo === 'id-invalido'));
});
check('ID reducido a números avisa (no es el ID real)', () => {
  const r = validarGrupoOpcional({ ...baseDep, departamentoId: '3' }, { departamentos: { 3: {} } });
  assert.ok(r.avisos.some((a) => a.motivo === 'id-legado'));
});
check('alias ambiguos entre departamentos se avisan', () => {
  const r = validarGrupoOpcional({ ...baseDep, departamentoId: 'D-3' }, { departamentos: { 'D-3': {}, 'DEP-3': {} } });
  assert.ok(r.avisos.some((a) => a.motivo === 'alias-ambiguo'), JSON.stringify(r));
});
check('consumo predeterminado debe ser > 0 si controla stock', () => {
  for (const v of [0, -1, '', 'abc', null]) {
    const r = validarGrupoOpcional({ ...baseDep, consumoStockUnitarioDefault: v }, { departamentos: DEPARTAMENTOS });
    assert.ok(r.errores.some((e) => e.campo === 'consumoStockUnitarioDefault'), `aceptó ${JSON.stringify(v)}`);
  }
});
check('sin control de stock, el consumo no se exige', () => {
  const r = validarGrupoOpcional({ ...baseDep, controlarStock: false, consumoStockUnitarioDefault: 0 }, { departamentos: DEPARTAMENTOS });
  assert.strictEqual(r.valido, true);
});
check('overrides deben ser numéricos y > 0', () => {
  const r = validarGrupoOpcional({ ...baseDep, consumosPorArticulo: { 'A-ROCKLETS': 'Vasitos x 5' } }, { departamentos: DEPARTAMENTOS });
  assert.ok(r.errores.some((e) => e.campo === 'consumosPorArticulo.A-ROCKLETS'));
});
check('el consumo NUNCA se infiere de un nombre', () => {
  const r = validarGrupoOpcional({ ...baseDep, consumosPorArticulo: { 'A-VASITOS': '' } }, { departamentos: DEPARTAMENTOS });
  assert.ok(r.errores.some((e) => e.motivo === 'invalido'), 'debe pedir el número explícito');
});
check('max menor que min se rechaza', () => {
  const r = validarGrupoOpcional({ ...baseDep, min: 2, max: 1 }, { departamentos: DEPARTAMENTOS });
  assert.ok(r.errores.some((e) => e.campo === 'max'));
});
check('un grupo manual no exige nada de departamento', () => {
  const r = validarGrupoOpcional({ nombre: 'SABORES', origen: ORIGEN_MANUAL }, { departamentos: DEPARTAMENTOS });
  assert.strictEqual(r.valido, true);
});

console.log('\nModelo guardado:');
check('guarda IDs reales completos, nunca reducidos', () => {
  const g = construirGrupoParaGuardar(
    { ...baseDep, min: 0, max: 3, obligatorio: false, activo: true, consumosPorArticulo: { 'A-ROCKLETS': 2 } },
    { codigo: 'G-TOPPING' }
  );
  assert.deepStrictEqual(g, {
    codigo: 'G-TOPPING',
    nombre: 'TOPPING',
    min: 0,
    max: 3,
    obligatorio: false,
    activo: true,
    origen: 'departamento',
    departamentoId: 'D-TOP',
    usarPrecioArticulo: true,
    controlarStock: true,
    consumoStockUnitarioDefault: 1,
    consumosPorArticulo: { 'A-ROCKLETS': 2 },
  });
});
check('un override igual al predeterminado no se guarda', () => {
  const g = construirGrupoParaGuardar({ ...baseDep, consumosPorArticulo: { 'A-ROCKLETS': 1 } }, {});
  assert.ok(!('consumosPorArticulo' in g), 'guardó un override que no difiere');
});
check('no guarda el nombre del departamento como relación', () => {
  const g = construirGrupoParaGuardar({ ...baseDep, departamentoNombre: 'TOPPING' }, {});
  assert.strictEqual(g.departamentoId, 'D-TOP');
  assert.ok(!('departamentoNombre' in g));
});
check('no copia los artículos dentro del grupo', () => {
  const g = construirGrupoParaGuardar(baseDep, { codigo: 'G-TOPPING' });
  assert.ok(!('opcionales' in g), 'el grupo por departamento no debe llevar opcionales[]');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
