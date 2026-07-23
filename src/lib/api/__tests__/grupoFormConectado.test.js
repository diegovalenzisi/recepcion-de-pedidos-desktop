// Fase 2 — punto 8: la pantalla real de grupos está conectada al módulo canónico.
//
// Falla si alguien deja el módulo importado pero sin usar, si vuelve el formulario
// viejo de un solo campo, si el ID del departamento se reduce a números o si se
// hardcodea un grupo puntual como "TOPPING".
//
// Correr con: node src/lib/api/__tests__/grupoFormConectado.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const modal = fs.readFileSync(path.join(RAIZ, 'src/components/management/FormModal.jsx'), 'utf8');
const campos = fs.readFileSync(path.join(RAIZ, 'src/components/management/forms/OptionalGroupFormFields.jsx'), 'utf8');

console.log('La pantalla de grupos usa el módulo canónico:');
check('FormModal renderiza el formulario nuevo para grupos-opcionales', () => {
  const i = modal.indexOf("case 'grupos-opcionales':");
  assert.ok(i !== -1, 'desapareció el caso');
  const cuerpo = modal.slice(i, i + 400);
  assert.ok(cuerpo.includes('<OptionalGroupFormFields'), 'no renderiza el formulario nuevo');
});
check('ya no queda el formulario viejo de un solo campo', () => {
  const i = modal.indexOf("case 'grupos-opcionales':");
  const cuerpo = modal.slice(i, i + 400);
  assert.ok(!/<input name="nombre"/.test(cuerpo), 'volvió el formulario mínimo');
});
check('la carga inicial pasa por valoresInicialesGrupo', () => {
  assert.ok(modal.includes('valoresInicialesGrupo('), 'importado pero sin invocar');
});
check('el guardado pasa por construirGrupoParaGuardar', () => {
  assert.ok(modal.includes('construirGrupoParaGuardar('), 'guarda el formData crudo');
});
check('la validación BLOQUEA el guardado (no sólo avisa)', () => {
  const i = modal.indexOf('validarGrupoOpcional(');
  assert.ok(i !== -1, 'no valida');
  const cuerpo = modal.slice(i, i + 500);
  assert.ok(/if \(!valido\)/.test(cuerpo) && /return;/.test(cuerpo), 'valida pero guarda igual');
});

console.log('\nIdentidad del departamento:');
check('el ID del departamento NO se reduce a números', () => {
  for (const src of [modal, campos]) {
    assert.ok(!/replace\(\/\\D\/g/.test(src), 'reduce el ID quitando lo no numérico');
    assert.ok(!/parseInt\(\s*[\w.]*departamentoId/.test(src), 'convierte el ID a número');
  }
});
check('el selector guarda el ID, no el nombre', () => {
  assert.ok(/onFieldChange\('departamentoId', e\.target\.value\)/.test(campos));
  assert.ok(!/onFieldChange\('departamentoNombre'/.test(campos), 'guarda el nombre como relación');
});
check('el valor de cada opción del selector es el ID real', () => {
  assert.ok(/<option key=\{id\} value=\{id\}>/.test(campos), 'la opción no lleva el ID como valor');
});

console.log('\nSin grupos hardcodeados:');
check('no hardcodea "TOPPING" ni ningún grupo puntual', () => {
  assert.ok(!/'TOPPING'|"TOPPING"/.test(campos), 'hay un grupo hardcodeado en la pantalla');
  assert.ok(!/'D-TOP'|"D-TOP"/.test(campos), 'hay un departamento hardcodeado en la pantalla');
});
check('los orígenes salen del módulo canónico, no de literales sueltos', () => {
  assert.ok(campos.includes("from '@/lib/api/grupoOpcionalForm'"));
  assert.ok(campos.includes('ORIGEN_DEPARTAMENTO') && campos.includes('ORIGEN_MANUAL'));
  assert.ok(!/origen === 'departamento'/.test(campos), 'compara contra un literal en vez de la constante');
});

console.log('\nCambio de origen con confirmación:');
check('el cambio de origen pasa por cambiarOrigen', () => {
  assert.ok(campos.includes('cambiarOrigen('), 'cambia el origen a mano');
});
check('respeta requiereConfirmacion antes de aplicar', () => {
  assert.ok(/requiereConfirmacion/.test(campos), 'aplica el cambio sin preguntar');
});
check('la pantalla no borra datos por su cuenta', () => {
  assert.ok(!/delete .*departamentoId/.test(campos), 'borra el departamento sin confirmación');
  assert.ok(!/consumosPorArticulo:\s*\{\}\s*\)/.test(campos), 'vacía los consumos sin confirmación');
});

console.log('\nOpciones dinámicas, no copiadas:');
check('el formulario NO copia los artículos dentro del grupo', () => {
  assert.ok(!/onFieldChange\('opcionales'/.test(campos), 'copia artículos a opcionales[]');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
