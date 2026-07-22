// Fase 2 — SHA-256 portable: se valida contra vectores oficiales y, cuando está
// disponible, contra la implementación nativa de Node.
//
// Correr con: node src/lib/api/__tests__/sha256.test.js
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { sha256Hex, jsonCanonico, cantidadCanonica } from '../sha256.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const nativo = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

console.log('Vectores oficiales:');
check('cadena vacía', () => {
  assert.strictEqual(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
check('"abc"', () => {
  assert.strictEqual(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
check('mensaje de 448 bits (dos bloques)', () => {
  assert.strictEqual(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

console.log('\nCoincide con node:crypto:');
for (const caso of ['', 'a', 'Rocklets', 'ñáéíóú ¿?¡!', 'A-0007|ARTICULO|1', 'x'.repeat(1000),
  JSON.stringify({ localId: '40508022', impacts: [{ resourceId: 'A-0007' }] }), '🍦 helado']) {
  check(`"${caso.slice(0, 28)}${caso.length > 28 ? '…' : ''}" (${caso.length} chars)`, () => {
    assert.strictEqual(sha256Hex(caso), nativo(caso));
  });
}
check('entradas largas en los bordes de bloque (55/56/57/63/64/65 bytes)', () => {
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 121]) {
    const s = 'a'.repeat(n);
    assert.strictEqual(sha256Hex(s), nativo(s), `longitud ${n}`);
  }
});
check('siempre 64 caracteres hex en minúscula', () => {
  for (const s of ['', 'abc', 'Rocklets']) {
    assert.match(sha256Hex(s), /^[0-9a-f]{64}$/);
  }
});

console.log('\nSerialización canónica (el orden de propiedades no puede importar):');
check('dos objetos equivalentes con distinto orden dan el MISMO texto', () => {
  assert.strictEqual(
    jsonCanonico({ b: 1, a: 2, c: { z: 1, y: 2 } }),
    jsonCanonico({ c: { y: 2, z: 1 }, a: 2, b: 1 }),
  );
});
check('JSON.stringify NO sirve para esto (por eso existe jsonCanonico)', () => {
  assert.notStrictEqual(JSON.stringify({ b: 1, a: 2 }), JSON.stringify({ a: 2, b: 1 }));
  assert.strictEqual(jsonCanonico({ b: 1, a: 2 }), jsonCanonico({ a: 2, b: 1 }));
});
check('el orden de un ARRAY sí importa (es significativo)', () => {
  assert.notStrictEqual(jsonCanonico([1, 2]), jsonCanonico([2, 1]));
});
check('undefined se omite; null se conserva', () => {
  assert.strictEqual(jsonCanonico({ a: 1, b: undefined }), jsonCanonico({ a: 1 }));
  assert.notStrictEqual(jsonCanonico({ a: null }), jsonCanonico({}));
});

console.log('\nCantidad canónica (sin locale, sin exponencial, sin ruido binario):');
check('equivalentes numéricos dan el mismo texto', () => {
  assert.strictEqual(cantidadCanonica(0.5), cantidadCanonica('0.50'));
  assert.strictEqual(cantidadCanonica(1), cantidadCanonica('1.000000'));
  assert.strictEqual(cantidadCanonica(2), '2');
});
check('elimina el ruido de punto flotante', () => {
  assert.strictEqual(cantidadCanonica(0.1 + 0.2), '0.3');
  assert.strictEqual(cantidadCanonica(0.25 + 0.25), '0.5');
});
check('no usa notación exponencial ni separadores de miles', () => {
  assert.strictEqual(cantidadCanonica(1e3), '1000');
  assert.strictEqual(cantidadCanonica(1234567), '1234567');
  assert.ok(!cantidadCanonica(0.0000001).includes('e'));
});
check('no depende del locale (nunca usa coma decimal)', () => {
  assert.ok(!cantidadCanonica(1.5).includes(','));
  assert.strictEqual(cantidadCanonica(1.5), '1.5');
});
check('-0 y 0 son el mismo texto', () => {
  assert.strictEqual(cantidadCanonica(-0), '0');
  assert.strictEqual(cantidadCanonica(0), '0');
});
check('valores no finitos se marcan, no se convierten en 0', () => {
  assert.strictEqual(cantidadCanonica(NaN), 'NaN');
  assert.strictEqual(cantidadCanonica(Infinity), 'NaN');
  assert.strictEqual(cantidadCanonica('abc'), 'NaN');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
