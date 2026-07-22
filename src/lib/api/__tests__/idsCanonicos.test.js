// Fase 2 — identidad canónica de departamentos y artículos.
// Corre en los tres repos (byte a byte idéntico).
//
// Correr con: node src/lib/api/__tests__/idsCanonicos.test.js
import assert from 'node:assert';
import {
  idCanonico, aliasLegado, mismoIdExacto, resolverId,
  detectarAliasAmbiguos, esIdLegado,
} from '../idsCanonicos.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

console.log('El ID canónico es la clave real, completa:');
check('nunca se le quitan letras', () => {
  assert.strictEqual(idCanonico('D123'), 'D123');
  assert.strictEqual(idCanonico('A-0007'), 'A-0007');
  assert.strictEqual(idCanonico('  D12  '), 'D12');
});
check('vacío o nulo devuelve null, no cadena vacía', () => {
  assert.strictEqual(idCanonico(''), null);
  assert.strictEqual(idCanonico(null), null);
  assert.strictEqual(idCanonico(undefined), null);
  assert.strictEqual(idCanonico('   '), null);
});
check('la comparación exacta distingue D12 de 12', () => {
  assert.strictEqual(mismoIdExacto('D12', 'D12'), true);
  assert.strictEqual(mismoIdExacto('D12', '12'), false, 'D12 y 12 NO son el mismo departamento');
  assert.strictEqual(mismoIdExacto('D0012', '12'), false);
  assert.strictEqual(mismoIdExacto(null, null), false);
});

console.log('\nAlias legado (solo compatibilidad, nunca identidad):');
check('D12, 12 y D0012 comparten alias — por eso no sirve como identidad', () => {
  assert.strictEqual(aliasLegado('D12'), '12');
  assert.strictEqual(aliasLegado('12'), '12');
  assert.strictEqual(aliasLegado('D0012'), '12');
  assert.strictEqual(aliasLegado('AB12'), '12');
});
check('sin dígitos no hay alias', () => {
  assert.strictEqual(aliasLegado('TOPPING'), null);
  assert.strictEqual(aliasLegado(''), null);
});
check('esIdLegado reconoce una referencia histórica de DLV', () => {
  assert.strictEqual(esIdLegado('12'), true);
  assert.strictEqual(esIdLegado('D12'), false);
  assert.strictEqual(esIdLegado('A-0007'), false);
});

console.log('\nResolución contra el catálogo real:');
const CLAVES = ['D12', 'D30', 'A-0007', 'A-ROCKLETS'];

check('coincidencia exacta: siempre gana, sin habilitar nada', () => {
  const r = resolverId('D12', CLAVES);
  assert.strictEqual(r.id, 'D12');
  assert.strictEqual(r.via, 'exacto');
  assert.strictEqual(r.ambiguo, false);
});
check('un ID que no existe NO se resuelve por parecido', () => {
  const r = resolverId('12', CLAVES);
  assert.strictEqual(r.id, null, 'sin habilitar el legado no hay resolución');
});
check('con legado habilitado, 12 resuelve a D12 (dato histórico)', () => {
  const r = resolverId('12', CLAVES, { permitirLegado: true });
  assert.strictEqual(r.id, 'D12');
  assert.strictEqual(r.via, 'legado');
});
check('D0012 también resuelve a D12 por alias', () => {
  const r = resolverId('D0012', CLAVES, { permitirLegado: true });
  assert.strictEqual(r.id, 'D12');
  assert.strictEqual(r.via, 'legado');
});
check('AMBIGUO: dos claves distintas con el mismo alias se RECHAZAN', () => {
  const claves = ['D12', '12', 'D0012'];   // los tres colapsan a "12"
  const r = resolverId('12', claves, { permitirLegado: true });
  // '12' existe exacto, así que gana la exacta y no hay ambigüedad.
  assert.strictEqual(r.via, 'exacto');

  const r2 = resolverId('AB12', claves, { permitirLegado: true });
  assert.strictEqual(r2.id, null, 'no se adivina');
  assert.strictEqual(r2.ambiguo, true);
  assert.strictEqual(r2.candidatos.length, 3);
});
check('dos departamentos distintos que colapsarían al mismo texto', () => {
  const claves = ['D7', 'X7'];
  const r = resolverId('7', claves, { permitirLegado: true });
  assert.strictEqual(r.id, null);
  assert.strictEqual(r.ambiguo, true);
  assert.deepStrictEqual(r.candidatos.sort(), ['D7', 'X7']);
});
check('entradas basura no rompen', () => {
  assert.deepStrictEqual(resolverId(null, CLAVES).id, null);
  assert.deepStrictEqual(resolverId('D12', null).id, null);
});

console.log('\nDetección temprana de ambigüedad en la configuración:');
check('avisa cuando el catálogo tiene alias colisionantes', () => {
  const amb = detectarAliasAmbiguos(['D12', '12', 'D30']);
  assert.strictEqual(amb.length, 1);
  assert.strictEqual(amb[0].alias, '12');
  assert.deepStrictEqual(amb[0].ids.sort(), ['12', 'D12']);
});
check('un catálogo sano no reporta nada', () => {
  assert.strictEqual(detectarAliasAmbiguos(['D12', 'D30', 'D45']).length, 0);
});

console.log('\nSnapshots:');
check('un snapshot NUEVO conserva el ID completo', () => {
  const snap = { departamentoId: 'D12', articleId: 'A-ROCKLETS' };
  assert.strictEqual(idCanonico(snap.departamentoId), 'D12');
  assert.strictEqual(esIdLegado(snap.departamentoId), false);
  assert.strictEqual(resolverId(snap.departamentoId, CLAVES).via, 'exacto');
});
check('un snapshot HISTÓRICO normalizado sigue abriendo por compatibilidad', () => {
  const snapViejo = { departamentoId: '12' };
  const esHistorico = esIdLegado(snapViejo.departamentoId);
  assert.strictEqual(esHistorico, true);
  const r = resolverId(snapViejo.departamentoId, CLAVES, { permitirLegado: esHistorico });
  assert.strictEqual(r.id, 'D12');
  assert.strictEqual(r.via, 'legado');
});
check('un snapshot nuevo NO habilita el camino legado', () => {
  const snapNuevo = { departamentoId: 'D99' };  // no existe en el catálogo
  const r = resolverId(snapNuevo.departamentoId, CLAVES, { permitirLegado: esIdLegado(snapNuevo.departamentoId) });
  assert.strictEqual(r.id, null, 'un ID moderno inexistente es un error, no un alias');
});

console.log('\nSerialización DLV → Desktop/Tablet (sin normalización destructiva):');
check('el ID de departamento llega COMPLETO tras serializar el pedido', () => {
  // Lo que DLV escribe en Firebase para un opcional de departamento.
  const opcionalEnPedido = {
    nombre: 'Rocklets',
    grupoId: 'G-TOP',
    departamentoId: 'D12',
    articleId: 'A-0203',
    precioUnitario: 1700, cantidad: 1, total: 1700,
  };
  const json = JSON.stringify({ items: [{ selectedOptionals: { 'G-TOP': [opcionalEnPedido] } }] });
  const recibido = JSON.parse(json).items[0].selectedOptionals['G-TOP'][0];

  assert.strictEqual(recibido.departamentoId, 'D12', 'no puede llegar como "12"');
  assert.strictEqual(recibido.articleId, 'A-0203', 'no puede llegar como "203"');
  assert.strictEqual(esIdLegado(recibido.departamentoId), false);
  assert.strictEqual(esIdLegado(recibido.articleId), false);
});
check('el receptor lo resuelve por coincidencia EXACTA, sin habilitar el legado', () => {
  const catalogoDeptos = ['D12', 'D30'];
  const catalogoArts = ['A-0203', 'A-0007'];
  const r1 = resolverId('D12', catalogoDeptos, { permitirLegado: esIdLegado('D12') });
  const r2 = resolverId('A-0203', catalogoArts, { permitirLegado: esIdLegado('A-0203') });
  assert.strictEqual(r1.via, 'exacto');
  assert.strictEqual(r2.via, 'exacto');
});
check('un ID reducido a dígitos delata un emisor viejo y NO se acepta como nuevo', () => {
  // Si un pedido NUEVO trajera "12", eso significa que alguien volvió a
  // normalizar destructivamente: se detecta en vez de resolverse en silencio.
  const recibido = { departamentoId: '12', esPedidoNuevo: true };
  const legado = esIdLegado(recibido.departamentoId);
  assert.strictEqual(legado, true, 'se reconoce como forma legada');
  const r = resolverId(recibido.departamentoId, ['D12'], { permitirLegado: !recibido.esPedidoNuevo });
  assert.strictEqual(r.id, null, 'un pedido nuevo no puede apoyarse en el alias');
});
check('nunca se elige el primer candidato arbitrariamente', () => {
  const r = resolverId('12', ['D12', 'X12'], { permitirLegado: true });
  assert.strictEqual(r.id, null);
  assert.strictEqual(r.ambiguo, true);
  assert.notStrictEqual(r.id, 'D12', 'no se toma el primero por descarte');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
