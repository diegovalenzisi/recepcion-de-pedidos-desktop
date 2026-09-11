// Bug real: al asignar repartidor, el mensaje de WhatsApp aparecía duplicado
// DOS VECES consecutivas dentro del mismo cuadro de redacción (sin enviar).
//
// Causa raíz: hay un hook automático (useDeliveryStatusWhatsApp.js) que
// escucha cuando un pedido pasa a EN DELIVERY y, si nadie lo marcó como "ya
// enviado" (waTracker.js), abre su PROPIO WhatsApp con el mismo mensaje. Cada
// flujo de asignación MANUAL (AssignDelivererModal, SelectDeliveryPersonModal,
// DeliveryQRFlowManager, QRDelivererAssignmentFlow) también abre WhatsApp — y
// debe marcar ANTES, para que el hook automático nunca llegue a disparar el
// suyo. El bug era de TIMING: el marcado (markWaSent) ocurría DESPUÉS de
// generar el mensaje (que hace varias lecturas async a Firebase y tarda
// cientos de ms, o incluso después de un setTimeout de 1000ms en los flujos de
// QR) — dejando una ventana real donde el hook automático veía el pedido como
// EN DELIVERY, todavía sin marca, y disparaba su propio envío. El resultado
// NO son dos mensajes enviados (nada se envía todavía): WhatsApp recibe dos
// aperturas del mismo deep link con el mismo texto y las concatena en el
// cuadro de redacción, todavía sin enviar — el "mensaje duplicado" reportado.
//
// La prueba es GENÉRICA: no depende de ningún pedido/local real.
//
// Correr con: node src/lib/api/__tests__/whatsappAsignacionSinDuplicar.test.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markWaSent, wasWaRecentlySent } from '../../whatsapp/waTracker.js';

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e && e.message}`); process.exitCode = 1; }
}

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const assignModalSrc = leer('src/components/attention/AssignDelivererModal.jsx');
const selectModalSrc = leer('src/components/attention/SelectDeliveryPersonModal.jsx');
const qrFlowManagerSrc = leer('src/components/attention/DeliveryQRFlowManager.jsx');
const qrAssignFlowSrc = leer('src/components/attention/QRDelivererAssignmentFlow.jsx');
const autoHookSrc = leer('src/hooks/useDeliveryStatusWhatsApp.js');

console.log('Fuente: markWaSent() se llama ANTES de generar el mensaje, en cada flujo manual:');

// Para cada archivo, markWaSent(...) debe aparecer en el texto ANTES de
// generateEnDeliveryWhatsAppMessage(...) — sin esto, el hook automático puede
// ganar la carrera durante la generación async del mensaje.
const verificarOrdenMarcaAntesDeGenerar = (nombre, src) => {
  check(`${nombre}: markWaSent() antes de generateEnDeliveryWhatsAppMessage()`, () => {
    const iMark = src.indexOf('markWaSent(');
    const iGenerate = src.indexOf('generateEnDeliveryWhatsAppMessage(');
    assert.ok(iMark > 0, 'no se encontró markWaSent(...)');
    assert.ok(iGenerate > 0, 'no se encontró generateEnDeliveryWhatsAppMessage(...)');
    assert.ok(iMark < iGenerate, 'markWaSent() debe ejecutarse ANTES de armar el mensaje, no después');
  });
};

verificarOrdenMarcaAntesDeGenerar('AssignDelivererModal.jsx', assignModalSrc);
verificarOrdenMarcaAntesDeGenerar('SelectDeliveryPersonModal.jsx', selectModalSrc);
verificarOrdenMarcaAntesDeGenerar('DeliveryQRFlowManager.jsx', qrFlowManagerSrc);
verificarOrdenMarcaAntesDeGenerar('QRDelivererAssignmentFlow.jsx', qrAssignFlowSrc);

check('AssignDelivererModal.jsx importa markWaSent desde waTracker.js', () => {
  assert.match(assignModalSrc, /import \{ markWaSent \} from '@\/lib\/whatsapp\/waTracker'/);
});

check('el hook automático (useDeliveryStatusWhatsApp.js) sigue respetando wasWaRecentlySent antes de enviar el suyo', () => {
  const i = autoHookSrc.indexOf('wasWaRecentlySent(order.id)');
  assert.ok(i > 0, 'el hook automático dejó de consultar wasWaRecentlySent');
  const bloque = autoHookSrc.slice(i, i + 700);
  assert.match(bloque, /markWaSent\(order\.id\)/, 'el hook automático también debe marcar antes de su propio await');
});

// ---------------------------------------------------------------------------
console.log('\nwaTracker.js (lógica real, importada — no una réplica):');

check('markWaSent + wasWaRecentlySent: un pedido recién marcado se considera "ya enviado"', () => {
  const orderId = `test-${Date.now()}-A`;
  assert.strictEqual(wasWaRecentlySent(orderId), false, 'no debería estar marcado todavía');
  markWaSent(orderId);
  assert.strictEqual(wasWaRecentlySent(orderId), true, 'debería quedar marcado inmediatamente después de markWaSent');
});

check('pedidos distintos no se pisan entre sí', () => {
  const a = `test-${Date.now()}-B1`;
  const b = `test-${Date.now()}-B2`;
  markWaSent(a);
  assert.strictEqual(wasWaRecentlySent(a), true);
  assert.strictEqual(wasWaRecentlySent(b), false, 'marcar un pedido no debe afectar a otro distinto');
});

check('sin marcar, un pedido nunca se considera "ya enviado"', () => {
  const orderId = `test-${Date.now()}-C`;
  assert.strictEqual(wasWaRecentlySent(orderId), false);
  assert.strictEqual(wasWaRecentlySent(orderId), false);
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
