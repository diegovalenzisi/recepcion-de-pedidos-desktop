// Fase 2 — punto 9: los selectores REALES resuelven las opciones dinámicamente.
//
// Falla si un grupo por departamento vuelve a leer `opcionales[]`, si el ID del
// departamento se reduce, si el snapshot se arma buscando en OPCIONALES (donde
// una opción dinámica no existe), o si una opción no seleccionable se puede
// elegir igual.
//
// Correr con: node src/lib/api/__tests__/selectorDinamicoConectado.test.js
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
const leer = (rel) => (fs.existsSync(path.join(RAIZ, rel)) ? fs.readFileSync(path.join(RAIZ, rel), 'utf8') : null);

// Desktop y Tablet comparten el nombre del componente; DLV resuelve en su hook.
const selector = leer('src/components/attention/OptionalSelectionModal.jsx');
const hookDlv = leer('src/hooks/useAppData.jsx');
const selectorDlv = leer('src/components/OptionalSelectorModal.jsx');
const esReceptor = selector !== null;
const fuente = esReceptor ? selector : hookDlv;

console.log(`Proyecto detectado: ${esReceptor ? 'receptor (Desktop/Tablet)' : 'DLV Pedidos'}`);
assert.ok(fuente, 'no se encontró ningún selector que auditar');

console.log('\nResolución dinámica conectada:');
check('el selector usa opcionesVisiblesDeGrupo', () => {
  assert.ok(fuente.includes('opcionesVisiblesDeGrupo('), 'no resuelve por el módulo canónico');
});
check('combina la config del artículo con la definición del grupo', () => {
  assert.ok(fuente.includes('combinarConfigDeGrupo('), 'el artículo decide solo el origen');
});
check('NO arma la lista leyendo opcionales[] por su cuenta', () => {
  // El acceso directo sólo puede vivir dentro del módulo canónico.
  assert.ok(!/groupConfig\.opcionales\s*\|\|\s*\[\]/.test(fuente), 'vuelve a leer opcionales[] en la pantalla');
});

console.log('\nIdentidad y canal:');
check('el ID del departamento no se reduce a dígitos en la resolución', () => {
  const i = fuente.indexOf('opcionesVisiblesDeGrupo(');
  const bloque = fuente.slice(Math.max(0, i - 1200), i + 1200);
  assert.ok(!/departamentoId[^\n]*replace\(\/\\D\/g/.test(bloque), 'reduce el ID del departamento');
});
check('el canal se pasa explícitamente', () => {
  assert.ok(/canal[:,]/.test(fuente), 'no distingue delivery de mostrador');
});
check('la disponibilidad no se evalúa sólo con stock.propio', () => {
  const i = fuente.indexOf('estaDisponible');
  assert.ok(i !== -1, 'no pasa disponibilidad real');
  const bloque = fuente.slice(i, i + 400);
  assert.ok(!/^\s*stock\.propio\s*>\s*0\s*$/m.test(bloque));
});

if (esReceptor) {
  console.log('\nSnapshot al confirmar (Desktop/Tablet):');
  check('el snapshot sale de la opción mostrada, no de OPCIONALES', () => {
    const i = selector.indexOf('selectedWithDetails[groupId]');
    assert.ok(i !== -1);
    const cuerpo = selector.slice(i, i + 700);
    assert.ok(!/allOptionals\?\.find\(op => op\.id === opId\)/.test(cuerpo), 'busca en OPCIONALES: una opción dinámica no está ahí');
    assert.ok(cuerpo.includes('snapshotDeOpcion('), 'no usa el congelador probado');
  });
  check('el snapshot conserva la unidad', () => {
    const i = selector.indexOf('snapshotDeOpcion(');
    const cuerpo = selector.slice(i, i + 200);
    assert.ok(cuerpo.includes('unidadIndice') && cuerpo.includes('unidadTotal'));
  });
  console.log('\nOpción no seleccionable:');
  check('sin stock o con precio roto queda deshabilitada, no oculta', () => {
    assert.ok(selector.includes('opcionSeleccionable('), 'no consulta si se puede elegir');
    const i = selector.indexOf('const isDisabled =');
    const cuerpo = selector.slice(i, i + 300);
    assert.ok(cuerpo.includes('opcionSeleccionable('), 'la deshabilitación ignora la disponibilidad real');
  });
  check('el precio inválido se marca aunque venga de un artículo', () => {
    assert.ok(/opcional\.precioInvalido === true/.test(selector), 'no contempla el precio roto de una opción dinámica');
  });
} else {
  console.log('\nDLV: resolución en el catálogo y bloqueo en la pantalla:');
  check('el grupo por departamento no cae en la rama de opcionales[]', () => {
    const i = hookDlv.indexOf('opcionesVisiblesDeGrupo(');
    const antes = hookDlv.slice(Math.max(0, i - 800), i);
    assert.ok(/origenDeGrupo\(/.test(antes), 'no distingue el origen antes de resolver');
    assert.ok(/else if \(Array\.isArray\(config\.opcionales\)\)/.test(hookDlv), 'la rama manual dejó de ser excluyente');
  });
  check('la opción dinámica conserva articleId y departamentoId', () => {
    const i = hookDlv.indexOf('opcionesVisiblesDeGrupo(');
    const cuerpo = hookDlv.slice(i, i + 1500);
    assert.ok(cuerpo.includes('articleId:'), 'sin articleId no hay descuento de stock posible');
    assert.ok(cuerpo.includes('departamentoId:'));
  });
  check('la pantalla bloquea lo no seleccionable', () => {
    assert.ok(selectorDlv, 'falta el selector de DLV');
    assert.ok(selectorDlv.includes('opcionSeleccionable('), 'permite elegir una opción agotada');
    assert.ok(/disabled=\{!seleccionable/.test(selectorDlv), 'el botón de sumar no respeta la disponibilidad');
  });
  check('muestra agotado en vez de esconder la opción', () => {
    assert.ok(/agotado/i.test(selectorDlv));
  });
}

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
