// Medios de pago de Mostrador según la PLATAFORMA del carrito (departamento
// real de los artículos, nunca el medio de pago). Módulo puro → corre sin
// Firebase ni React: node src/lib/api/__tests__/mediosDePagoMostrador.test.js
import assert from 'node:assert';
import {
  ETIQUETA_PREPAGO,
  detectarClavesDePlataforma,
  evaluarPlataformaDeCarrito,
  filtrarPrepagosDePlataforma,
  hayPagoParcialEnEfectivoConSaldoPendiente,
  restringirMediosPorDepartamentosComunes,
  resolverMediosDePago,
} from '../mediosDePagoMostrador.js';

let passed = 0;
function check(nombre, fn) {
  try { fn(); passed += 1; console.log(`  OK  ${nombre}`); }
  catch (e) { console.error(`FAIL  ${nombre}\n      ${e && e.message}`); process.exitCode = 1; }
}

const MEDIOS_BASE = ['Efectivo', 'Transferencia', 'Mercado Pago'];
const linea = (departamentoNombre) => ({ departamentoNombre });

// ---------------------------------------------------------------------------
// DATOS REALES DE PRODUCCIÓN — copiados TAL CUAL de /{localId}/CUENTAS de
// locales reales (leídos en vivo durante el diagnóstico del 2026-09-05, sin
// modificarlos). Esto NO es una lista inventada: "PREPAGO PEDIDOSYA",
// "PREPAGO RAPPI" y "PREPAGO MPAGO" son cuentas de cobro que YA EXISTÍAN
// desde antes de esta feature (así funcionaba el reporte viejo por medio de
// pago) — `fetchAccounts()` las trae SIEMPRE, para cualquier venta. El bug
// real en producción era exactamente este: los tests anteriores usaban un
// MEDIOS_BASE de juguete que nunca incluía estas cuentas, así que nunca
// pudieron detectar que la venta COMÚN las seguía mostrando.
//
//   Il Capo      (31915636): cta-3 "PREPAGO PEDIDOSYA", cta-4 "PREPAGO RAPPI", cta-9 "PREPAGO MPAGO"
//   Temperley    (38827976): cta-6 "PREPAGO PEDIDOSYA", cta-7 "PREPAGO RAPPI"
//   Achaval      (40508022): cta-3 "PREPAGO PEDIDOSYA", cta-4 "PREPAGO RAPPI"
const MEDIOS_REALES_IL_CAPO = Object.freeze([
  'Transferencia', 'Transferencia 2', 'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI',
  'Transferencia 3', 'Transferencia 4', 'PREPAGO MPAGO',
]);
// `paymentMethods` real tal como lo arma NewOrderModal.jsx: 'Efectivo' + cuentas.
const MEDIOS_REALES_CON_EFECTIVO = Object.freeze(['Efectivo', ...MEDIOS_REALES_IL_CAPO]);

console.log('\ndetectarClavesDePlataforma: por el NOMBRE del departamento, tolerando variantes:');
check('un carrito sin artículos de plataforma no detecta ninguna clave', () => {
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('TOPPING'), linea('BOCHAS')]), []);
});
check('reconoce variantes de PEDIDOSYA (espacio, mayúsculas)', () => {
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('PEDIDOS YA')]), ['PEDIDOSYA']);
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('PedidosYa')]), ['PEDIDOSYA']);
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('pedidosya')]), ['PEDIDOSYA']);
});
check('reconoce RAPPI', () => {
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('Rappi')]), ['RAPPI']);
});
check('reconoce variantes de M.LIBRE (punto, espacio, "Mercado Libre")', () => {
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('M.LIBRE')]), ['MLIBRE']);
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('M LIBRE')]), ['MLIBRE']);
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('Mercado Libre')]), ['MLIBRE']);
});
check('varias líneas de la MISMA plataforma dan una sola clave (sin repetir)', () => {
  assert.deepStrictEqual(detectarClavesDePlataforma([linea('PEDIDOSYA'), linea('PEDIDOS YA')]), ['PEDIDOSYA']);
});
check('dos plataformas distintas en el carrito devuelve las dos claves', () => {
  const claves = detectarClavesDePlataforma([linea('PEDIDOSYA'), linea('RAPPI')]);
  assert.strictEqual(claves.length, 2);
  assert.ok(claves.includes('PEDIDOSYA') && claves.includes('RAPPI'));
});

console.log('\nVenta COMÚN (sin artículos de plataforma): nunca ofrece prepago de plataforma:');
check('carrito sin artículos de plataforma → medios normales del local, sin ningún PREPAGO', () => {
  const r = evaluarPlataformaDeCarrito([linea('TOPPING'), linea('BOCHAS')], MEDIOS_BASE);
  assert.strictEqual(r.clave, null);
  assert.strictEqual(r.bloquear, false);
  assert.deepStrictEqual(r.medios, MEDIOS_BASE);
  for (const etiqueta of Object.values(ETIQUETA_PREPAGO)) {
    assert.ok(!r.medios.includes(etiqueta), `no debe ofrecer "${etiqueta}" en una venta común`);
  }
});
check('carrito vacío también es venta común', () => {
  const r = evaluarPlataformaDeCarrito([], MEDIOS_BASE);
  assert.strictEqual(r.clave, null);
  assert.deepStrictEqual(r.medios, MEDIOS_BASE);
});

console.log('\nVenta PEDIDOSYA: Efectivo + PREPAGO PEDIDOSYA, nunca los de otra plataforma:');
check('PEDIDOSYA → exactamente [Efectivo, PREPAGO PEDIDOSYA]', () => {
  const r = evaluarPlataformaDeCarrito([linea('PEDIDOS YA')], MEDIOS_BASE);
  assert.strictEqual(r.clave, 'PEDIDOSYA');
  assert.strictEqual(r.bloquear, false);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO PEDIDOSYA']);
});
check('PEDIDOSYA NUNCA ofrece PREPAGO RAPPI ni PREPAGO M.LIBRE ni los medios electrónicos del local', () => {
  const r = evaluarPlataformaDeCarrito([linea('PedidosYa')], MEDIOS_BASE);
  assert.ok(!r.medios.includes('PREPAGO RAPPI'));
  assert.ok(!r.medios.includes('PREPAGO M.LIBRE'));
  assert.ok(!r.medios.includes('Transferencia'));
  assert.ok(!r.medios.includes('Mercado Pago'));
});

console.log('\nVenta RAPPI: Efectivo + PREPAGO RAPPI, nunca los de otra plataforma:');
check('RAPPI → exactamente [Efectivo, PREPAGO RAPPI]', () => {
  const r = evaluarPlataformaDeCarrito([linea('RAPPI')], MEDIOS_BASE);
  assert.strictEqual(r.clave, 'RAPPI');
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO RAPPI']);
});
check('RAPPI NUNCA ofrece PREPAGO PEDIDOSYA ni PREPAGO M.LIBRE', () => {
  const r = evaluarPlataformaDeCarrito([linea('Rappi')], MEDIOS_BASE);
  assert.ok(!r.medios.includes('PREPAGO PEDIDOSYA'));
  assert.ok(!r.medios.includes('PREPAGO M.LIBRE'));
});

console.log('\nVenta M.LIBRE: Efectivo + PREPAGO M.LIBRE, nunca los de otra plataforma:');
check('M.LIBRE → exactamente [Efectivo, PREPAGO M.LIBRE]', () => {
  const r = evaluarPlataformaDeCarrito([linea('Mercado Libre')], MEDIOS_BASE);
  assert.strictEqual(r.clave, 'MLIBRE');
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO M.LIBRE']);
});
check('M.LIBRE NUNCA ofrece PREPAGO PEDIDOSYA ni PREPAGO RAPPI', () => {
  const r = evaluarPlataformaDeCarrito([linea('M LIBRE')], MEDIOS_BASE);
  assert.ok(!r.medios.includes('PREPAGO PEDIDOSYA'));
  assert.ok(!r.medios.includes('PREPAGO RAPPI'));
});

console.log('\nCambio dinámico: quitar el último artículo de plataforma hace desaparecer su prepago:');
check('con el artículo de PEDIDOSYA: aparece PREPAGO PEDIDOSYA', () => {
  const r = evaluarPlataformaDeCarrito([linea('PEDIDOSYA'), linea('TOPPING')], MEDIOS_BASE);
  // Mezclar un depto normal con uno de plataforma en el mismo ticket es válido
  // (el prorrateo de importes lo resuelve ventasPorDepartamento.js) — lo que
  // nunca puede pasar es DOS plataformas juntas.
  assert.strictEqual(r.clave, 'PEDIDOSYA');
  assert.ok(r.medios.includes('PREPAGO PEDIDOSYA'));
});
check('al quitar ese artículo (carrito queda común) el prepago desaparece de inmediato', () => {
  const r = evaluarPlataformaDeCarrito([linea('TOPPING')], MEDIOS_BASE);
  assert.strictEqual(r.clave, null);
  assert.ok(!r.medios.includes('PREPAGO PEDIDOSYA'));
  assert.deepStrictEqual(r.medios, MEDIOS_BASE);
});
check('lo mismo para RAPPI: sin artículos de RAPPI, sin PREPAGO RAPPI', () => {
  const conRappi = evaluarPlataformaDeCarrito([linea('RAPPI')], MEDIOS_BASE);
  assert.ok(conRappi.medios.includes('PREPAGO RAPPI'));
  const sinRappi = evaluarPlataformaDeCarrito([linea('BOCHAS')], MEDIOS_BASE);
  assert.ok(!sinRappi.medios.includes('PREPAGO RAPPI'));
});
check('lo mismo para M.LIBRE: sin artículos de M.LIBRE, sin PREPAGO M.LIBRE', () => {
  const conMLibre = evaluarPlataformaDeCarrito([linea('M.LIBRE')], MEDIOS_BASE);
  assert.ok(conMLibre.medios.includes('PREPAGO M.LIBRE'));
  const sinMLibre = evaluarPlataformaDeCarrito([linea('DULCES')], MEDIOS_BASE);
  assert.ok(!sinMLibre.medios.includes('PREPAGO M.LIBRE'));
});

console.log('\nEstado inconsistente: dos plataformas en el mismo carrito → bloquear, nunca combinar:');
check('PEDIDOSYA + RAPPI en el mismo carrito: bloquear=true, sin medios ofrecidos', () => {
  const r = evaluarPlataformaDeCarrito([linea('PEDIDOSYA'), linea('RAPPI')], MEDIOS_BASE);
  assert.strictEqual(r.bloquear, true);
  assert.strictEqual(r.clave, null);
  assert.deepStrictEqual(r.medios, []);
  assert.ok(r.titulo && r.mensaje, 'debe informar el problema, no fallar en silencio');
});
check('RAPPI + M.LIBRE en el mismo carrito también bloquea', () => {
  const r = evaluarPlataformaDeCarrito([linea('RAPPI'), linea('Mercado Libre')], MEDIOS_BASE);
  assert.strictEqual(r.bloquear, true);
});
check('PEDIDOSYA + M.LIBRE en el mismo carrito también bloquea', () => {
  const r = evaluarPlataformaDeCarrito([linea('PedidosYa'), linea('M LIBRE')], MEDIOS_BASE);
  assert.strictEqual(r.bloquear, true);
});
check('el bloqueo nunca inventa una combinación de prepagos', () => {
  const r = evaluarPlataformaDeCarrito([linea('PEDIDOSYA'), linea('RAPPI')], MEDIOS_BASE);
  assert.ok(!r.medios.includes('PREPAGO PEDIDOSYA'));
  assert.ok(!r.medios.includes('PREPAGO RAPPI'));
});

console.log('\nEtiquetas reutilizadas de ventasPorDepartamento.js (mismo literal que ya leen Reportes Prepago y DLV Consultas):');
check('ETIQUETA_PREPAGO trae exactamente los tres literales esperados', () => {
  assert.deepStrictEqual(ETIQUETA_PREPAGO, {
    PEDIDOSYA: 'PREPAGO PEDIDOSYA', RAPPI: 'PREPAGO RAPPI', MLIBRE: 'PREPAGO M.LIBRE',
  });
});

console.log('\nBUG REAL reproducido y corregido con las CUENTAS reales de Il Capo (31915636):');
check('filtrarPrepagosDePlataforma saca las 3 cuentas de prepago real (con su ortografía real: "PREPAGO MPAGO", no "M.LIBRE")', () => {
  const limpio = filtrarPrepagosDePlataforma(MEDIOS_REALES_CON_EFECTIVO);
  assert.deepStrictEqual(limpio, ['Efectivo', 'Transferencia', 'Transferencia 2', 'Transferencia 3', 'Transferencia 4']);
});
check('venta COMÚN con las cuentas reales del local: NO aparece ninguna de las 3 cuentas de prepago', () => {
  const r = evaluarPlataformaDeCarrito([linea('TOPPING')], MEDIOS_REALES_CON_EFECTIVO);
  assert.strictEqual(r.clave, null);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'Transferencia', 'Transferencia 2', 'Transferencia 3', 'Transferencia 4']);
  assert.ok(!r.medios.includes('PREPAGO PEDIDOSYA'));
  assert.ok(!r.medios.includes('PREPAGO RAPPI'));
  assert.ok(!r.medios.includes('PREPAGO MPAGO'));
});
check('venta PEDIDOSYA con las cuentas reales del local: exactamente [Efectivo, PREPAGO PEDIDOSYA], nada de Transferencia', () => {
  const r = evaluarPlataformaDeCarrito([linea('PEDIDOS YA')], MEDIOS_REALES_CON_EFECTIVO);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO PEDIDOSYA']);
});
check('venta RAPPI con las cuentas reales del local: exactamente [Efectivo, PREPAGO RAPPI]', () => {
  const r = evaluarPlataformaDeCarrito([linea('RAPPI')], MEDIOS_REALES_CON_EFECTIVO);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO RAPPI']);
});
check('venta M.LIBRE: exactamente [Efectivo, PREPAGO M.LIBRE] AUNQUE la cuenta real se llame "PREPAGO MPAGO"', () => {
  // La etiqueta ofrecida/guardada es la canónica (ETIQUETA_PREPAGO), no la cuenta
  // real — es una decisión de negocio explícita, no depende de cómo esté
  // configurada la cuenta histórica en cada local.
  const r = evaluarPlataformaDeCarrito([linea('Mercado Libre')], MEDIOS_REALES_CON_EFECTIVO);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO M.LIBRE']);
});

console.log('\nBUG REAL #2 (encontrado con evidencia visual del usuario en 1.3.102): PROMO EFECTIVO de Achaval (40508022) mostraba Transferencia + PREPAGO PEDIDOSYA/RAPPI:');
// Departamento REAL, leído en vivo de /40508022/DEPARTAMENTOS el día del diagnóstico.
const PROMO_EFECTIVO_ACHAVAL = Object.freeze({
  id: '1D', nombre: 'PROMO EFECTIVO', activo: true, activoMostrador: true, activoDelivery: true,
  permiteVentaEfectivo: true, permiteVentaElectronica: false,
});
const MEDIOS_ACHAVAL = Object.freeze(['Efectivo', 'Transferencia', 'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI']);

check('restringirMediosPorDepartamentosComunes: PROMO EFECTIVO (permiteVentaElectronica=false) → SOLO Efectivo', () => {
  const limpio = filtrarPrepagosDePlataforma(MEDIOS_ACHAVAL); // ['Efectivo','Transferencia']
  const r = restringirMediosPorDepartamentosComunes([PROMO_EFECTIVO_ACHAVAL], limpio);
  assert.deepStrictEqual(r, ['Efectivo']);
});
check('un departamento común que acepta efectivo Y electrónico no se restringe más', () => {
  const dep = { nombre: 'DULCES', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = restringirMediosPorDepartamentosComunes([dep], ['Efectivo', 'Transferencia']);
  assert.deepStrictEqual(r, ['Efectivo', 'Transferencia']);
});
check('un departamento SOLO electrónico (permiteVentaEfectivo=false) saca Efectivo de la lista', () => {
  const dep = { nombre: 'TRANSFERENCIA', permiteVentaEfectivo: false, permiteVentaElectronica: true };
  const r = restringirMediosPorDepartamentosComunes([dep], ['Efectivo', 'Transferencia']);
  assert.deepStrictEqual(r, ['Transferencia']);
});
check('sin departamentos resueltos, no restringe nada (deja pasar mediosComunes tal cual)', () => {
  assert.deepStrictEqual(restringirMediosPorDepartamentosComunes([], ['Efectivo', 'Transferencia']), ['Efectivo', 'Transferencia']);
});

check('resolverMediosDePago — CASO REAL EXACTO: PROMO EFECTIVO + 1 KILO DE HELADO en Achaval → EXACTAMENTE ["Efectivo"]', () => {
  // Esto es lo que hoy calcula mal la UI real: aparecían Efectivo, Transferencia,
  // PREPAGO PEDIDOSYA y PREPAGO RAPPI. El resultado correcto es sólo Efectivo.
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL);
  assert.deepStrictEqual(r.medios, ['Efectivo']);
  assert.strictEqual(r.clave, null);
  assert.strictEqual(r.bloquear, false);
});
check('resolverMediosDePago — PEDIDOSYA con las cuentas reales de Achaval → exactamente [Efectivo, PREPAGO PEDIDOSYA]', () => {
  const dep = { nombre: 'PEDIDOSYA', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([dep], MEDIOS_ACHAVAL);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO PEDIDOSYA']);
});
check('resolverMediosDePago — RAPPI con las cuentas reales de Achaval → exactamente [Efectivo, PREPAGO RAPPI]', () => {
  const dep = { nombre: 'RAPPI', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([dep], MEDIOS_ACHAVAL);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO RAPPI']);
});
check('resolverMediosDePago — M.LIBRE (Achaval todavía no tiene esa cuenta) → igual exactamente [Efectivo, PREPAGO M.LIBRE]', () => {
  const dep = { nombre: 'M.LIBRE', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([dep], MEDIOS_ACHAVAL);
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO M.LIBRE']);
});
check('resolverMediosDePago — plataformas mezcladas sigue bloqueando incluso combinado con la restricción de flags', () => {
  const py = { nombre: 'PEDIDOSYA', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const rappi = { nombre: 'RAPPI', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([py, rappi], MEDIOS_ACHAVAL);
  assert.strictEqual(r.bloquear, true);
  assert.deepStrictEqual(r.medios, []);
});

console.log('\nPago PARCIAL en una venta común (ej. PROMO EFECTIVO $12.000, pagan $10.000 en efectivo):');
check('hayPagoParcialEnEfectivoConSaldoPendiente: sin pagos → false', () => {
  assert.strictEqual(hayPagoParcialEnEfectivoConSaldoPendiente({ payments: [], remainingBalance: 12000 }), false);
});
check('hayPagoParcialEnEfectivoConSaldoPendiente: con Efectivo parcial y saldo → true', () => {
  assert.strictEqual(hayPagoParcialEnEfectivoConSaldoPendiente({ payments: [{ method: 'Efectivo', amount: 10000 }], remainingBalance: 2000 }), true);
});
check('hayPagoParcialEnEfectivoConSaldoPendiente: Efectivo cubre el total (saldo 0) → false, no hace falta habilitar nada', () => {
  assert.strictEqual(hayPagoParcialEnEfectivoConSaldoPendiente({ payments: [{ method: 'Efectivo', amount: 12000 }], remainingBalance: 0 }), false);
});
check('hayPagoParcialEnEfectivoConSaldoPendiente: un pago que no es Efectivo no cuenta', () => {
  assert.strictEqual(hayPagoParcialEnEfectivoConSaldoPendiente({ payments: [{ method: 'Transferencia', amount: 10000 }], remainingBalance: 2000 }), false);
});

check('resolverMediosDePago — PROMO EFECTIVO SIN pagos → solo ["Efectivo"] (respeta la restricción original)', () => {
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, { payments: [], remainingBalance: 12000 });
  assert.deepStrictEqual(r.medios, ['Efectivo']);
});
check('resolverMediosDePago — PROMO EFECTIVO con $10.000 pagados de $12.000 → aparecen las demás cuentas normales', () => {
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 10000 }], remainingBalance: 2000,
  });
  assert.deepStrictEqual(r.medios, ['Efectivo', 'Transferencia']); // MEDIOS_ACHAVAL sin los 2 PREPAGO
});
check('...y en ese caso JAMÁS aparece PREPAGO PEDIDOSYA', () => {
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 10000 }], remainingBalance: 2000,
  });
  assert.ok(!r.medios.includes('PREPAGO PEDIDOSYA'));
});
check('...ni PREPAGO RAPPI', () => {
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 10000 }], remainingBalance: 2000,
  });
  assert.ok(!r.medios.includes('PREPAGO RAPPI'));
});
check('...ni PREPAGO M.LIBRE/MPAGO, aunque la cuenta real del local esté guardada como "PREPAGO MPAGO"', () => {
  const medios = ['Efectivo', 'Transferencia', 'PREPAGO PEDIDOSYA', 'PREPAGO RAPPI', 'PREPAGO MPAGO'];
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], medios, {
    payments: [{ method: 'Efectivo', amount: 10000 }], remainingBalance: 2000,
  });
  assert.ok(!r.medios.includes('PREPAGO MPAGO'));
  assert.ok(!r.medios.some((m) => /mpago|m\.?libre/i.test(m)));
});
check('resolverMediosDePago — si Efectivo ya cubre el total, NO hace falta habilitar nada adicional (sigue restringido)', () => {
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 12000 }], remainingBalance: 0,
  });
  assert.deepStrictEqual(r.medios, ['Efectivo']);
});
check('resolverMediosDePago — PEDIDOSYA con pago parcial sigue restringido a [Efectivo, PREPAGO PEDIDOSYA]', () => {
  const dep = { nombre: 'PEDIDOSYA', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([dep], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 5000 }], remainingBalance: 5000,
  });
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO PEDIDOSYA']);
});
check('resolverMediosDePago — RAPPI con pago parcial: misma regla de 2 opciones', () => {
  const dep = { nombre: 'RAPPI', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([dep], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 3000 }], remainingBalance: 7000,
  });
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO RAPPI']);
});
check('resolverMediosDePago — M.LIBRE con pago parcial: misma regla de 2 opciones', () => {
  const dep = { nombre: 'M.LIBRE', permiteVentaEfectivo: true, permiteVentaElectronica: true };
  const r = resolverMediosDePago([dep], MEDIOS_ACHAVAL, {
    payments: [{ method: 'Efectivo', amount: 1000 }], remainingBalance: 11000,
  });
  assert.deepStrictEqual(r.medios, ['Efectivo', 'PREPAGO M.LIBRE']);
});

console.log('\nSimulación del FLUJO REAL de CounterPaymentModal.jsx (misma secuencia de estados que produce el componente, llamando a la misma resolverMediosDePago en cada paso — no es sólo una llamada aislada):');
check('PASO 1 (abrir "Cobrar Venta", $12.000, sin pagos) → sólo Efectivo', () => {
  const payments = [];
  const remainingBalance = 12000 - payments.reduce((s, p) => s + p.amount, 0);
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, { payments, remainingBalance });
  assert.deepStrictEqual(r.medios, ['Efectivo']);
});
check('PASO 2 (cajero agrega pago Efectivo $10.000, igual que handleAddPayment) → aparece Transferencia, sin ningún PREPAGO', () => {
  const payments = [{ amount: 10000, method: 'Efectivo' }]; // shape real que arma handleAddPayment
  const remainingBalance = 12000 - payments.reduce((s, p) => s + p.amount, 0);
  assert.strictEqual(remainingBalance, 2000);
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, { payments, remainingBalance });
  assert.deepStrictEqual(r.medios, ['Efectivo', 'Transferencia']);
});
check('PASO 3 (cajero agrega Transferencia $2.000 para completar) → saldo 0, ya se puede confirmar', () => {
  const payments = [{ amount: 10000, method: 'Efectivo' }, { amount: 2000, method: 'Transferencia' }];
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remainingBalance = 12000 - totalPaid;
  assert.strictEqual(totalPaid, 12000);
  // Mismo gate que handleConfirmPayment en CounterPaymentModal.jsx: remainingBalance > 0.009 bloquea.
  assert.ok(!(remainingBalance > 0.009), 'con saldo 0 la venta debe poder confirmarse');
  // Y la lista sigue sin ofrecer ningún PREPAGO en ningún momento de la secuencia.
  const r = resolverMediosDePago([PROMO_EFECTIVO_ACHAVAL], MEDIOS_ACHAVAL, { payments, remainingBalance });
  assert.ok(Object.values(ETIQUETA_PREPAGO).every((etq) => !r.medios.includes(etq)));
});

console.log(`\n${passed} pruebas OK` + (process.exitCode ? ' — HAY FALLAS ARRIBA' : ''));
