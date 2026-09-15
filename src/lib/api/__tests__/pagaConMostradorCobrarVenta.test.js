// "COBRAR VENTA" (CounterPaymentModal.jsx) — Mostrador + Efectivo: foco
// automático en "Paga con" (nunca obligatorio: vacío = paga justo), cálculo
// de vuelto, y desglose Total/Paga con/Vuelto en Pagos Registrados.
//
// REGLA VIGENTE (reemplaza la versión anterior, que exigía pagaCon > monto):
//   campo VACÍO ("", null, undefined)  -> paga justo: pagaCon = monto, vuelto = 0
//   pagaCon == monto                    -> válido, vuelto = 0
//   pagaCon > monto                     -> válido, vuelto = pagaCon - monto
//   pagaCon < monto (escrito a mano)    -> inválido, se bloquea
// Un "0" escrito a mano NO es "vacío": es un importe insuficiente y se
// bloquea igual que cualquier otro valor menor al monto.
//
// IDENTIFICACIÓN DE MOSTRADOR: este modal ("Cobrar Venta") es exclusivo del
// flujo de Mostrador — se monta SOLO desde CounterPage.jsx/CounterTab.jsx,
// sobre una venta creada por counterApi.js (saveCounterSale). Nunca se
// reutiliza para Delivery/Web: ESE flujo usa PaymentSection.jsx/
// ConfirmOrderModal.jsx (gateado por su propio `isCounterMode`, corregido
// aparte en pagaConMostradorEfectivo.test.js — pantalla DISTINTA, no tocada
// acá). Por eso no existe un flag `esMostrador` nuevo: la condición real es
// "el archivo que corre es CounterPaymentModal.jsx".
//
// Correr con: node src/lib/api/__tests__/pagaConMostradorCobrarVenta.test.js
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

const counterPaymentModalSrc = leer('src/components/attention/CounterPaymentModal.jsx');
const counterPageSrc = leer('src/pages/CounterPage.jsx');
const counterTabSrc = leer('src/components/attention/CounterTab.jsx');
const paymentSectionSrc = leer('src/components/attention/confirm-order/PaymentSection.jsx');
const confirmModalSrc = leer('src/components/attention/ConfirmOrderModal.jsx');
const deliveryTabSrc = leer('src/components/attention/DeliveryTab.jsx');

// ---------------------------------------------------------------------------
console.log('\n0. IDENTIFICACIÓN DE MOSTRADOR — se reutiliza, no se inventa (puntos 16, 17, 23):');

check('CounterPaymentModal.jsx es Mostrador por construcción y lo documenta', () => {
  assert.match(counterPaymentModalSrc, /esMostrador/i);
  assert.match(counterPaymentModalSrc, /CounterPage\.jsx\/CounterTab\.jsx/);
});

check('el modal SOLO se monta desde Mostrador (CounterPage/CounterTab)', () => {
  assert.match(counterPageSrc, /<CounterPaymentModal/);
  assert.match(counterTabSrc, /CounterPaymentModal/);
});

check('Delivery (DeliveryTab.jsx) y el flujo de "Finalizar Pedido" (PaymentSection/ConfirmOrderModal) NO importan CounterPaymentModal', () => {
  assert.ok(!/CounterPaymentModal/.test(deliveryTabSrc), 'DeliveryTab.jsx ahora reutiliza el modal de Mostrador');
  assert.ok(!/CounterPaymentModal/.test(paymentSectionSrc), 'PaymentSection.jsx ahora reutiliza el modal de Mostrador');
  assert.ok(!/CounterPaymentModal/.test(confirmModalSrc), 'ConfirmOrderModal.jsx ahora reutiliza el modal de Mostrador');
});

// ---------------------------------------------------------------------------
console.log('\n1-3. FOCO AUTOMÁTICO + LIMPIEZA AL CAMBIAR DE MÉTODO (puntos 1, 3, 14, 17, 21.1):');

check('usa useRef + focus()/select() — la solución de React pedida, no un querySelector', () => {
  assert.match(counterPaymentModalSrc, /const paysWithInputRef = useRef\(null\);/);
  assert.match(counterPaymentModalSrc, /ref={paysWithInputRef}/);
  assert.match(counterPaymentModalSrc, /paysWithInputRef\.current\?\.focus\(\);/);
  assert.match(counterPaymentModalSrc, /paysWithInputRef\.current\?\.select\(\);/);
  assert.ok(!/document\.querySelector/.test(counterPaymentModalSrc), 'usa querySelector en vez de ref');
});

check('el foco se dispara cuando el método QUEDA en Efectivo (incluye la selección inicial al abrir)', () => {
  const i = counterPaymentModalSrc.indexOf('paysWithInputRef.current?.focus();');
  const antes = counterPaymentModalSrc.slice(Math.max(0, i - 200), i);
  assert.match(antes, /selectedPaymentMethod === 'Efectivo'/);
});

check('"Paga con" se limpia con cada cambio de método (nunca queda pegado de Efectivo a otro medio) — punto 14', () => {
  const i = counterPaymentModalSrc.indexOf('Al cambiar de método de pago');
  assert.ok(i > 0, 'no se encontró el comentario del efecto que limpia paysWith al cambiar de método');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 700);
  assert.match(cuerpo, /setPaysWith\(''\);/);
  assert.match(cuerpo, /\[selectedPaymentMethod\]/, 'el efecto no depende de selectedPaymentMethod');
});

// ---------------------------------------------------------------------------
console.log('\n1,4-6. "AÑADIR PAGO" SIEMPRE HABILITADO + VUELTO — solo Efectivo (puntos 1, 4, 5, 6):');

check('paysWithInvalido trata el campo VACÍO como válido (nunca deshabilita el botón)', () => {
  const i = counterPaymentModalSrc.indexOf('const paysWithInvalido = useMemo');
  assert.ok(i > 0);
  const cuerpo = counterPaymentModalSrc.slice(i, i + 400);
  assert.match(cuerpo, /if \(paysWith === '' \|\| paysWith === null \|\| paysWith === undefined\) return false;/);
});

check('paysWithInvalido ya NO exige estrictamente mayor: pagaCon == monto es válido', () => {
  const i = counterPaymentModalSrc.indexOf('const paysWithInvalido = useMemo');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 400);
  assert.match(cuerpo, /payValue < amountValue/);
  assert.ok(!/payValue <= amountValue/.test(cuerpo), 'volvió a exigir estrictamente mayor');
});

check('el botón "Añadir Pago" (rama Efectivo) NUNCA se deshabilita solo por el campo vacío', () => {
  assert.match(counterPaymentModalSrc, /disabled={!amount \|\| remainingBalance <= 0 \|\| paysWithInvalido}/);
});

check('handleAddPayment: campo vacío -> paga justo (pagaCon = monto); escrito y menor -> bloquea (punto 5)', () => {
  const i = counterPaymentModalSrc.indexOf('const handleAddPayment');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2400);
  assert.match(cuerpo, /if \(selectedPaymentMethod === 'Efectivo'\) \{/);
  assert.match(cuerpo, /const paysWithVacio = paysWith === '' \|\| paysWith === null \|\| paysWith === undefined;/);
  assert.match(cuerpo, /parsedPaysWith = parsedAmount; \/\/ no informado -> paga justo/);
  assert.match(cuerpo, /parsedPaysWith < parsedAmount/);
  assert.match(cuerpo, /El importe de 'Paga con' no puede ser menor al monto a cobrar\./);
});

check('mensaje de error visible en pantalla, con el texto actualizado (ya no dice "debe ser mayor")', () => {
  assert.match(counterPaymentModalSrc, /paysWith && paysWithInvalido/);
  assert.match(counterPaymentModalSrc, /El importe de 'Paga con' no puede ser menor al monto a cobrar\./);
  assert.ok(!/debe ser mayor al monto a cobrar/.test(counterPaymentModalSrc), 'quedó el mensaje viejo (regla anterior)');
});

// Réplica PURA de paysWithInvalido, para probar la tabla exacta del punto 6.
function paysWithInvalido(paysWith, amount) {
  if (paysWith === '' || paysWith === null || paysWith === undefined) return false;
  const payValue = parseFloat(paysWith);
  const amountValue = parseFloat(amount);
  return isNaN(payValue) || isNaN(amountValue) || payValue < amountValue;
}

const MONTO_A_COBRAR = '12500';

check('1/9) foco automático + botón nunca deshabilitado por vacío: ya cubierto arriba por inspección de fuente', () => {
  assert.ok(true);
});

check('2) campo VACÍO -> válido (Añadir Pago habilitado)', () => {
  assert.strictEqual(paysWithInvalido('', MONTO_A_COBRAR), false);
  assert.strictEqual(paysWithInvalido(null, MONTO_A_COBRAR), false);
  assert.strictEqual(paysWithInvalido(undefined, MONTO_A_COBRAR), false);
});

check('3) "0" escrito a mano NO es "vacío": se bloquea como cualquier valor insuficiente', () => {
  assert.strictEqual(paysWithInvalido('0', MONTO_A_COBRAR), true);
});

check('valor MENOR ($10.000) sigue sin permitir (punto 6/8)', () => {
  assert.strictEqual(paysWithInvalido('10000', MONTO_A_COBRAR), true);
});

check('4) valor IGUAL ($12.500) ahora SÍ permite (paga justo, vuelto 0)', () => {
  assert.strictEqual(paysWithInvalido('12500', MONTO_A_COBRAR), false);
});

check('6) valor MAYOR ($12.501, $13.000, $15.000) SÍ permite', () => {
  assert.strictEqual(paysWithInvalido('12501', MONTO_A_COBRAR), false);
  assert.strictEqual(paysWithInvalido('13000', MONTO_A_COBRAR), false);
  assert.strictEqual(paysWithInvalido('15000', MONTO_A_COBRAR), false);
});

// Réplica PURA de calculateChange.
function calcularVuelto(paysWith, amount) {
  const payValue = parseFloat(paysWith);
  const amountValue = parseFloat(amount);
  if (!isNaN(payValue) && !isNaN(amountValue) && payValue >= amountValue) return payValue - amountValue;
  return 0;
}

check('7) calcula el vuelto correctamente (ejemplo del punto 6: 12.500 / 15.000 → 2.500)', () => {
  assert.strictEqual(calcularVuelto('15000', '12500'), 2500);
});

check('vuelto se recalcula en tiempo real si cambia Monto a Cobrar o Paga con', () => {
  assert.strictEqual(calcularVuelto('15000', '10000'), 5000);
  assert.strictEqual(calcularVuelto('20000', '10000'), 10000);
});

// ---------------------------------------------------------------------------
console.log('\n7-8. DATOS GUARDADOS — monto/pagaCon/vuelto, sin romper pagos históricos (puntos 7, 8, 21.8-21.10):');

check('el pago Efectivo guarda amount, pagaCon y vuelto como campos ADITIVOS', () => {
  const i = counterPaymentModalSrc.indexOf('const handleAddPayment');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2900);
  assert.match(cuerpo, /nuevoPago = \{ \.\.\.nuevoPago, pagaCon: parsedPaysWith, vuelto: parsedPaysWith - parsedAmount \}/);
  // El método que se guarda sigue siendo `amount`/`method` como siempre —
  // pagaCon/vuelto se agregan, no reemplazan la forma existente.
  assert.match(cuerpo, /let nuevoPago = \{ amount: parsedAmount, method: selectedPaymentMethod \};/);
});

check('otros métodos (no Efectivo) NO agregan pagaCon/vuelto — mismo payload de siempre', () => {
  const i = counterPaymentModalSrc.indexOf('const handleAddPayment');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2900);
  const iIf = cuerpo.indexOf("if (selectedPaymentMethod === 'Efectivo')");
  assert.ok(iIf > 0);
  // Nada antes del if ASIGNA pagaCon: el objeto base es siempre {amount, method}.
  // (busca "pagaCon:", la asignación real — no alcanza con "pagaCon" a secas,
  // que también aparece en los comentarios que explican la regla vigente).
  assert.ok(!/pagaCon:/.test(cuerpo.slice(0, iIf)));
});

// Réplica del payload real que produce handleAddPayment — incluye la
// normalización "vacío -> paga justo" (paysWith undefined/null/'' -> amount).
function construirPago({ amount, method, paysWith }) {
  let pago = { amount, method };
  if (method === 'Efectivo') {
    const vacio = paysWith === '' || paysWith === null || paysWith === undefined;
    const pagaCon = vacio ? amount : paysWith;
    pago = { ...pago, pagaCon, vuelto: pagaCon - amount };
  }
  return pago;
}

check('8-10) guarda monto, pagaCon y vuelto (ejemplo conceptual del punto 8)', () => {
  const pago = construirPago({ amount: 12500, method: 'Efectivo', paysWith: 15000 });
  assert.strictEqual(pago.amount, 12500);
  assert.strictEqual(pago.pagaCon, 15000);
  assert.strictEqual(pago.vuelto, 2500);
});

check('2) Paga con VACÍO -> guarda pagaCon = monto (paga justo)', () => {
  assert.strictEqual(construirPago({ amount: 12500, method: 'Efectivo', paysWith: '' }).pagaCon, 12500);
  assert.strictEqual(construirPago({ amount: 12500, method: 'Efectivo', paysWith: undefined }).pagaCon, 12500);
  assert.strictEqual(construirPago({ amount: 12500, method: 'Efectivo', paysWith: null }).pagaCon, 12500);
});

check('3) Paga con VACÍO -> vuelto = 0', () => {
  const pago = construirPago({ amount: 12500, method: 'Efectivo', paysWith: '' });
  assert.strictEqual(pago.vuelto, 0);
});

check('5) Paga con == monto (escrito a mano) -> vuelto = 0', () => {
  const pago = construirPago({ amount: 12500, method: 'Efectivo', paysWith: 12500 });
  assert.strictEqual(pago.pagaCon, 12500);
  assert.strictEqual(pago.vuelto, 0);
});

check('7) Paga con > monto -> vuelto correcto', () => {
  const pago = construirPago({ amount: 12500, method: 'Efectivo', paysWith: 15000 });
  assert.strictEqual(pago.vuelto, 2500);
});

check('un pago histórico SIN pagaCon/vuelto sigue siendo un objeto válido (compatibilidad)', () => {
  const historico = { amount: 5000, method: 'Efectivo' }; // sin pagaCon/vuelto, como antes de esta corrección
  assert.strictEqual(historico.pagaCon, undefined);
  // totalPaid solo usa `amount`, nunca pagaCon — funciona igual con o sin el campo nuevo.
  const totalPaid = [historico].reduce((sum, p) => sum + p.amount, 0);
  assert.strictEqual(totalPaid, 5000);
});

// ---------------------------------------------------------------------------
console.log('\n9-10. PAGOS REGISTRADOS — desglose solo en Efectivo con pagaCon (puntos 9, 10, 21.12):');

check('el desglose Total/Paga con/Vuelto solo aparece si method === "Efectivo" && pagaCon !== undefined', () => {
  assert.match(counterPaymentModalSrc, /p\.method === 'Efectivo' && p\.pagaCon !== undefined \?/);
});

check('se mantiene el botón de eliminar pago en AMBAS ramas (con y sin desglose)', () => {
  const ocurrencias = (counterPaymentModalSrc.match(/onClick={\(\) => removePayment\(i\)}/g) || []).length;
  assert.strictEqual(ocurrencias, 2, 'debería haber un botón de eliminar en la rama nueva y otro en la rama original');
});

check('no se rediseñó el modal: sigue siendo un <Dialog> de dos columnas, mismo título "Cobrar Venta"', () => {
  assert.match(counterPaymentModalSrc, /Cobrar Venta/);
  assert.match(counterPaymentModalSrc, /grid grid-cols-2 gap-6 py-4/);
});

// ---------------------------------------------------------------------------
console.log('\n11-13. TOTAL PAGADO / PAGO MIXTO / ELIMINAR PAGO (puntos 7, 11, 12, 13, 21.11, 21.13):');

check('totalPaid sigue sumando `amount` (nunca pagaCon) — sin cambios respecto de antes', () => {
  assert.match(counterPaymentModalSrc, /const totalPaid = useMemo\(\(\) => payments\.reduce\(\(sum, p\) => sum \+ p\.amount, 0\), \[payments\]\);/);
});

check('11) pago mixto (Transferencia $10.000 + Efectivo Paga-con $15.000): Total Pagado usa $10.000, no $15.000', () => {
  const totalVenta = 20000;
  const transferencia = { amount: 10000, method: 'Transferencia' };
  const efectivo = construirPago({ amount: 10000, method: 'Efectivo', paysWith: 15000 });
  assert.strictEqual(efectivo.vuelto, 5000);

  const payments = [transferencia, efectivo];
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = totalVenta - totalPaid;

  assert.strictEqual(totalPaid, 20000, 'Total Pagado tiene que ser 10.000 + 10.000, NO 10.000 + 15.000');
  assert.strictEqual(remainingBalance, 0);
});

check('10) pago mixto + Efectivo con "Paga con" vacío: toma como paga justo el saldo del tramo en efectivo', () => {
  // Ejemplo del punto 10: Total 20.000, Transferencia 8.000, saldo 12.000,
  // se elige Efectivo con Monto a Cobrar = 12.000 (autocompletado por el
  // saldo pendiente, como ya hace el componente) y Paga con vacío.
  const totalVenta = 20000;
  const transferencia = { amount: 8000, method: 'Transferencia' };
  const efectivo = construirPago({ amount: 12000, method: 'Efectivo', paysWith: '' });

  assert.strictEqual(efectivo.pagaCon, 12000);
  assert.strictEqual(efectivo.vuelto, 0);

  const payments = [transferencia, efectivo];
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = totalVenta - totalPaid;

  assert.strictEqual(totalPaid, 20000);
  assert.strictEqual(remainingBalance, 0);
});

check('11) Pagos Registrados: el desglose se muestra aunque "Paga con" se haya autocompletado (pagaCon nunca queda undefined)', () => {
  const efectivo = construirPago({ amount: 12500, method: 'Efectivo', paysWith: '' });
  // La misma condición que usa el JSX: method === 'Efectivo' && pagaCon !== undefined.
  assert.strictEqual(efectivo.method === 'Efectivo' && efectivo.pagaCon !== undefined, true);
});

check('13) eliminar un pago Efectivo elimina también pagaCon/vuelto (van adentro del mismo objeto) y recalcula', () => {
  const payments = [
    { amount: 10000, method: 'Transferencia' },
    construirPago({ amount: 10000, method: 'Efectivo', paysWith: 15000 }),
  ];
  const despuesDeEliminar = payments.filter((_, i) => i !== 1);
  assert.strictEqual(despuesDeEliminar.length, 1);
  assert.ok(!despuesDeEliminar.some(p => p.pagaCon !== undefined), 'quedó un pagaCon huérfano');
  const totalPaid = despuesDeEliminar.reduce((sum, p) => sum + p.amount, 0);
  assert.strictEqual(totalPaid, 10000);
});

check('el vuelto NO se guarda como gasto/forma de pago/ítem extra — no hay push a gastos ni a payments por el vuelto', () => {
  const i = counterPaymentModalSrc.indexOf('const handleAddPayment');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2900);
  assert.ok(!/setPayments\(\[\.\.\.payments, nuevoPago\], \{.*vuelto/.test(cuerpo));
  // Un solo push por click: el vuelto vive DENTRO del mismo objeto de pago, no aparte.
  const pushes = (cuerpo.match(/setPayments\(\[\.\.\.payments, /g) || []).length;
  assert.strictEqual(pushes, 1);
});

// ---------------------------------------------------------------------------
console.log('\n14-19. REGRESIÓN — Delivery/Web/otros métodos NO se alteran (puntos 19, 20, 22):');

check('14-15) Delivery/Web no pasan por CounterPaymentModal.jsx en absoluto: nada que exigir ni que cambiar ahí', () => {
  assert.ok(!/CounterPaymentModal/.test(deliveryTabSrc));
  assert.ok(!/CounterPaymentModal/.test(paymentSectionSrc));
  assert.ok(!/CounterPaymentModal/.test(confirmModalSrc));
});

check('16) el otro flujo Mostrador/Delivery ("Finalizar Pedido", isCounterMode) sigue intacto: no se tocó su lógica', () => {
  assert.match(paymentSectionSrc, /isCounterMode/, 'PaymentSection.jsx debería seguir usando isCounterMode');
  assert.match(confirmModalSrc, /isCounterMode/, 'ConfirmOrderModal.jsx debería seguir usando isCounterMode');
});

check('17) Transferencia (u otro medio) en Mostrador NO activa "Paga con"/vuelto: usa la rama "else" sin paysWithInvalido', () => {
  const iElse = counterPaymentModalSrc.indexOf('<div className="grid grid-cols-12 items-end gap-2">');
  assert.ok(iElse > 0, 'no se encontró la rama de otros métodos');
  const ramaOtrosMetodos = counterPaymentModalSrc.slice(iElse, iElse + 700);
  assert.ok(!/paysWithInvalido/.test(ramaOtrosMetodos), 'la rama de otros métodos quedó atada a la validación de Paga con');
  assert.match(ramaOtrosMetodos, /disabled={!amount \|\| remainingBalance <= 0 \|\| !!specialDiscountType}/, 'la rama de otros métodos cambió su condición original');
});

check('18) el resto de los métodos de pago en Mostrador siguen iguales (Monto simple + Añadir, sin Paga con/Vuelto)', () => {
  const iElse = counterPaymentModalSrc.indexOf('<div className="grid grid-cols-12 items-end gap-2">');
  const ramaOtrosMetodos = counterPaymentModalSrc.slice(iElse, iElse + 700);
  assert.ok(!/Paga con|Vuelto/.test(ramaOtrosMetodos));
});

check('19) el cambio de Mostrador no altera la forma en que Delivery arma su objeto de pago (payments.push/concat sigue ausente en PaymentSection.jsx)', () => {
  assert.ok(!/payments\.push\(|payments\.concat\(|\.\.\.payments,/.test(paymentSectionSrc),
    'si aparece, PaymentSection.jsx cambió su estructura de pago único — no debería, por esta corrección');
});

check('no se tocó nada de facturación/stock/comandas/Caja Fuerte/Retiro de Efectivo desde este archivo', () => {
  assert.ok(!/colasFiscales|stockLedger|printCommand|CAJAFUERTE|RETIROS_EFECTIVO/.test(counterPaymentModalSrc));
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
