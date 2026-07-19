'use strict';

// Test plano con node:assert -- el proyecto no tiene test runner configurado
// (sin jest/vitest en package.json), así que se evita sumar una dependencia
// nueva solo para este fix. Correr con: node electron/lib/__tests__/firebaseHttpTransport.test.js
const assert = require('assert');
const https = require('https');
const http = require('http');
const {
  resolveRequestTransport,
  normalizeFirebaseDatabaseURL,
  classifyTransportError,
} = require('../firebaseHttpTransport');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('resolveRequestTransport — variantes que deben elegir https:');
for (const raw of [
  'https://example.firebaseio.com',
  'HTTPS://example.firebaseio.com',
  'Https://example.firebaseio.com',
  '  HTTPS://example.firebaseio.com  ',
]) {
  check(`"${raw}" -> https`, () => {
    const r = resolveRequestTransport(raw);
    assert.strictEqual(r.protocol, 'https:');
    assert.strictEqual(r.module, https);
  });
}

console.log('resolveRequestTransport — http explícito:');
check('"http://localhost:9000" -> http', () => {
  const r = resolveRequestTransport('http://localhost:9000');
  assert.strictEqual(r.protocol, 'http:');
  assert.strictEqual(r.module, http);
});

console.log('resolveRequestTransport — casos que deben rechazarse:');
for (const raw of ['ftp://example.com', 'example.firebaseio.com', '', null, undefined]) {
  check(`"${raw}" -> throw`, () => {
    assert.throws(() => resolveRequestTransport(raw));
  });
}

console.log('resolveRequestTransport — códigos de error específicos:');
check('protocolo no soportado -> code PROTOCOLO_NO_SOPORTADO', () => {
  try {
    resolveRequestTransport('ftp://example.com');
    assert.fail('debía lanzar');
  } catch (e) {
    assert.strictEqual(e.code, 'PROTOCOLO_NO_SOPORTADO');
  }
});
check('URL vacía -> code URL_INVALIDA', () => {
  try {
    resolveRequestTransport('');
    assert.fail('debía lanzar');
  } catch (e) {
    assert.strictEqual(e.code, 'URL_INVALIDA');
  }
});

console.log('normalizeFirebaseDatabaseURL:');
check('recorta espacios y normaliza a origin', () => {
  assert.strictEqual(
    normalizeFirebaseDatabaseURL('  HTTPS://Example.firebaseio.com  '),
    'https://example.firebaseio.com'
  );
});
check('quita barra final / path accidental', () => {
  assert.strictEqual(
    normalizeFirebaseDatabaseURL('https://example.firebaseio.com/'),
    'https://example.firebaseio.com'
  );
});
check('no modifica el dominio', () => {
  assert.strictEqual(
    normalizeFirebaseDatabaseURL('https://mi-proyecto-rtdb.firebaseio.com'),
    'https://mi-proyecto-rtdb.firebaseio.com'
  );
});

console.log('Caso real de Canadá (fixture con el valor guardado en producción):');
check('HTTPS://lanyulinacanada-... -> protocolo https:, módulo https', () => {
  const firebaseDb = 'HTTPS://lanyulinacanada-default-rtdb.firebaseio.com';
  const resultado = resolveRequestTransport(firebaseDb);
  assert.strictEqual(resultado.protocol, 'https:');
  assert.strictEqual(resultado.module, https);
});
check('normalizeFirebaseDatabaseURL corrige el valor guardado de Canadá', () => {
  assert.strictEqual(
    normalizeFirebaseDatabaseURL('HTTPS://lanyulinacanada-default-rtdb.firebaseio.com'),
    'https://lanyulinacanada-default-rtdb.firebaseio.com'
  );
});

console.log('classifyTransportError:');
check('URL_INVALIDA se preserva', () => {
  assert.strictEqual(classifyTransportError({ code: 'URL_INVALIDA' }), 'URL_INVALIDA');
});
check('PROTOCOLO_NO_SOPORTADO se preserva', () => {
  assert.strictEqual(classifyTransportError({ code: 'PROTOCOLO_NO_SOPORTADO' }), 'PROTOCOLO_NO_SOPORTADO');
});
check('401/403 -> PERMISSION_DENIED', () => {
  assert.strictEqual(classifyTransportError({ statusCode: 401 }), 'PERMISSION_DENIED');
  assert.strictEqual(classifyTransportError({ statusCode: 403 }), 'PERMISSION_DENIED');
});
check('error de red genérico -> ERROR_DE_RED', () => {
  assert.strictEqual(classifyTransportError({ code: 'ECONNREFUSED' }), 'ERROR_DE_RED');
  assert.strictEqual(classifyTransportError(null), 'ERROR_DE_RED');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
