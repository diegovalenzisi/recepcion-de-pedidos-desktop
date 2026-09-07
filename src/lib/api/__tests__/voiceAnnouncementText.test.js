// Texto del aviso por voz de un pago recibido — módulo puro, sin Firebase ni
// React ni speechSynthesis. Cubre el caso multi-cuenta (`cuentaMp`, el alias
// editable de la posición de Mercado Pago que recibió el pago) sin romper el
// aviso de siempre para un local de una sola cuenta (sin `cuentaMp`).
// node src/lib/api/__tests__/voiceAnnouncementText.test.js
import assert from 'node:assert';
import { buildAnnouncementText } from '../voiceAnnouncementText.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

console.log('\nSin cuentaMp (local de una sola cuenta, o poller viejo) — texto EXACTAMENTE igual que siempre:');
check('con cliente real detectado', () => {
  const texto = buildAnnouncementText({ monto: 25400, cliente: 'Juan Pérez', estadoCliente: 'detectado' });
  assert.strictEqual(texto, 'Pago recibido de Juan Pérez por 25400 pesos.');
});
check('sin cliente (pendiente), cae al medio', () => {
  const texto = buildAnnouncementText({ monto: 1000, cliente: '', estadoCliente: 'pendiente', medio: 'Mercado Pago' });
  assert.strictEqual(texto, 'Pago recibido de Mercado Pago por 1000 pesos.');
});
check('sin cliente y sin medio, cae al genérico "Mercado Pago"', () => {
  const texto = buildAnnouncementText({ monto: 500, estadoCliente: 'pendiente' });
  assert.strictEqual(texto, 'Pago recibido de Mercado Pago por 500 pesos.');
});

console.log('\nCon cuentaMp (local con más de una cuenta conectada) — se nombra la cuenta, sin decir "Mercado Pago" dos veces:');
check('con cliente real Y cuenta: agrega "en Mercado Pago {alias}" al final', () => {
  const texto = buildAnnouncementText({ monto: 25000, cliente: 'Juan Pérez', estadoCliente: 'detectado', cuentaMp: 'Mónica' });
  assert.strictEqual(texto, 'Pago recibido de Juan Pérez por 25000 pesos en Mercado Pago Mónica.');
});
check('sin cliente pero con cuenta: sustituye el medio por "Mercado Pago {alias}" (nunca "Mercado Pago Mercado Pago Mónica")', () => {
  const texto = buildAnnouncementText({ monto: 25000, estadoCliente: 'pendiente', medio: 'Mercado Pago', cuentaMp: 'Mónica' });
  assert.strictEqual(texto, 'Pago recibido de Mercado Pago Mónica por 25000 pesos.');
});
check('cuentaMp vacío o solo espacios se ignora, como si no viniera', () => {
  const texto = buildAnnouncementText({ monto: 100, cliente: 'Ana', estadoCliente: 'detectado', cuentaMp: '   ' });
  assert.strictEqual(texto, 'Pago recibido de Ana por 100 pesos.');
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
