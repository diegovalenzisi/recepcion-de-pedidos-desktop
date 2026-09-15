// "COBRAR VENTA" (CounterPaymentModal.jsx) — Mostrador:
//   1) "Paga con" OBLIGATORIO en Efectivo (pagaCon >= montoEfectivo).
//   2) Botón "DIV. FORM. PAGO": divide el saldo entre Efectivo y la cuenta
//      electrónica FAVORITA del local, en una sola pantalla.
//
// REGLA VIGENTE DE "PAGA CON" (reemplaza la anterior "vacío = paga justo",
// que queda ELIMINADA):
//   campo VACÍO ("", null, undefined)  -> INVÁLIDO, se bloquea
//   pagaCon < monto                     -> INVÁLIDO, se bloquea
//   pagaCon == monto                    -> válido, vuelto = 0
//   pagaCon > monto                     -> válido, vuelto = pagaCon - monto
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
const accountsApiSrc = leer('src/lib/api/accountsApi.js');

// ---------------------------------------------------------------------------
console.log('\n0. IDENTIFICACIÓN DE MOSTRADOR — se reutiliza, no se inventa (punto 22):');

check('CounterPaymentModal.jsx es Mostrador por construcción y lo documenta', () => {
  assert.match(counterPaymentModalSrc, /esMostrador/i);
  assert.match(counterPaymentModalSrc, /CounterPage\.jsx\/CounterTab\.jsx/);
});

check('el modal SOLO se monta desde Mostrador (CounterPage/CounterTab)', () => {
  assert.match(counterPageSrc, /<CounterPaymentModal/);
  assert.match(counterTabSrc, /CounterPaymentModal/);
});

check('Delivery/Web (DeliveryTab, PaymentSection, ConfirmOrderModal) NO importan CounterPaymentModal', () => {
  assert.ok(!/CounterPaymentModal/.test(deliveryTabSrc));
  assert.ok(!/CounterPaymentModal/.test(paymentSectionSrc));
  assert.ok(!/CounterPaymentModal/.test(confirmModalSrc));
});

// ---------------------------------------------------------------------------
console.log('\nPRUEBAS 1-7 — "PAGA CON" OBLIGATORIO (sección 25):');

// Réplica PURA de paysWithInvalido (ver CounterPaymentModal.jsx).
function paysWithInvalido(paysWith, amount) {
  if (paysWith === '' || paysWith === null || paysWith === undefined) return true;
  const payValue = parseFloat(paysWith);
  const amountValue = parseFloat(amount);
  return isNaN(payValue) || isNaN(amountValue) || payValue < amountValue;
}

const MONTO_A_COBRAR = '12500';

check('1) Paga con VACÍO -> inválido (ya no es "paga justo")', () => {
  assert.strictEqual(paysWithInvalido('', MONTO_A_COBRAR), true);
  assert.strictEqual(paysWithInvalido(null, MONTO_A_COBRAR), true);
  assert.strictEqual(paysWithInvalido(undefined, MONTO_A_COBRAR), true);
});

check('2) Paga con MENOR ($10.000 de $12.500) -> inválido', () => {
  assert.strictEqual(paysWithInvalido('10000', MONTO_A_COBRAR), true);
});

check('3) Paga con IGUAL ($12.500) -> válido', () => {
  assert.strictEqual(paysWithInvalido('12500', MONTO_A_COBRAR), false);
});

check('5) Paga con MAYOR ($15.000) -> válido', () => {
  assert.strictEqual(paysWithInvalido('15000', MONTO_A_COBRAR), false);
  assert.strictEqual(paysWithInvalido('12501', MONTO_A_COBRAR), false);
});

// Réplica PURA de calculateChange.
function calcularVuelto(paysWith, amount) {
  const payValue = parseFloat(paysWith);
  const amountValue = parseFloat(amount);
  if (!isNaN(payValue) && !isNaN(amountValue) && payValue >= amountValue) return payValue - amountValue;
  return 0;
}

check('4) Paga con IGUAL -> vuelto = 0', () => {
  assert.strictEqual(calcularVuelto('12500', MONTO_A_COBRAR), 0);
});

check('5) Paga con MAYOR -> vuelto correcto (12.500 / 15.000 -> 2.500)', () => {
  assert.strictEqual(calcularVuelto('15000', MONTO_A_COBRAR), 2500);
});

check('6) foco automático en "Paga con" sigue funcionando (useRef + focus()/select())', () => {
  assert.match(counterPaymentModalSrc, /const paysWithInputRef = useRef\(null\);/);
  assert.match(counterPaymentModalSrc, /ref={paysWithInputRef}/);
  assert.match(counterPaymentModalSrc, /paysWithInputRef\.current\?\.focus\(\);/);
  assert.match(counterPaymentModalSrc, /paysWithInputRef\.current\?\.select\(\);/);
  const i = counterPaymentModalSrc.indexOf('paysWithInputRef.current?.focus();');
  const antes = counterPaymentModalSrc.slice(Math.max(0, i - 200), i);
  assert.match(antes, /selectedPaymentMethod === 'Efectivo'/);
});

check('7) la prueba anterior "vacío = paga justo" ya NO existe (código ni mensaje)', () => {
  assert.ok(!/no informado -> paga justo/.test(counterPaymentModalSrc), 'quedó código de la regla vieja');
  assert.ok(!/paysWithVacio = paysWith === '' \|\| paysWith === null \|\| paysWith === undefined;\s*\n\s*const parsedPaysWith = parseFloat\(paysWith\);\s*\n\s*if \(isNaN\(parsedPaysWith\) \|\| parsedPaysWith < parsedAmount\) \{/.test(counterPaymentModalSrc));
});

check('fuente: paysWithInvalido ya no acepta vacío, y ya no exige estrictamente mayor', () => {
  const i = counterPaymentModalSrc.indexOf('const paysWithInvalido = useMemo');
  assert.ok(i > 0);
  const cuerpo = counterPaymentModalSrc.slice(i, i + 400);
  assert.match(cuerpo, /if \(paysWith === '' \|\| paysWith === null \|\| paysWith === undefined\) return true;/);
  assert.match(cuerpo, /payValue < amountValue/);
  assert.ok(!/payValue <= amountValue/.test(cuerpo), 'volvió a exigir estrictamente mayor');
});

check('fuente: handleAddPayment bloquea vacío igual que un valor menor (revalida, no solo el disabled del botón)', () => {
  const i = counterPaymentModalSrc.indexOf('const handleAddPayment');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2100);
  assert.match(cuerpo, /if \(selectedPaymentMethod === 'Efectivo'\) \{/);
  assert.match(cuerpo, /paysWithVacio \|\| isNaN\(parsedPaysWith\) \|\| parsedPaysWith < parsedAmount/);
  assert.match(cuerpo, /El importe de 'Paga con' es obligatorio y no puede ser menor al monto a cobrar\./);
});

check('fuente: el botón "Añadir Pago" (Efectivo normal) se deshabilita con paysWithInvalido', () => {
  assert.match(counterPaymentModalSrc, /disabled={!amount \|\| remainingBalance <= 0 \|\| paysWithInvalido}/);
});

// Réplica del payload real que produce handleAddPayment en modo normal
// (asume paysWith ya validado — no vacío, no menor al monto).
function construirPago({ amount, method, paysWith }) {
  let pago = { amount, method };
  if (method === 'Efectivo') {
    pago = { ...pago, pagaCon: paysWith, vuelto: paysWith - amount };
  }
  return pago;
}

check('guarda amount/pagaCon/vuelto como campos aditivos, sin tocar otros métodos', () => {
  const pago = construirPago({ amount: 12500, method: 'Efectivo', paysWith: 15000 });
  assert.strictEqual(pago.amount, 12500);
  assert.strictEqual(pago.pagaCon, 15000);
  assert.strictEqual(pago.vuelto, 2500);

  const i = counterPaymentModalSrc.indexOf('const handleAddPayment');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2100);
  const iIf = cuerpo.indexOf("if (selectedPaymentMethod === 'Efectivo')");
  assert.ok(iIf > 0);
  assert.ok(!/pagaCon:/.test(cuerpo.slice(0, iIf)), 'otro método quedó agregando pagaCon');
});

check('un pago histórico SIN pagaCon/vuelto sigue siendo válido (compatibilidad)', () => {
  const historico = { amount: 5000, method: 'Efectivo' };
  assert.strictEqual(historico.pagaCon, undefined);
  assert.strictEqual([historico].reduce((sum, p) => sum + p.amount, 0), 5000);
});

check('Pagos Registrados: el desglose Total/Paga con/Vuelto solo aparece si method === "Efectivo" && pagaCon !== undefined', () => {
  assert.match(counterPaymentModalSrc, /p\.method === 'Efectivo' && p\.pagaCon !== undefined \?/);
});

check('no se rediseñó el modal: sigue siendo un <Dialog> de dos columnas, mismo título "Cobrar Venta"', () => {
  assert.match(counterPaymentModalSrc, /Cobrar Venta/);
  assert.match(counterPaymentModalSrc, /grid grid-cols-2 gap-6 py-4/);
});

// ---------------------------------------------------------------------------
console.log('\nPRUEBAS 8-24 — DIV. FORM. PAGO (sección 26):');

check('8) el botón "DIV. FORM. PAGO" existe en el modal de Mostrador', () => {
  assert.match(counterPaymentModalSrc, /DIV\. FORM\. PAGO/);
  assert.match(counterPaymentModalSrc, /onClick={handleToggleSplitMode}/);
});

check('la cuenta favorita sale de accountsApi.js (isFavorite === true en CUENTAS) — misma fuente que ya usa el resto del sistema', () => {
  assert.match(accountsApiSrc, /export const fetchFavoriteAccount = async/);
  assert.match(accountsApiSrc, /isFavorite === true/);
  assert.match(counterPaymentModalSrc, /acc\?\.isFavorite === true && acc\?\.nombre/);
  assert.ok(!/TRANSFERENCIA['"]/.test(counterPaymentModalSrc.replace(/\/\/.*$/gm, '')), 'quedó una cuenta hardcodeada fuera de comentarios');
});

check('9-10) al activar la división aparecen Efectivo + la favorita — NO todas las cuentas electrónicas', () => {
  const i = counterPaymentModalSrc.indexOf('isSplitMode ? (');
  assert.ok(i > 0, 'no se encontró el panel de división');
  const panel = counterPaymentModalSrc.slice(i, i + 2200);
  assert.match(panel, /Efectivo — Monto/);
  assert.match(panel, /favoriteAccount\?\.nombre \|\| 'Cuenta favorita'/);
  // El panel no itera ninguna lista de cuentas — usa directamente favoriteAccount.
  assert.ok(!/availablePaymentMethods\.map/.test(panel), 'el panel de división lista todas las cuentas, no solo la favorita');
});

// ---------------------------------------------------------------------------
console.log('\nCASO ACHAVAL (localId 40508022) — bug real reportado:');

// Réplica PURA de la detección (idéntica a la línea real del componente):
//   const favorita = (accountsData || []).find((acc) => acc?.isFavorite === true && acc?.nombre) || null;
function detectarFavorita(accountsData) {
  return (accountsData || []).find((acc) => acc?.isFavorite === true && acc?.nombre) || null;
}

// Datos REALES de 40508022/CUENTAS, leídos de Firebase para esta corrección
// (ver informe): cta-1 es la favorita real, con isFavorite como boolean.
const CUENTAS_ACHAVAL = [
  { id: 'cta-1', nombre: 'Transferencia', isFavorite: true, alias: 'HELADERIA.ACHAVAL', aNombreDe: 'DIEGO LEONEL VALENZISI', imprimeFactura: true },
  { id: 'cta-3', nombre: 'PREPAGO PEDIDOSYA', isFavorite: false, cuentaFacturacionAsociadaId: 'cta-1' },
  { id: 'cta-4', nombre: 'PREPAGO RAPPI', isFavorite: false, cuentaFacturacionAsociadaId: 'cta-1' },
];

check('1-2-9) ACHAVAL real: isFavorite=true (boolean) en cta-1 se detecta directo desde CUENTAS -> favoriteAccount.id === "cta-1"', () => {
  const favorita = detectarFavorita(CUENTAS_ACHAVAL);
  assert.ok(favorita, 'no detectó ninguna favorita con los datos reales de ACHAVAL');
  assert.strictEqual(favorita.id, 'cta-1');
  assert.strictEqual(favorita.nombre, 'Transferencia');
});

check('1) el string "true" (mal tipado) NO cuenta como favorita — exige === true, boolean real', () => {
  const conStringMalo = [{ id: 'cta-9', nombre: 'Débito', isFavorite: 'true' }];
  assert.strictEqual(detectarFavorita(conStringMalo), null, 'aceptó un string "true" como si fuera boolean');
});

check('3) la detección NO depende de fecha, turno ni venta — es una función pura de CUENTAS únicamente', () => {
  // Se llama con los MISMOS datos de cuentas y da el mismo resultado, sin
  // ningún parámetro de fecha/turno/orderItems/orderTotal involucrado.
  const r1 = detectarFavorita(CUENTAS_ACHAVAL);
  const r2 = detectarFavorita(CUENTAS_ACHAVAL);
  assert.deepStrictEqual(r1, r2);
});

check('4) la detección NO depende de una lista visual previamente filtrada (availablePaymentMethods)', () => {
  // Aunque availablePaymentMethods esté restringido a solo Efectivo (ej. carrito
  // con "PROMO EFECTIVO", departamento efectivo-only real de ACHAVAL: 1D),
  // favoriteAccount se sigue detectando igual. Y ahora (corrección de esta
  // ronda) esa restricción tampoco bloquea la DIVISIÓN — ver sección "DIV.
  // FORM. PAGO ANULA LA RESTRICCIÓN POR DEPARTAMENTO" más abajo.
  const availablePaymentMethodsRestringido = ['Efectivo'];
  const favorita = detectarFavorita(CUENTAS_ACHAVAL);
  assert.strictEqual(favorita.nombre, 'Transferencia', 'la detección se contaminó con la lista restringida');
  assert.ok(!availablePaymentMethodsRestringido.includes(favorita.nombre), 'este caso tiene que poder existir: favorita fuera de la lista normal, y aun así disponible para dividir');
});

check('5) usa el NOMBRE REAL de la cuenta ("Transferencia"), no un texto genérico ni hardcodeado', () => {
  const favorita = detectarFavorita(CUENTAS_ACHAVAL);
  assert.strictEqual(favorita.nombre, 'Transferencia');
  // Con otra favorita (ej. Mercado Pago) tiene que devolver ESE nombre, no uno fijo.
  const otraFavorita = detectarFavorita([{ id: 'cta-1', nombre: 'Mercado Pago', isFavorite: true }]);
  assert.strictEqual(otraFavorita.nombre, 'Mercado Pago');
});

check('6) un cambio de favorita se refleja al releer CUENTAS (nada queda pegado de una carga anterior)', () => {
  const antes = detectarFavorita(CUENTAS_ACHAVAL); // favorita = Transferencia (cta-1)
  const cuentasDespuesDeCambiarEnConfiguracion = [
    { id: 'cta-1', nombre: 'Transferencia', isFavorite: false },
    { id: 'cta-4', nombre: 'PREPAGO RAPPI', isFavorite: false },
    { id: 'cta-5', nombre: 'Mercado Pago', isFavorite: true },
  ];
  const despues = detectarFavorita(cuentasDespuesDeCambiarEnConfiguracion);
  assert.strictEqual(antes.nombre, 'Transferencia');
  assert.strictEqual(despues.nombre, 'Mercado Pago', 'quedó pegada la favorita vieja');
});

check('7) sin ninguna cuenta con isFavorite === true, recién ahí null (para mostrar "Sin cuenta favorita")', () => {
  const sinFavorita = [
    { id: 'cta-1', nombre: 'Transferencia', isFavorite: false },
    { id: 'cta-2', nombre: 'Mercado Pago', isFavorite: false },
  ];
  assert.strictEqual(detectarFavorita(sinFavorita), null);
});

check('8) con favorita existente, la detección JAMÁS devuelve null (nunca debería mostrarse "Sin cuenta favorita")', () => {
  assert.notStrictEqual(detectarFavorita(CUENTAS_ACHAVAL), null);
});

check('fuente: loadPaymentMethods relee CUENTAS completo cada vez que el modal abre (sin caché entre aperturas — punto 8)', () => {
  // fetchAccounts() es un fetch() directo a CUENTAS.json (ver accountsApi.js);
  // loadPaymentMethods se llama de nuevo en cada apertura del modal (useEffect
  // [isOpen]) — no hay memoización de accountsData/favoriteAccount entre
  // ventas ni un caché local propio en este archivo.
  const i = counterPaymentModalSrc.indexOf('if (isOpen) {');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 500);
  assert.match(cuerpo, /loadPaymentMethods\(\);/);
  assert.ok(!/localStorage|sessionStorage/.test(counterPaymentModalSrc), 'apareció un caché local propio para cuentas/favorita');
});

check('11) obtiene la favorita DINÁMICAMENTE al cargar el modal (no hardcodea ningún nombre)', () => {
  const i = counterPaymentModalSrc.indexOf('const favorita = ');
  assert.ok(i > 0);
  const cuerpo = counterPaymentModalSrc.slice(i, i + 300);
  assert.match(cuerpo, /accountsData \|\| \[\]\)\.find\(\(acc\) => acc\?\.isFavorite === true/);
  assert.match(counterPaymentModalSrc, /setFavoriteAccount\(favorita\);/);
});

// ---------------------------------------------------------------------------
console.log('\nDIV. FORM. PAGO ANULA LA RESTRICCIÓN POR DEPARTAMENTO (corrección de esta ronda):');

check('5-6-7) handleToggleSplitMode YA NO consulta availablePaymentMethods — la ÚNICA condición es que exista favoriteAccount', () => {
  const i = counterPaymentModalSrc.indexOf('const handleToggleSplitMode');
  assert.ok(i > 0);
  const cuerpo = counterPaymentModalSrc.slice(i, i + 1300);
  assert.match(cuerpo, /if \(!favoriteAccount\) \{/);
  assert.match(cuerpo, /No hay una cuenta electrónica favorita configurada\./);
  // Chequea el USO real (la llamada), no la mención en prosa dentro del
  // comentario que explica a propósito por qué ya no se consulta.
  assert.ok(!/availablePaymentMethods\.includes\(/.test(cuerpo), 'handleToggleSplitMode todavía consulta availablePaymentMethods para bloquear la división');
  assert.ok(!/no está habilitada para esta venta/.test(counterPaymentModalSrc), 'quedó el mensaje de la restricción anterior — esa condición debe haber desaparecido por completo');
});

check('2-4) el panel de división usa SIEMPRE Efectivo + favoriteAccount.nombre, nunca filtra por availablePaymentMethods (artículo solo-Efectivo o solo-electrónico no importa)', () => {
  const i = counterPaymentModalSrc.indexOf('isSplitMode ? (');
  assert.ok(i > 0);
  const panel = counterPaymentModalSrc.slice(i, i + 2200);
  assert.match(panel, /Efectivo — Monto/);
  assert.match(panel, /favoriteAccount\?\.nombre \|\| 'Cuenta favorita'/);
  assert.ok(!/availablePaymentMethods/.test(panel), 'el panel de división quedó condicionado por la lista normal filtrada');
});

check('1-3) el modo NORMAL (fuera de isSplitMode) sigue usando availablePaymentMethods sin cambios — la restricción por departamento no se tocó', () => {
  assert.match(counterPaymentModalSrc, /const availablePaymentMethods = useMemo\(\s*\n\s*\(\) => resolverMediosDePago\(itemDepartments, mediosDelLocal, \{ payments, remainingBalance \}\)\.medios,/);
  assert.match(counterPaymentModalSrc, /<PaymentMethodSlider methods={availablePaymentMethods}/);
});

check('8) al cancelar la división (volver a presionar DIV. FORM. PAGO), se vuelve al panel normal que sí respeta availablePaymentMethods', () => {
  // isSplitMode pasa a false; el ternario del panel cae a la rama que sigue
  // usando selectedPaymentMethod/availablePaymentMethods de siempre.
  const iTernario = counterPaymentModalSrc.indexOf('isSplitMode ? (');
  const cuerpo = counterPaymentModalSrc.slice(iTernario, iTernario + 3200);
  assert.match(cuerpo, /\) : selectedPaymentMethod === 'Efectivo' && !specialDiscountType \? \(/);
});

check('9) resolverMediosDePago (mediosDePagoMostrador.js) NO se modificó — la excepción vive solo en CounterPaymentModal', () => {
  const mediosDePagoMostradorSrc = leer('src/lib/api/mediosDePagoMostrador.js');
  assert.match(mediosDePagoMostradorSrc, /export function resolverMediosDePago\(departamentosDelCarrito, mediosBase = \[\], estadoPago = null\) \{/);
  assert.ok(!/isSplitMode|DIV\. FORM\. PAGO|favoriteAccount/.test(mediosDePagoMostradorSrc), 'la excepción de división se filtró a la función compartida — debe quedar SOLO en CounterPaymentModal');
});

// Réplica de la nueva condición de entrada (ya sin availablePaymentMethods).
function puedeEntrarAModoDividido(favoriteAccount) {
  return !!favoriteAccount;
}

check('6) con favorita configurada, SIEMPRE permite entrar en modo dividido (sin importar restricción de departamento)', () => {
  assert.strictEqual(puedeEntrarAModoDividido(detectarFavorita(CUENTAS_ACHAVAL)), true);
});

check('7) sin favorita, no permite división (única condición real que bloquea)', () => {
  const sinFavorita = [{ id: 'cta-1', nombre: 'Transferencia', isFavorite: false }];
  assert.strictEqual(puedeEntrarAModoDividido(detectarFavorita(sinFavorita)), false);
});

check('EJEMPLO ACHAVAL — PROMO EFECTIVO (departamento real, permiteVentaElectronica:false): cobro normal solo Efectivo, división ofrece Efectivo + Transferencia igual', () => {
  // Simula lo que ya hace restringirMediosPorDepartamentosComunes para un
  // carrito 100% del departamento "PROMO EFECTIVO" (permiteVentaEfectivo:true,
  // permiteVentaElectronica:false) — dato real leído de 40508022/DEPARTAMENTOS.
  const departamentoPromoEfectivo = [{ nombre: 'PROMO EFECTIVO', permiteVentaEfectivo: true, permiteVentaElectronica: false }];
  const mediosComunes = ['Efectivo', 'Transferencia'];
  const todosEfectivo = departamentoPromoEfectivo.every((d) => d.permiteVentaEfectivo === true);
  const todosElectronico = departamentoPromoEfectivo.every((d) => d.permiteVentaElectronica === true);
  const availablePaymentMethodsCobroNormal = (todosEfectivo && !todosElectronico) ? ['Efectivo'] : mediosComunes;

  assert.deepStrictEqual(availablePaymentMethodsCobroNormal, ['Efectivo'], '1) cobro normal debe seguir restringido a Efectivo');

  // División: ignora availablePaymentMethodsCobroNormal por completo.
  const favorita = detectarFavorita(CUENTAS_ACHAVAL);
  const mediosDeDivision = ['Efectivo', favorita.nombre];
  assert.deepStrictEqual(mediosDeDivision, ['Efectivo', 'Transferencia'], '2) la división debe ofrecer Efectivo + la favorita de todos modos');
});

check('3-4) artículo SOLO ELECTRÓNICO (ej. "TRANSFERENCIA" 2D de ACHAVAL, permiteVentaEfectivo:false): cobro normal sin Efectivo, división ofrece Efectivo + favorita igual', () => {
  // Dato real: 40508022/DEPARTAMENTOS/2D = { nombre: "TRANSFERENCIA",
  // permiteVentaEfectivo:false, permiteVentaElectronica:true }.
  const departamentoSoloElectronico = [{ nombre: 'TRANSFERENCIA', permiteVentaEfectivo: false, permiteVentaElectronica: true }];
  const mediosComunes = ['Efectivo', 'Transferencia'];
  const todosEfectivo = departamentoSoloElectronico.every((d) => d.permiteVentaEfectivo === true);
  const todosElectronico = departamentoSoloElectronico.every((d) => d.permiteVentaElectronica === true);
  const availablePaymentMethodsCobroNormal = (!todosEfectivo && todosElectronico)
    ? mediosComunes.filter((m) => m !== 'Efectivo')
    : mediosComunes;

  assert.deepStrictEqual(availablePaymentMethodsCobroNormal, ['Transferencia'], '3) cobro normal mantiene la restricción (sin Efectivo)');

  const favorita = detectarFavorita(CUENTAS_ACHAVAL);
  const mediosDeDivision = ['Efectivo', favorita.nombre];
  assert.deepStrictEqual(mediosDeDivision, ['Efectivo', 'Transferencia'], '4) la división igual ofrece Efectivo + la favorita');
});

// Réplicas PURAS de la lógica de división (ver CounterPaymentModal.jsx).
function splitPaysWithInvalido(splitEfectivo, splitPaysWith) {
  const efectivoNum = parseFloat(splitEfectivo) || 0;
  if (efectivoNum <= 0) return false;
  if (splitPaysWith === '' || splitPaysWith === null || splitPaysWith === undefined) return true;
  const paysWithNum = parseFloat(splitPaysWith);
  return isNaN(paysWithNum) || paysWithNum < efectivoNum;
}

function splitVuelto(splitEfectivo, splitPaysWith) {
  const efectivoNum = parseFloat(splitEfectivo) || 0;
  const paysWithNum = parseFloat(splitPaysWith);
  if (efectivoNum > 0 && !isNaN(paysWithNum) && paysWithNum >= efectivoNum) return paysWithNum - efectivoNum;
  return 0;
}

function sumaValida(efectivo, electronico, remainingBalance) {
  return Math.abs(((parseFloat(efectivo) || 0) + (parseFloat(electronico) || 0)) - remainingBalance) <= 0.009;
}

/** Réplica de handleConfirmSplitPayment: arma los pagos, o null si inválido. */
function construirPagosDivididos({ splitEfectivo, splitPaysWith, splitElectronico, favoriteAccountNombre, remainingBalance }) {
  const efectivoNum = parseFloat(splitEfectivo) || 0;
  const electronicoNum = parseFloat(splitElectronico) || 0;
  if (efectivoNum < 0 || electronicoNum < 0) return null;
  if (!sumaValida(splitEfectivo, splitElectronico, remainingBalance)) return null;
  if (efectivoNum <= 0 && electronicoNum <= 0) return null;

  const pagos = [];
  if (efectivoNum > 0) {
    const parsedPaysWith = parseFloat(splitPaysWith);
    if (splitPaysWith === '' || isNaN(parsedPaysWith) || parsedPaysWith < efectivoNum) return null;
    pagos.push({ amount: efectivoNum, method: 'Efectivo', pagaCon: parsedPaysWith, vuelto: parsedPaysWith - efectivoNum });
  }
  if (electronicoNum > 0) {
    pagos.push({ amount: electronicoNum, method: favoriteAccountNombre });
  }
  return pagos;
}

check('12) Efectivo + favorita deben sumar el total pendiente', () => {
  assert.strictEqual(sumaValida(8000, 12000, 20000), true);
});

check('13) suma MENOR bloquea la confirmación (8.000 + 11.000 = 19.000, falta 1.000)', () => {
  assert.strictEqual(sumaValida(8000, 11000, 20000), false);
  const pagos = construirPagosDivididos({ splitEfectivo: '8000', splitPaysWith: '8000', splitElectronico: '11000', favoriteAccountNombre: 'Transferencia', remainingBalance: 20000 });
  assert.strictEqual(pagos, null);
});

check('14) suma MAYOR bloquea la confirmación (10.000 + 12.000 = 22.000, sobre 20.000)', () => {
  assert.strictEqual(sumaValida(10000, 12000, 20000), false);
  const pagos = construirPagosDivididos({ splitEfectivo: '10000', splitPaysWith: '10000', splitElectronico: '12000', favoriteAccountNombre: 'Transferencia', remainingBalance: 20000 });
  assert.strictEqual(pagos, null);
});

check('15) suma EXACTA permite confirmar', () => {
  const pagos = construirPagosDivididos({ splitEfectivo: '8000', splitPaysWith: '10000', splitElectronico: '12000', favoriteAccountNombre: 'Transferencia', remainingBalance: 20000 });
  assert.ok(Array.isArray(pagos) && pagos.length === 2);
});

check('16) si Efectivo > 0, "Paga con" es obligatorio en la división', () => {
  assert.strictEqual(splitPaysWithInvalido('8000', ''), true);
  assert.strictEqual(splitPaysWithInvalido('8000', null), true);
});

check('16b) si Efectivo = 0, "Paga con" no aplica y no bloquea', () => {
  assert.strictEqual(splitPaysWithInvalido('0', ''), false);
  assert.strictEqual(splitPaysWithInvalido('', ''), false);
});

check('17) "Paga con" se compara SOLO contra la parte en Efectivo, nunca contra el total', () => {
  // Total 20.000, Efectivo 8.000, Transferencia 12.000, Paga con 10.000 -> válido
  // (10.000 >= 8.000; NO se exige 10.000 >= 20.000).
  assert.strictEqual(splitPaysWithInvalido('8000', '10000'), false);
});

check('18) ejemplo exacto del enunciado: efectivo 8.000, paga con 10.000 -> vuelto 2.000', () => {
  assert.strictEqual(splitVuelto('8000', '10000'), 2000);
});

check('19) confirmar la división guarda DOS pagos reales con la estructura correcta', () => {
  const pagos = construirPagosDivididos({ splitEfectivo: '8000', splitPaysWith: '10000', splitElectronico: '12000', favoriteAccountNombre: 'Transferencia', remainingBalance: 20000 });
  assert.deepStrictEqual(pagos, [
    { amount: 8000, method: 'Efectivo', pagaCon: 10000, vuelto: 2000 },
    { amount: 12000, method: 'Transferencia' },
  ]);
});

check('20) Total Pagado usa 8.000 + 12.000 = 20.000, NUNCA suma pagaCon (10.000+12.000=22.000 sería incorrecto)', () => {
  const pagos = construirPagosDivididos({ splitEfectivo: '8000', splitPaysWith: '10000', splitElectronico: '12000', favoriteAccountNombre: 'Transferencia', remainingBalance: 20000 });
  const totalPaid = pagos.reduce((sum, p) => sum + p.amount, 0);
  assert.strictEqual(totalPaid, 20000);
  assert.notStrictEqual(totalPaid, 22000);
});

check('21) Pagos Registrados: ambos métodos se renderizan con la lógica ya existente (Efectivo con desglose, electrónico con línea simple)', () => {
  const pagos = construirPagosDivididos({ splitEfectivo: '8000', splitPaysWith: '10000', splitElectronico: '12000', favoriteAccountNombre: 'Transferencia', remainingBalance: 20000 });
  const [efectivo, electronico] = pagos;
  assert.strictEqual(efectivo.method === 'Efectivo' && efectivo.pagaCon !== undefined, true, 'debería activar el desglose Total/Paga con/Vuelto');
  assert.strictEqual(electronico.method === 'Efectivo' && electronico.pagaCon !== undefined, false, 'la electrónica no debe activar el desglose de efectivo');
});

check('fuente: handleConfirmSplitPayment agrega los dos pagos de una sola vez (no dos clicks) y sale del modo dividido', () => {
  const i = counterPaymentModalSrc.indexOf('const handleConfirmSplitPayment');
  assert.ok(i > 0);
  const cuerpo = counterPaymentModalSrc.slice(i, i + 2200);
  assert.match(cuerpo, /setPayments\(\[\.\.\.payments, \.\.\.nuevosPagos\]\);/);
  assert.match(cuerpo, /setIsSplitMode\(false\);/);
});

check('22) "Cancelar división" (volver a presionar DIV. FORM. PAGO) limpia los importes temporales', () => {
  const i = counterPaymentModalSrc.indexOf('const handleToggleSplitMode');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 400);
  assert.match(cuerpo, /if \(isSplitMode\) \{\s*\n\s*setIsSplitMode\(false\);\s*\n\s*limpiarEstadoDivision\(\);/);
  const iLimpiar = counterPaymentModalSrc.indexOf('const limpiarEstadoDivision');
  const cuerpoLimpiar = counterPaymentModalSrc.slice(iLimpiar, iLimpiar + 200);
  assert.match(cuerpoLimpiar, /setSplitEfectivo\(''\);/);
  assert.match(cuerpoLimpiar, /setSplitElectronico\(''\);/);
  assert.match(cuerpoLimpiar, /setSplitPaysWith\(''\);/);
});

check('22b) abrir el modal para una venta nueva también resetea el estado de división', () => {
  const i = counterPaymentModalSrc.indexOf('if (isOpen) {');
  const cuerpo = counterPaymentModalSrc.slice(i, i + 500);
  assert.match(cuerpo, /setIsSplitMode\(false\);/);
  assert.match(cuerpo, /setSplitEfectivo\(''\);/);
});

check('21 (defensivo) — solo cuentas ELECTRÓNICAS: CUENTAS nunca incluye "Efectivo" como entrada', () => {
  // "Efectivo" siempre se antepone a mano a la lista de medios (nunca sale de
  // CUENTAS), así que la favorita real jamás puede resolver a "Efectivo".
  assert.match(counterPaymentModalSrc, /setMediosDelLocal\(\['Efectivo', \.\.\.new Set\(electronicPaymentMethods\)\]\);/);
});

check('24) Delivery/Web no cambian: PaymentSection/ConfirmOrderModal siguen con su propia lógica (isCounterMode), sin división', () => {
  assert.match(paymentSectionSrc, /isCounterMode/);
  assert.match(confirmModalSrc, /isCounterMode/);
  assert.ok(!/DIV\. FORM\. PAGO|handleToggleSplitMode|isSplitMode/.test(paymentSectionSrc));
  assert.ok(!/DIV\. FORM\. PAGO|handleToggleSplitMode|isSplitMode/.test(confirmModalSrc));
  assert.ok(!/payments\.push\(|payments\.concat\(|\.\.\.payments,/.test(paymentSectionSrc));
});

check('no se tocó nada de facturación/stock/comandas/Caja Fuerte/Retiro de Efectivo desde este archivo', () => {
  assert.ok(!/colasFiscales|stockLedger|printCommand|CAJAFUERTE|RETIROS_EFECTIVO/.test(counterPaymentModalSrc));
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
