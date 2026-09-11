// "Finalizar Pedido", Mostrador + Efectivo: "Paga con" (montoAbonado) ahora
// es obligatorio y debe alcanzar el total antes de poder confirmar. Antes el
// campo se precargaba en silencio con el total apenas se elegía Efectivo
// (aunque el cajero nunca hubiera escrito nada), así que jamás se podía
// detectar "vacío" — el pedido se confirmaba igual sin que nadie hubiera
// mirado cuánto entregó realmente el cliente.
//
// Alcance: SOLO Mostrador (isCounterMode) + Efectivo + venta nueva (no seña
// de pedido futuro, no descuento especial). Delivery y cualquier otro medio
// de pago conservan el comportamiento de siempre (precargado con el total,
// nunca obligatorio). Auditado: dentro de "Finalizar Pedido"
// (ConfirmOrderModal.jsx/PaymentSection.jsx) no existe ningún pago
// mixto/parcial (payments siempre es un array de UN solo elemento, siempre
// reemplazado con setPayments([...]), nunca con push) — el pago dividido
// real vive en CounterPaymentModal.jsx ("Cobrar Venta"), una pantalla
// distinta que esta corrección no toca.
//
// Correr con: node src/lib/api/__tests__/pagaConMostradorEfectivo.test.js
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
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const confirmModalSrc = leer('src/components/attention/ConfirmOrderModal.jsx');
const paymentSectionSrc = leer('src/components/attention/confirm-order/PaymentSection.jsx');
const newOrderModalSrc = leer('src/components/attention/NewOrderModal.jsx');
const counterPaymentModalSrc = leer('src/components/attention/CounterPaymentModal.jsx');

console.log('Auditoría: dentro de "Finalizar Pedido" no hay pago mixto/parcial que esta corrección pueda romper:');

check('PaymentSection.jsx siempre reemplaza `payments` con UN solo elemento (setPayments([...])), nunca hace push/concat', () => {
  assert.ok(!/payments\.push\(|payments\.concat\(|\.\.\.payments,/.test(paymentSectionSrc),
    'si esto aparece, PaymentSection.jsx empezó a soportar múltiples pagos y la obligatoriedad de abajo debe revisarse');
});

check('el pago dividido real (CounterPaymentModal.jsx, "Cobrar Venta") es una pantalla DISTINTA, no tocada por esta corrección', () => {
  assert.ok(!/isCounterMode/.test(counterPaymentModalSrc), 'CounterPaymentModal.jsx no debería depender de isCounterMode: es otro flujo');
  assert.match(counterPaymentModalSrc, /setPayments\(\[\.\.\.payments, \{ amount: parsedAmount, method: selectedPaymentMethod \}\]\)/,
    'confirma que SÍ admite múltiples pagos (push) — por eso queda fuera de esta corrección');
});

console.log('\nFuente: el prop isCounterMode llega desde NewOrderModal.jsx hasta PaymentSection.jsx:');

check('NewOrderModal.jsx pasa isCounterMode a ConfirmOrderModal', () => {
  const i = newOrderModalSrc.indexOf('<ConfirmOrderModal');
  assert.ok(i > 0);
  const bloque = newOrderModalSrc.slice(i, i + 400);
  assert.match(bloque, /isCounterMode={isCounterMode}/);
});

check('ConfirmOrderModal.jsx pasa isCounterMode a PaymentSection', () => {
  const i = confirmModalSrc.indexOf('<PaymentSection');
  assert.ok(i > 0);
  const bloque = confirmModalSrc.slice(i, i + 700);
  assert.match(bloque, /isCounterMode={isCounterMode}/);
});

console.log('\nFuente: la obligatoriedad solo aplica a Mostrador + Efectivo + venta nueva (no seña, no descuento especial):');

check('handleConfirm valida "Paga con" solo bajo !isFutureOrder && isCounterMode && !specialDiscountType && método Efectivo', () => {
  const i = confirmModalSrc.indexOf('const handleConfirm');
  const bloque = confirmModalSrc.slice(i, i + 1800);
  assert.match(bloque, /if \(!isFutureOrder && isCounterMode && !specialDiscountType\s*\n\s*&& payments\.length > 0 && payments\[0\]\.method === 'Efectivo'\) \{/);
  assert.match(bloque, /Falta el monto abonado/);
  assert.match(bloque, /Monto insuficiente/);
});

check('isConfirmDisabled también se bloquea por el mismo motivo (no depende solo del toast al hacer click)', () => {
  assert.match(confirmModalSrc, /const faltaMontoAbonadoMostrador = !isFutureOrder && isCounterMode && !specialDiscountType/);
  assert.match(confirmModalSrc, /const isConfirmDisabled = isSaving[\s\S]{0,200}\|\| faltaMontoAbonadoMostrador;/);
});

console.log('\nFuente: PaymentSection.jsx NO precarga "Paga con" con el total cuando es Mostrador (para poder detectar "vacío"):');

check('al seleccionar Efectivo en Mostrador, montoAbonado/paysWith quedan AUSENTES (no precargados con el total)', () => {
  const i = paymentSectionSrc.indexOf('const handleSelectPaymentMethod');
  const bloque = paymentSectionSrc.slice(i, i + 900);
  assert.match(bloque, /if \(isCounterMode\) \{[\s\S]*?delete newPayment\.montoAbonado;[\s\S]*?delete newPayment\.paysWith;/);
});

check('foco automático en "Paga con" cuando Mostrador + Efectivo', () => {
  assert.match(paymentSectionSrc, /montoAbonadoInputRef\.current\?\.focus\(\);/);
  const i = paymentSectionSrc.indexOf('montoAbonadoInputRef.current?.focus();');
  const antes = paymentSectionSrc.slice(Math.max(0, i - 300), i);
  assert.match(antes, /isCounterMode && selectedPaymentMethod === 'Efectivo'/);
});

check('Delivery y cualquier otro contexto conservan el comportamiento de siempre (precargado con el total)', () => {
  const i = paymentSectionSrc.indexOf('const handleSelectPaymentMethod');
  const bloque = paymentSectionSrc.slice(i, i + 1100);
  assert.match(bloque, /\} else \{[\s\S]*?newPayment\.montoAbonado = total;[\s\S]*?newPayment\.paysWith = total;/);
});

// ---------------------------------------------------------------------------
console.log('\nRéplica de la validación (fixtures genéricos, misma lógica que handleConfirm/isConfirmDisabled):');

// Réplica exacta de faltaMontoAbonadoMostrador / la validación de handleConfirm.
function montoAbonadoInvalido({ isFutureOrder, isCounterMode, specialDiscountType, payments, total }) {
  if (isFutureOrder || !isCounterMode || specialDiscountType) return false;
  if (!(payments.length > 0 && payments[0].method === 'Efectivo')) return false;
  const monto = payments[0].montoAbonado;
  if (monto === undefined || monto === null || monto === '' || isNaN(Number(monto))) return true;
  return Number(monto) < total;
}

const base = { isFutureOrder: false, isCounterMode: true, specialDiscountType: null, total: 16000 };

check('Mostrador + Efectivo + "Paga con" vacío -> bloquea', () => {
  const payments = [{ method: 'Efectivo' }]; // sin montoAbonado
  assert.strictEqual(montoAbonadoInvalido({ ...base, payments }), true);
});

check('Mostrador + Efectivo + "Paga con" menor al total -> bloquea', () => {
  const payments = [{ method: 'Efectivo', montoAbonado: 10000 }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, payments }), true);
});

check('Mostrador + Efectivo + "Paga con" = total exacto -> permite (ejemplo: Total 16.000, Paga con 16.000)', () => {
  const payments = [{ method: 'Efectivo', montoAbonado: 16000 }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, payments }), false);
});

check('Mostrador + Efectivo + "Paga con" mayor al total -> permite y calcula vuelto (ejemplo del enunciado: Total 16.000, Paga con 20.000, Vuelto 4.000)', () => {
  const total = 16000;
  const montoAbonado = 20000;
  const payments = [{ method: 'Efectivo', montoAbonado }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, total, payments }), false);
  assert.strictEqual(montoAbonado - total, 4000);
});

check('Mostrador + método distinto de Efectivo -> "Paga con" NO es obligatorio', () => {
  const payments = [{ method: 'Transferencia' }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, payments }), false);
});

check('Delivery (isCounterMode=false) + Efectivo + vacío -> NO bloquea (Delivery sigue como antes)', () => {
  const payments = [{ method: 'Efectivo' }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, isCounterMode: false, payments }), false);
});

check('Descuento especial activo -> "Paga con" no aplica (el total ya está en $0)', () => {
  const payments = [{ amount: 0, method: 'Sorteo' }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, specialDiscountType: 'Sorteo', payments }), false);
});

check('Pedido futuro (seña) -> "Paga con" no aplica (ese flujo usa depositAmount/depositMethod, no payments)', () => {
  const payments = [{ method: 'Efectivo' }];
  assert.strictEqual(montoAbonadoInvalido({ ...base, isFutureOrder: true, payments }), false);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
